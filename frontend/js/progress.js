/* ════════════════════════════════════════════════
   LectureDigest — Learning Progress & Bookmarks
   ════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════════
// LEARNING PROGRESS  (video watch % + quiz history)
// ══════════════════════════════════════════════════════════

const PROG_KEY_PREFIX = 'lectureDigest_progress_';
let watchInterval   = null;

function progKey(videoId) { return PROG_KEY_PREFIX + videoId; }

function loadProgress(videoId) {
    try { return JSON.parse(localStorage.getItem(progKey(videoId)) || 'null') || { watchedPct: 0, quizSessions: [] }; }
    catch { return { watchedPct: 0, quizSessions: [] }; }
}

function saveProgress(videoId, data) {
    try { localStorage.setItem(progKey(videoId), JSON.stringify(data)); } catch {}
}

// ── Init progress tracking for a video ──
function initProgress(videoId) {
    stopWatchTracking();
    renderProgressCard(videoId);

    // Start watching video progress every 5s
    watchInterval = setInterval(() => trackWatchProgress(videoId), 5000);
}

function stopWatchTracking() {
    if (watchInterval) { clearInterval(watchInterval); watchInterval = null; }
}

function trackWatchProgress(videoId) {
    if (!ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') return;
    try {
        const cur  = ytPlayer.getCurrentTime();
        const dur  = ytPlayer.getDuration();
        if (!dur || dur <= 0) return;
        const pct  = Math.min(100, Math.round((cur / dur) * 100));
        const prog = loadProgress(videoId);
        if (pct > prog.watchedPct) {
            prog.watchedPct = pct;
            prog.lastWatched = new Date().toISOString();
            saveProgress(videoId, prog);
            renderWatchBar(pct);
        }
    } catch {}
}

// ── Record a completed quiz session ──
function recordQuizSession(videoId, correct, total) {
    const prog = loadProgress(videoId);
    prog.quizSessions = prog.quizSessions || [];
    prog.quizSessions.push({
        date:    new Date().toISOString(),
        correct: correct,
        total:   total,
        pct:     Math.round((correct / total) * 100)
    });
    // Keep last 10 sessions only
    if (prog.quizSessions.length > 10) prog.quizSessions = prog.quizSessions.slice(-10);
    saveProgress(videoId, prog);
    renderProgressCard(videoId);
}

// ── Render full progress card ──
function renderProgressCard(videoId) {
    const prog = loadProgress(videoId);

    // Watch bar
    renderWatchBar(prog.watchedPct || 0);

    // Last studied
    const lastEl = document.getElementById('progressLastStudied');
    if (lastEl && prog.lastWatched) {
        const d = new Date(prog.lastWatched);
        lastEl.textContent = 'Lần cuối: ' + d.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit' });
    }

    // Quiz history chart
    renderQuizChart(prog.quizSessions || []);
}

function renderWatchBar(pct) {
    const fill  = document.getElementById('watchFill');
    const label = document.getElementById('watchPct');
    const track = document.getElementById('watchTrack');
    if (fill)  fill.style.width = pct + '%';
    if (label) label.textContent = pct + '%';
    if (track) track.setAttribute('aria-valuenow', pct);
}

function renderQuizChart(sessions) {
    const chart   = document.getElementById('quizHistoryChart');
    const labels  = document.getElementById('quizHistoryLabels');
    const empty   = document.getElementById('quizHistoryEmpty');
    const avgEl   = document.getElementById('quizAvgPct');

    if (!chart) return;

    if (!sessions.length) {
        if (empty)  empty.style.display = 'flex';
        if (labels) labels.innerHTML = '';
        if (avgEl)  avgEl.textContent = '';
        return;
    }

    if (empty) empty.style.display = 'none';

    // Average
    const avg = Math.round(sessions.reduce((s, x) => s + x.pct, 0) / sessions.length);
    if (avgEl) avgEl.textContent = 'TB: ' + avg + '%';

    // Bar chart
    const bars = sessions.map((s, i) => {
        const color = s.pct >= 75 ? '#4ade80' : s.pct >= 50 ? '#facc15' : '#f87171';
        const dateStr = new Date(s.date).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
        return '<div class="qh-bar-wrap" title="' + dateStr + ': ' + s.correct + '/' + s.total + ' (' + s.pct + '%)">'
             + '<div class="qh-score-tip">' + s.pct + '%</div>'
             + '<div class="qh-bar" style="height:' + Math.max(4, s.pct) + '%;background:' + color + '"></div>'
             + '</div>';
    }).join('');

    chart.innerHTML = '<div class="qh-bars">' + bars + '</div>';

    // Date labels under bars
    if (labels) {
        labels.innerHTML = sessions.map(s => {
            const d = new Date(s.date);
            return '<span>' + d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) + '</span>';
        }).join('');
    }
}

// ══════════════════════════════════════════════════════════
// BOOKMARK TIMESTAMPS
// ══════════════════════════════════════════════════════════

const BM_KEY_PREFIX = 'lectureDigest_bookmarks_';
let bmCurrentVideoId = null;
let bmTimeInterval   = null;

function bmKey(videoId) { return BM_KEY_PREFIX + videoId; }

function loadBookmarks(videoId) {
    try { return JSON.parse(localStorage.getItem(bmKey(videoId)) || '[]'); }
    catch { return []; }
}

function saveBookmarks(videoId, list) {
    try { localStorage.setItem(bmKey(videoId), JSON.stringify(list)); } catch {}
}

// ── Init: called when a video is loaded ──
function initBookmarks(videoId) {
    bmCurrentVideoId = videoId;
    stopBmTimer();
    renderBookmarks(videoId);

    // Update current time display every second
    bmTimeInterval = setInterval(() => {
        if (!ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') return;
        try {
            const el = document.getElementById('bookmarkCurrentTime');
            if (el) el.textContent = fmtSecs(Math.floor(ytPlayer.getCurrentTime() || 0));
        } catch {}
    }, 1000);
}

function stopBmTimer() {
    if (bmTimeInterval) { clearInterval(bmTimeInterval); bmTimeInterval = null; }
}

// ── Add bookmark at current playback time ──
function addBookmark() {
    if (!bmCurrentVideoId) return;
    if (!ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') {
        showToast('⚠️ Hãy phát video trước!'); return;
    }
    let secs = 0;
    try { secs = Math.floor(ytPlayer.getCurrentTime() || 0); } catch {}

    // Inline label prompt via a small inline form
    showBookmarkLabelForm(secs);
}

function showBookmarkLabelForm(secs) {
    const list = document.getElementById('bookmarksList');
    if (!list) return;

    // Remove existing form if any
    document.getElementById('bmLabelForm')?.remove();

    const ts = fmtSecs(secs);
    const form = document.createElement('div');
    form.id = 'bmLabelForm';
    form.className = 'bm-label-form';
    form.innerHTML =
        '<span class="bm-form-ts">' + ts + '</span>' +
        '<input class="bm-label-input" id="bmLabelInput" type="text" placeholder="Ghi chú (Enter để lưu)" maxlength="60" autofocus>' +
        '<button class="bm-form-save" onclick="confirmBookmark(' + secs + ')" title="Lưu">✓</button>' +
        '<button class="bm-form-cancel" onclick="cancelBookmarkForm()" title="Huỷ">✕</button>';

    list.insertBefore(form, list.firstChild);

    const inp = document.getElementById('bmLabelInput');
    if (inp) {
        inp.focus();
        inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') confirmBookmark(secs);
            if (e.key === 'Escape') cancelBookmarkForm();
        });
    }
}

function confirmBookmark(secs) {
    recordGamifFeature('usedBookmark');
    const input = document.getElementById('bmLabelInput');
    const label = input ? input.value.trim() : '';
    cancelBookmarkForm();

    const bms = loadBookmarks(bmCurrentVideoId);
    bms.push({
        id:        Date.now(),
        time:      secs,
        label:     label || fmtSecs(secs),
        createdAt: new Date().toISOString()
    });
    // Sort by time
    bms.sort((a, b) => a.time - b.time);
    saveBookmarks(bmCurrentVideoId, bms);
    renderBookmarks(bmCurrentVideoId);
    showToast('🔖 Đã bookmark ' + fmtSecs(secs));
}

function cancelBookmarkForm() {
    document.getElementById('bmLabelForm')?.remove();
}

// ── Delete a bookmark ──
function deleteBookmark(videoId, id) {
    const bms = loadBookmarks(videoId).filter(b => b.id !== id);
    saveBookmarks(videoId, bms);
    renderBookmarks(videoId);
}

// ── Render the bookmarks list card ──
function renderBookmarks(videoId) {
    const list    = document.getElementById('bookmarksList');
    const empty   = document.getElementById('bookmarksEmpty');
    const counter = document.getElementById('bookmarksCount');
    if (!list) return;

    const bms = loadBookmarks(videoId);
    if (counter) counter.textContent = bms.length ? bms.length + ' bookmark' : '';

    if (!bms.length) {
        if (empty) empty.style.display = 'flex';
        // Remove all items except empty state
        [...list.querySelectorAll('.bm-item')].forEach(el => el.remove());
        return;
    }
    if (empty) empty.style.display = 'none';

    // Rebuild items
    [...list.querySelectorAll('.bm-item')].forEach(el => el.remove());

    bms.slice().reverse().forEach(bm => {
        const item = document.createElement('div');
        item.className = 'bm-item';
        item.dataset.id = bm.id;
        item.innerHTML =
            '<button class="bm-ts-badge" onclick="seekToBookmark(' + bm.time + ')" title="Nhảy đến ' + fmtSecs(bm.time) + '">' + fmtSecs(bm.time) + '</button>' +
            '<span class="bm-label" contenteditable="true" onblur="saveBookmarkLabel(\'' + videoId + '\', ' + bm.id + ', this.textContent)" title="Click để sửa">' + escapeHtml(bm.label) + '</span>' +
            '<button class="bm-delete-btn" onclick="deleteBookmark(\'' + videoId + '\', ' + bm.id + ')" title="Xoá bookmark">✕</button>';
        list.appendChild(item);
    });
}

// ── Inline edit label ──
function saveBookmarkLabel(videoId, id, newLabel) {
    const bms = loadBookmarks(videoId);
    const bm  = bms.find(b => b.id === id);
    if (bm) {
        bm.label = newLabel.trim() || fmtSecs(bm.time);
        saveBookmarks(videoId, bms);
    }
}

