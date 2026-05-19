"""
Tests for AI tools routes — quiz regen, chat, translate, concept explainer, auto-notes.
All Gemini calls are mocked to avoid API costs.
"""

import pytest
from unittest.mock import patch


class TestQuizRegeneration:
    """Test POST /api/quiz."""

    @patch("routes.ai_tools.call_gemini")
    def test_quiz_regen_success(self, mock_gemini, client):
        mock_gemini.return_value = """[
            {
                "id": 1,
                "question": "What is Python?",
                "options": ["A language", "A snake", "A framework", "A database"],
                "correct_index": 0,
                "explanation": "Python is a programming language",
                "timestamp": 30,
                "timestamp_str": "00:30",
                "difficulty": "easy"
            }
        ]"""

        resp = client.post("/api/quiz", json={
            "transcript": [{"text": "Python is a programming language", "start": 0}],
            "output_language": "English",
            "title": "Python Basics",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "quiz" in data
        assert len(data["quiz"]) >= 1

    def test_quiz_regen_missing_transcript(self, client):
        resp = client.post("/api/quiz", json={
            "output_language": "English",
        })
        assert resp.status_code == 422  # Missing required field


class TestAIChat:
    """Test POST /api/chat."""

    @patch("routes.ai_tools.call_gemini")
    def test_chat_success(self, mock_gemini, client):
        mock_gemini.return_value = "Python was created by Guido van Rossum in 1991."

        resp = client.post("/api/chat", json={
            "message": "Who created Python?",
            "transcript": [{"text": "Python was created by Guido van Rossum.", "start": 0}],
            "title": "History of Python",
            "history": [],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "reply" in data
        assert len(data["reply"]) > 0

    def test_chat_empty_message(self, client):
        resp = client.post("/api/chat", json={
            "message": "",
            "transcript": [{"text": "Some content", "start": 0}],
        })
        # Empty message should fail
        assert resp.status_code in (400, 422)


class TestTranslate:
    """Test POST /api/translate-transcript."""

    @patch("routes.ai_tools.call_gemini")
    def test_translate_success(self, mock_gemini, client):
        mock_gemini.return_value = """[
            {"start": 0, "text": "Xin chào thế giới"}
        ]"""

        resp = client.post("/api/translate-transcript", json={
            "transcript": [{"start": 0, "text": "Hello world"}],
            "target_language": "Vietnamese",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "translations" in data


class TestExplainConcept:
    """Test POST /api/explain-concept."""

    @patch("routes.ai_tools.call_gemini")
    def test_explain_success(self, mock_gemini, client):
        mock_gemini.return_value = """Machine learning is a subset of AI that enables systems to learn from data."""

        resp = client.post("/api/explain-concept", json={
            "term": "machine learning",
            "context": "AI and data science lecture",
            "language": "en",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "explanation" in data
        assert len(data["explanation"]) > 0

    def test_explain_missing_term(self, client):
        resp = client.post("/api/explain-concept", json={
            "context": "Some context",
        })
        assert resp.status_code == 422


class TestAutoNotes:
    """Test POST /api/auto-notes."""

    @patch("routes.ai_tools.call_gemini")
    def test_auto_notes_success(self, mock_gemini, client):
        mock_gemini.return_value = """# Lecture Notes\n\n## Key Points\n- Python is versatile"""

        resp = client.post("/api/auto-notes", json={
            "title": "Python Basics",
            "overview": "An intro to Python",
            "topics": [{"title": "Intro", "summary": "Getting started", "timestamp_str": "00:00"}],
            "key_takeaways": ["Python is easy to learn"],
            "transcript": [{"text": "Python is a versatile language.", "start": 0}],
            "output_language": "English",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "notes" in data
        assert len(data["notes"]) > 0


class TestSmartBookmark:
    """Test POST /api/smart-bookmark."""

    @patch("routes.ai_tools.call_gemini")
    def test_smart_bookmark_success(self, mock_gemini, client):
        mock_gemini.return_value = "The speaker introduces the concept of recursion."

        resp = client.post("/api/smart-bookmark", json={
            "title": "Algorithms 101",
            "timestamp": 330,
            "transcript_context": [{"text": "Let me show you recursion.", "start": 325}],
            "output_language": "English",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "summary" in data


class TestQuizAnalysis:
    """Test POST /api/quiz-analysis."""

    @patch("routes.ai_tools.call_gemini")
    def test_quiz_analysis_success(self, mock_gemini, client):
        mock_gemini.return_value = """{
            "weak_areas": ["recursion"],
            "strong_areas": ["basic syntax"],
            "recommendations": ["Review recursion concepts"],
            "overall_assessment": "Good foundation"
        }"""

        resp = client.post("/api/quiz-analysis", json={
            "questions": [
                {"question": "What is recursion?", "options": ["A", "B", "C", "D"], "correct_index": 0, "difficulty": "medium"}
            ],
            "user_answers": [1],
            "score": 0,
            "total_answered": 1,
            "output_language": "English",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "weak_areas" in data or "analysis" in data

    def test_quiz_analysis_no_questions(self, client):
        resp = client.post("/api/quiz-analysis", json={
            "questions": [],
            "user_answers": [],
        })
        assert resp.status_code == 400
