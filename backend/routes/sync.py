"""
Database sync routes — history, notes, bookmarks, gamification, full sync.
Also includes shared notes endpoints.
"""

import os
import json
import secrets
import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from database import (
    db_get_history, db_save_history, db_delete_history, db_clear_history,
    db_get_notes, db_save_notes,
    db_get_bookmarks, db_sync_bookmarks,
    db_get_gamification, db_save_gamification,
    db_full_sync,
    db_create_shared_notes, db_get_shared_notes,
)
from routes.auth import get_current_user

router = APIRouter(prefix="/api", tags=["sync"])
logger = logging.getLogger("sync")


# ═══════════════════════════════════════════════════════
# SHARED NOTES
# ═══════════════════════════════════════════════════════

class ShareNotesRequest(BaseModel):
    video_id: str
    title: str = ""
    author: str = ""
    notes: str = ""
    bookmarks: list = []
    overview: str = ""
    shared_by: str = ""


@router.post("/share-notes")
async def share_notes(req: ShareNotesRequest):
    """Create a shareable link for notes + bookmarks."""
    try:
        if not req.notes.strip() and not req.bookmarks:
            raise HTTPException(status_code=400, detail="Không có ghi chú hoặc bookmark để chia sẻ")

        share_id = secrets.token_urlsafe(9)
        bookmarks_json = json.dumps(req.bookmarks, ensure_ascii=False)

        db_create_shared_notes(
            share_id=share_id,
            video_id=req.video_id,
            title=req.title,
            author=req.author,
            notes=req.notes,
            bookmarks_json=bookmarks_json,
            overview=req.overview,
            shared_by=req.shared_by,
        )

        base_url = os.getenv("APP_BASE_URL", "").rstrip("/") or os.getenv("RENDER_EXTERNAL_URL", "").rstrip("/") or "http://localhost:8000"
        share_url = f"{base_url}/shared-notes?id={share_id}"

        logger.info(f"Created shared notes: {share_id} for video {req.video_id}")
        return {"ok": True, "share_id": share_id, "share_url": share_url}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"share_notes error: {e}")
        raise HTTPException(status_code=500, detail="Không thể tạo link chia sẻ")


@router.get("/shared-notes/{share_id}")
async def get_shared_notes(share_id: str):
    """Fetch shared notes by share ID."""
    try:
        data = db_get_shared_notes(share_id)
        if not data:
            raise HTTPException(status_code=404, detail="Ghi chú chia sẻ không tồn tại hoặc đã bị xóa")

        try:
            data["bookmarks"] = json.loads(data.get("bookmarks", "[]"))
        except (json.JSONDecodeError, TypeError):
            data["bookmarks"] = []

        return data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_shared_notes({share_id}) error: {e}")
        raise HTTPException(status_code=500, detail="Không thể tải ghi chú chia sẻ")


# ═══════════════════════════════════════════════════════
# DATABASE SYNC API
# ═══════════════════════════════════════════════════════

@router.get("/db/history")
async def api_get_history(request: Request, limit: int = 50, before: int = None):
    """Get analysis history with cursor-based pagination.
    Query params: limit (default 50), before (saved_at timestamp cursor).
    Returns: {items: [...], has_more: bool, next_cursor: int|null}
    """
    try:
        user = get_current_user(request)
        uid = user["id"] if user else None
        return db_get_history(limit=min(limit, 100), user_id=uid, before=before)
    except Exception as e:
        logger.error(f"get_history error: {e}")
        raise HTTPException(status_code=500, detail="Không thể tải lịch sử")

@router.post("/db/history")
async def api_save_history(request: Request):
    """Save an analysis entry to database."""
    try:
        entry = await request.json()
        user = get_current_user(request)
        uid = user["id"] if user else None
        entry_id = db_save_history(entry, user_id=uid)
        return {"ok": True, "entry_id": entry_id}
    except Exception as e:
        logger.error(f"save_history error: {e}")
        raise HTTPException(status_code=500, detail="Không thể lưu lịch sử")

@router.post("/db/history/bulk")
async def api_bulk_save_history(request: Request):
    """Bulk import history entries (for initial sync from localStorage)."""
    try:
        entries = await request.json()
        user = get_current_user(request)
        uid = user["id"] if user else None
        saved = 0
        for entry in entries:
            try:
                db_save_history(entry, user_id=uid)
                saved += 1
            except Exception as e:
                logger.debug(f"Skip entry: {e}")
        return {"ok": True, "saved": saved, "total": len(entries)}
    except Exception as e:
        logger.error(f"bulk_save_history error: {e}")
        raise HTTPException(status_code=500, detail="Không thể import lịch sử")

@router.delete("/db/history/{entry_id}")
async def api_delete_history(entry_id: str, request: Request):
    """Delete a single history entry."""
    try:
        user = get_current_user(request)
        uid = user["id"] if user else None
        db_delete_history(entry_id, user_id=uid)
        return {"ok": True}
    except Exception as e:
        logger.error(f"delete_history({entry_id}) error: {e}")
        raise HTTPException(status_code=500, detail="Không thể xóa mục lịch sử")

@router.delete("/db/history")
async def api_clear_history(request: Request):
    """Clear all history."""
    try:
        user = get_current_user(request)
        uid = user["id"] if user else None
        db_clear_history(user_id=uid)
        return {"ok": True}
    except Exception as e:
        logger.error(f"clear_history error: {e}")
        raise HTTPException(status_code=500, detail="Không thể xóa lịch sử")

@router.get("/db/notes/{video_id}")
async def api_get_notes(video_id: str, request: Request):
    """Get notes for a video."""
    try:
        user = get_current_user(request)
        uid = user["id"] if user else None
        return {"video_id": video_id, "content": db_get_notes(video_id, user_id=uid)}
    except Exception as e:
        logger.error(f"get_notes({video_id}) error: {e}")
        raise HTTPException(status_code=500, detail="Không thể tải ghi chú")

@router.put("/db/notes/{video_id}")
async def api_save_notes(video_id: str, request: Request):
    """Save/update notes for a video."""
    try:
        body = await request.json()
        user = get_current_user(request)
        uid = user["id"] if user else None
        db_save_notes(video_id, body.get("content", ""), user_id=uid)
        return {"ok": True}
    except Exception as e:
        logger.error(f"save_notes({video_id}) error: {e}")
        raise HTTPException(status_code=500, detail="Không thể lưu ghi chú")

@router.get("/db/bookmarks/{video_id}")
async def api_get_bookmarks(video_id: str, request: Request):
    """Get bookmarks for a video."""
    try:
        user = get_current_user(request)
        uid = user["id"] if user else None
        return db_get_bookmarks(video_id, user_id=uid)
    except Exception as e:
        logger.error(f"get_bookmarks({video_id}) error: {e}")
        raise HTTPException(status_code=500, detail="Không thể tải bookmark")

@router.put("/db/bookmarks/{video_id}")
async def api_sync_bookmarks(video_id: str, request: Request):
    """Sync all bookmarks for a video (replace)."""
    try:
        bookmarks = await request.json()
        user = get_current_user(request)
        uid = user["id"] if user else None
        db_sync_bookmarks(video_id, bookmarks, user_id=uid)
        return {"ok": True}
    except Exception as e:
        logger.error(f"sync_bookmarks({video_id}) error: {e}")
        raise HTTPException(status_code=500, detail="Không thể đồng bộ bookmark")

@router.get("/db/gamification")
async def api_get_gamification(request: Request):
    """Get gamification data."""
    try:
        user = get_current_user(request)
        uid = user["id"] if user else None
        return db_get_gamification(user_id=uid)
    except Exception as e:
        logger.error(f"get_gamification error: {e}")
        raise HTTPException(status_code=500, detail="Không thể tải dữ liệu gamification")

@router.put("/db/gamification")
async def api_save_gamification(request: Request):
    """Save gamification data."""
    try:
        data = await request.json()
        user = get_current_user(request)
        uid = user["id"] if user else None
        db_save_gamification(data, user_id=uid)
        return {"ok": True}
    except Exception as e:
        logger.error(f"save_gamification error: {e}")
        raise HTTPException(status_code=500, detail="Không thể lưu dữ liệu gamification")

@router.post("/db/sync")
async def api_full_sync(request: Request):
    """Full sync: single-connection sync to avoid DB locking."""
    try:
        payload = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}")

    try:
        user = get_current_user(request)
        uid = user["id"] if user else None

        return db_full_sync(
            user_id=uid,
            local_history=payload.get("history", []),
            local_notes=payload.get("notes", {}),
            local_bookmarks=payload.get("bookmarks", {}),
            local_gamif=payload.get("gamification", {}),
            extra_data=payload.get("extra_data", {}),
        )
    except Exception as e:
        logger.error(f"full_sync error: {e}")
        raise HTTPException(status_code=500, detail="Không thể đồng bộ dữ liệu")
