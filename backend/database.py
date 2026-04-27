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
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=10000")
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

        CREATE TABLE IF NOT EXISTS users (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            email        TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL DEFAULT '',
            password_hash TEXT NOT NULL,
            avatar_color TEXT DEFAULT '#8b5cf6',
            created_at   INTEGER NOT NULL,
            updated_at   INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    """)
    # Ensure gamification row exists
    conn.execute(
        "INSERT OR IGNORE INTO gamification (id, data_json, updated_at) VALUES (1, '{}', ?)",
        (int(time.time() * 1000),)
    )

    # ── Migration: add user_id columns to support per-user data ──
    _migrate_add_user_id(conn)

    conn.commit()
    conn.close()
    print(f"[DB] Initialized at {DB_PATH}")


def _migrate_add_user_id(conn):
    """Safely add user_id columns to existing tables (idempotent)."""
    tables_to_migrate = {
        "history": "user_id INTEGER DEFAULT NULL",
        "notes": "user_id INTEGER DEFAULT NULL",
        "bookmarks": "user_id INTEGER DEFAULT NULL",
    }
    for table, col_def in tables_to_migrate.items():
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col_def}")
            print(f"[DB Migration] Added user_id to {table}")
        except sqlite3.OperationalError:
            pass  # Column already exists

    # Fix notes table: need composite PK (video_id, user_id) instead of just video_id
    _migrate_notes_composite_pk(conn)

    # Create per-user gamification table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS user_gamification (
            user_id    INTEGER NOT NULL,
            data_json  TEXT NOT NULL DEFAULT '{}',
            updated_at INTEGER,
            PRIMARY KEY (user_id)
        )
    """)

    # Generic key-value store for per-user data (exam history, flashcards, tags, etc.)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS user_kv_store (
            user_id    INTEGER NOT NULL,
            data_key   TEXT NOT NULL,
            data_value TEXT NOT NULL DEFAULT '',
            updated_at INTEGER,
            PRIMARY KEY (user_id, data_key)
        )
    """)

    # Indexes for user_id
    for table in ["history", "notes", "bookmarks"]:
        try:
            conn.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_user ON {table}(user_id)")
        except:
            pass


def _migrate_notes_composite_pk(conn):
    """Recreate notes table so multiple users can have notes for the same video."""
    # Check current schema
    info = conn.execute("PRAGMA table_info(notes)").fetchall()
    pk_cols = [r[1] for r in info if r[5] > 0]  # r[5] is pk flag
    # If only video_id is PK (old schema), we need to recreate
    if len(pk_cols) == 1 and pk_cols[0] == 'video_id':
        print("[DB Migration] Recreating notes table with user-aware unique constraint")
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS notes_new (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                video_id   TEXT NOT NULL,
                content    TEXT NOT NULL DEFAULT '',
                updated_at INTEGER,
                user_id    INTEGER DEFAULT NULL
            );
            INSERT OR IGNORE INTO notes_new (video_id, content, updated_at, user_id)
                SELECT video_id, content, updated_at, user_id FROM notes;
            DROP TABLE IF EXISTS notes;
            ALTER TABLE notes_new RENAME TO notes;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_video_user
                ON notes (video_id, COALESCE(user_id, 0));
        """)
        print("[DB Migration] Notes table recreated successfully")



# ══════════════════════════════════════════
# HISTORY
# ══════════════════════════════════════════
def db_get_history(limit=50, user_id=None):
    conn = get_db()
    if user_id:
        rows = conn.execute(
            "SELECT * FROM history WHERE user_id = ? ORDER BY saved_at DESC LIMIT ?", (user_id, limit)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM history WHERE user_id IS NULL ORDER BY saved_at DESC LIMIT ?", (limit,)
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

def db_save_history(entry: dict, user_id=None):
    conn = get_db()
    entry_id = entry.get("entry_id", f"{entry.get('video_id', 'unknown')}_{int(time.time()*1000)}")
    data_json = json.dumps(entry.get("data", {}), ensure_ascii=False)
    transcript = entry.get("transcript") or (entry.get("data", {}).get("transcript"))
    transcript_json = json.dumps(transcript, ensure_ascii=False) if transcript else None

    conn.execute("""
        INSERT OR REPLACE INTO history (entry_id, video_id, url, title, author, thumbnail, saved_at, lang, data_json, transcript_json, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        user_id,
    ))
    conn.commit()
    conn.close()
    return entry_id

def db_delete_history(entry_id: str, user_id=None):
    conn = get_db()
    if user_id:
        conn.execute("DELETE FROM history WHERE entry_id = ? AND user_id = ?", (entry_id, user_id))
    else:
        conn.execute("DELETE FROM history WHERE entry_id = ?", (entry_id,))
    conn.commit()
    conn.close()

def db_clear_history(user_id=None):
    conn = get_db()
    if user_id:
        conn.execute("DELETE FROM history WHERE user_id = ?", (user_id,))
    else:
        conn.execute("DELETE FROM history WHERE user_id IS NULL")
    conn.commit()
    conn.close()

# ══════════════════════════════════════════
# NOTES
# ══════════════════════════════════════════
def db_get_notes(video_id: str, user_id=None):
    conn = get_db()
    if user_id:
        row = conn.execute("SELECT content FROM notes WHERE video_id = ? AND user_id = ?", (video_id, user_id)).fetchone()
    else:
        row = conn.execute("SELECT content FROM notes WHERE video_id = ? AND user_id IS NULL", (video_id,)).fetchone()
    conn.close()
    return row["content"] if row else ""

def db_save_notes(video_id: str, content: str, user_id=None):
    conn = get_db()
    # Composite PK is (video_id, COALESCE(user_id, 0)), so we can use upsert
    existing = conn.execute(
        "SELECT 1 FROM notes WHERE video_id = ? AND COALESCE(user_id, 0) = ?",
        (video_id, user_id or 0)
    ).fetchone()
    if existing:
        if user_id:
            conn.execute("UPDATE notes SET content = ?, updated_at = ? WHERE video_id = ? AND user_id = ?",
                         (content, int(time.time() * 1000), video_id, user_id))
        else:
            conn.execute("UPDATE notes SET content = ?, updated_at = ? WHERE video_id = ? AND user_id IS NULL",
                         (content, int(time.time() * 1000), video_id))
    else:
        conn.execute("INSERT INTO notes (video_id, content, updated_at, user_id) VALUES (?, ?, ?, ?)",
                     (video_id, content, int(time.time() * 1000), user_id))
    conn.commit()
    conn.close()

def db_get_all_notes(user_id=None):
    """Get all notes for a user. Returns dict {video_id: content}."""
    conn = get_db()
    if user_id:
        rows = conn.execute("SELECT video_id, content FROM notes WHERE user_id = ?", (user_id,)).fetchall()
    else:
        rows = conn.execute("SELECT video_id, content FROM notes WHERE user_id IS NULL").fetchall()
    conn.close()
    return {r["video_id"]: r["content"] for r in rows if r["content"]}

# ══════════════════════════════════════════
# BOOKMARKS
# ══════════════════════════════════════════
def db_get_bookmarks(video_id: str, user_id=None):
    conn = get_db()
    if user_id:
        rows = conn.execute(
            "SELECT * FROM bookmarks WHERE video_id = ? AND user_id = ? ORDER BY time_secs ASC", (video_id, user_id)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM bookmarks WHERE video_id = ? AND user_id IS NULL ORDER BY time_secs ASC", (video_id,)
        ).fetchall()
    conn.close()
    return [{"id": r["id"], "time": r["time_secs"], "label": r["label"], "createdAt": r["created_at"]} for r in rows]

def db_save_bookmark(video_id: str, time_secs: int, label: str, created_at: str = None, user_id=None):
    conn = get_db()
    conn.execute("""
        INSERT INTO bookmarks (video_id, time_secs, label, created_at, user_id)
        VALUES (?, ?, ?, ?, ?)
    """, (video_id, time_secs, label, created_at or "", user_id))
    conn.commit()
    conn.close()

def db_delete_bookmark(bookmark_id: int):
    conn = get_db()
    conn.execute("DELETE FROM bookmarks WHERE id = ?", (bookmark_id,))
    conn.commit()
    conn.close()

def db_sync_bookmarks(video_id: str, bookmarks: list, user_id=None):
    """Replace all bookmarks for a video (for a specific user)."""
    conn = get_db()
    if user_id:
        conn.execute("DELETE FROM bookmarks WHERE video_id = ? AND user_id = ?", (video_id, user_id))
    else:
        conn.execute("DELETE FROM bookmarks WHERE video_id = ? AND user_id IS NULL", (video_id,))
    for bm in bookmarks:
        conn.execute("""
            INSERT INTO bookmarks (video_id, time_secs, label, created_at, user_id)
            VALUES (?, ?, ?, ?, ?)
        """, (video_id, bm.get("time", 0), bm.get("label", ""), bm.get("createdAt", ""), user_id))
    conn.commit()
    conn.close()

def db_get_all_bookmarks(user_id=None):
    """Get all bookmarks for a user grouped by video_id. Returns dict {video_id: [bookmarks]}."""
    conn = get_db()
    if user_id:
        rows = conn.execute(
            "SELECT * FROM bookmarks WHERE user_id = ? ORDER BY video_id, time_secs ASC", (user_id,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM bookmarks WHERE user_id IS NULL ORDER BY video_id, time_secs ASC"
        ).fetchall()
    conn.close()
    result = {}
    for r in rows:
        vid = r["video_id"]
        if vid not in result:
            result[vid] = []
        result[vid].append({"time": r["time_secs"], "label": r["label"], "createdAt": r["created_at"]})
    return result

# ══════════════════════════════════════════
# GAMIFICATION
# ══════════════════════════════════════════
def db_get_gamification(user_id=None):
    conn = get_db()
    if user_id:
        row = conn.execute("SELECT data_json FROM user_gamification WHERE user_id = ?", (user_id,)).fetchone()
    else:
        row = conn.execute("SELECT data_json FROM gamification WHERE id = 1").fetchone()
    conn.close()
    if row:
        try:
            return json.loads(row["data_json"])
        except:
            return {}
    return {}

def db_save_gamification(data: dict, user_id=None):
    conn = get_db()
    now = int(time.time() * 1000)
    data_str = json.dumps(data, ensure_ascii=False)
    if user_id:
        conn.execute("""
            INSERT INTO user_gamification (user_id, data_json, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET data_json = ?, updated_at = ?
        """, (user_id, data_str, now, data_str, now))
    else:
        conn.execute("""
            UPDATE gamification SET data_json = ?, updated_at = ? WHERE id = 1
        """, (data_str, now))
    conn.commit()
    conn.close()

def db_migrate_anonymous_to_user(user_id: int):
    """Migrate anonymous (user_id IS NULL) data to a specific user.
    Called after first login to claim existing data."""
    conn = get_db()
    now = int(time.time() * 1000)

    # Move anonymous history to user
    conn.execute("UPDATE history SET user_id = ? WHERE user_id IS NULL", (user_id,))

    # Move anonymous notes to user
    conn.execute("UPDATE notes SET user_id = ? WHERE user_id IS NULL", (user_id,))

    # Move anonymous bookmarks to user
    conn.execute("UPDATE bookmarks SET user_id = ? WHERE user_id IS NULL", (user_id,))

    # Move anonymous gamification to user
    anon_gamif = conn.execute("SELECT data_json FROM gamification WHERE id = 1").fetchone()
    if anon_gamif:
        try:
            data = json.loads(anon_gamif["data_json"])
            if data:  # Only if there's actual data
                conn.execute("""
                    INSERT INTO user_gamification (user_id, data_json, updated_at) VALUES (?, ?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET data_json = ?, updated_at = ?
                """, (user_id, anon_gamif["data_json"], now, anon_gamif["data_json"], now))
                # Reset anonymous gamification
                conn.execute("UPDATE gamification SET data_json = '{}', updated_at = ? WHERE id = 1", (now,))
        except:
            pass

    conn.commit()
    conn.close()
    print(f"[DB] Migrated anonymous data to user {user_id}")


# ══════════════════════════════════════════
# FULL SYNC (single connection to avoid locking)
# ══════════════════════════════════════════
def db_full_sync(user_id, local_history, local_notes, local_bookmarks, local_gamif, extra_data):
    """Perform full sync in a SINGLE connection to avoid 'database is locked' errors."""
    conn = get_db()
    try:
        # 1. Save history
        for entry in local_history:
            try:
                entry_id = entry.get("entry_id", f"{entry.get('video_id', 'unknown')}_{int(time.time()*1000)}")
                data_json = json.dumps(entry.get("data", {}), ensure_ascii=False)
                transcript = entry.get("transcript") or (entry.get("data", {}).get("transcript"))
                transcript_json = json.dumps(transcript, ensure_ascii=False) if transcript else None
                conn.execute("""
                    INSERT OR REPLACE INTO history (entry_id, video_id, url, title, author, thumbnail, saved_at, lang, data_json, transcript_json, user_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (entry_id, entry.get("video_id",""), entry.get("url",""), entry.get("title",""),
                      entry.get("author",""), entry.get("thumbnail",""), entry.get("savedAt", int(time.time()*1000)),
                      entry.get("lang","en"), data_json, transcript_json, user_id))
            except Exception as e:
                print(f"[Sync] Skip history: {e}")

        # 2. Save notes
        for video_id, content in local_notes.items():
            if not content:
                continue
            try:
                uid_val = user_id or 0
                existing = conn.execute(
                    "SELECT 1 FROM notes WHERE video_id = ? AND COALESCE(user_id, 0) = ?",
                    (video_id, uid_val)
                ).fetchone()
                if existing:
                    if user_id:
                        conn.execute("UPDATE notes SET content=?, updated_at=? WHERE video_id=? AND user_id=?",
                                     (content, int(time.time()*1000), video_id, user_id))
                    else:
                        conn.execute("UPDATE notes SET content=?, updated_at=? WHERE video_id=? AND user_id IS NULL",
                                     (content, int(time.time()*1000), video_id))
                else:
                    conn.execute("INSERT INTO notes (video_id, content, updated_at, user_id) VALUES (?,?,?,?)",
                                 (video_id, content, int(time.time()*1000), user_id))
            except Exception as e:
                print(f"[Sync] Skip note {video_id}: {e}")

        # 3. Save bookmarks
        for video_id, bms in local_bookmarks.items():
            if not bms:
                continue
            try:
                if user_id:
                    conn.execute("DELETE FROM bookmarks WHERE video_id=? AND user_id=?", (video_id, user_id))
                else:
                    conn.execute("DELETE FROM bookmarks WHERE video_id=? AND user_id IS NULL", (video_id,))
                for bm in bms:
                    conn.execute("INSERT INTO bookmarks (video_id, time_secs, label, created_at, user_id) VALUES (?,?,?,?,?)",
                                 (video_id, bm.get("time",0), bm.get("label",""), bm.get("createdAt",""), user_id))
            except Exception as e:
                print(f"[Sync] Skip bookmarks {video_id}: {e}")

        # 4. Save gamification (merge)
        if local_gamif:
            try:
                if user_id:
                    row = conn.execute("SELECT data_json FROM user_gamification WHERE user_id=?", (user_id,)).fetchone()
                else:
                    row = conn.execute("SELECT data_json FROM gamification WHERE id=1").fetchone()
                existing = json.loads(row["data_json"]) if row else {}
                merged = {}
                for key in set(list(existing.keys()) + list(local_gamif.keys())):
                    ev, lv = existing.get(key), local_gamif.get(key)
                    if isinstance(ev, (int, float)) and isinstance(lv, (int, float)):
                        merged[key] = max(ev, lv)
                    elif isinstance(ev, list) and isinstance(lv, list):
                        merged[key] = list(set(ev + lv))
                    else:
                        merged[key] = lv if lv is not None else ev
                now = int(time.time()*1000)
                data_str = json.dumps(merged, ensure_ascii=False)
                if user_id:
                    conn.execute("""INSERT INTO user_gamification (user_id, data_json, updated_at) VALUES (?,?,?)
                        ON CONFLICT(user_id) DO UPDATE SET data_json=?, updated_at=?""",
                        (user_id, data_str, now, data_str, now))
                else:
                    conn.execute("UPDATE gamification SET data_json=?, updated_at=? WHERE id=1", (data_str, now))
            except Exception as e:
                print(f"[Sync] Gamification error: {e}")

        # 5. Save extra data (KV store)
        if user_id and extra_data:
            for ekey, evalue in extra_data.items():
                if evalue and evalue not in ('', '{}', '[]'):
                    try:
                        now = int(time.time()*1000)
                        conn.execute("""INSERT INTO user_kv_store (user_id, data_key, data_value, updated_at) VALUES (?,?,?,?)
                            ON CONFLICT(user_id, data_key) DO UPDATE SET data_value=?, updated_at=?""",
                            (user_id, ekey, evalue, now, evalue, now))
                    except Exception as e:
                        print(f"[Sync] Skip extra {ekey}: {e}")

        conn.commit()

        # 6. Read back all data for response
        # History
        if user_id:
            rows = conn.execute("SELECT * FROM history WHERE user_id=? ORDER BY saved_at DESC LIMIT 100", (user_id,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM history WHERE user_id IS NULL ORDER BY saved_at DESC LIMIT 100").fetchall()
        result_history = []
        for r in rows:
            entry = {"entry_id": r["entry_id"], "video_id": r["video_id"], "url": r["url"],
                     "title": r["title"], "author": r["author"], "thumbnail": r["thumbnail"],
                     "savedAt": r["saved_at"], "lang": r["lang"]}
            try: entry["data"] = json.loads(r["data_json"]) if r["data_json"] else {}
            except: entry["data"] = {}
            try: entry["transcript"] = json.loads(r["transcript_json"]) if r["transcript_json"] else None
            except: entry["transcript"] = None
            result_history.append(entry)

        # Gamification
        if user_id:
            row = conn.execute("SELECT data_json FROM user_gamification WHERE user_id=?", (user_id,)).fetchone()
        else:
            row = conn.execute("SELECT data_json FROM gamification WHERE id=1").fetchone()
        result_gamif = json.loads(row["data_json"]) if row else {}

        # Notes
        if user_id:
            nrows = conn.execute("SELECT video_id, content FROM notes WHERE user_id=?", (user_id,)).fetchall()
        else:
            nrows = conn.execute("SELECT video_id, content FROM notes WHERE user_id IS NULL").fetchall()
        result_notes = {r["video_id"]: r["content"] for r in nrows if r["content"]}

        # Bookmarks
        if user_id:
            brows = conn.execute("SELECT * FROM bookmarks WHERE user_id=? ORDER BY video_id, time_secs", (user_id,)).fetchall()
        else:
            brows = conn.execute("SELECT * FROM bookmarks WHERE user_id IS NULL ORDER BY video_id, time_secs").fetchall()
        result_bookmarks = {}
        for r in brows:
            vid = r["video_id"]
            if vid not in result_bookmarks: result_bookmarks[vid] = []
            result_bookmarks[vid].append({"time": r["time_secs"], "label": r["label"], "createdAt": r["created_at"]})

        # Extra data
        result_extra = {}
        if user_id:
            erows = conn.execute("SELECT data_key, data_value FROM user_kv_store WHERE user_id=?", (user_id,)).fetchall()
            result_extra = {r["data_key"]: r["data_value"] for r in erows}

        print(f"[Sync] OK: {len(result_history)} hist, {len(result_notes)} notes, {len(result_bookmarks)} bm, {len(result_extra)} extra for user {user_id}")
        return {
            "ok": True,
            "history": result_history,
            "gamification": result_gamif,
            "notes": result_notes,
            "bookmarks": result_bookmarks,
            "extra_data": result_extra
        }
    except Exception as e:
        print(f"[Sync] Fatal error: {e}")
        return {"ok": False, "error": str(e), "history": [], "gamification": {}, "notes": {}, "bookmarks": {}, "extra_data": {}}
    finally:
        conn.close()


# ══════════════════════════════════════════
# USER KEY-VALUE STORE (exam history, flashcards, tags, progress, etc.)
# ══════════════════════════════════════════
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


# ══════════════════════════════════════════
# USERS (Authentication)
# ══════════════════════════════════════════
def db_create_user(email: str, display_name: str, password_hash: str, avatar_color: str = '#8b5cf6'):
    """Create a new user. Returns the user id."""
    conn = get_db()
    now = int(time.time() * 1000)
    try:
        cur = conn.execute("""
            INSERT INTO users (email, display_name, password_hash, avatar_color, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (email.lower().strip(), display_name.strip(), password_hash, avatar_color, now, now))
        conn.commit()
        user_id = cur.lastrowid
    except sqlite3.IntegrityError:
        conn.close()
        return None  # Email already exists
    conn.close()
    return user_id

def db_get_user_by_email(email: str):
    """Find a user by email. Returns dict or None."""
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE email = ?", (email.lower().strip(),)).fetchone()
    conn.close()
    if not row:
        return None
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row["display_name"],
        "password_hash": row["password_hash"],
        "avatar_color": row["avatar_color"],
        "created_at": row["created_at"],
    }

def db_get_user_by_id(user_id: int):
    """Find a user by ID. Returns dict or None."""
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    if not row:
        return None
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row["display_name"],
        "avatar_color": row["avatar_color"],
        "created_at": row["created_at"],
    }

def db_update_user(user_id: int, display_name: str = None, avatar_color: str = None, password_hash: str = None):
    """Update user profile fields."""
    conn = get_db()
    fields = []
    values = []
    if display_name is not None:
        fields.append("display_name = ?")
        values.append(display_name.strip())
    if avatar_color is not None:
        fields.append("avatar_color = ?")
        values.append(avatar_color)
    if password_hash is not None:
        fields.append("password_hash = ?")
        values.append(password_hash)
    if not fields:
        conn.close()
        return
    fields.append("updated_at = ?")
    values.append(int(time.time() * 1000))
    values.append(user_id)
    conn.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()
    conn.close()

