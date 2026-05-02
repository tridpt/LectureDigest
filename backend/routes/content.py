"""
Content generation routes — exercises, multi-video exam, playlist.
"""

import os
import re
import json
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from gemini_client import call_gemini
from youtube import extract_playlist_id, fetch_playlist_videos

router = APIRouter(prefix="/api", tags=["content"])
logger = logging.getLogger("content")


# ═══════════════════════════════════════════════════════
# EXERCISES
# ═══════════════════════════════════════════════════════

class ExerciseRequest(BaseModel):
    title: str = ''
    transcript: list = []        # [{text, start}, ...]
    topics: list = []            # [{title, summary}, ...]
    key_takeaways: list = []
    output_language: str = 'Vietnamese'


@router.post("/exercises")
async def generate_exercises(request: ExerciseRequest):
    """Generate diverse exercise types from a video transcript."""
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    if not request.transcript and not request.topics:
        raise HTTPException(status_code=400, detail="transcript or topics required")

    # Build content context
    content_block = f"VIDEO TITLE: {request.title}\n\n"

    if request.transcript:
        lines = []
        for entry in request.transcript:
            text = entry.get("text", "").strip().replace("\n", " ")
            lines.append(text)
        transcript_text = " ".join(lines)
        if len(transcript_text) > 30000:
            transcript_text = transcript_text[:30000] + "...[truncated]..."
        content_block += f"TRANSCRIPT:\n{transcript_text}\n\n"

    if request.topics:
        topics_text = "\n".join(
            f"- {t.get('title', '')}: {t.get('summary', '')}" for t in request.topics[:8]
        )
        content_block += f"TOPICS:\n{topics_text}\n\n"

    if request.key_takeaways:
        kt_text = "\n".join(f"- {kt}" for kt in request.key_takeaways[:6])
        content_block += f"KEY TAKEAWAYS:\n{kt_text}\n\n"

    prompt = f"""You are an expert educational content creator. Create diverse exercises based on this video lecture content.

{content_block}

⚠️ Generate ALL text in **{request.output_language}**.

Create exercises in 4 different formats. Return ONLY a valid JSON object (no markdown fences, no extra text):

{{
  "fill_blank": [
    {{
      "sentence": "A sentence with a key term replaced by ____ (use exactly 4+ underscores for the blank)",
      "answer": "The correct word/phrase that fills the blank",
      "hint": "A short hint to help the student (optional, can be empty string)",
      "explanation": "Brief explanation of why this is the answer"
    }}
  ],
  "true_false": [
    {{
      "statement": "A declarative statement that is either true or false",
      "answer": true,
      "explanation": "Why this statement is true/false based on the lecture content"
    }}
  ],
  "matching": [
    {{
      "term": "A key term or concept from the lecture",
      "definition": "The correct definition or description of that term"
    }}
  ],
  "short_answer": [
    {{
      "question": "An open-ended question requiring a short written answer",
      "model_answer": "A complete model answer (2-4 sentences)",
      "hint": "A hint to guide the student",
      "key_points": ["Point 1 the answer should cover", "Point 2"]
    }}
  ]
}}

REQUIREMENTS:
- Generate 5-6 fill_blank items — use important terms/concepts from the lecture
- Generate 5-6 true_false items — mix of true and false statements (roughly equal)
- Generate 5-6 matching pairs — key terms matched with their definitions
- Generate 3-4 short_answer items — deeper questions requiring understanding
- All content must be based ONLY on the lecture content
- fill_blank: The blank should replace a KEY concept word, not trivial words
- true_false: Make false statements plausible (common misconceptions)
- matching: Terms and definitions should be clearly distinct from each other
- short_answer: Questions should test understanding, not just recall
- Return ONLY the JSON object — no markdown, no extra text, no code fences"""

    try:
        text = call_gemini(prompt)
        text = text.strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*\n?", "", text)
            text = re.sub(r"\n?\s*```$", "", text)
        result = json.loads(text)

        for key in ["fill_blank", "true_false", "matching", "short_answer"]:
            if key not in result:
                result[key] = []

        for item in result.get("true_false", []):
            if isinstance(item.get("answer"), str):
                item["answer"] = item["answer"].lower() in ("true", "đúng", "yes")

        return result

    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Exercise generation failed: {e}")


# ═══════════════════════════════════════════════════════
# MULTI-VIDEO EXAM
# ═══════════════════════════════════════════════════════

class MultiExamVideo(BaseModel):
    title: str
    overview: str = ''
    topics: list = []
    key_takeaways: list = []

class MultiExamRequest(BaseModel):
    videos: list[MultiExamVideo]
    num_questions: int = 20
    output_language: str = 'Vietnamese'


@router.post("/multi-exam")
async def generate_multi_exam(request: MultiExamRequest):
    """Generate a comprehensive exam combining content from multiple analyzed videos."""
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    if len(request.videos) < 2:
        raise HTTPException(status_code=400, detail="At least 2 videos are required")

    content_blocks = []
    for i, v in enumerate(request.videos, 1):
        block = f"--- VIDEO {i}: {v.title} ---\n"
        if v.overview:
            block += f"Overview: {v.overview}\n"
        if v.topics:
            topics_text = "\n".join(
                f"  - {t.get('title', '')}: {t.get('summary', '')}"
                for t in v.topics[:8]
            )
            block += f"Topics:\n{topics_text}\n"
        if v.key_takeaways:
            kt_text = "\n".join(f"  - {kt}" for kt in v.key_takeaways[:5])
            block += f"Key Takeaways:\n{kt_text}\n"
        content_blocks.append(block)

    combined_content = "\n\n".join(content_blocks)
    if len(combined_content) > 30000:
        combined_content = combined_content[:30000] + "\n...[truncated]..."

    num_q = min(max(request.num_questions, 5), 40)
    video_titles = [v.title for v in request.videos]

    prompt = f"""You are an expert educational exam creator. Create a comprehensive exam that tests knowledge across multiple video lectures.

CONTENT FROM {len(request.videos)} VIDEOS:
{combined_content}

⚠️ Generate ALL text in **{request.output_language}**.

Create exactly {num_q} multiple choice questions that:
- Cover ALL videos proportionally (spread questions across videos)
- Include CROSS-VIDEO questions that connect concepts between different videos (at least 3-4)
- Use varied difficulty: ~30% easy, ~50% medium, ~20% hard
- Use varied styles: recall, conceptual, application, comparison, critical thinking
- For cross-video questions, mention which videos the question relates to

For each question, include a "source" field indicating which video(s) it relates to. Use the exact video titles.

Return ONLY a valid JSON object (no markdown fences, no extra text):
{{
  "exam_title": "A descriptive exam title",
  "questions": [
    {{
      "id": 1,
      "question": "Question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_index": 0,
      "explanation": "Detailed explanation of why the correct answer is right",
      "difficulty": "easy|medium|hard",
      "source": ["Video title 1"],
      "is_cross_video": false
    }}
  ]
}}

correct_index is 0-based (0=A, 1=B, 2=C, 3=D).
For cross-video questions, set is_cross_video to true and list multiple video titles in source."""

    try:
        text = call_gemini(prompt)
        text = text.strip()
        if text.startswith('```'):
            text = re.sub(r'^```(?:json)?\s*\n?', '', text)
            text = re.sub(r'\n?\s*```$', '', text)
        result = json.loads(text)
        result["video_count"] = len(request.videos)
        result["video_titles"] = video_titles
        return result
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Multi-exam generation failed: {e}")


# ═══════════════════════════════════════════════════════
# PLAYLIST / COURSE MODE
# ═══════════════════════════════════════════════════════

class PlaylistRequest(BaseModel):
    url: str


@router.post("/playlist")
async def get_playlist_info(request: PlaylistRequest):
    """Fetch video list from a YouTube playlist URL."""
    try:
        playlist_id = extract_playlist_id(request.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        result = fetch_playlist_videos(playlist_id)
        logger.info("Playlist: %s (%d videos)", result['title'], result['video_count'])
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Playlist error: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to load playlist: {e}")
