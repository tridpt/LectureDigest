/* ════════════════════════════════════════════════
   LectureDigest — Global Search Module
   Search across videos, notes, transcripts, bookmarks
   Ctrl+K / Cmd+K to open
   ════════════════════════════════════════════════ */

var _gsearchOpen = false;

// ── Open / Close ──────────────────────────────────────
function openGlobalSearch() {
    if (_gsearchOpen) return;
    _gsearchOpen = true;

    var overlay = document.createElement('div');
    overlay.className = 'gsearch-overlay';
    overlay.id = 'gsearchOverlay';
    overlay.onclick = function(e) { if (e.target === overlay) closeGlobalSearch(); };

    overlay.innerHTML =
        '<div class="gsearch-modal" onclick="event.stopPropagation()">' +
        '<div class="gsearch-input-wrap">' +
        '<div class="gsearch-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" stroke-linecap="round"/></svg></div>' +
        '<input type="text" class="gsearch-input" id="gsearchInput" placeholder="Tim kiem video, ghi chu, transcript..." autocomplete="off">' +
        '<span class="gsearch-kbd">ESC</span>' +
        '</div>' +
        '<div class="gsearch-body" id="gsearchBody">' +
        '<div class="gsearch-hint">' +
        'Go ky tu de tim kiem trong <strong>video</strong>, <strong>ghi chu</strong>, <strong>transcript</strong> va <strong>bookmark</strong>.' +
        '<br>Nhan <kbd>Ctrl+K</kbd> bat ky luc nao de mo.' +
        '</div>' +
        '</div>' +
        '<div class="gsearch-footer">' +
        '<div class="gsearch-footer-item"><kbd class="gsearch-kbd">&uarr;&darr;</kbd> Di chuyen</div>' +
        '<div class="gsearch-footer-item"><kbd class="gsearch-kbd">Enter</kbd> Mo</div>' +
        '<div class="gsearch-footer-item"><kbd class="gsearch-kbd">Esc</kbd> Dong</div>' +
        '</div>' +
        '</div>';

    document.body.appendChild(overlay);

    var input = document.getElementById('gsearchInput');
    setTimeout(function() { input && input.focus(); }, 50);

    // Live search
    input.addEventListener('input', function() {
        _gsearchQuery(input.value);
    });

    // Keyboard nav
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') { closeGlobalSearch(); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            _gsearchNavigate(e.key === 'ArrowDown' ? 1 : -1);
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            _gsearchSelect();
            return;
        }
    });
}

function closeGlobalSearch() {
    var ov = document.getElementById('gsearchOverlay');
    if (ov) ov.remove();
    _gsearchOpen = false;
    _gsearchActiveIdx = -1;
    _gsearchResults = [];
}

// ── Keyboard shortcut: Ctrl+K ─────────────────────────
document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (_gsearchOpen) closeGlobalSearch();
        else openGlobalSearch();
    }
});

// ── Search logic ──────────────────────────────────────
var _gsearchResults = [];
var _gsearchActiveIdx = -1;

function _gsearchQuery(raw) {
    var q = (raw || '').trim().toLowerCase();
    var body = document.getElementById('gsearchBody');
    if (!body) return;

    if (q.length < 2) {
        body.innerHTML = '<div class="gsearch-hint">' +
            'Go ky tu de tim kiem trong <strong>video</strong>, <strong>ghi chu</strong>, <strong>transcript</strong> va <strong>bookmark</strong>.' +
            '</div>';
        _gsearchResults = [];
        _gsearchActiveIdx = -1;
        return;
    }

    var results = [];
    var history = [];
    try { history = JSON.parse(localStorage.getItem('lectureDigest_history') || '[]'); } catch(e) {}

    // 1. Search video titles & authors
    history.forEach(function(h) {
        var title = h.title || '';
        var author = h.author || '';
        if (title.toLowerCase().indexOf(q) >= 0 || author.toLowerCase().indexOf(q) >= 0) {
            results.push({
                type: 'video',
                icon: '🎬',
                title: title,
                sub: author,
                entryId: h.entry_id || h.video_id,
                videoId: h.video_id,
            });
        }
    });

    // 2. Search notes
    for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf('lectureDigest_note_') === 0) {
            var noteContent = localStorage.getItem(key) || '';
            if (noteContent.toLowerCase().indexOf(q) >= 0) {
                var vid = key.replace('lectureDigest_note_', '');
                var hEntry = history.find(function(h) { return h.video_id === vid; });
                var snippet = _gsearchSnippet(noteContent, q, 80);
                results.push({
                    type: 'note',
                    icon: '📝',
                    title: hEntry ? hEntry.title : 'Ghi chu - ' + vid,
                    sub: snippet,
                    entryId: hEntry ? (hEntry.entry_id || vid) : vid,
                    videoId: vid,
                });
            }
        }
    }

    // 3. Search transcripts (stored in history data)
    history.forEach(function(h) {
        var transcript = h.transcript || (h.data && h.data.transcript) || [];
        if (!transcript.length) return;
        // Already matched by title? Skip transcript
        if (results.some(function(r) { return r.videoId === h.video_id && r.type === 'video'; })) {
            // Still search transcript for deeper matches
        }
        for (var t = 0; t < transcript.length; t++) {
            var text = transcript[t].text || '';
            if (text.toLowerCase().indexOf(q) >= 0) {
                var tSnippet = _gsearchSnippet(text, q, 80);
                results.push({
                    type: 'transcript',
                    icon: '📄',
                    title: h.title || 'Video',
                    sub: tSnippet,
                    entryId: h.entry_id || h.video_id,
                    videoId: h.video_id,
                    timestamp: transcript[t].start,
                });
                break; // Only first match per video
            }
        }
    });

    // 4. Search bookmarks
    for (var j = 0; j < localStorage.length; j++) {
        var bKey = localStorage.key(j);
        if (bKey && bKey.indexOf('lectureDigest_bookmarks_') === 0) {
            try {
                var bms = JSON.parse(localStorage.getItem(bKey) || '[]');
                var bVid = bKey.replace('lectureDigest_bookmarks_', '');
                var bEntry = history.find(function(h) { return h.video_id === bVid; });
                for (var b = 0; b < bms.length; b++) {
                    var label = bms[b].label || bms[b].text || '';
                    if (label.toLowerCase().indexOf(q) >= 0) {
                        results.push({
                            type: 'bookmark',
                            icon: '🔖',
                            title: label,
                            sub: bEntry ? bEntry.title : bVid,
                            entryId: bEntry ? (bEntry.entry_id || bVid) : bVid,
                            videoId: bVid,
                            timestamp: bms[b].time || bms[b].timestamp,
                        });
                    }
                }
            } catch(e) {}
        }
    }

    // 5. Search summaries / chapters
    history.forEach(function(h) {
        var data = h.data || {};
        var summary = data.summary || '';
        if (summary.toLowerCase().indexOf(q) >= 0) {
            // Avoid duplicate if already matched by title
            if (!results.some(function(r) { return r.videoId === h.video_id && r.type === 'video'; })) {
                results.push({
                    type: 'summary',
                    icon: '📋',
                    title: h.title || 'Video',
                    sub: _gsearchSnippet(summary, q, 80),
                    entryId: h.entry_id || h.video_id,
                    videoId: h.video_id,
                });
            }
        }
        // Chapters
        var chapters = data.chapters || [];
        for (var c = 0; c < chapters.length; c++) {
            var chTitle = chapters[c].title || '';
            if (chTitle.toLowerCase().indexOf(q) >= 0) {
                results.push({
                    type: 'summary',
                    icon: '📑',
                    title: chTitle,
                    sub: h.title || 'Video',
                    entryId: h.entry_id || h.video_id,
                    videoId: h.video_id,
                    timestamp: chapters[c].timestamp,
                });
                break; // First match per video
            }
        }
    });

    // Deduplicate: max 2 results per video per type
    var seen = {};
    results = results.filter(function(r) {
        var key = r.type + '_' + r.videoId;
        seen[key] = (seen[key] || 0) + 1;
        return seen[key] <= 2;
    });

    // Limit total
    results = results.slice(0, 20);

    _gsearchResults = results;
    _gsearchActiveIdx = results.length > 0 ? 0 : -1;

    // Render
    _gsearchRender(results, q);
}

function _gsearchRender(results, q) {
    var body = document.getElementById('gsearchBody');
    if (!body) return;

    if (!results.length) {
        body.innerHTML = '<div class="gsearch-empty">' +
            '<div class="gsearch-empty-icon">🔍</div>' +
            'Khong tim thay ket qua nao' +
            '</div>';
        return;
    }

    // Group by type
    var groups = {};
    var ORDER = ['video', 'note', 'transcript', 'bookmark', 'summary'];
    var LABELS = { video: '🎬 Video', note: '📝 Ghi chu', transcript: '📄 Transcript', bookmark: '🔖 Bookmark', summary: '📋 Tom tat' };
    results.forEach(function(r) {
        if (!groups[r.type]) groups[r.type] = [];
        groups[r.type].push(r);
    });

    var html = '';
    var globalIdx = 0;
    ORDER.forEach(function(type) {
        var items = groups[type];
        if (!items) return;
        html += '<div class="gsearch-cat">' + LABELS[type] + ' (' + items.length + ')</div>';
        items.forEach(function(r) {
            var titleHl = _gsearchHighlight(r.title, q);
            var subHl = _gsearchHighlight(r.sub || '', q);
            html += '<button class="gsearch-item' + (globalIdx === _gsearchActiveIdx ? ' active' : '') + '" ' +
                'data-idx="' + globalIdx + '" ' +
                'onclick="_gsearchSelectIdx(' + globalIdx + ')" ' +
                'onmouseenter="_gsearchActiveIdx=' + globalIdx + ';_gsearchUpdateActive()">' +
                '<div class="gsearch-item-icon ' + r.type + '">' + r.icon + '</div>' +
                '<div class="gsearch-item-body">' +
                '<div class="gsearch-item-title">' + titleHl + '</div>' +
                '<div class="gsearch-item-sub">' + subHl + '</div>' +
                '</div>' +
                '<span class="gsearch-item-badge ' + r.type + '">' + r.type + '</span>' +
                '</button>';
            globalIdx++;
        });
    });

    body.innerHTML = html;
}

// ── Keyboard navigation ───────────────────────────────
function _gsearchNavigate(dir) {
    if (!_gsearchResults.length) return;
    _gsearchActiveIdx += dir;
    if (_gsearchActiveIdx < 0) _gsearchActiveIdx = _gsearchResults.length - 1;
    if (_gsearchActiveIdx >= _gsearchResults.length) _gsearchActiveIdx = 0;
    _gsearchUpdateActive();
}

function _gsearchUpdateActive() {
    var items = document.querySelectorAll('.gsearch-item');
    items.forEach(function(el, i) {
        el.classList.toggle('active', i === _gsearchActiveIdx);
    });
    // Scroll into view
    var active = document.querySelector('.gsearch-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
}

function _gsearchSelect() {
    if (_gsearchActiveIdx >= 0 && _gsearchActiveIdx < _gsearchResults.length) {
        _gsearchSelectIdx(_gsearchActiveIdx);
    }
}

function _gsearchSelectIdx(idx) {
    var r = _gsearchResults[idx];
    if (!r) return;
    closeGlobalSearch();

    // Load the video
    if (typeof loadFromHistory === 'function') {
        loadFromHistory(r.entryId);
    }

    // If there's a timestamp, seek to it after a short delay
    if (r.timestamp != null && typeof seekTo === 'function') {
        setTimeout(function() { seekTo(r.timestamp); }, 500);
    }

    // If it's a note result, focus the notes tab
    if (r.type === 'note') {
        setTimeout(function() {
            var notesTextarea = document.getElementById('notesTextarea');
            if (notesTextarea) notesTextarea.focus();
        }, 600);
    }
}

// ── Helpers ───────────────────────────────────────────
function _gsearchSnippet(text, query, maxLen) {
    var lower = text.toLowerCase();
    var idx = lower.indexOf(query);
    if (idx < 0) return text.substring(0, maxLen);
    var start = Math.max(0, idx - 30);
    var end = Math.min(text.length, idx + query.length + 50);
    var snippet = (start > 0 ? '...' : '') + text.substring(start, end) + (end < text.length ? '...' : '');
    return snippet;
}

function _gsearchHighlight(text, query) {
    if (!query || !text) return escHtml(text);
    var escaped = escHtml(text);
    var qEsc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(new RegExp('(' + qEsc + ')', 'gi'), '<mark>$1</mark>');
}
