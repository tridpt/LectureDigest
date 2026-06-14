"""
Full sync — single-connection sync to avoid DB locking.
"""
import json
import time
import logging
from .connection import get_db

logger = logging.getLogger("database")


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
            try:
                entry["data"] = json.loads(r["data_json"]) if r["data_json"] else {}
            except Exception:
                entry["data"] = {}
            try:
                entry["transcript"] = json.loads(r["transcript_json"]) if r["transcript_json"] else None
            except Exception:
                entry["transcript"] = None
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
            if vid not in result_bookmarks:
                result_bookmarks[vid] = []
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

        logger.info("Sync OK: %d hist, %d notes, %d bm, %d extra for user %s", len(result_history), len(result_notes), len(result_bookmarks), len(result_extra), user_id)
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
