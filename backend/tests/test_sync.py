"""
Tests for database sync routes — history, notes, bookmarks, gamification, shared notes.
"""

import pytest


class TestHistory:
    """Test /api/db/history CRUD."""

    def test_get_history_empty(self, client):
        resp = client.get("/api/db/history")
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "has_more" in data
        assert data["items"] == []
        assert data["has_more"] is False

    def test_save_and_get_history(self, client):
        entry = {
            "entry_id": "test_vid_001",
            "video_id": "abc123",
            "url": "https://youtube.com/watch?v=abc123",
            "title": "Test Video",
            "author": "Test Author",
            "thumbnail": "https://img.youtube.com/vi/abc123/mqdefault.jpg",
            "savedAt": 1700000000000,
            "lang": "en",
            "data": {"topics": [], "quiz": []},
        }
        resp = client.post("/api/db/history", json=entry)
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        # Verify it's in the list
        resp = client.get("/api/db/history")
        items = resp.json()["items"]
        assert any(h["entry_id"] == "test_vid_001" for h in items)

    def test_delete_history(self, client):
        entry = {
            "entry_id": "delete_me_001",
            "video_id": "del123",
            "title": "Delete Me",
        }
        client.post("/api/db/history", json=entry)
        resp = client.delete("/api/db/history/delete_me_001")
        assert resp.status_code == 200

    def test_clear_history(self, client):
        resp = client.delete("/api/db/history")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_bulk_save_history(self, client):
        entries = [
            {"entry_id": f"bulk_{i}", "video_id": f"vid_{i}", "title": f"Bulk {i}"}
            for i in range(3)
        ]
        resp = client.post("/api/db/history/bulk", json=entries)
        assert resp.status_code == 200
        assert resp.json()["saved"] == 3

    def test_history_user_isolation(self, client):
        """Authenticated user's history is separate from anonymous."""
        # Save as anonymous
        client.post("/api/db/history", json={
            "entry_id": "anon_entry",
            "video_id": "anon_vid",
            "title": "Anonymous Video",
        })

        # Register and save as user
        reg = client.post("/api/auth/register", json={
            "email": "histuser@test.com",
            "password": "password123",
            "display_name": "Hist User",
        })
        headers = {"Authorization": f"Bearer {reg.json()['token']}"}

        client.post("/api/db/history", json={
            "entry_id": "user_entry",
            "video_id": "user_vid",
            "title": "User Video",
        }, headers=headers)

        # User should only see their own
        resp = client.get("/api/db/history", headers=headers)
        entries = resp.json()["items"]
        entry_ids = [e["entry_id"] for e in entries]
        assert "user_entry" in entry_ids
        assert "anon_entry" not in entry_ids


class TestNotes:
    """Test /api/db/notes CRUD."""

    def test_get_notes_empty(self, client):
        resp = client.get("/api/db/notes/nonexistent_video")
        assert resp.status_code == 200
        assert resp.json()["content"] == ""

    def test_save_and_get_notes(self, client):
        resp = client.put("/api/db/notes/vid_notes_test", json={
            "content": "These are my study notes!",
        })
        assert resp.status_code == 200

        resp = client.get("/api/db/notes/vid_notes_test")
        assert resp.json()["content"] == "These are my study notes!"

    def test_update_notes(self, client):
        client.put("/api/db/notes/vid_update", json={"content": "Version 1"})
        client.put("/api/db/notes/vid_update", json={"content": "Version 2"})

        resp = client.get("/api/db/notes/vid_update")
        assert resp.json()["content"] == "Version 2"


class TestBookmarks:
    """Test /api/db/bookmarks CRUD."""

    def test_get_bookmarks_empty(self, client):
        resp = client.get("/api/db/bookmarks/nonexistent_video")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_sync_and_get_bookmarks(self, client):
        bookmarks = [
            {"time": 30, "label": "Important concept", "createdAt": "2024-01-01"},
            {"time": 120, "label": "Example code", "createdAt": "2024-01-01"},
        ]
        resp = client.put("/api/db/bookmarks/vid_bm_test", json=bookmarks)
        assert resp.status_code == 200

        resp = client.get("/api/db/bookmarks/vid_bm_test")
        bms = resp.json()
        assert len(bms) == 2
        assert bms[0]["time"] == 30
        assert bms[1]["label"] == "Example code"

    def test_sync_replaces_bookmarks(self, client):
        client.put("/api/db/bookmarks/vid_replace", json=[
            {"time": 10, "label": "Old bookmark"},
        ])
        client.put("/api/db/bookmarks/vid_replace", json=[
            {"time": 50, "label": "New bookmark"},
        ])
        resp = client.get("/api/db/bookmarks/vid_replace")
        bms = resp.json()
        assert len(bms) == 1
        assert bms[0]["label"] == "New bookmark"


class TestGamification:
    """Test /api/db/gamification CRUD."""

    def test_get_gamification_default(self, client):
        resp = client.get("/api/db/gamification")
        assert resp.status_code == 200
        assert isinstance(resp.json(), dict)

    def test_save_and_get_gamification(self, client):
        data = {
            "currentStreak": 5,
            "bestStreak": 10,
            "totalVideos": 20,
        }
        resp = client.put("/api/db/gamification", json=data)
        assert resp.status_code == 200

        resp = client.get("/api/db/gamification")
        result = resp.json()
        assert result["currentStreak"] == 5
        assert result["bestStreak"] == 10


class TestFullSync:
    """Test POST /api/db/sync (full sync endpoint)."""

    def test_full_sync(self, client):
        payload = {
            "history": [
                {"entry_id": "sync_1", "video_id": "sv1", "title": "Sync Video 1"},
            ],
            "notes": {
                "sv1": "Synced notes for video 1",
            },
            "bookmarks": {
                "sv1": [{"time": 60, "label": "Synced bookmark"}],
            },
            "gamification": {"currentStreak": 3},
            "extra_data": {},
        }
        resp = client.post("/api/db/sync", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert len(data["history"]) >= 1
        assert "sv1" in data["notes"]
        assert "sv1" in data["bookmarks"]


class TestSharedNotes:
    """Test shared notes create and retrieve."""

    def test_create_shared_notes(self, client):
        resp = client.post("/api/share-notes", json={
            "video_id": "shared_vid_1",
            "title": "Shared Video",
            "author": "Author",
            "notes": "These are shared notes",
            "bookmarks": [{"time": 30, "label": "Key moment"}],
            "overview": "An overview",
            "shared_by": "tester",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert "share_id" in data
        assert "share_url" in data

    def test_get_shared_notes(self, client):
        # Create first
        create_resp = client.post("/api/share-notes", json={
            "video_id": "shared_vid_2",
            "title": "Get Test",
            "notes": "Notes content",
            "bookmarks": [],
        })
        share_id = create_resp.json()["share_id"]

        # Retrieve
        resp = client.get(f"/api/shared-notes/{share_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "Get Test"
        assert data["notes"] == "Notes content"
        assert isinstance(data["bookmarks"], list)

    def test_get_nonexistent_shared_notes(self, client):
        resp = client.get("/api/shared-notes/nonexistent_id")
        assert resp.status_code == 404

    def test_create_empty_shared_notes(self, client):
        resp = client.post("/api/share-notes", json={
            "video_id": "empty_vid",
            "notes": "",
            "bookmarks": [],
        })
        assert resp.status_code == 400
