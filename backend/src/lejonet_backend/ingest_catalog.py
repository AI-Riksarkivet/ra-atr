"""Parse Riksarkivet EAD XML metadata and ingest into LanceDB."""

import os
import re
import xml.etree.ElementTree as ET

import lancedb
import pyarrow as pa

CATALOG_TABLE = "archive_catalog"
EMBED_MODEL = "Snowflake/snowflake-arctic-embed-l-v2.0"
EMBED_DIM = 256  # Matryoshka truncation: 1024 → 256 (smaller than e5-small, better quality)

CATALOG_SCHEMA = pa.schema(
    [
        pa.field("id", pa.string()),
        pa.field("reference_code", pa.string()),
        pa.field("archive_code", pa.string()),
        pa.field("fonds_id", pa.string()),
        pa.field("fonds_title", pa.string()),
        pa.field("fonds_description", pa.string()),
        pa.field("creator", pa.string()),
        pa.field("series_id", pa.string()),
        pa.field("series_title", pa.string()),
        pa.field("volume_id", pa.string()),
        pa.field("date_text", pa.string()),
        pa.field("date_start", pa.int32()),
        pa.field("date_end", pa.int32()),
        pa.field("description", pa.string()),
        pa.field("digitized", pa.bool_()),
        pa.field("search_text", pa.string()),
        pa.field("vector", pa.list_(pa.float32(), EMBED_DIM)),
    ]
)

NS = "http://xml.ra.se/EAD"


def _tag(name: str) -> str:
    return f"{{{NS}}}{name}"


def _text(el, path: str) -> str:
    """Extract text from a sub-element, or empty string."""
    child = el.find(path)
    return (child.text or "").strip() if child is not None else ""


def parse_date_range(text: str | None) -> tuple[int | None, int | None]:
    """Extract (start_year, end_year) from Swedish date strings."""
    if not text:
        return (None, None)
    years = [int(y) for y in re.findall(r"(\d{4})", text)]
    if not years:
        return (None, None)
    return (min(years), max(years))


def parse_ead_file(path: str) -> list[dict]:
    """Parse one EAD XML file, return list of volume dicts."""
    tree = ET.parse(path)
    root = tree.getroot()

    # Fonds-level metadata
    eadid_el = root.find(f".//{_tag('eadid')}")
    eadid = eadid_el.text.strip() if eadid_el is not None and eadid_el.text else ""

    fonds_did = root.find(f".//{_tag('archdesc')}/{_tag('did')}")
    if fonds_did is None:
        return []

    fonds_uid_el = fonds_did.find(_tag("unitid"))
    fonds_uid = (fonds_uid_el.text or "").strip() if fonds_uid_el is not None else ""
    country = fonds_uid_el.get("countrycode", "") if fonds_uid_el is not None else ""
    repo = fonds_uid_el.get("repositorycode", "") if fonds_uid_el is not None else ""
    archive_code = f"{country}_{repo}" if country and repo else ""

    fonds_title = _text(fonds_did, _tag("unittitle"))

    # Fonds description: concatenate all <odd>/<p> at archdesc level
    archdesc = root.find(f".//{_tag('archdesc')}")
    fonds_desc_parts = []
    if archdesc is not None:
        for odd in archdesc.findall(_tag("odd")):
            for p in odd.findall(_tag("p")):
                if p.text:
                    fonds_desc_parts.append(p.text.strip())
    fonds_description = " ".join(fonds_desc_parts)

    # Creator
    creator_el = root.find(f".//{_tag('origination')}/{_tag('corpname')}")
    creator = (creator_el.text or "").strip() if creator_el is not None else ""

    # Walk series -> volumes
    rows = []
    dsc = root.find(f".//{_tag('dsc')}")
    if dsc is None:
        return []

    for series_el in dsc:
        if series_el.tag != _tag("c"):
            continue
        s_did = series_el.find(_tag("did"))
        series_id = _text(s_did, _tag("unitid")) if s_did is not None else ""
        series_title = _text(s_did, _tag("unittitle")) if s_did is not None else ""

        for vol_el in series_el:
            if vol_el.tag != _tag("c"):
                continue
            if vol_el.get("otherlevel") != "volym":
                continue

            v_did = vol_el.find(_tag("did"))
            if v_did is None:
                continue

            vol_id = _text(v_did, _tag("unitid"))
            date_text = _text(v_did, _tag("unitdate"))
            date_start, date_end = parse_date_range(date_text)

            # Volume description
            vol_desc_parts = []
            for odd in vol_el.findall(_tag("odd")):
                for p in odd.findall(_tag("p")):
                    if p.text:
                        vol_desc_parts.append(p.text.strip())
            description = " ".join(vol_desc_parts)

            # Digitized flag
            digitized = any(ur.get("type") == "dao" for ur in vol_el.findall(_tag("userestrict")))

            ref_code = "/".join(part for part in [country, repo, fonds_uid, series_id, vol_id] if part)
            row_id = f"{eadid}/{series_id}/{vol_id}"

            search_text = " ".join(
                part
                for part in [
                    fonds_title,
                    fonds_description,
                    series_title,
                    description,
                    creator,
                    ref_code,
                    vol_id,
                    date_text,
                ]
                if part
            )

            rows.append(
                {
                    "id": row_id,
                    "reference_code": ref_code,
                    "archive_code": archive_code,
                    "fonds_id": fonds_uid,
                    "fonds_title": fonds_title,
                    "fonds_description": fonds_description,
                    "creator": creator,
                    "series_id": series_id,
                    "series_title": series_title,
                    "volume_id": vol_id,
                    "date_text": date_text,
                    "date_start": date_start,
                    "date_end": date_end,
                    "description": description,
                    "digitized": digitized,
                    "search_text": search_text,
                }
            )

    return rows


def walk_archive_dir(directory: str, limit: int | None = None):
    """Yield volume dicts from all XML files in a directory."""
    count = 0
    for fname in sorted(os.listdir(directory)):
        if not fname.endswith(".xml"):
            continue
        if limit is not None and count >= limit:
            break
        try:
            rows = parse_ead_file(os.path.join(directory, fname))
            for row in rows:
                yield row
            count += 1
        except ET.ParseError as e:
            print(f"Skipping {fname}: {e}")


def create_embedder():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(EMBED_MODEL, truncate_dim=EMBED_DIM)


def embed_documents(embedder, texts: list[str], batch_size: int = 64) -> list[list[float]]:
    """Embed documents (no prefix for Arctic). Sub-batches to limit memory."""
    all_vecs = []
    for i in range(0, len(texts), batch_size):
        sub = texts[i : i + batch_size]
        vecs = embedder.encode(sub, normalize_embeddings=True, show_progress_bar=False)
        all_vecs.extend(v.tolist() for v in vecs)
    return all_vecs


def embed_query(embedder, query: str) -> list[float]:
    """Embed a search query (Arctic requires 'query: ' prefix)."""
    vec = embedder.encode(f"query: {query}", normalize_embeddings=True)
    return vec.tolist()


def embed_documents_remote(texts: list[str], gpu_server: str, batch_size: int = 1024) -> list[list[float]]:
    """Embed documents via GPU server /embed endpoint with retries."""
    import time

    import httpx

    all_vecs = []
    for i in range(0, len(texts), batch_size):
        sub = texts[i : i + batch_size]
        # Truncate — model max is ~512 tokens, ~4 chars/token
        sub = [t[:500] for t in sub]
        for attempt in range(10):
            try:
                resp = httpx.post(f"{gpu_server}/embed", json={"texts": sub, "mode": "document"}, timeout=300)
                resp.raise_for_status()
                all_vecs.extend(resp.json()["vectors"])
                break
            except (httpx.HTTPStatusError, httpx.ConnectError, httpx.ReadTimeout) as e:
                if isinstance(e, httpx.HTTPStatusError):
                    print(f"  Response body: {e.response.text[:500]}")
                if attempt < 9:
                    wait = min(2 ** attempt, 60)
                    print(f"  Embed request failed ({e}), retrying in {wait}s... (attempt {attempt + 1}/10)")
                    time.sleep(wait)
                else:
                    raise
    return all_vecs


def ingest_rows(
    rows: list[dict],
    db_path: str,
    batch_size: int = 10_000,
    embed: bool = True,
) -> dict:
    """Write rows to LanceDB archive_catalog table in batches."""
    db = lancedb.connect(db_path)
    embedder = create_embedder() if embed else None

    written = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]

        if embedder:
            vectors = embed_documents(embedder, [r["search_text"] for r in batch])
            for row, vec in zip(batch, vectors):
                row["vector"] = vec
        else:
            for row in batch:
                row["vector"] = [0.0] * EMBED_DIM

        arrow_batch = pa.Table.from_pylist(batch, schema=CATALOG_SCHEMA)

        if written == 0:
            table = db.create_table(CATALOG_TABLE, arrow_batch, mode="overwrite")
        else:
            table = db.open_table(CATALOG_TABLE)
            table.add(arrow_batch)

        written += len(batch)
        print(f"  Written {written} rows...")

    return {"rows_written": written}


def build_fts_index(db_path: str):
    """Build FTS word-level index on search_text column."""
    db = lancedb.connect(db_path)
    table = db.open_table(CATALOG_TABLE)
    try:
        table.create_fts_index(
            "search_text",
            replace=True,
        )
        print(f"FTS index built on {table.count_rows()} rows")
    except Exception as e:
        print(f"FTS index failed: {e}")


def _stream_all_dirs(data_dir: str, sample: int | None = None):
    """Yield volume dicts from all archive subdirectories, streaming."""
    for archive_dir in sorted(os.listdir(data_dir)):
        full_path = os.path.join(data_dir, archive_dir)
        if not os.path.isdir(full_path):
            continue
        yield from walk_archive_dir(full_path, limit=sample)


def ingest_streaming(
    rows_iter,
    db_path: str,
    batch_size: int = 10_000,
    embed: bool = True,
    gpu_server: str | None = None,
) -> int:
    """Stream rows into LanceDB in fixed-size batches. Memory-efficient."""
    db = lancedb.connect(db_path)
    embedder = create_embedder() if embed and not gpu_server else None
    written = 0
    batch: list[dict] = []

    def flush(batch: list[dict], first: bool) -> None:
        nonlocal written
        if gpu_server:
            vectors = embed_documents_remote([r["search_text"] for r in batch], gpu_server)
            for row, vec in zip(batch, vectors):
                row["vector"] = vec
        elif embedder:
            vectors = embed_documents(embedder, [r["search_text"] for r in batch])
            for row, vec in zip(batch, vectors):
                row["vector"] = vec
        else:
            for row in batch:
                row["vector"] = [0.0] * EMBED_DIM
        arrow_batch = pa.Table.from_pylist(batch, schema=CATALOG_SCHEMA)
        if first:
            db.create_table(CATALOG_TABLE, arrow_batch, mode="overwrite")
        else:
            db.open_table(CATALOG_TABLE).add(arrow_batch)
        written += len(batch)
        print(f"  Written {written} rows...")

    for row in rows_iter:
        batch.append(row)
        if len(batch) >= batch_size:
            flush(batch, first=(written == 0))
            batch = []

    if batch:
        flush(batch, first=(written == 0))

    return written


def main():
    import argparse
    import time

    parser = argparse.ArgumentParser(description="Ingest Riksarkivet EAD metadata into LanceDB")
    parser.add_argument("data_dir", help="Path to Riksarkivet-2022-12-16 directory")
    default_db = os.path.join(os.path.dirname(__file__), "..", "..", "data", "lancedb")
    parser.add_argument("--db-path", default=default_db, help="LanceDB directory")
    parser.add_argument("--sample", type=int, default=0, help="Only process N files per archive (0=all)")
    parser.add_argument("--batch-size", type=int, default=10_000)
    parser.add_argument("--no-embed", action="store_true", help="Skip embedding (for testing)")
    parser.add_argument("--gpu-server", type=str, default=None, help="GPU server URL for remote embedding (e.g. http://localhost:8080)")
    args = parser.parse_args()

    t0 = time.time()
    sample = args.sample or None

    print("Streaming parse + ingest...")
    rows_iter = _stream_all_dirs(args.data_dir, sample=sample)
    written = ingest_streaming(
        rows_iter,
        args.db_path,
        batch_size=args.batch_size,
        embed=not args.no_embed,
        gpu_server=args.gpu_server,
    )
    print(f"Wrote {written} rows to {args.db_path} in {time.time() - t0:.1f}s")

    if written == 0:
        print("No volumes found, exiting.")
        return

    print("Building FTS index...")
    build_fts_index(args.db_path)

    print(f"Done in {time.time() - t0:.1f}s total")


if __name__ == "__main__":
    main()
