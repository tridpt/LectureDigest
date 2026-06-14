"""
Database backup operations (SQLite only).
"""
import os
import sqlite3
import logging

from .connection import DB_PATH

logger = logging.getLogger("database")

_BACKUP_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "backups")
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
    except Exception:
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
