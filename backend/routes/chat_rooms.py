"""
Chat Rooms — standalone real-time chat system.
Users can create/join chat rooms and message each other.
"""

import os
import time
import logging
import secrets

from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from pydantic import BaseModel, Field
from typing import Optional

from database import get_db
from routes.auth import get_current_user
from routes.notifications import create_notification

router = APIRouter(prefix="/api/chat-rooms", tags=["chat-rooms"])
logger = logging.getLogger("chat-rooms")


# ═══════════════════════════════════════════════════════
# DATABASE INITIALIZATION
# ═══════════════════════════════════════════════════════

def _init_chat_rooms_tables():
    """Create chat room tables if they don't exist."""
    from database import USE_POSTGRES
    conn = get_db()

    # Drop old tables on PostgreSQL to ensure correct schema (ONLY first time)
    if USE_POSTGRES:
        # Only create if not exists - don't drop existing data
        tables = [
            """CREATE TABLE IF NOT EXISTS chat_rooms (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT DEFAULT '💬',
                created_by INTEGER NOT NULL, is_public INTEGER DEFAULT 1,
                max_members INTEGER DEFAULT 50, created_at REAL NOT NULL,
                chat_locked INTEGER DEFAULT 0, allowed_users TEXT DEFAULT ''
            )""",
            """CREATE TABLE IF NOT EXISTS chat_room_members (
                room_id TEXT NOT NULL, user_id INTEGER NOT NULL, joined_at REAL NOT NULL,
                role TEXT DEFAULT 'member', last_read_at REAL DEFAULT 0,
                notif_muted INTEGER DEFAULT 0, PRIMARY KEY (room_id, user_id)
            )""",
            """CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY, room_id TEXT NOT NULL, user_id INTEGER NOT NULL,
                content TEXT NOT NULL DEFAULT '', image_url TEXT DEFAULT '',
                pinned INTEGER DEFAULT 0, created_at REAL NOT NULL
            )""",
            "CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id, created_at)",
            "CREATE INDEX IF NOT EXISTS idx_chat_room_members_user ON chat_room_members(user_id)",
            """CREATE TABLE IF NOT EXISTS chat_room_bans (
                room_id TEXT NOT NULL, user_id INTEGER NOT NULL, banned_by INTEGER NOT NULL,
                reason TEXT DEFAULT '', banned_at REAL NOT NULL, PRIMARY KEY (room_id, user_id)
            )""",
            """CREATE TABLE IF NOT EXISTS chat_reports (
                id SERIAL PRIMARY KEY, room_id TEXT NOT NULL, msg_id TEXT NOT NULL,
                reported_by INTEGER NOT NULL, reason TEXT DEFAULT '',
                status TEXT DEFAULT 'pending', created_at REAL NOT NULL
            )""",
            "CREATE INDEX IF NOT EXISTS idx_chat_reports_room ON chat_reports(room_id, status)",
            """CREATE TABLE IF NOT EXISTS chat_room_mutes (
                room_id TEXT NOT NULL, user_id INTEGER NOT NULL, muted_by INTEGER NOT NULL,
                muted_until REAL NOT NULL, reason TEXT DEFAULT '',
                created_at REAL NOT NULL, PRIMARY KEY (room_id, user_id)
            )""",
        ]
        for sql in tables:
            try:
                conn.execute(sql, ())
            except Exception as e:
                logger.warning(f"Chat table create failed: {e}")
    else:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS chat_rooms (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT DEFAULT '💬',
                created_by INTEGER NOT NULL, is_public INTEGER DEFAULT 1,
                max_members INTEGER DEFAULT 50, created_at REAL NOT NULL,
                chat_locked INTEGER DEFAULT 0, allowed_users TEXT DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS chat_room_members (
                room_id TEXT NOT NULL, user_id INTEGER NOT NULL, joined_at REAL NOT NULL,
                role TEXT DEFAULT 'member', last_read_at REAL DEFAULT 0,
                notif_muted INTEGER DEFAULT 0, PRIMARY KEY (room_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY, room_id TEXT NOT NULL, user_id INTEGER NOT NULL,
                content TEXT NOT NULL DEFAULT '', image_url TEXT DEFAULT '',
                pinned INTEGER DEFAULT 0, created_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_chat_room_members_user ON chat_room_members(user_id);
            CREATE TABLE IF NOT EXISTS chat_room_bans (
                room_id TEXT NOT NULL, user_id INTEGER NOT NULL, banned_by INTEGER NOT NULL,
                reason TEXT DEFAULT '', banned_at REAL NOT NULL, PRIMARY KEY (room_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS chat_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL, msg_id TEXT NOT NULL,
                reported_by INTEGER NOT NULL, reason TEXT DEFAULT '',
                status TEXT DEFAULT 'pending', created_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_chat_reports_room ON chat_reports(room_id, status);
            CREATE TABLE IF NOT EXISTS chat_room_mutes (
                room_id TEXT NOT NULL, user_id INTEGER NOT NULL, muted_by INTEGER NOT NULL,
                muted_until REAL NOT NULL, reason TEXT DEFAULT '',
                created_at REAL NOT NULL, PRIMARY KEY (room_id, user_id)
            );
        """)
        conn.commit()
    conn.close()


# Initialize tables on module load
try:
    _init_chat_rooms_tables()
except Exception as e:
    logger.warning(f"Chat rooms table init deferred: {e}")


# ═══════════════════════════════════════════════════════
# ONLINE STATUS (in-memory)
# ═══════════════════════════════════════════════════════

_online_status = {}  # {room_id: {user_id: {"name": str, "ts": float}}}
_online_hidden = set()  # set of user_ids who hide their online status


# ═══════════════════════════════════════════════════════
# PYDANTIC MODELS
# ═══════════════════════════════════════════════════════

class CreateRoomBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    icon: str = Field(default="💬", max_length=10)
    is_public: bool = True
    max_members: int = Field(default=50, ge=2, le=200)


class SendMessageBody(BaseModel):
    content: str = Field(default='', max_length=2000)
    image_url: str = ''


# ═══════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════

def _generate_id():
    return secrets.token_hex(12)


def _get_user_info(user_id):
    """Get display_name and avatar_url for a user."""
    if str(user_id) == '__system__':
        return {"username": "", "avatar_url": None, "avatar_color": "#8b5cf6"}
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
    keys = row.keys()
    return {
        "id": row["id"], "name": row["name"], "icon": row["icon"],
        "created_by": row["created_by"], "is_public": bool(row["is_public"]),
        "max_members": row["max_members"], "created_at": row["created_at"],
        "chat_locked": bool(row["chat_locked"]) if "chat_locked" in keys else False,
        "allowed_users": row["allowed_users"] if "allowed_users" in keys else "",
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


def _is_room_creator(room_id: str, user_id) -> bool:
    room = _get_room(room_id)
    return room and str(room["created_by"]) == str(user_id)


def _is_room_admin(room_id: str, user_id) -> bool:
    """Check if user is creator or has admin role."""
    if _is_room_creator(room_id, user_id):
        return True
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM chat_room_members WHERE room_id = ? AND user_id = ?",
        (room_id, user_id)
    ).fetchone()
    if not row:
        return False
    try:
        return row["role"] == 'admin'
    except (KeyError, IndexError):
        return False


def _is_banned(room_id: str, user_id) -> bool:
    conn = get_db()
    row = conn.execute(
        "SELECT 1 FROM chat_room_bans WHERE room_id = ? AND user_id = ?",
        (room_id, user_id)
    ).fetchone()
    return row is not None


def _is_muted(room_id: str, user_id):
    """Check if user is muted. Returns muted_until timestamp or None."""
    conn = get_db()
    row = conn.execute(
        "SELECT muted_until FROM chat_room_mutes WHERE room_id = ? AND user_id = ?",
        (room_id, user_id)
    ).fetchone()
    if not row:
        return None
    muted_until = row["muted_until"]
    if time.time() >= muted_until:
        # Mute expired — clean up
        conn.execute("DELETE FROM chat_room_mutes WHERE room_id = ? AND user_id = ?", (room_id, user_id))
        conn.commit()
        return None
    return muted_until


# ═══════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════

@router.post("")
async def create_room(body: CreateRoomBody, request: Request):
    """Create a new chat room."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
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
        conn.close()

        logger.info(f"Chat room created: {body.name} by user {user['id']}")
        return {"ok": True, "room_id": room_id}
    except Exception as e:
        logger.error(f"Create room error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("")
async def list_my_rooms(request: Request):
    """List rooms the current user is a member of."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = get_db()
    rows = conn.execute("""
        SELECT cr.id, cr.name, cr.icon, cr.created_by, cr.is_public, cr.max_members, cr.created_at,
               crm.last_read_at
        FROM chat_rooms cr
        JOIN chat_room_members crm ON cr.id = crm.room_id
        WHERE crm.user_id = ?
        ORDER BY cr.created_at DESC
    """, (user["id"],)).fetchall()

    if not rows:
        conn.close()
        return {"rooms": [], "total_unread": 0}

    # Batch: get member counts for all rooms in one query
    room_ids = [row["id"] for row in rows]
    member_counts = {}
    for rid in room_ids:
        mc = conn.execute("SELECT COUNT(*) as c FROM chat_room_members WHERE room_id = ?", (rid,)).fetchone()
        member_counts[rid] = mc["c"] if mc else 0

    # Batch: get last messages for all rooms
    last_messages = {}
    for rid in room_ids:
        lm = conn.execute(
            "SELECT content, user_id, created_at FROM chat_messages WHERE room_id = ? ORDER BY created_at DESC LIMIT 1",
            (rid,)
        ).fetchone()
        if lm:
            last_messages[rid] = {"content": lm["content"], "user_id": lm["user_id"], "created_at": lm["created_at"]}

    # Batch: get creator info for all unique creators
    creator_ids = list(set(row["created_by"] for row in rows))
    creator_infos = {}
    for cid in creator_ids:
        u = conn.execute("SELECT display_name, avatar_url, avatar_color FROM users WHERE id = ?", (cid,)).fetchone()
        if u:
            creator_infos[cid] = u["display_name"] or "User"
        else:
            creator_infos[cid] = "Unknown"

    # Get usernames for last message senders
    sender_ids = list(set(lm["user_id"] for lm in last_messages.values() if lm.get("user_id")))
    sender_names = {}
    for sid in sender_ids:
        u = conn.execute("SELECT display_name FROM users WHERE id = ?", (sid,)).fetchone()
        sender_names[sid] = u["display_name"] if u else "Unknown"

    total_unread = 0
    rooms = []
    for row in rows:
        room_id = row["id"]
        last_read = row["last_read_at"] if "last_read_at" in row.keys() else 0
        # Count unread using same connection
        unread_row = conn.execute(
            "SELECT COUNT(*) as c FROM chat_messages WHERE room_id = ? AND created_at > ? AND user_id != ?",
            (room_id, last_read or 0, user["id"])
        ).fetchone()
        unread = unread_row["c"] if unread_row else 0
        total_unread += unread

        lm = last_messages.get(room_id)
        last_msg = None
        if lm:
            last_msg = {"content": lm["content"], "username": sender_names.get(lm["user_id"], ""), "created_at": lm["created_at"]}

        rooms.append({
            "id": room_id, "name": row["name"], "icon": row["icon"],
            "created_by": row["created_by"], "is_public": bool(row["is_public"]),
            "max_members": row["max_members"], "created_at": row["created_at"],
            "member_count": member_counts.get(room_id, 0),
            "last_message": last_msg,
            "unread": unread,
            "creator_name": creator_infos.get(row["created_by"], "Unknown"),
        })

    conn.close()
    return {"rooms": rooms, "total_unread": total_unread}


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
        mc = conn.execute("SELECT COUNT(*) as c FROM chat_room_members WHERE room_id = ?", (room_id,)).fetchone()
        member_count = mc["c"] if mc else 0
        is_member_row = conn.execute("SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?", (room_id, user["id"])).fetchone()
        is_member = is_member_row is not None
        creator = conn.execute("SELECT display_name FROM users WHERE id = ?", (row["created_by"],)).fetchone()
        creator_name = creator["display_name"] if creator else "Unknown"
        lm = conn.execute("SELECT content, user_id, created_at FROM chat_messages WHERE room_id = ? ORDER BY created_at DESC LIMIT 1", (room_id,)).fetchone()
        last_msg = None
        if lm:
            sender = conn.execute("SELECT display_name FROM users WHERE id = ?", (lm["user_id"],)).fetchone()
            last_msg = {"content": lm["content"], "username": sender["display_name"] if sender else "", "created_at": lm["created_at"]}

        rooms.append({
            "id": room_id, "name": row["name"], "icon": row["icon"],
            "created_by": row["created_by"], "is_public": True,
            "max_members": row["max_members"], "created_at": row["created_at"],
            "member_count": member_count,
            "is_member": is_member,
            "creator_name": creator_name,
            "last_message": last_msg,
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

    # Check if banned
    if _is_banned(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Bạn đã bị chặn khỏi phòng này")

    if _is_room_member(room_id, user["id"]):
        return {"ok": True, "message": "Already a member"}

    member_count = _get_member_count(room_id)
    if member_count >= room["max_members"]:
        raise HTTPException(status_code=400, detail="Room is full")

    conn = get_db()
    now = time.time()
    conn.execute(
        "INSERT INTO chat_room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)",
        (room_id, user["id"], now)
    )
    # System message: user joined
    display_name = user.get("display_name", "Ai đó")
    msg_id = _generate_id()
    conn.execute(
        "INSERT INTO chat_messages (id, room_id, user_id, content, image_url, created_at) VALUES (?, ?, ?, ?, '', ?)",
        (msg_id, room_id, '__system__', f'👋 {display_name} đã tham gia phòng', now)
    )
    conn.commit()

    return {"ok": True}


@router.post("/{room_id}/leave")
async def leave_room(room_id: str, request: Request):
    """Leave a chat room. Creator must transfer ownership first."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if not _is_room_member(room_id, user["id"]):
        raise HTTPException(status_code=400, detail="Not a member")

    # Creator cannot leave — must transfer ownership or delete room
    if _is_room_creator(room_id, user["id"]):
        raise HTTPException(status_code=400, detail="Chủ phòng không thể rời. Hãy chuyển quyền chủ phòng hoặc xóa phòng.")

    conn = get_db()
    now = time.time()
    conn.execute(
        "DELETE FROM chat_room_members WHERE room_id = ? AND user_id = ?",
        (room_id, user["id"])
    )
    # System message
    display_name = user.get("display_name", "Ai đó")
    msg_id = _generate_id()
    conn.execute(
        "INSERT INTO chat_messages (id, room_id, user_id, content, image_url, created_at) VALUES (?, ?, ?, ?, '', ?)",
        (msg_id, room_id, '__system__', f'🚪 {display_name} đã rời phòng', now)
    )
    conn.commit()

    return {"ok": True}


@router.post("/{room_id}/transfer/{new_owner_id}")
async def transfer_ownership(room_id: str, new_owner_id: int, request: Request):
    """Transfer room ownership to another member (creator only)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not _is_room_creator(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Chỉ chủ phòng mới có thể chuyển quyền")
    if str(new_owner_id) == str(user["id"]):
        raise HTTPException(status_code=400, detail="Không thể chuyển cho chính mình")

    # Check new owner is a member
    if not _is_room_member(room_id, new_owner_id):
        raise HTTPException(status_code=400, detail="Người này không phải thành viên")

    conn = get_db()
    conn.execute("UPDATE chat_rooms SET created_by = ? WHERE id = ?", (new_owner_id, room_id))

    # System message
    room = _get_room(room_id)
    old_name = user.get("display_name", "Ai đó")
    new_info = _get_user_info(new_owner_id)
    now = time.time()
    msg_id = _generate_id()
    conn.execute(
        "INSERT INTO chat_messages (id, room_id, user_id, content, image_url, created_at) VALUES (?, ?, ?, ?, '', ?)",
        (msg_id, room_id, '__system__', f'👑 {old_name} đã chuyển quyền chủ phòng cho {new_info["username"]}', now)
    )
    conn.commit()

    # Notify new owner
    room_name = room["name"] if room else "phòng chat"
    create_notification(
        new_owner_id, "chat_transfer",
        f"👑 Bạn đã trở thành chủ phòng \"{room_name}\"",
        f"{old_name} đã chuyển quyền chủ phòng cho bạn",
        "/chat"
    )

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
            "SELECT id, room_id, user_id, content, image_url, pinned, created_at FROM chat_messages WHERE room_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
            (room_id, before, min(limit, 100))
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, room_id, user_id, content, image_url, pinned, created_at FROM chat_messages WHERE room_id = ? ORDER BY created_at DESC LIMIT ?",
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
            "image_url": row["image_url"] if "image_url" in row.keys() else "",
            "pinned": bool(row["pinned"]) if "pinned" in row.keys() else False,
            "created_at": row["created_at"],
        })

    # Return in chronological order
    messages.reverse()

    # Include mute status and room owner for current user
    muted_until = _is_muted(room_id, user["id"])
    room = _get_room(room_id)
    # Get unread info
    member_row = conn.execute(
        "SELECT last_read_at, notif_muted FROM chat_room_members WHERE room_id = ? AND user_id = ?",
        (room_id, user["id"])
    ).fetchone()
    last_read = member_row["last_read_at"] if member_row and "last_read_at" in member_row.keys() else 0
    notif_muted = bool(member_row["notif_muted"]) if member_row and "notif_muted" in member_row.keys() else False

    return {
        "messages": messages,
        "muted_until": muted_until,
        "created_by": room["created_by"] if room else None,
        "chat_locked": room.get("chat_locked", False) if room else False,
        "last_read_at": last_read or 0,
        "notif_muted": notif_muted,
    }


# ═══════════════════════════════════════════════════════
# TYPING INDICATOR (in-memory, ephemeral)
# ═══════════════════════════════════════════════════════

_typing_status = {}  # {room_id: {user_id: {"name": str, "ts": float}}}


@router.post("/{room_id}/typing")
async def set_typing(room_id: str, request: Request):
    """Signal that user is typing."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if room_id not in _typing_status:
        _typing_status[room_id] = {}
    _typing_status[room_id][str(user["id"])] = {
        "name": user.get("display_name", "User"),
        "ts": time.time()
    }
    return {"ok": True}


@router.get("/{room_id}/typing")
async def get_typing(room_id: str, request: Request):
    """Get who is currently typing (within last 4 seconds)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    now = time.time()
    typers = []
    room_typing = _typing_status.get(room_id, {})
    expired = []
    for uid, info in room_typing.items():
        if now - info["ts"] > 4:
            expired.append(uid)
        elif uid != str(user["id"]):
            typers.append(info["name"])
    # Clean expired
    for uid in expired:
        del room_typing[uid]

    return {"typing": typers}


# ═══════════════════════════════════════════════════════
# ONLINE STATUS
# ═══════════════════════════════════════════════════════

@router.post("/{room_id}/heartbeat")
async def heartbeat(room_id: str, request: Request):
    """Send heartbeat to mark user as online in this room."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    uid = str(user["id"])
    if uid in _online_hidden:
        return {"ok": True}

    if room_id not in _online_status:
        _online_status[room_id] = {}
    _online_status[room_id][uid] = {
        "name": user.get("display_name", "User"),
        "ts": time.time()
    }
    return {"ok": True}


@router.get("/{room_id}/online")
async def get_online(room_id: str, request: Request):
    """Get list of online users in this room (active within 15s)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    uid = str(user["id"])
    is_hidden = uid in _online_hidden

    # If user is hidden, they can't see who's online
    if is_hidden:
        return {"online": [], "online_ids": [], "count": 0, "my_hidden": True}

    now = time.time()
    room_online = _online_status.get(room_id, {})
    online = []
    online_ids = []
    expired = []
    for u_id, info in room_online.items():
        if now - info["ts"] > 15:
            expired.append(u_id)
        else:
            online.append({"user_id": u_id, "name": info["name"]})
            online_ids.append(u_id)
    for u_id in expired:
        del room_online[u_id]

    return {"online": online, "online_ids": online_ids, "count": len(online), "my_hidden": False}


@router.post("/toggle-online-visibility")
async def toggle_online_visibility(request: Request):
    """Toggle whether the user appears online or hidden."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    uid = str(user["id"])
    if uid in _online_hidden:
        _online_hidden.discard(uid)
        return {"ok": True, "hidden": False}
    else:
        _online_hidden.add(uid)
        # Remove from all rooms
        for room_data in _online_status.values():
            room_data.pop(uid, None)
        return {"ok": True, "hidden": True}


# ═══════════════════════════════════════════════════════
# READ STATUS & NOTIFICATIONS MUTE
# ═══════════════════════════════════════════════════════

@router.post("/{room_id}/mark-read")
async def mark_read(room_id: str, request: Request):
    """Mark all messages as read (update last_read_at to now)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = get_db()
    conn.execute(
        "UPDATE chat_room_members SET last_read_at = ? WHERE room_id = ? AND user_id = ?",
        (time.time(), room_id, user["id"])
    )
    conn.commit()
    return {"ok": True}


@router.get("/{room_id}/unread")
async def get_unread_count(room_id: str, request: Request):
    """Get number of unread messages for current user."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = get_db()
    member = conn.execute(
        "SELECT last_read_at FROM chat_room_members WHERE room_id = ? AND user_id = ?",
        (room_id, user["id"])
    ).fetchone()
    if not member:
        return {"unread": 0}

    last_read = member["last_read_at"] if "last_read_at" in member.keys() else 0

    count = conn.execute(
        "SELECT COUNT(*) as c FROM chat_messages WHERE room_id = ? AND created_at > ? AND user_id != ?",
        (room_id, last_read or 0, user["id"])
    ).fetchone()["c"]

    return {"unread": count, "last_read_at": last_read}


@router.post("/{room_id}/toggle-notifications")
async def toggle_notifications(room_id: str, request: Request):
    """Toggle notification mute for this room."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    conn = get_db()
    row = conn.execute(
        "SELECT notif_muted FROM chat_room_members WHERE room_id = ? AND user_id = ?",
        (room_id, user["id"])
    ).fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="Not a member")

    current = row["notif_muted"] if "notif_muted" in row.keys() else 0
    new_val = 0 if current else 1
    conn.execute(
        "UPDATE chat_room_members SET notif_muted = ? WHERE room_id = ? AND user_id = ?",
        (new_val, room_id, user["id"])
    )
    conn.commit()
    return {"ok": True, "muted": bool(new_val)}


# ═══════════════════════════════════════════════════════
# LOCK CHAT (only allowed users can send)
# ═══════════════════════════════════════════════════════

class LockChatBody(BaseModel):
    locked: bool = True
    allowed_user_ids: list = []  # list of user_ids allowed to chat when locked


@router.post("/{room_id}/lock-chat")
async def lock_chat(room_id: str, body: LockChatBody, request: Request):
    """Lock/unlock chat. When locked, only creator and allowed users can send."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not _is_room_creator(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Chỉ chủ phòng mới có thể khóa chat")

    conn = get_db()
    allowed_str = ','.join(str(uid) for uid in body.allowed_user_ids)
    conn.execute(
        "UPDATE chat_rooms SET chat_locked = ?, allowed_users = ? WHERE id = ?",
        (int(body.locked), allowed_str, room_id)
    )
    conn.commit()

    # System message
    msg_id = _generate_id()
    now = time.time()
    if body.locked:
        sys_content = '🔒 Chủ phòng đã khóa chat'
    else:
        sys_content = '🔓 Chủ phòng đã mở khóa chat'
    conn.execute(
        "INSERT INTO chat_messages (id, room_id, user_id, content, image_url, created_at) VALUES (?, ?, ?, ?, '', ?)",
        (msg_id, room_id, '__system__', sys_content, now)
    )
    conn.commit()

    return {"ok": True, "locked": body.locked}


@router.post("/{room_id}/messages")
async def send_message(room_id: str, body: SendMessageBody, request: Request):
    """Send a message to a chat room."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if not body.content.strip() and not body.image_url.strip():
        raise HTTPException(status_code=400, detail="Message must have content or image")

    if not _is_room_member(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Not a member of this room")

    # Check if muted
    muted_until = _is_muted(room_id, user["id"])
    if muted_until:
        import datetime
        remaining = int(muted_until - time.time())
        if remaining > 3600:
            time_str = f"{remaining // 3600} giờ {(remaining % 3600) // 60} phút"
        elif remaining > 60:
            time_str = f"{remaining // 60} phút"
        else:
            time_str = f"{remaining} giây"
        raise HTTPException(status_code=403, detail=f"Bạn đã bị cấm chat. Còn {time_str} nữa.")

    # Check if chat is locked
    room = _get_room(room_id)
    if room and room.get("chat_locked"):
        uid_str = str(user["id"])
        is_creator = str(room["created_by"]) == uid_str
        allowed_str = room.get("allowed_users", "") or ""
        allowed_list = [x.strip() for x in allowed_str.split(',') if x.strip()]
        if not is_creator and uid_str not in allowed_list:
            raise HTTPException(status_code=403, detail="🔒 Chat đang bị khóa. Chỉ chủ phòng và người được chỉ định mới có thể nhắn.")

    conn = get_db()
    msg_id = _generate_id()
    now = time.time()

    conn.execute(
        "INSERT INTO chat_messages (id, room_id, user_id, content, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (msg_id, room_id, user["id"], body.content.strip(), body.image_url.strip(), now)
    )
    conn.commit()

    # Clear typing status after sending
    room_typing = _typing_status.get(room_id, {})
    room_typing.pop(str(user["id"]), None)

    # Detect @mentions and notify
    import re
    mentions = re.findall(r'@(\S+)', body.content)
    if mentions:
        # Find mentioned users by display_name
        sender_name = user.get("display_name", "Ai đó")
        room = _get_room(room_id)
        room_name = room["name"] if room else "phòng chat"
        members = conn.execute(
            "SELECT u.id as user_id, u.display_name FROM users u JOIN chat_room_members crm ON u.id = crm.user_id WHERE crm.room_id = ?",
            (room_id,)
        ).fetchall()
        for member in members:
            member_name = (member["display_name"] or "").lower()
            for mention in mentions:
                if mention.lower() == member_name.lower() or mention.lower() in member_name.lower():
                    if str(member["user_id"]) != str(user["id"]):
                        create_notification(
                            member["user_id"], "chat_mention",
                            f"💬 {sender_name} đã nhắc đến bạn",
                            body.content[:100],
                            "/chat/" + room_id + "#msg_" + msg_id
                        )
                        break

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
            "image_url": body.image_url.strip(),
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
    is_admin = _is_room_admin(room_id, user["id"])

    if not is_author and not is_admin:
        raise HTTPException(status_code=403, detail="Cannot delete this message")

    conn.execute("DELETE FROM chat_messages WHERE id = ?", (msg_id,))
    conn.commit()

    return {"ok": True}


# ═══════════════════════════════════════════════════════
# ROOM ADMIN: KICK, BAN, MEMBERS, PIN, EDIT
# ═══════════════════════════════════════════════════════

@router.post("/{room_id}/kick/{target_user_id}")
async def kick_member(room_id: str, target_user_id: int, request: Request, delete_messages: bool = False):
    """Kick a member from the chat room (creator/admin)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not _is_room_admin(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Chỉ chủ phòng hoặc quản trị viên mới có thể kick")
    if str(target_user_id) == str(user["id"]):
        raise HTTPException(status_code=400, detail="Không thể kick chính mình")

    # Check target is still a member
    if not _is_room_member(room_id, target_user_id):
        raise HTTPException(status_code=400, detail="Người này không còn trong phòng")

    conn = get_db()
    # Get target name for system message
    target_info = _get_user_info(target_user_id)
    now = time.time()

    conn.execute("DELETE FROM chat_room_members WHERE room_id = ? AND user_id = ?", (room_id, target_user_id))
    if delete_messages:
        conn.execute("DELETE FROM chat_messages WHERE room_id = ? AND user_id = ?", (room_id, target_user_id))
    # System message
    sys_msg_id = _generate_id()
    conn.execute(
        "INSERT INTO chat_messages (id, room_id, user_id, content, image_url, created_at) VALUES (?, ?, ?, ?, '', ?)",
        (sys_msg_id, room_id, '__system__', f'⛔ {target_info["username"]} đã bị kick', now)
    )
    conn.commit()
    return {"ok": True}


@router.post("/{room_id}/ban/{target_user_id}")
async def ban_member(room_id: str, target_user_id: int, request: Request, delete_messages: bool = False):
    """Ban a user from the chat room (creator/admin). Removes them and prevents rejoin."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not _is_room_admin(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Chỉ chủ phòng hoặc quản trị viên mới có thể chặn")
    if str(target_user_id) == str(user["id"]):
        raise HTTPException(status_code=400, detail="Không thể chặn chính mình")

    conn = get_db()
    target_info = _get_user_info(target_user_id)
    now = time.time()

    conn.execute("DELETE FROM chat_room_members WHERE room_id = ? AND user_id = ?", (room_id, target_user_id))
    conn.execute(
        "INSERT OR REPLACE INTO chat_room_bans (room_id, user_id, banned_by, reason, banned_at) VALUES (?, ?, ?, '', ?)",
        (room_id, target_user_id, user["id"], now)
    )
    if delete_messages:
        conn.execute("DELETE FROM chat_messages WHERE room_id = ? AND user_id = ?", (room_id, target_user_id))
    # System message
    sys_msg_id = _generate_id()
    conn.execute(
        "INSERT INTO chat_messages (id, room_id, user_id, content, image_url, created_at) VALUES (?, ?, ?, ?, '', ?)",
        (sys_msg_id, room_id, '__system__', f'🚫 {target_info["username"]} đã bị chặn', now)
    )
    conn.commit()
    return {"ok": True}


@router.post("/{room_id}/unban/{target_user_id}")
async def unban_member(room_id: str, target_user_id: int, request: Request):
    """Unban a user (creator only)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not _is_room_admin(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Chỉ chủ phòng hoặc quản trị viên mới có thể bỏ chặn")

    conn = get_db()
    conn.execute("DELETE FROM chat_room_bans WHERE room_id = ? AND user_id = ?", (room_id, target_user_id))
    conn.commit()
    return {"ok": True}


class MuteBody(BaseModel):
    duration: str = '1h'  # '1h', '6h', '1d', '3d', '7d'


@router.post("/{room_id}/mute/{target_user_id}")
async def mute_member(room_id: str, target_user_id: int, request: Request, body: MuteBody = MuteBody()):
    """Mute a member for a duration (admin/creator)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not _is_room_admin(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Chỉ quản trị viên mới có thể cấm chat")
    if str(target_user_id) == str(user["id"]):
        raise HTTPException(status_code=400, detail="Không thể tự cấm chat")

    # Parse duration
    durations = {'1h': 3600, '6h': 21600, '1d': 86400, '3d': 259200, '7d': 604800}
    seconds = durations.get(body.duration, 3600)
    muted_until = time.time() + seconds

    conn = get_db()
    conn.execute(
        "INSERT OR REPLACE INTO chat_room_mutes (room_id, user_id, muted_by, muted_until, reason, created_at) VALUES (?, ?, ?, ?, '', ?)",
        (room_id, target_user_id, user["id"], muted_until, time.time())
    )
    conn.commit()

    duration_labels = {'1h': '1 giờ', '6h': '6 giờ', '1d': '1 ngày', '3d': '3 ngày', '7d': '7 ngày'}
    return {"ok": True, "duration": duration_labels.get(body.duration, '1 giờ'), "muted_until": muted_until}


@router.post("/{room_id}/unmute/{target_user_id}")
async def unmute_member(room_id: str, target_user_id: int, request: Request):
    """Unmute a member (admin/creator)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not _is_room_admin(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Chỉ quản trị viên mới có thể bỏ cấm chat")

    conn = get_db()
    conn.execute("DELETE FROM chat_room_mutes WHERE room_id = ? AND user_id = ?", (room_id, target_user_id))
    conn.commit()
    return {"ok": True}


@router.get("/{room_id}/members")
async def get_members(room_id: str, request: Request):
    """Get list of room members."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not _is_room_member(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Not a member")

    conn = get_db()
    rows = conn.execute("""
        SELECT crm.user_id, crm.joined_at, crm.role, u.display_name, u.avatar_url, u.avatar_color
        FROM chat_room_members crm
        JOIN users u ON crm.user_id = u.id
        WHERE crm.room_id = ?
        ORDER BY crm.joined_at ASC
    """, (room_id,)).fetchall()

    room = _get_room(room_id)
    members = []
    for r in rows:
        members.append({
            "user_id": r["user_id"],
            "display_name": r["display_name"] or "User",
            "avatar_url": r["avatar_url"] or "",
            "avatar_color": r["avatar_color"] or "#8b5cf6",
            "joined_at": r["joined_at"],
            "role": r["role"] if "role" in r.keys() else "member",
            "is_creator": str(r["user_id"]) == str(room["created_by"]) if room else False,
            "muted_until": _is_muted(room_id, r["user_id"]),
        })

    # Also get banned list (for creator)
    banned = []
    if room and str(room["created_by"]) == str(user["id"]):
        ban_rows = conn.execute("""
            SELECT crb.user_id, crb.banned_at, u.display_name
            FROM chat_room_bans crb
            LEFT JOIN users u ON crb.user_id = u.id
            WHERE crb.room_id = ?
        """, (room_id,)).fetchall()
        for br in ban_rows:
            banned.append({
                "user_id": br["user_id"],
                "display_name": br["display_name"] or "User",
                "banned_at": br["banned_at"],
            })

    return {"members": members, "banned": banned}


@router.post("/{room_id}/pin/{msg_id}")
async def pin_message(room_id: str, msg_id: str, request: Request):
    """Pin/unpin a message. Members limited to 3 pins, creator unlimited."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not _is_room_admin(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Chỉ chủ phòng hoặc quản trị viên mới có thể ghim")

    conn = get_db()
    msg = conn.execute("SELECT pinned FROM chat_messages WHERE id = ? AND room_id = ?", (msg_id, room_id)).fetchone()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    new_val = 0 if msg["pinned"] else 1

    # Limit: non-creators can only pin up to 3 messages
    if new_val == 1 and not _is_room_creator(room_id, user["id"]):
        pin_count = conn.execute(
            "SELECT COUNT(*) as c FROM chat_messages WHERE room_id = ? AND pinned = 1", (room_id,)
        ).fetchone()["c"]
        if pin_count >= 3:
            raise HTTPException(status_code=400, detail="Tối đa 3 tin nhắn được ghim (chỉ chủ phòng mới ghim không giới hạn)")

    conn.execute("UPDATE chat_messages SET pinned = ? WHERE id = ?", (new_val, msg_id))
    conn.commit()
    return {"ok": True, "pinned": bool(new_val)}


@router.get("/{room_id}/pinned")
async def get_pinned_messages(room_id: str, request: Request):
    """Get pinned messages for a room."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not _is_room_member(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Not a member")

    conn = get_db()
    rows = conn.execute(
        "SELECT id, user_id, content, image_url, created_at FROM chat_messages WHERE room_id = ? AND pinned = 1 ORDER BY created_at DESC",
        (room_id,)
    ).fetchall()

    messages = []
    for row in rows:
        user_info = _get_user_info(row["user_id"])
        messages.append({
            "id": row["id"],
            "user_id": row["user_id"],
            "username": user_info["username"],
            "content": row["content"],
            "image_url": row["image_url"] if "image_url" in row.keys() else "",
            "created_at": row["created_at"],
        })
    return {"messages": messages}


class EditRoomBody(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    is_public: Optional[bool] = None
    max_members: Optional[int] = None


@router.put("/{room_id}")
async def edit_room(room_id: str, body: EditRoomBody, request: Request):
    """Edit room settings (creator only)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not _is_room_creator(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Chỉ chủ phòng mới có thể chỉnh sửa")

    conn = get_db()
    updates = []
    params = []
    if body.name is not None:
        updates.append("name = ?")
        params.append(body.name.strip()[:100])
    if body.icon is not None:
        updates.append("icon = ?")
        params.append(body.icon[:10])
    if body.is_public is not None:
        updates.append("is_public = ?")
        params.append(int(body.is_public))
    if body.max_members is not None:
        updates.append("max_members = ?")
        params.append(max(2, min(200, body.max_members)))

    if updates:
        params.append(room_id)
        conn.execute(f"UPDATE chat_rooms SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()

    return {"ok": True}


@router.post("/{room_id}/clear-messages")
async def clear_all_messages(room_id: str, request: Request):
    """Delete all messages in the room (creator only)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not _is_room_admin(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Chỉ chủ phòng hoặc quản trị viên mới có thể xóa tất cả")

    conn = get_db()
    conn.execute("DELETE FROM chat_messages WHERE room_id = ?", (room_id,))
    conn.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════
# PROMOTE / DEMOTE ADMIN
# ═══════════════════════════════════════════════════════

@router.post("/{room_id}/promote/{target_user_id}")
async def promote_to_admin(room_id: str, target_user_id: int, request: Request):
    """Promote a member to admin (creator only)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not _is_room_creator(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Chỉ chủ phòng mới có thể bổ nhiệm quản trị viên")
    if str(target_user_id) == str(user["id"]):
        raise HTTPException(status_code=400, detail="Không thể tự bổ nhiệm")

    conn = get_db()
    member = conn.execute(
        "SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?", (room_id, target_user_id)
    ).fetchone()
    if not member:
        raise HTTPException(status_code=404, detail="Người này không phải thành viên")

    conn.execute(
        "UPDATE chat_room_members SET role = 'admin' WHERE room_id = ? AND user_id = ?",
        (room_id, target_user_id)
    )
    conn.commit()
    return {"ok": True}


@router.post("/{room_id}/demote/{target_user_id}")
async def demote_from_admin(room_id: str, target_user_id: int, request: Request):
    """Demote an admin back to member (creator only)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not _is_room_creator(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Chỉ chủ phòng mới có thể hạ cấp quản trị viên")

    conn = get_db()
    conn.execute(
        "UPDATE chat_room_members SET role = 'member' WHERE room_id = ? AND user_id = ?",
        (room_id, target_user_id)
    )
    conn.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════
# REPORT MESSAGE
# ═══════════════════════════════════════════════════════

class ReportBody(BaseModel):
    reason: str = Field(default='', max_length=500)


@router.post("/{room_id}/report/{msg_id}")
async def report_message(room_id: str, msg_id: str, request: Request, body: ReportBody = ReportBody()):
    """Report a message to room admins/creator."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not _is_room_member(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Not a member")

    # Check message exists
    conn = get_db()
    msg = conn.execute("SELECT 1 FROM chat_messages WHERE id = ? AND room_id = ?", (msg_id, room_id)).fetchone()
    if not msg:
        raise HTTPException(status_code=404, detail="Tin nhắn không tồn tại")

    # Check not already reported by this user
    existing = conn.execute(
        "SELECT 1 FROM chat_reports WHERE room_id = ? AND msg_id = ? AND reported_by = ?",
        (room_id, msg_id, user["id"])
    ).fetchone()
    if existing:
        raise HTTPException(status_code=400, detail="Bạn đã báo cáo tin nhắn này rồi")

    conn.execute(
        "INSERT INTO chat_reports (room_id, msg_id, reported_by, reason, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
        (room_id, msg_id, user["id"], body.reason, time.time())
    )
    conn.commit()

    # Notify room creator and admins
    room = _get_room(room_id)
    if room:
        reporter_name = user.get("display_name", "Ai đó")
        # Notify creator
        creator_id = room["created_by"]
        if str(creator_id) != str(user["id"]):
            create_notification(
                int(creator_id) if str(creator_id).isdigit() else creator_id,
                "chat_report",
                f"⚠️ Báo cáo mới trong phòng \"{room['name']}\"",
                f"{reporter_name} đã báo cáo một tin nhắn" + (f": {body.reason}" if body.reason else ""),
                "/chat"
            )
        # Notify admins
        admin_rows = conn.execute(
            "SELECT user_id FROM chat_room_members WHERE room_id = ? AND role = 'admin'", (room_id,)
        ).fetchall()
        for ar in admin_rows:
            if str(ar["user_id"]) != str(user["id"]) and str(ar["user_id"]) != str(creator_id):
                create_notification(
                    ar["user_id"], "chat_report",
                    f"⚠️ Báo cáo mới trong phòng \"{room['name']}\"",
                    f"{reporter_name} đã báo cáo một tin nhắn",
                    "/chat"
                )

    return {"ok": True, "message": "Đã báo cáo tin nhắn"}


@router.get("/{room_id}/reports")
async def get_reports(room_id: str, request: Request):
    """Get pending reports (creator/admin only)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not _is_room_admin(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Chỉ quản trị viên mới xem được báo cáo")

    conn = get_db()
    rows = conn.execute("""
        SELECT cr.id, cr.msg_id, cr.reported_by, cr.reason, cr.created_at,
               cm.content as msg_content, cm.user_id as msg_author,
               u1.display_name as reporter_name,
               u2.display_name as author_name,
               crm.role as author_role
        FROM chat_reports cr
        LEFT JOIN chat_messages cm ON cr.msg_id = cm.id
        LEFT JOIN users u1 ON cr.reported_by = u1.id
        LEFT JOIN users u2 ON cm.user_id = u2.id
        LEFT JOIN chat_room_members crm ON crm.room_id = cr.room_id AND crm.user_id = cm.user_id
        WHERE cr.room_id = ? AND cr.status = 'pending'
        ORDER BY cr.created_at DESC
    """, (room_id,)).fetchall()

    room = _get_room(room_id)
    return {"reports": [{
        "id": r["id"],
        "msg_id": r["msg_id"],
        "reported_by": r["reported_by"],
        "reporter_name": r["reporter_name"] or "Unknown",
        "reason": r["reason"],
        "msg_content": r["msg_content"] or "(đã xóa)",
        "msg_author": r["msg_author"],
        "author_name": r["author_name"] or "Unknown",
        "author_is_creator": room and str(r["msg_author"]) == str(room["created_by"]),
        "author_is_admin": (r["author_role"] == 'admin') if r["author_role"] else False,
        "created_at": r["created_at"],
    } for r in rows]}


@router.post("/{room_id}/reports/{report_id}/dismiss")
async def dismiss_report(room_id: str, report_id: int, request: Request):
    """Dismiss a report (admin only)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not _is_room_admin(room_id, user["id"]):
        raise HTTPException(status_code=403, detail="Không có quyền")

    conn = get_db()
    conn.execute("UPDATE chat_reports SET status = 'dismissed' WHERE id = ? AND room_id = ?", (report_id, room_id))
    conn.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════
# IMAGE UPLOAD
# ═══════════════════════════════════════════════════════

_CHAT_UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads", "chat")
_MAX_IMAGE_SIZE = 5 * 1024 * 1024  # 5MB
_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


@router.post("/upload-image")
async def upload_chat_image(request: Request, file: UploadFile = File(...)):
    """Upload an image for chat. Returns the URL to use in messages."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Validate content type
    if file.content_type not in _ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Chỉ hỗ trợ JPEG, PNG, GIF, WebP")

    # Read and validate size
    data = await file.read()
    if len(data) > _MAX_IMAGE_SIZE:
        raise HTTPException(status_code=400, detail="Ảnh tối đa 5MB")

    # Ensure upload directory exists
    os.makedirs(_CHAT_UPLOAD_DIR, exist_ok=True)

    # Generate unique filename
    ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else 'jpg'
    if ext not in ('jpg', 'jpeg', 'png', 'gif', 'webp'):
        ext = 'jpg'
    filename = f"{secrets.token_hex(16)}.{ext}"
    filepath = os.path.join(_CHAT_UPLOAD_DIR, filename)

    # Save file
    with open(filepath, 'wb') as f:
        f.write(data)

    # Return URL (served as static file)
    image_url = f"/uploads/chat/{filename}"
    return {"ok": True, "image_url": image_url}
