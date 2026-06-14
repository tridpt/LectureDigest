"""
Tests for content routes — exercises, multi-video exam, playlist.
Focus on validation paths that return before any Gemini/network call.
"""

import pytest


class TestExercisesValidation:
    """POST /api/exercises input validation (no AI call)."""

    def test_missing_gemini_key_returns_500(self, client, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        resp = client.post("/api/exercises", json={
            "title": "X", "transcript": [{"text": "hi", "start": 0}],
        })
        assert resp.status_code == 500

    def test_no_transcript_or_topics_returns_400(self, client, monkeypatch):
        # Key present so we reach the content validation, not the key check.
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        resp = client.post("/api/exercises", json={
            "title": "Empty", "transcript": [], "topics": [],
        })
        assert resp.status_code == 400


class TestMultiExamValidation:
    """POST /api/multi-exam input validation (no AI call)."""

    def test_missing_gemini_key_returns_500(self, client, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        resp = client.post("/api/multi-exam", json={
            "videos": [{"title": "A"}, {"title": "B"}],
        })
        assert resp.status_code == 500

    def test_fewer_than_two_videos_returns_400(self, client, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        resp = client.post("/api/multi-exam", json={"videos": [{"title": "Only one"}]})
        assert resp.status_code == 400

    def test_zero_videos_returns_400(self, client, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        resp = client.post("/api/multi-exam", json={"videos": []})
        assert resp.status_code == 400


class TestPlaylistValidation:
    """POST /api/playlist — invalid URLs are rejected before any network call."""

    @pytest.mark.parametrize("url", [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",  # no list= param
        "not-a-url",
        "https://example.com/playlist",
    ])
    def test_invalid_playlist_url_returns_400(self, client, url):
        resp = client.post("/api/playlist", json={"url": url})
        assert resp.status_code == 400
