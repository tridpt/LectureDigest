"""
Abuse / anomaly detection — derives risk signals for users from existing data.
No extra tracking; reuses history timestamps and login_attempts.
"""
import time
import logging
from .connection import get_db

logger = logging.getLogger("database")

# Thresholds (tunable)
_BURST_WINDOW_MS = 60 * 60 * 1000          # 1 hour
_BURST_THRESHOLD = 20                       # analyses within 1h = suspicious burst
_DAILY_THRESHOLD = 50                       # analyses within 24h = high volume
_TOTAL_THRESHOLD = 300                      # lifetime analyses = power-abuse candidate
_FAILED_LOGIN_THRESHOLD = 5                 # recent failed logins


def db_get_user_risk(user_id: int, email: str = "") -> dict:
    """Compute risk flags for a single user. Returns {level, score, flags:[...]}."""
    conn = get_db()
    now = int(time.time() * 1000)
    flags = []
    score = 0

    try:
        # ── Analysis activity from history timestamps ──
        rows = conn.execute(
            "SELECT saved_at FROM history WHERE user_id = ?", (user_id,)
        ).fetchall()
        total = len(rows)
        last_hour = sum(1 for r in rows if r["saved_at"] and r["saved_at"] >= now - _BURST_WINDOW_MS)
        last_day = sum(1 for r in rows if r["saved_at"] and r["saved_at"] >= now - 24 * _BURST_WINDOW_MS)

        if last_hour >= _BURST_THRESHOLD:
            flags.append({
                "type": "burst",
                "label": f"Phân tích dồn dập: {last_hour} video trong 1 giờ",
                "severity": "high",
            })
            score += 3
        if last_day >= _DAILY_THRESHOLD:
            flags.append({
                "type": "high_volume",
                "label": f"Khối lượng cao: {last_day} video trong 24 giờ",
                "severity": "medium",
            })
            score += 2
        if total >= _TOTAL_THRESHOLD:
            flags.append({
                "type": "total_volume",
                "label": f"Tổng phân tích rất lớn: {total} video",
                "severity": "low",
            })
            score += 1

        # ── Failed login attempts (login_attempts keyed by login:<email>) ──
        if email:
            key = f"login:{email.lower().strip()}"
            la = conn.execute(
                "SELECT attempts, blocked_until FROM login_attempts WHERE ip_or_email = ?", (key,)
            ).fetchone()
            if la:
                attempts = la["attempts"] or 0
                blocked_until = la["blocked_until"] or 0
                if blocked_until > time.time():
                    flags.append({
                        "type": "login_blocked",
                        "label": "Đang bị khóa do đăng nhập sai nhiều lần",
                        "severity": "high",
                    })
                    score += 2
                elif attempts >= _FAILED_LOGIN_THRESHOLD:
                    flags.append({
                        "type": "failed_logins",
                        "label": f"{attempts} lần đăng nhập thất bại gần đây",
                        "severity": "medium",
                    })
                    score += 1
    except Exception as e:
        logger.warning("risk computation failed for user %s: %s", user_id, e)
    finally:
        conn.close()

    level = "none"
    if score >= 3:
        level = "high"
    elif score >= 2:
        level = "medium"
    elif score >= 1:
        level = "low"

    return {"level": level, "score": score, "flags": flags}
