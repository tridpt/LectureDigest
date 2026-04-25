"""
Database sync module for LectureDigest backend.
SQLite-based storage with REST API endpoints.
"""
import sqlite3
import os
import json
import time

DB_PATH = os.path.join(os.path.dirname(__file__), "lecturedb.sqlite3")

def get_db():
    """Get a database connection with row_factory."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init_db():
    """Create tables if they don't exist."""
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS history (
            entry_id   TEXT PRIMARY KEY,
            video_id   TEXT NOT NULL,
            url        TEXT,
            title      TEXT,
            author     TEXT,
            thumbnail  TEXT,
            saved_at   INTEGER,
            lang       TEXT,
            data_json  TEXT,
            transcript_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_history_video ON history(video_id);
        CREATE INDEX IF NOT EXISTS idx_history_saved ON history(saved_at DESC);

        CREATE TABLE IF NOT EXISTS notes (
            video_id   TEXT PRIMARY KEY,
            content    TEXT NOT NULL DEFAULT '',
            updated_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS bookmarks (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            video_id   TEXT NOT NULL,
            time_secs  INTEGER NOT NULL,
            label      TEXT,
            created_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_bm_video ON bookmarks(video_id);

        CREATE TABLE IF NOT EXISTS gamification (
            id         INTEGER PRIMARY KEY CHECK (id = 1),
            data_json  TEXT NOT NULL DEFAULT '{}',
            updated_at INTEGER
        );
    """)
    # Ensure gamification row exists
    conn.execute(
        "INSERT OR IGNORE INTO gamification (id, data_json, updated_at) VALUES (1, '{}', ?)",
        (int(time.time() * 1000),)
    )
    conn.commit()
    conn.close()
    print(f"[DB] Initialized at {DB_PATH}")

# ══════════════════════════════════════════
# HISTORY
# ══════════════════════════════════════════
def db_get_history(limit=50):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM history ORDER BY saved_at DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    result = []
    for r in rows:
        entry = {
            "entry_id": r["entry_id"],
            "video_id": r["video_id"],
            "url": r["url"],
            "title": r["title"],
            "author": r["author"],
            "thumbnail": r["thumbnail"],
            "savedAt": r["saved_at"],
            "lang": r["lang"],
        }
        try:
            entry["data"] = json.loads(r["data_json"]) if r["data_json"] else {}
        except:
            entry["data"] = {}
        try:
            entry["transcript"] = json.loads(r["transcript_json"]) if r["transcript_json"] else None
        except:
            entry["transcript"] = None
        result.append(entry)
    return result

def db_save_history(entry: dict):
    conn = get_db()
    entry_id = entry.get("entry_id", f"{entry.get('video_id', 'unknown')}_{int(time.time()*1000)}")
    data_json = json.dumps(entry.get("data", {}), ensure_ascii=False)
    transcript = entry.get("transcript") or (entry.get("data", {}).get("transcript"))
    transcript_json = json.dumps(transcript, ensure_ascii=False) if transcript else None

    conn.execute("""
        INSERT OR REPLACE INTO history (entry_id, video_id, url, title, author, thumbnail, saved_at, lang, data_json, transcript_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        entry_id,
        entry.get("video_id", ""),
        entry.get("url", ""),
        entry.get("title", ""),
        entry.get("author", ""),
        entry.get("thumbnail", ""),
        entry.get("savedAt", int(time.time() * 1000)),
        entry.get("lang", "en"),
        data_json,
        transcript_json,
    ))
    conn.commit()
    conn.close()
    return entry_id

def db_delete_history(entry_id: str):
    conn = get_db()
    conn.execute("DELETE FROM history WHERE entry_id = ?", (entry_id,))
    conn.commit()
    conn.close()

def db_clear_history():
    conn = get_db()
    conn.execute("DELETE FROM history")
    conn.commit()
    conn.close()

# ══════════════════════════════════════════
# NOTES
# ══════════════════════════════════════════
def db_get_notes(video_id: str):
    conn = get_db()
    row = conn.execute("SELECT content FROM notes WHERE video_id = ?", (video_id,)).fetchone()
    conn.close()
    return row["content"] if row else ""

def db_save_notes(video_id: str, content: str):
    conn = get_db()
    conn.execute("""
        INSERT OR REPLACE INTO notes (video_id, content, updated_at)
        VALUES (?, ?, ?)
    """, (video_id, content, int(time.time() * 1000)))
    conn.commit()
    conn.close()

# ══════════════════════════════════════════
# BOOKMARKS
# ══════════════════════════════════════════
def db_get_bookmarks(video_id: str):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM bookmarks WHERE video_id = ? ORDER BY time_secs ASC", (video_id,)
    ).fetchall()
    conn.close()
    return [{"id": r["id"], "time": r["time_secs"], "label": r["label"], "createdAt": r["created_at"]} for r in rows]

def db_save_bookmark(video_id: str, time_secs: int, label: str, created_at: str = None):
    conn = get_db()
    conn.execute("""
        INSERT INTO bookmarks (video_id, time_secs, label, created_at)
        VALUES (?, ?, ?, ?)
    """, (video_id, time_secs, label, created_at or ""))
    conn.commit()
    conn.close()

def db_delete_bookmark(bookmark_id: int):
    conn = get_db()
    conn.execute("DELETE FROM bookmarks WHERE id = ?", (bookmark_id,))
    conn.commit()
    conn.close()

def db_sync_bookmarks(video_id: str, bookmarks: list):
    """Replace all bookmarks for a video."""
    conn = get_db()
    conn.execute("DELETE FROM bookmarks WHERE video_id = ?", (video_id,))
    for bm in bookmarks:
        conn.execute("""
            INSERT INTO bookmarks (video_id, time_secs, label, created_at)
            VALUES (?, ?, ?, ?)
        """, (video_id, bm.get("time", 0), bm.get("label", ""), bm.get("createdAt", "")))
    conn.commit()
    conn.close()

# ══════════════════════════════════════════
# GAMIFICATION
# ══════════════════════════════════════════
def db_get_gamification():
    conn = get_db()
    row = conn.execute("SELECT data_json FROM gamification WHERE id = 1").fetchone()
    conn.close()
    if row:
        try:
            return json.loads(row["data_json"])
        except:
            return {}
    return {}

def db_save_gamification(data: dict):
    conn = get_db()
    conn.execute("""
        UPDATE gamification SET data_json = ?, updated_at = ? WHERE id = 1
    """, (json.dumps(data, ensure_ascii=False), int(time.time() * 1000)))
    conn.commit()
    conn.close()
