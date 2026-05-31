"""
AI Study Plan routes — generate personalized learning schedules.
Uses video history, quiz scores, and SRS data to create adaptive study plans.
"""

import os
import re
import json
import time

from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel

from gemini_client import call_gemini, async_call_gemini
from database import db_check_rate_limit
router = APIRouter(prefix="/api", tags=["study-plan"])


# ═══════════════════════════════════════════════════════
# RATE LIMITING
# ═══════════════════════════════════════════════════════

def _get_client_ip(request: Request) -> str:
    """Extract client IP for rate limiting (respects TRUST_PROXY)."""
    from routes.client_ip import get_client_ip
    return get_client_ip(request)


def _make_rate_limiter(endpoint_name: str, max_requests: int = 10, window_secs: int = 300, block_secs: int = 300):
    async def _check(request: Request):
        ip = _get_client_ip(request)
        key = f"ai:{endpoint_name}:{ip}"
        allowed, retry_after = db_check_rate_limit(key, max_attempts=max_requests, window_secs=window_secs, block_secs=block_secs)
        if not allowed:
            raise HTTPException(
                status_code=429,
                detail=f"Quá nhiều yêu cầu. Vui lòng thử lại sau {retry_after} giây."
            )
    return _check


_rl_study_plan = Depends(_make_rate_limiter("study_plan", max_requests=10))


# ═══════════════════════════════════════════════════════
# REQUEST MODELS
# ═══════════════════════════════════════════════════════

class VideoInfo(BaseModel):
    video_id: str
    title: str = ''
    tags: list = []
    quiz_score: int = -1        # -1 means not taken
    quiz_total: int = 0
    has_flashcards: bool = False
    srs_due_count: int = 0
    srs_mastered: int = 0
    srs_total: int = 0
    watch_progress: int = 0     # 0-100 percentage
    analyzed_at: str = ''       # ISO date string


class StudyPlanRequest(BaseModel):
    videos: list = []           # List of VideoInfo dicts
    study_days_per_week: int = 5
    minutes_per_day: int = 30
    goal: str = ''              # User's learning goal (optional)
    output_language: str = 'Vietnamese'
    current_streak: int = 0
    total_study_days: int = 0
    plan_duration_weeks: int = 2  # 1-4 weeks


# ═══════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════

@router.post("/study-plan", dependencies=[_rl_study_plan])
async def generate_study_plan(request: StudyPlanRequest):
    """Generate a personalized AI study plan based on video history and performance."""
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    if not request.videos:
        raise HTTPException(status_code=400, detail="Cần ít nhất 1 video đã phân tích để tạo lộ trình")

    # Build video context for AI
    video_blocks = []
    for i, v in enumerate(request.videos[:20]):  # Cap at 20 videos
        quiz_info = ""
        if v.get("quiz_score", -1) >= 0:
            pct = round(v["quiz_score"] / max(v.get("quiz_total", 1), 1) * 100)
            quiz_info = f"  Quiz: {v['quiz_score']}/{v.get('quiz_total', 0)} ({pct}%)"
            if pct < 60:
                quiz_info += " ⚠️ WEAK"
            elif pct >= 90:
                quiz_info += " ✓ STRONG"
        else:
            quiz_info = "  Quiz: Not taken yet"

        srs_info = ""
        if v.get("srs_total", 0) > 0:
            srs_info = f"  Flashcards: {v.get('srs_mastered', 0)}/{v['srs_total']} mastered, {v.get('srs_due_count', 0)} due"
        elif v.get("has_flashcards"):
            srs_info = "  Flashcards: Available but not reviewed"

        tags_str = ", ".join(v.get("tags", [])) if v.get("tags") else "No tags"
        progress_str = f"  Watch progress: {v.get('watch_progress', 0)}%"

        block = f"""Video {i+1}: {v.get('title', 'Untitled')}
  ID: {v.get('video_id', '')}
  Tags/Topics: {tags_str}
{quiz_info}
{srs_info}
{progress_str}
  Analyzed: {v.get('analyzed_at', 'unknown')}"""
        video_blocks.append(block)

    videos_text = "\n\n".join(video_blocks)

    goal_text = f"\nStudent's goal: {request.goal}" if request.goal else ""
    duration = min(max(request.plan_duration_weeks, 1), 4)

    prompt = f"""You are an expert learning coach and study planner. Create a personalized study plan for a student based on their video lecture history and performance data.

STUDENT PROFILE:
- Study days per week: {request.study_days_per_week}
- Minutes per session: {request.minutes_per_day}
- Current streak: {request.current_streak} days
- Total study days: {request.total_study_days}
- Plan duration: {duration} weeks{goal_text}

ANALYZED VIDEOS ({len(request.videos)} total):
{videos_text}

⚠️ Generate ALL text in **{request.output_language}**.

Create a detailed study plan and return ONLY a valid JSON object (no markdown fences):
{{
  "plan_title": "A motivating title for this study plan",
  "overview": "2-3 sentence overview of the plan strategy",
  "priority_videos": [
    {{
      "video_id": "id of video that needs attention",
      "reason": "Why this video needs review (low quiz score, unreviewed flashcards, etc.)",
      "priority": "high|medium|low"
    }}
  ],
  "weekly_schedule": [
    {{
      "week": 1,
      "theme": "Focus theme for this week",
      "days": [
        {{
          "day": 1,
          "tasks": [
            {{
              "type": "review|quiz|flashcard|rewatch|new",
              "video_id": "related video id or empty",
              "title": "Short task title",
              "description": "What to do",
              "duration_min": 15,
              "priority": "high|medium|low"
            }}
          ]
        }}
      ]
    }}
  ],
  "recommendations": [
    "General study tip 1 based on their performance",
    "General study tip 2",
    "General study tip 3"
  ],
  "milestones": [
    {{
      "target": "What to achieve",
      "by_week": 1,
      "metric": "How to measure success"
    }}
  ]
}}

RULES:
- priority_videos: List 3-5 videos that need the most attention (low quiz scores, unreviewed cards, incomplete)
- weekly_schedule: Create {duration} weeks, each with {request.study_days_per_week} study days
- Each day should have 2-4 tasks that fit within {request.minutes_per_day} minutes total
- Task types: "review" (re-read summary), "quiz" (retake quiz), "flashcard" (SRS review), "rewatch" (watch again), "new" (analyze new content)
- Prioritize videos with low quiz scores (< 60%) for review
- Include daily SRS flashcard review if there are due cards
- Space out difficult content — don't put all hard videos on the same day
- Include rest/light days for sustainability
- milestones: 2-4 achievable goals spread across the plan duration
- Be specific with video references using their IDs
- Make the plan realistic and motivating"""

    try:
        text = await async_call_gemini(prompt)
        text = text.strip()
        if text.startswith('```'):
            text = re.sub(r'^```(?:json)?\s*\n?', '', text)
            text = re.sub(r'\n?\s*```$', '', text)
        result = json.loads(text)

        # Ensure all keys exist
        for key in ["priority_videos", "weekly_schedule", "recommendations", "milestones"]:
            if key not in result:
                result[key] = []
        if "plan_title" not in result:
            result["plan_title"] = "Lộ trình học tập"
        if "overview" not in result:
            result["overview"] = ""

        # Add metadata
        result["generated_at"] = int(time.time() * 1000)
        result["plan_duration_weeks"] = duration
        result["study_days_per_week"] = request.study_days_per_week
        result["minutes_per_day"] = request.minutes_per_day
        result["total_videos"] = len(request.videos)

        return result

    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Không thể phân tích phản hồi AI: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Tạo lộ trình thất bại: {e}")
