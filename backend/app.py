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
catalog_table = None
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


def _rebuild_fts():
    """Rebuild ngram prefix index on the text column for substring search."""
    try:
        if table is not None and table.count_rows() > 0:
            table.create_fts_index(
                "text", replace=True,
                base_tokenizer="ngram", ngram_min_length=2, prefix_only=True,
            )
    except Exception as e:
        print(f"FTS index build skipped: {e}")


def _search_fts(q: str, contributor: str) -> pa.Table:
    """Search using FTS on text + pyarrow substring match on metadata columns."""
    all_rows = _query(contributor=contributor)
    if len(all_rows) == 0:
        return all_rows

    # FTS on text column
    fts_ids: set[str] = set()
    try:
        fts_results = table.search(q, query_type="fts").limit(10000).to_arrow()
        if len(fts_results) > 0:
            fts_ids = set(fts_results.column("id").to_pylist())
    except Exception:
        pass

    # Substring match on metadata columns via pyarrow
    q_lower = q.lower()
    mid_match = pc.match_substring(pc.utf8_lower(all_rows.column("manifest_id")), q_lower)
    ref_match = pc.match_substring(pc.utf8_lower(all_rows.column("reference_code")), q_lower)
    grp_match = pc.match_substring(pc.utf8_lower(all_rows.column("group_name")), q_lower)

    col_mask = pc.or_(pc.or_(mid_match, ref_match), grp_match)
    col_hits = all_rows.filter(col_mask)

    # Merge: FTS hits + column hits
    if fts_ids:
        id_match = pc.is_in(all_rows.column("id"), pa.array(list(fts_ids)))
        combined_mask = pc.or_(col_mask, id_match)
        return all_rows.filter(combined_mask)

    return col_hits


def init_catalog():
    global catalog_table
    try:
        catalog_table = db.open_table("archive_catalog")
        print(f"Catalog table: {catalog_table.count_rows()} rows")
    except Exception:
        print("No catalog table found — run ingest_catalog.py first")


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
    _rebuild_fts()
    init_catalog()

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


@app.get("/transcriptions")
def list_transcriptions(request: Request, q: str | None = None):
    """List all manifests for the current user, optionally filtered by search query."""
    if table is None:
        raise HTTPException(503, "Database not initialized")

    username = _resolve_user(request)
    if username is None:
        raise HTTPException(401, "Login with Hugging Face required")

    rows = _search_fts(q, username) if q else _query(contributor=username)
    if len(rows) == 0:
        return {"manifests": []}

    # Group by manifest_id using pyarrow
    manifest_ids = rows.column("manifest_id")
    unique_mids = pc.unique(manifest_ids).to_pylist()

    manifests = []
    for mid in unique_mids:
        mask = pc.equal(manifest_ids, mid)
        subset = rows.filter(mask)
        manifests.append({
            "manifest_id": mid,
            "reference_code": subset.column("reference_code")[0].as_py(),
            "lines": len(subset),
            "groups": len(pc.unique(subset.column("group_name")).to_pylist()),
            "pages": len(pc.unique(subset.column("page_number")).to_pylist()),
            "last_saved": pc.max(subset.column("created_at")).as_py().isoformat(),
        })

    manifests.sort(key=lambda m: m["last_saved"], reverse=True)
    return {"manifests": manifests}


@app.get("/transcriptions/{manifest_id}")
def get_transcriptions(manifest_id: str, request: Request, q: str | None = None):
    if table is None:
        raise HTTPException(503, "Database not initialized")

    username = _resolve_user(request)
    if username is None:
        raise HTTPException(401, "Login with Hugging Face required")

    if q:
        # Filter: FTS on text + substring on metadata, scoped to this manifest & user
        all_user = _query(manifest_id=manifest_id, contributor=username)
        if len(all_user) == 0:
            return {"manifest_id": manifest_id, "groups": []}
        # FTS hits
        fts_ids: set[str] = set()
        try:
            fts_results = table.search(q, query_type="fts").limit(10000).to_arrow()
            if len(fts_results) > 0:
                fts_ids = set(fts_results.column("id").to_pylist())
        except Exception:
            pass
        # Substring on metadata
        q_lower = q.lower()
        grp_match = pc.match_substring(pc.utf8_lower(all_user.column("group_name")), q_lower)
        txt_match = pc.match_substring(pc.utf8_lower(all_user.column("text")), q_lower)
        col_mask = pc.or_(grp_match, txt_match)
        if fts_ids:
            id_match = pc.is_in(all_user.column("id"), pa.array(list(fts_ids)))
            rows = all_user.filter(pc.or_(col_mask, id_match))
        else:
            rows = all_user.filter(col_mask)
    else:
        rows = _query(manifest_id=manifest_id, contributor=username)

    if len(rows) == 0:
        return {"manifest_id": manifest_id, "groups": []}

    # Group by (page_number, group_name) using pyarrow
    pages = rows.column("page_number")
    gnames = rows.column("group_name")
    # Build unique (page, group) pairs
    seen: dict[tuple, list[int]] = {}
    for i in range(len(rows)):
        key = (pages[i].as_py(), gnames[i].as_py())
        seen.setdefault(key, []).append(i)

    groups = []
    for (page, gname), indices in seen.items():
        # Sort by line_index
        indices.sort(key=lambda i: rows.column("line_index")[i].as_py())
        first = indices[0]
        lines = []
        for i in indices:
            lines.append({
                "line_index": rows.column("line_index")[i].as_py(),
                "bbox": {
                    "x": rows.column("bbox_x")[i].as_py(),
                    "y": rows.column("bbox_y")[i].as_py(),
                    "w": rows.column("bbox_w")[i].as_py(),
                    "h": rows.column("bbox_h")[i].as_py(),
                },
                "text": rows.column("text")[i].as_py(),
                "confidence": rows.column("confidence")[i].as_py(),
                "source": rows.column("source")[i].as_py(),
                "contributor": rows.column("contributor")[i].as_py(),
            })
        groups.append({
            "page_number": page,
            "group_name": gname,
            "group_rect": {
                "x": rows.column("group_rect_x")[first].as_py(),
                "y": rows.column("group_rect_y")[first].as_py(),
                "w": rows.column("group_rect_w")[first].as_py(),
                "h": rows.column("group_rect_h")[first].as_py(),
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
    _rebuild_fts()

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
    _rebuild_fts()

    return {"status": "ok", "manifest_id": manifest_id, "contributor": username}


@app.get("/catalog/search")
def catalog_search(
    q: str = "",
    digitized: bool | None = None,
    date_start: int | None = None,
    date_end: int | None = None,
    archive: str | None = None,
    mode: str = "fts",
    limit: int = 50,
    offset: int = 0,
):
    if not q:
        raise HTTPException(400, "Query required")

    if catalog_table is None:
        # No catalog loaded — return empty results (not an error)
        return {"results": [], "total": 0}

    if mode == "vector":
        results = _catalog_vector_search(q, limit + offset)
    elif mode == "hybrid":
        results = _catalog_hybrid_search(q, limit + offset)
    else:
        results = _catalog_fts_search(q, limit + offset)

    # Apply filters with pyarrow
    if len(results) > 0 and digitized is not None:
        mask = pc.equal(results.column("digitized"), digitized)
        results = results.filter(mask)
    if len(results) > 0 and date_start is not None:
        not_null = pc.is_valid(results.column("date_end"))
        gte = pc.greater_equal(results.column("date_end"), date_start)
        results = results.filter(pc.and_(not_null, gte))
    if len(results) > 0 and date_end is not None:
        not_null = pc.is_valid(results.column("date_start"))
        lte = pc.less_equal(results.column("date_start"), date_end)
        results = results.filter(pc.and_(not_null, lte))
    if len(results) > 0 and archive:
        mask = pc.equal(results.column("archive_code"), archive)
        results = results.filter(mask)

    total = len(results)
    results = results.slice(offset, limit)

    return {
        "results": [
            {
                "reference_code": results.column("reference_code")[i].as_py(),
                "fonds_title": results.column("fonds_title")[i].as_py(),
                "series_title": results.column("series_title")[i].as_py(),
                "volume_id": results.column("volume_id")[i].as_py(),
                "date_text": results.column("date_text")[i].as_py(),
                "description": results.column("description")[i].as_py(),
                "digitized": results.column("digitized")[i].as_py(),
            }
            for i in range(len(results))
        ],
        "total": total,
    }


def _catalog_fts_search(q: str, limit: int) -> pa.Table:
    try:
        return catalog_table.search(q, query_type="fts").limit(limit).to_arrow()
    except Exception:
        return catalog_table.to_arrow().slice(0, 0)  # empty with correct schema


def _catalog_vector_search(q: str, limit: int) -> pa.Table:
    try:
        from ingest_catalog import create_embedder, embed_batch
        # Lazy-load embedder
        if not hasattr(_catalog_vector_search, "_embedder"):
            _catalog_vector_search._embedder = create_embedder()
        vec = embed_batch(_catalog_vector_search._embedder, [q])[0]
        return catalog_table.search(vec).limit(limit).to_arrow()
    except Exception:
        return catalog_table.to_arrow().slice(0, 0)


def _catalog_hybrid_search(q: str, limit: int) -> pa.Table:
    fts = _catalog_fts_search(q, limit)
    vec = _catalog_vector_search(q, limit)
    if len(fts) == 0:
        return vec
    if len(vec) == 0:
        return fts
    vec_ids = set(vec.column("id").to_pylist())
    fts_only_mask = pc.invert(pc.is_in(fts.column("id"), pa.array(list(vec_ids))))
    fts_only = fts.filter(fts_only_mask)
    if len(fts_only) > 0:
        return pa.concat_tables([vec, fts_only])
    return vec


@app.get("/transcriptions/{manifest_id}/history")
def get_history(manifest_id: str):
    if table is None:
        raise HTTPException(503, "Database not initialized")

    rows = _query(manifest_id=manifest_id)
    if len(rows) == 0:
        return {"manifest_id": manifest_id, "contributions": []}

    # Group by (contributor, created_at) using pyarrow
    contributors = rows.column("contributor")
    timestamps = rows.column("created_at")
    seen: dict[tuple, int] = {}
    for i in range(len(rows)):
        key = (contributors[i].as_py(), timestamps[i].as_py())
        seen[key] = seen.get(key, 0) + 1

    contributions = [
        {"contributor": k[0], "created_at": k[1].isoformat(), "lines": count}
        for k, count in seen.items()
    ]
    contributions.sort(key=lambda c: c["created_at"], reverse=True)

    return {"manifest_id": manifest_id, "contributions": contributions}
