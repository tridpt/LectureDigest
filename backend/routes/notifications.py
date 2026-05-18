"""
Notifications system — store and retrieve user notifications.
"""

import json
import time
import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from database import get_db
from routes.auth import get_current_user

router = APIRouter(prefix="/api/notifications", tags=["notifications"])
logger = logging.getLogger("notifications")


# ═══════════════════════════════════════════════════════
# DATABASE INIT
# ═══════════════════════════════════════════════════════

def _init_notifications_table():
    from database import USE_POSTGRES
    conn = get_db()
    if USE_POSTGRES:
        try:
            conn.execute("""CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, type TEXT NOT NULL,
                title TEXT NOT NULL, message TEXT DEFAULT '', link TEXT DEFAULT '',
                is_read INTEGER DEFAULT 0, created_at BIGINT NOT NULL
            )""", ())
        except Exception as e:
            logger.warning(f"Notifications table: {e}")
        try:
            conn.execute("CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read, created_at DESC)", ())
        except:
            pass
    else:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS notifications (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL,
                type       TEXT NOT NULL,
                title      TEXT NOT NULL,
                message    TEXT DEFAULT '',
                link       TEXT DEFAULT '',
                is_read    INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read, created_at DESC);
        """)
        conn.commit()
    conn.close()

_init_notifications_table()


# ═══════════════════════════════════════════════════════
# HELPER: Create notification (called from other modules)
# ═══════════════════════════════════════════════════════

def create_notification(user_id: int, notif_type: str, title: str, message: str = '', link: str = ''):
    """Insert a notification for a user. Called internally by other routes."""
    conn = get_db()
    now = int(time.time() * 1000)
    conn.execute("""
        INSERT INTO notifications (user_id, type, title, message, link, is_read, created_at)
        VALUES (?, ?, ?, ?, ?, 0, ?)
    """, (user_id, notif_type, title, message, link, now))
    conn.commit()
    conn.close()


def create_notification_for_room_members(room_id: str, notif_type: str, title: str, message: str = '', link: str = '', exclude_user_id: int = None):
    """Send a notification to all members of a room (optionally excluding one user)."""
    conn = get_db()
    now = int(time.time() * 1000)
    members = conn.execute("SELECT user_id FROM room_members WHERE room_id = ?", (room_id,)).fetchall()
    for m in members:
        uid = m["user_id"]
        if exclude_user_id and uid == exclude_user_id:
            continue
        conn.execute("""
            INSERT INTO notifications (user_id, type, title, message, link, is_read, created_at)
            VALUES (?, ?, ?, ?, ?, 0, ?)
        """, (uid, notif_type, title, message, link, now))
    conn.commit()
    conn.close()


# ═══════════════════════════════════════════════════════
# API ROUTES
# ═══════════════════════════════════════════════════════

@router.get("")
async def get_notifications(request: Request, limit: int = 30):
    """Get user's notifications (newest first)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    conn = get_db()
    rows = conn.execute("""
        SELECT * FROM notifications WHERE user_id = ?
        ORDER BY created_at DESC LIMIT ?
    """, (user["id"], limit)).fetchall()

    unread = conn.execute(
        "SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0",
        (user["id"],)
    ).fetchone()["c"]

    conn.close()

    return {
        "unread_count": unread,
        "notifications": [{
            "id": r["id"],
            "type": r["type"],
            "title": r["title"],
            "message": r["message"],
            "link": r["link"],
            "is_read": bool(r["is_read"]),
            "created_at": r["created_at"],
        } for r in rows]
    }


@router.post("/read/{notif_id}")
async def mark_read(notif_id: int, request: Request):
    """Mark a single notification as read."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    conn = get_db()
    conn.execute("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?", (notif_id, user["id"]))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read(request: Request):
    """Mark all notifications as read."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    conn = get_db()
    conn.execute("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0", (user["id"],))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.delete("")
async def clear_notifications(request: Request):
    """Delete all notifications for the user."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập")

    conn = get_db()
    conn.execute("DELETE FROM notifications WHERE user_id = ?", (user["id"],))
    conn.commit()
    conn.close()
    return {"ok": True}
