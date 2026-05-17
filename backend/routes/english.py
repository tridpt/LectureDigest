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
            part_of_speech TEXT DEFAULT '',
            topic TEXT DEFAULT '',
            level TEXT DEFAULT 'intermediate',
            learned_at REAL NOT NULL,
            next_review REAL DEFAULT 0,
            ease_factor REAL DEFAULT 2.5,
            interval INTEGER DEFAULT 0,
            repetitions INTEGER DEFAULT 0,
            correct_count INTEGER DEFAULT 0,
            wrong_count INTEGER DEFAULT 0
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

        CREATE TABLE IF NOT EXISTS english_xp (
            user_id INTEGER PRIMARY KEY,
            xp INTEGER DEFAULT 0,
            level INTEGER DEFAULT 1,
            total_xp INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS english_xp_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            xp_gained INTEGER NOT NULL,
            source TEXT DEFAULT '',
            created_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_exl_user ON english_xp_log(user_id, created_at);

        CREATE TABLE IF NOT EXISTS english_daily_missions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            mission_key TEXT NOT NULL,
            target INTEGER DEFAULT 1,
            progress INTEGER DEFAULT 0,
            completed INTEGER DEFAULT 0,
            xp_reward INTEGER DEFAULT 10,
            claimed INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_edm_user_date ON english_daily_missions(user_id, date);
    """)
    conn.commit()

try:
    _init_english_tables()
except:
    pass

# Migration: add part_of_speech column if missing
try:
    conn = get_db()
    conn.execute("ALTER TABLE english_vocab ADD COLUMN part_of_speech TEXT DEFAULT ''")
    conn.commit()
except:
    pass

# Migration: add correct_count, wrong_count columns
try:
    conn = get_db()
    conn.execute("ALTER TABLE english_vocab ADD COLUMN correct_count INTEGER DEFAULT 0")
    conn.execute("ALTER TABLE english_vocab ADD COLUMN wrong_count INTEGER DEFAULT 0")
    conn.commit()
except:
    pass

# Migration: study time and goal tables
try:
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS english_study_time (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            seconds INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_est_user_date ON english_study_time(user_id, date);
        CREATE TABLE IF NOT EXISTS english_study_goal (
            user_id INTEGER PRIMARY KEY,
            goal_minutes INTEGER DEFAULT 0
        );
    """)
    conn.commit()
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
                INSERT INTO english_vocab (user_id, word, meaning, example, phonetic, part_of_speech, topic, level, learned_at, next_review)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (user["id"], w.get("word", ""), w.get("meaning", ""), w.get("example", ""),
                  w.get("phonetic", ""), w.get("part_of_speech", ""), req.topic, req.level, now, now))
            saved.append(w)
        conn.commit()

        # Update streak
        _update_streak(user["id"], len(saved))

        # Update daily mission: learn_words
        _update_mission_progress(user["id"], "learn_words", len(saved))

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
        "part_of_speech": r["part_of_speech"] if "part_of_speech" in r.keys() else "",
        "topic": r["topic"], "level": r["level"],
    } for r in rows]}


@router.get("/all")
async def get_all_words(request: Request, page: int = 1, per_page: int = 20, topic: str = '', pos: str = '', mastery: int = 0):
    """Get all saved words with pagination and filters."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    conn = get_db()

    # Build query with filters
    where = "WHERE user_id = ?"
    params = [user["id"]]

    if topic:
        where += " AND topic = ?"
        params.append(topic)
    if pos:
        where += " AND LOWER(part_of_speech) LIKE ?"
        params.append(f"%{pos.lower()}%")
    if mastery > 0:
        # Mastery levels: 1=0 correct, 2=1-2, 3=3-5, 4=6-9, 5=10+
        if mastery == 1:
            where += " AND (correct_count IS NULL OR correct_count = 0)"
        elif mastery == 2:
            where += " AND correct_count >= 1 AND correct_count <= 2"
        elif mastery == 3:
            where += " AND correct_count >= 3 AND correct_count <= 5"
        elif mastery == 4:
            where += " AND correct_count >= 6 AND correct_count <= 9"
        elif mastery == 5:
            where += " AND correct_count >= 10"

    total = conn.execute(f"SELECT COUNT(*) as c FROM english_vocab {where}", params).fetchone()["c"]
    offset = (page - 1) * per_page
    rows = conn.execute(f"""
        SELECT * FROM english_vocab {where}
        ORDER BY learned_at DESC LIMIT ? OFFSET ?
    """, params + [per_page, offset]).fetchall()

    return {
        "words": [{
            "id": r["id"], "word": r["word"], "meaning": r["meaning"],
            "example": r["example"], "phonetic": r["phonetic"],
            "part_of_speech": r["part_of_speech"] if "part_of_speech" in r.keys() else "",
            "topic": r["topic"],
            "correct_count": r["correct_count"] if "correct_count" in r.keys() else 0,
            "wrong_count": r["wrong_count"] if "wrong_count" in r.keys() else 0,
            "mastery": _mastery_level(r["correct_count"] if "correct_count" in r.keys() else 0),
        } for r in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page,
    }


@router.get("/review")
async def get_review_words(request: Request, limit: int = 20, topic: str = '', type: str = 'due'):
    """Get words for review. type: due/new/all."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    conn = get_db()
    now = time.time()
    limit = min(max(limit, 1), 50)

    if type == 'new':
        query = "SELECT * FROM english_vocab WHERE user_id = ? AND repetitions = 0"
        params = [user["id"]]
    elif type == 'all':
        query = "SELECT * FROM english_vocab WHERE user_id = ?"
        params = [user["id"]]
    else:  # due
        query = "SELECT * FROM english_vocab WHERE user_id = ? AND (next_review <= ? OR repetitions = 0)"
        params = [user["id"], now]

    if topic:
        query += " AND topic = ?"
        params.append(topic)

    if type == 'all':
        query += " ORDER BY RANDOM() LIMIT ?"
    else:
        query += " ORDER BY next_review ASC LIMIT ?"
    params.append(limit)

    rows = conn.execute(query, params).fetchall()

    return {"words": [{
        "id": r["id"], "word": r["word"], "meaning": r["meaning"],
        "example": r["example"], "phonetic": r["phonetic"],
        "part_of_speech": r["part_of_speech"] if "part_of_speech" in r.keys() else "",
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

    # Update correct/wrong count
    if quality >= 3:
        conn.execute("UPDATE english_vocab SET correct_count = correct_count + 1 WHERE id = ?", (word_id,))
    else:
        conn.execute("UPDATE english_vocab SET wrong_count = wrong_count + 1 WHERE id = ?", (word_id,))

    conn.commit()

    # Update daily mission (after commit to avoid DB lock)
    if quality >= 3:
        _update_mission_progress(user["id"], "review_cards", 1)

    return {"ok": True, "next_review_days": interval}


@router.get("/topics")
async def get_topics(request: Request):
    """Get list of topics the user has studied."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")
    conn = get_db()
    rows = conn.execute(
        "SELECT DISTINCT topic FROM english_vocab WHERE user_id = ? AND topic != '' ORDER BY topic",
        (user["id"],)
    ).fetchall()
    return {"topics": [r["topic"] for r in rows]}


@router.post("/add-word")
async def add_word_manual(request: Request):
    """Manually add a word."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    body = await request.json()
    word = body.get("word", "").strip()
    meaning = body.get("meaning", "").strip()
    if not word or not meaning:
        raise HTTPException(status_code=400, detail="Cần nhập từ và nghĩa")

    phonetic = body.get("phonetic", "").strip()
    part_of_speech = body.get("part_of_speech", "").strip()
    example = body.get("example", "").strip()
    topic = body.get("topic", "Thủ công").strip()

    conn = get_db()
    now = time.time()
    conn.execute("""
        INSERT INTO english_vocab (user_id, word, meaning, example, phonetic, part_of_speech, topic, level, learned_at, next_review)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'intermediate', ?, ?)
    """, (user["id"], word, meaning, example, phonetic, part_of_speech, topic, now, now))
    conn.commit()

    _update_streak(user["id"], 1)
    return {"ok": True, "word": word}


@router.delete("/word/{word_id}")
async def delete_word(word_id: int, request: Request):
    """Delete a word."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    conn = get_db()
    row = conn.execute("SELECT id FROM english_vocab WHERE id = ? AND user_id = ?", (word_id, user["id"])).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Không tìm thấy từ")

    conn.execute("DELETE FROM english_vocab WHERE id = ?", (word_id,))
    conn.commit()
    return {"ok": True}


@router.put("/word/{word_id}")
async def update_word(word_id: int, request: Request):
    """Update a word."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    conn = get_db()
    row = conn.execute("SELECT id FROM english_vocab WHERE id = ? AND user_id = ?", (word_id, user["id"])).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Không tìm thấy từ")

    body = await request.json()
    word = body.get("word", "").strip()
    meaning = body.get("meaning", "").strip()
    if not word or not meaning:
        raise HTTPException(status_code=400, detail="Cần nhập từ và nghĩa")

    phonetic = body.get("phonetic", "").strip()
    part_of_speech = body.get("part_of_speech", "").strip()
    example = body.get("example", "").strip()

    conn.execute("""
        UPDATE english_vocab SET word = ?, meaning = ?, phonetic = ?, part_of_speech = ?, example = ?
        WHERE id = ?
    """, (word, meaning, phonetic, part_of_speech, example, word_id))
    conn.commit()
    return {"ok": True}


@router.post("/study-time")
async def update_study_time(request: Request):
    """Update study time for today. Body: {seconds: int}"""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    import datetime
    body = await request.json()
    seconds = body.get("seconds", 0)
    today = datetime.date.today().isoformat()

    conn = get_db()
    row = conn.execute(
        "SELECT * FROM english_study_time WHERE user_id = ? AND date = ?",
        (user["id"], today)
    ).fetchone()

    if row:
        conn.execute("UPDATE english_study_time SET seconds = ? WHERE id = ?", (seconds, row["id"]))
    else:
        conn.execute("INSERT INTO english_study_time (user_id, date, seconds) VALUES (?, ?, ?)",
                     (user["id"], today, seconds))
    conn.commit()
    return {"ok": True, "seconds": seconds}


@router.get("/study-time")
async def get_study_time(request: Request):
    """Get study time stats."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    import datetime
    conn = get_db()
    today = datetime.date.today().isoformat()

    row = conn.execute(
        "SELECT seconds FROM english_study_time WHERE user_id = ? AND date = ?",
        (user["id"], today)
    ).fetchone()
    today_seconds = row["seconds"] if row else 0

    total_row = conn.execute(
        "SELECT SUM(seconds) as total FROM english_study_time WHERE user_id = ?",
        (user["id"],)
    ).fetchone()
    total_seconds = total_row["total"] if total_row and total_row["total"] else 0

    goal_row = conn.execute(
        "SELECT goal_minutes FROM english_study_goal WHERE user_id = ?",
        (user["id"],)
    ).fetchone()
    goal_minutes = goal_row["goal_minutes"] if goal_row else 0

    return {"today_seconds": today_seconds, "total_seconds": total_seconds, "goal_minutes": goal_minutes}


@router.post("/study-goal")
async def set_study_goal(request: Request):
    """Set daily study time goal. Body: {minutes: int}"""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    body = await request.json()
    minutes = max(0, min(480, body.get("minutes", 0)))

    conn = get_db()
    conn.execute("""
        INSERT INTO english_study_goal (user_id, goal_minutes) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET goal_minutes = ?
    """, (user["id"], minutes, minutes))
    conn.commit()
    return {"ok": True, "goal_minutes": minutes}


@router.post("/missions/customize")
async def customize_missions(request: Request):
    """Customize daily mission targets. Body: {missions: [{key, target}]}"""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    import datetime
    body = await request.json()
    custom = body.get("missions", [])
    today = datetime.date.today().isoformat()

    conn = get_db()
    _get_or_create_daily_missions(user["id"])

    for m in custom:
        key = m.get("key", "")
        target = max(1, min(50, m.get("target", 1)))
        conn.execute("""
            UPDATE english_daily_missions SET target = ?
            WHERE user_id = ? AND date = ? AND mission_key = ? AND completed = 0
        """, (target, user["id"], today, key))

    conn.commit()
    return {"ok": True}


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
async def generate_quiz(request: Request, count: int = 5, topic: str = ''):
    """Generate a quiz from learned words."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    count = min(max(count, 3), 20)
    conn = get_db()

    if topic:
        rows = conn.execute("""
            SELECT word, meaning, part_of_speech FROM english_vocab WHERE user_id = ? AND topic = ?
            ORDER BY RANDOM() LIMIT ?
        """, (user["id"], topic, count + 5)).fetchall()
    else:
        rows = conn.execute("""
            SELECT word, meaning, part_of_speech FROM english_vocab WHERE user_id = ?
            ORDER BY RANDOM() LIMIT ?
        """, (user["id"], count + 5)).fetchall()

    if len(rows) < 4:
        raise HTTPException(status_code=400, detail="Cần ít nhất 4 từ đã học để tạo quiz")

    import random
    questions = []
    for i, row in enumerate(rows[:count]):
        # Create multiple choice: correct + 3 wrong
        correct = row["meaning"]
        wrong_pool = [r["meaning"] for r in rows if r["word"] != row["word"]]
        random.shuffle(wrong_pool)
        options = [correct] + wrong_pool[:3]
        random.shuffle(options)

        questions.append({
            "id": i + 1,
            "word": row["word"],
            "part_of_speech": row["part_of_speech"] if "part_of_speech" in row.keys() else "",
            "options": options,
            "correct_index": options.index(correct),
        })

    # Update quiz count
    conn.execute("""
        INSERT INTO english_streak (user_id, total_quizzes) VALUES (?, 1)
        ON CONFLICT(user_id) DO UPDATE SET total_quizzes = total_quizzes + 1
    """, (user["id"],))
    conn.commit()

    # Update daily mission: quiz_complete
    _update_mission_progress(user["id"], "quiz_complete", 1)

    return {"questions": questions[:5]}


@router.post("/mastery/update")
async def update_mastery(request: Request):
    """Update correct/wrong counts for words after quiz or game.
    Body: { results: [{word: "...", correct: true/false}] }
    """
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    body = await request.json()
    results = body.get("results", [])
    if not results:
        return {"ok": True}

    conn = get_db()
    for r in results:
        word = r.get("word", "")
        correct = r.get("correct", False)
        if not word:
            continue
        if correct:
            conn.execute("""
                UPDATE english_vocab SET correct_count = correct_count + 1
                WHERE user_id = ? AND LOWER(word) = LOWER(?)
            """, (user["id"], word))
        else:
            conn.execute("""
                UPDATE english_vocab SET wrong_count = wrong_count + 1
                WHERE user_id = ? AND LOWER(word) = LOWER(?)
            """, (user["id"], word))
    conn.commit()
    return {"ok": True, "updated": len(results)}


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


# ═══════════════════════════════════════════════════════
# XP / LEVEL SYSTEM
# ═══════════════════════════════════════════════════════

# XP required per level: level N requires N*100 XP to reach level N+1
# Level 1 → 2: 100 XP, Level 2 → 3: 200 XP, etc.
def _xp_for_level(level):
    """XP needed to go from `level` to `level+1`."""
    return level * 100


def _mastery_level(correct_count):
    """Calculate mastery level from correct answer count.
    0 correct = Mới (new)
    1-2 correct = Quen (familiar)
    3-5 correct = Khá (good)
    6-9 correct = Giỏi (proficient)
    10+ correct = Thành thạo (mastered)
    """
    if correct_count >= 10:
        return {"level": 5, "label": "Thành thạo", "color": "#fbbf24"}
    elif correct_count >= 6:
        return {"level": 4, "label": "Giỏi", "color": "#10b981"}
    elif correct_count >= 3:
        return {"level": 3, "label": "Khá", "color": "#60a5fa"}
    elif correct_count >= 1:
        return {"level": 2, "label": "Quen", "color": "#a78bfa"}
    else:
        return {"level": 1, "label": "Mới", "color": "#94a3b8"}


def _add_xp(user_id, amount, source=""):
    """Add XP to user. Returns dict with xp info and whether leveled up."""
    conn = get_db()
    row = conn.execute("SELECT * FROM english_xp WHERE user_id = ?", (user_id,)).fetchone()

    if not row:
        conn.execute("INSERT INTO english_xp (user_id, xp, level, total_xp) VALUES (?, 0, 1, 0)", (user_id,))
        conn.commit()
        row = conn.execute("SELECT * FROM english_xp WHERE user_id = ?", (user_id,)).fetchone()

    xp = row["xp"] + amount
    level = row["level"]
    total_xp = row["total_xp"]
    # total_xp only increases (tracks lifetime earned XP, not affected by penalties)
    if amount > 0:
        total_xp += amount
    leveled_up = False
    leveled_down = False
    new_level = level

    # Handle level down when XP goes negative
    if xp < 0:
        if level <= 1:
            # Already at level 1, can't go lower
            xp = 0
        else:
            # Level down: borrow XP from previous level
            while xp < 0 and level > 1:
                level -= 1
                xp += _xp_for_level(level)  # previous level's max XP
                leveled_down = True
            if xp < 0:
                xp = 0
        new_level = level

    # Check level ups (only if gaining XP)
    if amount > 0:
        while xp >= _xp_for_level(level):
            xp -= _xp_for_level(level)
            level += 1
            leveled_up = True
        new_level = level

    conn.execute("UPDATE english_xp SET xp = ?, level = ?, total_xp = ? WHERE user_id = ?",
                 (xp, new_level, total_xp, user_id))

    # Log XP gain
    conn.execute("INSERT INTO english_xp_log (user_id, xp_gained, source, created_at) VALUES (?, ?, ?, ?)",
                 (user_id, amount, source, time.time()))
    conn.commit()

    return {
        "xp_gained": amount,
        "current_xp": xp,
        "level": new_level,
        "xp_needed": _xp_for_level(new_level),
        "total_xp": total_xp,
        "leveled_up": leveled_up,
        "leveled_down": leveled_down,
        "source": source,
    }


@router.get("/xp")
async def get_xp(request: Request):
    """Get user's XP and level info."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    conn = get_db()
    row = conn.execute("SELECT * FROM english_xp WHERE user_id = ?", (user["id"],)).fetchone()

    if not row:
        return {"xp": 0, "level": 1, "xp_needed": 100, "total_xp": 0, "progress_pct": 0, "can_hint": False}

    xp_needed = _xp_for_level(row["level"])
    progress_pct = round(row["xp"] / xp_needed * 100) if xp_needed > 0 else 0
    can_hint = row["xp"] > 0 or row["level"] > 1

    # Recent XP log (last 10)
    logs = conn.execute("""
        SELECT xp_gained, source, created_at FROM english_xp_log
        WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
    """, (user["id"],)).fetchall()

    return {
        "xp": row["xp"],
        "level": row["level"],
        "xp_needed": xp_needed,
        "total_xp": row["total_xp"],
        "progress_pct": progress_pct,
        "can_hint": can_hint,
        "recent_xp": [{"xp": l["xp_gained"], "source": l["source"]} for l in logs],
    }


@router.post("/xp/award")
async def award_xp(request: Request):
    """Award XP for completing activities. Body: {source, score, total}"""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    body = await request.json()
    source = body.get("source", "")
    score = body.get("score", 0)
    total = body.get("total", 0)

    # Calculate XP based on activity
    xp = 0
    if source == "review":
        # 5 XP per card reviewed, bonus for quality
        quality = body.get("quality", 3)
        xp = 5 + (quality - 1) * 2  # 5-13 XP per review
    elif source == "quiz":
        # Base 10 XP + bonus for correct answers
        if total > 0:
            pct = score / total
            xp = int(10 + pct * 30)  # 10-40 XP per quiz
    elif source == "game_match":
        if total > 0:
            pct = score / total
            xp = int(15 + pct * 25)  # 15-40 XP
    elif source == "game_spelling":
        if total > 0:
            pct = score / total
            xp = int(15 + pct * 35)  # 15-50 XP (harder game)
    elif source == "game_scramble":
        if total > 0:
            pct = score / total
            xp = int(15 + pct * 30)  # 15-45 XP
    elif source == "hint_penalty":
        # Deduct XP for using hints (score is negative amount)
        # Block if user is at level 1 with 0 XP
        conn = get_db()
        xp_row = conn.execute("SELECT * FROM english_xp WHERE user_id = ?", (user["id"],)).fetchone()
        if xp_row and xp_row["level"] <= 1 and xp_row["xp"] <= 0:
            return {"xp_gained": 0, "blocked": True, "reason": "XP đã về 0, không thể dùng gợi ý"}
        xp = score  # negative value
    else:
        xp = 5  # Default small XP

    if xp == 0:
        return {"xp_gained": 0}

    # Update daily missions based on source
    if source in ("game_match", "game_spelling", "game_scramble"):
        _update_mission_progress(user["id"], "game_play", 1)
    if source == "quiz" and total > 0 and score == total:
        _update_mission_progress(user["id"], "perfect_quiz", 1)

    result = _add_xp(user["id"], xp, source)
    return result


# ═══════════════════════════════════════════════════════
# DAILY MISSIONS
# ═══════════════════════════════════════════════════════

def _update_mission_progress(user_id, key, amount=1):
    """Helper to update a mission's progress."""
    import datetime
    try:
        conn = get_db()
        today = datetime.date.today().isoformat()
        row = conn.execute(
            "SELECT * FROM english_daily_missions WHERE user_id = ? AND date = ? AND mission_key = ?",
            (user_id, today, key)
        ).fetchone()
        if not row or row["completed"]:
            return
        new_progress = min(row["progress"] + amount, row["target"])
        completed = 1 if new_progress >= row["target"] else 0
        conn.execute("UPDATE english_daily_missions SET progress = ?, completed = ? WHERE id = ?",
                     (new_progress, completed, row["id"]))
        conn.commit()
    except Exception:
        pass

DAILY_MISSIONS = [
    {"key": "learn_words", "label": "Học từ mới", "icon": "📚", "target": 5, "xp": 15, "desc": "Tạo {target} từ vựng mới"},
    {"key": "review_cards", "label": "Ôn tập", "icon": "🔄", "target": 5, "xp": 15, "desc": "Ôn tập {target} thẻ flashcard"},
    {"key": "quiz_complete", "label": "Làm Quiz", "icon": "🧠", "target": 1, "xp": 20, "desc": "Hoàn thành {target} bài quiz"},
    {"key": "game_play", "label": "Chơi Game", "icon": "🎮", "target": 1, "xp": 20, "desc": "Hoàn thành {target} game"},
    {"key": "perfect_quiz", "label": "Quiz hoàn hảo", "icon": "🏆", "target": 1, "xp": 30, "desc": "Đạt 100% trong quiz"},
]


def _get_or_create_daily_missions(user_id):
    """Get today's missions, create if not exist."""
    import datetime
    conn = get_db()
    today = datetime.date.today().isoformat()

    rows = conn.execute(
        "SELECT * FROM english_daily_missions WHERE user_id = ? AND date = ?",
        (user_id, today)
    ).fetchall()

    if rows:
        return rows

    # Create today's missions
    for m in DAILY_MISSIONS:
        conn.execute("""
            INSERT INTO english_daily_missions (user_id, date, mission_key, target, progress, completed, xp_reward, claimed)
            VALUES (?, ?, ?, ?, 0, 0, ?, 0)
        """, (user_id, today, m["key"], m["target"], m["xp"]))
    conn.commit()

    return conn.execute(
        "SELECT * FROM english_daily_missions WHERE user_id = ? AND date = ?",
        (user_id, today)
    ).fetchall()


@router.get("/missions")
async def get_daily_missions(request: Request):
    """Get today's daily missions."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    rows = _get_or_create_daily_missions(user["id"])

    # Map mission data
    mission_map = {m["key"]: m for m in DAILY_MISSIONS}
    missions = []
    for r in rows:
        key = r["mission_key"]
        info = mission_map.get(key, {})
        missions.append({
            "id": r["id"],
            "key": key,
            "label": info.get("label", key),
            "icon": info.get("icon", "📋"),
            "desc": info.get("desc", "").replace("{target}", str(r["target"])),
            "target": r["target"],
            "progress": r["progress"],
            "completed": bool(r["completed"]),
            "xp_reward": r["xp_reward"],
            "claimed": bool(r["claimed"]),
        })

    return {"missions": missions, "all_completed": all(m["completed"] for m in missions)}


@router.post("/missions/progress")
async def update_mission_progress(request: Request):
    """Update mission progress. Body: {key: str, amount: int}"""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    import datetime
    body = await request.json()
    key = body.get("key", "")
    amount = body.get("amount", 1)
    today = datetime.date.today().isoformat()

    conn = get_db()
    # Ensure missions exist
    _get_or_create_daily_missions(user["id"])

    row = conn.execute(
        "SELECT * FROM english_daily_missions WHERE user_id = ? AND date = ? AND mission_key = ?",
        (user["id"], today, key)
    ).fetchone()

    if not row:
        return {"ok": False}

    if row["completed"]:
        return {"ok": True, "already_completed": True}

    new_progress = min(row["progress"] + amount, row["target"])
    completed = 1 if new_progress >= row["target"] else 0

    conn.execute("""
        UPDATE english_daily_missions SET progress = ?, completed = ?
        WHERE id = ?
    """, (new_progress, completed, row["id"]))
    conn.commit()

    return {"ok": True, "progress": new_progress, "target": row["target"], "completed": bool(completed)}


@router.post("/missions/claim/{mission_id}")
async def claim_mission_reward(mission_id: int, request: Request):
    """Claim XP reward for a completed mission."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    conn = get_db()
    row = conn.execute(
        "SELECT * FROM english_daily_missions WHERE id = ? AND user_id = ?",
        (mission_id, user["id"])
    ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Mission not found")
    if not row["completed"]:
        raise HTTPException(status_code=400, detail="Mission not completed")
    if row["claimed"]:
        return {"ok": True, "already_claimed": True}

    # Mark as claimed
    conn.execute("UPDATE english_daily_missions SET claimed = 1 WHERE id = ?", (mission_id,))
    conn.commit()

    # Award XP
    result = _add_xp(user["id"], row["xp_reward"], f"mission_{row['mission_key']}")
    return {"ok": True, "xp_awarded": row["xp_reward"], "xp_data": result}
