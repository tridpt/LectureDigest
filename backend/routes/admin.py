"""
Admin panel routes — system stats and user management.

Access control:
    Admins are designated by the ADMIN_EMAILS environment variable
    (comma-separated list of emails). This cannot be self-assigned by users —
    it requires server-side configuration. Every endpoint is guarded by the
    require_admin dependency.
"""

import os
import time
import logging

from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel

from database import get_db, db_delete_user, USE_POSTGRES
from database import (
    db_block_email, db_unblock_email, db_get_blocked_emails, db_get_user_by_id,
)
from routes.auth import get_current_user

router = APIRouter(prefix="/api/admin", tags=["admin"])
logger = logging.getLogger("admin")


# ═══════════════════════════════════════════════════════
# ACCESS CONTROL
# ═══════════════════════════════════════════════════════

def _admin_emails() -> set:
    """Parse the ADMIN_EMAILS env var into a normalized set of emails."""
    raw = os.getenv("ADMIN_EMAILS", "")
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def is_admin(user: dict | None) -> bool:
    if not user:
        return False
    admins = _admin_emails()
    if not admins:
        return False
    return (user.get("email") or "").lower() in admins


def require_admin(request: Request) -> dict:
    """FastAPI dependency: returns the admin user or raises 401/403."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Chưa đăng nhập")
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Bạn không có quyền truy cập trang quản trị")
    return user


# ═══════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════

@router.get("/check")
async def check_admin(request: Request):
    """Lightweight check used by the frontend to decide whether to show the admin link."""
    user = get_current_user(request)
    return {"is_admin": is_admin(user)}


def _count(conn, table: str) -> int:
    try:
        row = conn.execute(f"SELECT COUNT(*) AS c FROM {table}").fetchone()
        return row["c"] if row else 0
    except Exception:
        return 0


@router.get("/stats")
async def admin_stats(admin: dict = Depends(require_admin)):
    """Aggregate system statistics for the admin dashboard."""
    conn = get_db()
    try:
        now_ms = int(time.time() * 1000)
        day_ms = 24 * 3600 * 1000

        total_users = _count(conn, "users")
        total_history = _count(conn, "history")
        total_notes = _count(conn, "notes")
        total_bookmarks = _count(conn, "bookmarks")
        total_shared = _count(conn, "shared_notes")
        total_folders = _count(conn, "folders")
        total_cache = _count(conn, "analysis_cache")

        # New users in the last 7 / 30 days
        def _users_since(ms):
            try:
                row = conn.execute(
                    "SELECT COUNT(*) AS c FROM users WHERE created_at >= ?", (now_ms - ms,)
                ).fetchone()
                return row["c"] if row else 0
            except Exception:
                return 0

        new_7d = _users_since(7 * day_ms)
        new_30d = _users_since(30 * day_ms)

        # Distinct videos analyzed (by video_id in history)
        try:
            row = conn.execute("SELECT COUNT(DISTINCT video_id) AS c FROM history").fetchone()
            distinct_videos = row["c"] if row else 0
        except Exception:
            distinct_videos = 0

        # Google vs password accounts
        try:
            row = conn.execute(
                "SELECT COUNT(*) AS c FROM users WHERE google_id IS NOT NULL AND google_id != ''"
            ).fetchone()
            google_users = row["c"] if row else 0
        except Exception:
            google_users = 0

        return {
            "users": {
                "total": total_users,
                "new_7d": new_7d,
                "new_30d": new_30d,
                "google": google_users,
                "password": max(total_users - google_users, 0),
            },
            "content": {
                "history_entries": total_history,
                "distinct_videos": distinct_videos,
                "notes": total_notes,
                "bookmarks": total_bookmarks,
                "shared_notes": total_shared,
                "folders": total_folders,
                "cached_analyses": total_cache,
            },
            "generated_at": now_ms,
        }
    finally:
        conn.close()


@router.get("/users")
async def admin_list_users(
    request: Request,
    admin: dict = Depends(require_admin),
    page: int = 1,
    per_page: int = 20,
    search: str = "",
):
    """Paginated, searchable list of users (no password hashes)."""
    page = max(1, page)
    per_page = min(max(1, per_page), 100)
    offset = (page - 1) * per_page
    search = (search or "").strip().lower()

    conn = get_db()
    try:
        params = []
        where = ""
        if search:
            where = "WHERE LOWER(email) LIKE ? OR LOWER(display_name) LIKE ?"
            like = f"%{search}%"
            params = [like, like]

        # Total matching count
        total_row = conn.execute(
            f"SELECT COUNT(*) AS c FROM users {where}", params
        ).fetchone()
        total = total_row["c"] if total_row else 0

        rows = conn.execute(
            f"""SELECT id, email, display_name, avatar_color, avatar_url, google_id, created_at
                FROM users {where}
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?""",
            params + [per_page, offset],
        ).fetchall()

        admins = _admin_emails()
        from database import db_get_blocked_emails
        blocked_set = {b["email"] for b in db_get_blocked_emails()}
        users = []
        for r in rows:
            uid = r["id"]
            email = r["email"]
            # Per-user content counts (cheap enough for admin view)
            hist = conn.execute(
                "SELECT COUNT(*) AS c FROM history WHERE user_id = ?", (uid,)
            ).fetchone()
            users.append({
                "id": uid,
                "email": email,
                "display_name": r["display_name"],
                "avatar_color": r["avatar_color"],
                "avatar_url": r["avatar_url"] if "avatar_url" in r.keys() else "",
                "is_google": bool(r["google_id"]) if "google_id" in r.keys() else False,
                "created_at": r["created_at"],
                "history_count": hist["c"] if hist else 0,
                "is_admin": (email or "").lower() in admins,
                "is_blocked": (email or "").lower() in blocked_set,
            })

        return {
            "users": users,
            "total": total,
            "page": page,
            "per_page": per_page,
            "has_more": offset + len(users) < total,
        }
    finally:
        conn.close()


@router.delete("/users/{user_id}")
async def admin_delete_user(user_id: int, admin: dict = Depends(require_admin)):
    """Delete a user and all their data. Admins cannot delete themselves or other admins."""
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Không thể tự xóa tài khoản admin của bạn")

    conn = get_db()
    try:
        row = conn.execute("SELECT email FROM users WHERE id = ?", (user_id,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Người dùng không tồn tại")

    target_email = (row["email"] or "").lower()
    if target_email in _admin_emails():
        raise HTTPException(status_code=403, detail="Không thể xóa tài khoản admin khác")

    try:
        db_delete_user(user_id)
    except Exception as e:
        logger.error("admin_delete_user failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Không thể xóa người dùng: {e}")

    logger.info("Admin %s deleted user %s (%s)", admin["email"], user_id, target_email)
    return {"ok": True}


# ═══════════════════════════════════════════════════════
# EMAIL BLOCKLIST
# ═══════════════════════════════════════════════════════

class BlockEmailRequest(BaseModel):
    email: str
    reason: str = ""


@router.get("/blocked-emails")
async def admin_list_blocked(admin: dict = Depends(require_admin)):
    """List all blocked emails."""
    return {"blocked": db_get_blocked_emails()}


@router.post("/block-email")
async def admin_block_email(req: BlockEmailRequest, admin: dict = Depends(require_admin)):
    """Block an email from logging in or registering."""
    email = (req.email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Email không hợp lệ")

    # Never allow blocking an admin email
    if email in _admin_emails():
        raise HTTPException(status_code=403, detail="Không thể chặn tài khoản admin")

    db_block_email(email, reason=req.reason or "", blocked_by=admin["email"])
    logger.info("Admin %s blocked email %s", admin["email"], email)
    return {"ok": True, "email": email}


@router.post("/unblock-email")
async def admin_unblock_email(req: BlockEmailRequest, admin: dict = Depends(require_admin)):
    """Remove an email from the blocklist."""
    email = (req.email or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email không hợp lệ")
    removed = db_unblock_email(email)
    if not removed:
        raise HTTPException(status_code=404, detail="Email không có trong danh sách chặn")
    logger.info("Admin %s unblocked email %s", admin["email"], email)
    return {"ok": True, "email": email}
