"""
AI tool routes — quiz regeneration, chat, translate, concept explainer.
Rate-limited to prevent Gemini API abuse.
"""

import os
import re
import json
import time
import asyncio

from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel

from gemini_client import call_gemini, async_call_gemini, get_genai_client
from youtube import format_seconds
from database import db_check_rate_limit

router = APIRouter(prefix="/api", tags=["ai-tools"])


# ═══════════════════════════════════════════════════════
# RATE LIMITING DEPENDENCY
# ═══════════════════════════════════════════════════════

def _get_client_ip(request: Request) -> str:
    """Extract client IP, respecting X-Forwarded-For for proxies."""
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _make_ai_rate_limiter(endpoint_name: str, max_requests: int = 20, window_secs: int = 300, block_secs: int = 300):
    """Factory: creates a rate-limit dependency for a specific AI endpoint."""
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


# Per-endpoint rate limits (requests / 5 minutes)
_rl_quiz       = Depends(_make_ai_rate_limiter("quiz",       max_requests=20))
_rl_chat       = Depends(_make_ai_rate_limiter("chat",       max_requests=30))
_rl_translate  = Depends(_make_ai_rate_limiter("translate",  max_requests=10))
_rl_explain    = Depends(_make_ai_rate_limiter("explain",    max_requests=40))
_rl_notes      = Depends(_make_ai_rate_limiter("notes",      max_requests=15))
_rl_bookmark   = Depends(_make_ai_rate_limiter("bookmark",   max_requests=30))
_rl_analysis   = Depends(_make_ai_rate_limiter("quiz-analysis", max_requests=15))


# ═══════════════════════════════════════════════════════
# REQUEST MODELS
# ═══════════════════════════════════════════════════════

class QuizRequest(BaseModel):
    title: str = ''
    output_language: str = 'English'
    transcript: list        # [{text, start}, ...]
    existing_questions: list = []

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str
    title: str = ''
    transcript: list = []
    history: list = []
    output_language: str = 'Vietnamese'

class TranslateRequest(BaseModel):
    transcript: list
    target_language: str = "Vietnamese"

class ExplainRequest(BaseModel):
    term:          str
    context:       str = ""
    video_title:   str = ""
    language:      str = "vi"

class AutoNotesRequest(BaseModel):
    title:           str = ''
    overview:        str = ''
    topics:          list = []    # [{title, summary, timestamp_str}, ...]
    key_takeaways:   list = []
    transcript:      list = []    # [{text, start}, ...]
    output_language: str = 'Vietnamese'

class SmartBookmarkRequest(BaseModel):
    title:              str = ''
    timestamp:          int = 0
    transcript_context: list = []    # [{text, start}, ...]
    output_language:    str = 'Vietnamese'


# ═══════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════

@router.post("/quiz", dependencies=[_rl_quiz])
async def regenerate_quiz(request: QuizRequest):
    """Generate additional quiz questions, avoiding duplicates with existing ones."""
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    if not request.transcript:
        raise HTTPException(status_code=400, detail="transcript is required")

    lines = []
    for entry in request.transcript:
        time_str = format_seconds(entry["start"])
        text = entry["text"].strip().replace("\n", " ")
        lines.append(f"[{time_str}] {text}")
    full_transcript = "\n".join(lines)
    if len(full_transcript) > 40000:
        full_transcript = full_transcript[:40000] + "\n...[truncated]..."

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
        text = await async_call_gemini(prompt)
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


@router.post("/chat", dependencies=[_rl_chat])
async def chat_with_lecture(request: ChatRequest):
    """Answer questions about a video lecture using its transcript as context."""
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="message is required")

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

    history_text = ""
    if request.history:
        turns = []
        for msg in request.history[-10:]:
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
        reply = await async_call_gemini(prompt)
        return {"reply": reply.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")


@router.post("/translate-transcript", dependencies=[_rl_translate])
async def translate_transcript(req: TranslateRequest):
    """Translate transcript segments in chunks of 40 to avoid Gemini overload."""
    if not req.transcript:
        raise HTTPException(status_code=400, detail="Transcript is empty")

    client    = get_genai_client()
    SEPARATOR = "|||"
    CHUNK_SIZE = 40

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
        # call_gemini already handles retry + model fallback internally
        try:
            text = call_gemini(prompt)
            parts = [p.strip() for p in text.strip().split(SEPARATOR)]
            return parts
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Translation error: {e}")

    all_translations: list[str] = []

    def _run_all_chunks() -> list[str]:
        out: list[str] = []
        for chunk_start in range(0, len(req.transcript), CHUNK_SIZE):
            chunk = req.transcript[chunk_start: chunk_start + CHUNK_SIZE]
            out.extend(translate_chunk(chunk))
            if chunk_start + CHUNK_SIZE < len(req.transcript):
                time.sleep(0.5)
        return out

    # Run the blocking translation loop off the event loop
    all_translations = await asyncio.to_thread(_run_all_chunks)

    result = []
    for i, seg in enumerate(req.transcript):
        result.append({
            "start":       seg.get("start", 0),
            "text":        seg.get("text", ""),
            "translation": all_translations[i] if i < len(all_translations) else ""
        })

    return {"translations": result, "target_language": req.target_language}


@router.post("/explain-concept", dependencies=[_rl_explain])
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


# ═══════════════════════════════════════════════════════
# AI AUTO-NOTES (CORNELL FORMAT)
# ═══════════════════════════════════════════════════════

@router.post("/auto-notes", dependencies=[_rl_notes])
async def generate_auto_notes(request: AutoNotesRequest):
    """Generate structured study notes in Cornell format from video analysis data."""
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    # Build content context
    content_parts = []
    content_parts.append(f"VIDEO TITLE: {request.title}")

    if request.overview:
        content_parts.append(f"\nOVERVIEW:\n{request.overview}")

    if request.topics:
        topics_text = "\n".join(
            f"  [{t.get('timestamp_str', '')}] {t.get('title', '')}: {t.get('summary', '')}"
            for t in request.topics[:12]
        )
        content_parts.append(f"\nCHAPTERS/TOPICS:\n{topics_text}")

    if request.key_takeaways:
        kt_text = "\n".join(f"  - {kt}" for kt in request.key_takeaways[:8])
        content_parts.append(f"\nKEY TAKEAWAYS:\n{kt_text}")

    if request.transcript:
        lines = []
        for entry in request.transcript[:150]:
            ts = entry.get("start", 0)
            m = int(ts) // 60
            s = int(ts) % 60
            text = entry.get("text", "").strip().replace("\n", " ")
            lines.append(f"[{m:02d}:{s:02d}] {text}")
        transcript_text = "\n".join(lines)
        if len(transcript_text) > 25000:
            transcript_text = transcript_text[:25000] + "\n...[truncated]..."
        content_parts.append(f"\nTRANSCRIPT (excerpts):\n{transcript_text}")

    full_content = "\n".join(content_parts)

    prompt = f"""You are an expert note-taking assistant. Create comprehensive study notes in the **Cornell Note-Taking Method** format from this video lecture.

{full_content}

⚠️ Generate ALL text in **{request.output_language}**.

Create notes using this EXACT format (use the headers and separators exactly as shown):

═══════════════════════════════════════
📚 CORNELL NOTES: [Video title]
═══════════════════════════════════════

📅 Date: [today's date]
🎬 Source: [video title]

───────────────────────────────────────
📝 MAIN NOTES
───────────────────────────────────────

[For each major topic/chapter in the video, write detailed notes with:]
- Clear section headers using ## for each topic
- Bullet points for key concepts
- Include relevant timestamps [MM:SS] when possible
- Use indentation for sub-points
- Bold **key terms** naturally in the text

───────────────────────────────────────
❓ CUE COLUMN (Questions & Keywords)
───────────────────────────────────────

[Generate 5-8 study questions or keywords that test understanding of the main notes. Format:]
• Question or keyword → Brief trigger/hint

───────────────────────────────────────
📋 SUMMARY (2-3 sentences)
───────────────────────────────────────

[Write a concise 2-3 sentence summary that captures the essence of the entire lecture]

───────────────────────────────────────
🔑 KEY VOCABULARY
───────────────────────────────────────

[List 5-8 key terms with brief definitions, format:]
• **Term** — Definition

RULES:
- Be thorough but concise — capture ALL important concepts
- Main notes should be detailed enough to study from without rewatching
- Cue column questions should promote active recall
- Use the exact separator format shown above
- Include timestamps [MM:SS] in main notes where relevant
- DO NOT use markdown code fences — output plain text only"""

    try:
        notes_text = await async_call_gemini(prompt)
        return {"notes": notes_text.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Auto-notes generation failed: {e}")


# ═══════════════════════════════════════════════════════
# SMART BOOKMARK (AI CONTEXT SUMMARY)
# ═══════════════════════════════════════════════════════

@router.post("/smart-bookmark", dependencies=[_rl_bookmark])
async def smart_bookmark_summary(request: SmartBookmarkRequest):
    """Generate a concise AI summary of transcript context around a bookmarked timestamp."""
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    if not request.transcript_context:
        raise HTTPException(status_code=400, detail="transcript_context is required")

    # Format the context
    context_lines = []
    for entry in request.transcript_context:
        ts = entry.get("start", 0)
        m = int(ts) // 60
        s = int(ts) % 60
        text = entry.get("text", "").strip().replace("\n", " ")
        context_lines.append(f"[{m:02d}:{s:02d}] {text}")
    context_text = "\n".join(context_lines)

    bm_m = request.timestamp // 60
    bm_s = request.timestamp % 60
    bm_ts = f"{bm_m:02d}:{bm_s:02d}"

    prompt = f"""You are a study assistant. A student bookmarked timestamp [{bm_ts}] in this video lecture.

VIDEO: {request.title}

TRANSCRIPT CONTEXT (around the bookmarked moment):
{context_text}

Write a concise summary (1-2 sentences MAX, under 120 characters if possible) of what is being discussed at this moment. This will be shown as a bookmark description.

⚠️ Respond in **{request.output_language}**.

RULES:
- Be extremely concise — this is a bookmark label, not a paragraph
- Focus on the KEY concept or idea being discussed
- Do NOT start with "At this point" or "The speaker"
- Just state the concept directly
- No quotes, no markdown, plain text only"""

    try:
        summary = await async_call_gemini(prompt)
        return {"summary": summary.strip()[:200]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Smart bookmark failed: {e}")


# ═══════════════════════════════════════════════════════
# QUIZ WEAK AREA ANALYSIS
# ═══════════════════════════════════════════════════════

class QuizAnalysisRequest(BaseModel):
    title: str = ''
    questions: list = []           # [{question, options, correct_index, explanation, difficulty}, ...]
    user_answers: list = []        # [selectedIndex or -1 for skipped, ...]
    score: int = 0
    total_answered: int = 0
    output_language: str = 'Vietnamese'


@router.post("/quiz-analysis", dependencies=[_rl_analysis])
async def analyze_quiz_results(request: QuizAnalysisRequest):
    """Analyze quiz results to identify weak areas and provide study recommendations."""
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    if not request.questions:
        raise HTTPException(status_code=400, detail="questions required")

    # Build detailed results
    results_block = []
    for i, q in enumerate(request.questions):
        user_ans = request.user_answers[i] if i < len(request.user_answers) else -1
        correct_idx = q.get("correct_index", 0)
        is_correct = user_ans == correct_idx
        is_skipped = user_ans == -1

        status = "✓ CORRECT" if is_correct else ("⊘ SKIPPED" if is_skipped else "✗ WRONG")
        options = q.get("options", [])
        user_choice = options[user_ans] if 0 <= user_ans < len(options) else "(skipped)"
        correct_choice = options[correct_idx] if 0 <= correct_idx < len(options) else ""

        results_block.append(
            f"Q{i+1} [{status}] (difficulty: {q.get('difficulty', 'medium')})\n"
            f"  Question: {q.get('question', '')}\n"
            f"  User answered: {user_choice}\n"
            f"  Correct answer: {correct_choice}\n"
            f"  Explanation: {q.get('explanation', '')}"
        )

    results_text = "\n\n".join(results_block)
    pct = round(request.score / max(request.total_answered, 1) * 100)

    prompt = f"""You are an expert educational analyst. Analyze this student's quiz performance on a video lecture and provide actionable insights.

VIDEO: {request.title}
SCORE: {request.score}/{request.total_answered} ({pct}%)

DETAILED RESULTS:
{results_text}

⚠️ Respond in **{request.output_language}**.

Analyze the results and return ONLY a valid JSON object (no markdown fences):
{{
  "overall_rating": "excellent|good|average|needs_improvement|weak",
  "summary": "1-2 sentence overall assessment of the student's understanding",
  "weak_areas": [
    {{
      "topic": "Name of the weak topic/concept",
      "detail": "What the student got wrong and why it matters",
      "tip": "Specific advice to improve understanding of this topic"
    }}
  ],
  "strong_areas": [
    {{
      "topic": "Name of the strong topic/concept",
      "detail": "Brief note on what the student understood well"
    }}
  ],
  "study_plan": [
    "Actionable step 1 to improve",
    "Actionable step 2 to improve",
    "Actionable step 3 to improve"
  ],
  "misconceptions": [
    "Any common misconception the student may have based on wrong answers"
  ]
}}

RULES:
- weak_areas: list 2-4 topics where the student struggled (based on wrong/skipped questions)
- strong_areas: list 1-3 topics the student knows well
- study_plan: 3-4 specific, actionable study steps
- misconceptions: 1-2 if any detected from wrong answer patterns
- If the score is perfect, weak_areas can be empty and give advanced study suggestions instead
- Be encouraging but honest"""

    try:
        text = await async_call_gemini(prompt)
        text = text.strip()
        if text.startswith('```'):
            text = re.sub(r'^```(?:json)?\s*\n?', '', text)
            text = re.sub(r'\n?\s*```$', '', text)
        result = json.loads(text)

        # Ensure all keys exist
        for key in ["weak_areas", "strong_areas", "study_plan", "misconceptions"]:
            if key not in result:
                result[key] = []
        if "overall_rating" not in result:
            result["overall_rating"] = "average"
        if "summary" not in result:
            result["summary"] = ""

        result["score"] = request.score
        result["total"] = request.total_answered
        result["percentage"] = pct

        return result

    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Quiz analysis failed: {e}")

