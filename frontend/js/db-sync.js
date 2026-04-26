/* ════════════════════════════════════════════════
   LectureDigest — Database Sync Layer
   ════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════
// DATABASE SYNC LAYER
// ══════════════════════════════════════════════════════
var DB_SYNC_BASE = (window.API_BASE || '') + '/api/db';

function dbFetch(endpoint, opts) {
    return fetch(DB_SYNC_BASE + endpoint, Object.assign({
        headers: { 'Content-Type': 'application/json' }
    }, opts || {})).then(function(r) {
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

// ── Initial sync: pull from backend on page load ──
(function initialDbSync() {
    // Only run after DOM is ready
    function doSync() {
        // First push localStorage to backend (in case backend is empty)
        var localHist = [];
        try { localHist = JSON.parse(localStorage.getItem('lectureDigest_history') || '[]'); } catch(e) {}
        var localGamif = {};
        try { localGamif = JSON.parse(localStorage.getItem('lectureDigest_gamification') || '{}'); } catch(e) {}

        // Collect notes and bookmarks
        var localNotes = {};
        var localBookmarks = {};
        for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i);
            if (key && key.indexOf('lectureDigest_note_') === 0) {
                var vid = key.replace('lectureDigest_note_', '');
                localNotes[vid] = localStorage.getItem(key) || '';
            }
            if (key && key.indexOf('lectureDigest_bookmarks_') === 0) {
                var vid2 = key.replace('lectureDigest_bookmarks_', '');
                try { localBookmarks[vid2] = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) {}
            }
        }

        dbFetch('/sync', {
            method: 'POST',
            body: JSON.stringify({
                history: localHist,
                notes: localNotes,
                bookmarks: localBookmarks,
                gamification: localGamif
            })
        }).then(function(result) {
            if (!result) return;
            // Merge backend history into localStorage
            if (result.history && result.history.length) {
                var merged = result.history;
                localStorage.setItem('lectureDigest_history', JSON.stringify(merged));
                if (typeof renderHistoryPanel === 'function') renderHistoryPanel();
                console.log('[DB Sync] History synced:', merged.length, 'entries');
            }
            if (result.gamification) {
                localStorage.setItem('lectureDigest_gamification', JSON.stringify(result.gamification));
                console.log('[DB Sync] Gamification synced');
            }
        });
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(doSync, 1500);
    } else {
        window.addEventListener('DOMContentLoaded', function() {
            setTimeout(doSync, 1500);
        });
    }
})();

