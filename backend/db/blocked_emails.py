"""
Blocked emails — admin-managed blocklist preventing login/registration.
Supports timed bans (expires_at) and permanent bans (expires_at = NULL).
"""
import time
import logging
from .connection import get_db

logger = logging.getLogger("database")


def _now_ms() -> int:
    return int(time.time() * 1000)


def db_get_block_info(email: str):
    """Return block details for an email if it's currently blocked, else None.
    Auto-expires timed bans: if expires_at has passed, the row is removed and
    None is returned.
    """
    if not email:
        return None
    email = email.lower().strip()
    conn = get_db()
    row = conn.execute(
        "SELECT email, reason, blocked_by, created_at, expires_at FROM blocked_emails WHERE email = ?",
        (email,)
    ).fetchone()
    if not row:
        conn.close()
        return None

    expires_at = row["expires_at"]
    # Timed ban that has expired → auto-unblock
    if expires_at is not None and expires_at <= _now_ms():
        conn.execute("DELETE FROM blocked_emails WHERE email = ?", (email,))
        conn.commit()
        conn.close()
        return None

    conn.close()
    return {
        "email": row["email"],
        "reason": row["reason"] or "",
        "blocked_by": row["blocked_by"] or "",
        "created_at": row["created_at"],
        "expires_at": expires_at,
        "permanent": expires_at is None,
    }


def db_is_email_blocked(email: str) -> bool:
    """Return True if the given email is currently blocked (respecting expiry)."""
    return db_get_block_info(email) is not None


def db_block_email(email: str, reason: str = "", blocked_by: str = "", duration_ms: int = None) -> bool:
    """Add/refresh an email on the blocklist.
    duration_ms: ban length in milliseconds. None = permanent ban.
    """
    email = (email or "").lower().strip()
    if not email:
        return False
    now = _now_ms()
    expires_at = (now + duration_ms) if duration_ms else None
    conn = get_db()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO blocked_emails (email, reason, blocked_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
            (email, reason, blocked_by, now, expires_at)
        )
        conn.commit()
        return True
    finally:
        conn.close()


def db_unblock_email(email: str) -> bool:
    """Remove an email from the blocklist. Returns True if a row was removed."""
    email = (email or "").lower().strip()
    if not email:
        return False
    conn = get_db()
    try:
        cur = conn.execute("DELETE FROM blocked_emails WHERE email = ?", (email,))
        conn.commit()
        return (cur.rowcount or 0) > 0
    finally:
        conn.close()


def db_get_blocked_emails():
    """Return all currently-blocked emails (auto-purges expired ones), newest first."""
    now = _now_ms()
    conn = get_db()
    # Purge expired timed bans first
    try:
        conn.execute("DELETE FROM blocked_emails WHERE expires_at IS NOT NULL AND expires_at <= ?", (now,))
        conn.commit()
    except Exception:
        pass
    rows = conn.execute(
        "SELECT email, reason, blocked_by, created_at, expires_at FROM blocked_emails ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return [
        {
            "email": r["email"],
            "reason": r["reason"] or "",
            "blocked_by": r["blocked_by"] or "",
            "created_at": r["created_at"],
            "expires_at": r["expires_at"],
            "permanent": r["expires_at"] is None,
        }
        for r in rows
    ]
