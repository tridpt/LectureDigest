"""
Tests for AI Study Plan route — generate personalized learning schedules.
Gemini calls are mocked.
"""

import pytest
from unittest.mock import patch


class TestStudyPlan:
    """Test POST /api/study-plan."""

    @patch("routes.study_plan.call_gemini")
    def test_generate_plan_success(self, mock_gemini, client):
        mock_gemini.return_value = """{
            "plan_title": "2-Week Python Mastery Plan",
            "overview": "Focus on weak areas and build consistent study habits.",
            "priority_videos": [
                {"video_id": "abc123", "reason": "Low quiz score (40%)", "priority": "high"}
            ],
            "weekly_schedule": [
                {
                    "week": 1,
                    "theme": "Foundation Review",
                    "days": [
                        {
                            "day": 1,
                            "tasks": [
                                {
                                    "type": "review",
                                    "video_id": "abc123",
                                    "title": "Review Python Basics",
                                    "description": "Re-read summary and key takeaways",
                                    "duration_min": 15,
                                    "priority": "high"
                                }
                            ]
                        }
                    ]
                }
            ],
            "recommendations": [
                "Focus on recursion concepts",
                "Practice daily flashcard review"
            ],
            "milestones": [
                {"target": "Score 80%+ on Python quiz", "by_week": 1, "metric": "Quiz score"}
            ]
        }"""

        resp = client.post("/api/study-plan", json={
            "videos": [
                {
                    "video_id": "abc123",
                    "title": "Python Basics",
                    "quiz_score": 4,
                    "quiz_total": 10,
                    "watch_progress": 100,
                }
            ],
            "study_days_per_week": 5,
            "minutes_per_day": 30,
            "output_language": "English",
            "plan_duration_weeks": 2,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "plan_title" in data
        assert "weekly_schedule" in data
        assert "priority_videos" in data
        assert "recommendations" in data
        assert data["plan_duration_weeks"] == 2

    def test_generate_plan_no_videos(self, client):
        resp = client.post("/api/study-plan", json={
            "videos": [],
            "study_days_per_week": 5,
            "minutes_per_day": 30,
        })
        assert resp.status_code == 400

    @patch("routes.study_plan.call_gemini")
    def test_generate_plan_with_goal(self, mock_gemini, client):
        mock_gemini.return_value = """{
            "plan_title": "Goal-Oriented Plan",
            "overview": "Tailored to your goal.",
            "priority_videos": [],
            "weekly_schedule": [{"week": 1, "theme": "Start", "days": []}],
            "recommendations": ["Keep going!"],
            "milestones": []
        }"""

        resp = client.post("/api/study-plan", json={
            "videos": [{"video_id": "v1", "title": "Intro"}],
            "goal": "Pass the final exam",
            "output_language": "Vietnamese",
        })
        assert resp.status_code == 200
        assert "plan_title" in resp.json()

    def test_generate_plan_no_api_key(self, client, monkeypatch):
        """Without GEMINI_API_KEY, should return 500."""
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        resp = client.post("/api/study-plan", json={
            "videos": [{"video_id": "v1", "title": "Test"}],
        })
        assert resp.status_code == 500
