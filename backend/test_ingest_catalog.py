# backend/test_ingest_catalog.py
import os

import pytest

DATA_DIR = os.environ.get("RIKSARKIVET_DATA", "/home/m/Downloads/Riksarkivet-2022-12-16")
SAMPLE_FILE = os.path.join(DATA_DIR, "SE_RA", "SE_RA_1111.xml")


def test_parse_single_file_returns_volumes():
    from ingest_catalog import parse_ead_file

    rows = parse_ead_file(SAMPLE_FILE)
    assert len(rows) > 100  # SE_RA_1111 has 232 volumes

    row = rows[0]
    # Required fields present
    for key in [
        "id",
        "reference_code",
        "archive_code",
        "fonds_id",
        "fonds_title",
        "creator",
        "series_id",
        "series_title",
        "volume_id",
        "date_text",
        "date_start",
        "date_end",
        "description",
        "digitized",
        "search_text",
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


def test_embed_texts():
    from ingest_catalog import create_embedder, embed_batch

    embedder = create_embedder()
    texts = ["Swedish council protocols", "Krigsarkivet military records"]
    vectors = embed_batch(embedder, texts)
    assert len(vectors) == 2
    assert len(vectors[0]) == 384  # e5-small output dim


def test_ingest_to_lancedb(tmp_path):
    from ingest_catalog import ingest_rows, parse_ead_file

    rows = parse_ead_file(SAMPLE_FILE)[:20]  # Small sample
    db_path = str(tmp_path / "test_lance")
    stats = ingest_rows(rows, db_path, batch_size=10, embed=False)
    assert stats["rows_written"] == 20

    import lancedb

    db = lancedb.connect(db_path)
    table = db.open_table("archive_catalog")
    assert table.count_rows() == 20


def test_ingest_with_embeddings(tmp_path):
    from ingest_catalog import ingest_rows, parse_ead_file

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
