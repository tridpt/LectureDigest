"""
Analyze routes — YouTube video analysis and file upload analysis.
"""

import os
import re
import json
import time
import hashlib
import secrets

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Request, Depends
from pydantic import BaseModel

from gemini_client import get_genai_client, call_gemini, call_gemini_multi, PRIMARY_MODEL
from youtube import extract_video_id, get_video_info, get_transcript, format_seconds
from database import db_check_rate_limit

router = APIRouter(prefix="/api", tags=["analyze"])


# ── Rate limiting ──
def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

def _make_rl(name: str, max_req: int, window: int = 300, block: int = 300):
    async def _check(request: Request):
        ip = _get_client_ip(request)
        key = f"ai:{name}:{ip}"
        allowed, retry = db_check_rate_limit(key, max_attempts=max_req, window_secs=window, block_secs=block)
        if not allowed:
            raise HTTPException(status_code=429, detail=f"Quá nhiều yêu cầu. Thử lại sau {retry} giây.")
    return _check

_rl_analyze = Depends(_make_rl("analyze", max_req=10))
_rl_upload  = Depends(_make_rl("upload",  max_req=5))


class VideoRequest(BaseModel):
    url: str
    language: str = 'en'
    output_language: str = 'English'
    transcript: list | None = None   # pre-fetched by browser — skips server-side YT fetch


# ── Supported upload formats ──
_UPLOAD_MIME_MAP = {
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".webm": "video/webm",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
    ".mpeg": "video/mpeg",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
}
_UPLOAD_MAX_SIZE = 200 * 1024 * 1024  # 200MB


def _build_analyze_prompt(title: str, author: str, source_label: str, full_transcript: str, output_language: str) -> str:
    """Build the Gemini analysis prompt (shared between YouTube and upload flows)."""
    return f"""You are an expert educational content analyzer. Analyze this {source_label} transcript carefully.

{'VIDEO' if 'YouTube' in source_label else 'CONTENT'} INFO:
Title: {title}
Author: {author}

TRANSCRIPT (with timestamps):
{full_transcript}

⚠️ IMPORTANT: Generate ALL text in **{output_language}** — this includes the title, overview,
topic titles, topic summaries, key takeaways, quiz questions, answer options, and explanations.
Only timestamps and numeric values remain language-neutral.

Analyze this lecture and return a JSON object with the EXACT structure below.
Be thorough, accurate, and educational in your analysis.

{{
  "title": "The actual or improved title of this content",
  "author": "The speaker/channel name",
  "overview": "A comprehensive 3-4 sentence overview of what this content covers and what learners will gain",
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
  ],
  "highlights": [
    {{
      "timestamp": <seconds as integer>,
      "timestamp_str": "MM:SS",
      "title": "Short moment title (3-6 words)",
      "description": "1-2 sentences explaining why this exact moment is crucial to understanding the lecture",
      "type": "key_insight or definition or example or turning_point or summary"
    }}
  ]
}}

REQUIREMENTS:
- Generate 4-8 topic sections based on actual content structure
- Generate 8-12 quiz questions covering different parts of the content
- Generate 4-6 highlights: the most impactful, must-watch moments
- Timestamps must match actual content in the transcript
- correct_index is 0-based (0=A, 1=B, 2=C, 3=D)
- highlight types: key_insight (aha moment), definition (important term), example (concrete illustration), turning_point (shift in topic/perspective), summary (recap moment)
- Return ONLY the JSON object — no markdown, no extra text, no code fences"""


def _truncate_transcript(full_transcript: str, max_len: int = 60000) -> str:
    """Limit transcript length for very long videos (keep start + mid + end)."""
    if len(full_transcript) <= max_len:
        return full_transcript
    chunk = 18000
    mid = len(full_transcript) // 2
    return (
        full_transcript[:chunk]
        + "\n...[middle section]...\n"
        + full_transcript[mid - chunk // 2 : mid + chunk // 2]
        + "\n...[end section]...\n"
        + full_transcript[-chunk:]
    )


def _strip_code_fences(text: str) -> str:
    """Remove markdown code fences from AI response."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*\n?", "", text)
        text = re.sub(r"\n?\s*```$", "", text)
    return text


def _format_transcript_lines(transcript_data: list) -> str:
    """Format transcript entries into timestamped lines."""
    lines = []
    for entry in transcript_data:
        time_str = format_seconds(entry.get("start", entry.get("start", 0)))
        text = str(entry.get("text", "")).strip().replace("\n", " ")
        lines.append(f"[{time_str}] {text}")
    return "\n".join(lines)


@router.post("/upload-analyze", dependencies=[_rl_upload])
async def upload_analyze(
    file: UploadFile = File(...),
    output_language: str = Form("Vietnamese"),
    title: str = Form(""),
):
    """
    Upload an audio/video file, transcribe it with Gemini, then analyze.
    Returns the same JSON structure as /api/analyze for YouTube videos.
    """
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured in .env")

    # Validate file extension
    original_name = file.filename or "upload"
    ext = os.path.splitext(original_name)[1].lower()
    if ext not in _UPLOAD_MIME_MAP:
        supported = ", ".join(_UPLOAD_MIME_MAP.keys())
        raise HTTPException(
            status_code=400,
            detail=f"Định dạng file không được hỗ trợ ({ext}). Hỗ trợ: {supported}"
        )

    mime_type = _UPLOAD_MIME_MAP[ext]

    # Save to temp file
    upload_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
    os.makedirs(upload_dir, exist_ok=True)
    tmp_path = os.path.join(upload_dir, f"upload_{secrets.token_hex(8)}{ext}")

    try:
        # Stream file to disk (memory-safe for large files)
        total_size = 0
        with open(tmp_path, "wb") as buf:
            while True:
                chunk = await file.read(1024 * 1024)  # 1MB chunks
                if not chunk:
                    break
                total_size += len(chunk)
                if total_size > _UPLOAD_MAX_SIZE:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File quá lớn. Giới hạn: {_UPLOAD_MAX_SIZE // (1024*1024)}MB"
                    )
                buf.write(chunk)

        print(f"[Upload] Saved {original_name} ({total_size // 1024}KB) → {tmp_path}")

        # ── Step 1: Upload to Gemini Files API ──
        client = get_genai_client()
        print(f"[Upload] Uploading to Gemini Files API...")

        gemini_file = client.files.upload(file=tmp_path, config={"mime_type": mime_type})
        print(f"[Upload] Gemini file: {gemini_file.name}, state: {gemini_file.state}")

        # Wait for file to be processed
        max_wait = 120  # seconds
        waited = 0
        while gemini_file.state.name == "PROCESSING" and waited < max_wait:
            time.sleep(3)
            waited += 3
            gemini_file = client.files.get(name=gemini_file.name)
            print(f"[Upload] Processing... ({waited}s)")

        if gemini_file.state.name == "FAILED":
            raise HTTPException(status_code=500, detail="Gemini không thể xử lý file này")

        if gemini_file.state.name != "ACTIVE":
            raise HTTPException(status_code=500, detail=f"File chưa sẵn sàng (state: {gemini_file.state.name})")

        # ── Step 2: Transcribe with Gemini ──
        print(f"[Upload] Transcribing with Gemini...")
        transcribe_prompt = """Transcribe this audio/video content with precise timestamps.

Output format — return ONLY a JSON array like this (no markdown, no extra text):
[
  {"start": 0.0, "duration": 5.2, "text": "transcribed text for this segment"},
  {"start": 5.2, "duration": 4.8, "text": "next segment text"},
  ...
]

RULES:
- Segment every 5-15 seconds of speech
- "start" is in seconds from the beginning (float)
- "duration" is the length of this segment in seconds (float)
- Transcribe ALL spoken content accurately
- Include timestamps for the entire audio/video
- If there's silence or music, skip those sections
- Return ONLY the JSON array, no other text"""

        transcript_text = call_gemini_multi(
            [transcribe_prompt, gemini_file],
            retries=4,
        ).strip()

        # Parse transcript
        transcript_text = _strip_code_fences(transcript_text)

        try:
            transcript_data = json.loads(transcript_text)
        except json.JSONDecodeError:
            match = re.search(r'\[.*\]', transcript_text, re.DOTALL)
            if match:
                transcript_data = json.loads(match.group())
            else:
                raise HTTPException(status_code=500, detail="Không thể phân tích transcript từ Gemini")

        if not transcript_data or not isinstance(transcript_data, list):
            raise HTTPException(status_code=500, detail="Transcript trống hoặc không hợp lệ")

        print(f"[Upload] Got {len(transcript_data)} transcript segments")

        # ── Step 3: Format and analyze ──
        full_transcript = _format_transcript_lines(transcript_data)
        full_transcript = _truncate_transcript(full_transcript)

        display_title = title.strip() or original_name
        print(f"[Upload] Analyzing content: {display_title}")

        prompt = _build_analyze_prompt(
            title=display_title,
            author=f"Uploaded File ({original_name})",
            source_label="uploaded audio/video",
            full_transcript=full_transcript,
            output_language=output_language,
        )

        text = _strip_code_fences(call_gemini(prompt))
        result = json.loads(text)

        # Generate a unique ID for uploaded content
        file_hash = hashlib.md5(original_name.encode() + str(total_size).encode()).hexdigest()[:11]
        result["video_id"] = f"upload_{file_hash}"
        result["thumbnail"] = ""
        result["is_upload"] = True
        result["upload_filename"] = original_name

        if not result.get("title"):
            result["title"] = display_title
        if not result.get("author"):
            result["author"] = "Uploaded File"

        result["transcript"] = transcript_data
        print(f"[Upload] Analysis complete: {result.get('title')}")

        # Clean up Gemini file
        try:
            client.files.delete(name=gemini_file.name)
        except Exception:
            pass

        return result

    except HTTPException:
        raise
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response: {str(e)}")
    except Exception as e:
        print(f"[Upload] Error: {e}")
        raise HTTPException(status_code=500, detail=f"Lỗi phân tích file: {str(e)}")
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


@router.post("/analyze", dependencies=[_rl_analyze])
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

    if request.transcript:
        print(f"[LectureDigest] Using client-provided transcript ({len(request.transcript)} segments)")
        transcript_data = request.transcript
    else:
        transcript_data = get_transcript(video_id, request.language)

    # 3. Format and truncate transcript
    full_transcript = _format_transcript_lines(transcript_data)
    full_transcript = _truncate_transcript(full_transcript)

    # 4. Build AI prompt and call Gemini
    prompt = _build_analyze_prompt(
        title=video_info.get("title", "Unknown"),
        author=video_info.get("author", "Unknown"),
        source_label="YouTube video",
        full_transcript=full_transcript,
        output_language=request.output_language,
    )

    try:
        text = _strip_code_fences(call_gemini(prompt))
        result = json.loads(text)
        result["video_id"] = video_id
        result["thumbnail"] = video_info["thumbnail"]

        if not result.get("title"):
            result["title"] = video_info["title"]
        if not result.get("author"):
            result["author"] = video_info["author"]

        result["transcript"] = transcript_data
        return result

    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "gemini_configured": bool(os.getenv("GEMINI_API_KEY")),
    }
