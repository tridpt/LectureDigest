"""
Database schema initialization and migrations.
"""
import time
import logging
from .connection import get_db, USE_POSTGRES, DB_PATH

logger = logging.getLogger("database")


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

        CREATE TABLE IF NOT EXISTS blocked_emails (
            email      TEXT PRIMARY KEY,
            reason     TEXT DEFAULT '',
            blocked_by TEXT DEFAULT '',
            created_at BIGINT NOT NULL,
            expires_at BIGINT DEFAULT NULL
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

        CREATE TABLE IF NOT EXISTS blocked_emails (
            email      TEXT PRIMARY KEY,
            reason     TEXT DEFAULT '',
            blocked_by TEXT DEFAULT '',
            created_at INTEGER NOT NULL,
            expires_at INTEGER DEFAULT NULL
        );
    """)
    # Ensure gamification row exists
    conn.execute(
        "INSERT OR IGNORE INTO gamification (id, data_json, updated_at) VALUES (1, '{}', ?)",
        (int(time.time() * 1000),)
    )

    # ── Migration: add user_id columns to support per-user data ──
    _migrate_add_user_id(conn)

    # ── Migration: add expires_at to blocked_emails (timed bans) ──
    try:
        conn.execute("ALTER TABLE blocked_emails ADD COLUMN expires_at INTEGER DEFAULT NULL")
        logger.info("Migration: added expires_at to blocked_emails")
    except Exception:
        pass  # Column already exists

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
