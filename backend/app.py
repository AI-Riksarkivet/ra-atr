import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import lancedb
import pyarrow as pa
import pyarrow.parquet as pq
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from huggingface_hub import hf_hub_download

DATASET_REPO = os.environ.get("DATASET_REPO", "lejonet/transcriptions")
TABLE_NAME = "transcriptions"
DB_PATH = "/tmp/lancedb"

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


def init_db():
    global db, table
    db = lancedb.connect(DB_PATH)

    # Try loading from HF Dataset repo
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/transcriptions/{manifest_id}")
def get_transcriptions(manifest_id: str):
    if table is None:
        raise HTTPException(503, "Database not initialized")

    rows = table.search().where(
        f"manifest_id = '{manifest_id.replace(chr(39), '')}'",
        prefilter=True,
    ).to_arrow()
    if len(rows) == 0:
        return {"manifest_id": manifest_id, "groups": []}

    df = rows.to_pandas()

    # Keep only latest version per id
    latest = df.loc[df.groupby("id")["version"].idxmax()]

    # Group by page + group_name
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
