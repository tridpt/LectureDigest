"""
Collaborative Study Rooms — create rooms, invite members, share progress,
discuss videos with real-time comment threads.
"""

import os
import json
import time
import secrets
import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Optional

from database import get_db
from routes.auth import get_current_user

router = APIRouter(prefix="/api/rooms", tags=["study-rooms"])
logger = logging.getLogger("study-rooms")


# ═══════════════════════════════════════════════════════
# DATABASE HELPERS
# ═══════════════════════════════════════════════════════

def _init_rooms_tables():
    """Create study room tables (called from init_db migration)."""
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS study_rooms (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT DEFAULT '',
            icon        TEXT DEFAULT '📚',
            owner_id    INTEGER NOT NULL,
            invite_code TEXT UNIQUE NOT NULL,
            max_members INTEGER DEFAULT 20,
            is_public   INTEGER DEFAULT 0,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_rooms_owner ON study_rooms(owner_id);
        CREATE INDEX IF NOT EXISTS idx_rooms_invite ON study_rooms(invite_code);

        CREATE TABLE IF NOT EXISTS room_members (
            room_id    TEXT NOT NULL,
            user_id    INTEGER NOT NULL,
            role       TEXT DEFAULT 'member',
            joined_at  INTEGER NOT NULL,
            PRIMARY KEY (room_id, user_id),
            FOREIGN KEY (room_id) REFERENCES study_rooms(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_rm_user ON room_members(user_id);

        CREATE TABLE IF NOT EXISTS room_videos (
            room_id    TEXT NOT NULL,
            video_id   TEXT NOT NULL,
            title      TEXT DEFAULT '',
            thumbnail  TEXT DEFAULT '',
            added_by   INTEGER,
            added_at   INTEGER NOT NULL,
            data_json  TEXT DEFAULT '',
            url        TEXT DEFAULT '',
            PRIMARY KEY (room_id, video_id),
            FOREIGN KEY (room_id) REFERENCES study_rooms(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS room_comments (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id    TEXT NOT NULL,
            video_id   TEXT DEFAULT '',
            chapter    TEXT DEFAULT '',
            user_id    INTEGER NOT NULL,
            content    TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (room_id) REFERENCES study_rooms(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_rc_room ON room_comments(room_id, video_id);
        CREATE INDEX IF NOT EXISTS idx_rc_time ON room_comments(created_at DESC);

        CREATE TABLE IF NOT EXISTS room_progress (
            room_id    TEXT NOT NULL,
            user_id    INTEGER NOT NULL,
            video_id   TEXT NOT NULL,
            quiz_score INTEGER DEFAULT -1,
            quiz_total INTEGER DEFAULT 0,
            watch_pct  INTEGER DEFAULT 0,
            flashcards_mastered INTEGER DEFAULT 0,
            flashcards_total INTEGER DEFAULT 0,
            updated_at INTEGER,
            PRIMARY KEY (room_id, user_id, video_id),
            FOREIGN KEY (room_id) REFERENCES study_rooms(id) ON DELETE CASCADE
        );
    """)
    conn.commit()
    conn.close()

    # Migration: add data_json and url columns to room_videos if missing
    conn2 = get_db()
    try:
        conn2.execute("ALTER TABLE room_videos ADD COLUMN data_json TEXT DEFAULT ''")
    except:
        pass
    try:
        conn2.execute("ALTER TABLE room_videos ADD COLUMN url TEXT DEFAULT ''")
    except:
        pass
    conn2.commit()
    conn2.close()


# Initialize tables on module load
_init_rooms_tables()


def _generate_room_id():
    return secrets.token_hex(8)


def _generate_invite_code():
    return secrets.token_urlsafe(6)


def _require_auth(request: Request):
    """Require authenticated user, raise 401 if not."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập để sử dụng tính năng này")
    return user


def _require_member(room_id: str, user_id: int):
    """Check if user is a member of the room."""
    conn = get_db()
    row = conn.execute(
        "SELECT role FROM room_members WHERE room_id = ? AND user_id = ?",
        (room_id, user_id)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=403, detail="Bạn không phải thành viên phòng này")
    return row["role"]


# ═══════════════════════════════════════════════════════
# REQUEST MODELS
# ═══════════════════════════════════════════════════════

class CreateRoomRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = ''
    icon: str = '📚'

class UpdateRoomRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None

class AddVideoRequest(BaseModel):
    video_id: str
    title: str = ''
    thumbnail: str = ''
    url: str = ''
    data_json: str = ''  # JSON string of analysis data

class PostCommentRequest(BaseModel):
    video_id: str = ''
    chapter: str = ''
    content: str = Field(min_length=1, max_length=2000)

class UpdateProgressRequest(BaseModel):
    video_id: str
    quiz_score: int = -1
    quiz_total: int = 0
    watch_pct: int = 0
    flashcards_mastered: int = 0
    flashcards_total: int = 0


# ═══════════════════════════════════════════════════════
# ROOM CRUD
# ═══════════════════════════════════════════════════════

@router.post("")
async def create_room(req: CreateRoomRequest, request: Request):
    """Create a new study room."""
    user = _require_auth(request)
    uid = user["id"]

    # Limit rooms per user
    conn = get_db()
    count = conn.execute("SELECT COUNT(*) as c FROM study_rooms WHERE owner_id = ?", (uid,)).fetchone()["c"]
    if count >= 10:
        conn.close()
        raise HTTPException(status_code=400, detail="Bạn đã tạo tối đa 10 phòng học")

    room_id = _generate_room_id()
    invite_code = _generate_invite_code()
    now = int(time.time() * 1000)

    conn.execute("""
        INSERT INTO study_rooms (id, name, description, icon, owner_id, invite_code, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (room_id, req.name, req.description, req.icon, uid, invite_code, now, now))

    # Owner is automatically a member with 'owner' role
    conn.execute("""
        INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)
    """, (room_id, uid, now))

    conn.commit()
    conn.close()

    return {
        "id": room_id,
        "name": req.name,
        "description": req.description,
        "icon": req.icon,
        "invite_code": invite_code,
        "member_count": 1
    }


@router.get("")
async def list_my_rooms(request: Request):
    """List all rooms the user is a member of."""
    user = _require_auth(request)
    uid = user["id"]

    conn = get_db()
    rows = conn.execute("""
        SELECT sr.*, rm.role,
               (SELECT COUNT(*) FROM room_members WHERE room_id = sr.id) as member_count,
               (SELECT COUNT(*) FROM room_videos WHERE room_id = sr.id) as video_count
        FROM study_rooms sr
        JOIN room_members rm ON sr.id = rm.room_id AND rm.user_id = ?
        ORDER BY sr.updated_at DESC
    """, (uid,)).fetchall()
    conn.close()

    return [{
        "id": r["id"],
        "name": r["name"],
        "description": r["description"],
        "icon": r["icon"],
        "invite_code": r["invite_code"],
        "role": r["role"],
        "member_count": r["member_count"],
        "video_count": r["video_count"],
        "created_at": r["created_at"],
    } for r in rows]


@router.get("/{room_id}")
async def get_room(room_id: str, request: Request):
    """Get room details with members and videos."""
    user = _require_auth(request)
    uid = user["id"]
    _require_member(room_id, uid)

    conn = get_db()
    room = conn.execute("SELECT * FROM study_rooms WHERE id = ?", (room_id,)).fetchone()
    if not room:
        conn.close()
        raise HTTPException(status_code=404, detail="Phòng không tồn tại")

    # Members
    members = conn.execute("""
        SELECT rm.user_id, rm.role, rm.joined_at, u.display_name, u.avatar_color, u.avatar_url
        FROM room_members rm
        JOIN users u ON rm.user_id = u.id
        WHERE rm.room_id = ?
        ORDER BY rm.joined_at ASC
    """, (room_id,)).fetchall()

    # Videos
    videos = conn.execute("""
        SELECT * FROM room_videos WHERE room_id = ? ORDER BY added_at DESC
    """, (room_id,)).fetchall()

    conn.close()

    return {
        "id": room["id"],
        "name": room["name"],
        "description": room["description"],
        "icon": room["icon"],
        "owner_id": room["owner_id"],
        "invite_code": room["invite_code"],
        "created_at": room["created_at"],
        "members": [{
            "user_id": m["user_id"],
            "display_name": m["display_name"],
            "avatar_color": m["avatar_color"],
            "avatar_url": m["avatar_url"] or "",
            "role": m["role"],
            "joined_at": m["joined_at"],
        } for m in members],
        "videos": [{
            "video_id": v["video_id"],
            "title": v["title"],
            "thumbnail": v["thumbnail"],
            "added_by": v["added_by"],
            "added_at": v["added_at"],
        } for v in videos],
    }


@router.put("/{room_id}")
async def update_room(room_id: str, req: UpdateRoomRequest, request: Request):
    """Update room info (owner only)."""
    user = _require_auth(request)
    uid = user["id"]

    conn = get_db()
    room = conn.execute("SELECT owner_id FROM study_rooms WHERE id = ?", (room_id,)).fetchone()
    if not room:
        conn.close()
        raise HTTPException(status_code=404, detail="Phòng không tồn tại")
    if room["owner_id"] != uid:
        conn.close()
        raise HTTPException(status_code=403, detail="Chỉ chủ phòng mới có thể chỉnh sửa")

    updates = []
    params = []
    if req.name is not None:
        updates.append("name = ?")
        params.append(req.name)
    if req.description is not None:
        updates.append("description = ?")
        params.append(req.description)
    if req.icon is not None:
        updates.append("icon = ?")
        params.append(req.icon)

    if updates:
        updates.append("updated_at = ?")
        params.append(int(time.time() * 1000))
        params.append(room_id)
        conn.execute(f"UPDATE study_rooms SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()

    conn.close()
    return {"ok": True}


@router.delete("/{room_id}")
async def delete_room(room_id: str, request: Request):
    """Delete a room (owner only)."""
    user = _require_auth(request)
    uid = user["id"]

    conn = get_db()
    room = conn.execute("SELECT owner_id FROM study_rooms WHERE id = ?", (room_id,)).fetchone()
    if not room:
        conn.close()
        raise HTTPException(status_code=404, detail="Phòng không tồn tại")
    if room["owner_id"] != uid:
        conn.close()
        raise HTTPException(status_code=403, detail="Chỉ chủ phòng mới có thể xóa")

    conn.execute("DELETE FROM study_rooms WHERE id = ?", (room_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ═══════════════════════════════════════════════════════
# JOIN / LEAVE
# ═══════════════════════════════════════════════════════

@router.post("/join/{invite_code}")
async def join_room(invite_code: str, request: Request):
    """Join a room using invite code."""
    user = _require_auth(request)
    uid = user["id"]

    conn = get_db()
    room = conn.execute("SELECT * FROM study_rooms WHERE invite_code = ?", (invite_code,)).fetchone()
    if not room:
        conn.close()
        raise HTTPException(status_code=404, detail="Mã mời không hợp lệ")

    # Check if already a member
    existing = conn.execute(
        "SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?",
        (room["id"], uid)
    ).fetchone()
    if existing:
        conn.close()
        return {"ok": True, "room_id": room["id"], "already_member": True}

    # Check member limit
    count = conn.execute(
        "SELECT COUNT(*) as c FROM room_members WHERE room_id = ?", (room["id"],)
    ).fetchone()["c"]
    if count >= room["max_members"]:
        conn.close()
        raise HTTPException(status_code=400, detail="Phòng đã đầy")

    now = int(time.time() * 1000)
    conn.execute(
        "INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
        (room["id"], uid, now)
    )
    conn.execute("UPDATE study_rooms SET updated_at = ? WHERE id = ?", (now, room["id"]))
    conn.commit()
    conn.close()

    return {"ok": True, "room_id": room["id"], "room_name": room["name"]}


@router.post("/{room_id}/leave")
async def leave_room(room_id: str, request: Request):
    """Leave a room."""
    user = _require_auth(request)
    uid = user["id"]

    conn = get_db()
    room = conn.execute("SELECT owner_id FROM study_rooms WHERE id = ?", (room_id,)).fetchone()
    if not room:
        conn.close()
        raise HTTPException(status_code=404, detail="Phòng không tồn tại")
    if room["owner_id"] == uid:
        conn.close()
        raise HTTPException(status_code=400, detail="Chủ phòng không thể rời phòng. Hãy xóa phòng hoặc chuyển quyền.")

    conn.execute("DELETE FROM room_members WHERE room_id = ? AND user_id = ?", (room_id, uid))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/{room_id}/kick/{target_user_id}")
async def kick_member(room_id: str, target_user_id: int, request: Request):
    """Kick a member (owner only)."""
    user = _require_auth(request)
    uid = user["id"]

    conn = get_db()
    room = conn.execute("SELECT owner_id FROM study_rooms WHERE id = ?", (room_id,)).fetchone()
    if not room or room["owner_id"] != uid:
        conn.close()
        raise HTTPException(status_code=403, detail="Chỉ chủ phòng mới có thể kick")
    if target_user_id == uid:
        conn.close()
        raise HTTPException(status_code=400, detail="Không thể kick chính mình")

    conn.execute("DELETE FROM room_members WHERE room_id = ? AND user_id = ?", (room_id, target_user_id))
    conn.commit()
    conn.close()
    return {"ok": True}


class ChangeRoleRequest(BaseModel):
    role: str = 'member'  # 'member' or 'moderator'


@router.post("/{room_id}/role/{target_user_id}")
async def change_member_role(room_id: str, target_user_id: int, req: ChangeRoleRequest, request: Request):
    """Change a member's role (owner only)."""
    user = _require_auth(request)
    uid = user["id"]

    if req.role not in ('member', 'moderator'):
        raise HTTPException(status_code=400, detail="Role phải là 'member' hoặc 'moderator'")

    conn = get_db()
    room = conn.execute("SELECT owner_id FROM study_rooms WHERE id = ?", (room_id,)).fetchone()
    if not room or room["owner_id"] != uid:
        conn.close()
        raise HTTPException(status_code=403, detail="Chỉ chủ phòng mới có thể đổi quyền")
    if target_user_id == uid:
        conn.close()
        raise HTTPException(status_code=400, detail="Không thể đổi quyền chính mình")

    # Check target is a member
    member = conn.execute(
        "SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?",
        (room_id, target_user_id)
    ).fetchone()
    if not member:
        conn.close()
        raise HTTPException(status_code=404, detail="Thành viên không tồn tại")

    conn.execute(
        "UPDATE room_members SET role = ? WHERE room_id = ? AND user_id = ?",
        (req.role, room_id, target_user_id)
    )
    conn.commit()
    conn.close()
    return {"ok": True, "role": req.role}


# ═══════════════════════════════════════════════════════
# VIDEOS IN ROOM
# ═══════════════════════════════════════════════════════

@router.post("/{room_id}/videos")
async def add_video_to_room(room_id: str, req: AddVideoRequest, request: Request):
    """Add a video to the room's shared list, including analysis data."""
    user = _require_auth(request)
    uid = user["id"]
    _require_member(room_id, uid)

    conn = get_db()
    now = int(time.time() * 1000)
    try:
        conn.execute("""
            INSERT OR REPLACE INTO room_videos (room_id, video_id, title, thumbnail, added_by, added_at, data_json, url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (room_id, req.video_id, req.title, req.thumbnail, uid, now, req.data_json, req.url))
        conn.execute("UPDATE study_rooms SET updated_at = ? WHERE id = ?", (now, room_id))
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))
    conn.close()
    return {"ok": True}


@router.get("/{room_id}/videos/{video_id}")
async def get_room_video_data(room_id: str, video_id: str, request: Request):
    """Get a shared video's analysis data so other members can view it."""
    user = _require_auth(request)
    uid = user["id"]
    _require_member(room_id, uid)

    conn = get_db()
    row = conn.execute(
        "SELECT * FROM room_videos WHERE room_id = ? AND video_id = ?",
        (room_id, video_id)
    ).fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Video không tồn tại trong phòng")

    data_json = row["data_json"] if "data_json" in row.keys() else ""

    return {
        "video_id": row["video_id"],
        "title": row["title"],
        "thumbnail": row["thumbnail"],
        "url": row["url"] if "url" in row.keys() else "",
        "added_by": row["added_by"],
        "added_at": row["added_at"],
        "data_json": data_json,
    }


@router.delete("/{room_id}/videos/{video_id}")
async def remove_video_from_room(room_id: str, video_id: str, request: Request):
    """Remove a video from the room."""
    user = _require_auth(request)
    uid = user["id"]
    role = _require_member(room_id, uid)

    conn = get_db()
    # Only owner or the person who added can remove
    video = conn.execute(
        "SELECT added_by FROM room_videos WHERE room_id = ? AND video_id = ?",
        (room_id, video_id)
    ).fetchone()
    if not video:
        conn.close()
        raise HTTPException(status_code=404, detail="Video không tồn tại trong phòng")

    if role != 'owner' and video["added_by"] != uid:
        conn.close()
        raise HTTPException(status_code=403, detail="Không có quyền xóa video này")

    conn.execute("DELETE FROM room_videos WHERE room_id = ? AND video_id = ?", (room_id, video_id))
    conn.commit()
    conn.close()
    return {"ok": True}


# ═══════════════════════════════════════════════════════
# COMMENTS / DISCUSSION
# ═══════════════════════════════════════════════════════

@router.get("/{room_id}/comments")
async def get_comments(room_id: str, request: Request, video_id: str = '', limit: int = 50):
    """Get comments for a room, optionally filtered by video."""
    user = _require_auth(request)
    uid = user["id"]
    _require_member(room_id, uid)

    conn = get_db()
    if video_id:
        rows = conn.execute("""
            SELECT rc.*, u.display_name, u.avatar_color, u.avatar_url
            FROM room_comments rc
            JOIN users u ON rc.user_id = u.id
            WHERE rc.room_id = ? AND rc.video_id = ?
            ORDER BY rc.created_at DESC
            LIMIT ?
        """, (room_id, video_id, limit)).fetchall()
    else:
        rows = conn.execute("""
            SELECT rc.*, u.display_name, u.avatar_color, u.avatar_url
            FROM room_comments rc
            JOIN users u ON rc.user_id = u.id
            WHERE rc.room_id = ?
            ORDER BY rc.created_at DESC
            LIMIT ?
        """, (room_id, limit)).fetchall()
    conn.close()

    return [{
        "id": r["id"],
        "video_id": r["video_id"],
        "chapter": r["chapter"],
        "user_id": r["user_id"],
        "display_name": r["display_name"],
        "avatar_color": r["avatar_color"],
        "avatar_url": r["avatar_url"] or "",
        "content": r["content"],
        "created_at": r["created_at"],
    } for r in rows]


@router.post("/{room_id}/comments")
async def post_comment(room_id: str, req: PostCommentRequest, request: Request):
    """Post a comment in the room."""
    user = _require_auth(request)
    uid = user["id"]
    _require_member(room_id, uid)

    conn = get_db()
    now = int(time.time() * 1000)
    cursor = conn.execute("""
        INSERT INTO room_comments (room_id, video_id, chapter, user_id, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (room_id, req.video_id, req.chapter, uid, req.content, now))
    comment_id = cursor.lastrowid
    conn.execute("UPDATE study_rooms SET updated_at = ? WHERE id = ?", (now, room_id))
    conn.commit()
    conn.close()

    return {
        "id": comment_id,
        "video_id": req.video_id,
        "chapter": req.chapter,
        "user_id": uid,
        "display_name": user.get("display_name", ""),
        "avatar_color": user.get("avatar_color", "#8b5cf6"),
        "avatar_url": user.get("avatar_url", ""),
        "content": req.content,
        "created_at": now,
    }


@router.delete("/{room_id}/comments/{comment_id}")
async def delete_comment(room_id: str, comment_id: int, request: Request):
    """Delete a comment (author or room owner)."""
    user = _require_auth(request)
    uid = user["id"]

    conn = get_db()
    comment = conn.execute(
        "SELECT user_id FROM room_comments WHERE id = ? AND room_id = ?",
        (comment_id, room_id)
    ).fetchone()
    if not comment:
        conn.close()
        raise HTTPException(status_code=404, detail="Bình luận không tồn tại")

    room = conn.execute("SELECT owner_id FROM study_rooms WHERE id = ?", (room_id,)).fetchone()
    if comment["user_id"] != uid and (not room or room["owner_id"] != uid):
        conn.close()
        raise HTTPException(status_code=403, detail="Không có quyền xóa bình luận này")

    conn.execute("DELETE FROM room_comments WHERE id = ?", (comment_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ═══════════════════════════════════════════════════════
# PROGRESS COMPARISON
# ═══════════════════════════════════════════════════════

@router.post("/{room_id}/progress")
async def update_progress(room_id: str, req: UpdateProgressRequest, request: Request):
    """Update user's progress for a video in the room."""
    user = _require_auth(request)
    uid = user["id"]
    _require_member(room_id, uid)

    conn = get_db()
    now = int(time.time() * 1000)
    conn.execute("""
        INSERT INTO room_progress (room_id, user_id, video_id, quiz_score, quiz_total, watch_pct, flashcards_mastered, flashcards_total, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(room_id, user_id, video_id) DO UPDATE SET
            quiz_score = ?, quiz_total = ?, watch_pct = ?,
            flashcards_mastered = ?, flashcards_total = ?, updated_at = ?
    """, (room_id, uid, req.video_id, req.quiz_score, req.quiz_total, req.watch_pct,
          req.flashcards_mastered, req.flashcards_total, now,
          req.quiz_score, req.quiz_total, req.watch_pct,
          req.flashcards_mastered, req.flashcards_total, now))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.get("/{room_id}/progress")
async def get_room_progress(room_id: str, request: Request, video_id: str = ''):
    """Get all members' progress, optionally for a specific video."""
    user = _require_auth(request)
    uid = user["id"]
    _require_member(room_id, uid)

    conn = get_db()
    if video_id:
        rows = conn.execute("""
            SELECT rp.*, u.display_name, u.avatar_color, u.avatar_url
            FROM room_progress rp
            JOIN users u ON rp.user_id = u.id
            WHERE rp.room_id = ? AND rp.video_id = ?
            ORDER BY rp.quiz_score DESC
        """, (room_id, video_id)).fetchall()
    else:
        rows = conn.execute("""
            SELECT rp.*, u.display_name, u.avatar_color, u.avatar_url
            FROM room_progress rp
            JOIN users u ON rp.user_id = u.id
            WHERE rp.room_id = ?
            ORDER BY rp.video_id, rp.quiz_score DESC
        """, (room_id,)).fetchall()
    conn.close()

    return [{
        "user_id": r["user_id"],
        "display_name": r["display_name"],
        "avatar_color": r["avatar_color"],
        "avatar_url": r["avatar_url"] or "",
        "video_id": r["video_id"],
        "quiz_score": r["quiz_score"],
        "quiz_total": r["quiz_total"],
        "watch_pct": r["watch_pct"],
        "flashcards_mastered": r["flashcards_mastered"],
        "flashcards_total": r["flashcards_total"],
        "updated_at": r["updated_at"],
    } for r in rows]


@router.post("/{room_id}/regenerate-invite")
async def regenerate_invite(room_id: str, request: Request):
    """Generate a new invite code (owner only)."""
    user = _require_auth(request)
    uid = user["id"]

    conn = get_db()
    room = conn.execute("SELECT owner_id FROM study_rooms WHERE id = ?", (room_id,)).fetchone()
    if not room or room["owner_id"] != uid:
        conn.close()
        raise HTTPException(status_code=403, detail="Chỉ chủ phòng mới có thể tạo mã mời mới")

    new_code = _generate_invite_code()
    conn.execute("UPDATE study_rooms SET invite_code = ?, updated_at = ? WHERE id = ?",
                 (new_code, int(time.time() * 1000), room_id))
    conn.commit()
    conn.close()
    return {"invite_code": new_code}
