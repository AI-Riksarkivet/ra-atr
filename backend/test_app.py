"""Tests for the transcription backend API."""

import tempfile
from pathlib import Path
from unittest.mock import patch

import lancedb
import pytest
from fastapi.testclient import TestClient

import app as app_module
from app import SCHEMA, app


@pytest.fixture(autouse=True)
def _setup_db(tmp_path: Path):
    """Create a fresh LanceDB for each test."""
    db = lancedb.connect(str(tmp_path / "testdb"))
    tbl = db.create_table("transcriptions", schema=SCHEMA, mode="overwrite")
    app_module.db = db
    app_module.table = tbl
    app_module.PARQUET_DIR = tmp_path / "parquet"
    app_module.PARQUET_DIR.mkdir()
    yield
    app_module.db = None
    app_module.table = None


@pytest.fixture()
def client():
    return TestClient(app, raise_server_exceptions=False)


SAMPLE_BODY = {
    "reference_code": "SE/RA/420177/02/A I a/3",
    "groups": [
        {
            "page_number": 1,
            "group_name": "Group 1",
            "group_rect": {"x": 0, "y": 0, "w": 500, "h": 600},
            "lines": [
                {
                    "line_index": 0,
                    "bbox": {"x": 10, "y": 10, "w": 400, "h": 30},
                    "text": "Anno 1723 den 15 Martii",
                    "confidence": 0.92,
                    "source": "htr",
                },
                {
                    "line_index": 1,
                    "bbox": {"x": 10, "y": 50, "w": 400, "h": 30},
                    "text": "hölltz ordinarie ting",
                    "confidence": 0.88,
                    "source": "htr",
                },
            ],
        }
    ],
}


# --- Health ---


def test_health(client: TestClient):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


# --- GET /transcriptions ---


def test_get_empty(client: TestClient):
    r = client.get("/transcriptions/R0003221")
    assert r.status_code == 200
    data = r.json()
    assert data["manifest_id"] == "R0003221"
    assert data["groups"] == []


def test_get_returns_latest_version(client: TestClient):
    """When multiple versions exist, only the latest is returned."""
    with _mock_auth("testuser"):
        # Contribute v1
        client.post(
            "/transcriptions/R0003221",
            json=SAMPLE_BODY,
            headers={"Authorization": "Bearer fake"},
        )
        # Contribute v2 with updated text
        body_v2 = _with_text(SAMPLE_BODY, "Anno 1723 den 16 Martii")
        client.post(
            "/transcriptions/R0003221",
            json=body_v2,
            headers={"Authorization": "Bearer fake"},
        )

    r = client.get("/transcriptions/R0003221")
    assert r.status_code == 200
    groups = r.json()["groups"]
    assert len(groups) == 1
    # First line should have updated text
    assert groups[0]["lines"][0]["text"] == "Anno 1723 den 16 Martii"


# --- POST /transcriptions ---


def test_post_requires_auth_in_production(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SPACE_ID", "test/space")
    r = client.post("/transcriptions/R0003221", json=SAMPLE_BODY)
    assert r.status_code == 401


def test_post_allows_any_user_in_dev(client: TestClient):
    """In dev mode (no SPACE_ID), auth is skipped and user is 'local'."""
    r = client.post("/transcriptions/R0003221", json=SAMPLE_BODY)
    assert r.status_code == 200
    assert r.json()["contributor"] == "local"


def test_post_rejects_bad_token(client: TestClient):
    with _mock_auth(None):
        r = client.post(
            "/transcriptions/R0003221",
            json=SAMPLE_BODY,
            headers={"Authorization": "Bearer bad_token"},
        )
    assert r.status_code == 401


def test_post_contributes_lines(client: TestClient):
    with _mock_auth("researcher1"):
        r = client.post(
            "/transcriptions/R0003221",
            json=SAMPLE_BODY,
            headers={"Authorization": "Bearer fake"},
        )
    assert r.status_code == 200
    data = r.json()
    assert data["lines_added"] == 2
    assert data["contributor"] == "researcher1"

    # Verify via GET
    r = client.get("/transcriptions/R0003221")
    groups = r.json()["groups"]
    assert len(groups) == 1
    assert len(groups[0]["lines"]) == 2
    assert groups[0]["lines"][0]["contributor"] == "researcher1"


def test_post_replaces_existing(client: TestClient):
    """Second POST replaces all rows for that manifest."""
    with _mock_auth("user1"):
        client.post(
            "/transcriptions/R0003221",
            json=SAMPLE_BODY,
            headers={"Authorization": "Bearer fake"},
        )
    with _mock_auth("user2"):
        r = client.post(
            "/transcriptions/R0003221",
            json=SAMPLE_BODY,
            headers={"Authorization": "Bearer fake"},
        )
    assert r.json()["lines_added"] == 2

    # Old rows replaced, only latest contribution remains
    total_rows = app_module.table.count_rows()
    assert total_rows == 2  # 2 lines, not 4


def test_post_delete_by_contributing_empty(client: TestClient):
    """Contributing empty groups removes all lines for that manifest."""
    with _mock_auth("user1"):
        client.post(
            "/transcriptions/R0003221",
            json=SAMPLE_BODY,
            headers={"Authorization": "Bearer fake"},
        )
    assert app_module.table.count_rows() == 2

    with _mock_auth("user1"):
        client.post(
            "/transcriptions/R0003221",
            json={"reference_code": "test", "groups": []},
            headers={"Authorization": "Bearer fake"},
        )
    assert app_module.table.count_rows() == 0

    r = client.get("/transcriptions/R0003221")
    assert r.json()["groups"] == []


def test_post_empty_groups(client: TestClient):
    with _mock_auth("user1"):
        r = client.post(
            "/transcriptions/R0003221",
            json={"reference_code": "test", "groups": []},
            headers={"Authorization": "Bearer fake"},
        )
    assert r.status_code == 200
    assert r.json()["lines_added"] == 0


# --- GET /transcriptions/{id}/history ---


def test_history_empty(client: TestClient):
    r = client.get("/transcriptions/R0003221/history")
    assert r.status_code == 200
    assert r.json()["contributions"] == []


def test_history_shows_contributions(client: TestClient):
    with _mock_auth("alice"):
        client.post(
            "/transcriptions/R0003221",
            json=SAMPLE_BODY,
            headers={"Authorization": "Bearer fake"},
        )

    r = client.get("/transcriptions/R0003221/history")
    assert r.status_code == 200
    contribs = r.json()["contributions"]
    assert len(contribs) == 1
    assert contribs[0]["contributor"] == "alice"
    assert contribs[0]["lines"] == 2


# --- Flush to parquet ---


def test_flush_creates_parquet(client: TestClient):
    with _mock_auth("user1"):
        client.post(
            "/transcriptions/R0003221",
            json=SAMPLE_BODY,
            headers={"Authorization": "Bearer fake"},
        )
    parquet_file = app_module.PARQUET_DIR / "transcriptions.parquet"
    assert parquet_file.exists()


# --- Helpers ---


def _mock_auth(username: str | None):
    """Mock _resolve_user to return a fixed username (or None for rejection)."""

    def fake_resolve(request):
        if username is None:
            return None
        auth = request.headers.get("authorization", "")
        if not auth.startswith("Bearer "):
            return None
        return username

    return patch.object(app_module, "_resolve_user", side_effect=fake_resolve)


def _with_text(body: dict, new_text: str) -> dict:
    """Return a copy of the sample body with the first line's text changed."""
    import copy

    b = copy.deepcopy(body)
    b["groups"][0]["lines"][0]["text"] = new_text
    return b
