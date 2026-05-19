"""
Shared test fixtures for LectureDigest backend tests.
Uses an isolated in-memory database for each test session.
"""

import os
import sys
import tempfile
import pytest
from fastapi.testclient import TestClient

# Ensure backend is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


@pytest.fixture(scope="session", autouse=True)
def _isolate_db(tmp_path_factory):
    """Point database.py to a temp file so tests don't touch production data."""
    tmp = tmp_path_factory.mktemp("db")
    test_db = str(tmp / "test.sqlite3")

    import database
    database.DB_PATH = test_db
    database.init_db()
    yield
    # cleanup happens automatically with tmp_path


@pytest.fixture()
def client():
    """FastAPI TestClient that shares the isolated test DB."""
    # Clear rate-limiting records so tests don't trip over each other
    import database
    try:
        conn = database.get_db()
        conn.execute("DELETE FROM login_attempts")
        conn.commit()
        conn.close()
    except Exception:
        pass

    # Clear in-memory rate limiter
    from main import _rate_limit_store
    _rate_limit_store.clear()

    from main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def auth_headers(client):
    """Register a test user and return Authorization headers."""
    import time
    email = f"testuser_{int(time.time() * 1000000)}@test.com"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": "testpass123",
        "display_name": "Test User",
    })
    assert resp.status_code == 200, f"Register failed: {resp.text}"
    token = resp.json()["token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def registered_user(client):
    """Register a user and return (user_dict, token, headers)."""
    import time
    email = f"user_{int(time.time() * 1000000)}@test.com"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": "securepass123",
        "display_name": "Test User",
    })
    assert resp.status_code == 200, f"Register failed: {resp.text}"
    data = resp.json()
    headers = {"Authorization": f"Bearer {data['token']}"}
    return data["user"], data["token"], headers
