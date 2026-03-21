import logging
import os
import tempfile
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path

import lancedb
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from huggingface_hub import CommitScheduler, hf_hub_download
from pydantic import BaseModel

logger = logging.getLogger(__name__)

DATASET_REPO = os.environ.get("DATASET_REPO", "lejonet/transcriptions")
TABLE_NAME = "transcriptions"
DB_PATH = os.environ.get("LANCEDB_PATH", str(Path(__file__).parents[2] / "data" / "lancedb"))
PARQUET_DIR = Path(os.environ.get("PARQUET_DIR", os.path.join(tempfile.gettempdir(), "parquet_export")))

SCHEMA = pa.schema(
    [
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
    ]
)

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
            logger.debug("No existing local table '%s', will create new", TABLE_NAME)

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
                "text",
                replace=True,
                base_tokenizer="ngram",
                ngram_min_length=2,
                prefix_only=True,
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
        logger.debug("FTS search failed for query '%s', falling back to metadata search", q)

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
    data = kept if len(kept) > 0 else pa.Table.from_pylist([], schema=SCHEMA)
    table = db.create_table(TABLE_NAME, data, mode="overwrite")


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
    from lejonet_backend.telemetry import setup_telemetry

    setup_telemetry()
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

# Prometheus metrics
try:
    from starlette_exporter import PrometheusMiddleware, handle_metrics

    app.add_middleware(PrometheusMiddleware, app_name="lejonet_backend", prefix="lejonet")
    app.add_route("/metrics", handle_metrics)
except ImportError:
    pass  # starlette_exporter not installed, skip metrics


# --- Endpoints ---


@app.get("/health")
def health():
    return {"status": "ok"}


# --- Debug: LanceDB viewer ---


@app.get("/debug/tables")
def debug_tables():
    """List all LanceDB tables with row counts and schemas."""
    if db is None:
        return {"tables": []}
    tables = []
    for name in db.table_names():
        t = db.open_table(name)
        schema = t.to_arrow().schema
        tables.append(
            {
                "name": name,
                "rows": t.count_rows(),
                "columns": [{"name": f.name, "type": str(f.type)} for f in schema],
            }
        )
    return {"tables": tables}


@app.get("/debug/tables/{table_name}")
def debug_browse(
    table_name: str,
    limit: int = 50,
    offset: int = 0,
    q: str | None = None,
    where: str | None = None,
    columns: str | None = None,
):
    """Browse a LanceDB table with optional FTS query, SQL where filter, and column selection."""
    if db is None:
        raise HTTPException(503, "Database not initialized")
    try:
        t = db.open_table(table_name)
    except Exception:
        raise HTTPException(404, f"Table '{table_name}' not found") from None

    # Select columns
    col_list = [c.strip() for c in columns.split(",")] if columns else None

    if q:
        # FTS search
        try:
            result = t.search(q, query_type="fts").limit(limit + offset).to_arrow()
        except Exception as e:
            raise HTTPException(400, f"FTS error: {e}") from None
    elif where:
        # SQL where filter
        try:
            result = t.search().where(where).limit(limit + offset).to_arrow()
        except Exception as e:
            raise HTTPException(400, f"Where error: {e}") from None
    else:
        result = t.to_arrow().slice(offset, limit)
        # For browse without query, just return the slice
        if col_list:
            available = [c for c in col_list if c in result.column_names]
            result = result.select(available) if available else result
        rows = []
        for i in range(len(result)):
            row = {}
            for col in result.column_names:
                val = result.column(col)[i].as_py()
                # Skip large fields
                if isinstance(val, (list, bytes)) and len(str(val)) > 200:
                    row[col] = f"[{type(val).__name__}, len={len(val)}]"
                else:
                    row[col] = val
            rows.append(row)
        return {
            "table": table_name,
            "total": t.count_rows(),
            "offset": offset,
            "limit": limit,
            "rows": rows,
        }

    # For query/where results, apply offset + limit
    total = len(result)
    result = result.slice(offset, limit)
    if col_list:
        available = [c for c in col_list if c in result.column_names]
        result = result.select(available) if available else result

    # Strip internal columns like _score, _rowid, _distance, vector
    skip = {"vector", "_score", "_rowid", "_distance"}
    rows = []
    for i in range(len(result)):
        row = {}
        for col in result.column_names:
            if col in skip:
                continue
            val = result.column(col)[i].as_py()
            if isinstance(val, (list, bytes)) and len(str(val)) > 200:
                row[col] = f"[{type(val).__name__}, len={len(val)}]"
            else:
                row[col] = val
        rows.append(row)
    return {
        "table": table_name,
        "total": total,
        "offset": offset,
        "limit": limit,
        "rows": rows,
    }


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
        manifests.append(
            {
                "manifest_id": mid,
                "reference_code": subset.column("reference_code")[0].as_py(),
                "lines": len(subset),
                "groups": len(pc.unique(subset.column("group_name")).to_pylist()),
                "pages": len(pc.unique(subset.column("page_number")).to_pylist()),
                "last_saved": pc.max(subset.column("created_at")).as_py().isoformat(),
            }
        )

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
            logger.debug("FTS search failed for manifest query '%s'", q)
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
            lines.append(
                {
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
                }
            )
        groups.append(
            {
                "page_number": page,
                "group_name": gname,
                "group_rect": {
                    "x": rows.column("group_rect_x")[first].as_py(),
                    "y": rows.column("group_rect_y")[first].as_py(),
                    "w": rows.column("group_rect_w")[first].as_py(),
                    "h": rows.column("group_rect_h")[first].as_py(),
                },
                "lines": lines,
            }
        )

    return {"manifest_id": manifest_id, "groups": groups}


@app.post("/transcriptions/{manifest_id}")
def contribute(manifest_id: str, body: ContributeRequest, request: Request):
    global table
    if table is None:
        raise HTTPException(503, "Database not initialized")

    username = _resolve_user(request)
    if username is None:
        raise HTTPException(401, "Login with Hugging Face required")

    now = datetime.now(UTC)

    # Remove only this user's rows for this manifest, keep everyone else's
    before = table.count_rows()
    _remove(manifest_id=manifest_id, contributor=username)
    after = table.count_rows()
    print(f"POST {manifest_id} by {username}: {before} rows before, {after} after remove")

    new_rows = []
    for group in body.groups:
        for line in group.lines:
            line_id = f"{manifest_id}/{username}/{group.page_number}_{group.group_name}_{line.line_index}"
            new_rows.append(
                {
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
                }
            )

    if new_rows:
        new_arrow = pa.Table.from_pylist(new_rows, schema=SCHEMA)
        all_rows = table.to_arrow()
        combined = pa.concat_tables([all_rows, new_arrow]) if len(all_rows) > 0 else new_arrow
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
    if catalog_table is None:
        return {"results": [], "total": 0}

    browse_total = None

    # Build pre-filter for search queries
    where_parts = []
    if digitized is not None:
        where_parts.append(f"digitized = {'true' if digitized else 'false'}")
        digitized = None  # skip re-applying below
    if archive:
        where_parts.append(f"archive_code = '{archive}'")
        archive = None
    if date_start is not None:
        where_parts.append(f"date_end >= {date_start}")
        date_start = None
    if date_end is not None:
        where_parts.append(f"date_start <= {date_end}")
        date_end = None
    pre_filter = " AND ".join(where_parts) if where_parts else None

    if q:
        # Fetch one extra to detect if there are more results
        fetch_limit = limit + offset + 1
        # Reference code lookup: contains "/" → use exact prefix match
        if "/" in q:
            ref_where = f"reference_code LIKE '{q}%'"
            if pre_filter:
                ref_where = f"{ref_where} AND {pre_filter}"
            try:
                results = catalog_table.search().where(ref_where).limit(fetch_limit).to_arrow()
            except Exception:
                results = catalog_table.to_arrow().slice(0, 0)
        elif mode == "vector":
            results = _catalog_vector_search(q, fetch_limit, pre_filter)
        elif mode == "hybrid":
            results = _catalog_hybrid_search(q, fetch_limit, pre_filter)
        else:
            results = _catalog_fts_search(q, fetch_limit, pre_filter)
    else:
        # No query — browse mode, need at least one filter
        if not pre_filter:
            raise HTTPException(400, "Query or filter required")
        browse_total = catalog_table.count_rows(pre_filter)
        results = catalog_table.search().where(pre_filter).limit(limit + offset).to_arrow()

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

    if browse_total is not None:
        total = browse_total
    else:
        # For search queries: if we got more than limit+offset, signal "more available"
        has_more = len(results) > limit + offset
        total = offset + limit + (1 if has_more else 0)
    results = results.slice(offset, limit)

    return {
        "results": [
            {
                "reference_code": results.column("reference_code")[i].as_py(),
                "archive_code": results.column("archive_code")[i].as_py(),
                "fonds_title": results.column("fonds_title")[i].as_py(),
                "fonds_description": results.column("fonds_description")[i].as_py(),
                "creator": results.column("creator")[i].as_py(),
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


@app.get("/catalog/random")
def catalog_random():
    """Return a random digitized volume."""
    import random

    if catalog_table is None:
        raise HTTPException(503, "Catalog not loaded")

    total = catalog_table.count_rows("digitized = true")
    if total == 0:
        raise HTTPException(404, "No digitized volumes found")

    offset = random.randrange(total)  # noqa: S311 — not security-sensitive, just picking a random catalog entry
    results = catalog_table.search().where("digitized = true").limit(1).offset(offset).to_arrow()
    if len(results) == 0:
        raise HTTPException(404, "No digitized volumes found")

    return {
        "reference_code": results.column("reference_code")[0].as_py(),
        "archive_code": results.column("archive_code")[0].as_py(),
        "fonds_title": results.column("fonds_title")[0].as_py(),
        "series_title": results.column("series_title")[0].as_py(),
        "volume_id": results.column("volume_id")[0].as_py(),
        "date_text": results.column("date_text")[0].as_py(),
        "description": results.column("description")[0].as_py(),
    }


def _catalog_fts_search(q: str, limit: int, where: str | None = None) -> pa.Table:
    try:
        s = catalog_table.search(q, query_type="fts")
        if where:
            s = s.where(where)
        return s.limit(limit).to_arrow()
    except Exception as e:
        print(f"FTS search failed for '{q}': {e}")
        return catalog_table.to_arrow().slice(0, 0)  # empty with correct schema


GPU_SERVER = os.environ.get("GPU_SERVER", "http://localhost:8080")


def _embed_query_via_gpu(q: str) -> list[float] | None:
    """Call GPU server /embed endpoint for query embedding."""
    import httpx

    try:
        resp = httpx.post(f"{GPU_SERVER}/embed", json={"texts": [q], "mode": "query"}, timeout=30)
        resp.raise_for_status()
        return resp.json()["vectors"][0]
    except Exception as e:
        print(f"GPU embed failed: {e}")
        return None


def _catalog_vector_search(q: str, limit: int, where: str | None = None) -> pa.Table:
    try:
        # Try GPU server first
        vec = _embed_query_via_gpu(q)
        if vec is None:
            # Fall back to local model
            from lejonet_backend.ingest_catalog import create_embedder, embed_query

            if not hasattr(_catalog_vector_search, "_embedder"):
                _catalog_vector_search._embedder = create_embedder()
            vec = embed_query(_catalog_vector_search._embedder, q)
        s = catalog_table.search(vec)
        if where:
            s = s.where(where)
        return s.limit(limit).to_arrow()
    except Exception:
        return catalog_table.to_arrow().slice(0, 0)


def _catalog_hybrid_search(q: str, limit: int, where: str | None = None) -> pa.Table:
    fts = _catalog_fts_search(q, limit, where)
    try:
        vec = _catalog_vector_search(q, limit, where)
    except Exception:
        return fts
    if len(fts) == 0:
        return vec
    if len(vec) == 0:
        return fts
    # Merge: vector results first, deduplicate
    vec_ids = set(vec.column("id").to_pylist())
    fts_only_indices = [i for i in range(len(fts)) if fts.column("id")[i].as_py() not in vec_ids]
    if fts_only_indices:
        # Select only shared columns to avoid schema mismatch
        shared = [c for c in vec.column_names if c in fts.column_names and not c.startswith("_")]
        vec_clean = vec.select(shared)
        fts_extra = fts.select(shared).take(fts_only_indices)
        return pa.concat_tables([vec_clean, fts_extra])
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

    contributions = [{"contributor": k[0], "created_at": k[1].isoformat(), "lines": count} for k, count in seen.items()]
    contributions.sort(key=lambda c: c["created_at"], reverse=True)

    return {"manifest_id": manifest_id, "contributions": contributions}
