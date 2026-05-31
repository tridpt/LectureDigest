"""
Folders routes — CRUD for video organization folders.
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Optional
import logging

from database import (
    db_get_folders, db_create_folder, db_update_folder, db_delete_folder,
    db_add_video_to_folder, db_remove_video_from_folder,
    db_get_folder_videos, db_get_all_folder_videos,
)
from routes.auth import get_current_user

router = APIRouter(prefix="/api/folders", tags=["folders"])
logger = logging.getLogger("folders")


class CreateFolderRequest(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    icon: str = "📁"
    color: str = "#8b5cf6"

class UpdateFolderRequest(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None

class FolderVideoRequest(BaseModel):
    video_id: str


@router.get("")
async def list_folders(request: Request):
    """Get all folders for the current user."""
    try:
        user = get_current_user(request)
        uid = user["id"] if user else None
        folders = db_get_folders(user_id=uid)

        # Attach video counts and video_ids
        all_fv = db_get_all_folder_videos(user_id=uid)
        for f in folders:
            vids = all_fv.get(f["id"], [])
            f["video_ids"] = vids
            f["video_count"] = len(vids)

        return {"folders": folders}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"list_folders error: {e}")
        raise HTTPException(status_code=500, detail="Không thể tải danh sách folder")


@router.post("")
async def create_folder(req: CreateFolderRequest, request: Request):
    """Create a new folder."""
    try:
        user = get_current_user(request)
        uid = user["id"] if user else None

        # Limit folders per user
        existing = db_get_folders(user_id=uid)
        if len(existing) >= 20:
            raise HTTPException(status_code=400, detail="Tối đa 20 folders")

        folder_id = db_create_folder(
            name=req.name,
            icon=req.icon,
            color=req.color,
            user_id=uid,
        )
        return {"ok": True, "folder_id": folder_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_folder error: {e}")
        raise HTTPException(status_code=500, detail="Không thể tạo folder")


@router.put("/{folder_id}")
async def update_folder(folder_id: int, req: UpdateFolderRequest, request: Request):
    """Update a folder's name, icon, or color."""
    try:
        user = get_current_user(request)
        uid = user["id"] if user else None

        db_update_folder(folder_id, name=req.name, icon=req.icon, color=req.color, user_id=uid)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"update_folder({folder_id}) error: {e}")
        raise HTTPException(status_code=500, detail="Không thể cập nhật folder")


@router.delete("/{folder_id}")
async def delete_folder(folder_id: int, request: Request):
    """Delete a folder (videos are NOT deleted, only the organization)."""
    try:
        user = get_current_user(request)
        uid = user["id"] if user else None
        db_delete_folder(folder_id, user_id=uid)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"delete_folder({folder_id}) error: {e}")
        raise HTTPException(status_code=500, detail="Không thể xóa folder")


@router.post("/{folder_id}/videos")
async def add_video(folder_id: int, req: FolderVideoRequest, request: Request):
    """Add a video to a folder."""
    try:
        user = get_current_user(request)
        uid = user["id"] if user else None
        ok = db_add_video_to_folder(folder_id, req.video_id, user_id=uid)
        if not ok:
            raise HTTPException(status_code=404, detail="Folder không tồn tại hoặc không thuộc về bạn")
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"add_video({folder_id}, {req.video_id}) error: {e}")
        raise HTTPException(status_code=500, detail="Không thể thêm video vào folder")


@router.delete("/{folder_id}/videos/{video_id}")
async def remove_video(folder_id: int, video_id: str, request: Request):
    """Remove a video from a folder."""
    try:
        user = get_current_user(request)
        uid = user["id"] if user else None
        ok = db_remove_video_from_folder(folder_id, video_id, user_id=uid)
        if not ok:
            raise HTTPException(status_code=404, detail="Folder không tồn tại hoặc không thuộc về bạn")
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"remove_video({folder_id}, {video_id}) error: {e}")
        raise HTTPException(status_code=500, detail="Không thể xóa video khỏi folder")
