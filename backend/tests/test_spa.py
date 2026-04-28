"""
Tests for SPA routing — ensure frontend pages and static files are served correctly.
"""

import pytest


class TestSPARouting:
    """Test the catch-all SPA route handler."""

    def test_root_serves_index(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        assert "text/html" in resp.headers["content-type"]

    def test_css_files_served(self, client):
        resp = client.get("/css/base.css")
        assert resp.status_code == 200
        assert "text/css" in resp.headers["content-type"]

    def test_js_files_served(self, client):
        resp = client.get("/js/core.js")
        assert resp.status_code == 200
        assert "javascript" in resp.headers["content-type"]

    def test_manifest_served(self, client):
        resp = client.get("/manifest.json")
        assert resp.status_code == 200
        assert "json" in resp.headers["content-type"]

    def test_service_worker_served(self, client):
        resp = client.get("/sw.js")
        assert resp.status_code == 200

    def test_reset_password_page(self, client):
        resp = client.get("/reset-password")
        assert resp.status_code == 200
        assert "text/html" in resp.headers["content-type"]

    def test_shared_notes_page(self, client):
        resp = client.get("/shared-notes")
        assert resp.status_code == 200
        assert "text/html" in resp.headers["content-type"]

    def test_unknown_route_serves_index(self, client):
        """SPA catch-all should return index.html for unknown routes."""
        resp = client.get("/some/unknown/route")
        assert resp.status_code == 200
        assert "text/html" in resp.headers["content-type"]

    def test_icon_served(self, client):
        resp = client.get("/icon-192.png")
        assert resp.status_code == 200
        assert "image/png" in resp.headers["content-type"]
