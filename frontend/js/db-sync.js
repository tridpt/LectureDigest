/* ════════════════════════════════════════════════
   LectureDigest — Database Sync Layer (User-aware)
   ════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════
// DATABASE SYNC LAYER
// ══════════════════════════════════════════════════════
var DB_SYNC_BASE = (window.API_BASE || '') + '/api/db';

function _dbAuthHeaders() {
    var headers = { 'Content-Type': 'application/json' };
    var token = localStorage.getItem('ld_auth_token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
}

function dbFetch(endpoint, opts) {
    var finalOpts = Object.assign({ headers: _dbAuthHeaders() }, opts || {});
    return fetch(DB_SYNC_BASE + endpoint, finalOpts).then(function(r) {
        if (!r.ok) throw new Error('DB sync failed: ' + r.status);
        return r.json();
    }).catch(function(e) {
        console.warn('[DB Sync]', e.message);
        return null;
    });
}

// ── Sync wrappers ──────────────────────────────

// History: sync after save
var _origSaveToHistory = window.saveToHistory;
if (typeof _origSaveToHistory === 'undefined') {
    // saveToHistory is defined with function keyword, so we patch differently
}
(function patchHistorySync() {
    var _origSave = saveToHistory;
    saveToHistory = function(data) {
        _origSave(data);
        // Also push to backend
        var hist = loadHistory();
        var entry = hist[0]; // newest (just saved)
        if (entry) {
            dbFetch('/history', {
                method: 'POST',
                body: JSON.stringify(entry)
            });
        }
    };

    var _origDelete = deleteFromHistory;
    deleteFromHistory = function(idOrEntryId) {
        _origDelete(idOrEntryId);
        dbFetch('/history/' + encodeURIComponent(idOrEntryId), { method: 'DELETE' });
    };

    var _origClear = clearHistory;
    clearHistory = function() {
        _origClear();
        dbFetch('/history', { method: 'DELETE' });
    };
})();

// Notes: sync on save (debounced)
var _notesSyncTimer = null;
(function patchNotesSync() {
    // Watch for note changes via the textarea
    document.addEventListener('input', function(e) {
        if (e.target && e.target.id === 'notesTextarea') {
            var videoId = window._spaVideoId || (window.analysisData && window.analysisData.video_id);
            if (!videoId) return;
            clearTimeout(_notesSyncTimer);
            _notesSyncTimer = setTimeout(function() {
                var content = e.target.value || '';
                dbFetch('/notes/' + videoId, {
                    method: 'PUT',
                    body: JSON.stringify({ content: content })
                });
            }, 2000); // debounce 2s
        }
    });
})();

// Bookmarks: sync after save
(function patchBookmarksSync() {
    var _origSaveBm = saveBookmarks;
    saveBookmarks = function(videoId, list) {
        _origSaveBm(videoId, list);
        dbFetch('/bookmarks/' + videoId, {
            method: 'PUT',
            body: JSON.stringify(list)
        });
    };
})();

// Gamification: sync after save
(function patchGamifSync() {
    var _origSaveGamif = saveGamif;
    saveGamif = function(data) {
        _origSaveGamif(data);
        dbFetch('/gamification', {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    };
})();

// ── Extra data keys to sync per-user ──
var _EXTRA_SYNC_PREFIXES = [
    'lectureDigest_examHistory',
    'lectureDigest_sm2_',
    'lectureDigest_customfc_',
    'lectureDigest_tags',
    'lectureDigest_progress_',
    'lectureDigest_playlist_',
    'lectureDigest_weeklyGoals'
];

function _isExtraSyncKey(key) {
    for (var p = 0; p < _EXTRA_SYNC_PREFIXES.length; p++) {
        if (key === _EXTRA_SYNC_PREFIXES[p] || key.indexOf(_EXTRA_SYNC_PREFIXES[p]) === 0) return true;
    }
    return false;
}

// ── Initial sync: pull from backend on page load ──
function doDbSync() {
    // Push localStorage to backend (in case backend is empty)
    var localHist = [];
    try { localHist = JSON.parse(localStorage.getItem('lectureDigest_history') || '[]'); } catch(e) {}
    var localGamif = {};
    try { localGamif = JSON.parse(localStorage.getItem('lectureDigest_gamification') || '{}'); } catch(e) {}

    // Collect notes, bookmarks, and extra data
    var localNotes = {};
    var localBookmarks = {};
    var extraData = {};
    for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key) continue;
        if (key.indexOf('lectureDigest_note_') === 0) {
            var vid = key.replace('lectureDigest_note_', '');
            localNotes[vid] = localStorage.getItem(key) || '';
        } else if (key.indexOf('lectureDigest_bookmarks_') === 0) {
            var vid2 = key.replace('lectureDigest_bookmarks_', '');
            try { localBookmarks[vid2] = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) {}
        } else if (_isExtraSyncKey(key)) {
            extraData[key] = localStorage.getItem(key) || '';
        }
    }

    console.log('[DB Sync] Sending', localHist.length, 'history,', Object.keys(extraData).length, 'extra keys');

    dbFetch('/sync', {
        method: 'POST',
        body: JSON.stringify({
            history: localHist,
            notes: localNotes,
            bookmarks: localBookmarks,
            gamification: localGamif,
            extra_data: extraData
        })
    }).then(function(result) {
        if (!result) {
            console.warn('[DB Sync] No result from server');
            return;
        }
        // Always update localStorage from server (server is source of truth)
        if (result.history !== undefined) {
            localStorage.setItem('lectureDigest_history', JSON.stringify(result.history));
            console.log('[DB Sync] History synced:', result.history.length, 'entries');
        }
        if (result.gamification !== undefined) {
            localStorage.setItem('lectureDigest_gamification', JSON.stringify(result.gamification));
            console.log('[DB Sync] Gamification synced');
        }
        // Restore notes from server
        if (result.notes) {
            var noteVids = Object.keys(result.notes);
            for (var n = 0; n < noteVids.length; n++) {
                localStorage.setItem('lectureDigest_note_' + noteVids[n], result.notes[noteVids[n]]);
            }
            console.log('[DB Sync] Notes synced:', noteVids.length, 'videos');
        }
        // Restore bookmarks from server
        if (result.bookmarks) {
            var bmVids = Object.keys(result.bookmarks);
            for (var b = 0; b < bmVids.length; b++) {
                localStorage.setItem('lectureDigest_bookmarks_' + bmVids[b], JSON.stringify(result.bookmarks[bmVids[b]]));
            }
            console.log('[DB Sync] Bookmarks synced:', bmVids.length, 'videos');
        }
        // Restore extra data from server
        if (result.extra_data) {
            var extraKeys = Object.keys(result.extra_data);
            for (var k = 0; k < extraKeys.length; k++) {
                localStorage.setItem(extraKeys[k], result.extra_data[extraKeys[k]]);
            }
            console.log('[DB Sync] Extra data synced:', extraKeys.length, 'keys');
        }
        // Always re-render UI after sync
        if (typeof renderHistoryPanel === 'function') renderHistoryPanel();
        if (typeof renderStreakCard === 'function') renderStreakCard();
        // Re-render dashboard if it's currently visible
        if (typeof renderDashboard === 'function') {
            var ds = document.getElementById('dashboardSection');
            if (ds && !ds.classList.contains('hidden')) renderDashboard();
        }
    });
}

// Auto-sync on page load
(function initialDbSync() {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(doDbSync, 1500);
    } else {
        window.addEventListener('DOMContentLoaded', function() {
            setTimeout(doDbSync, 1500);
        });
    }
})();
