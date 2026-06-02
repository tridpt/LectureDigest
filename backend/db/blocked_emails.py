"""
Blocked emails — admin-managed blocklist preventing login/registration.
"""
import time
import logging
from .connection import get_db

logger = logging.getLogger("database")


def db_is_email_blocked(email: str) -> bool:
    """Return True if the given email is on the blocklist."""
    if not email:
        return False
    conn = get_db()
    row = conn.execute(
        "SELECT 1 FROM blocked_emails WHERE email = ?", (email.lower().strip(),)
    ).fetchone()
    conn.close()
    return row is not None


def db_block_email(email: str, reason: str = "", blocked_by: str = "") -> bool:
    """Add an email to the blocklist. Returns True on success."""
    email = (email or "").lower().strip()
    if not email:
        return False
    conn = get_db()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO blocked_emails (email, reason, blocked_by, created_at) VALUES (?, ?, ?, ?)",
            (email, reason, blocked_by, int(time.time() * 1000))
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
    """Return all blocked emails, newest first."""
    conn = get_db()
    rows = conn.execute(
        "SELECT email, reason, blocked_by, created_at FROM blocked_emails ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return [
        {
            "email": r["email"],
            "reason": r["reason"] or "",
            "blocked_by": r["blocked_by"] or "",
            "created_at": r["created_at"],
        }
        for r in rows
    ]
