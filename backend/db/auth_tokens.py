"""
Password reset tokens and login rate limiting.
"""
import time
import logging
from .connection import get_db

logger = logging.getLogger("database")


# ══════════════════════════════════════════
# PASSWORD RESET TOKENS (persistent)
# ══════════════════════════════════════════
def db_save_reset_token(token: str, email: str, expires_at: float):
    """Save a password reset token to the database."""
    conn = get_db()
    conn.execute(
        "INSERT OR REPLACE INTO password_reset_tokens (token, email, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (token, email.lower().strip(), time.time(), expires_at)
    )
    conn.commit()
    conn.close()


def db_get_reset_token(token: str):
    """Get a reset token's data. Returns dict or None."""
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM password_reset_tokens WHERE token = ? AND expires_at > ?",
        (token, time.time())
    ).fetchone()
    conn.close()
    if not row:
        return None
    return {"token": row["token"], "email": row["email"], "created_at": row["created_at"], "expires_at": row["expires_at"]}


def db_delete_reset_token(token: str):
    """Delete a specific reset token."""
    conn = get_db()
    conn.execute("DELETE FROM password_reset_tokens WHERE token = ?", (token,))
    conn.commit()
    conn.close()


def db_delete_reset_tokens_for_email(email: str):
    """Delete all reset tokens for an email."""
    conn = get_db()
    conn.execute("DELETE FROM password_reset_tokens WHERE email = ?", (email.lower().strip(),))
    conn.commit()
    conn.close()


def db_cleanup_expired_tokens():
    """Remove all expired reset tokens."""
    conn = get_db()
    conn.execute("DELETE FROM password_reset_tokens WHERE expires_at < ?", (time.time(),))
    conn.commit()
    conn.close()


# ══════════════════════════════════════════
# LOGIN RATE LIMITING (persistent)
# ══════════════════════════════════════════
def db_check_rate_limit(key: str, max_attempts: int = 5, window_secs: int = 300, block_secs: int = 900):
    """Check if a key (IP or email) is rate-limited.
    Returns (allowed: bool, retry_after: int seconds or 0).
    - max_attempts: max tries within the window
    - window_secs: time window in seconds (default 5 min)
    - block_secs: block duration after exceeding limit (default 15 min)
    """
    conn = get_db()
    now = time.time()
    row = conn.execute(
        "SELECT * FROM login_attempts WHERE ip_or_email = ?", (key,)
    ).fetchone()

    if not row:
        conn.execute(
            "INSERT INTO login_attempts (ip_or_email, attempts, first_at, blocked_until) VALUES (?, 1, ?, 0)",
            (key, now)
        )
        conn.commit()
        conn.close()
        return True, 0

    # Currently blocked?
    if row["blocked_until"] > now:
        conn.close()
        return False, int(row["blocked_until"] - now)

    # Window expired — reset
    if now - row["first_at"] > window_secs:
        conn.execute(
            "UPDATE login_attempts SET attempts = 1, first_at = ?, blocked_until = 0 WHERE ip_or_email = ?",
            (now, key)
        )
        conn.commit()
        conn.close()
        return True, 0

    # Within window
    new_attempts = row["attempts"] + 1
    if new_attempts > max_attempts:
        blocked_until = now + block_secs
        conn.execute(
            "UPDATE login_attempts SET attempts = ?, blocked_until = ? WHERE ip_or_email = ?",
            (new_attempts, blocked_until, key)
        )
        conn.commit()
        conn.close()
        return False, block_secs

    conn.execute(
        "UPDATE login_attempts SET attempts = ? WHERE ip_or_email = ?",
        (new_attempts, key)
    )
    conn.commit()
    conn.close()
    return True, 0


def db_reset_rate_limit(key: str):
    """Reset rate limit counter for a key (e.g., after successful login)."""
    conn = get_db()
    conn.execute("DELETE FROM login_attempts WHERE ip_or_email = ?", (key,))
    conn.commit()
    conn.close()
