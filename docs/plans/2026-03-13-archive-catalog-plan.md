# Archive Catalog Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Index 7.6M Riksarkivet volume records into LanceDB with FTS and vector search so users can discover volumes to transcribe.

**Architecture:** One-time Python ingestion script parses 44K EAD XML files, extracts volume-level metadata, embeds text with sentence-transformers, writes to a new `archive_catalog` LanceDB table. FastAPI endpoints expose search (FTS, vector, hybrid). Frontend adds a catalog search UI.

**Tech Stack:** Python, xml.etree.ElementTree, sentence-transformers (`intfloat/multilingual-e5-small`), LanceDB, FastAPI, Svelte 5.

---

### Task 1: XML Parser — Single File

**Files:**
- Create: `backend/ingest_catalog.py`
- Create: `backend/test_ingest_catalog.py`

**Step 1: Write the failing test**

```python
# backend/test_ingest_catalog.py
import os
import pytest

DATA_DIR = os.environ.get(
    "RIKSARKIVET_DATA", "/home/m/Downloads/Riksarkivet-2022-12-16"
)
SAMPLE_FILE = os.path.join(DATA_DIR, "SE_RA", "SE_RA_1111.xml")


def test_parse_single_file_returns_volumes():
    from ingest_catalog import parse_ead_file

    rows = parse_ead_file(SAMPLE_FILE)
    assert len(rows) > 100  # SE_RA_1111 has 232 volumes

    row = rows[0]
    # Required fields present
    for key in [
        "id", "reference_code", "archive_code", "fonds_id", "fonds_title",
        "creator", "series_id", "series_title", "volume_id",
        "date_text", "date_start", "date_end", "description",
        "digitized", "search_text",
    ]:
        assert key in row, f"Missing key: {key}"

    # Reference code format
    assert row["reference_code"].startswith("SE/RA/1111/")
    assert row["archive_code"] == "SE_RA"
    assert row["fonds_id"] == "1111"
    assert row["fonds_title"] == "Det odelade kansliet. Rådsprotokoll"
    assert isinstance(row["digitized"], bool)
    assert isinstance(row["date_start"], (int, type(None)))
    assert isinstance(row["date_end"], (int, type(None)))
    assert row["search_text"]  # non-empty


def test_parse_file_with_dao_markers():
    """SE_RA_1111 has 132 userestrict type=dao markers."""
    from ingest_catalog import parse_ead_file

    rows = parse_ead_file(SAMPLE_FILE)
    digitized = [r for r in rows if r["digitized"]]
    assert len(digitized) > 50  # should be ~132


def test_parse_date_range():
    from ingest_catalog import parse_date_range

    assert parse_date_range("1621--1723") == (1621, 1723)
    assert parse_date_range("1621,1622, 1624, 1626--1628") == (1621, 1628)
    assert parse_date_range("1500-talet") == (1500, 1500)
    assert parse_date_range("1300-talets början--1400-talets slut") == (1300, 1400)
    assert parse_date_range(None) == (None, None)
    assert parse_date_range("") == (None, None)
```

**Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest test_ingest_catalog.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ingest_catalog'`

**Step 3: Write minimal implementation**

```python
# backend/ingest_catalog.py
"""Parse Riksarkivet EAD XML metadata and ingest into LanceDB."""

import os
import re
import xml.etree.ElementTree as ET

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

    # Walk series → volumes
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
            digitized = any(
                ur.get("type") == "dao"
                for ur in vol_el.findall(_tag("userestrict"))
            )

            ref_code = "/".join(
                part for part in [country, repo, fonds_uid, series_id, vol_id] if part
            )
            row_id = f"{eadid}/{series_id}/{vol_id}"

            search_text = " ".join(
                part for part in [fonds_title, series_title, description, creator] if part
            )

            rows.append({
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
            })

    return rows
```

**Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/python -m pytest test_ingest_catalog.py -v`
Expected: 3 PASS

**Step 5: Commit**

```bash
git add backend/ingest_catalog.py backend/test_ingest_catalog.py
git commit -m "feat: EAD XML parser for archive catalog ingestion"
```

---

### Task 2: Multi-File Parser — Cross-Archive Consistency

**Files:**
- Modify: `backend/test_ingest_catalog.py`
- Modify: `backend/ingest_catalog.py`

**Step 1: Write the failing test**

```python
# Add to backend/test_ingest_catalog.py

SAMPLE_FILES = [
    os.path.join(DATA_DIR, "SE_RA", "SE_RA_1111.xml"),
    os.path.join(DATA_DIR, "SE_LLA", "SE_LLA_10001.xml"),
    os.path.join(DATA_DIR, "SE_KrA", "SE_KrA_0001.xml"),
    os.path.join(DATA_DIR, "SE_GLA", "SE_GLA_10001.xml"),
    os.path.join(DATA_DIR, "SE_ViLA", "SE_ViLA_10008.xml"),
]


def test_parse_multiple_archives():
    """Parser handles different archive structures consistently."""
    from ingest_catalog import parse_ead_file

    for path in SAMPLE_FILES:
        if not os.path.exists(path):
            pytest.skip(f"Missing: {path}")
        rows = parse_ead_file(path)
        assert len(rows) > 0, f"No volumes in {path}"
        for row in rows[:5]:
            assert row["reference_code"], f"Empty ref code in {path}"
            assert row["archive_code"], f"Empty archive code in {path}"
            assert row["search_text"], f"Empty search text in {path}"


def test_parse_file_with_no_volumes():
    """Files with only fonds/series (no volumes) return empty list."""
    from ingest_catalog import parse_ead_file

    # SE_RA_0104 has only fonds-level components
    path = os.path.join(DATA_DIR, "SE_RA", "SE_RA_0104.xml")
    if not os.path.exists(path):
        pytest.skip("Missing sample file")
    rows = parse_ead_file(path)
    assert rows == []


def test_walk_directory():
    """walk_archive_dir yields rows from all XML files."""
    from ingest_catalog import walk_archive_dir

    rows = list(walk_archive_dir(os.path.join(DATA_DIR, "SE_ViLA"), limit=5))
    assert len(rows) > 0
    # Each row is a dict with expected keys
    assert "reference_code" in rows[0]
```

**Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest test_ingest_catalog.py::test_walk_directory -v`
Expected: FAIL — `ImportError: cannot import name 'walk_archive_dir'`

**Step 3: Add walk_archive_dir to ingest_catalog.py**

```python
# Add to backend/ingest_catalog.py

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
```

**Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/python -m pytest test_ingest_catalog.py -v`
Expected: 6 PASS

**Step 5: Commit**

```bash
git add backend/ingest_catalog.py backend/test_ingest_catalog.py
git commit -m "feat: multi-file parser with walk_archive_dir"
```

---

### Task 3: Embedding + LanceDB Ingestion

**Files:**
- Modify: `backend/ingest_catalog.py`
- Modify: `backend/test_ingest_catalog.py`
- Modify: `backend/requirements.txt`

**Step 1: Install sentence-transformers**

```bash
cd backend && .venv/bin/pip install sentence-transformers
```

Add to `backend/requirements.txt`:
```
sentence-transformers>=3,<4
```

**Step 2: Write the failing test**

```python
# Add to backend/test_ingest_catalog.py

def test_embed_texts():
    from ingest_catalog import create_embedder, embed_batch

    embedder = create_embedder()
    texts = ["Swedish council protocols", "Krigsarkivet military records"]
    vectors = embed_batch(embedder, texts)
    assert len(vectors) == 2
    assert len(vectors[0]) == 384  # e5-small output dim


def test_ingest_to_lancedb(tmp_path):
    from ingest_catalog import parse_ead_file, ingest_rows

    rows = parse_ead_file(SAMPLE_FILE)[:20]  # Small sample
    db_path = str(tmp_path / "test_lance")
    stats = ingest_rows(rows, db_path, batch_size=10, embed=False)
    assert stats["rows_written"] == 20

    import lancedb
    db = lancedb.connect(db_path)
    table = db.open_table("archive_catalog")
    assert table.count_rows() == 20


def test_ingest_with_embeddings(tmp_path):
    from ingest_catalog import parse_ead_file, ingest_rows

    rows = parse_ead_file(SAMPLE_FILE)[:5]
    db_path = str(tmp_path / "test_lance_vec")
    stats = ingest_rows(rows, db_path, batch_size=5, embed=True)
    assert stats["rows_written"] == 5

    import lancedb
    db = lancedb.connect(db_path)
    table = db.open_table("archive_catalog")
    assert table.count_rows() == 5
    # Vector column exists
    arrow = table.to_arrow()
    assert "vector" in arrow.column_names
```

**Step 3: Run tests to verify they fail**

Run: `cd backend && .venv/bin/python -m pytest test_ingest_catalog.py::test_embed_texts -v`
Expected: FAIL — `ImportError: cannot import name 'create_embedder'`

**Step 4: Implement embedding and ingestion**

```python
# Add to backend/ingest_catalog.py

import numpy as np
import pyarrow as pa
import lancedb

CATALOG_TABLE = "archive_catalog"
EMBED_MODEL = "intfloat/multilingual-e5-small"
EMBED_DIM = 384

CATALOG_SCHEMA = pa.schema([
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
])


def create_embedder():
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(EMBED_MODEL)


def embed_batch(embedder, texts: list[str]) -> list[list[float]]:
    # e5 models expect "query: " or "passage: " prefix
    prefixed = [f"passage: {t}" for t in texts]
    vecs = embedder.encode(prefixed, normalize_embeddings=True)
    return [v.tolist() for v in vecs]


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
            vectors = embed_batch(embedder, [r["search_text"] for r in batch])
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
```

**Step 5: Run tests to verify they pass**

Run: `cd backend && .venv/bin/python -m pytest test_ingest_catalog.py -v`
Expected: All PASS (embedding test may take ~10s for model download on first run)

**Step 6: Commit**

```bash
git add backend/ingest_catalog.py backend/test_ingest_catalog.py backend/requirements.txt
git commit -m "feat: embedding and LanceDB ingestion for archive catalog"
```

---

### Task 4: CLI Entry Point + Incremental Testing

**Files:**
- Modify: `backend/ingest_catalog.py`

**Step 1: Add CLI with argparse**

```python
# Add to bottom of backend/ingest_catalog.py

def build_fts_index(db_path: str):
    """Build FTS ngram index on search_text column."""
    db = lancedb.connect(db_path)
    table = db.open_table(CATALOG_TABLE)
    try:
        table.create_fts_index(
            "search_text", replace=True,
            base_tokenizer="ngram", ngram_min_length=2, prefix_only=True,
        )
        print(f"FTS index built on {table.count_rows()} rows")
    except Exception as e:
        print(f"FTS index failed: {e}")


def main():
    import argparse
    import time

    parser = argparse.ArgumentParser(description="Ingest Riksarkivet EAD metadata into LanceDB")
    parser.add_argument("data_dir", help="Path to Riksarkivet-2022-12-16 directory")
    parser.add_argument("--db-path", default="/tmp/lancedb", help="LanceDB directory")
    parser.add_argument("--sample", type=int, default=0, help="Only process N files per archive (0=all)")
    parser.add_argument("--batch-size", type=int, default=10_000)
    parser.add_argument("--no-embed", action="store_true", help="Skip embedding (for testing)")
    args = parser.parse_args()

    t0 = time.time()
    all_rows = []

    for archive_dir in sorted(os.listdir(args.data_dir)):
        full_path = os.path.join(args.data_dir, archive_dir)
        if not os.path.isdir(full_path):
            continue
        print(f"Parsing {archive_dir}...")
        count = 0
        for row in walk_archive_dir(full_path, limit=args.sample or None):
            all_rows.append(row)
            count += 1
        print(f"  {count} volumes from {archive_dir}")

    print(f"Total: {len(all_rows)} volumes parsed in {time.time() - t0:.1f}s")

    if not all_rows:
        print("No volumes found, exiting.")
        return

    print("Ingesting into LanceDB...")
    stats = ingest_rows(
        all_rows, args.db_path,
        batch_size=args.batch_size,
        embed=not args.no_embed,
    )
    print(f"Wrote {stats['rows_written']} rows to {args.db_path}")

    print("Building FTS index...")
    build_fts_index(args.db_path)

    print(f"Done in {time.time() - t0:.1f}s total")


if __name__ == "__main__":
    main()
```

**Step 2: Test with small sample (no embedding)**

Run: `cd backend && .venv/bin/python ingest_catalog.py /home/m/Downloads/Riksarkivet-2022-12-16 --sample 2 --no-embed --db-path /tmp/test_catalog_lance`
Expected: Parses ~2 files per archive, writes to LanceDB, prints counts.

**Step 3: Test with small sample (with embedding)**

Run: `cd backend && .venv/bin/python ingest_catalog.py /home/m/Downloads/Riksarkivet-2022-12-16 --sample 1 --db-path /tmp/test_catalog_lance`
Expected: Same but with vector embeddings. Slower (model load + encode).

**Step 4: Verify data in LanceDB**

```bash
cd backend && .venv/bin/python -c "
import lancedb
db = lancedb.connect('/tmp/test_catalog_lance')
t = db.open_table('archive_catalog')
print(f'Rows: {t.count_rows()}')
print(t.to_arrow().column_names)
print(t.to_arrow().slice(0, 3).to_pandas()[['reference_code','fonds_title','digitized','date_start','date_end']].to_string())
"
```

**Step 5: Commit**

```bash
git add backend/ingest_catalog.py
git commit -m "feat: CLI entry point for archive catalog ingestion"
```

---

### Task 5: Search API Endpoints

**Files:**
- Modify: `backend/app.py`
- Modify: `backend/test_app.py`

**Step 1: Write failing tests**

```python
# Add to backend/test_app.py

def test_catalog_search_fts(client):
    """GET /catalog/search?q=... returns FTS results."""
    res = client.get("/catalog/search", params={"q": "protokoll", "limit": 5})
    assert res.status_code == 200
    data = res.json()
    assert "results" in data
    # Results may be empty if catalog not loaded — just check structure
    if data["results"]:
        r = data["results"][0]
        assert "reference_code" in r
        assert "fonds_title" in r
        assert "digitized" in r


def test_catalog_search_filters(client):
    """Filters: digitized, date range, archive."""
    res = client.get("/catalog/search", params={
        "q": "protokoll",
        "digitized": "true",
        "date_start": 1600,
        "date_end": 1700,
        "archive": "SE_RA",
    })
    assert res.status_code == 200


def test_catalog_search_vector(client):
    """Vector search mode."""
    res = client.get("/catalog/search", params={"q": "military records", "mode": "vector", "limit": 5})
    assert res.status_code == 200
```

**Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/python -m pytest test_app.py::test_catalog_search_fts -v`
Expected: FAIL — 404 (endpoint doesn't exist yet)

**Step 3: Implement catalog search endpoints in app.py**

Add to `backend/app.py`:

```python
# At top, add imports
from ingest_catalog import CATALOG_TABLE, CATALOG_SCHEMA, create_embedder, EMBED_DIM

# Module-level
catalog_table = None
catalog_embedder = None

# In init_db(), after existing table setup:
def init_catalog():
    global catalog_table
    try:
        catalog_table = db.open_table(CATALOG_TABLE)
        print(f"Catalog table: {catalog_table.count_rows()} rows")
    except Exception:
        print("No catalog table found — run ingest_catalog.py first")

# In lifespan, after init_db():
#   init_catalog()

# New endpoints:

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
        raise HTTPException(503, "Catalog not loaded")
    if not q:
        raise HTTPException(400, "Query required")

    if mode == "vector":
        results = _catalog_vector_search(q, limit + offset)
    elif mode == "hybrid":
        results = _catalog_hybrid_search(q, limit + offset)
    else:
        results = _catalog_fts_search(q, limit + offset)

    # Apply filters with pyarrow
    if digitized is not None:
        mask = pc.equal(results.column("digitized"), digitized)
        results = results.filter(mask)
    if date_start is not None:
        # Keep rows where date_end >= date_start filter (overlapping ranges)
        not_null = pc.is_valid(results.column("date_end"))
        gte = pc.greater_equal(results.column("date_end"), date_start)
        results = results.filter(pc.and_(not_null, gte))
    if date_end is not None:
        not_null = pc.is_valid(results.column("date_start"))
        lte = pc.less_equal(results.column("date_start"), date_end)
        results = results.filter(pc.and_(not_null, lte))
    if archive:
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
        return pa.table([], schema=CATALOG_SCHEMA)


def _catalog_vector_search(q: str, limit: int) -> pa.Table:
    global catalog_embedder
    if catalog_embedder is None:
        catalog_embedder = create_embedder()
    from ingest_catalog import embed_batch
    vec = embed_batch(catalog_embedder, [q])[0]
    return catalog_table.search(vec).limit(limit).to_arrow()


def _catalog_hybrid_search(q: str, limit: int) -> pa.Table:
    # Simple merge: get both, deduplicate by id, prefer vector ranking
    fts = _catalog_fts_search(q, limit)
    vec = _catalog_vector_search(q, limit)
    if len(fts) == 0:
        return vec
    if len(vec) == 0:
        return fts
    # Merge: vector results first, then FTS-only hits
    vec_ids = set(vec.column("id").to_pylist())
    fts_only_mask = pc.invert(pc.is_in(fts.column("id"), pa.array(list(vec_ids))))
    fts_only = fts.filter(fts_only_mask)
    if len(fts_only) > 0:
        return pa.concat_tables([vec, fts_only])
    return vec
```

**Step 4: Run tests**

Run: `cd backend && .venv/bin/python -m pytest test_app.py -v`
Expected: All PASS (catalog tests check structure only, may return empty if no data loaded)

**Step 5: Commit**

```bash
git add backend/app.py backend/test_app.py
git commit -m "feat: catalog search API — FTS, vector, hybrid with filters"
```

---

### Task 6: Frontend — Catalog Search UI

**Files:**
- Create: `src/lib/components/CatalogSearch.svelte`
- Modify: `src/lib/api.ts`
- Modify: `src/routes/viewer/+page.svelte` or `src/routes/+page.svelte`

This task is more exploratory — exact UI depends on how it feels. Core requirements:

**Step 1: Add API function**

```typescript
// Add to src/lib/api.ts

export interface CatalogResult {
  reference_code: string;
  fonds_title: string;
  series_title: string;
  volume_id: string;
  date_text: string;
  description: string;
  digitized: boolean;
}

export async function searchCatalog(params: {
  q: string;
  digitized?: boolean;
  date_start?: number;
  date_end?: number;
  archive?: string;
  mode?: 'fts' | 'vector' | 'hybrid';
  limit?: number;
  offset?: number;
}): Promise<{ results: CatalogResult[]; total: number }> {
  if (!API_BASE) return { results: [], total: 0 };
  const searchParams = new URLSearchParams();
  searchParams.set('q', params.q);
  if (params.digitized !== undefined) searchParams.set('digitized', String(params.digitized));
  if (params.date_start !== undefined) searchParams.set('date_start', String(params.date_start));
  if (params.date_end !== undefined) searchParams.set('date_end', String(params.date_end));
  if (params.archive) searchParams.set('archive', params.archive);
  if (params.mode) searchParams.set('mode', params.mode);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));
  const res = await fetch(`${API_BASE}/catalog/search?${searchParams}`, {
    headers: authHeaders(),
  });
  if (!res.ok) return { results: [], total: 0 };
  return res.json();
}
```

**Step 2: Build CatalogSearch component**

A search input + filter toggles + scrollable results list. Each result shows fonds_title, series/volume, date, description snippet. Digitized items get a "Load" button. Non-digitized are dimmed.

**Step 3: Integrate into home page or TranscriptionPanel**

Place it on the home page below the Riksarkivet import, or as a tab/section in the TranscriptionPanel.

**Step 4: Wire "Load" button to existing resolveVolume flow**

Clicking "Load" on a digitized result passes `reference_code` to `handleRiksarkivetResolved` (or directly into `resolveVolume`).

**Step 5: Commit**

```bash
git add src/lib/api.ts src/lib/components/CatalogSearch.svelte src/routes/+page.svelte
git commit -m "feat: catalog search UI for discovering archive volumes"
```

---

### Task 7: Full Ingestion Run

**Only after Tasks 1-4 pass with sample data.**

**Step 1: Run full ingestion**

```bash
cd backend && .venv/bin/python ingest_catalog.py \
  /home/m/Downloads/Riksarkivet-2022-12-16 \
  --db-path /tmp/lancedb \
  --batch-size 50000
```

Expected: ~30-60 min, 7.6M rows, ~3GB LanceDB directory.

**Step 2: Verify**

```bash
cd backend && .venv/bin/python -c "
import lancedb
db = lancedb.connect('/tmp/lancedb')
t = db.open_table('archive_catalog')
print(f'Total rows: {t.count_rows()}')
# Quick search test
results = t.search('domböcker', query_type='fts').limit(5).to_arrow()
print(f'FTS hits: {len(results)}')
for i in range(len(results)):
    print(f'  {results.column(\"reference_code\")[i].as_py()} — {results.column(\"fonds_title\")[i].as_py()}')
"
```

**Step 3: Commit any fixes found during full run**
