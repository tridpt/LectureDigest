"""
Tests for analyze routes — health check, input validation.
Does NOT call Gemini API (no GEMINI_API_KEY needed).
"""

import pytest


class TestHealth:
    """Test GET /health."""

    def test_health_returns_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] in ("healthy", "degraded")
        assert "database" in data
        assert "gemini_api" in data


class TestAnalyzeValidation:
    """Test /api/analyze input validation (no actual AI calls)."""

    def test_analyze_invalid_url(self, client):
        resp = client.post("/api/analyze", json={
            "url": "not-a-youtube-url",
            "output_language": "English",
        })
        assert resp.status_code == 400
        assert "detail" in resp.json()

    def test_analyze_empty_url(self, client):
        resp = client.post("/api/analyze", json={
            "url": "",
            "output_language": "English",
        })
        assert resp.status_code == 400


class TestUploadValidation:
    """Test /api/upload-analyze input validation."""

    def test_upload_unsupported_format(self, client):
        from io import BytesIO
        resp = client.post(
            "/api/upload-analyze",
            files={"file": ("test.txt", BytesIO(b"hello"), "text/plain")},
            data={"output_language": "Vietnamese"},
        )
        assert resp.status_code == 400
        assert "Hỗ trợ" in resp.json()["detail"] or "không được hỗ trợ" in resp.json()["detail"]
