import os
import re
import json
import time
import base64
import tempfile
import atexit
import urllib.request
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Database sync
from database import (
    init_db, db_get_history, db_save_history, db_delete_history, db_clear_history,
    db_get_notes, db_save_notes, db_get_bookmarks, db_sync_bookmarks, db_delete_bookmark,
    db_get_gamification, db_save_gamification
)
from fastapi.responses import FileResponse
from pydantic import BaseModel
from youtube_transcript_api import YouTubeTranscriptApi
from google import genai
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="LectureDigest API", version="1.0.0")

# Initialize SQLite database
init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

api_key = os.getenv("GEMINI_API_KEY")
_genai_client: genai.Client | None = None

def get_genai_client() -> genai.Client:
    """Always read API key fresh from env so .env changes take effect without restart."""
    global _genai_client
    current_key = os.getenv("GEMINI_API_KEY")
    if _genai_client is None or getattr(_genai_client, "_api_key_cached", None) != current_key:
        _genai_client = genai.Client(api_key=current_key)
        _genai_client._api_key_cached = current_key
    return _genai_client


# Primary model + fallback for free-tier quota
# gemini-1.5-flash deprecated; gemini-2.0-flash-lite is the lightest available fallback
_PRIMARY_MODEL  = "gemini-2.5-flash"
_FALLBACK_MODEL = "gemini-2.5-flash-lite"

def call_gemini(prompt: str, retries: int = 4) -> str:
    """
    Call Gemini with automatic fallback:
      1. Try _PRIMARY_MODEL (gemini-2.5-flash) — higher quality
      2. If 429 quota exhausted → fallback to _FALLBACK_MODEL (gemini-2.0-flash)
      3. Retry on 503/overload with exponential backoff
    Returns the response text.
    """
    client = get_genai_client()
    models = [_PRIMARY_MODEL, _FALLBACK_MODEL]

    for model in models:
        last_err = None
        for attempt in range(retries):
            try:
                resp = client.models.generate_content(model=model, contents=prompt)
                if model != _PRIMARY_MODEL:
                    print(f"[LectureDigest] ⚠ Used fallback model: {model}")
                return resp.text
            except Exception as e:
                last_err = e
                err_str = str(e)
                is_quota  = "429" in err_str and "free_tier" in err_str
                is_retry  = "503" in err_str or "overloaded" in err_str.lower() or (
                    "429" in err_str and "free_tier" not in err_str
                )
                if is_quota:
                    print(f"[LectureDigest] Quota exhausted for {model}, trying fallback...")
                    break   # break inner loop → try next model
                if is_retry:
                    wait = 2 ** attempt
                    print(f"[LectureDigest] {model} retry {attempt+1} in {wait}s: {err_str[:60]}")
                    time.sleep(wait)
                    continue
                raise   # non-retryable error → propagate immediately
        else:
            # Exhausted all retries for this model
            if model == _FALLBACK_MODEL:
                raise Exception(f"All models exhausted. Last error: {last_err}")
            # else continue to fallback model

    raise Exception("Gemini call failed across all models")


# ── YouTube Transcript API with optional cookie auth ──────────────────────────
_cookies_tmp_path: str | None = None

def _init_cookies() -> str | None:
    """Decode YOUTUBE_COOKIES_B64 env var into a temp Netscape cookies.txt file.
    Used to bypass YouTube IP blocks on cloud servers (Render, Railway, etc.)."""
    global _cookies_tmp_path
    b64 = os.getenv("YOUTUBE_COOKIES_B64", "").strip()
    if not b64:
        return None
    if _cookies_tmp_path and os.path.isfile(_cookies_tmp_path):
        return _cookies_tmp_path  # reuse across requests
    try:
        content = base64.b64decode(b64).decode("utf-8")
        tmp = tempfile.NamedTemporaryFile(
            mode="w", suffix="_yt_cookies.txt", delete=False, encoding="utf-8"
        )
        tmp.write(content)
        tmp.close()
        _cookies_tmp_path = tmp.name
        atexit.register(lambda: os.unlink(_cookies_tmp_path) if os.path.isfile(_cookies_tmp_path) else None)
        print(f"[LectureDigest] YouTube cookies loaded from YOUTUBE_COOKIES_B64 ({len(content)} bytes)")
        return _cookies_tmp_path
    except Exception as e:
        print(f"[LectureDigest] Warning: Could not decode YOUTUBE_COOKIES_B64 — {e}")
        return None

def get_yt_api() -> YouTubeTranscriptApi:
    """Return a YouTubeTranscriptApi instance.
    Supports YOUTUBE_COOKIES_B64 and YOUTUBE_PROXY_URL env vars to bypass
    YouTube IP blocks on cloud servers (Render, Railway, etc.).
    """
    import httpx
    from http.cookiejar import MozillaCookieJar

    # ── 1. Load cookies ───────────────────────────────────────────────────────
    cookie_dict: dict = {}
    cookies_path = _init_cookies()
    if not cookies_path:
        direct = os.getenv("YOUTUBE_COOKIES_PATH", "").strip()
        if direct and os.path.isfile(direct):
            cookies_path = direct

    if cookies_path:
        try:
            jar = MozillaCookieJar(cookies_path)
            jar.load(ignore_discard=True, ignore_expires=True)
            cookie_dict = {c.name: c.value for c in jar}
            print(f"[LectureDigest] Loaded {len(cookie_dict)} cookies from {cookies_path}")
        except Exception as e:
            print(f"[LectureDigest] Cookie load failed ({e})")

    # ── 2. Load proxy ─────────────────────────────────────────────────────────
    proxy_url = os.getenv("YOUTUBE_PROXY_URL", "").strip()
    # Format: http://username:password@host:port

    # ── 3. Build httpx client if any auth configured ──────────────────────────
    if cookie_dict or proxy_url:
        client_kwargs: dict = {}
        if cookie_dict:
            client_kwargs["cookies"] = cookie_dict
        if proxy_url:
            client_kwargs["proxy"] = proxy_url
            print(f"[LectureDigest] Using proxy: {proxy_url.split('@')[-1]}")  # hide credentials
        try:
            client = httpx.Client(**client_kwargs)
            return YouTubeTranscriptApi(http_client=client)
        except Exception as e:
            print(f"[LectureDigest] Could not create custom http_client ({e}), using default.")

    return YouTubeTranscriptApi()


class VideoRequest(BaseModel):
    url: str
    language: str = 'en'
    output_language: str = 'English'
    transcript: list | None = None   # pre-fetched by browser — skips server-side YT fetch


class QuizRequest(BaseModel):
    title: str = ''
    output_language: str = 'English'
    transcript: list        # [{text, start}, ...]
    existing_questions: list = []   # already-generated questions to avoid repeating


class ChatMessage(BaseModel):
    role: str   # 'user' or 'assistant'
    content: str

class ChatRequest(BaseModel):
    message: str
    title: str = ''
    transcript: list = []     # [{text, start}, ...]
    history: list = []        # list of ChatMessage-like dicts
    output_language: str = 'Vietnamese'


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


def fetch_transcript_innertube(video_id: str) -> list:
    """Fetch transcript via YouTube InnerTube API.
    Tries multiple clients in order of reliability.
    """
    innertube_url = "https://www.youtube.com/youtubei/v1/player"

    # Try multiple InnerTube clients — TVHTML5 and WEB are most stable
    clients = [
        {
            "name": "TVHTML5",
            "payload": {
                "videoId": video_id,
                "context": {"client": {
                    "clientName": "TVHTML5",
                    "clientVersion": "7.20230405.08.01",
                    "hl": "en", "gl": "US",
                }},
            },
            "headers": {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.0) AppleWebKit/537.36",
                "X-YouTube-Client-Name": "7",
                "X-YouTube-Client-Version": "7.20230405.08.01",
            },
        },
        {
            "name": "WEB",
            "payload": {
                "videoId": video_id,
                "context": {"client": {
                    "clientName": "WEB",
                    "clientVersion": "2.20240101.00.00",
                    "hl": "en", "gl": "US",
                }},
            },
            "headers": {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "X-YouTube-Client-Name": "1",
                "X-YouTube-Client-Version": "2.20240101.00.00",
            },
        },
    ]

    last_err = None
    for client in clients:
        try:
            payload = json.dumps(client["payload"]).encode()
            req = urllib.request.Request(innertube_url, data=payload, headers=client["headers"], method="POST")
            with urllib.request.urlopen(req, timeout=15) as resp:
                player_data = json.loads(resp.read())

            tracks = (
                player_data
                .get("captions", {})
                .get("playerCaptionsTracklistRenderer", {})
                .get("captionTracks", [])
            )
            if not tracks:
                raise ValueError(f"No caption tracks ({client['name']})")

            # Prefer non-auto, then any track
            manual = [t for t in tracks if not t.get("kind")]
            track = manual[0] if manual else tracks[0]
            base_url = track.get("baseUrl", "")
            if not base_url:
                raise ValueError("Caption track has no baseUrl")

            caption_url = base_url + "&fmt=json3"
            req2 = urllib.request.Request(caption_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req2, timeout=15) as resp2:
                cap_data = json.loads(resp2.read())

            snippets = []
            for event in cap_data.get("events", []):
                if "segs" not in event:
                    continue
                start_sec = event.get("tStartMs", 0) / 1000.0
                text = "".join(seg.get("utf8", "") for seg in event["segs"]).strip()
                if text:
                    snippets.append({"text": text, "start": start_sec})

            if not snippets:
                raise ValueError("Transcript is empty")

            print(f"[LectureDigest] InnerTube ({client['name']}): fetched {len(snippets)} segments")
            return snippets

        except Exception as e:
            print(f"[LectureDigest] InnerTube {client['name']} failed: {e}")
            last_err = e
            continue

    raise ValueError(f"All InnerTube clients failed. Last: {last_err}")


def get_transcript(video_id: str, language: str = "en") -> list:
    """Fetch transcript: InnerTube first (cloud-safe), youtube-transcript-api as fallback."""

    # ── Primary: InnerTube Android client ─────────────────────────────────────
    try:
        return fetch_transcript_innertube(video_id)
    except Exception as e:
        print(f"[LectureDigest] InnerTube failed ({e}), trying youtube-transcript-api...")

    # ── Fallback: youtube-transcript-api ──────────────────────────────────────
    try:
        api = get_yt_api()
        transcript_list = api.list(video_id)
    except Exception as e:
        raise HTTPException(
            status_code=404,
            detail=f"Could not fetch transcript. This video may not have captions enabled. ({str(e)})",
        )

    # Build priority list: requested lang > English > any available
    lang_priority = []
    if language and language != "en":
        lang_priority.append(language)
    lang_priority.append("en")

    # Try manually created then auto-generated for each language
    for lang in lang_priority:
        for finder in [
            lambda l=lang: transcript_list.find_manually_created_transcript([l]),
            lambda l=lang: transcript_list.find_generated_transcript([l]),
        ]:
            try:
                return _snippets_to_list(finder().fetch())
            except Exception:
                continue

    # Last resort: grab whichever track is available
    for transcript in transcript_list:
        try:
            result = _snippets_to_list(transcript.fetch())
            if result:
                print(f"[LectureDigest] Using fallback track: {transcript.language_code}")
                return result
        except Exception:
            continue

    raise HTTPException(
        status_code=404,
        detail="No transcript found. This video may not have captions — try another video.",
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

    if request.transcript:
        # Browser pre-fetched the transcript — use it directly (bypasses cloud IP blocks)
        print(f"[LectureDigest] Using client-provided transcript ({len(request.transcript)} segments)")
        transcript_data = request.transcript
    else:
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
- Generate 8-12 quiz questions covering different parts of the video
- Generate 4-6 highlights: the most impactful, must-watch moments in the video
- Timestamps must match actual content in the transcript
- correct_index is 0-based (0=A, 1=B, 2=C, 3=D)
- highlight types: key_insight (aha moment), definition (important term), example (concrete illustration), turning_point (shift in topic/perspective), summary (recap moment)
- Return ONLY the JSON object — no markdown, no extra text, no code fences"""

    try:
        text = call_gemini(prompt)
        text = text.strip()

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

        # Include transcript so frontend can use it for quiz regeneration
        result["transcript"] = transcript_data

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


@app.post("/api/quiz")
async def regenerate_quiz(request: QuizRequest):
    """Generate additional quiz questions, avoiding duplicates with existing ones."""
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    if not request.transcript:
        raise HTTPException(status_code=400, detail="transcript is required")

    # Format transcript lines
    lines = []
    for entry in request.transcript:
        time_str = format_seconds(entry["start"])
        text = entry["text"].strip().replace("\n", " ")
        lines.append(f"[{time_str}] {text}")
    full_transcript = "\n".join(lines)
    if len(full_transcript) > 40000:
        full_transcript = full_transcript[:40000] + "\n...[truncated]..."

    # Build list of existing question texts to avoid repetition
    existing_count = len(request.existing_questions)
    start_id = existing_count + 1
    existing_block = ""
    if request.existing_questions:
        existing_list = "\n".join(
            f"- {q.get('question', '')}" for q in request.existing_questions
        )
        existing_block = f"""

ALREADY EXISTING QUESTIONS (DO NOT REPEAT these topics or rephrase these):
{existing_list}
"""

    prompt = f"""You are an expert educational content analyzer adding MORE quiz questions.

VIDEO TITLE: {request.title}
TRANSCRIPT:
{full_transcript}
{existing_block}
⚠️ Generate ALL text in **{request.output_language}**.

Create 8-10 NEW multiple choice questions that:
- Cover topics NOT already covered in the existing questions above
- Use varied question styles (conceptual, application, recall, critical thinking)
- IDs start from {start_id} (continuing from existing {existing_count} questions)

Return ONLY a valid JSON array, no markdown, no extra text:
[
  {{
    "id": {start_id},
    "question": "A thoughtful question testing understanding",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correct_index": 0,
    "explanation": "Detailed explanation of the correct answer and why others are wrong",
    "timestamp": <seconds as integer>,
    "timestamp_str": "MM:SS",
    "difficulty": "easy or medium or hard"
  }}
]

correct_index is 0-based (0=A, 1=B, 2=C, 3=D)."""

    try:
        text = call_gemini(prompt)
        text = text.strip()
        if text.startswith('```'):
            text = re.sub(r'^```(?:json)?\s*\n?', '', text)
            text = re.sub(r'\n?\s*```$', '', text)
        new_questions = json.loads(text)
        return {"quiz": new_questions, "total": existing_count + len(new_questions)}
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI quiz generation failed: {e}")


@app.post("/api/chat")
async def chat_with_lecture(request: ChatRequest):
    """Answer questions about a video lecture using its transcript as context."""
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="message is required")

    # Format transcript (limit to avoid token overflow)
    transcript_text = ""
    if request.transcript:
        lines = []
        for entry in request.transcript:
            time_str = format_seconds(entry["start"])
            text = entry["text"].strip().replace("\n", " ")
            lines.append(f"[{time_str}] {text}")
        transcript_text = "\n".join(lines)
        if len(transcript_text) > 50000:
            transcript_text = transcript_text[:50000] + "\n...[truncated]..."

    # Build conversation history context
    history_text = ""
    if request.history:
        turns = []
        for msg in request.history[-10:]:   # keep last 10 turns
            role = "User" if msg.get("role") == "user" else "Assistant"
            turns.append(f"{role}: {msg.get('content', '')}")
        history_text = "\n".join(turns)

    prompt = f"""You are an AI teaching assistant for a YouTube lecture. Answer questions based ONLY on the video content.

VIDEO TITLE: {request.title}

TRANSCRIPT (with timestamps):
{transcript_text if transcript_text else '(no transcript available)'}

{f'CONVERSATION HISTORY:{chr(10)}{history_text}{chr(10)}' if history_text else ''}

ANSWERING RULES:
- Answer ONLY based on what is in the transcript above
- If something isn't covered in the video, say so clearly
- Reference specific timestamps [MM:SS] when relevant (e.g. "At [02:30], the speaker explains...")
- Be concise but thorough
- Use **bold** for key terms
- Respond in **{request.output_language}**

User question: {request.message}

Answer:"""

    try:
        reply = call_gemini(prompt)
        return {"reply": reply.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")


# ── /api/translate-transcript ─────────────────────────────────────────────────
class TranslateRequest(BaseModel):
    transcript: list           # [{text, start}, ...]
    target_language: str = "Vietnamese"


@app.post("/api/translate-transcript")
async def translate_transcript(req: TranslateRequest):
    """
    Translate transcript segments in chunks of 40 to avoid Gemini overload.
    """
    if not req.transcript:
        raise HTTPException(status_code=400, detail="Transcript is empty")

    client    = get_genai_client()
    SEPARATOR = "|||"
    CHUNK_SIZE = 40   # Gemini handles ~40 short segments reliably

    def translate_chunk(segs: list) -> list[str]:
        """Translate a chunk of segments, return list of translated strings."""
        combined = f"\n{SEPARATOR}\n".join(
            seg.get("text", "").strip().replace("\n", " ")
            for seg in segs
        )
        prompt = (
            f"You are a professional translator. Translate each segment to **{req.target_language}**.\n\n"
            f"Rules:\n"
            f"- Keep EXACTLY {len(segs)} segments — one translation per segment.\n"
            f"- Separate each translated segment with a line containing only: {SEPARATOR}\n"
            f"- No extra commentary, numbering, or headers.\n"
            f"- Preserve meaning and tone naturally.\n\n"
            f"Segments:\n{combined}"
        )
        last_err = None
        for attempt in range(5):
            try:
                text = call_gemini(prompt)
                parts = [p.strip() for p in text.strip().split(SEPARATOR)]
                return parts
            except Exception as e:
                last_err = e
                if any(code in str(e) for code in ["503", "overloaded"]):
                    time.sleep(2 ** attempt)
                    continue
                raise HTTPException(status_code=500, detail=f"Translation error: {e}")
        raise HTTPException(status_code=503, detail=f"Gemini overloaded after retries: {last_err}")

    # Split transcript into chunks and translate each
    all_translations: list[str] = []
    for chunk_start in range(0, len(req.transcript), CHUNK_SIZE):
        chunk = req.transcript[chunk_start: chunk_start + CHUNK_SIZE]
        translated = translate_chunk(chunk)
        all_translations.extend(translated)
        # Brief pause between chunks to avoid rate limiting
        if chunk_start + CHUNK_SIZE < len(req.transcript):
            time.sleep(0.5)

    # Align with original
    result = []
    for i, seg in enumerate(req.transcript):
        result.append({
            "start":       seg.get("start", 0),
            "text":        seg.get("text", ""),
            "translation": all_translations[i] if i < len(all_translations) else ""
        })

    return {"translations": result, "target_language": req.target_language}


# ── Concept Explainer ─────────────────────────────────────────────────────────
class ExplainRequest(BaseModel):
    term:          str
    context:       str = ""
    video_title:   str = ""
    language:      str = "vi"

@app.post("/api/explain-concept")
def explain_concept(req: ExplainRequest):
    term    = req.term.strip()[:120]
    ctx     = req.context.strip()[:400]
    title   = req.video_title.strip()[:120]
    lang    = req.language or "vi"

    lang_name = {"vi": "Tiếng Việt", "en": "English", "fr": "Français",
                 "de": "Deutsch",   "ja": "日本語",    "ko": "한국어", "zh": "中文"}.get(lang, lang)

    ctx_block = f'\n\nBối cảnh ngữ cảnh: "{ctx}"' if ctx else ""
    vid_block = f"\nVideo đang học: {title}" if title else ""

    prompt = f"""Bạn là một giáo viên giải thích khái niệm ngắn gọn và dễ hiểu.{vid_block}

Hãy giải thích khái niệm / thuật ngữ: "{term}"{ctx_block}

Yêu cầu:
- Trả lời bằng {lang_name}
- Ngắn gọn: 2-3 câu tối đa
- Đầu tiên 1 câu định nghĩa rõ ràng
- Nếu có thể, kết nối với chủ đề video
- Không dùng markdown, không in đậm, chỉ văn xuôi thuần túy
- Kết thúc bằng 1 emoji liên quan"""

    try:
        explanation = call_gemini(prompt)
        return {"term": term, "explanation": explanation.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Serve frontend ──────────────────────────────────────────────────────────


# ══════════════════════════════════════════════════════
# DATABASE SYNC API
# ══════════════════════════════════════════════════════

@app.get("/api/db/history")
async def api_get_history():
    """Get all analysis history from database."""
    return db_get_history(limit=100)

@app.post("/api/db/history")
async def api_save_history(request: Request):
    """Save an analysis entry to database."""
    entry = await request.json()
    entry_id = db_save_history(entry)
    return {"ok": True, "entry_id": entry_id}

@app.post("/api/db/history/bulk")
async def api_bulk_save_history(request: Request):
    """Bulk import history entries (for initial sync from localStorage)."""
    entries = await request.json()
    saved = 0
    for entry in entries:
        try:
            db_save_history(entry)
            saved += 1
        except Exception as e:
            print(f"[DB] Skip entry: {e}")
    return {"ok": True, "saved": saved, "total": len(entries)}

@app.delete("/api/db/history/{entry_id}")
async def api_delete_history(entry_id: str):
    """Delete a single history entry."""
    db_delete_history(entry_id)
    return {"ok": True}

@app.delete("/api/db/history")
async def api_clear_history():
    """Clear all history."""
    db_clear_history()
    return {"ok": True}

@app.get("/api/db/notes/{video_id}")
async def api_get_notes(video_id: str):
    """Get notes for a video."""
    return {"video_id": video_id, "content": db_get_notes(video_id)}

@app.put("/api/db/notes/{video_id}")
async def api_save_notes(video_id: str, request: Request):
    """Save/update notes for a video."""
    body = await request.json()
    db_save_notes(video_id, body.get("content", ""))
    return {"ok": True}

@app.get("/api/db/bookmarks/{video_id}")
async def api_get_bookmarks(video_id: str):
    """Get bookmarks for a video."""
    return db_get_bookmarks(video_id)

@app.put("/api/db/bookmarks/{video_id}")
async def api_sync_bookmarks(video_id: str, request: Request):
    """Sync all bookmarks for a video (replace)."""
    bookmarks = await request.json()
    db_sync_bookmarks(video_id, bookmarks)
    return {"ok": True}

@app.get("/api/db/gamification")
async def api_get_gamification():
    """Get gamification data."""
    return db_get_gamification()

@app.put("/api/db/gamification")
async def api_save_gamification(request: Request):
    """Save gamification data."""
    data = await request.json()
    db_save_gamification(data)
    return {"ok": True}

@app.post("/api/db/sync")
async def api_full_sync(request: Request):
    """Full sync: receive all localStorage data, merge into DB, return merged result."""
    payload = await request.json()

    # Sync history
    local_history = payload.get("history", [])
    for entry in local_history:
        try:
            db_save_history(entry)
        except:
            pass

    # Sync notes
    local_notes = payload.get("notes", {})
    for video_id, content in local_notes.items():
        if content:
            db_save_notes(video_id, content)

    # Sync bookmarks
    local_bookmarks = payload.get("bookmarks", {})
    for video_id, bms in local_bookmarks.items():
        if bms:
            db_sync_bookmarks(video_id, bms)

    # Sync gamification
    local_gamif = payload.get("gamification", {})
    if local_gamif:
        existing = db_get_gamification()
        # Merge: keep higher values
        merged = {}
        for key in set(list(existing.keys()) + list(local_gamif.keys())):
            ev = existing.get(key)
            lv = local_gamif.get(key)
            if isinstance(ev, (int, float)) and isinstance(lv, (int, float)):
                merged[key] = max(ev, lv)
            elif isinstance(ev, list) and isinstance(lv, list):
                merged[key] = list(set(ev + lv))
            else:
                merged[key] = lv if lv is not None else ev
        db_save_gamification(merged)

    return {
        "ok": True,
        "history": db_get_history(limit=100),
        "gamification": db_get_gamification()
    }



# ═══════════════════════════════════════════════════════
# MULTI-VIDEO EXAM
# ═══════════════════════════════════════════════════════

class MultiExamVideo(BaseModel):
    title: str
    overview: str = ''
    topics: list = []     # [{title, summary, ...}, ...]
    key_takeaways: list = []

class MultiExamRequest(BaseModel):
    videos: list[MultiExamVideo]
    num_questions: int = 20
    output_language: str = 'Vietnamese'


@app.post("/api/multi-exam")
async def generate_multi_exam(request: MultiExamRequest):
    """Generate a comprehensive exam combining content from multiple analyzed videos."""
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    if len(request.videos) < 2:
        raise HTTPException(status_code=400, detail="At least 2 videos are required")

    # Build combined content block
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


def extract_playlist_id(url: str) -> str:
    """Extract playlist ID from a YouTube URL containing list= parameter."""
    match = re.search(r'[?&]list=([a-zA-Z0-9_-]+)', url)
    if match:
        return match.group(1)
    raise ValueError("Invalid YouTube playlist URL")


def fetch_playlist_videos(playlist_id: str) -> dict:
    """Fetch playlist metadata and video list by parsing YouTube playlist page."""
    page_url = f"https://www.youtube.com/playlist?list={playlist_id}"
    req = urllib.request.Request(page_url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    })

    with urllib.request.urlopen(req, timeout=20) as resp:
        html = resp.read().decode("utf-8", errors="replace")

    # Extract ytInitialData JSON blob embedded in the page
    match = re.search(r'var\s+ytInitialData\s*=\s*(\{.+?\});\s*</', html, re.DOTALL)
    if not match:
        raise ValueError("Could not parse playlist page")

    data = json.loads(match.group(1))

    # ── Playlist title ────────────────────────────────────────────────
    title = ""
    try:
        title = data["metadata"]["playlistMetadataRenderer"]["title"]
    except (KeyError, TypeError):
        pass

    # ── Channel / author ──────────────────────────────────────────────
    author = ""
    try:
        sidebar = data["sidebar"]["playlistSidebarRenderer"]["items"]
        author = (sidebar[1]["playlistSidebarSecondaryInfoRenderer"]
                  ["videoOwner"]["videoOwnerRenderer"]["title"]["runs"][0]["text"])
    except Exception:
        pass

    # ── Video list ────────────────────────────────────────────────────
    videos = []
    try:
        tabs = data["contents"]["twoColumnBrowseResultsRenderer"]["tabs"]
        section = tabs[0]["tabRenderer"]["content"]["sectionListRenderer"]["contents"][0]
        items = (section["itemSectionRenderer"]["contents"][0]
                 ["playlistVideoListRenderer"]["contents"])

        for item in items:
            renderer = item.get("playlistVideoRenderer")
            if not renderer:
                continue
            vid = renderer.get("videoId", "")
            if not vid:
                continue

            vtitle = ""
            try:
                vtitle = renderer["title"]["runs"][0]["text"]
            except Exception:
                vtitle = renderer.get("title", {}).get("simpleText", "")

            duration = ""
            try:
                duration = renderer["lengthText"]["simpleText"]
            except Exception:
                pass

            videos.append({
                "video_id": vid,
                "title": vtitle,
                "duration": duration,
                "thumbnail": f"https://img.youtube.com/vi/{vid}/mqdefault.jpg",
                "index": len(videos) + 1,
            })
    except (KeyError, TypeError, IndexError) as e:
        raise ValueError(f"Could not extract videos: {e}")

    if not videos:
        raise ValueError("Playlist is empty or private")

    return {
        "playlist_id": playlist_id,
        "title": title or f"Playlist {playlist_id}",
        "author": author,
        "video_count": len(videos),
        "videos": videos,
    }


@app.post("/api/playlist")
async def get_playlist_info(request: PlaylistRequest):
    """Fetch video list from a YouTube playlist URL."""
    try:
        playlist_id = extract_playlist_id(request.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        result = fetch_playlist_videos(playlist_id)
        print(f"[LectureDigest] Playlist: {result['title']} ({result['video_count']} videos)")
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        print(f"[LectureDigest] Playlist error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to load playlist: {e}")


_FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

# MIME type map for static assets
_MIME_TYPES = {
    ".css": "text/css",
    ".js":  "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".html": "text/html",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
}

if os.path.isdir(_FRONTEND_DIR):
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_catch_all(full_path: str):
        """
        SPA routing: serve the real file if it exists (css/js/images),
        otherwise fall back to index.html so client-side routing works.
        """
        # Try to serve the actual file
        target = os.path.join(_FRONTEND_DIR, full_path)
        # Security: prevent path traversal
        target = os.path.abspath(target)
        if not target.startswith(_FRONTEND_DIR):
            raise HTTPException(status_code=403, detail="Forbidden")
        if os.path.isfile(target):
            ext = os.path.splitext(target)[1].lower()
            mime = _MIME_TYPES.get(ext)
            if mime:
                return FileResponse(target, media_type=mime)
            return FileResponse(target)
        # Fallback: serve index.html for all SPA routes
        index = os.path.join(_FRONTEND_DIR, "index.html")
        if os.path.isfile(index):
            return FileResponse(index)
        raise HTTPException(status_code=404, detail="Not found")

