"""Parse Riksarkivet EAD XML metadata and ingest into LanceDB."""

import os
import re
import xml.etree.ElementTree as ET

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
