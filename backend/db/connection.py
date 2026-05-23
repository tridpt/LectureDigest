"""
Database connection layer — dual-mode SQLite/PostgreSQL.
Provides get_db() which returns a connection wrapper supporting both backends.
"""
import sqlite3
import os
import logging

logger = logging.getLogger("database")

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
USE_POSTGRES = DATABASE_URL.startswith("postgresql://") or DATABASE_URL.startswith("postgres://")

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "lecturedb.sqlite3")


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
            except Exception as e:
                logger.debug("PG close error: %s", e)

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            self.close()
            return False

        def __del__(self):
            if self._conn is not None:
                try:
                    _pg_pool.putconn(self._conn)
                    self._conn = None
                except Exception as e:
                    logger.debug("PG __del__ cleanup error: %s", e)

    def get_db():
        """Get a PostgreSQL connection wrapped to behave like sqlite3."""
        return PgConnectionWrapper()

else:
    class _SqliteConnectionWrapper:
        """Wraps sqlite3 connection to support context manager protocol."""
        def __init__(self):
            self._conn = sqlite3.connect(DB_PATH, timeout=10)
            self._conn.row_factory = sqlite3.Row
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._conn.execute("PRAGMA busy_timeout=10000")

        def execute(self, sql, params=None):
            if params:
                return self._conn.execute(sql, params)
            return self._conn.execute(sql)

        def executescript(self, sql):
            return self._conn.executescript(sql)

        def commit(self):
            return self._conn.commit()

        def rollback(self):
            return self._conn.rollback()

        def close(self):
            self._conn.close()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            if exc_type:
                self._conn.rollback()
            self._conn.close()
            return False

    def get_db():
        """Get a SQLite connection with row_factory. Supports context manager."""
        return _SqliteConnectionWrapper()
