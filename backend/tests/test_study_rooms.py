"""
Tests for study rooms — create, join, leave, videos, comments, progress.
"""

import pytest


class TestStudyRoomsUnauthenticated:
    """All study room endpoints require auth."""

    def test_create_room_no_auth(self, client):
        resp = client.post("/api/rooms", json={"name": "Test Room"})
        assert resp.status_code == 401

    def test_list_rooms_no_auth(self, client):
        resp = client.get("/api/rooms")
        assert resp.status_code == 401

    def test_join_room_no_auth(self, client):
        resp = client.post("/api/rooms/join/abc123")
        assert resp.status_code == 401


class TestCreateRoom:
    """Test room creation."""

    def test_create_room_success(self, client, auth_headers):
        resp = client.post("/api/rooms", json={
            "name": "My Study Room",
            "description": "A room for testing",
            "icon": "📖",
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "My Study Room"
        assert data["description"] == "A room for testing"
        assert data["icon"] == "📖"
        assert "invite_code" in data
        assert "id" in data
        assert data["member_count"] == 1

    def test_create_room_empty_name(self, client, auth_headers):
        resp = client.post("/api/rooms", json={
            "name": "",
        }, headers=auth_headers)
        assert resp.status_code == 422  # Pydantic validation


class TestListRooms:
    """Test listing user's rooms."""

    def test_list_rooms_empty(self, client, registered_user):
        _, _, headers = registered_user
        resp = client.get("/api/rooms", headers=headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_list_rooms_after_create(self, client, registered_user):
        _, _, headers = registered_user
        client.post("/api/rooms", json={"name": "Room A"}, headers=headers)
        client.post("/api/rooms", json={"name": "Room B"}, headers=headers)

        resp = client.get("/api/rooms", headers=headers)
        assert resp.status_code == 200
        rooms = resp.json()
        assert len(rooms) >= 2
        names = [r["name"] for r in rooms]
        assert "Room A" in names
        assert "Room B" in names


class TestJoinRoom:
    """Test joining rooms via invite code."""

    def test_join_room_success(self, client):
        # Register owner
        reg1 = client.post("/api/auth/register", json={
            "email": "owner_join@test.com", "password": "pass123", "display_name": "Owner"
        })
        owner_headers = {"Authorization": f"Bearer {reg1.json()['token']}"}

        # Create room
        room = client.post("/api/rooms", json={"name": "Join Test"}, headers=owner_headers).json()
        invite_code = room["invite_code"]

        # Register joiner
        reg2 = client.post("/api/auth/register", json={
            "email": "joiner_join@test.com", "password": "pass123", "display_name": "Joiner"
        })
        joiner_headers = {"Authorization": f"Bearer {reg2.json()['token']}"}

        # Join
        resp = client.post(f"/api/rooms/join/{invite_code}", headers=joiner_headers)
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        assert resp.json()["room_id"] == room["id"]

    def test_join_room_invalid_code(self, client, auth_headers):
        resp = client.post("/api/rooms/join/invalid_code_xyz", headers=auth_headers)
        assert resp.status_code == 404

    def test_join_room_already_member(self, client, registered_user):
        _, _, headers = registered_user
        room = client.post("/api/rooms", json={"name": "Already In"}, headers=headers).json()
        resp = client.post(f"/api/rooms/join/{room['invite_code']}", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["already_member"] is True


class TestRoomDetails:
    """Test getting room details."""

    def test_get_room_details(self, client, registered_user):
        _, _, headers = registered_user
        room = client.post("/api/rooms", json={"name": "Detail Room"}, headers=headers).json()

        resp = client.get(f"/api/rooms/{room['id']}", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Detail Room"
        assert "members" in data
        assert "videos" in data
        assert len(data["members"]) == 1

    def test_get_room_not_member(self, client):
        # Owner creates room
        reg1 = client.post("/api/auth/register", json={
            "email": "owner_detail@test.com", "password": "pass123", "display_name": "Owner"
        })
        owner_headers = {"Authorization": f"Bearer {reg1.json()['token']}"}
        room = client.post("/api/rooms", json={"name": "Private"}, headers=owner_headers).json()

        # Non-member tries to access
        reg2 = client.post("/api/auth/register", json={
            "email": "outsider_detail@test.com", "password": "pass123", "display_name": "Outsider"
        })
        outsider_headers = {"Authorization": f"Bearer {reg2.json()['token']}"}

        resp = client.get(f"/api/rooms/{room['id']}", headers=outsider_headers)
        assert resp.status_code == 403


class TestRoomUpdate:
    """Test updating and deleting rooms."""

    def test_update_room_owner(self, client, registered_user):
        _, _, headers = registered_user
        room = client.post("/api/rooms", json={"name": "Old Name"}, headers=headers).json()

        resp = client.put(f"/api/rooms/{room['id']}", json={
            "name": "New Name",
            "description": "Updated desc",
        }, headers=headers)
        assert resp.status_code == 200

    def test_update_room_non_owner(self, client):
        # Owner creates room
        reg1 = client.post("/api/auth/register", json={
            "email": "owner_upd@test.com", "password": "pass123", "display_name": "Owner"
        })
        owner_headers = {"Authorization": f"Bearer {reg1.json()['token']}"}
        room = client.post("/api/rooms", json={"name": "Owner Only"}, headers=owner_headers).json()

        # Joiner tries to update
        reg2 = client.post("/api/auth/register", json={
            "email": "joiner_upd@test.com", "password": "pass123", "display_name": "Joiner"
        })
        joiner_headers = {"Authorization": f"Bearer {reg2.json()['token']}"}
        client.post(f"/api/rooms/join/{room['invite_code']}", headers=joiner_headers)

        resp = client.put(f"/api/rooms/{room['id']}", json={"name": "Hacked"}, headers=joiner_headers)
        assert resp.status_code == 403

    def test_delete_room_owner(self, client, registered_user):
        _, _, headers = registered_user
        room = client.post("/api/rooms", json={"name": "To Delete"}, headers=headers).json()

        resp = client.delete(f"/api/rooms/{room['id']}", headers=headers)
        assert resp.status_code == 200

    def test_delete_room_non_owner(self, client):
        reg1 = client.post("/api/auth/register", json={
            "email": "owner_del@test.com", "password": "pass123", "display_name": "Owner"
        })
        owner_headers = {"Authorization": f"Bearer {reg1.json()['token']}"}
        room = client.post("/api/rooms", json={"name": "No Delete"}, headers=owner_headers).json()

        reg2 = client.post("/api/auth/register", json={
            "email": "joiner_del@test.com", "password": "pass123", "display_name": "Joiner"
        })
        joiner_headers = {"Authorization": f"Bearer {reg2.json()['token']}"}
        client.post(f"/api/rooms/join/{room['invite_code']}", headers=joiner_headers)

        resp = client.delete(f"/api/rooms/{room['id']}", headers=joiner_headers)
        assert resp.status_code == 403


class TestLeaveRoom:
    """Test leaving rooms."""

    def test_leave_room_member(self, client):
        reg1 = client.post("/api/auth/register", json={
            "email": "owner_leave@test.com", "password": "pass123", "display_name": "Owner"
        })
        owner_headers = {"Authorization": f"Bearer {reg1.json()['token']}"}
        room = client.post("/api/rooms", json={"name": "Leave Test"}, headers=owner_headers).json()

        reg2 = client.post("/api/auth/register", json={
            "email": "joiner_leave@test.com", "password": "pass123", "display_name": "Joiner"
        })
        joiner_headers = {"Authorization": f"Bearer {reg2.json()['token']}"}
        client.post(f"/api/rooms/join/{room['invite_code']}", headers=joiner_headers)

        resp = client.post(f"/api/rooms/{room['id']}/leave", headers=joiner_headers)
        assert resp.status_code == 200

    def test_owner_cannot_leave(self, client, registered_user):
        _, _, headers = registered_user
        room = client.post("/api/rooms", json={"name": "Owner Stay"}, headers=headers).json()

        resp = client.post(f"/api/rooms/{room['id']}/leave", headers=headers)
        assert resp.status_code == 400


class TestRoomComments:
    """Test room comment system."""

    def test_post_and_get_comments(self, client, registered_user):
        _, _, headers = registered_user
        room = client.post("/api/rooms", json={"name": "Comment Room"}, headers=headers).json()

        # Post comment
        resp = client.post(f"/api/rooms/{room['id']}/comments", json={
            "content": "Hello everyone!",
            "video_id": "test_vid",
        }, headers=headers)
        assert resp.status_code == 200
        comment = resp.json()
        assert comment["content"] == "Hello everyone!"
        assert "id" in comment

        # Get comments
        resp = client.get(f"/api/rooms/{room['id']}/comments", headers=headers)
        assert resp.status_code == 200
        comments = resp.json()
        assert len(comments) >= 1
        assert comments[0]["content"] == "Hello everyone!"

    def test_delete_own_comment(self, client, registered_user):
        _, _, headers = registered_user
        room = client.post("/api/rooms", json={"name": "Del Comment"}, headers=headers).json()

        comment = client.post(f"/api/rooms/{room['id']}/comments", json={
            "content": "To delete",
        }, headers=headers).json()

        resp = client.delete(f"/api/rooms/{room['id']}/comments/{comment['id']}", headers=headers)
        assert resp.status_code == 200


class TestRoomVideos:
    """Test adding/removing videos in rooms."""

    def test_add_video_to_room(self, client, registered_user):
        _, _, headers = registered_user
        room = client.post("/api/rooms", json={"name": "Video Room"}, headers=headers).json()

        resp = client.post(f"/api/rooms/{room['id']}/videos", json={
            "video_id": "dQw4w9WgXcQ",
            "title": "Test Video",
            "thumbnail": "https://img.youtube.com/vi/dQw4w9WgXcQ/0.jpg",
        }, headers=headers)
        assert resp.status_code == 200

        # Verify video appears in room details
        details = client.get(f"/api/rooms/{room['id']}", headers=headers).json()
        assert len(details["videos"]) == 1
        assert details["videos"][0]["video_id"] == "dQw4w9WgXcQ"

    def test_remove_video_from_room(self, client, registered_user):
        _, _, headers = registered_user
        room = client.post("/api/rooms", json={"name": "Remove Vid"}, headers=headers).json()

        client.post(f"/api/rooms/{room['id']}/videos", json={
            "video_id": "abc123",
            "title": "To Remove",
        }, headers=headers)

        resp = client.delete(f"/api/rooms/{room['id']}/videos/abc123", headers=headers)
        assert resp.status_code == 200
