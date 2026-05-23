"""
User key-value store operations (exam history, flashcards, tags, progress, etc.).
"""
import time
import logging
from .connection import get_db

logger = logging.getLogger("database")


def db_kv_get(user_id: int, data_key: str):
    """Get a value from user KV store."""
    conn = get_db()
    row = conn.execute(
        "SELECT data_value FROM user_kv_store WHERE user_id = ? AND data_key = ?",
        (user_id, data_key)
    ).fetchone()
    conn.close()
    return row["data_value"] if row else None

def db_kv_set(user_id: int, data_key: str, data_value: str):
    """Set a value in user KV store."""
    conn = get_db()
    conn.execute("""
        INSERT INTO user_kv_store (user_id, data_key, data_value, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, data_key) DO UPDATE SET data_value = ?, updated_at = ?
    """, (user_id, data_key, data_value, int(time.time()*1000), data_value, int(time.time()*1000)))
    conn.commit()
    conn.close()

def db_kv_get_all(user_id: int):
    """Get all KV pairs for a user."""
    conn = get_db()
    rows = conn.execute(
        "SELECT data_key, data_value FROM user_kv_store WHERE user_id = ?",
        (user_id,)
    ).fetchall()
    conn.close()
    return {r["data_key"]: r["data_value"] for r in rows}

def db_kv_delete(user_id: int, data_key: str):
    """Delete a key from user KV store."""
    conn = get_db()
    conn.execute("DELETE FROM user_kv_store WHERE user_id = ? AND data_key = ?", (user_id, data_key))
    conn.commit()
    conn.close()
