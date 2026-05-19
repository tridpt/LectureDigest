"""
Tests for chat rooms — create, join, send messages, moderation.
"""

import time
import pytest


def _unique_email(prefix="chat"):
    return f"{prefix}_{int(time.time() * 1000000)}@test.com"


def _register(client, prefix="chat"):
    resp = client.post("/api/auth/register", json={
        "email": _unique_email(prefix),
        "password": "pass123",
        "display_name": f"User {prefix}",
    })
    assert resp.status_code == 200, f"Register failed: {resp.text}"
    return resp.json()["token"], resp.json()["user"]


class TestChatRoomsUnauthenticated:
    """All chat room endpoints require auth."""

    def test_create_no_auth(self, client):
        resp = client.post("/api/chat-rooms", json={"name": "Test"})
        assert resp.status_code == 401

    def test_list_no_auth(self, client):
        resp = client.get("/api/chat-rooms")
        assert resp.status_code == 401

    def test_public_list_no_auth(self, client):
        resp = client.get("/api/chat-rooms/public")
        assert resp.status_code == 401


class TestCreateChatRoom:
    """Test chat room creation."""

    def test_create_success(self, client, auth_headers):
        resp = client.post("/api/chat-rooms", json={
            "name": "General Chat",
            "icon": "💬",
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert "room_id" in data

    def test_create_empty_name(self, client, auth_headers):
        resp = client.post("/api/chat-rooms", json={
            "name": "",
        }, headers=auth_headers)
        assert resp.status_code == 422


class TestChatRoomJoinLeave:
    """Test joining and leaving chat rooms."""

    def test_join_public_room(self, client):
        token1, _ = _register(client, "owner_join")
        owner_headers = {"Authorization": f"Bearer {token1}"}
        room = client.post("/api/chat-rooms", json={"name": "Public Chat"}, headers=owner_headers).json()
        room_id = room["room_id"]

        token2, _ = _register(client, "joiner_join")
        joiner_headers = {"Authorization": f"Bearer {token2}"}

        resp = client.post(f"/api/chat-rooms/join/{room_id}", headers=joiner_headers)
        assert resp.status_code == 200

    def test_leave_room(self, client):
        token1, _ = _register(client, "owner_leave")
        owner_headers = {"Authorization": f"Bearer {token1}"}
        room = client.post("/api/chat-rooms", json={"name": "Leave Chat"}, headers=owner_headers).json()
        room_id = room["room_id"]

        token2, _ = _register(client, "leaver")
        leaver_headers = {"Authorization": f"Bearer {token2}"}
        client.post(f"/api/chat-rooms/join/{room_id}", headers=leaver_headers)

        resp = client.post(f"/api/chat-rooms/{room_id}/leave", headers=leaver_headers)
        assert resp.status_code == 200


class TestChatMessages:
    """Test sending and retrieving messages."""

    def test_send_message(self, client, auth_headers):
        room = client.post("/api/chat-rooms", json={"name": "Msg Room"}, headers=auth_headers).json()
        room_id = room["room_id"]

        resp = client.post(f"/api/chat-rooms/{room_id}/messages", json={
            "content": "Hello world!",
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["message"]["content"] == "Hello world!"

    def test_get_messages(self, client, auth_headers):
        room = client.post("/api/chat-rooms", json={"name": "Get Msgs"}, headers=auth_headers).json()
        room_id = room["room_id"]

        client.post(f"/api/chat-rooms/{room_id}/messages", json={"content": "Msg 1"}, headers=auth_headers)
        client.post(f"/api/chat-rooms/{room_id}/messages", json={"content": "Msg 2"}, headers=auth_headers)

        resp = client.get(f"/api/chat-rooms/{room_id}/messages", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "messages" in data
        assert len(data["messages"]) >= 2

    def test_delete_own_message(self, client, auth_headers):
        room = client.post("/api/chat-rooms", json={"name": "Del Msg"}, headers=auth_headers).json()
        room_id = room["room_id"]

        send_resp = client.post(f"/api/chat-rooms/{room_id}/messages", json={
            "content": "To delete",
        }, headers=auth_headers).json()
        msg_id = send_resp["message"]["id"]

        resp = client.delete(f"/api/chat-rooms/{room_id}/messages/{msg_id}", headers=auth_headers)
        assert resp.status_code == 200

    def test_non_member_cannot_send(self, client):
        token1, _ = _register(client, "msg_owner")
        owner_headers = {"Authorization": f"Bearer {token1}"}
        room = client.post("/api/chat-rooms", json={"name": "Private Msg"}, headers=owner_headers).json()
        room_id = room["room_id"]

        token2, _ = _register(client, "msg_outsider")
        outsider_headers = {"Authorization": f"Bearer {token2}"}

        resp = client.post(f"/api/chat-rooms/{room_id}/messages", json={
            "content": "Sneaky message",
        }, headers=outsider_headers)
        assert resp.status_code == 403


class TestChatModeration:
    """Test kick, ban functionality."""

    def test_kick_member(self, client):
        token1, _ = _register(client, "kick_owner")
        owner_headers = {"Authorization": f"Bearer {token1}"}
        room = client.post("/api/chat-rooms", json={"name": "Kick Room"}, headers=owner_headers).json()
        room_id = room["room_id"]

        token2, user2 = _register(client, "kick_target")
        target_headers = {"Authorization": f"Bearer {token2}"}
        client.post(f"/api/chat-rooms/join/{room_id}", headers=target_headers)

        resp = client.post(f"/api/chat-rooms/{room_id}/kick/{user2['id']}", headers=owner_headers)
        assert resp.status_code == 200

    def test_ban_member(self, client):
        token1, _ = _register(client, "ban_owner")
        owner_headers = {"Authorization": f"Bearer {token1}"}
        room = client.post("/api/chat-rooms", json={"name": "Ban Room"}, headers=owner_headers).json()
        room_id = room["room_id"]

        token2, user2 = _register(client, "ban_target")
        target_headers = {"Authorization": f"Bearer {token2}"}
        client.post(f"/api/chat-rooms/join/{room_id}", headers=target_headers)

        resp = client.post(f"/api/chat-rooms/{room_id}/ban/{user2['id']}", headers=owner_headers)
        assert resp.status_code == 200

    def test_member_cannot_kick(self, client):
        token1, _ = _register(client, "nokick_owner")
        owner_headers = {"Authorization": f"Bearer {token1}"}
        room = client.post("/api/chat-rooms", json={"name": "No Kick"}, headers=owner_headers).json()
        room_id = room["room_id"]

        token2, _ = _register(client, "nokick_m1")
        m1_headers = {"Authorization": f"Bearer {token2}"}
        client.post(f"/api/chat-rooms/join/{room_id}", headers=m1_headers)

        token3, user3 = _register(client, "nokick_m2")
        m2_headers = {"Authorization": f"Bearer {token3}"}
        client.post(f"/api/chat-rooms/join/{room_id}", headers=m2_headers)

        resp = client.post(f"/api/chat-rooms/{room_id}/kick/{user3['id']}", headers=m1_headers)
        assert resp.status_code == 403


class TestChatRoomDelete:
    """Test room deletion."""

    def test_owner_can_delete(self, client, auth_headers):
        room = client.post("/api/chat-rooms", json={"name": "To Delete"}, headers=auth_headers).json()
        room_id = room["room_id"]

        resp = client.delete(f"/api/chat-rooms/{room_id}", headers=auth_headers)
        assert resp.status_code == 200

    def test_non_owner_cannot_delete(self, client):
        token1, _ = _register(client, "del_owner")
        owner_headers = {"Authorization": f"Bearer {token1}"}
        room = client.post("/api/chat-rooms", json={"name": "No Del"}, headers=owner_headers).json()
        room_id = room["room_id"]

        token2, _ = _register(client, "del_member")
        member_headers = {"Authorization": f"Bearer {token2}"}
        client.post(f"/api/chat-rooms/join/{room_id}", headers=member_headers)

        resp = client.delete(f"/api/chat-rooms/{room_id}", headers=member_headers)
        assert resp.status_code == 403
