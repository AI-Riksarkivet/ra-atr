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
