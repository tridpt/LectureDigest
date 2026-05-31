"""
Folders CRUD operations.
"""
import time
import logging
from .connection import get_db

logger = logging.getLogger("database")


def db_get_folders(user_id=None):
    """Get all folders for a user, ordered by position."""
    conn = get_db()
    if user_id:
        rows = conn.execute(
            "SELECT * FROM folders WHERE user_id = ? ORDER BY position ASC, created_at ASC",
            (user_id,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM folders WHERE user_id IS NULL ORDER BY position ASC, created_at ASC"
        ).fetchall()
    conn.close()

    result = []
    for r in rows:
        result.append({
            "id": r["id"],
            "name": r["name"],
            "icon": r["icon"],
            "color": r["color"],
            "position": r["position"],
            "created_at": r["created_at"],
        })
    return result


def db_create_folder(name: str, icon: str = '📁', color: str = '#8b5cf6', user_id=None):
    """Create a new folder. Returns the folder id."""
    conn = get_db()
    now = int(time.time() * 1000)
    # Get next position
    row = conn.execute(
        "SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM folders WHERE COALESCE(user_id, 0) = ?",
        (user_id or 0,)
    ).fetchone()
    pos = row["next_pos"] if row else 0
    cur = conn.execute(
        "INSERT INTO folders (name, icon, color, user_id, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (name.strip(), icon, color, user_id, pos, now)
    )
    conn.commit()
    folder_id = cur.lastrowid
    conn.close()
    return folder_id


def db_update_folder(folder_id: int, name: str = None, icon: str = None, color: str = None, user_id=None):
    """Update folder properties."""
    conn = get_db()
    fields, values = [], []
    if name is not None:
        fields.append("name = ?")
        values.append(name.strip())
    if icon is not None:
        fields.append("icon = ?")
        values.append(icon)
    if color is not None:
        fields.append("color = ?")
        values.append(color)
    if not fields:
        conn.close()
        return
    values.append(folder_id)
    where = "WHERE id = ?"
    if user_id:
        where += " AND user_id = ?"
        values.append(user_id)
    conn.execute(f"UPDATE folders SET {', '.join(fields)} {where}", values)
    conn.commit()
    conn.close()


def db_delete_folder(folder_id: int, user_id=None):
    """Delete a folder and its video associations."""
    conn = get_db()
    if user_id:
        conn.execute("DELETE FROM folders WHERE id = ? AND user_id = ?", (folder_id, user_id))
    else:
        conn.execute("DELETE FROM folders WHERE id = ? AND user_id IS NULL", (folder_id,))
    conn.execute("DELETE FROM folder_videos WHERE folder_id = ?", (folder_id,))
    conn.commit()
    conn.close()


def db_add_video_to_folder(folder_id: int, video_id: str, user_id=None):
    """Add a video to a folder. If user_id is given, verifies the folder belongs to that user."""
    conn = get_db()
    # Ownership check — prevent adding to another user's folder (IDOR)
    if user_id is not None:
        owner = conn.execute(
            "SELECT 1 FROM folders WHERE id = ? AND user_id = ?", (folder_id, user_id)
        ).fetchone()
    else:
        owner = conn.execute(
            "SELECT 1 FROM folders WHERE id = ? AND user_id IS NULL", (folder_id,)
        ).fetchone()
    if not owner:
        conn.close()
        return False
    now = int(time.time() * 1000)
    conn.execute(
        "INSERT OR IGNORE INTO folder_videos (folder_id, video_id, added_at) VALUES (?, ?, ?)",
        (folder_id, video_id, now)
    )
    conn.commit()
    conn.close()
    return True


def db_remove_video_from_folder(folder_id: int, video_id: str, user_id=None):
    """Remove a video from a folder. If user_id is given, verifies folder ownership."""
    conn = get_db()
    # Ownership check — prevent removing from another user's folder (IDOR)
    if user_id is not None:
        owner = conn.execute(
            "SELECT 1 FROM folders WHERE id = ? AND user_id = ?", (folder_id, user_id)
        ).fetchone()
    else:
        owner = conn.execute(
            "SELECT 1 FROM folders WHERE id = ? AND user_id IS NULL", (folder_id,)
        ).fetchone()
    if not owner:
        conn.close()
        return False
    conn.execute(
        "DELETE FROM folder_videos WHERE folder_id = ? AND video_id = ?",
        (folder_id, video_id)
    )
    conn.commit()
    conn.close()
    return True


def db_get_folder_videos(folder_id: int):
    """Get all video IDs in a folder."""
    conn = get_db()
    rows = conn.execute(
        "SELECT video_id FROM folder_videos WHERE folder_id = ? ORDER BY added_at DESC",
        (folder_id,)
    ).fetchall()
    conn.close()
    return [r["video_id"] for r in rows]


def db_get_video_folders(video_id: str, user_id=None):
    """Get all folder IDs a video belongs to."""
    conn = get_db()
    if user_id:
        rows = conn.execute(
            "SELECT f.id FROM folders f JOIN folder_videos fv ON f.id = fv.folder_id WHERE fv.video_id = ? AND f.user_id = ?",
            (video_id, user_id)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT f.id FROM folders f JOIN folder_videos fv ON f.id = fv.folder_id WHERE fv.video_id = ? AND f.user_id IS NULL",
            (video_id,)
        ).fetchall()
    conn.close()
    return [r["id"] for r in rows]


def db_get_all_folder_videos(user_id=None):
    """Get mapping of folder_id -> [video_ids] for all folders."""
    conn = get_db()
    if user_id:
        rows = conn.execute(
            "SELECT fv.folder_id, fv.video_id FROM folder_videos fv JOIN folders f ON f.id = fv.folder_id WHERE f.user_id = ?",
            (user_id,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT fv.folder_id, fv.video_id FROM folder_videos fv JOIN folders f ON f.id = fv.folder_id WHERE f.user_id IS NULL"
        ).fetchall()
    conn.close()
    result = {}
    for r in rows:
        fid = r["folder_id"]
        if fid not in result:
            result[fid] = []
        result[fid].append(r["video_id"])
    return result
