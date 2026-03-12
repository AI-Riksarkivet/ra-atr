import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import lancedb
import pyarrow as pa
import pyarrow.parquet as pq
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from huggingface_hub import CommitScheduler, hf_hub_download
from pydantic import BaseModel

DATASET_REPO = os.environ.get("DATASET_REPO", "lejonet/transcriptions")
TABLE_NAME = "transcriptions"
DB_PATH = "/tmp/lancedb"
PARQUET_DIR = Path("/tmp/parquet_export")

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
    pa.field("created_at", pa.timestamp("ms")),
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


def _sanitize(value: str) -> str:
    """Strip single quotes to prevent injection in LanceDB where clauses."""
    return value.replace("'", "")


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
def get_transcriptions(manifest_id: str):
    if table is None:
        raise HTTPException(503, "Database not initialized")

    safe_id = _sanitize(manifest_id)
    rows = table.search().where(
        f"manifest_id = '{safe_id}'", prefilter=True
    ).to_arrow()
    if len(rows) == 0:
        return {"manifest_id": manifest_id, "groups": []}

    df = rows.to_pandas()
    latest = df.loc[df.groupby("id")["version"].idxmax()]

    groups = []
    for (page, gname), gdf in latest.groupby(["page_number", "group_name"]):
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
    if table is None:
        raise HTTPException(503, "Database not initialized")

    # Check for HF OAuth token
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Login with Hugging Face required")

    token = auth.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(401, "Login with Hugging Face required")

    # Resolve username from HF token
    try:
        from huggingface_hub import HfApi

        api = HfApi(token=token)
        username = api.whoami()["name"]
    except Exception:
        raise HTTPException(401, "Invalid Hugging Face token")

    now = datetime.now(timezone.utc)

    new_rows = []
    for group in body.groups:
        for line in group.lines:
            line_id = f"{manifest_id}/{group.page_number}_{group.group_name}_{line.line_index}"
            safe_line_id = _sanitize(line_id)

            # Get current max version for this id
            existing = table.search().where(
                f"id = '{safe_line_id}'", prefilter=True
            ).to_arrow()
            max_version = 0
            if len(existing) > 0:
                versions = existing.column("version").to_pylist()
                max_version = max(versions) if versions else 0

            new_rows.append({
                "id": line_id,
                "version": max_version + 1,
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
        table.add(new_rows)
        flush_to_parquet()

    return {"status": "ok", "lines_added": len(new_rows), "contributor": username}


@app.get("/transcriptions/{manifest_id}/history")
def get_history(manifest_id: str):
    if table is None:
        raise HTTPException(503, "Database not initialized")

    safe_id = _sanitize(manifest_id)
    rows = table.search().where(
        f"manifest_id = '{safe_id}'", prefilter=True
    ).to_arrow()
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
