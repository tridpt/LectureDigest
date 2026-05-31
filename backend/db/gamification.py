"""
Gamification CRUD, leaderboard, and anonymous-to-user migration.
"""
import json
import time
import logging
from .connection import get_db

logger = logging.getLogger("database")


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
        except (json.JSONDecodeError, TypeError):
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
        except (json.JSONDecodeError, TypeError):
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
        except Exception as e:
            logger.warning("Failed to migrate gamification for user %d: %s", user_id, e)

    conn.commit()
    conn.close()
    logger.info("Migrated anonymous data to user %d", user_id)
