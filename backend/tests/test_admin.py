"""
Tests for admin panel — access control, stats, user management.
Admin status is granted via the ADMIN_EMAILS env var.
"""

import os
import time
import pytest


@pytest.fixture()
def admin_setup(client, monkeypatch):
    """Register an admin user (email in ADMIN_EMAILS) and a normal user.
    Returns (admin_headers, normal_headers, normal_user_id)."""
    admin_email = f"admin_{int(time.time()*1000000)}@test.com"
    normal_email = f"normal_{int(time.time()*1000000)}@test.com"

    # Configure ADMIN_EMAILS to include the admin user
    monkeypatch.setenv("ADMIN_EMAILS", admin_email)

    a = client.post("/api/auth/register", json={
        "email": admin_email, "password": "adminpass123", "display_name": "Admin"
    })
    assert a.status_code == 200, a.text
    admin_headers = {"Authorization": f"Bearer {a.json()['token']}"}

    n = client.post("/api/auth/register", json={
        "email": normal_email, "password": "normalpass123", "display_name": "Normal"
    })
    assert n.status_code == 200, n.text
    normal_headers = {"Authorization": f"Bearer {n.json()['token']}"}
    normal_user_id = n.json()["user"]["id"]

    return admin_headers, normal_headers, normal_user_id


class TestAdminAccessControl:
    def test_check_no_auth(self, client):
        resp = client.get("/api/admin/check")
        assert resp.status_code == 200
        assert resp.json()["is_admin"] is False

    def test_stats_requires_auth(self, client):
        resp = client.get("/api/admin/stats")
        assert resp.status_code == 401

    def test_admin_check_true(self, client, admin_setup):
        admin_headers, _, _ = admin_setup
        resp = client.get("/api/admin/check", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["is_admin"] is True

    def test_normal_user_check_false(self, client, admin_setup):
        _, normal_headers, _ = admin_setup
        resp = client.get("/api/admin/check", headers=normal_headers)
        assert resp.status_code == 200
        assert resp.json()["is_admin"] is False

    def test_normal_user_blocked_from_stats(self, client, admin_setup):
        _, normal_headers, _ = admin_setup
        resp = client.get("/api/admin/stats", headers=normal_headers)
        assert resp.status_code == 403

    def test_normal_user_blocked_from_users(self, client, admin_setup):
        _, normal_headers, _ = admin_setup
        resp = client.get("/api/admin/users", headers=normal_headers)
        assert resp.status_code == 403


class TestAdminStats:
    def test_stats_shape(self, client, admin_setup):
        admin_headers, _, _ = admin_setup
        resp = client.get("/api/admin/stats", headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "users" in data and "content" in data
        assert data["users"]["total"] >= 2  # admin + normal at minimum


class TestAdminUsers:
    def test_list_users(self, client, admin_setup):
        admin_headers, _, _ = admin_setup
        resp = client.get("/api/admin/users", headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "users" in data and "total" in data
        assert isinstance(data["users"], list)

    def test_search_users(self, client, admin_setup):
        admin_headers, _, _ = admin_setup
        resp = client.get("/api/admin/users?search=normal", headers=admin_headers)
        assert resp.status_code == 200
        # All returned users should match the search
        for u in resp.json()["users"]:
            assert "normal" in u["email"].lower() or "normal" in (u["display_name"] or "").lower()

    def test_no_password_hash_leaked(self, client, admin_setup):
        admin_headers, _, _ = admin_setup
        resp = client.get("/api/admin/users", headers=admin_headers)
        for u in resp.json()["users"]:
            assert "password_hash" not in u


class TestAdminDelete:
    def test_admin_can_delete_normal_user(self, client, admin_setup):
        admin_headers, _, normal_user_id = admin_setup
        resp = client.delete(f"/api/admin/users/{normal_user_id}", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_admin_cannot_delete_self(self, client, admin_setup):
        admin_headers, _, _ = admin_setup
        # Find admin's own id
        me = client.get("/api/auth/me", headers=admin_headers).json()["user"]
        resp = client.delete(f"/api/admin/users/{me['id']}", headers=admin_headers)
        assert resp.status_code == 400

    def test_normal_user_cannot_delete(self, client, admin_setup):
        admin_headers, normal_headers, normal_user_id = admin_setup
        resp = client.delete(f"/api/admin/users/{normal_user_id}", headers=normal_headers)
        assert resp.status_code == 403

    def test_delete_nonexistent_user(self, client, admin_setup):
        admin_headers, _, _ = admin_setup
        resp = client.delete("/api/admin/users/999999", headers=admin_headers)
        assert resp.status_code == 404
