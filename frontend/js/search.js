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

    // Live search (debounced to avoid re-rendering on every keystroke)
    var _gsearchTimer = null;
    input.addEventListener('input', function() {
        clearTimeout(_gsearchTimer);
        _gsearchTimer = setTimeout(function() {
            _gsearchQuery(input.value);
        }, 200);
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
    var searchQuery = document.getElementById('gsearchInput')?.value?.trim().toLowerCase() || '';
    closeGlobalSearch();

    // Load the video
    if (typeof loadFromHistory === 'function') {
        loadFromHistory(r.entryId);
    }

    // If there's a timestamp, seek to it after a short delay
    if (r.timestamp != null && typeof seekTo === 'function') {
        setTimeout(function() { seekTo(r.timestamp); }, 500);
    }

    // Scroll to & highlight based on result type
    setTimeout(function() { _gsearchScrollAndHighlight(r, searchQuery); }, 700);
}

function _gsearchScrollAndHighlight(r, query) {
    // Remove any previous highlights
    document.querySelectorAll('.gsearch-page-highlight').forEach(function(el) {
        el.classList.remove('gsearch-page-highlight');
    });

    switch (r.type) {
        case 'transcript':
            _gsearchHighlightTranscript(r, query);
            break;
        case 'note':
            _gsearchHighlightNotes(query);
            break;
        case 'summary':
            _gsearchHighlightSummary(r, query);
            break;
        case 'bookmark':
            _gsearchHighlightBookmark(r, query);
            break;
        case 'video':
            // Just scroll to top of results
            var results = document.getElementById('resultsSection');
            if (results) results.scrollIntoView({ behavior: 'smooth', block: 'start' });
            break;
    }
}

function _gsearchHighlightTranscript(r, query) {
    // Find the transcript line by timestamp
    var lines = document.querySelectorAll('.transcript-line');
    var target = null;

    if (r.timestamp != null) {
        // Find line closest to timestamp
        lines.forEach(function(el) {
            var secs = parseFloat(el.dataset.secs || 0);
            if (Math.abs(secs - r.timestamp) < 2) {
                target = el;
            }
        });
    }

    // Fallback: search by text content
    if (!target && query) {
        lines.forEach(function(el) {
            if (!target && el.textContent.toLowerCase().indexOf(query) >= 0) {
                target = el;
            }
        });
    }

    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('gsearch-page-highlight');
        // Also highlight the matching text inside
        _gsearchInjectHighlight(target, query);
        setTimeout(function() {
            target.classList.remove('gsearch-page-highlight');
            _gsearchRemoveInjectedHighlights();
        }, 4000);
    }
}

function _gsearchHighlightNotes(query) {
    var textarea = document.getElementById('notesTextarea');
    if (!textarea) return;

    // Scroll to notes section
    var notesCard = textarea.closest('.card') || textarea.parentElement;
    if (notesCard) notesCard.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Select the matching text in textarea
    if (query) {
        var content = textarea.value || '';
        var idx = content.toLowerCase().indexOf(query);
        if (idx >= 0) {
            textarea.focus();
            textarea.setSelectionRange(idx, idx + query.length);
        }
    }

    // Add highlight glow to card
    if (notesCard) {
        notesCard.classList.add('gsearch-page-highlight');
        setTimeout(function() { notesCard.classList.remove('gsearch-page-highlight'); }, 4000);
    }
}

function _gsearchHighlightSummary(r, query) {
    // Try to find matching text in summary/chapters sections
    var candidates = document.querySelectorAll(
        '.overview-text, .takeaway-item, .chapter-title, .timeline-title, .summary-text, .card p, .card li'
    );
    var target = null;

    candidates.forEach(function(el) {
        if (!target && el.textContent.toLowerCase().indexOf(query) >= 0) {
            target = el;
        }
    });

    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('gsearch-page-highlight');
        _gsearchInjectHighlight(target, query);
        setTimeout(function() {
            target.classList.remove('gsearch-page-highlight');
            _gsearchRemoveInjectedHighlights();
        }, 4000);
    } else {
        // Fallback: scroll to results section top
        var results = document.getElementById('resultsSection');
        if (results) results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function _gsearchHighlightBookmark(r, query) {
    // Find bookmark item by text
    var items = document.querySelectorAll('.bookmark-item, .bm-item');
    var target = null;

    items.forEach(function(el) {
        if (!target && el.textContent.toLowerCase().indexOf(query) >= 0) {
            target = el;
        }
    });

    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('gsearch-page-highlight');
        setTimeout(function() { target.classList.remove('gsearch-page-highlight'); }, 4000);
    }
}

// Inject <mark> tags into an element's text for visual highlighting
function _gsearchInjectHighlight(el, query) {
    if (!query || !el) return;
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    var textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach(function(node) {
        var text = node.nodeValue;
        var lower = text.toLowerCase();
        var idx = lower.indexOf(query);
        if (idx < 0) return;

        var before = text.substring(0, idx);
        var match = text.substring(idx, idx + query.length);
        var after = text.substring(idx + query.length);

        var span = document.createElement('span');
        span.innerHTML = '';
        if (before) span.appendChild(document.createTextNode(before));
        var mark = document.createElement('mark');
        mark.className = 'gsearch-text-mark';
        mark.textContent = match;
        span.appendChild(mark);
        if (after) span.appendChild(document.createTextNode(after));

        node.parentNode.replaceChild(span, node);
    });
}

function _gsearchRemoveInjectedHighlights() {
    document.querySelectorAll('.gsearch-text-mark').forEach(function(mark) {
        var parent = mark.parentNode;
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
        parent.normalize();
    });
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

