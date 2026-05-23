"""
Shared notes operations.
"""
import time
import logging
from .connection import get_db

logger = logging.getLogger("database")


def db_create_shared_notes(share_id, video_id, title, author, notes, bookmarks_json, overview, shared_by):
    """Create a shared notes snapshot."""
    conn = get_db()
    conn.execute(
        """INSERT OR REPLACE INTO shared_notes
           (share_id, video_id, title, author, notes, bookmarks, overview, shared_by, created_at, view_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)""",
        (share_id, video_id, title, author, notes, bookmarks_json, overview, shared_by, int(time.time()))
    )
    conn.commit()
    conn.close()


def db_get_shared_notes(share_id):
    """Fetch a shared notes entry and increment view count."""
    conn = get_db()
    row = conn.execute("SELECT * FROM shared_notes WHERE share_id = ?", (share_id,)).fetchone()
    if row:
        conn.execute("UPDATE shared_notes SET view_count = view_count + 1 WHERE share_id = ?", (share_id,))
        conn.commit()
        result = dict(row)
    else:
        result = None
    conn.close()
    return result
