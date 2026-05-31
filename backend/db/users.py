"""
Users CRUD — authentication, profile, GDPR operations.
"""
import time
import sqlite3
import logging
from .connection import get_db, USE_POSTGRES

logger = logging.getLogger("database")


def db_create_user(email: str, display_name: str, password_hash: str, avatar_color: str = '#8b5cf6', google_id: str = '', avatar_url: str = ''):
    """Create a new user. Returns the user id, or None if the email already exists."""
    conn = get_db()
    now = int(time.time() * 1000)
    try:
        if USE_POSTGRES:
            cur = conn._conn.cursor()
            cur.execute("""
                INSERT INTO users (email, display_name, password_hash, avatar_color, google_id, avatar_url, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
            """, (email.lower().strip(), display_name.strip(), password_hash, avatar_color, google_id, avatar_url, now, now))
            row = cur.fetchone()
            user_id = row[0] if row else None
            conn.commit()
        else:
            cur = conn.execute("""
                INSERT INTO users (email, display_name, password_hash, avatar_color, google_id, avatar_url, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (email.lower().strip(), display_name.strip(), password_hash, avatar_color, google_id, avatar_url, now, now))
            conn.commit()
            user_id = cur.lastrowid
    except Exception as e:
        conn.close()
        # Detect "duplicate email" (UNIQUE constraint) across both SQLite and PostgreSQL
        err = str(e).lower()
        is_duplicate = isinstance(e, sqlite3.IntegrityError) or \
            "unique" in err or "duplicate" in err
        if is_duplicate:
            return None  # Email already exists
        # Real error (disk, schema, connection) — log it instead of masking as "email exists"
        logger.error("db_create_user failed: %s", e)
        raise
    conn.close()
    return user_id

def db_get_user_by_google_id(google_id: str):
    """Find a user by Google ID. Returns dict or None."""
    if not google_id:
        return None
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE google_id = ? AND google_id != ''", (google_id,)).fetchone()
    conn.close()
    if not row:
        return None
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row["display_name"],
        "password_hash": row["password_hash"],
        "avatar_color": row["avatar_color"],
        "avatar_url": row["avatar_url"] if "avatar_url" in row.keys() else '',
        "google_id": row["google_id"] if "google_id" in row.keys() else '',
        "created_at": row["created_at"],
    }

def db_get_user_by_email(email: str):
    """Find a user by email. Returns dict or None."""
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE email = ?", (email.lower().strip(),)).fetchone()
    conn.close()
    if not row:
        return None
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row["display_name"],
        "password_hash": row["password_hash"],
        "avatar_color": row["avatar_color"],
        "avatar_url": row["avatar_url"] if "avatar_url" in row.keys() else '',
        "google_id": row["google_id"] if "google_id" in row.keys() else '',
        "created_at": row["created_at"],
    }

def db_get_user_by_id(user_id: int):
    """Find a user by ID. Returns dict or None."""
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    if not row:
        return None
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row["display_name"],
        "avatar_color": row["avatar_color"],
        "avatar_url": row["avatar_url"] if "avatar_url" in row.keys() else '',
        "google_id": row["google_id"] if "google_id" in row.keys() else '',
        "created_at": row["created_at"],
    }

def db_update_user(user_id: int, display_name: str = None, avatar_color: str = None, password_hash: str = None, google_id: str = None, avatar_url: str = None):
    """Update user profile fields."""
    conn = get_db()
    fields = []
    values = []
    if display_name is not None:
        fields.append("display_name = ?")
        values.append(display_name.strip())
    if avatar_color is not None:
        fields.append("avatar_color = ?")
        values.append(avatar_color)
    if password_hash is not None:
        fields.append("password_hash = ?")
        values.append(password_hash)
    if google_id is not None:
        fields.append("google_id = ?")
        values.append(google_id)
    if avatar_url is not None:
        fields.append("avatar_url = ?")
        values.append(avatar_url)
    if not fields:
        conn.close()
        return
    fields.append("updated_at = ?")
    values.append(int(time.time() * 1000))
    values.append(user_id)
    conn.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()
    conn.close()


def db_delete_user(user_id: int):
    """Delete a user and ALL their data from every table. GDPR compliance."""
    conn = get_db()
    try:
        conn.execute("DELETE FROM history WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM notes WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM bookmarks WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM user_gamification WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM user_kv_store WHERE user_id = ?", (user_id,))
        # Delete folders and their video associations
        folder_ids = [r["id"] for r in conn.execute("SELECT id FROM folders WHERE user_id = ?", (user_id,)).fetchall()]
        for fid in folder_ids:
            conn.execute("DELETE FROM folder_videos WHERE folder_id = ?", (fid,))
        conn.execute("DELETE FROM folders WHERE user_id = ?", (user_id,))
        # Get email for reset token cleanup
        user_row = conn.execute("SELECT email FROM users WHERE id = ?", (user_id,)).fetchone()
        if user_row:
            email = user_row["email"]
            conn.execute("DELETE FROM password_reset_tokens WHERE email = ?", (email,))
            conn.execute("DELETE FROM login_attempts WHERE ip_or_email LIKE ?", (f"%{email}%",))
        # Finally delete the user
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()


def db_export_user_data(user_id: int) -> dict:
    """Export all user data as a dictionary. GDPR data portability."""
    conn = get_db()
    result = {}

    # User profile
    user_row = conn.execute("SELECT id, email, display_name, avatar_color, avatar_url, google_id, created_at FROM users WHERE id = ?", (user_id,)).fetchone()
    result["profile"] = dict(user_row) if user_row else {}

    # History
    rows = conn.execute("SELECT * FROM history WHERE user_id = ?", (user_id,)).fetchall()
    result["history"] = [dict(r) for r in rows]

    # Notes
    rows = conn.execute("SELECT * FROM notes WHERE user_id = ?", (user_id,)).fetchall()
    result["notes"] = [dict(r) for r in rows]

    # Bookmarks
    rows = conn.execute("SELECT * FROM bookmarks WHERE user_id = ?", (user_id,)).fetchall()
    result["bookmarks"] = [dict(r) for r in rows]

    # Gamification
    row = conn.execute("SELECT * FROM user_gamification WHERE user_id = ?", (user_id,)).fetchone()
    result["gamification"] = dict(row) if row else {}

    # KV store (SM2, custom cards, etc.)
    rows = conn.execute("SELECT * FROM user_kv_store WHERE user_id = ?", (user_id,)).fetchall()
    result["extra_data"] = [dict(r) for r in rows]

    # Folders
    rows = conn.execute("SELECT * FROM folders WHERE user_id = ?", (user_id,)).fetchall()
    result["folders"] = [dict(r) for r in rows]

    conn.close()
    return result
