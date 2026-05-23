"""
Analysis cache operations.
"""
import json
import time
import logging
from .connection import get_db

logger = logging.getLogger("database")


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
