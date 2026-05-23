"""
Bookmarks CRUD operations.
"""
import logging
from .connection import get_db

logger = logging.getLogger("database")


def db_get_bookmarks(video_id: str, user_id=None):
    conn = get_db()
    if user_id:
        rows = conn.execute(
            "SELECT * FROM bookmarks WHERE video_id = ? AND user_id = ? ORDER BY time_secs ASC", (video_id, user_id)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM bookmarks WHERE video_id = ? AND user_id IS NULL ORDER BY time_secs ASC", (video_id,)
        ).fetchall()
    conn.close()
    result = []
    for r in rows:
        bm = {"id": r["id"], "time": r["time_secs"], "label": r["label"], "createdAt": r["created_at"]}
        try:
            bm["summary"] = r["summary"] or ""
        except (IndexError, KeyError):
            bm["summary"] = ""
        result.append(bm)
    return result

def db_save_bookmark(video_id: str, time_secs: int, label: str, created_at: str = None, user_id=None, summary: str = ""):
    conn = get_db()
    conn.execute("""
        INSERT INTO bookmarks (video_id, time_secs, label, created_at, user_id, summary)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (video_id, time_secs, label, created_at or "", user_id, summary))
    conn.commit()
    conn.close()

def db_delete_bookmark(bookmark_id: int):
    conn = get_db()
    conn.execute("DELETE FROM bookmarks WHERE id = ?", (bookmark_id,))
    conn.commit()
    conn.close()

def db_sync_bookmarks(video_id: str, bookmarks: list, user_id=None):
    """Replace all bookmarks for a video (for a specific user)."""
    conn = get_db()
    if user_id:
        conn.execute("DELETE FROM bookmarks WHERE video_id = ? AND user_id = ?", (video_id, user_id))
    else:
        conn.execute("DELETE FROM bookmarks WHERE video_id = ? AND user_id IS NULL", (video_id,))
    for bm in bookmarks:
        conn.execute("""
            INSERT INTO bookmarks (video_id, time_secs, label, created_at, user_id, summary)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (video_id, bm.get("time", 0), bm.get("label", ""), bm.get("createdAt", ""), user_id, bm.get("summary", "")))
    conn.commit()
    conn.close()

def db_get_all_bookmarks(user_id=None):
    """Get all bookmarks for a user grouped by video_id. Returns dict {video_id: [bookmarks]}."""
    conn = get_db()
    if user_id:
        rows = conn.execute(
            "SELECT * FROM bookmarks WHERE user_id = ? ORDER BY video_id, time_secs ASC", (user_id,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM bookmarks WHERE user_id IS NULL ORDER BY video_id, time_secs ASC"
        ).fetchall()
    conn.close()
    result = {}
    for r in rows:
        vid = r["video_id"]
        if vid not in result:
            result[vid] = []
        bm = {"time": r["time_secs"], "label": r["label"], "createdAt": r["created_at"]}
        try:
            bm["summary"] = r["summary"] or ""
        except (IndexError, KeyError):
            bm["summary"] = ""
        result[vid].append(bm)
    return result
