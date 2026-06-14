"""
Security regression tests — guard against re-introducing fixed vulnerabilities.

Each test here maps to a specific patched issue so a future refactor that
re-opens the hole fails loudly.
"""

import time
import pytest


def _register(client, prefix="sec"):
    resp = client.post("/api/auth/register", json={
        "email": f"{prefix}_{int(time.time() * 1000000)}@test.com",
        "password": "pass123",
        "display_name": f"User {prefix}",
    })
    assert resp.status_code == 200, f"Register failed: {resp.text}"
    return resp.json()["token"], resp.json()["user"]


class TestChatImageUrlValidation:
    """Regression: stored XSS via a crafted chat `image_url`.

    image_url must only ever be a server-generated upload path
    (/uploads/chat/<token>.<ext>) — never arbitrary client input that the
    frontend would later render.
    """

    def _make_room(self, client, headers):
        room = client.post("/api/chat-rooms", json={"name": "Img Room"}, headers=headers).json()
        return room["room_id"]

    @pytest.mark.parametrize("bad_url", [
        '"><img src=x onerror=alert(1)>',
        "javascript:alert(1)",
        "https://evil.example.com/x.png",
        "/uploads/chat/../../etc/passwd",
        "/uploads/chat/x.png' onerror='alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "/uploads/other/x.png",
        "not-a-path",
    ])
    def test_rejects_malicious_image_url(self, client, auth_headers, bad_url):
        room_id = self._make_room(client, auth_headers)
        resp = client.post(
            f"/api/chat-rooms/{room_id}/messages",
            json={"content": "hi", "image_url": bad_url},
            headers=auth_headers,
        )
        assert resp.status_code == 400, f"Expected 400 for {bad_url!r}, got {resp.status_code}"

    def test_accepts_valid_server_path(self, client, auth_headers):
        room_id = self._make_room(client, auth_headers)
        resp = client.post(
            f"/api/chat-rooms/{room_id}/messages",
            json={"content": "", "image_url": "/uploads/chat/abc123def456.png"},
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["message"]["image_url"] == "/uploads/chat/abc123def456.png"

    def test_plain_text_message_still_works(self, client, auth_headers):
        room_id = self._make_room(client, auth_headers)
        resp = client.post(
            f"/api/chat-rooms/{room_id}/messages",
            json={"content": "just text, no image"},
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text


class TestUploadPathTraversal:
    """Regression: the /uploads/ static route must never expose files outside
    the uploads directory (e.g. backend source) via path traversal."""

    @pytest.mark.parametrize("path", [
        "../database.py",
        "../../etc/passwd",
        "..%2f..%2fmain.py",
        "....//main.py",
    ])
    def test_traversal_does_not_leak_source(self, client, path):
        # The HTTP client may normalize "../" before sending, so we can't rely
        # on a specific status code. The security property that matters is that
        # backend source code is never returned in the body.
        resp = client.get(f"/uploads/{path}")
        body = resp.text
        # Markers that only ever appear in backend Python source, never in the
        # served SPA HTML (the About page legitimately mentions "FastAPI").
        for marker in ("def get_db(", "import sqlite3", "bcrypt.hashpw", "_JWT_SECRET"):
            assert marker not in body, f"{path!r} leaked source (found {marker!r})"

    def test_normal_uploads_path_404_when_missing(self, client):
        # A well-formed but non-existent upload must 404, not 500 or leak.
        resp = client.get("/uploads/chat/does_not_exist_123.png")
        assert resp.status_code == 404


class TestBlockedEmailEnforcement:
    """Regression: a blocked email must be rejected at both login and register,
    and the block check happens before rate limiting reveals account existence."""

    def test_blocked_email_cannot_register_or_login(self, client, monkeypatch):
        admin_email = f"secadmin_{int(time.time()*1000000)}@test.com"
        monkeypatch.setenv("ADMIN_EMAILS", admin_email)
        a = client.post("/api/auth/register", json={
            "email": admin_email, "password": "adminpass123", "display_name": "Admin"
        })
        assert a.status_code == 200
        admin_headers = {"Authorization": f"Bearer {a.json()['token']}"}

        target = f"blocked_{int(time.time()*1000000)}@test.com"
        pw = "targetpass123"
        client.post("/api/auth/register", json={
            "email": target, "password": pw, "display_name": "Target"
        })

        # Block the email
        b = client.post("/api/admin/block-email",
                        json={"email": target, "reason": "abuse"},
                        headers=admin_headers)
        assert b.status_code == 200

        # Login is now forbidden
        login = client.post("/api/auth/login", json={"email": target, "password": pw})
        assert login.status_code == 403

        # Re-registration is forbidden too
        reg = client.post("/api/auth/register", json={
            "email": target, "password": pw, "display_name": "Again"
        })
        assert reg.status_code == 403
