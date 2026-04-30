/* ════════════════════════════════════════════════
   LectureDigest — Database Sync Layer (User-aware)
   ════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════
// DATABASE SYNC LAYER
// ══════════════════════════════════════════════════════
var DB_SYNC_BASE = (window.API_BASE || '') + '/api/db';
var _dbSyncInProgress = false;

// Debug logging — enable with: localStorage.setItem('ld_debug','1')
function _dbLog() {
    if (localStorage.getItem('ld_debug')) console.log.apply(console, ['[DB Sync]'].concat(Array.prototype.slice.call(arguments)));
}

function _dbAuthHeaders() {
    var headers = { 'Content-Type': 'application/json' };
    var token = localStorage.getItem('ld_auth_token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
}

function dbFetch(endpoint, opts) {
    var finalOpts = Object.assign({ headers: _dbAuthHeaders() }, opts || {});
    return fetchWithTimeout(DB_SYNC_BASE + endpoint, finalOpts, 15000).then(function(r) {
        if (!r.ok) throw new Error('DB sync failed: ' + r.status);
        return r.json();
    }).catch(function(e) {
        _dbLog('fetch error:', e.message);
        return null;
    });
}

// ── Sync wrappers ──────────────────────────────

// History: sync after save
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

    // Patch deleteFromHistory: the original uses showConfirmModal,
    // so we must hook into the CONFIRMATION callback, not call dbFetch immediately.
    var _origDelete = deleteFromHistory;
    deleteFromHistory = function(idOrEntryId) {
        var _origShowConfirm = showConfirmModal;
        showConfirmModal = function(message, onConfirm) {
            _origShowConfirm(message, function() {
                if (typeof onConfirm === 'function') onConfirm();
                // Sync the delete to server AFTER user confirmed
                dbFetch('/history/' + encodeURIComponent(idOrEntryId), { method: 'DELETE' });
            });
        };
        _origDelete(idOrEntryId);
        showConfirmModal = _origShowConfirm;
    };

    // Patch clearHistory: same pattern — sync after confirmation
    var _origClear = clearHistory;
    clearHistory = function() {
        var _origShowConfirm = showConfirmModal;
        showConfirmModal = function(message, onConfirm) {
            _origShowConfirm(message, function() {
                if (typeof onConfirm === 'function') onConfirm();
                dbFetch('/history', { method: 'DELETE' });
            });
        };
        _origClear();
        showConfirmModal = _origShowConfirm;
    };
})();

// Notes: saveNote() in notes.js already debounces and calls dbFetch('/sync').
// No additional patch needed here.

// Bookmarks: saveBookmarks() in progress.js already debounces and calls dbFetch('/sync').
// No additional patch needed here.
// (Previously patched to ALSO call /bookmarks/ endpoint — removed to avoid duplicate requests.)

// Gamification: saveGamif() in gamification.js already debounces and calls dbFetch('/sync').
// No additional patch needed here.
// (Previously patched to ALSO call /gamification endpoint — removed to avoid duplicate requests.)

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

// ── Sync loading overlay (shown during login/logout sync) ──
function _showSyncOverlay() {
    if (document.getElementById('dbSyncOverlay')) return;
    var overlay = document.createElement('div');
    overlay.id = 'dbSyncOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;' +
        'justify-content:center;background:rgba(15,15,35,0.85);backdrop-filter:blur(6px);' +
        'transition:opacity 0.3s ease;';
    overlay.innerHTML = '<div style="text-align:center;color:#e2e8f0;">' +
        '<div style="width:40px;height:40px;margin:0 auto 16px;border:3px solid rgba(139,92,246,0.3);' +
        'border-top-color:#8b5cf6;border-radius:50%;animation:spin 0.8s linear infinite;"></div>' +
        '<div style="font-size:16px;font-weight:600;margin-bottom:6px;">Đang đồng bộ dữ liệu...</div>' +
        '<div style="font-size:13px;opacity:0.6;">Vui lòng đợi trong giây lát</div>' +
        '</div>';
    document.body.appendChild(overlay);
}

function _hideSyncOverlay() {
    var overlay = document.getElementById('dbSyncOverlay');
    if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(function() { if (overlay.parentNode) overlay.remove(); }, 300);
    }
}

// ── Initial sync: pull from backend on page load ──
function doDbSync(showOverlay) {
    if (_dbSyncInProgress) return;
    _dbSyncInProgress = true;

    if (showOverlay) _showSyncOverlay();

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

    _dbLog('Sending', localHist.length, 'history,', Object.keys(extraData).length, 'extra keys');

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
        _dbSyncInProgress = false;
        if (showOverlay) _hideSyncOverlay();

        if (!result) {
            _dbLog('No result from server');
            return;
        }
        // Always update localStorage from server (server is source of truth)
        if (result.history !== undefined) {
            safeLsSet('lectureDigest_history', JSON.stringify(result.history));
            _dbLog('History synced:', result.history.length, 'entries');
        }
        if (result.gamification !== undefined) {
            safeLsSet('lectureDigest_gamification', JSON.stringify(result.gamification));
            _dbLog('Gamification synced');
        }
        // Restore notes from server
        if (result.notes) {
            var noteVids = Object.keys(result.notes);
            for (var n = 0; n < noteVids.length; n++) {
                safeLsSet('lectureDigest_note_' + noteVids[n], result.notes[noteVids[n]]);
            }
            _dbLog('Notes synced:', noteVids.length, 'videos');
        }
        // Restore bookmarks from server
        if (result.bookmarks) {
            var bmVids = Object.keys(result.bookmarks);
            for (var b = 0; b < bmVids.length; b++) {
                safeLsSet('lectureDigest_bookmarks_' + bmVids[b], JSON.stringify(result.bookmarks[bmVids[b]]));
            }
            _dbLog('Bookmarks synced:', bmVids.length, 'videos');
        }
        // Restore extra data from server
        if (result.extra_data) {
            var extraKeys = Object.keys(result.extra_data);
            for (var k = 0; k < extraKeys.length; k++) {
                safeLsSet(extraKeys[k], result.extra_data[extraKeys[k]]);
            }
            _dbLog('Extra data synced:', extraKeys.length, 'keys');
        }
        // Always re-render UI after sync
        if (typeof renderHistoryPanel === 'function') renderHistoryPanel();
        if (typeof renderStreakCard === 'function') renderStreakCard();
        // Re-render dashboard if it's currently visible
        if (typeof renderDashboard === 'function') {
            var ds = document.getElementById('dashboardSection');
            if (ds && !ds.classList.contains('hidden')) renderDashboard();
        }
    }).catch(function() {
        _dbSyncInProgress = false;
        if (showOverlay) _hideSyncOverlay();
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
