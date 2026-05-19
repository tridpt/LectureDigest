"""
Tests for notifications routes — get, mark read, clear.
"""

import pytest


class TestNotificationsUnauthenticated:
    """Unauthenticated users should get 401."""

    def test_get_notifications_no_auth(self, client):
        resp = client.get("/api/notifications")
        assert resp.status_code == 401

    def test_mark_read_no_auth(self, client):
        resp = client.post("/api/notifications/read/1")
        assert resp.status_code == 401

    def test_mark_all_read_no_auth(self, client):
        resp = client.post("/api/notifications/read-all")
        assert resp.status_code == 401

    def test_clear_no_auth(self, client):
        resp = client.delete("/api/notifications")
        assert resp.status_code == 401


class TestNotifications:
    """Test notification CRUD with authenticated user."""

    def test_get_empty_notifications(self, client, auth_headers):
        resp = client.get("/api/notifications", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "notifications" in data
        assert "unread_count" in data
        assert data["unread_count"] == 0

    def test_create_and_get_notification(self, client, registered_user):
        """Create a notification via helper and verify it shows up."""
        user, token, headers = registered_user

        # Create notification directly via the helper function
        from routes.notifications import create_notification
        create_notification(user["id"], "test", "Test Title", "Test message", "/test")

        resp = client.get("/api/notifications", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["unread_count"] == 1
        assert len(data["notifications"]) == 1
        notif = data["notifications"][0]
        assert notif["title"] == "Test Title"
        assert notif["message"] == "Test message"
        assert notif["type"] == "test"
        assert notif["link"] == "/test"
        assert notif["is_read"] is False

    def test_mark_single_read(self, client, registered_user):
        user, token, headers = registered_user

        from routes.notifications import create_notification
        create_notification(user["id"], "info", "Notification 1", "", "")
        create_notification(user["id"], "info", "Notification 2", "", "")

        # Get notifications to find IDs
        resp = client.get("/api/notifications", headers=headers)
        notifs = resp.json()["notifications"]
        assert len(notifs) == 2

        # Mark one as read
        notif_id = notifs[0]["id"]
        resp = client.post(f"/api/notifications/read/{notif_id}", headers=headers)
        assert resp.status_code == 200

        # Verify unread count decreased
        resp = client.get("/api/notifications", headers=headers)
        assert resp.json()["unread_count"] == 1

    def test_mark_all_read(self, client, registered_user):
        user, token, headers = registered_user

        from routes.notifications import create_notification
        create_notification(user["id"], "info", "N1", "", "")
        create_notification(user["id"], "info", "N2", "", "")
        create_notification(user["id"], "info", "N3", "", "")

        resp = client.post("/api/notifications/read-all", headers=headers)
        assert resp.status_code == 200

        resp = client.get("/api/notifications", headers=headers)
        assert resp.json()["unread_count"] == 0

    def test_clear_all_notifications(self, client, registered_user):
        user, token, headers = registered_user

        from routes.notifications import create_notification
        create_notification(user["id"], "info", "To delete", "", "")

        resp = client.delete("/api/notifications", headers=headers)
        assert resp.status_code == 200

        resp = client.get("/api/notifications", headers=headers)
        assert len(resp.json()["notifications"]) == 0
