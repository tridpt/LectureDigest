"""
Chat Rooms — standalone real-time chat system.
Users can create/join chat rooms and message each other.
"""

import time
import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Optional

from database import get_db
from routes.auth import get_current_user

router = APIRouter(prefix="/api/chat-rooms", tags=["chat-rooms"])
logger = logging.getLogger("chat-rooms")


# ═══════════════════════════════════════════════════════
# DATABASE INITIALIZATION
# ═══════════════════════════════════════════════════════

def _init_chat_rooms_tables():
    """Create chat room tables if they don't exist."""
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS chat_rooms (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            icon TEXT DEFAULT '💬',
            created_by TEXT NOT NULL,
            is_public INTEGER DEFAULT 1,
            max_members INTEGER DEFAULT 50,
            created_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chat_room_members (
            room_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            joined_at REAL NOT NULL,
            PRIMARY KEY (room_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            room_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_chat_room_members_user ON chat_room_members(user_id);
    """)
    conn.commit()


# Initialize tables on module load
try:
    _init_chat_rooms_tables()
except Exception as e:
    logger.warning(f"Chat rooms table init deferred: {e}")


# ═══════════════════════════════════════════════════════
# PYDANTIC MODELS
# ═══════════════════════════════════════════════════════

class CreateRoomBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    icon: str = Field(default="💬", max_length=10)
    is_public: bool = True
    max_members: int = Field(default=50, ge=2, le=200)


class SendMessageBody(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000)


# ═══════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════

def _generate_id():
    import secrets
    return secrets.token_hex(12)


def _get_user_info(user_id):
    """Get display_name and avatar_url for a user."""
    conn = get_db()
    row = conn.execute(
        "SELECT display_name, avatar_url, avatar_color FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    if row:
        return {"username": row["display_name"] or "User", "avatar_url": row["avatar_url"] or None, "avatar_color": row["avatar_color"] or "#8b5cf6"}
    return {"username": "Unknown", "avatar_url": None, "avatar_color": "#8b5cf6"}


def _is_room_member(room_id: str, user_id) -> bool:
    conn = get_db()
    row = conn.execute(
        "SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?",
        (room_id, user_id)
    ).fetchone()
    return row is not None


def _get_room(room_id: str):
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM chat_rooms WHERE id = ?",
        (room_id,)
    ).fetchone()
    if not row:
        return None
    return {
        "id": row["id"], "name": row["name"], "icon": row["icon"],
        "created_by": row["created_by"], "is_public": bool(row["is_public"]),
        "max_members": row["max_members"], "created_at": row["created_at"]
    }


def _get_member_count(room_id: str) -> int:
    conn = get_db()
    row = conn.execute(
        "SELECT COUNT(*) as c FROM chat_room_members WHERE room_id = ?", (room_id,)
    ).fetchone()
    return row["c"] if row else 0


def _get_last_message(room_id: str):
    conn = get_db()
    row = conn.execute(
        "SELECT content, user_id, created_at FROM chat_messages WHERE room_id = ? ORDER BY created_at DESC LIMIT 1",
        (room_id,)
    ).fetchone()
    if row:
        user_info = _get_user_info(row["user_id"])
        return {"content": row["content"], "username": user_info["username"], "created_at": row["created_at"]}
    return None


# ═══════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════

@router.post("")
async def create_room(body: CreateRoomBody, request: Request):
    """Create a new chat room."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = get_db()
    room_id = _generate_id()
    now = time.time()

    conn.execute(
        "INSERT INTO chat_rooms (id, name, icon, created_by, is_public, max_members, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (room_id, body.name.strip(), body.icon, user["id"], int(body.is_public), body.max_members, now)
    )
    # Creator auto-joins
    conn.execute(
        "INSERT INTO chat_room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)",
        (room_id, user["id"], now)
    )
    conn.commit()

    logger.info(f"Chat room created: {body.name} by user {user['id']}")
    return {"ok": True, "room_id": room_id}


@router.get("")
async def list_my_rooms(request: Request):
    """List rooms the current user is a member of."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = get_db()
    rows = conn.execute("""
        SELECT cr.id, cr.name, cr.icon, cr.created_by, cr.is_public, cr.max_members, cr.created_at
        FROM chat_rooms cr
        JOIN chat_room_members crm ON cr.id = crm.room_id
        WHERE crm.user_id = ?
        ORDER BY cr.created_at DESC
    """, (user["id"],)).fetchall()

    rooms = []
    for row in rows:
        room_id = row["id"]
        room = {
            "id": room_id, "name": row["name"], "icon": row["icon"],
            "created_by": row["created_by"], "is_public": bool(row["is_public"]),
            "max_members": row["max_members"], "created_at": row["created_at"],
            "member_count": _get_member_count(room_id),
            "last_message": _get_last_message(room_id),
        }
        creator_info = _get_user_info(row["created_by"])
        room["creator_name"] = creator_info["username"]
        rooms.append(room)

    return {"rooms": rooms}


@router.get("/public")
async def list_public_rooms(request: Request):
    """List public rooms available to join."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = get_db()
    rows = conn.execute("""
        SELECT id, name, icon, created_by, is_public, max_members, created_at
        FROM chat_rooms
        WHERE is_public = 1
        ORDER BY created_at DESC
        LIMIT 50
    """).fetchall()

    rooms = []
    for row in rows:
        room_id = row["id"]
        member_count = _get_member_count(room_id)
        is_member = _is_room_member(room_id, user["id"])
        creator_info = _get_user_info(row["created_by"])
        rooms.append({
            "id": room_id, "name": row["name"], "icon": row["icon"],
            "created_by": row["created_by"], "is_public": True,
            "max_members": row["max_members"], "created_at": row["created_at"],
            "member_count": member_count,
            "is_member": is_member,
            "creator_name": creator_info["username"],
            "last_message": _get_last_message(room_id),
        })

    return {"rooms": rooms}


@router.post("/join/{room_id}")
async def join_room(room_id: str, request: Request):
    """Join a public chat room."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    room = _get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if not room["is_public"]:
        raise HTTPException(status_code=403, detail="Room is private")

    if _is_room_member(room_id, user["id"]):
        return {"ok": True, "message": "Already a member"}

    member_count = _get_member_count(room_id)
    if member_count >= room["max_members"]:
        raise HTTPException(status_code=400, detail="Room is full")

    conn = get_db()
    conn.execute(
        "INSERT INTO chat_room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)",
        (room_id, user["id"], time.time())
    )
    conn.commit()

    return {"ok": True}


@router.post("/{room_id}/leave")
async def leave_room(room_id: str, request: Request):
    """Leave a chat room."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if not _is_room_member(room_id, user["id"]):
        raise HTTPException(status_code=400, detail="Not a member")

    conn = get_db()
    conn.execute(
        "DELETE FROM chat_room_members WHERE room_id = ? AND user_id = ?",
        (room_id, user["id"])
    )
    conn.commit()

    return {"ok": True}


@router.delete("/{room_id}")
async def delete_room(room_id: str, request: Request):
    """Delete a chat room (creator only)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    room = _get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room["created_by"] != user["id"]:
        raise HTTPException(status_code=403, detail="Only the creator can delete this room")

    conn = get_db()
    conn.execute("DELETE FROM chat_messages WHERE room_id = ?", (room_id,))
    conn.execute("DELETE FROM chat_room_members WHERE room_id = ?", (room_id,))
    conn.execute("DELETE FROM chat_rooms WHERE id = ?", (room_id,))
    conn.commit()

    return {"ok": True}


@router.get("/{room_id}/messages")
async def get_messages(room_id: str, request: Request, limit: int = 50, before: Optional[float] = None):
    """Get messages for a chat room."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if not _is_room_member(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Not a member of this room")

    conn = get_db()
    if before:
        rows = conn.execute(
            "SELECT id, room_id, user_id, content, created_at FROM chat_messages WHERE room_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
            (room_id, before, min(limit, 100))
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, room_id, user_id, content, created_at FROM chat_messages WHERE room_id = ? ORDER BY created_at DESC LIMIT ?",
            (room_id, min(limit, 100))
        ).fetchall()

    messages = []
    for row in rows:
        user_info = _get_user_info(row["user_id"])
        messages.append({
            "id": row["id"],
            "room_id": row["room_id"],
            "user_id": row["user_id"],
            "username": user_info["username"],
            "avatar_url": user_info["avatar_url"],
            "content": row["content"],
            "created_at": row["created_at"],
        })

    # Return in chronological order
    messages.reverse()
    return {"messages": messages}


@router.post("/{room_id}/messages")
async def send_message(room_id: str, body: SendMessageBody, request: Request):
    """Send a message to a chat room."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if not _is_room_member(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Not a member of this room")

    conn = get_db()
    msg_id = _generate_id()
    now = time.time()

    conn.execute(
        "INSERT INTO chat_messages (id, room_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)",
        (msg_id, room_id, user["id"], body.content.strip(), now)
    )
    conn.commit()

    user_info = _get_user_info(user["id"])
    return {
        "ok": True,
        "message": {
            "id": msg_id,
            "room_id": room_id,
            "user_id": user["id"],
            "username": user_info["username"],
            "avatar_url": user_info["avatar_url"],
            "content": body.content.strip(),
            "created_at": now,
        }
    }


@router.delete("/{room_id}/messages/{msg_id}")
async def delete_message(room_id: str, msg_id: str, request: Request):
    """Delete a message (author or room creator)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = get_db()
    msg = conn.execute(
        "SELECT user_id FROM chat_messages WHERE id = ? AND room_id = ?",
        (msg_id, room_id)
    ).fetchone()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    room = _get_room(room_id)
    is_author = str(msg["user_id"]) == str(user["id"])
    is_creator = room and str(room["created_by"]) == str(user["id"])

    if not is_author and not is_creator:
        raise HTTPException(status_code=403, detail="Cannot delete this message")

    conn.execute("DELETE FROM chat_messages WHERE id = ?", (msg_id,))
    conn.commit()

    return {"ok": True}
