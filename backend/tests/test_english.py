"""
Tests for English learning module — vocabulary, review, stats, missions.
Note: Tests that call Gemini AI are mocked to avoid API costs.
"""

import pytest
from unittest.mock import patch


class TestEnglishUnauthenticated:
    """Endpoints that require auth should return 401."""

    def test_get_today_no_auth(self, client):
        resp = client.get("/api/english/today")
        assert resp.status_code == 401

    def test_get_review_no_auth(self, client):
        resp = client.get("/api/english/review")
        assert resp.status_code == 401

    def test_get_stats_no_auth(self, client):
        resp = client.get("/api/english/stats")
        assert resp.status_code == 401

    def test_get_topics_no_auth(self, client):
        resp = client.get("/api/english/topics")
        assert resp.status_code == 401


class TestEnglishWords:
    """Test vocabulary CRUD operations."""

    def test_get_today_empty(self, client, auth_headers):
        resp = client.get("/api/english/today", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "words" in data

    def test_add_word_manual(self, client, auth_headers):
        resp = client.post("/api/english/add-word", json={
            "word": "serendipity",
            "meaning": "the occurrence of events by chance in a happy way",
            "example": "Finding that book was pure serendipity.",
            "part_of_speech": "noun",
            "topic": "general",
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["word"] == "serendipity"

    def test_add_word_missing_fields(self, client, auth_headers):
        resp = client.post("/api/english/add-word", json={
            "word": "",
            "meaning": "",
        }, headers=auth_headers)
        assert resp.status_code == 400

    def test_get_all_words(self, client, auth_headers):
        # Add a word first
        client.post("/api/english/add-word", json={
            "word": "ubiquitous",
            "meaning": "present everywhere",
            "part_of_speech": "adjective",
            "topic": "tech",
        }, headers=auth_headers)

        resp = client.get("/api/english/all", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "words" in data
        assert "total" in data

    def test_get_all_words_pagination(self, client, auth_headers):
        resp = client.get("/api/english/all?page=1&per_page=5", headers=auth_headers)
        assert resp.status_code == 200

    def test_get_all_words_filter_topic(self, client, auth_headers):
        resp = client.get("/api/english/all?topic=tech", headers=auth_headers)
        assert resp.status_code == 200


class TestEnglishReview:
    """Test SRS review system."""

    def test_get_review_words(self, client, auth_headers):
        # Add a word first
        client.post("/api/english/add-word", json={
            "word": "paradigm",
            "meaning": "a typical example or pattern",
            "part_of_speech": "noun",
        }, headers=auth_headers)

        resp = client.get("/api/english/review", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "words" in data


class TestEnglishStats:
    """Test stats and XP system."""

    def test_get_stats(self, client, auth_headers):
        resp = client.get("/api/english/stats", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "total_words" in data

    def test_get_topics(self, client, auth_headers):
        resp = client.get("/api/english/topics", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "topics" in data

    def test_get_xp(self, client, auth_headers):
        resp = client.get("/api/english/xp", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "xp" in data
        assert "level" in data

    def test_get_leaderboard(self, client, auth_headers):
        resp = client.get("/api/english/leaderboard", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "leaderboard" in data


class TestEnglishMissions:
    """Test daily missions system."""

    def test_get_daily_missions(self, client, auth_headers):
        resp = client.get("/api/english/missions", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "missions" in data

    def test_update_study_time(self, client, auth_headers):
        resp = client.post("/api/english/study-time", json={
            "seconds": 900,
        }, headers=auth_headers)
        assert resp.status_code == 200

    def test_get_study_time(self, client, auth_headers):
        resp = client.get("/api/english/study-time", headers=auth_headers)
        assert resp.status_code == 200


class TestEnglishGenerateVocab:
    """Test AI vocabulary generation (mocked)."""

    @patch("routes.english.call_gemini")
    def test_generate_vocab_mocked(self, mock_gemini, client, auth_headers):
        """Test generate endpoint with mocked Gemini response."""
        mock_gemini.return_value = """[
            {
                "word": "algorithm",
                "meaning": "a process or set of rules to be followed",
                "example": "The sorting algorithm runs in O(n log n) time.",
                "phonetic": "/ˈælɡəˌrɪðəm/",
                "part_of_speech": "noun",
                "level": "intermediate"
            }
        ]"""

        resp = client.post("/api/english/generate-vocab", json={
            "topic": "computer science",
            "count": 1,
        }, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "words" in data
