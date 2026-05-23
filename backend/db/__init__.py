"""
db — Database package for LectureDigest backend.
Dual-mode: SQLite (local dev) or PostgreSQL (production via DATABASE_URL).

This package splits the monolithic database.py into focused modules:
  - connection: get_db(), DB_PATH, USE_POSTGRES, connection wrappers
  - schema: init_db(), migrations
  - history: History CRUD
  - notes: Notes CRUD
  - bookmarks: Bookmarks CRUD
  - gamification: Gamification CRUD, leaderboard, migration
  - sync: Full sync operation
  - kv_store: User key-value store
  - users: User CRUD, GDPR operations
  - shared_notes: Shared notes CRUD
  - folders: Folders CRUD
  - auth_tokens: Password reset tokens, rate limiting
  - backup: Database backup (SQLite)
  - cache: Analysis cache
"""

# ── Connection layer ──
from .connection import get_db, DB_PATH, USE_POSTGRES

# ── Schema / Init ──
from .schema import init_db

# ── History ──
from .history import db_get_history, db_save_history, db_delete_history, db_clear_history

# ── Notes ──
from .notes import db_get_notes, db_save_notes, db_get_all_notes

# ── Bookmarks ──
from .bookmarks import (
    db_get_bookmarks, db_save_bookmark, db_delete_bookmark,
    db_sync_bookmarks, db_get_all_bookmarks,
)

# ── Gamification ──
from .gamification import (
    db_get_gamification, db_save_gamification,
    db_get_leaderboard, db_migrate_anonymous_to_user,
)

# ── Full Sync ──
from .sync import db_full_sync

# ── KV Store ──
from .kv_store import db_kv_get, db_kv_set, db_kv_get_all, db_kv_delete

# ── Users ──
from .users import (
    db_create_user, db_get_user_by_google_id, db_get_user_by_email,
    db_get_user_by_id, db_update_user, db_delete_user, db_export_user_data,
)

# ── Shared Notes ──
from .shared_notes import db_create_shared_notes, db_get_shared_notes

# ── Folders ──
from .folders import (
    db_get_folders, db_create_folder, db_update_folder, db_delete_folder,
    db_add_video_to_folder, db_remove_video_from_folder,
    db_get_folder_videos, db_get_video_folders, db_get_all_folder_videos,
)

# ── Auth Tokens & Rate Limiting ──
from .auth_tokens import (
    db_save_reset_token, db_get_reset_token, db_delete_reset_token,
    db_delete_reset_tokens_for_email, db_cleanup_expired_tokens,
    db_check_rate_limit, db_reset_rate_limit,
)

# ── Backup ──
from .backup import db_create_backup

# ── Analysis Cache ──
from .cache import db_get_analysis_cache, db_set_analysis_cache, db_delete_analysis_cache
