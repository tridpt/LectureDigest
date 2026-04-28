"""
Tests for authentication routes — register, login, profile, password reset.
"""

import pytest


class TestRegister:
    """Test POST /api/auth/register."""

    def test_register_success(self, client):
        resp = client.post("/api/auth/register", json={
            "email": "newuser@example.com",
            "password": "password123",
            "display_name": "New User",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data
        assert data["user"]["email"] == "newuser@example.com"
        assert data["user"]["display_name"] == "New User"
        assert "avatar_color" in data["user"]

    def test_register_duplicate_email(self, client):
        client.post("/api/auth/register", json={
            "email": "dup@example.com",
            "password": "password123",
            "display_name": "First",
        })
        resp = client.post("/api/auth/register", json={
            "email": "dup@example.com",
            "password": "password456",
            "display_name": "Second",
        })
        assert resp.status_code == 409

    def test_register_invalid_email(self, client):
        resp = client.post("/api/auth/register", json={
            "email": "notanemail",
            "password": "password123",
            "display_name": "Bad",
        })
        assert resp.status_code == 400

    def test_register_short_password(self, client):
        resp = client.post("/api/auth/register", json={
            "email": "short@example.com",
            "password": "123",
            "display_name": "Short",
        })
        assert resp.status_code == 422  # Pydantic validation

    def test_register_email_case_insensitive(self, client):
        client.post("/api/auth/register", json={
            "email": "CASE@Example.com",
            "password": "password123",
            "display_name": "Case Test",
        })
        resp = client.post("/api/auth/register", json={
            "email": "case@example.com",
            "password": "password123",
            "display_name": "Case Test 2",
        })
        assert resp.status_code == 409


class TestLogin:
    """Test POST /api/auth/login."""

    def test_login_success(self, client):
        # Register first
        client.post("/api/auth/register", json={
            "email": "logintest@example.com",
            "password": "password123",
            "display_name": "Login User",
        })
        # Login
        resp = client.post("/api/auth/login", json={
            "email": "logintest@example.com",
            "password": "password123",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data
        assert data["user"]["email"] == "logintest@example.com"
        # Should not leak password hash
        assert "password_hash" not in data["user"]

    def test_login_wrong_password(self, client):
        client.post("/api/auth/register", json={
            "email": "wrongpw@example.com",
            "password": "correct123",
            "display_name": "Wrong PW",
        })
        resp = client.post("/api/auth/login", json={
            "email": "wrongpw@example.com",
            "password": "wrongpassword",
        })
        assert resp.status_code == 401

    def test_login_nonexistent_email(self, client):
        resp = client.post("/api/auth/login", json={
            "email": "nobody@example.com",
            "password": "password123",
        })
        assert resp.status_code == 401


class TestMe:
    """Test GET /api/auth/me."""

    def test_me_authenticated(self, client, auth_headers):
        resp = client.get("/api/auth/me", headers=auth_headers)
        assert resp.status_code == 200
        assert "user" in resp.json()

    def test_me_no_token(self, client):
        resp = client.get("/api/auth/me")
        assert resp.status_code == 401

    def test_me_invalid_token(self, client):
        resp = client.get("/api/auth/me", headers={"Authorization": "Bearer invalid.token.here"})
        assert resp.status_code == 401


class TestProfile:
    """Test PUT /api/auth/profile."""

    def test_update_display_name(self, client, registered_user):
        user, token, headers = registered_user
        resp = client.put("/api/auth/profile", headers=headers, json={
            "display_name": "Updated Name",
        })
        assert resp.status_code == 200
        assert resp.json()["user"]["display_name"] == "Updated Name"

    def test_update_avatar_color(self, client, registered_user):
        user, token, headers = registered_user
        resp = client.put("/api/auth/profile", headers=headers, json={
            "avatar_color": "#ff0000",
        })
        assert resp.status_code == 200
        assert resp.json()["user"]["avatar_color"] == "#ff0000"

    def test_change_password(self, client):
        # Register
        reg = client.post("/api/auth/register", json={
            "email": "changepw@example.com",
            "password": "oldpassword",
            "display_name": "PW Change",
        })
        headers = {"Authorization": f"Bearer {reg.json()['token']}"}

        # Change password
        resp = client.put("/api/auth/profile", headers=headers, json={
            "current_password": "oldpassword",
            "new_password": "newpassword123",
        })
        assert resp.status_code == 200

        # Login with new password
        resp = client.post("/api/auth/login", json={
            "email": "changepw@example.com",
            "password": "newpassword123",
        })
        assert resp.status_code == 200

    def test_change_password_wrong_current(self, client, registered_user):
        user, token, headers = registered_user
        resp = client.put("/api/auth/profile", headers=headers, json={
            "current_password": "wrongpassword",
            "new_password": "newpassword123",
        })
        assert resp.status_code == 403


class TestForgotPassword:
    """Test POST /api/auth/forgot-password."""

    def test_forgot_password_returns_ok(self, client):
        """Always returns success to prevent email enumeration."""
        resp = client.post("/api/auth/forgot-password", json={
            "email": "anyone@example.com",
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_forgot_password_rate_limit(self, client):
        email = "ratelimit@example.com"
        client.post("/api/auth/forgot-password", json={"email": email})
        resp = client.post("/api/auth/forgot-password", json={"email": email})
        assert resp.status_code == 429

    def test_forgot_password_invalid_email(self, client):
        resp = client.post("/api/auth/forgot-password", json={"email": "invalid"})
        assert resp.status_code == 400


class TestResetPassword:
    """Test the reset password token flow."""

    def test_verify_invalid_token(self, client):
        resp = client.get("/api/auth/verify-reset-token?token=nonexistent")
        assert resp.status_code == 200
        assert resp.json()["valid"] is False

    def test_reset_with_invalid_token(self, client):
        resp = client.post("/api/auth/reset-password", json={
            "token": "bad_token",
            "new_password": "newpass123",
        })
        assert resp.status_code == 400
