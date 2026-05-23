"""
History CRUD operations.
"""
import json
import time
import logging
from .connection import get_db

logger = logging.getLogger("database")


def db_get_history(limit=50, user_id=None, before=None):
    """Get history with cursor-based pagination. `before` is a saved_at timestamp."""
    conn = get_db()
    if user_id:
        if before:
            rows = conn.execute(
                "SELECT * FROM history WHERE user_id = ? AND saved_at < ? ORDER BY saved_at DESC LIMIT ?",
                (user_id, before, limit + 1)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM history WHERE user_id = ? ORDER BY saved_at DESC LIMIT ?",
                (user_id, limit + 1)
            ).fetchall()
    else:
        if before:
            rows = conn.execute(
                "SELECT * FROM history WHERE user_id IS NULL AND saved_at < ? ORDER BY saved_at DESC LIMIT ?",
                (before, limit + 1)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM history WHERE user_id IS NULL ORDER BY saved_at DESC LIMIT ?",
                (limit + 1,)
            ).fetchall()
    conn.close()

    has_more = len(rows) > limit
    if has_more:
        rows = rows[:limit]

    result = []
    for r in rows:
        entry = {
            "entry_id": r["entry_id"],
            "video_id": r["video_id"],
            "url": r["url"],
            "title": r["title"],
            "author": r["author"],
            "thumbnail": r["thumbnail"],
            "savedAt": r["saved_at"],
            "lang": r["lang"],
        }
        try:
            entry["data"] = json.loads(r["data_json"]) if r["data_json"] else {}
        except:
            entry["data"] = {}
        try:
            entry["transcript"] = json.loads(r["transcript_json"]) if r["transcript_json"] else None
        except:
            entry["transcript"] = None
        result.append(entry)

    next_cursor = result[-1]["savedAt"] if result and has_more else None
    return {"items": result, "has_more": has_more, "next_cursor": next_cursor}

def db_save_history(entry: dict, user_id=None):
    conn = get_db()
    entry_id = entry.get("entry_id", f"{entry.get('video_id', 'unknown')}_{int(time.time()*1000)}")
    data_json = json.dumps(entry.get("data", {}), ensure_ascii=False)
    transcript = entry.get("transcript") or (entry.get("data", {}).get("transcript"))
    transcript_json = json.dumps(transcript, ensure_ascii=False) if transcript else None

    conn.execute("""
        INSERT OR REPLACE INTO history (entry_id, video_id, url, title, author, thumbnail, saved_at, lang, data_json, transcript_json, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        entry_id,
        entry.get("video_id", ""),
        entry.get("url", ""),
        entry.get("title", ""),
        entry.get("author", ""),
        entry.get("thumbnail", ""),
        entry.get("savedAt", int(time.time() * 1000)),
        entry.get("lang", "en"),
        data_json,
        transcript_json,
        user_id,
    ))
    conn.commit()
    conn.close()
    return entry_id

def db_delete_history(entry_id: str, user_id=None):
    conn = get_db()
    if user_id:
        conn.execute("DELETE FROM history WHERE entry_id = ? AND user_id = ?", (entry_id, user_id))
    else:
        conn.execute("DELETE FROM history WHERE entry_id = ?", (entry_id,))
    conn.commit()
    conn.close()

def db_clear_history(user_id=None):
    conn = get_db()
    if user_id:
        conn.execute("DELETE FROM history WHERE user_id = ?", (user_id,))
    else:
        conn.execute("DELETE FROM history WHERE user_id IS NULL")
    conn.commit()
    conn.close()
