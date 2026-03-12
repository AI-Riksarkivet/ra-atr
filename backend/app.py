import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import lancedb
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from huggingface_hub import CommitScheduler, hf_hub_download
from pydantic import BaseModel

DATASET_REPO = os.environ.get("DATASET_REPO", "lejonet/transcriptions")
TABLE_NAME = "transcriptions"
DB_PATH = os.environ.get("LANCEDB_PATH", "/tmp/lancedb")
PARQUET_DIR = Path(os.environ.get("PARQUET_DIR", "/tmp/parquet_export"))

SCHEMA = pa.schema([
    pa.field("id", pa.string()),
    pa.field("version", pa.int32()),
    pa.field("reference_code", pa.string()),
    pa.field("manifest_id", pa.string()),
    pa.field("page_number", pa.int32()),
    pa.field("group_name", pa.string()),
    pa.field("group_rect_x", pa.float32()),
    pa.field("group_rect_y", pa.float32()),
    pa.field("group_rect_w", pa.float32()),
    pa.field("group_rect_h", pa.float32()),
    pa.field("line_index", pa.int32()),
    pa.field("bbox_x", pa.float32()),
    pa.field("bbox_y", pa.float32()),
    pa.field("bbox_w", pa.float32()),
    pa.field("bbox_h", pa.float32()),
    pa.field("text", pa.string()),
    pa.field("confidence", pa.float32()),
    pa.field("source", pa.string()),
    pa.field("contributor", pa.string()),
    pa.field("created_at", pa.timestamp("us", tz="UTC")),
])

db = None
table = None
scheduler = None


# --- Pydantic models ---


class BBoxInput(BaseModel):
    x: float
    y: float
    w: float
    h: float


class LineInput(BaseModel):
    line_index: int
    bbox: BBoxInput
    text: str
    confidence: float
    source: str


class GroupInput(BaseModel):
    page_number: int
    group_name: str
    group_rect: BBoxInput
    lines: list[LineInput]


class ContributeRequest(BaseModel):
    reference_code: str
    groups: list[GroupInput]


# --- DB lifecycle ---


def init_db():
    global db, table
    db = lancedb.connect(DB_PATH)

    # In dev mode, try to reuse existing local table
    if not os.environ.get("SPACE_ID"):
        try:
            table = db.open_table(TABLE_NAME)
            print(f"Opened local table with {table.count_rows()} rows")
            return
        except Exception:
            pass

    # In production, cold-start from HF Dataset repo
    try:
        local_path = hf_hub_download(
            repo_id=DATASET_REPO,
            filename="transcriptions.parquet",
            repo_type="dataset",
        )
        pq_table = pq.read_table(local_path)
        table = db.create_table(TABLE_NAME, pq_table, mode="overwrite")
        print(f"Loaded {table.count_rows()} rows from dataset repo")
    except Exception as e:
        print(f"No existing data found ({e}), creating empty table")
        table = db.create_table(TABLE_NAME, schema=SCHEMA, mode="overwrite")


def init_scheduler():
    global scheduler
    PARQUET_DIR.mkdir(parents=True, exist_ok=True)
    if os.environ.get("SPACE_ID"):
        scheduler = CommitScheduler(
            repo_id=DATASET_REPO,
            repo_type="dataset",
            folder_path=PARQUET_DIR,
            every=10,
        )


def flush_to_parquet():
    if table is None:
        return
    arrow_table = table.to_arrow()
    pq.write_table(arrow_table, PARQUET_DIR / "transcriptions.parquet")


def _match_mask(arrow_table: pa.Table, **filters: str):
    """Build a boolean mask matching ALL filters (AND)."""
    mask = None
    for column, value in filters.items():
        eq = pc.equal(arrow_table.column(column), value)
        mask = eq if mask is None else pc.and_(mask, eq)
    return mask


def _query(**filters: str) -> pa.Table:
    """Filter table rows by exact match on string columns."""
    all_rows = table.to_arrow()
    if len(all_rows) == 0:
        return all_rows
    return all_rows.filter(_match_mask(all_rows, **filters))


def _remove(**filters: str):
    """Remove rows matching all filters, rebuild table with the rest."""
    global table
    all_rows = table.to_arrow()
    if len(all_rows) == 0:
        return
    match = _match_mask(all_rows, **filters)
    kept = all_rows.filter(pc.invert(match))
    if len(kept) > 0:
        table = db.create_table(TABLE_NAME, kept, mode="overwrite")
    else:
        table = db.create_table(TABLE_NAME, schema=SCHEMA, mode="overwrite")


def _resolve_user(request: Request) -> str | None:
    """Extract username from HF OAuth Bearer token. Returns 'local' in dev mode."""
    if not os.environ.get("SPACE_ID"):
        return "local"
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth.removeprefix("Bearer ").strip()
    if not token:
        return None
    try:
        from huggingface_hub import HfApi

        api = HfApi(token=token)
        return api.whoami()["name"]
    except Exception:
        return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    init_scheduler()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Endpoints ---


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/transcriptions/{manifest_id}")
def get_transcriptions(manifest_id: str, request: Request):
    if table is None:
        raise HTTPException(503, "Database not initialized")

    username = _resolve_user(request)
    if username is None:
        raise HTTPException(401, "Login with Hugging Face required")

    rows = _query(manifest_id=manifest_id, contributor=username)
    if len(rows) == 0:
        return {"manifest_id": manifest_id, "groups": []}

    df = rows.to_pandas()

    groups = []
    for (page, gname), gdf in df.groupby(["page_number", "group_name"]):
        first = gdf.iloc[0]
        lines = []
        for _, row in gdf.sort_values("line_index").iterrows():
            lines.append({
                "line_index": int(row["line_index"]),
                "bbox": {
                    "x": float(row["bbox_x"]),
                    "y": float(row["bbox_y"]),
                    "w": float(row["bbox_w"]),
                    "h": float(row["bbox_h"]),
                },
                "text": row["text"],
                "confidence": float(row["confidence"]),
                "source": row["source"],
                "contributor": row["contributor"],
            })
        groups.append({
            "page_number": int(page),
            "group_name": gname,
            "group_rect": {
                "x": float(first["group_rect_x"]),
                "y": float(first["group_rect_y"]),
                "w": float(first["group_rect_w"]),
                "h": float(first["group_rect_h"]),
            },
            "lines": lines,
        })

    return {"manifest_id": manifest_id, "groups": groups}


@app.post("/transcriptions/{manifest_id}")
def contribute(manifest_id: str, body: ContributeRequest, request: Request):
    global table
    if table is None:
        raise HTTPException(503, "Database not initialized")

    username = _resolve_user(request)
    if username is None:
        raise HTTPException(401, "Login with Hugging Face required")

    now = datetime.now(timezone.utc)

    # Remove only this user's rows for this manifest, keep everyone else's
    before = table.count_rows()
    _remove(manifest_id=manifest_id, contributor=username)
    after = table.count_rows()
    print(f"POST {manifest_id} by {username}: {before} rows before, {after} after remove")

    new_rows = []
    for group in body.groups:
        for line in group.lines:
            line_id = f"{manifest_id}/{username}/{group.page_number}_{group.group_name}_{line.line_index}"
            new_rows.append({
                "id": line_id,
                "version": 1,
                "reference_code": body.reference_code,
                "manifest_id": manifest_id,
                "page_number": group.page_number,
                "group_name": group.group_name,
                "group_rect_x": group.group_rect.x,
                "group_rect_y": group.group_rect.y,
                "group_rect_w": group.group_rect.w,
                "group_rect_h": group.group_rect.h,
                "line_index": line.line_index,
                "bbox_x": line.bbox.x,
                "bbox_y": line.bbox.y,
                "bbox_w": line.bbox.w,
                "bbox_h": line.bbox.h,
                "text": line.text,
                "confidence": line.confidence,
                "source": line.source,
                "contributor": username,
                "created_at": now,
            })

    if new_rows:
        new_arrow = pa.Table.from_pylist(new_rows, schema=SCHEMA)
        all_rows = table.to_arrow()
        if len(all_rows) > 0:
            combined = pa.concat_tables([all_rows, new_arrow])
        else:
            combined = new_arrow
        table = db.create_table(TABLE_NAME, combined, mode="overwrite")

    final = table.count_rows()
    print(f"POST {manifest_id} by {username}: added {len(new_rows)}, total now {final}")

    flush_to_parquet()

    return {"status": "ok", "lines_added": len(new_rows), "contributor": username}


@app.delete("/transcriptions/{manifest_id}")
def delete_transcriptions(manifest_id: str, request: Request):
    if table is None:
        raise HTTPException(503, "Database not initialized")

    username = _resolve_user(request)
    if username is None:
        raise HTTPException(401, "Login with Hugging Face required")

    _remove(manifest_id=manifest_id, contributor=username)
    flush_to_parquet()

    return {"status": "ok", "manifest_id": manifest_id, "contributor": username}


@app.get("/transcriptions/{manifest_id}/history")
def get_history(manifest_id: str):
    if table is None:
        raise HTTPException(503, "Database not initialized")

    rows = _query(manifest_id=manifest_id)
    if len(rows) == 0:
        return {"manifest_id": manifest_id, "contributions": []}

    df = rows.to_pandas()
    contributions = (
        df.groupby(["contributor", "created_at"])
        .agg(lines=("id", "count"))
        .reset_index()
        .sort_values("created_at", ascending=False)
    )

    return {
        "manifest_id": manifest_id,
        "contributions": [
            {
                "contributor": r["contributor"],
                "created_at": r["created_at"].isoformat(),
                "lines": int(r["lines"]),
            }
            for _, r in contributions.iterrows()
        ],
    }
