"""
English Learning — daily vocabulary, flashcards, quizzes.
Uses Gemini AI to generate contextual vocabulary.
"""

import os
import json
import time
import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from gemini_client import call_gemini
from database import get_db, db_check_rate_limit
from routes.auth import get_current_user

router = APIRouter(prefix="/api/english", tags=["english"])
logger = logging.getLogger("english")


# ═══════════════════════════════════════════════════════
# DATABASE
# ═══════════════════════════════════════════════════════

def _init_english_tables():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS english_vocab (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            word TEXT NOT NULL,
            meaning TEXT DEFAULT '',
            example TEXT DEFAULT '',
            phonetic TEXT DEFAULT '',
            topic TEXT DEFAULT '',
            level TEXT DEFAULT 'intermediate',
            learned_at REAL NOT NULL,
            next_review REAL DEFAULT 0,
            ease_factor REAL DEFAULT 2.5,
            interval INTEGER DEFAULT 0,
            repetitions INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_ev_user ON english_vocab(user_id);
        CREATE INDEX IF NOT EXISTS idx_ev_review ON english_vocab(user_id, next_review);

        CREATE TABLE IF NOT EXISTS english_streak (
            user_id INTEGER PRIMARY KEY,
            current_streak INTEGER DEFAULT 0,
            longest_streak INTEGER DEFAULT 0,
            last_study_date TEXT DEFAULT '',
            total_words INTEGER DEFAULT 0,
            total_quizzes INTEGER DEFAULT 0
        );
    """)
    conn.commit()

try:
    _init_english_tables()
except:
    pass


# ═══════════════════════════════════════════════════════
# MODELS
# ═══════════════════════════════════════════════════════

class GenerateVocabRequest(BaseModel):
    topic: str = 'general'
    level: str = 'intermediate'
    count: int = 5


# ═══════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════

@router.post("/generate-vocab")
async def generate_vocab(req: GenerateVocabRequest, request: Request):
    """Generate new vocabulary words using AI."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    # Rate limit
    ip = request.client.host if request.client else "unknown"
    allowed, _ = db_check_rate_limit(f"english:{ip}", max_attempts=10, window_secs=300, block_secs=300)
    if not allowed:
        raise HTTPException(status_code=429, detail="Quá nhiều yêu cầu")

    count = min(max(req.count, 1), 100)
    prompt = f"""Generate {count} English vocabulary words for a Vietnamese learner preparing for English proficiency exams.

Exam/Topic: {req.topic}
Target Level: {req.level}

Return ONLY a valid JSON array (no markdown fences):
[
  {{
    "word": "the English word or phrase",
    "meaning": "nghĩa tiếng Việt (ngắn gọn, chính xác)",
    "example": "An example sentence that might appear in the exam",
    "phonetic": "/IPA phonetic transcription/",
    "part_of_speech": "noun/verb/adj/adv/phrase",
    "exam_tip": "Mẹo: ngữ cảnh thường gặp trong đề thi (tiếng Việt)"
  }}
]

Rules:
- Words MUST be relevant to the specified exam (IELTS/TOEIC/TOEFL/Cambridge)
- For IELTS: academic vocabulary, collocations, topic-specific words
- For TOEIC: business English, workplace vocabulary, formal expressions
- For TOEFL: academic discourse, research vocabulary
- Examples should mimic real exam contexts (reading passages, listening scripts)
- Include collocations and phrasal verbs commonly tested
- Meanings in Vietnamese should be clear and exam-relevant
- exam_tip: brief Vietnamese tip about how/where this word appears in exams
- Avoid basic words — focus on B2-C1 level vocabulary
- Include a mix of single words and useful phrases/collocations"""

    try:
        import re
        text = call_gemini(prompt)
        text = text.strip()
        if text.startswith('```'):
            text = re.sub(r'^```(?:json)?\s*\n?', '', text)
            text = re.sub(r'\n?\s*```$', '', text)
        words = json.loads(text)

        # Save to database
        conn = get_db()
        now = time.time()
        saved = []
        for w in words:
            conn.execute("""
                INSERT INTO english_vocab (user_id, word, meaning, example, phonetic, topic, level, learned_at, next_review)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (user["id"], w.get("word", ""), w.get("meaning", ""), w.get("example", ""),
                  w.get("phonetic", ""), req.topic, req.level, now, now))
            saved.append(w)
        conn.commit()

        # Update streak
        _update_streak(user["id"], len(saved))

        return {"words": saved, "count": len(saved)}

    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"AI response parse error: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/today")
async def get_today_words(request: Request):
    """Get today's vocabulary words."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    conn = get_db()
    today_start = time.time() - 86400  # last 24h
    rows = conn.execute("""
        SELECT * FROM english_vocab WHERE user_id = ? AND learned_at > ?
        ORDER BY learned_at DESC LIMIT 100
    """, (user["id"], today_start)).fetchall()

    return {"words": [{
        "id": r["id"], "word": r["word"], "meaning": r["meaning"],
        "example": r["example"], "phonetic": r["phonetic"],
        "topic": r["topic"], "level": r["level"],
    } for r in rows]}


@router.get("/all")
async def get_all_words(request: Request, page: int = 1, per_page: int = 20):
    """Get all saved words with pagination."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    conn = get_db()
    total = conn.execute("SELECT COUNT(*) as c FROM english_vocab WHERE user_id = ?", (user["id"],)).fetchone()["c"]
    offset = (page - 1) * per_page
    rows = conn.execute("""
        SELECT * FROM english_vocab WHERE user_id = ?
        ORDER BY learned_at DESC LIMIT ? OFFSET ?
    """, (user["id"], per_page, offset)).fetchall()

    return {
        "words": [{
            "id": r["id"], "word": r["word"], "meaning": r["meaning"],
            "example": r["example"], "phonetic": r["phonetic"],
            "topic": r["topic"],
        } for r in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page,
    }


@router.get("/review")
async def get_review_words(request: Request):
    """Get words due for review (spaced repetition)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    conn = get_db()
    now = time.time()
    rows = conn.execute("""
        SELECT * FROM english_vocab WHERE user_id = ? AND (next_review <= ? OR repetitions = 0)
        ORDER BY next_review ASC LIMIT 20
    """, (user["id"], now)).fetchall()

    return {"words": [{
        "id": r["id"], "word": r["word"], "meaning": r["meaning"],
        "example": r["example"], "phonetic": r["phonetic"],
        "ease_factor": r["ease_factor"], "interval": r["interval"],
    } for r in rows], "count": len(rows)}


@router.post("/review/{word_id}")
async def review_word(word_id: int, request: Request, quality: int = 3):
    """Review a word with SM-2 algorithm. Quality: 1=hard, 3=ok, 5=easy."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    conn = get_db()
    row = conn.execute("SELECT * FROM english_vocab WHERE id = ? AND user_id = ?", (word_id, user["id"])).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Word not found")

    # SM-2 algorithm
    ef = row["ease_factor"]
    interval = row["interval"]
    reps = row["repetitions"]

    if quality < 3:
        reps = 0
        interval = 1
    else:
        if reps == 0:
            interval = 1
        elif reps == 1:
            interval = 6
        else:
            interval = int(interval * ef)
        reps += 1

    ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    if ef < 1.3:
        ef = 1.3

    next_review = time.time() + (interval * 86400)

    conn.execute("""
        UPDATE english_vocab SET ease_factor = ?, interval = ?, repetitions = ?, next_review = ?
        WHERE id = ?
    """, (ef, interval, reps, next_review, word_id))
    conn.commit()

    return {"ok": True, "next_review_days": interval}


@router.get("/stats")
async def get_stats(request: Request):
    """Get learning statistics."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    conn = get_db()
    streak = conn.execute("SELECT * FROM english_streak WHERE user_id = ?", (user["id"],)).fetchone()
    total_words = conn.execute("SELECT COUNT(*) as c FROM english_vocab WHERE user_id = ?", (user["id"],)).fetchone()["c"]
    due_count = conn.execute(
        "SELECT COUNT(*) as c FROM english_vocab WHERE user_id = ? AND (next_review <= ? OR repetitions = 0)",
        (user["id"], time.time())
    ).fetchone()["c"]

    return {
        "current_streak": streak["current_streak"] if streak else 0,
        "longest_streak": streak["longest_streak"] if streak else 0,
        "total_words": total_words,
        "due_count": due_count,
        "total_quizzes": streak["total_quizzes"] if streak else 0,
    }


@router.post("/quiz")
async def generate_quiz(request: Request):
    """Generate a quiz from learned words."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    conn = get_db()
    rows = conn.execute("""
        SELECT word, meaning FROM english_vocab WHERE user_id = ?
        ORDER BY RANDOM() LIMIT 10
    """, (user["id"],)).fetchall()

    if len(rows) < 4:
        raise HTTPException(status_code=400, detail="Cần ít nhất 4 từ đã học để tạo quiz")

    import random
    questions = []
    for i, row in enumerate(rows):
        # Create multiple choice: correct + 3 wrong
        correct = row["meaning"]
        wrong_pool = [r["meaning"] for r in rows if r["word"] != row["word"]]
        random.shuffle(wrong_pool)
        options = [correct] + wrong_pool[:3]
        random.shuffle(options)

        questions.append({
            "id": i + 1,
            "word": row["word"],
            "options": options,
            "correct_index": options.index(correct),
        })

    # Update quiz count
    conn.execute("""
        INSERT INTO english_streak (user_id, total_quizzes) VALUES (?, 1)
        ON CONFLICT(user_id) DO UPDATE SET total_quizzes = total_quizzes + 1
    """, (user["id"],))
    conn.commit()

    return {"questions": questions[:5]}


def _update_streak(user_id, words_added):
    """Update study streak."""
    import datetime
    conn = get_db()
    today = datetime.date.today().isoformat()

    row = conn.execute("SELECT * FROM english_streak WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        conn.execute("""
            INSERT INTO english_streak (user_id, current_streak, longest_streak, last_study_date, total_words)
            VALUES (?, 1, 1, ?, ?)
        """, (user_id, today, words_added))
    else:
        last_date = row["last_study_date"]
        current = row["current_streak"]
        longest = row["longest_streak"]
        total = row["total_words"]

        yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
        if last_date == today:
            # Already studied today
            conn.execute("UPDATE english_streak SET total_words = ? WHERE user_id = ?",
                         (total + words_added, user_id))
        elif last_date == yesterday:
            current += 1
            longest = max(longest, current)
            conn.execute("""
                UPDATE english_streak SET current_streak = ?, longest_streak = ?, last_study_date = ?, total_words = ?
                WHERE user_id = ?
            """, (current, longest, today, total + words_added, user_id))
        else:
            conn.execute("""
                UPDATE english_streak SET current_streak = 1, last_study_date = ?, total_words = ?
                WHERE user_id = ?
            """, (today, total + words_added, user_id))

    conn.commit()
