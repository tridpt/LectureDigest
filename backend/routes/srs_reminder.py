"""
SRS email reminders — notify users when they have flashcards due for review.

How it works:
  - SRS data is synced to user_kv_store under keys "lectureDigest_sm2_<videoId>".
    Each value is a JSON map of cardKey -> { nextReview: "YYYY-MM-DD", ... }.
  - A daily background task counts each user's due cards and emails those who
    opted in (preference stored in KV key "srs_reminder_enabled" = "1") and who
    haven't already been emailed today.
  - Users toggle the preference via /api/srs-reminder/preference.

Requires SMTP to be configured (SMTP_HOST/SMTP_USER/SMTP_PASS). Without it,
reminders are logged to the console instead.
"""

import os
import json
import time
import asyncio
import logging
import smtplib
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from fastapi import APIRouter, HTTPException, Request

from database import get_db, db_kv_get, db_kv_set
from db.kv_store import db_kv_get_all
from routes.auth import get_current_user

router = APIRouter(prefix="/api/srs-reminder", tags=["srs-reminder"])
logger = logging.getLogger("srs_reminder")

_PREF_KEY = "srs_reminder_enabled"
_LAST_SENT_KEY = "srs_reminder_last_sent"  # stores "YYYY-MM-DD"
_SM2_PREFIX = "lectureDigest_sm2_"


# ═══════════════════════════════════════════════════════
# DUE-CARD COUNTING (server-side, from synced KV data)
# ═══════════════════════════════════════════════════════

def _count_due_cards(user_id: int) -> int:
    """Count flashcards due today for a user, reading synced SM-2 data from KV store."""
    today = datetime.now().strftime("%Y-%m-%d")
    kv = db_kv_get_all(user_id)
    due = 0
    for key, value in kv.items():
        if not key.startswith(_SM2_PREFIX):
            continue
        try:
            cards = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(cards, dict):
            continue
        for card in cards.values():
            if not isinstance(card, dict):
                continue
            next_review = card.get("nextReview")
            # Due if never scheduled or scheduled for today/past
            if not next_review or next_review <= today:
                due += 1
    return due


# ═══════════════════════════════════════════════════════
# EMAIL
# ═══════════════════════════════════════════════════════

def _send_reminder_email(to_email: str, display_name: str, due_count: int, app_url: str):
    """Send the SRS reminder email via SMTP, or log to console if SMTP not configured."""
    smtp_host = os.getenv("SMTP_HOST", "").strip()
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "").strip()
    smtp_pass = os.getenv("SMTP_PASS", "").strip()
    smtp_from = os.getenv("SMTP_FROM", smtp_user).strip()

    name = display_name or to_email.split("@")[0]
    review_url = f"{app_url.rstrip('/')}/review"

    html_body = f"""\
<!DOCTYPE html>
<html>
<body style="font-family:'Inter',Arial,sans-serif;background:#0f0f23;color:#e2e8f0;padding:40px 20px;">
<div style="max-width:480px;margin:0 auto;background:#1a1a2e;border-radius:16px;padding:32px;border:1px solid rgba(139,92,246,0.2);">
    <div style="text-align:center;margin-bottom:24px;">
        <div style="font-size:48px;margin-bottom:8px;">🧠</div>
        <h2 style="margin:0;color:#fff;font-size:22px;font-weight:800;">Đến giờ ôn tập rồi!</h2>
        <p style="margin:8px 0 0;color:#94a3b8;font-size:14px;">LectureDigest</p>
    </div>
    <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Xin chào <strong>{name}</strong>,</p>
    <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Bạn có <strong style="color:#f59e0b;">{due_count} thẻ flashcard</strong> cần ôn tập hôm nay. Ôn tập đúng lúc giúp ghi nhớ tốt hơn tới 300%!</p>
    <div style="text-align:center;margin:28px 0;">
        <a href="{review_url}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#8b5cf6,#6d28d9);color:#fff;border-radius:12px;font-weight:700;font-size:15px;text-decoration:none;">Ôn tập ngay</a>
    </div>
    <p style="color:#64748b;font-size:11px;text-align:center;">Bạn nhận email này vì đã bật nhắc nhở ôn tập. Có thể tắt trong phần cài đặt của ứng dụng.</p>
</div>
</body>
</html>
"""
    text_body = (
        f"Xin chào {name},\n\n"
        f"Bạn có {due_count} thẻ flashcard cần ôn tập hôm nay.\n"
        f"Ôn ngay: {review_url}\n\n"
        f"Bạn có thể tắt nhắc nhở trong cài đặt ứng dụng."
    )

    if not smtp_host or not smtp_user:
        logger.info("SRS REMINDER (dev mode — no SMTP). To: %s | Due: %d", to_email, due_count)
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"🧠 {due_count} thẻ cần ôn hôm nay — LectureDigest"
    msg["From"] = f"LectureDigest <{smtp_from}>"
    msg["To"] = to_email
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_from, to_email, msg.as_string())
    logger.info("SRS reminder sent to %s (%d due)", to_email, due_count)


# ═══════════════════════════════════════════════════════
# DAILY SWEEP (background task)
# ═══════════════════════════════════════════════════════

def _run_reminder_sweep():
    """Find opted-in users with due cards and email them once per day."""
    today = datetime.now().strftime("%Y-%m-%d")
    app_url = os.getenv("APP_BASE_URL", "http://localhost:8000")

    # Find users who opted in
    conn = get_db()
    rows = conn.execute(
        "SELECT user_id FROM user_kv_store WHERE data_key = ? AND data_value = '1'",
        (_PREF_KEY,)
    ).fetchall()
    conn.close()

    opted_in_ids = [r["user_id"] for r in rows]
    if not opted_in_ids:
        return 0

    sent = 0
    for user_id in opted_in_ids:
        try:
            # Skip if already emailed today
            last_sent = db_kv_get(user_id, _LAST_SENT_KEY)
            if last_sent == today:
                continue

            due = _count_due_cards(user_id)
            if due <= 0:
                continue

            # Look up email
            conn = get_db()
            urow = conn.execute(
                "SELECT email, display_name FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            conn.close()
            if not urow or not urow["email"]:
                continue

            _send_reminder_email(urow["email"], urow["display_name"], due, app_url)
            db_kv_set(user_id, _LAST_SENT_KEY, today)
            sent += 1
        except Exception as e:
            logger.warning("SRS reminder failed for user %s: %s", user_id, e)

    if sent:
        logger.info("SRS reminder sweep: emailed %d user(s)", sent)
    return sent


async def srs_reminder_loop():
    """Background loop: run the reminder sweep once every 6 hours."""
    await asyncio.sleep(120)  # let the app settle after startup
    while True:
        try:
            await asyncio.to_thread(_run_reminder_sweep)
        except Exception as e:
            logger.warning("SRS reminder loop error: %s", e)
        await asyncio.sleep(6 * 3600)  # every 6 hours


# ═══════════════════════════════════════════════════════
# API ROUTES
# ═══════════════════════════════════════════════════════

@router.get("/preference")
async def get_preference(request: Request):
    """Get the current user's reminder preference and due-card count."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")
    enabled = db_kv_get(user["id"], _PREF_KEY) == "1"
    due = _count_due_cards(user["id"])
    smtp_ready = bool(os.getenv("SMTP_HOST", "").strip() and os.getenv("SMTP_USER", "").strip())
    return {"enabled": enabled, "due_count": due, "smtp_configured": smtp_ready}


@router.post("/preference")
async def set_preference(request: Request):
    """Enable/disable email reminders. Body: {enabled: bool}"""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")
    body = await request.json()
    enabled = bool(body.get("enabled"))
    db_kv_set(user["id"], _PREF_KEY, "1" if enabled else "0")
    return {"ok": True, "enabled": enabled}


@router.post("/test")
async def send_test_reminder(request: Request):
    """Send a test reminder email to the current user immediately (if they have due cards)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    full = None
    conn = get_db()
    urow = conn.execute("SELECT email, display_name FROM users WHERE id = ?", (user["id"],)).fetchone()
    conn.close()
    if not urow or not urow["email"]:
        raise HTTPException(status_code=400, detail="Tài khoản không có email")

    due = _count_due_cards(user["id"])
    app_url = os.getenv("APP_BASE_URL", "http://localhost:8000")
    try:
        await asyncio.to_thread(
            _send_reminder_email, urow["email"], urow["display_name"], max(due, 1), app_url
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Không gửi được email: {e}")
    return {"ok": True, "due_count": due, "sent_to": urow["email"]}
