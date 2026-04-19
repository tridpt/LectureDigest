import os
import re
import json
import urllib.request
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from youtube_transcript_api import YouTubeTranscriptApi
from google import genai
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="LectureDigest API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

api_key = os.getenv("GEMINI_API_KEY")
_genai_client: genai.Client | None = None

def get_genai_client() -> genai.Client:
    global _genai_client
    if _genai_client is None:
        _genai_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    return _genai_client


class VideoRequest(BaseModel):
    url: str
    language: str = 'en'            # transcript language preference
    output_language: str = 'English'  # AI response language


def extract_video_id(url: str) -> str:
    """Extract YouTube video ID from various URL formats."""
    patterns = [
        r'(?:youtube\.com/watch\?v=)([a-zA-Z0-9_-]{11})',
        r'(?:youtu\.be/)([a-zA-Z0-9_-]{11})',
        r'(?:youtube\.com/embed/)([a-zA-Z0-9_-]{11})',
        r'(?:youtube\.com/v/)([a-zA-Z0-9_-]{11})',
        r'(?:youtube\.com/shorts/)([a-zA-Z0-9_-]{11})',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    if re.match(r'^[a-zA-Z0-9_-]{11}$', url.strip()):
        return url.strip()
    raise ValueError("Invalid YouTube URL or video ID")


def format_seconds(seconds: float) -> str:
    """Convert seconds to HH:MM:SS or MM:SS format."""
    seconds = int(seconds)
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def get_video_info(video_id: str) -> dict:
    """Get video title and author from YouTube oEmbed (no API key needed)."""
    try:
        url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=8) as response:
            data = json.loads(response.read())
            return {
                "title": data.get("title", ""),
                "author": data.get("author_name", ""),
                "thumbnail": f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg",
            }
    except Exception:
        return {
            "title": "",
            "author": "",
            "thumbnail": f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg",
        }


def _snippets_to_list(fetched) -> list:
    """Convert FetchedTranscript (v1.x) or raw list (v0.x) to uniform list of dicts."""
    result = []
    for item in fetched:
        if isinstance(item, dict):
            result.append({"text": item.get("text", ""), "start": item.get("start", 0)})
        else:
            # TranscriptSnippet object (v1.x)
            result.append({"text": getattr(item, "text", ""), "start": getattr(item, "start", 0)})
    return result


def get_transcript(video_id: str, language: str = "en") -> list:
    """Fetch transcript with graceful language fallback.
    Compatible with youtube-transcript-api v0.x and v1.x.
    """
    try:
        # v1.x uses instance; v0.x used class method — try v1.x first
        api = YouTubeTranscriptApi()
        transcript_list = api.list(video_id)
    except (TypeError, AttributeError):
        # Fallback: old v0.x class-method style
        try:
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)  # type: ignore[attr-defined]
        except Exception as e:
            raise HTTPException(
                status_code=404,
                detail=f"Could not fetch transcript. ({str(e)})",
            )
    except Exception as e:
        raise HTTPException(
            status_code=404,
            detail=f"Could not fetch transcript. This video may not have captions enabled. ({str(e)})",
        )

    # Priority order: manual preferred lang → generated preferred lang → manual EN → generated EN → any
    attempts = []
    if language != "en":
        attempts += [
            lambda: transcript_list.find_manually_created_transcript([language]),
            lambda: transcript_list.find_generated_transcript([language]),
        ]
    attempts += [
        lambda: transcript_list.find_manually_created_transcript(["en"]),
        lambda: transcript_list.find_generated_transcript(["en"]),
    ]

    for attempt in attempts:
        try:
            return _snippets_to_list(attempt().fetch())
        except Exception:
            continue

    # Last resort: first available transcript
    try:
        for transcript in transcript_list:
            return _snippets_to_list(transcript.fetch())
    except Exception:
        pass

    raise HTTPException(
        status_code=404,
        detail="No transcripts found for this video. Please try a video with captions enabled.",
    )


@app.post("/api/analyze")
async def analyze_video(request: VideoRequest):
    """Analyze a YouTube video: return summary, chapters, key takeaways, and quiz."""

    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured in .env")

    # 1. Validate & extract video ID
    try:
        video_id = extract_video_id(request.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # 2. Fetch metadata & transcript
    video_info = get_video_info(video_id)
    transcript_data = get_transcript(video_id, request.language)

    # 3. Format transcript with timestamps
    lines = []
    for entry in transcript_data:
        time_str = format_seconds(entry["start"])
        text = entry["text"].strip().replace("\n", " ")
        lines.append(f"[{time_str}] {text}")

    full_transcript = "\n".join(lines)

    # 4. Limit transcript length for very long videos (keep start + mid + end)
    if len(full_transcript) > 60000:
        chunk = 18000
        mid = len(full_transcript) // 2
        full_transcript = (
            full_transcript[:chunk]
            + "\n...[middle section]...\n"
            + full_transcript[mid - chunk // 2 : mid + chunk // 2]
            + "\n...[end section]...\n"
            + full_transcript[-chunk:]
        )

    # 5. Build AI prompt
    prompt = f"""You are an expert educational content analyzer. Analyze this YouTube video transcript carefully.

VIDEO INFO:
Title: {video_info.get("title", "Unknown")}
Author: {video_info.get("author", "Unknown")}

TRANSCRIPT (with timestamps):
{full_transcript}

⚠️ IMPORTANT: Generate ALL text in **{request.output_language}** — this includes the title, overview,
topic titles, topic summaries, key takeaways, quiz questions, answer options, and explanations.
Only timestamps and numeric values remain language-neutral.

Analyze this lecture and return a JSON object with the EXACT structure below.
Be thorough, accurate, and educational in your analysis.

{{
  "title": "The actual or improved title of this lecture",
  "author": "The speaker/channel name",
  "overview": "A comprehensive 3-4 sentence overview of what this video covers and what learners will gain",
  "total_duration": "Estimated total duration from the transcript",
  "difficulty": "Beginner or Intermediate or Advanced",
  "topics": [
    {{
      "id": 1,
      "title": "Topic title (concise, 3-7 words)",
      "timestamp": <seconds as integer>,
      "timestamp_str": "MM:SS",
      "summary": "2-3 sentences describing what is covered in this section",
      "emoji": "single relevant emoji"
    }}
  ],
  "key_takeaways": [
    "Clear, actionable takeaway (start with verb)",
    "..."
  ],
  "quiz": [
    {{
      "id": 1,
      "question": "A thoughtful question testing deep understanding",
      "options": ["Option A text", "Option B text", "Option C text", "Option D text"],
      "correct_index": 0,
      "explanation": "Detailed explanation of why the answer is correct and why others are wrong",
      "timestamp": <seconds as integer>,
      "timestamp_str": "MM:SS",
      "difficulty": "easy or medium or hard"
    }}
  ]
}}

REQUIREMENTS:
- Generate 4-8 topic sections based on actual content structure
- Generate 8-12 quiz questions covering different parts of the video
- Timestamps must match actual content in the transcript
- correct_index is 0-based (0=A, 1=B, 2=C, 3=D)
- Return ONLY the JSON object — no markdown, no extra text, no code fences"""

    # 6. Call Gemini AI
    try:
        client = get_genai_client()
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        text = response.text.strip()

        # Strip markdown code fences if present
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*\n?", "", text)
            text = re.sub(r"\n?\s*```$", "", text)

        result = json.loads(text)
        result["video_id"] = video_id
        result["thumbnail"] = video_info["thumbnail"]

        if not result.get("title"):
            result["title"] = video_info["title"]
        if not result.get("author"):
            result["author"] = video_info["author"]

        return result

    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "gemini_configured": bool(os.getenv("GEMINI_API_KEY")),
    }


# ── Serve frontend static files ──────────────────────────────────────────────
# Mount AFTER all API routes so /api/* routes take priority.
_FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

if os.path.isdir(_FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=_FRONTEND_DIR, html=True), name="frontend")
