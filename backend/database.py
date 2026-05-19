"""
Database sync module for LectureDigest backend.
Dual-mode: SQLite (local dev) or PostgreSQL (production via DATABASE_URL).
"""
import sqlite3
import os
import json
import time
import logging

logger = logging.getLogger("database")

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
USE_POSTGRES = DATABASE_URL.startswith("postgresql://") or DATABASE_URL.startswith("postgres://")

DB_PATH = os.path.join(os.path.dirname(__file__), "lecturedb.sqlite3")


# ══════════════════════════════════════════
# DUAL-MODE CONNECTION WRAPPER
# ══════════════════════════════════════════

if USE_POSTGRES:
    import psycopg2
    import psycopg2.extras
    import psycopg2.pool

    # Use a connection pool to avoid exhausting Supabase connection limit
    _pg_pool = psycopg2.pool.SimpleConnectionPool(2, 20, DATABASE_URL, connect_timeout=10)

    class PgCursorWrapper:
        """Wraps a psycopg2 cursor to behave like sqlite3 cursor (dict access on rows)."""
        def __init__(self, cursor):
            self._cur = cursor
            self.lastrowid = None
            self.rowcount = 0

        def execute(self, sql, params=None):
            # Convert ? to %s
            sql = sql.replace("?", "%s")
            # Convert SQLite-specific INSERT syntax
            if "INSERT OR REPLACE INTO" in sql:
                sql = sql.replace("INSERT OR REPLACE INTO", "INSERT INTO")
            if "INSERT OR IGNORE INTO" in sql:
                sql = sql.replace("INSERT OR IGNORE INTO", "INSERT INTO")
                if "ON CONFLICT" not in sql:
                    sql = sql.rstrip().rstrip(";") + " ON CONFLICT DO NOTHING"
            try:
                self._cur.execute(sql, params or ())
            except Exception as e:
                # Rollback to clear aborted transaction state
                try:
                    self._cur.connection.rollback()
                except:
                    pass
                raise e
            self.lastrowid = None
            self.rowcount = self._cur.rowcount
            # Get lastrowid for INSERT statements
            if sql.strip().upper().startswith("INSERT") and self._cur.description is None:
                try:
                    # Try to get the last inserted id
                    self._cur.execute("SELECT lastval()")
                    row = self._cur.fetchone()
                    if row:
                        self.lastrowid = list(row.values())[0] if isinstance(row, dict) else row[0]
                except:
                    pass
            return self

        def fetchone(self):
            return self._cur.fetchone()

        def fetchall(self):
            return self._cur.fetchall()

        def close(self):
            self._cur.close()

    class PgConnectionWrapper:
        """Wraps psycopg2 connection to mimic sqlite3 connection API."""
        def __init__(self):
            self._conn = _pg_pool.getconn()
            self._conn.autocommit = True

        def execute(self, sql, params=None):
            cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            wrapper = PgCursorWrapper(cur)
            wrapper.execute(sql, params)
            return wrapper

        def executescript(self, sql):
            """Execute multiple SQL statements (for table creation)."""
            sql = sql.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")
            sql = sql.replace("AUTOINCREMENT", "")
            sql = sql.replace("INSERT OR IGNORE INTO", "INSERT INTO")
            sql = sql.replace("INSERT OR REPLACE INTO", "INSERT INTO")
            import re
            sql = re.sub(r'PRAGMA\s+[^;]+;?', '', sql)
            statements = [s.strip() for s in sql.split(';') if s.strip()]
            for stmt in statements:
                try:
                    cur = self._conn.cursor()
                    cur.execute(stmt)
                    cur.close()
                except Exception as e:
                    logger.warning("executescript FAILED: %s | SQL: %s", str(e)[:80], stmt[:60])

        def commit(self):
            pass  # autocommit mode

        def rollback(self):
            pass  # autocommit mode

        def close(self):
            try:
                _pg_pool.putconn(self._conn)
                self._conn = None
            except:
                pass

        def __del__(self):
            if self._conn is not None:
                try:
                    _pg_pool.putconn(self._conn)
                    self._conn = None
                except:
                    pass

    def get_db():
        """Get a PostgreSQL connection wrapped to behave like sqlite3."""
        return PgConnectionWrapper()

else:
    def get_db():
        """Get a SQLite connection with row_factory."""
        conn = sqlite3.connect(DB_PATH, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=10000")
        return conn

def init_db():
    """Create tables if they don't exist."""
    conn = get_db()
    if USE_POSTGRES:
        _init_db_postgres(conn)
    else:
        _init_db_sqlite(conn)
    conn.close()


def _init_db_postgres(conn):
    """Initialize PostgreSQL tables."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS history (
            entry_id   TEXT PRIMARY KEY,
            video_id   TEXT NOT NULL,
            url        TEXT,
            title      TEXT,
            author     TEXT,
            thumbnail  TEXT,
            saved_at   BIGINT,
            lang       TEXT,
            data_json  TEXT,
            transcript_json TEXT,
            user_id    INTEGER DEFAULT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_history_video ON history(video_id);
        CREATE INDEX IF NOT EXISTS idx_history_saved ON history(saved_at DESC);
        CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id);

        CREATE TABLE IF NOT EXISTS notes (
            id         SERIAL PRIMARY KEY,
            video_id   TEXT NOT NULL,
            content    TEXT NOT NULL DEFAULT '',
            updated_at BIGINT,
            user_id    INTEGER DEFAULT NULL
        );

        CREATE TABLE IF NOT EXISTS bookmarks (
            id         SERIAL PRIMARY KEY,
            video_id   TEXT NOT NULL,
            time_secs  INTEGER NOT NULL,
            label      TEXT,
            created_at TEXT,
            summary    TEXT DEFAULT '',
            user_id    INTEGER DEFAULT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_bm_video ON bookmarks(video_id);
        CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);

        CREATE TABLE IF NOT EXISTS gamification (
            id         INTEGER PRIMARY KEY DEFAULT 1,
            data_json  TEXT NOT NULL DEFAULT '{}',
            updated_at BIGINT
        );

        CREATE TABLE IF NOT EXISTS users (
            id           SERIAL PRIMARY KEY,
            email        TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL DEFAULT '',
            password_hash TEXT NOT NULL DEFAULT '',
            avatar_color TEXT DEFAULT '#8b5cf6',
            avatar_url   TEXT DEFAULT '',
            google_id    TEXT DEFAULT '',
            created_at   BIGINT NOT NULL,
            updated_at   BIGINT
        );
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_users_google ON users(google_id);

        CREATE TABLE IF NOT EXISTS shared_notes (
            share_id    TEXT PRIMARY KEY,
            video_id    TEXT NOT NULL,
            title       TEXT DEFAULT '',
            author      TEXT DEFAULT '',
            notes       TEXT DEFAULT '',
            bookmarks   TEXT DEFAULT '[]',
            overview    TEXT DEFAULT '',
            shared_by   TEXT DEFAULT '',
            created_at  BIGINT NOT NULL,
            view_count  INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS folders (
            id         SERIAL PRIMARY KEY,
            name       TEXT NOT NULL,
            icon       TEXT DEFAULT '📁',
            color      TEXT DEFAULT '#8b5cf6',
            user_id    INTEGER,
            position   INTEGER DEFAULT 0,
            created_at BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id);

        CREATE TABLE IF NOT EXISTS folder_videos (
            folder_id  INTEGER NOT NULL,
            video_id   TEXT NOT NULL,
            added_at   BIGINT NOT NULL,
            PRIMARY KEY (folder_id, video_id)
        );

        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            token      TEXT PRIMARY KEY,
            email      TEXT NOT NULL,
            created_at DOUBLE PRECISION NOT NULL,
            expires_at DOUBLE PRECISION NOT NULL
        );

        CREATE TABLE IF NOT EXISTS login_attempts (
            ip_or_email TEXT PRIMARY KEY,
            attempts    INTEGER DEFAULT 0,
            first_at    DOUBLE PRECISION NOT NULL,
            blocked_until DOUBLE PRECISION DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS analysis_cache (
            cache_key   TEXT PRIMARY KEY,
            video_id    TEXT NOT NULL,
            language    TEXT NOT NULL,
            result_json TEXT NOT NULL,
            created_at  BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cache_video_lang ON analysis_cache(video_id, language);

        CREATE TABLE IF NOT EXISTS user_gamification (
            user_id    INTEGER PRIMARY KEY,
            data_json  TEXT NOT NULL DEFAULT '{}',
            updated_at BIGINT
        );

        CREATE TABLE IF NOT EXISTS user_kv_store (
            user_id    INTEGER NOT NULL,
            data_key   TEXT NOT NULL,
            data_value TEXT NOT NULL DEFAULT '',
            updated_at BIGINT,
            PRIMARY KEY (user_id, data_key)
        );
    """)
    # Ensure gamification row
    try:
        cur = conn._conn.cursor()
        cur.execute("INSERT INTO gamification (id, data_json, updated_at) VALUES (1, '{}', %s) ON CONFLICT (id) DO NOTHING", (int(time.time() * 1000),))
        cur.close()
    except:
        pass
    conn.commit()
    logger.info("Database initialized (PostgreSQL)")


def _init_db_sqlite(conn):
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
            created_at TEXT,
            summary    TEXT DEFAULT ''
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
            password_hash TEXT NOT NULL DEFAULT '',
            avatar_color TEXT DEFAULT '#8b5cf6',
            avatar_url   TEXT DEFAULT '',
            google_id    TEXT DEFAULT '',
            created_at   INTEGER NOT NULL,
            updated_at   INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

        CREATE TABLE IF NOT EXISTS shared_notes (
            share_id    TEXT PRIMARY KEY,
            video_id    TEXT NOT NULL,
            title       TEXT DEFAULT '',
            author      TEXT DEFAULT '',
            notes       TEXT DEFAULT '',
            bookmarks   TEXT DEFAULT '[]',
            overview    TEXT DEFAULT '',
            shared_by   TEXT DEFAULT '',
            created_at  INTEGER NOT NULL,
            view_count  INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_shared_video ON shared_notes(video_id);

        CREATE TABLE IF NOT EXISTS folders (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            icon       TEXT DEFAULT '📁',
            color      TEXT DEFAULT '#8b5cf6',
            user_id    INTEGER,
            position   INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id);

        CREATE TABLE IF NOT EXISTS folder_videos (
            folder_id  INTEGER NOT NULL,
            video_id   TEXT NOT NULL,
            added_at   INTEGER NOT NULL,
            PRIMARY KEY (folder_id, video_id),
            FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_fv_video ON folder_videos(video_id);

        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            token      TEXT PRIMARY KEY,
            email      TEXT NOT NULL,
            created_at REAL NOT NULL,
            expires_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_reset_email ON password_reset_tokens(email);

        CREATE TABLE IF NOT EXISTS login_attempts (
            ip_or_email TEXT PRIMARY KEY,
            attempts    INTEGER DEFAULT 0,
            first_at    REAL NOT NULL,
            blocked_until REAL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS analysis_cache (
            cache_key   TEXT PRIMARY KEY,
            video_id    TEXT NOT NULL,
            language    TEXT NOT NULL,
            result_json TEXT NOT NULL,
            created_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cache_video_lang ON analysis_cache(video_id, language);
    """)
    # Ensure gamification row exists
    conn.execute(
        "INSERT OR IGNORE INTO gamification (id, data_json, updated_at) VALUES (1, '{}', ?)",
        (int(time.time() * 1000),)
    )

    # ── Migration: add user_id columns to support per-user data ──
    _migrate_add_user_id(conn)

    # Create Google index (after migration adds the column to existing DBs)
    try:
        conn.execute("CREATE INDEX IF NOT EXISTS idx_users_google ON users(google_id)")
    except:
        pass

    conn.commit()
    logger.info("Database initialized at %s", DB_PATH)


def _migrate_add_user_id(conn):
    """Safely add user_id columns to existing tables (idempotent)."""
    if USE_POSTGRES:
        return  # PostgreSQL schema already has all columns
    tables_to_migrate = {
        "history": "user_id INTEGER DEFAULT NULL",
        "notes": "user_id INTEGER DEFAULT NULL",
        "bookmarks": "user_id INTEGER DEFAULT NULL",
    }
    for table, col_def in tables_to_migrate.items():
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col_def}")
            logger.info("Migration: added user_id to %s", table)
        except Exception:
            pass  # Column already exists

    # Add Google OAuth columns to users table
    google_cols = {
        "google_id": "google_id TEXT DEFAULT ''",
        "avatar_url": "avatar_url TEXT DEFAULT ''",
    }
    for col_name, col_def in google_cols.items():
        try:
            conn.execute(f"ALTER TABLE users ADD COLUMN {col_def}")
            logger.info("Migration: added %s to users", col_name)
        except Exception:
            pass  # Column already exists

    # Add summary column to bookmarks table
    try:
        conn.execute("ALTER TABLE bookmarks ADD COLUMN summary TEXT DEFAULT ''")
        logger.info("Migration: added summary to bookmarks")
    except Exception:
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
    if USE_POSTGRES:
        return  # PostgreSQL schema is created correctly from the start
    # Check current schema
    info = conn.execute("PRAGMA table_info(notes)").fetchall()
    pk_cols = [r[1] for r in info if r[5] > 0]  # r[5] is pk flag
    # If only video_id is PK (old schema), we need to recreate
    if len(pk_cols) == 1 and pk_cols[0] == 'video_id':
        logger.info("Migration: recreating notes table with user-aware unique constraint")
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
        logger.info("Migration: notes table recreated successfully")



# ══════════════════════════════════════════
# HISTORY
# ══════════════════════════════════════════
def db_get_history(limit=50, user_id=None, before=None):
    """Get history with cursor-based pagination. `before` is a saved_at timestamp."""
    conn = get_db()
    if user_id:
        if before:
            rows = conn.execute(
                "SELECT * FROM history WHERE user_id = ? AND saved_at < ? ORDER BY saved_at DESC LIMIT ?",
                (user_id, before, limit + 1)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM history WHERE user_id = ? ORDER BY saved_at DESC LIMIT ?",
                (user_id, limit + 1)
            ).fetchall()
    else:
        if before:
            rows = conn.execute(
                "SELECT * FROM history WHERE user_id IS NULL AND saved_at < ? ORDER BY saved_at DESC LIMIT ?",
                (before, limit + 1)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM history WHERE user_id IS NULL ORDER BY saved_at DESC LIMIT ?",
                (limit + 1,)
            ).fetchall()
    conn.close()

    has_more = len(rows) > limit
    if has_more:
        rows = rows[:limit]

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

    next_cursor = result[-1]["savedAt"] if result and has_more else None
    return {"items": result, "has_more": has_more, "next_cursor": next_cursor}

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
    result = []
    for r in rows:
        bm = {"id": r["id"], "time": r["time_secs"], "label": r["label"], "createdAt": r["created_at"]}
        try:
            bm["summary"] = r["summary"] or ""
        except (IndexError, KeyError):
            bm["summary"] = ""
        result.append(bm)
    return result

def db_save_bookmark(video_id: str, time_secs: int, label: str, created_at: str = None, user_id=None, summary: str = ""):
    conn = get_db()
    conn.execute("""
        INSERT INTO bookmarks (video_id, time_secs, label, created_at, user_id, summary)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (video_id, time_secs, label, created_at or "", user_id, summary))
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
            INSERT INTO bookmarks (video_id, time_secs, label, created_at, user_id, summary)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (video_id, bm.get("time", 0), bm.get("label", ""), bm.get("createdAt", ""), user_id, bm.get("summary", "")))
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
        bm = {"time": r["time_secs"], "label": r["label"], "createdAt": r["created_at"]}
        try:
            bm["summary"] = r["summary"] or ""
        except (IndexError, KeyError):
            bm["summary"] = ""
        result[vid].append(bm)
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


def db_get_leaderboard(limit: int = 50):
    """Get leaderboard data: join users with their gamification stats."""
    conn = get_db()
    rows = conn.execute("""
        SELECT u.id, u.display_name, u.avatar_color, u.avatar_url,
               ug.data_json
        FROM users u
        JOIN user_gamification ug ON u.id = ug.user_id
        WHERE ug.data_json != '{}'
    """).fetchall()
    conn.close()

    entries = []
    for row in rows:
        try:
            g = json.loads(row["data_json"])
        except:
            g = {}

        total_videos = g.get("totalVideos", 0) or 0
        total_quizzes = g.get("totalQuizzes", 0) or 0
        current_streak = g.get("currentStreak", 0) or 0
        longest_streak = g.get("longestStreak", 0) or 0
        total_study_days = g.get("totalStudyDays", 0) or 0
        earned_badges = len(g.get("earnedBadges", []))
        pomo_sessions = g.get("pomoSessions", 0) or 0
        pomo_total_min = g.get("pomoTotalMin", 0) or 0

        # Composite score for ranking
        score = (
            total_videos * 10 +
            total_quizzes * 5 +
            current_streak * 8 +
            total_study_days * 3 +
            earned_badges * 15 +
            pomo_sessions * 4
        )

        if score <= 0:
            continue

        entries.append({
            "user_id": row["id"],
            "display_name": row["display_name"],
            "avatar_color": row["avatar_color"],
            "avatar_url": row["avatar_url"] or "",
            "total_videos": total_videos,
            "total_quizzes": total_quizzes,
            "current_streak": current_streak,
            "longest_streak": longest_streak,
            "total_study_days": total_study_days,
            "earned_badges": earned_badges,
            "pomo_sessions": pomo_sessions,
            "pomo_total_min": pomo_total_min,
            "score": score,
        })

    entries.sort(key=lambda x: x["score"], reverse=True)
    return entries[:limit]

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
    logger.info("Migrated anonymous data to user %d", user_id)


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
                logger.warning("Sync skip history: %s", e)

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
                logger.warning("Sync skip note %s: %s", video_id, e)

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
                    conn.execute("INSERT INTO bookmarks (video_id, time_secs, label, created_at, user_id, summary) VALUES (?,?,?,?,?,?)",
                                 (video_id, bm.get("time",0), bm.get("label",""), bm.get("createdAt",""), user_id, bm.get("summary","")))
            except Exception as e:
                logger.warning("Sync skip bookmarks %s: %s", video_id, e)

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
                logger.warning("Sync gamification error: %s", e)

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
                        logger.warning("Sync skip extra %s: %s", ekey, e)

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
            bm = {"time": r["time_secs"], "label": r["label"], "createdAt": r["created_at"]}
            try:
                bm["summary"] = r["summary"] or ""
            except (IndexError, KeyError):
                bm["summary"] = ""
            result_bookmarks[vid].append(bm)

        # Extra data
        result_extra = {}
        if user_id:
            erows = conn.execute("SELECT data_key, data_value FROM user_kv_store WHERE user_id=?", (user_id,)).fetchall()
            result_extra = {r["data_key"]: r["data_value"] for r in erows}

        logger.info("Sync OK: %d hist, %d notes, %d bm, %d extra for user %d", len(result_history), len(result_notes), len(result_bookmarks), len(result_extra), user_id)
        return {
            "ok": True,
            "history": result_history,
            "gamification": result_gamif,
            "notes": result_notes,
            "bookmarks": result_bookmarks,
            "extra_data": result_extra
        }
    except Exception as e:
        logger.error("Sync fatal error: %s", e)
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
def db_create_user(email: str, display_name: str, password_hash: str, avatar_color: str = '#8b5cf6', google_id: str = '', avatar_url: str = ''):
    """Create a new user. Returns the user id."""
    conn = get_db()
    now = int(time.time() * 1000)
    try:
        if USE_POSTGRES:
            cur = conn._conn.cursor()
            cur.execute("""
                INSERT INTO users (email, display_name, password_hash, avatar_color, google_id, avatar_url, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
            """, (email.lower().strip(), display_name.strip(), password_hash, avatar_color, google_id, avatar_url, now, now))
            row = cur.fetchone()
            user_id = row[0] if row else None
            conn.commit()
        else:
            cur = conn.execute("""
                INSERT INTO users (email, display_name, password_hash, avatar_color, google_id, avatar_url, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (email.lower().strip(), display_name.strip(), password_hash, avatar_color, google_id, avatar_url, now, now))
            conn.commit()
            user_id = cur.lastrowid
    except Exception:
        conn.close()
        return None  # Email already exists
    conn.close()
    return user_id

def db_get_user_by_google_id(google_id: str):
    """Find a user by Google ID. Returns dict or None."""
    if not google_id:
        return None
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE google_id = ? AND google_id != ''", (google_id,)).fetchone()
    conn.close()
    if not row:
        return None
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row["display_name"],
        "password_hash": row["password_hash"],
        "avatar_color": row["avatar_color"],
        "avatar_url": row["avatar_url"] if "avatar_url" in row.keys() else '',
        "google_id": row["google_id"] if "google_id" in row.keys() else '',
        "created_at": row["created_at"],
    }

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
        "avatar_url": row["avatar_url"] if "avatar_url" in row.keys() else '',
        "google_id": row["google_id"] if "google_id" in row.keys() else '',
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
        "avatar_url": row["avatar_url"] if "avatar_url" in row.keys() else '',
        "google_id": row["google_id"] if "google_id" in row.keys() else '',
        "created_at": row["created_at"],
    }

def db_update_user(user_id: int, display_name: str = None, avatar_color: str = None, password_hash: str = None, google_id: str = None, avatar_url: str = None):
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
    if google_id is not None:
        fields.append("google_id = ?")
        values.append(google_id)
    if avatar_url is not None:
        fields.append("avatar_url = ?")
        values.append(avatar_url)
    if not fields:
        conn.close()
        return
    fields.append("updated_at = ?")
    values.append(int(time.time() * 1000))
    values.append(user_id)
    conn.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()
    conn.close()


def db_delete_user(user_id: int):
    """Delete a user and ALL their data from every table. GDPR compliance."""
    conn = get_db()
    try:
        conn.execute("DELETE FROM history WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM notes WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM bookmarks WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM user_gamification WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM user_kv_store WHERE user_id = ?", (user_id,))
        # Delete folders and their video associations
        folder_ids = [r["id"] for r in conn.execute("SELECT id FROM folders WHERE user_id = ?", (user_id,)).fetchall()]
        for fid in folder_ids:
            conn.execute("DELETE FROM folder_videos WHERE folder_id = ?", (fid,))
        conn.execute("DELETE FROM folders WHERE user_id = ?", (user_id,))
        # Get email for reset token cleanup
        user_row = conn.execute("SELECT email FROM users WHERE id = ?", (user_id,)).fetchone()
        if user_row:
            email = user_row["email"]
            conn.execute("DELETE FROM password_reset_tokens WHERE email = ?", (email,))
            conn.execute("DELETE FROM login_attempts WHERE ip_or_email LIKE ?", (f"%{email}%",))
        # Finally delete the user
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()


def db_export_user_data(user_id: int) -> dict:
    """Export all user data as a dictionary. GDPR data portability."""
    conn = get_db()
    result = {}

    # User profile
    user_row = conn.execute("SELECT id, email, display_name, avatar_color, avatar_url, google_id, created_at FROM users WHERE id = ?", (user_id,)).fetchone()
    result["profile"] = dict(user_row) if user_row else {}

    # History
    rows = conn.execute("SELECT * FROM history WHERE user_id = ?", (user_id,)).fetchall()
    result["history"] = [dict(r) for r in rows]

    # Notes
    rows = conn.execute("SELECT * FROM notes WHERE user_id = ?", (user_id,)).fetchall()
    result["notes"] = [dict(r) for r in rows]

    # Bookmarks
    rows = conn.execute("SELECT * FROM bookmarks WHERE user_id = ?", (user_id,)).fetchall()
    result["bookmarks"] = [dict(r) for r in rows]

    # Gamification
    row = conn.execute("SELECT * FROM user_gamification WHERE user_id = ?", (user_id,)).fetchone()
    result["gamification"] = dict(row) if row else {}

    # KV store (SM2, custom cards, etc.)
    rows = conn.execute("SELECT * FROM user_kv_store WHERE user_id = ?", (user_id,)).fetchall()
    result["extra_data"] = [dict(r) for r in rows]

    # Folders
    rows = conn.execute("SELECT * FROM folders WHERE user_id = ?", (user_id,)).fetchall()
    result["folders"] = [dict(r) for r in rows]

    conn.close()
    return result


# ──────────────────────────────────────────
# SHARED NOTES
# ──────────────────────────────────────────
def db_create_shared_notes(share_id, video_id, title, author, notes, bookmarks_json, overview, shared_by):
    """Create a shared notes snapshot."""
    conn = get_db()
    conn.execute(
        """INSERT OR REPLACE INTO shared_notes
           (share_id, video_id, title, author, notes, bookmarks, overview, shared_by, created_at, view_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)""",
        (share_id, video_id, title, author, notes, bookmarks_json, overview, shared_by, int(time.time()))
    )
    conn.commit()
    conn.close()


def db_get_shared_notes(share_id):
    """Fetch a shared notes entry and increment view count."""
    conn = get_db()
    row = conn.execute("SELECT * FROM shared_notes WHERE share_id = ?", (share_id,)).fetchone()
    if row:
        conn.execute("UPDATE shared_notes SET view_count = view_count + 1 WHERE share_id = ?", (share_id,))
        conn.commit()
        result = dict(row)
    else:
        result = None
    conn.close()
    return result


# ══════════════════════════════════════════
# FOLDERS
# ══════════════════════════════════════════
def db_get_folders(user_id=None):
    """Get all folders for a user, ordered by position."""
    conn = get_db()
    if user_id:
        rows = conn.execute(
            "SELECT * FROM folders WHERE user_id = ? ORDER BY position ASC, created_at ASC",
            (user_id,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM folders WHERE user_id IS NULL ORDER BY position ASC, created_at ASC"
        ).fetchall()
    conn.close()

    result = []
    for r in rows:
        result.append({
            "id": r["id"],
            "name": r["name"],
            "icon": r["icon"],
            "color": r["color"],
            "position": r["position"],
            "created_at": r["created_at"],
        })
    return result


def db_create_folder(name: str, icon: str = '📁', color: str = '#8b5cf6', user_id=None):
    """Create a new folder. Returns the folder id."""
    conn = get_db()
    now = int(time.time() * 1000)
    # Get next position
    row = conn.execute(
        "SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM folders WHERE COALESCE(user_id, 0) = ?",
        (user_id or 0,)
    ).fetchone()
    pos = row["next_pos"] if row else 0
    cur = conn.execute(
        "INSERT INTO folders (name, icon, color, user_id, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (name.strip(), icon, color, user_id, pos, now)
    )
    conn.commit()
    folder_id = cur.lastrowid
    conn.close()
    return folder_id


def db_update_folder(folder_id: int, name: str = None, icon: str = None, color: str = None, user_id=None):
    """Update folder properties."""
    conn = get_db()
    fields, values = [], []
    if name is not None:
        fields.append("name = ?")
        values.append(name.strip())
    if icon is not None:
        fields.append("icon = ?")
        values.append(icon)
    if color is not None:
        fields.append("color = ?")
        values.append(color)
    if not fields:
        conn.close()
        return
    values.append(folder_id)
    where = "WHERE id = ?"
    if user_id:
        where += " AND user_id = ?"
        values.append(user_id)
    conn.execute(f"UPDATE folders SET {', '.join(fields)} {where}", values)
    conn.commit()
    conn.close()


def db_delete_folder(folder_id: int, user_id=None):
    """Delete a folder and its video associations."""
    conn = get_db()
    if user_id:
        conn.execute("DELETE FROM folders WHERE id = ? AND user_id = ?", (folder_id, user_id))
    else:
        conn.execute("DELETE FROM folders WHERE id = ? AND user_id IS NULL", (folder_id,))
    conn.execute("DELETE FROM folder_videos WHERE folder_id = ?", (folder_id,))
    conn.commit()
    conn.close()


def db_add_video_to_folder(folder_id: int, video_id: str):
    """Add a video to a folder."""
    conn = get_db()
    now = int(time.time() * 1000)
    conn.execute(
        "INSERT OR IGNORE INTO folder_videos (folder_id, video_id, added_at) VALUES (?, ?, ?)",
        (folder_id, video_id, now)
    )
    conn.commit()
    conn.close()


def db_remove_video_from_folder(folder_id: int, video_id: str):
    """Remove a video from a folder."""
    conn = get_db()
    conn.execute(
        "DELETE FROM folder_videos WHERE folder_id = ? AND video_id = ?",
        (folder_id, video_id)
    )
    conn.commit()
    conn.close()


def db_get_folder_videos(folder_id: int):
    """Get all video IDs in a folder."""
    conn = get_db()
    rows = conn.execute(
        "SELECT video_id FROM folder_videos WHERE folder_id = ? ORDER BY added_at DESC",
        (folder_id,)
    ).fetchall()
    conn.close()
    return [r["video_id"] for r in rows]


def db_get_video_folders(video_id: str, user_id=None):
    """Get all folder IDs a video belongs to."""
    conn = get_db()
    if user_id:
        rows = conn.execute(
            "SELECT f.id FROM folders f JOIN folder_videos fv ON f.id = fv.folder_id WHERE fv.video_id = ? AND f.user_id = ?",
            (video_id, user_id)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT f.id FROM folders f JOIN folder_videos fv ON f.id = fv.folder_id WHERE fv.video_id = ? AND f.user_id IS NULL",
            (video_id,)
        ).fetchall()
    conn.close()
    return [r["id"] for r in rows]


def db_get_all_folder_videos(user_id=None):
    """Get mapping of folder_id -> [video_ids] for all folders."""
    conn = get_db()
    if user_id:
        rows = conn.execute(
            "SELECT fv.folder_id, fv.video_id FROM folder_videos fv JOIN folders f ON f.id = fv.folder_id WHERE f.user_id = ?",
            (user_id,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT fv.folder_id, fv.video_id FROM folder_videos fv JOIN folders f ON f.id = fv.folder_id WHERE f.user_id IS NULL"
        ).fetchall()
    conn.close()
    result = {}
    for r in rows:
        fid = r["folder_id"]
        if fid not in result:
            result[fid] = []
        result[fid].append(r["video_id"])
    return result


# ══════════════════════════════════════════
# PASSWORD RESET TOKENS (persistent)
# ══════════════════════════════════════════
def db_save_reset_token(token: str, email: str, expires_at: float):
    """Save a password reset token to the database."""
    conn = get_db()
    conn.execute(
        "INSERT OR REPLACE INTO password_reset_tokens (token, email, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (token, email.lower().strip(), time.time(), expires_at)
    )
    conn.commit()
    conn.close()


def db_get_reset_token(token: str):
    """Get a reset token's data. Returns dict or None."""
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM password_reset_tokens WHERE token = ? AND expires_at > ?",
        (token, time.time())
    ).fetchone()
    conn.close()
    if not row:
        return None
    return {"token": row["token"], "email": row["email"], "created_at": row["created_at"], "expires_at": row["expires_at"]}


def db_delete_reset_token(token: str):
    """Delete a specific reset token."""
    conn = get_db()
    conn.execute("DELETE FROM password_reset_tokens WHERE token = ?", (token,))
    conn.commit()
    conn.close()


def db_delete_reset_tokens_for_email(email: str):
    """Delete all reset tokens for an email."""
    conn = get_db()
    conn.execute("DELETE FROM password_reset_tokens WHERE email = ?", (email.lower().strip(),))
    conn.commit()
    conn.close()


def db_cleanup_expired_tokens():
    """Remove all expired reset tokens."""
    conn = get_db()
    conn.execute("DELETE FROM password_reset_tokens WHERE expires_at < ?", (time.time(),))
    conn.commit()
    conn.close()


# ══════════════════════════════════════════
# LOGIN RATE LIMITING (persistent)
# ══════════════════════════════════════════
def db_check_rate_limit(key: str, max_attempts: int = 5, window_secs: int = 300, block_secs: int = 900):
    """Check if a key (IP or email) is rate-limited.
    Returns (allowed: bool, retry_after: int seconds or 0).
    - max_attempts: max tries within the window
    - window_secs: time window in seconds (default 5 min)
    - block_secs: block duration after exceeding limit (default 15 min)
    """
    conn = get_db()
    now = time.time()
    row = conn.execute(
        "SELECT * FROM login_attempts WHERE ip_or_email = ?", (key,)
    ).fetchone()

    if not row:
        conn.execute(
            "INSERT INTO login_attempts (ip_or_email, attempts, first_at, blocked_until) VALUES (?, 1, ?, 0)",
            (key, now)
        )
        conn.commit()
        conn.close()
        return True, 0

    # Currently blocked?
    if row["blocked_until"] > now:
        conn.close()
        return False, int(row["blocked_until"] - now)

    # Window expired — reset
    if now - row["first_at"] > window_secs:
        conn.execute(
            "UPDATE login_attempts SET attempts = 1, first_at = ?, blocked_until = 0 WHERE ip_or_email = ?",
            (now, key)
        )
        conn.commit()
        conn.close()
        return True, 0

    # Within window
    new_attempts = row["attempts"] + 1
    if new_attempts > max_attempts:
        blocked_until = now + block_secs
        conn.execute(
            "UPDATE login_attempts SET attempts = ?, blocked_until = ? WHERE ip_or_email = ?",
            (new_attempts, blocked_until, key)
        )
        conn.commit()
        conn.close()
        return False, block_secs

    conn.execute(
        "UPDATE login_attempts SET attempts = ? WHERE ip_or_email = ?",
        (new_attempts, key)
    )
    conn.commit()
    conn.close()
    return True, 0


def db_reset_rate_limit(key: str):
    """Reset rate limit counter for a key (e.g., after successful login)."""
    conn = get_db()
    conn.execute("DELETE FROM login_attempts WHERE ip_or_email = ?", (key,))
    conn.commit()
    conn.close()


# ══════════════════════════════════════════
# DATABASE BACKUP
# ══════════════════════════════════════════

_BACKUP_DIR = os.path.join(os.path.dirname(__file__), "backups")
_BACKUP_KEEP = 7  # Number of backups to retain

def db_create_backup():
    """Create a timestamped backup of the SQLite database.
    Keeps only the last _BACKUP_KEEP backups.
    Called automatically at server startup.
    """
    import shutil
    from datetime import datetime

    if not os.path.isfile(DB_PATH):
        logger.warning("No database file to back up")
        return None

    os.makedirs(_BACKUP_DIR, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    db_size_mb = os.path.getsize(DB_PATH) / (1024 * 1024)
    backup_name = f"lecturedb_{timestamp}.sqlite3"
    backup_path = os.path.join(_BACKUP_DIR, backup_name)

    try:
        # Use SQLite's built-in backup for consistency (avoids copying mid-write)
        src = sqlite3.connect(DB_PATH)
        dst = sqlite3.connect(backup_path)
        src.backup(dst)
        dst.close()
        src.close()
        logger.info("Backup created: %s (%.1f MB)", backup_name, db_size_mb)
    except Exception as e:
        # Fallback to file copy if backup API fails
        try:
            shutil.copy2(DB_PATH, backup_path)
            logger.info("Backup created (copy): %s (%.1f MB)", backup_name, db_size_mb)
        except Exception as e2:
            logger.error("Backup failed: %s", e2)
            return None

    # Cleanup old backups — keep only the most recent _BACKUP_KEEP
    try:
        backups = sorted([
            f for f in os.listdir(_BACKUP_DIR)
            if f.startswith("lecturedb_") and f.endswith(".sqlite3")
        ])
        while len(backups) > _BACKUP_KEEP:
            old = backups.pop(0)
            os.remove(os.path.join(_BACKUP_DIR, old))
            logger.info("Removed old backup: %s", old)
    except Exception as e:
        logger.warning("Backup cleanup warning: %s", e)

    return backup_path




# ══════════════════════════════════════════
# ANALYSIS CACHE
# ══════════════════════════════════════════

def db_get_analysis_cache(video_id: str, language: str):
    """Get cached analysis result for a video+language combo. Returns dict or None."""
    conn = get_db()
    cache_key = f"{video_id}:{language}"
    row = conn.execute(
        "SELECT result_json, created_at FROM analysis_cache WHERE cache_key = ?",
        (cache_key,)
    ).fetchone()
    conn.close()
    if row:
        try:
            return json.loads(row["result_json"])
        except (json.JSONDecodeError, TypeError):
            return None
    return None


def db_set_analysis_cache(video_id: str, language: str, result: dict):
    """Store analysis result in cache."""
    conn = get_db()
    cache_key = f"{video_id}:{language}"
    result_json = json.dumps(result, ensure_ascii=False)
    now = int(time.time() * 1000)
    conn.execute(
        "INSERT OR REPLACE INTO analysis_cache (cache_key, video_id, language, result_json, created_at) VALUES (?, ?, ?, ?, ?)",
        (cache_key, video_id, language, result_json, now)
    )
    conn.commit()
    conn.close()
    logger.info("Cache: stored analysis for %s [%s]", video_id, language)


def db_delete_analysis_cache(video_id: str, language: str = None):
    """Delete cached analysis. If language is None, delete all languages for this video."""
    conn = get_db()
    if language:
        cache_key = f"{video_id}:{language}"
        conn.execute("DELETE FROM analysis_cache WHERE cache_key = ?", (cache_key,))
    else:
        conn.execute("DELETE FROM analysis_cache WHERE video_id = ?", (video_id,))
    conn.commit()
    conn.close()
