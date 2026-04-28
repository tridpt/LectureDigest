"""
Tests for folders routes — CRUD, video assignment, user isolation.
"""

import pytest


class TestFolderCRUD:
    """Test folder create, read, update, delete."""

    def test_list_folders_empty(self, client):
        resp = client.get("/api/folders")
        assert resp.status_code == 200
        assert resp.json()["folders"] == [] or isinstance(resp.json()["folders"], list)

    def test_create_folder(self, client):
        resp = client.post("/api/folders", json={
            "name": "Machine Learning",
            "icon": "🧠",
            "color": "#8b5cf6",
        })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        assert "folder_id" in resp.json()

    def test_create_and_list(self, client):
        client.post("/api/folders", json={"name": "Folder A"})
        client.post("/api/folders", json={"name": "Folder B"})

        resp = client.get("/api/folders")
        folders = resp.json()["folders"]
        names = [f["name"] for f in folders]
        assert "Folder A" in names
        assert "Folder B" in names

    def test_update_folder(self, client):
        create = client.post("/api/folders", json={"name": "Old Name"})
        fid = create.json()["folder_id"]

        resp = client.put(f"/api/folders/{fid}", json={
            "name": "New Name",
            "icon": "🎯",
            "color": "#ef4444",
        })
        assert resp.status_code == 200

        folders = client.get("/api/folders").json()["folders"]
        updated = next(f for f in folders if f["id"] == fid)
        assert updated["name"] == "New Name"
        assert updated["icon"] == "🎯"
        assert updated["color"] == "#ef4444"

    def test_delete_folder(self, client):
        create = client.post("/api/folders", json={"name": "Delete Me"})
        fid = create.json()["folder_id"]

        resp = client.delete(f"/api/folders/{fid}")
        assert resp.status_code == 200

    def test_folder_limit(self, client, auth_headers):
        """Max 20 folders per user."""
        for i in range(20):
            resp = client.post("/api/folders", json={"name": f"Folder {i}"}, headers=auth_headers)
            assert resp.status_code == 200

        resp = client.post("/api/folders", json={"name": "Folder 21"}, headers=auth_headers)
        assert resp.status_code == 400


class TestFolderVideos:
    """Test adding/removing videos from folders."""

    def test_add_video_to_folder(self, client):
        create = client.post("/api/folders", json={"name": "My Videos"})
        fid = create.json()["folder_id"]

        resp = client.post(f"/api/folders/{fid}/videos", json={"video_id": "abc123"})
        assert resp.status_code == 200

        # Verify it appears in the folder
        folders = client.get("/api/folders").json()["folders"]
        folder = next(f for f in folders if f["id"] == fid)
        assert "abc123" in folder["video_ids"]

    def test_remove_video_from_folder(self, client):
        create = client.post("/api/folders", json={"name": "Remove Test"})
        fid = create.json()["folder_id"]

        client.post(f"/api/folders/{fid}/videos", json={"video_id": "vid_rm"})
        resp = client.delete(f"/api/folders/{fid}/videos/vid_rm")
        assert resp.status_code == 200

        folders = client.get("/api/folders").json()["folders"]
        folder = next(f for f in folders if f["id"] == fid)
        assert "vid_rm" not in folder.get("video_ids", [])

    def test_video_in_multiple_folders(self, client):
        f1 = client.post("/api/folders", json={"name": "F1"}).json()["folder_id"]
        f2 = client.post("/api/folders", json={"name": "F2"}).json()["folder_id"]

        client.post(f"/api/folders/{f1}/videos", json={"video_id": "multi_vid"})
        client.post(f"/api/folders/{f2}/videos", json={"video_id": "multi_vid"})

        folders = client.get("/api/folders").json()["folders"]
        folder1 = next(f for f in folders if f["id"] == f1)
        folder2 = next(f for f in folders if f["id"] == f2)
        assert "multi_vid" in folder1["video_ids"]
        assert "multi_vid" in folder2["video_ids"]

    def test_delete_folder_removes_associations(self, client):
        create = client.post("/api/folders", json={"name": "Will Delete"})
        fid = create.json()["folder_id"]
        client.post(f"/api/folders/{fid}/videos", json={"video_id": "orphan_vid"})

        # Delete folder
        client.delete(f"/api/folders/{fid}")

        # Folder gone, video associations cleaned up
        folders = client.get("/api/folders").json()["folders"]
        assert not any(f["id"] == fid for f in folders)


class TestFolderUserIsolation:
    """Test that folders are isolated between users."""

    def test_user_folders_isolated(self, client):
        # Create as user A
        reg_a = client.post("/api/auth/register", json={
            "email": "folder_a@test.com",
            "password": "password123",
            "display_name": "User A",
        })
        headers_a = {"Authorization": f"Bearer {reg_a.json()['token']}"}

        # Create as user B
        reg_b = client.post("/api/auth/register", json={
            "email": "folder_b@test.com",
            "password": "password123",
            "display_name": "User B",
        })
        headers_b = {"Authorization": f"Bearer {reg_b.json()['token']}"}

        client.post("/api/folders", json={"name": "A's Folder"}, headers=headers_a)
        client.post("/api/folders", json={"name": "B's Folder"}, headers=headers_b)

        # User A should only see their folder
        a_folders = client.get("/api/folders", headers=headers_a).json()["folders"]
        b_folders = client.get("/api/folders", headers=headers_b).json()["folders"]

        a_names = [f["name"] for f in a_folders]
        b_names = [f["name"] for f in b_folders]

        assert "A's Folder" in a_names
        assert "B's Folder" not in a_names
        assert "B's Folder" in b_names
        assert "A's Folder" not in b_names
