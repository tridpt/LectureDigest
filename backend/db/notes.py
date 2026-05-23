"""
Notes CRUD operations.
"""
import time
import logging
from .connection import get_db

logger = logging.getLogger("database")


def db_get_notes(video_id: str, user_id=None):
    conn = get_db()
    if user_id:
        row = conn.execute("SELECT content FROM notes WHERE video_id = ? AND user_id = ?", (video_id, user_id)).fetchone()
    else:
        row = conn.execute("SELECT content FROM notes WHERE video_id = ? AND user_id IS NULL", (video_id,)).fetchone()
    conn.close()
    return row["content"] if row else ""

def db_save_notes(video_id: str, content: str, user_id=None):
    conn = get_db()
    # Composite PK is (video_id, COALESCE(user_id, 0)), so we can use upsert
    existing = conn.execute(
        "SELECT 1 FROM notes WHERE video_id = ? AND COALESCE(user_id, 0) = ?",
        (video_id, user_id or 0)
    ).fetchone()
    if existing:
        if user_id:
            conn.execute("UPDATE notes SET content = ?, updated_at = ? WHERE video_id = ? AND user_id = ?",
                         (content, int(time.time() * 1000), video_id, user_id))
        else:
            conn.execute("UPDATE notes SET content = ?, updated_at = ? WHERE video_id = ? AND user_id IS NULL",
                         (content, int(time.time() * 1000), video_id))
    else:
        conn.execute("INSERT INTO notes (video_id, content, updated_at, user_id) VALUES (?, ?, ?, ?)",
                     (video_id, content, int(time.time() * 1000), user_id))
    conn.commit()
    conn.close()

def db_get_all_notes(user_id=None):
    """Get all notes for a user. Returns dict {video_id: content}."""
    conn = get_db()
    if user_id:
        rows = conn.execute("SELECT video_id, content FROM notes WHERE user_id = ?", (user_id,)).fetchall()
    else:
        rows = conn.execute("SELECT video_id, content FROM notes WHERE user_id IS NULL").fetchall()
    conn.close()
    return {r["video_id"]: r["content"] for r in rows if r["content"]}
