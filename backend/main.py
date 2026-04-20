import os
import re
import json
import time
import base64
import tempfile
import atexit
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
    """Fetch transcript via YouTube InnerTube API using Android client headers.
    This bypasses IP blocks that affect regular web requests from cloud servers.
    """
    # ── Step 1: Get player data ───────────────────────────────────────────────
    innertube_url = "https://www.youtube.com/youtubei/v1/player"
    payload = json.dumps({
        "videoId": video_id,
        "context": {
            "client": {
                "clientName": "ANDROID",
                "clientVersion": "17.31.35",
                "androidSdkVersion": 30,
                "userAgent": "com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip",
                "hl": "en",
                "timeZone": "UTC",
                "utcOffsetMinutes": 0,
            }
        },
    }).encode()

    headers = {
        "Content-Type": "application/json",
        "User-Agent": "com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip",
        "X-YouTube-Client-Name": "3",
        "X-YouTube-Client-Version": "17.31.35",
        "Origin": "https://www.youtube.com",
    }

    req = urllib.request.Request(innertube_url, data=payload, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=15) as resp:
        player_data = json.loads(resp.read())

    # ── Step 2: Find a caption track ──────────────────────────────────────────
    tracks = (
        player_data
        .get("captions", {})
        .get("playerCaptionsTracklistRenderer", {})
        .get("captionTracks", [])
    )
    if not tracks:
        raise ValueError("No caption tracks found (video may have no captions)")

    track = next((t for t in tracks if t.get("languageCode", "").startswith("en")), tracks[0])
    base_url = track.get("baseUrl", "")
    if not base_url:
        raise ValueError("Caption track has no baseUrl")

    # ── Step 3: Fetch caption JSON ────────────────────────────────────────────
    caption_url = base_url + "&fmt=json3"
    req2 = urllib.request.Request(caption_url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req2, timeout=15) as resp2:
        cap_data = json.loads(resp2.read())

    # ── Step 4: Parse events ──────────────────────────────────────────────────
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

    print(f"[LectureDigest] InnerTube: fetched {len(snippets)} segments")
    return snippets


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

    import time
    try:
        client = get_genai_client()
        response = None
        last_error = None
        for attempt in range(3):
            try:
                response = client.models.generate_content(
                    model="gemini-2.5-flash", contents=prompt
                )
                break  # success
            except Exception as e:
                last_error = e
                err_str = str(e)
                if "503" in err_str or "UNAVAILABLE" in err_str:
                    wait = 5 * (attempt + 1)
                    print(f"[LectureDigest] 503 overload (attempt {attempt+1}/3), retrying in {wait}s...")
                    time.sleep(wait)
                    continue
                raise  # non-503 error → fail immediately
        if response is None:
            raise Exception(f"Gemini server overloaded after 3 retries. Please try again in a few minutes. ({last_error})")
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
        client = get_genai_client()
        response, last_err = None, None
        for attempt in range(3):
            try:
                response = client.models.generate_content(model="gemini-2.5-flash", contents=prompt)
                break
            except Exception as e:
                last_err = e
                if "503" in str(e) or "UNAVAILABLE" in str(e):
                    wait = 5 * (attempt + 1)
                    print(f"[LectureDigest] quiz 503, retrying in {wait}s...")
                    time.sleep(wait); continue
                raise
        if response is None:
            raise Exception(f"Gemini overloaded: {last_err}")
        text = response.text.strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*\n?", "", text)
            text = re.sub(r"\n?\s*```$", "", text)
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
        client = get_genai_client()
        response, last_err = None, None
        for attempt in range(3):
            try:
                response = client.models.generate_content(model="gemini-2.5-flash", contents=prompt)
                break
            except Exception as e:
                last_err = e
                if "503" in str(e) or "UNAVAILABLE" in str(e):
                    wait = 5 * (attempt + 1)
                    print(f"[LectureDigest] chat 503, retrying in {wait}s...")
                    time.sleep(wait); continue
                raise
        if response is None:
            raise Exception(f"Gemini overloaded after retries: {last_err}")
        return {"reply": response.text.strip()}
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
                resp = client.models.generate_content(
                    model="gemini-2.0-flash",
                    contents=prompt,
                )
                parts = [p.strip() for p in resp.text.strip().split(SEPARATOR)]
                return parts
            except Exception as e:
                last_err = e
                wait = 2 ** attempt
                if any(code in str(e) for code in ["503", "429", "overloaded"]):
                    time.sleep(wait)
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


# ── Serve frontend static files ───────────────────────────────────────────────
# Mount AFTER all API routes so /api/* routes take priority.
_FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

if os.path.isdir(_FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=_FRONTEND_DIR, html=True), name="frontend")
