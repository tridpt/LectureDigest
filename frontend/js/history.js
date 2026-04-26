/* ════════════════════════════════════════════════
   LectureDigest — History Module
   ════════════════════════════════════════════════ */

const HISTORY_KEY = 'lectureDigest_history';
const HISTORY_MAX = 30;

function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
    catch { return []; }
}

function saveToHistory(data) {
    const list = loadHistory();
    const entry = {
        video_id:    data.video_id,
        entry_id:    data.video_id + '_' + Date.now(),
        url:         document.getElementById('urlInput').value.trim(),
        title:       data.title,
        author:      data.author,
        thumbnail:   data.thumbnail,
        savedAt:     Date.now(),
        lang:        selectedLang,
        data,
        transcript:  data.transcript || null,
    };
    if (playlistState && playlistState.data) {
        entry.playlist_id = playlistState.data.playlist_id;
        entry.playlist_title = playlistState.data.title;
    }
    list.unshift(entry);
    list.splice(HISTORY_MAX);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    renderHistoryPanel();
}

function deleteFromHistory(idOrEntryId) {
    showConfirmModal('Xoa video nay khoi lich su?', function() {
        var list = loadHistory().filter(function(h) {
            return h.entry_id ? h.entry_id !== idOrEntryId : h.video_id !== idOrEntryId;
        });
        localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
        renderHistoryPanel();
    });
}

function clearHistory() {
    showConfirmModal('Xoa toan bo lich su? Hanh dong nay khong the hoan tac.', function() {
        localStorage.removeItem(HISTORY_KEY);
        renderHistoryPanel();
        showToast('Da xoa toan bo lich su');
    });
}

function loadFromHistory(entryIdOrVideoId) {
    var entry = loadHistory().find(function(h) {
        return h.entry_id === entryIdOrVideoId;
    });
    if (!entry) {
        entry = loadHistory().find(function(h) {
            return h.video_id === entryIdOrVideoId;
        });
    }
    if (!entry) return;
    document.getElementById('urlInput').value = entry.url;
    analysisData = entry.data;
    toggleHistoryPanel(false);
    clearChat();
    renderResults(entry.data);
    initNotes(entry.video_id);
    renderTranscript(entry.data && entry.data.transcript ? entry.data.transcript : (entry.transcript || []));
    initProgress(entry.video_id);
    initBookmarks(entry.video_id);
    recordStudySession();
    window._spaVideoId = entry.video_id;
    showSection('resultsSection');
}

function toggleHistoryPanel(force) {
    const panel = document.getElementById('historyPanel');
    const isOpen = panel.classList.contains('open');
    const shouldOpen = force !== undefined ? force : !isOpen;
    panel.classList.toggle('open', shouldOpen);
    document.getElementById('historyToggle').setAttribute('aria-expanded', shouldOpen);
    if (shouldOpen) renderHistoryPanel();
}

function renderHistoryPanel(filter) {
    filter = filter || '';
    var list = loadHistory();
    var container = document.getElementById('historyList');
    var empty = document.getElementById('historyEmpty');
    var countEl = document.getElementById('historyCount');
    if (!container) return;
    if (countEl) countEl.textContent = list.length;

    var q = filter.trim().toLowerCase();
    var filtered = q ? list.filter(function(h) {
        return (h.title || '').toLowerCase().indexOf(q) >= 0 ||
               (h.author || '').toLowerCase().indexOf(q) >= 0;
    }) : list;

    // Filter by tag
    if (typeof _historyTagFilter !== 'undefined' && _historyTagFilter) {
        filtered = filtered.filter(function(h) {
            var tags = getVideoTags(h.video_id);
            return tags.indexOf(_historyTagFilter) >= 0;
        });
    }

    if (list.length === 0) {
        container.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');
    if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:24px 12px;opacity:.5;font-size:13px">Khong tim thay video nao</div>';
        return;
    }
    container.innerHTML = filtered.map(function(h) {
        var date = new Date(h.savedAt);
        var dateStr = date.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' });
        var timeStr = date.toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit' });
        var titleText = escHtml(h.title || 'Untitled');
        if (q) {
            var re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
            titleText = titleText.replace(re, '<mark style="background:rgba(139,92,246,.35);color:inherit;border-radius:2px">$1</mark>');
        }
        return '<div class="hist-item" data-id="' + h.video_id + '">' +
            '<img class="hist-thumb" src="' + h.thumbnail + '" alt="' + escHtml(h.title) + '" loading="lazy"' +
            " onerror=\"this.src='https://img.youtube.com/vi/" + h.video_id + "/mqdefault.jpg'\">" +
            '<div class="hist-info" onclick="loadFromHistory(\'' + (h.entry_id || h.video_id) + '\')" role="button" tabindex="0">' +
            '<div class="hist-title">' + titleText + '</div>' +
            (h.playlist_title ? '<div class="hist-playlist-badge">📋 ' + escHtml(h.playlist_title) + '</div>' : '') +
            '<div class="hist-meta">' + escHtml(h.author || '') + ' &bull; ' + dateStr + ' ' + timeStr + '</div>' +
            '<div class="hist-lang">' + (h.lang || 'English') + '</div>' +
            '<div class="hist-tags">' + renderTagBadges(h.video_id) + '</div>' +
            '</div>' +
            (function(){
                var dupeCount = filtered.filter(function(x){ return x.video_id === h.video_id; }).length;
                return dupeCount >= 2
                    ? '<button class="hist-compare" onclick="event.stopPropagation();openCompareForVideo(\'' + h.video_id + '\')" title="So sanh"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M16 3h5v5M8 3H3v5M21 3l-7 7M3 3l7 7M16 21h5v-5M8 21H3v-5M21 21l-7-7M3 21l7-7"/></svg></button>'
                    : '';
            })() +
            '<button class="hist-tag-btn" onclick="event.stopPropagation();showTagPicker(\'' + h.video_id + '\', this)" title="Tag">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>' +
            '</button>' +
            '<button class="hist-del" onclick="deleteFromHistory(\'' + (h.entry_id || h.video_id) + '\')" title="Xoa">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
            '</button></div>';
    }).join('');
}

function filterHistory(value) { renderHistoryPanel(value); }

// Close history panel when clicking outside
document.addEventListener('click', e => {
    const panel = document.getElementById('historyPanel');
    const toggle = document.getElementById('historyToggle');
    if (panel?.classList.contains('open') && !panel.contains(e.target) && !toggle?.contains(e.target)) {
        toggleHistoryPanel(false);
    }
});

// Update badge count immediately (script runs after DOM is ready)
(function updateHistoryBadge() {
    const count = loadHistory().length;
    const badge = document.getElementById('historyCount');
    if (badge) badge.textContent = count;
})();
