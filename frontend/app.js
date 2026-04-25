/* ════════════════════════════════════════════════
   LectureDigest — Frontend Application Logic
   ════════════════════════════════════════════════ */

const API_BASE = '';  // Same origin as frontend (served by FastAPI at localhost:8000)


// ──────────────────────────────────────
// STATE
// ──────────────────────────────────────
let ytPlayer         = null;
let ytApiReady       = false;
let pendingVideoId   = null;
let analysisData     = null;
let selectedLang     = 'Vietnamese'; // default output language

const quizState = {
    questions:    [],
    currentIndex: 0,
    score:        0,
    skipped:      0,
    answered:     false,
};

const chatState = {
    history:  [],   // [{role:'user'|'assistant', content:'...'}]
    isOpen:   false,
    isLoading: false,
};

// ──────────────────────────────────────
// HISTORY (localStorage)
// ──────────────────────────────────────
const HISTORY_KEY = 'lectureDigest_history';
const HISTORY_MAX = 30;

// ──────────────────────────────────────
// NOTES (localStorage per video)
// ──────────────────────────────────────
const NOTES_KEY_PREFIX = 'lectureDigest_note_';
let notesSaveTimer = null;

function notesKey(videoId) { return NOTES_KEY_PREFIX + videoId; }

function loadNote(videoId) {
    try { return localStorage.getItem(notesKey(videoId)) || ''; }
    catch { return ''; }
}

function saveNote(videoId, text) {
    try {
        localStorage.setItem(notesKey(videoId), text);
        if (text.trim().length > 0) recordGamifFeature('usedNotes');
    } catch {}
}

function initNotes(videoId) {
    const textarea = document.getElementById('notesTextarea');
    const status   = document.getElementById('notesSaveStatus');
    const counter  = document.getElementById('notesWordCount');
    if (!textarea) return;

    // Load saved note
    textarea.value = loadNote(videoId);
    updateWordCount(textarea.value, counter);

    // Remove old listener by replacing element clone
    const fresh = textarea.cloneNode(true);
    textarea.parentNode.replaceChild(fresh, textarea);

    fresh.addEventListener('input', () => {
        updateWordCount(fresh.value, counter);
        if (status) { status.textContent = '...'; status.style.color = 'var(--text-muted)'; }
        clearTimeout(notesSaveTimer);
        notesSaveTimer = setTimeout(() => {
            saveNote(videoId, fresh.value);
            if (status) { status.textContent = '✓ Đã lưu'; status.style.color = '#4ade80'; }
        }, 800);
    });
}

function updateWordCount(text, el) {
    if (!el) return;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    el.textContent = words + ' từ';
}

function insertNoteTimestamp() {
    const textarea = document.getElementById('notesTextarea');
    if (!textarea || !ytPlayer) return;

    let secs = 0;
    try { secs = Math.floor(ytPlayer.getCurrentTime() || 0); } catch {}
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    const stamp = `[${m}:${s}] `;

    // Insert at cursor position
    const start = textarea.selectionStart;
    const end   = textarea.selectionEnd;
    const before = textarea.value.substring(0, start);
    const after  = textarea.value.substring(end);
    textarea.value = before + stamp + after;
    textarea.selectionStart = textarea.selectionEnd = start + stamp.length;
    textarea.focus();
    textarea.dispatchEvent(new Event('input'));
}

async function copyNotes() {
    const textarea = document.getElementById('notesTextarea');
    const btn = document.getElementById('notesCopyBtn');
    if (!textarea?.value.trim()) { showToast('📝 Chưa có ghi chú để copy'); return; }
    try {
        await navigator.clipboard.writeText(textarea.value);
        if (btn) {
            btn.style.color = '#4ade80';
            setTimeout(() => btn.style.color = '', 1500);
        }
        showToast('✅ Đã copy ghi chú!');
    } catch {
        showToast('❌ Không thể copy');
    }
}

function exportNotesMarkdown() {
    var textarea = document.getElementById('notesTextarea');
    if (!textarea || !textarea.value.trim()) { showToast('Chua co ghi chu de xuat'); return; }
    var title    = (analysisData && analysisData.title)  || (document.getElementById('videoTitle') && document.getElementById('videoTitle').textContent) || 'Video';
    var author   = (analysisData && analysisData.author) || '';
    var videoUrl = (document.getElementById('urlInput') && document.getElementById('urlInput').value.trim()) || '';
    var now = new Date().toLocaleDateString('vi-VN');
    var md = '# Ghi chu: ' + title + '\n\n';
    if (author)   md += '**Tac gia:** ' + author + '  \n';
    if (videoUrl) md += '**Link:** ' + videoUrl + '  \n';
    md += '**Ngay:** ' + now + '  \n\n---\n\n' + textarea.value;
    var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'notes-' + (title || 'lecture').replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40) + '.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    showToast('Da tai xuong file .md!');
}

function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
    catch { return []; }
}

function saveToHistory(data) {
    const list = loadHistory();
    // Keep old entries — allow multiple analyses of the same video
    // Each entry gets a unique key: video_id + timestamp
    const entry = {
        video_id:    data.video_id,
        entry_id:    data.video_id + '_' + Date.now(),   // unique per analysis
        url:         document.getElementById('urlInput').value.trim(),
        title:       data.title,
        author:      data.author,
        thumbnail:   data.thumbnail,
        savedAt:     Date.now(),
        lang:        selectedLang,
        data,
        transcript:  data.transcript || null,  // store for quiz regeneration
    };
    list.unshift(entry);                       // newest first
    list.splice(HISTORY_MAX);                  // keep max N
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    renderHistoryPanel();
}

function deleteFromHistory(idOrEntryId) {
    // Delete specific entry by entry_id, or all entries for a video_id
    const list = loadHistory().filter(h =>
        h.entry_id ? h.entry_id !== idOrEntryId : h.video_id !== idOrEntryId
    );
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    renderHistoryPanel();
}

function clearHistory() {
    if (!confirm('Xóa toàn bộ lịch sử?')) return;
    localStorage.removeItem(HISTORY_KEY);
    renderHistoryPanel();
}

function loadFromHistory(entryIdOrVideoId) {
    // Find by entry_id first (unique per analysis), fallback to video_id (legacy)
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
            '<div class="hist-meta">' + escHtml(h.author || '') + ' &bull; ' + dateStr + ' ' + timeStr + '</div>' +
            '<div class="hist-lang">' + (h.lang || 'English') + '</div>' +
            '</div>' +
            '<button class="hist-del" onclick="deleteFromHistory(\'' + (h.entry_id || h.video_id) + '\')" title="Xoa">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
            '</button></div>';
    }).join('');
}

function filterHistory(value) { renderHistoryPanel(value); }

function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

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

// ──────────────────────────────────────
// YOUTUBE IFRAME API
// ──────────────────────────────────────
function onYouTubeIframeAPIReady() {
    ytApiReady = true;
    if (pendingVideoId) {
        createPlayer(pendingVideoId);
        pendingVideoId = null;
    }
}

function initYouTubePlayer(videoId) {
    if (!ytApiReady) {
        pendingVideoId = videoId;
        return;
    }

    if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
        ytPlayer.loadVideoById(videoId);
        stopTranscriptSync();   // reset sync for new video
        tsSync_lastIndex = -1;
        return;
    }

    createPlayer(videoId);
}

function createPlayer(videoId) {
    const wrapper = document.getElementById('youtubePlayer');
    wrapper.innerHTML = '';

    const div = document.createElement('div');
    div.id = 'yt-player-div';
    div.style.cssText = 'width:100%;height:100%;';
    wrapper.appendChild(div);

    ytPlayer = new YT.Player('yt-player-div', {
        height: '100%',
        width: '100%',
        videoId,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: window.location.origin },
        events: {
            onStateChange: onYtStateChange
        }
    });
}

function onYtStateChange(event) {
    // YT.PlayerState: PLAYING=1, PAUSED=2, ENDED=0, BUFFERING=3
    if (event.data === 1 || event.data === 3) {   // playing or buffering
        startTranscriptSync();
    } else {
        // Keep sync running on pause so highlight stays accurate
        // but stop only when ended
        if (event.data === 0) stopTranscriptSync();
    }
}

function seekTo(seconds) {
    if (ytPlayer && typeof ytPlayer.seekTo === 'function') {
        ytPlayer.seekTo(seconds, true);
        ytPlayer.playVideo();

        // On mobile, scroll the player into view
        if (window.innerWidth < 900) {
            document.getElementById('youtubePlayer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
}

// ── Seek from bookmark — scroll to top + overlay flash ──
function seekToBookmark(secs) {
    // 1. Seek + play
    if (ytPlayer && typeof ytPlayer.seekTo === 'function') {
        ytPlayer.seekTo(secs, true);
        ytPlayer.playVideo();
    }

    // 2. Scroll to very top of page so player is visible
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // 3. Overlay flash on the player wrapper
    const wrapper = document.getElementById('youtubePlayer');
    if (!wrapper) return;

    // Create a temporary flash overlay
    let flash = document.getElementById('bmFlashOverlay');
    if (!flash) {
        flash = document.createElement('div');
        flash.id = 'bmFlashOverlay';
        flash.style.cssText =
            'position:absolute;inset:0;border-radius:12px;pointer-events:none;z-index:10;'
            + 'border:2px solid rgba(139,92,246,0);transition:border-color 0.1s,opacity 0.5s;opacity:0;';
        // Ensure wrapper is positioned
        wrapper.style.position = 'relative';
        wrapper.appendChild(flash);
    }

    // Animate: flash in then fade out
    flash.style.borderColor = 'rgba(139,92,246,0.9)';
    flash.style.opacity = '1';
    flash.style.boxShadow = 'inset 0 0 0 3px rgba(139,92,246,0.4), 0 0 24px rgba(139,92,246,0.5)';
    flash.style.transition = 'none';

    setTimeout(() => {
        flash.style.transition = 'border-color 0.6s ease, opacity 0.6s ease, box-shadow 0.6s ease';
        flash.style.borderColor = 'rgba(139,92,246,0)';
        flash.style.opacity = '0';
        flash.style.boxShadow = 'none';
    }, 300);
}

// ──────────────────────────────────────
// SECTION MANAGEMENT
// ──────────────────────────────────────
const SECTION_IDS = ['hero', 'loadingSection', 'errorSection', 'resultsSection'];

function showSection(id) {
    SECTION_IDS.forEach(sid => {
        const el = document.getElementById(sid);
        if (el) el.classList.add('hidden');
    });
    const target = document.getElementById(id);
    if (target) target.classList.remove('hidden');
    updateChatFabVisibility();
    // Update browser URL to match the displayed section
    if (typeof pushSpaRoute === 'function') pushSpaRoute(id);
}

function showToast(message, duration = 3000) {
    const existing = document.getElementById('toastNotif');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'toastNotif';
    toast.style.cssText = `
        position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
        background:#1e1e3a; border:1px solid rgba(139,92,246,0.4);
        color:#f1f5f9; padding:12px 20px; border-radius:12px;
        font-size:14px; font-weight:500; z-index:9999;
        box-shadow:0 8px 32px rgba(0,0,0,0.5);
        animation:slideUp 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
}

function goHome() {
    // If results are showing, go back to hero — otherwise do nothing
    const resultsVisible = !document.getElementById('resultsSection')?.classList.contains('hidden');
    const loadingVisible = !document.getElementById('loadingSection')?.classList.contains('hidden');
    if (resultsVisible || loadingVisible) resetToHero();
}

function resetToHero() {
    showSection('hero');
    document.getElementById('urlInput').value = '';
    document.getElementById('analyzeBtn').disabled = false;

    analysisData = null;
    Object.assign(quizState, { questions: [], currentIndex: 0, score: 0, skipped: 0, answered: false });

    if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
        try { ytPlayer.pauseVideo(); } catch (_) {}
    }

    // Scroll back to top smoothly
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Focus the URL input
    setTimeout(() => document.getElementById('urlInput')?.focus(), 300);
}

// ──────────────────────────────────────
// LANGUAGE SELECTOR
// ──────────────────────────────────────
function setLang(btn) {
    selectedLang = btn.dataset.lang;
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

// ──────────────────────────────────────
// LOADING ANIMATION
// ──────────────────────────────────────
function startLoadingAnimation() {
    const statusTexts = [
        'Fetching video transcript...',
        'Analyzing content with Gemini AI...',
        'Generating quiz questions...',
    ];

    function setStep(index) {
        ['step1', 'step2', 'step3'].forEach((id, i) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.classList.remove('active', 'done');
            if (i < index) el.classList.add('done');
            else if (i === index) el.classList.add('active');
        });
        const statusEl = document.getElementById('loadingStatus');
        if (statusEl) statusEl.textContent = statusTexts[index] ?? 'Processing...';
    }

    setStep(0);
    const t1 = setTimeout(() => setStep(1), 2200);
    const t2 = setTimeout(() => setStep(2), 5500);

    // Return cleanup function
    return () => { clearTimeout(t1); clearTimeout(t2); };
}

// ──────────────────────────────────────
// CLIENT-SIDE TRANSCRIPT FETCHER
// Fetches from browser (not blocked by YouTube) and sends to backend.
// Bypasses cloud IP blocks on Render/Railway/etc.
// ──────────────────────────────────────
const CF_WORKER = 'https://delicate-disk-ef3f.tranductrist.workers.dev';

async function fetchTranscriptClientSide(videoId) {
    // Call our Cloudflare Worker which handles YouTube API internally
    const res = await fetch(`${CF_WORKER}/?videoId=${videoId}`);
    let data;
    try {
        data = await res.json();
    } catch (_) {
        throw new Error(`Worker returned non-JSON response (HTTP ${res.status})`);
    }
    if (!res.ok) throw new Error(data?.error || `Worker HTTP ${res.status}`);
    if (!Array.isArray(data) || !data.length) throw new Error('Empty transcript from Worker');
    console.log(`[LectureDigest] Worker transcript: ${data.length} segments`);
    return data;
}


// ──────────────────────────────────────
// MAIN ANALYSE FUNCTION
// ──────────────────────────────────────
// -- Video Length Warning --
var _pendingAnalyzeUrl = null;

function showVlenModal(durationSecs, url) {
    _pendingAnalyzeUrl = url;
    var h = Math.floor(durationSecs / 3600);
    var m = Math.floor((durationSecs % 3600) / 60);
    var durStr = h > 0 ? (h + ' gio ' + m + ' phut') : (m + ' phut');
    var etaMins = Math.ceil((durationSecs / 60) * 0.05);
    var etaStr = etaMins >= 2 ? ('~' + etaMins + ' phut') : '~1 phut';
    var body = document.getElementById('vlenBody');
    if (body) body.innerHTML = 'Video nay dai <strong>' + durStr + '</strong>.<br>Uoc tinh xu ly: <strong>' + etaStr + '</strong>.<br><br>Video rat dai co the bi tom tat khong day du do gioi han token Gemini.';
    var ov = document.getElementById('vlenOverlay');
    if (ov) ov.classList.remove('hidden');
}

function closeVlenModal() {
    var ov = document.getElementById('vlenOverlay');
    if (ov) ov.classList.add('hidden');
    _pendingAnalyzeUrl = null;
    document.getElementById('analyzeBtn').disabled = false;
}

function confirmAnalyze() {
    var ov = document.getElementById('vlenOverlay');
    if (ov) ov.classList.add('hidden');
    _doAnalyze();
}

async function analyzeVideo() {
    var urlInput = document.getElementById('urlInput');
    var searchBox = document.getElementById('searchBox');
    var url = urlInput.value.trim();
    if (!url) {
        urlInput.focus();
        searchBox.style.borderColor = 'rgba(239, 68, 68, 0.55)';
        setTimeout(function() { searchBox.style.borderColor = ''; }, 2200);
        return;
    }
    _pendingAnalyzeUrl = url;
    window._cachedTranscript = null;
    document.getElementById('analyzeBtn').disabled = true;
    try {
        var videoId = (url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/) || [])[1];
        if (videoId) {
            var qt = await fetchTranscriptClientSide(videoId);
            if (qt && qt.length) {
                window._cachedTranscript = qt;
                var lastSeg = qt[qt.length - 1];
                var duration = (lastSeg.start || 0) + (lastSeg.duration || 0);
                if (duration > 3600) { showVlenModal(duration, url); return; }
            }
        }
    } catch(e) {
        console.warn('[LectureDigest] Quick duration check failed:', e.message);
    }
    _doAnalyze();
}

async function _doAnalyze() {
    var urlInput = document.getElementById('urlInput');
    var url = _pendingAnalyzeUrl || urlInput.value.trim();
    if (!url) return;
    document.getElementById('analyzeBtn').disabled = true;
    showSection('loadingSection');
    var stopAnimation = startLoadingAnimation();
    try {
        var clientTranscript = window._cachedTranscript || null;
        window._cachedTranscript = null;
        if (!clientTranscript) {
            try {
                var videoId2 = (url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/) || [])[1];
                if (videoId2) clientTranscript = await fetchTranscriptClientSide(videoId2);
            } catch(e) {
                console.warn('[LectureDigest] Client transcript failed, server will try:', e.message);
            }
        }
        var reqBody = { url: url, language: 'en', output_language: selectedLang };
        if (clientTranscript && clientTranscript.length) reqBody.transcript = clientTranscript;
        var res = await fetch(API_BASE + '/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqBody),
        });
        stopAnimation();
        if (!res.ok) {
            var err = await res.json().catch(function() { return { detail: 'Unknown server error' }; });
            throw new Error(err.detail || ('Server error ' + res.status));
        }
        analysisData = await res.json();
        if (!analysisData.video_id) throw new Error('Response missing video_id');
        if ((!analysisData.transcript || !analysisData.transcript.length) && clientTranscript && clientTranscript.length) {
            analysisData.transcript = clientTranscript;
        }
        clearChat();
        renderResults(analysisData);
        saveToHistory(analysisData);
        initNotes(analysisData.video_id);
        renderTranscript(analysisData.transcript || []);
        initProgress(analysisData.video_id);
        initBookmarks(analysisData.video_id);
        recordStudySession();
        window._spaVideoId = analysisData.video_id;
        showSection('resultsSection');
    } catch(err) {
        stopAnimation();
        var msgEl = document.getElementById('errorMessage');
        var errText = err.message || 'Failed to analyze video. Please try again.';
        var retryMatch = errText.match(/(\d+)s/);
        var is429 = errText.indexOf('429') >= 0 || errText.indexOf('quota') >= 0 || errText.indexOf('RESOURCE_EXHAUSTED') >= 0;
        if (is429 && retryMatch) {
            var secs = parseInt(retryMatch[1], 10);
            if (msgEl) msgEl.innerHTML = 'Gemini dang qua tai. Tu thu lai sau <strong id="cdTimer">' + secs + '</strong>s...';
            showSection('errorSection');
            var cdInterval = setInterval(function() {
                secs--;
                var timerEl = document.getElementById('cdTimer');
                if (timerEl) timerEl.textContent = secs;
                if (secs <= 0) {
                    clearInterval(cdInterval);
                    document.getElementById('analyzeBtn').disabled = false;
                    _doAnalyze();
                }
            }, 1000);
        } else {
            if (msgEl) msgEl.textContent = errText;
            showSection('errorSection');
            document.getElementById('analyzeBtn').disabled = false;
        }
    }
}

// ──────────────────────────────────────
// RENDER RESULTS
// ──────────────────────────────────────
function renderResults(data) {
    // ── Title & author ──
    setText('videoTitle', data.title || 'Untitled Video');
    setText('videoAuthor', data.author ? `By ${data.author}` : '');

    // ── Difficulty badge ──
    const diffEl = document.getElementById('videoDifficulty');
    if (diffEl) {
        const diff = data.difficulty || 'Unknown';
        diffEl.textContent = diff;
        diffEl.className = 'video-difficulty-badge difficulty-' + diff.toLowerCase();
    }

    // ── Overview ──
    setText('overviewText', data.overview || '');

    // ── Key takeaways ──
    const list = document.getElementById('takeawaysList');
    if (list) {
        list.innerHTML = '';
        (data.key_takeaways || []).forEach(t => {
            const li = document.createElement('li');
            li.textContent = t;
            list.appendChild(li);
        });
    }

    // ── Chapter topics ──
    const topicsList = document.getElementById('topicsList');
    const chapterCount = document.getElementById('chapterCount');
    const topics = data.topics || [];

    if (topicsList) {
        topicsList.innerHTML = '';
        topics.forEach(topic => {
            const el = document.createElement('div');
            el.className = 'topic-item';
            el.setAttribute('role', 'listitem');
            el.setAttribute('tabindex', '0');
            el.setAttribute('aria-label', `${topic.title} at ${topic.timestamp_str}`);
            el.onclick = () => seekTo(topic.timestamp);
            el.onkeydown = e => { if (e.key === 'Enter') seekTo(topic.timestamp); };

            el.innerHTML = `
                <div class="topic-emoji" aria-hidden="true">${esc(topic.emoji) || '📌'}</div>
                <div class="topic-content">
                    <div class="topic-header">
                        <span class="topic-title">${esc(topic.title)}</span>
                        <span class="topic-timestamp">${esc(topic.timestamp_str)}</span>
                    </div>
                    <p class="topic-summary">${esc(topic.summary)}</p>
                </div>
            `;
            topicsList.appendChild(el);
        });
    }
    if (chapterCount) chapterCount.textContent = `${topics.length} chapter${topics.length !== 1 ? 's' : ''}`;

    // ── YouTube Player ──
    setTimeout(() => initYouTubePlayer(data.video_id), 80);

    // ── Highlights ──
    renderHighlights(data.highlights || []);

    // ── Quiz ──
    initQuiz(data.quiz || []);
}

// ──────────────────────────────────────
// HIGHLIGHTS (KEY MOMENTS)
// ──────────────────────────────────────
const HL_LABELS = {
    key_insight:   'Key Insight',
    definition:    'Definition',
    example:       'Example',
    turning_point: 'Turning Point',
    summary:       'Summary',
};

function renderHighlights(highlights) {
    const card  = document.getElementById('highlightsCard');
    const list  = document.getElementById('highlightsList');
    const count = document.getElementById('highlightsCount');

    if (!list) return;

    if (!highlights || highlights.length === 0) {
        card?.classList.add('hidden');
        return;
    }

    card?.classList.remove('hidden');
    if (count) count.textContent = `${highlights.length} moment${highlights.length !== 1 ? 's' : ''}`;

    list.innerHTML = highlights.map(h => {
        const type  = h.type || 'key_insight';
        const label = HL_LABELS[type] || type;
        return `
        <div
            class="highlight-card hl-${type}"
            onclick="seekTo(${h.timestamp})"
            role="listitem"
            tabindex="0"
            aria-label="${esc(h.title)} at ${esc(h.timestamp_str)}"
            onkeydown="if(event.key==='Enter') seekTo(${h.timestamp})"
        >
            <div class="hl-header">
                <span class="hl-type-badge">${label}</span>
                <span class="hl-timestamp">${esc(h.timestamp_str)}</span>
            </div>
            <div class="hl-title">${esc(h.title)}</div>
            <div class="hl-desc">${esc(h.description)}</div>
            <div class="hl-seek">▶ Jump to moment</div>
        </div>`;
    }).join('');
}

// ──────────────────────────────────────
// QUIZ LOGIC
// ──────────────────────────────────────
function initQuiz(questions) {
    Object.assign(quizState, {
        questions,
        currentIndex: 0,
        score:        0,
        skipped:      0,
        answered:     false,
    });

    // Reset UI
    document.getElementById('quizResults')?.classList.add('hidden');
    document.getElementById('quizContainer')?.classList.remove('hidden');
    document.getElementById('quizNav')?.classList.remove('hidden');
    document.getElementById('scoreBadge')?.classList.add('hidden');

    renderCurrentQuestion();
}

function renderCurrentQuestion() {
    const { questions, currentIndex } = quizState;
    const total = questions.length;

    if (currentIndex >= total) {
        showQuizResults();
        return;
    }

    const q = questions[currentIndex];

    // Progress
    const pct = total > 0 ? (currentIndex / total) * 100 : 0;
    const fillEl = document.getElementById('quizProgressFill');
    const textEl = document.getElementById('quizProgressText');
    const barEl  = document.getElementById('quizProgressBar');
    if (fillEl) fillEl.style.width = `${pct}%`;
    if (textEl) textEl.textContent = `Question ${currentIndex + 1} of ${total}`;
    if (barEl)  barEl.setAttribute('aria-valuenow', Math.round(pct));

    // Reset nav
    quizState.answered = false;
    document.getElementById('nextBtn')?.classList.add('hidden');
    document.getElementById('skipBtn')?.classList.remove('hidden');

    // Render question HTML
    const letters = ['A', 'B', 'C', 'D'];
    const optionsHtml = (q.options || []).map((opt, i) => `
        <button
            class="quiz-option"
            onclick="selectAnswer(${i})"
            id="opt-${i}"
            aria-label="Option ${letters[i]}: ${esc(opt)}"
        >
            <span class="option-letter" aria-hidden="true">${letters[i]}</span>
            <span class="option-text">${esc(opt)}</span>
        </button>
    `).join('');

    const container = document.getElementById('quizContainer');
    if (container) {
        container.innerHTML = `
            <div class="quiz-question">
                <div class="quiz-question-header">
                    <span class="quiz-diff-badge ${q.difficulty || 'medium'}">${q.difficulty || 'medium'}</span>
                    <button class="quiz-ts-btn" onclick="seekTo(${q.timestamp})" aria-label="Jump to ${q.timestamp_str} in video">
                        ▶ ${esc(q.timestamp_str)}
                    </button>
                </div>
                <p class="quiz-question-text">${esc(q.question)}</p>
                <div class="quiz-options" role="group" aria-label="Answer choices">
                    ${optionsHtml}
                </div>
            </div>
        `;
    }
}

function selectAnswer(selectedIdx) {
    if (quizState.answered) return;
    quizState.answered = true;

    const q = quizState.questions[quizState.currentIndex];
    const correctIdx = q.correct_index ?? 0;
    const isCorrect  = selectedIdx === correctIdx;

    if (isCorrect) quizState.score++;

    // Style options
    const options = document.querySelectorAll('.quiz-option');
    options.forEach((btn, i) => {
        btn.disabled = true;
        if (i === selectedIdx && isCorrect)  btn.classList.add('correct');
        if (i === selectedIdx && !isCorrect) btn.classList.add('wrong');
        if (i === correctIdx && !isCorrect)  btn.classList.add('reveal-correct');
    });

    // Explanation
    if (q.explanation) {
        const expl = document.createElement('div');
        expl.className = 'quiz-explanation';
        expl.innerHTML = `
            <p class="quiz-explanation-label">${isCorrect ? '✓ Correct' : '✗ Incorrect'} — Explanation</p>
            <p class="quiz-explanation-text">${esc(q.explanation)}</p>
        `;
        document.getElementById('quizContainer')?.appendChild(expl);
    }

    // Score badge
    const badge = document.getElementById('scoreBadge');
    if (badge) {
        badge.textContent = `${quizState.score}/${quizState.currentIndex + 1}`;
        badge.classList.remove('hidden');
    }

    // Show Next/Finish button
    document.getElementById('skipBtn')?.classList.add('hidden');
    const nextBtn = document.getElementById('nextBtn');
    if (nextBtn) {
        const isLast = quizState.currentIndex >= quizState.questions.length - 1;
        nextBtn.innerHTML = isLast
            ? 'See Results <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 7l5 5m0 0l-5 5m5-5H6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            : 'Next Question <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 7l5 5m0 0l-5 5m5-5H6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        nextBtn.classList.remove('hidden');
    }
}

function skipQuestion() {
    quizState.skipped++;
    quizState.currentIndex++;
    renderCurrentQuestion();
}

function nextQuestion() {
    quizState.currentIndex++;
    renderCurrentQuestion();
}

function showQuizResults() {
    const { score, questions, skipped } = quizState;
    const answered = questions.length - skipped;
    const pct      = answered > 0 ? Math.round((score / answered) * 100) : 0;

    // Hide active quiz
    document.getElementById('quizContainer')?.classList.add('hidden');
    document.getElementById('quizNav')?.classList.add('hidden');

    // Fill progress bar to 100%
    const fillEl = document.getElementById('quizProgressFill');
    if (fillEl) fillEl.style.width = '100%';
    setText('quizProgressText', 'Quiz Complete!');

    // Result content
    let emoji, message;
    if      (pct >= 90) { emoji = '🏆'; message = 'Outstanding! You mastered this lecture!'; }
    else if (pct >= 75) { emoji = '🎉'; message = 'Great job! You have a solid understanding.'; }
    else if (pct >= 60) { emoji = '👍'; message = 'Good effort! Review the missed sections.'; }
    else if (pct >= 40) { emoji = '📚'; message = 'Keep studying — try rewatching the harder parts.'; }
    else                { emoji = '💪'; message = "Don't give up! Review the lecture and try again."; }

    setText('resultsEmoji',   emoji);
    setText('resultsTitle',   'Quiz Complete!');
    setText('resultsScore',   `${score}/${answered}`);
    setText('resultsMessage', message);

    const breakdown = document.getElementById('resultsBreakdown');
    if (breakdown) {
        breakdown.innerHTML = statBox(score,           'Correct',  'var(--success)')
                            + statBox(answered - score, 'Wrong',    'var(--error)')
                            + statBox(skipped,           'Skipped', 'var(--text-muted)');
    }

    document.getElementById('quizResults')?.classList.remove('hidden');

    // ── Track quiz session ──
    if (answered > 0 && analysisData?.video_id) {
        recordQuizSession(analysisData.video_id, score, answered);
        recordGamifQuiz(score, answered);    // gamification
    }
}

function statBox(num, label, color) {
    return `<div class="breakdown-item">
        <span class="breakdown-num" style="color:${color}">${num}</span>
        <span class="breakdown-label">${label}</span>
    </div>`;
}

function restartQuiz() {
    if (analysisData) initQuiz(analysisData.quiz || []);
}

async function regenerateQuiz() {
    if (!analysisData) return;

    const btn = document.getElementById('regenQuizBtn');
    const origHtml = btn?.innerHTML || '';

    // Get transcript — from current session, history, or re-fetch
    const histEntry = loadHistory().find(h => h.video_id === analysisData.video_id);
    let transcript = analysisData.transcript
        || histEntry?.transcript
        || histEntry?.data?.transcript;

    // If still no transcript, try fetching it now client-side
    if (!transcript?.length) {
        if (btn) { btn.disabled = true; btn.textContent = 'Đang lấy transcript...'; }
        try {
            transcript = await fetchTranscriptClientSide(analysisData.video_id);
            analysisData.transcript = transcript;
        } catch (e) {
            if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
            alert('Không lấy được transcript. Hãy analyze lại video để dùng tính năng này.');
            return;
        }
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v16m8-8H4" stroke-linecap="round" stroke-linejoin="round"/></svg> Đang tạo...`;
    }

    try {
        const existingQuestions = analysisData.quiz || [];

        const res = await fetch(`${API_BASE}/api/quiz`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: analysisData.title || '',
                output_language: selectedLang,
                transcript,
                existing_questions: existingQuestions,  // send existing to avoid duplicates
            }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
            throw new Error(err.detail || `Server error ${res.status}`);
        }
        const data = await res.json();
        if (!data.quiz?.length) throw new Error('No quiz questions returned');

        // APPEND new questions to existing ones
        const merged = [...existingQuestions, ...data.quiz];
        analysisData.quiz = merged;

        saveToHistory(analysisData);  // persist updated quiz to history

        // Restart quiz from beginning with all questions
        initQuiz(merged);
        document.getElementById('quizCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Show toast
        showToast(`➕ Đã thêm ${data.quiz.length} câu hỏi mới! Tổng: ${merged.length} câu`);

    } catch (err) {
        alert(`Thêm câu hỏi thất bại: ${err.message}`);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
    }
}


// ──────────────────────────────────────
// FLASHCARD — EXPORT + STUDY VIEWER
// ──────────────────────────────────────

// ── Shared: build card list from analysisData ──
function buildFlashcards() {
    if (!analysisData) return [];
    const d = analysisData;
    const letters = ['A', 'B', 'C', 'D'];
    const cards = [];

    // Quiz Q&As
    (d.quiz || []).forEach((q, i) => {
        const optsText = (q.options || []).map((o, oi) => letters[oi] + ') ' + o).join('\n');
        const correct  = q.options?.[q.correct_index] ?? '';
        cards.push({
            front: 'Q' + (i+1) + ': ' + q.question + '\n\n' + optsText,
            back:  '\u2713 ' + (letters[q.correct_index] ?? 'A') + ') ' + correct + (q.explanation ? '\n\n' + q.explanation : ''),
            tag: 'quiz', difficulty: q.difficulty || 'medium', rating: null
        });
    });

    // Key Takeaways
    (d.key_takeaways || []).forEach((t, i) => {
        cards.push({
            front: 'Key Takeaway #' + (i+1) + '\n(From: ' + (d.title || 'Lecture') + ')',
            back: t, tag: 'takeaway', rating: null
        });
    });

    // Highlights
    (d.highlights || []).forEach(h => {
        cards.push({
            front: 'What happens at [' + h.timestamp_str + '] in "' + (d.title || 'Lecture') + '"?',
            back: h.title + '\n\n' + h.description,
            tag: 'highlight', rating: null
        });
    });

    return cards;
}

function toggleFcMenu() {
    const menu = document.getElementById('fcMenu');
    const btn  = document.getElementById('fcToggleBtn');
    const isOpen = !menu.classList.contains('hidden');

    if (isOpen) {
        menu.classList.add('hidden');
        btn.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
    } else {
        menu.classList.remove('hidden');
        btn.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
    }
}

// Close dropdown when clicking outside
document.addEventListener('click', e => {
    const dropdown = document.getElementById('fcDropdown');
    if (dropdown && !dropdown.contains(e.target)) {
        document.getElementById('fcMenu')?.classList.add('hidden');
        document.getElementById('fcToggleBtn')?.classList.remove('open');
        document.getElementById('fcToggleBtn')?.setAttribute('aria-expanded', 'false');
    }
});

function exportFlashcards(format) {
    // Close menu
    document.getElementById('fcMenu')?.classList.add('hidden');
    document.getElementById('fcToggleBtn')?.classList.remove('open');

    if (!analysisData) return;
    const d = analysisData;
    const letters = ['A', 'B', 'C', 'D'];

    const cards = []; // Each: { front, back, tags }

    // ── 1. Quiz Q&As ──
    (d.quiz || []).forEach((q, i) => {
        const optsText = (q.options || []).map((o, oi) => `${letters[oi]}) ${o}`).join('\n');
        const correct  = q.options?.[q.correct_index] ?? '';
        const front = `Q${i + 1}: ${q.question}\n\n${optsText}`;
        const back  = `✓ ${letters[q.correct_index] ?? 'A'}) ${correct}${q.explanation ? '\n\n' + q.explanation : ''}`;
        cards.push({ front, back, tags: `LectureDigest quiz ${(q.difficulty || 'medium')}` });
    });

    // ── 2. Key Takeaways ──
    (d.key_takeaways || []).forEach((t, i) => {
        const front = `Key Takeaway #${i + 1}\n(From: ${d.title || 'Lecture'})`;
        cards.push({ front, back: t, tags: 'LectureDigest takeaway' });
    });

    // ── 3. Key Moments / Highlights ──
    (d.highlights || []).forEach(h => {
        const front = `What happens at [${h.timestamp_str}] in "${d.title || 'Lecture'}"?`;
        const back  = `${h.title}\n\n${h.description}`;
        cards.push({ front, back, tags: `LectureDigest highlight ${h.type || ''}` });
    });

    if (cards.length === 0) { alert('No flashcard data available yet — please analyze a video first.'); return; }

    let content, filename, mime;

    if (format === 'anki') {
        // Anki tab-separated format
        const rows = cards.map(c =>
            `${c.front.replace(/\t/g, ' ')}\t${c.back.replace(/\t/g, ' ')}\t${c.tags}`
        );
        content  = '#separator:tab\n#html:false\n#tags column:3\n' + rows.join('\n');
        filename = `${slugify(d.title)}_flashcards_anki.txt`;
        mime     = 'text/plain;charset=utf-8';
    } else {
        // Generic CSV (comma-separated, quoted)
        const header = '"Front","Back","Tags"';
        const rows   = cards.map(c =>
            `${csvQuote(c.front)},${csvQuote(c.back)},${csvQuote(c.tags)}`
        );
        content  = header + '\n' + rows.join('\n');
        filename = `${slugify(d.title)}_flashcards.csv`;
        mime     = 'text/csv;charset=utf-8';
    }

    downloadFile(content, filename, mime);
}

function csvQuote(str) {
    return '"' + String(str ?? '').replace(/"/g, '""') + '"';
}
function slugify(str) {
    return String(str ?? 'flashcards')
        .normalize('NFD')               // decompose: ắ → a + combining marks
        .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
        .replace(/[đĐ]/g, 'd')           // Vietnamese đ doesn't decompose via NFD
        .replace(/[^a-z0-9\s_-]/gi, '') // remove remaining non-ASCII
        .trim()
        .replace(/\s+/g, '_')            // spaces → underscores
        .replace(/_+/g, '_')             // collapse multiple underscores
        .slice(0, 60) || 'flashcards';
}
function downloadFile(content, filename, mime) {
    const blob = new Blob(['\uFEFF' + content], { type: mime }); // BOM for UTF-8
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ──────────────────────────────────────
// FLASHCARD STUDY VIEWER
// ──────────────────────────────────────

let fcCards    = [];   // all cards
let fcFiltered = [];   // filtered subset (all or 'hard' only)
let fcIndex    = 0;    // current card index in fcFiltered
let fcFlipped  = false;
let fcFilterKey = 'all';

function openFlashcardStudy() {
    recordGamifFeature('usedFlashcards');
    // Close dropdown
    document.getElementById('fcMenu')?.classList.add('hidden');
    document.getElementById('fcToggleBtn')?.classList.remove('open');

    fcCards = buildFlashcards();
    if (!fcCards.length) { showToast('⚠️ Hãy analyze video trước!'); return; }

    fcFilterKey = 'all';
    fcFiltered  = [...fcCards];
    fcIndex     = 0;

    // Update header
    const title = analysisData?.title || 'Flashcards';
    const el = document.getElementById('fcModalTitle');
    if (el) el.textContent = title.length > 40 ? title.slice(0, 38) + '…' : title;

    updateFilterBtns();
    renderFcCard();

    // Show modal
    document.getElementById('fcModalOverlay')?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Keyboard handler
    document.addEventListener('keydown', fcKeyHandler);
}

function closeFcModalBtn() {
    document.getElementById('fcModalOverlay')?.classList.add('hidden');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', fcKeyHandler);
}

function closeFcModal(e) {
    if (e.target.id === 'fcModalOverlay') closeFcModalBtn();
}

function fcKeyHandler(e) {
    if (e.key === 'ArrowLeft')  fcNavigate(-1);
    if (e.key === 'ArrowRight') fcNavigate(1);
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flipCard(); }
    if (e.key === 'Escape') closeFcModalBtn();
}

function renderFcCard() {
    const card = fcFiltered[fcIndex];
    if (!card) return;

    // Reset flip
    fcFlipped = false;
    const inner = document.getElementById('fcCardInner');
    if (inner) inner.style.transform = 'rotateY(0deg)';

    // Set text
    const front = document.getElementById('fcFrontText');
    const back  = document.getElementById('fcBackText');
    if (front) front.textContent = card.front;
    if (back)  back.textContent  = card.back;

    // Hide rate buttons until flipped
    const rateBtns = document.getElementById('fcRateBtns');
    if (rateBtns) rateBtns.style.opacity = '0.3';

    // Counter + progress
    const counter = document.getElementById('fcCardCounter');
    if (counter) counter.textContent = (fcIndex + 1) + ' / ' + fcFiltered.length;

    const pct = fcFiltered.length > 1 ? ((fcIndex) / (fcFiltered.length - 1)) * 100 : 100;
    const fill = document.getElementById('fcModalProgressFill');
    if (fill) fill.style.width = pct + '%';

    // Prev/next btn state
    document.getElementById('fcPrevBtn')?.toggleAttribute('disabled', fcIndex === 0);
    document.getElementById('fcNextBtn')?.toggleAttribute('disabled', fcIndex === fcFiltered.length - 1);

    // Tag badge
    const badge = document.getElementById('fcModeBadge');
    if (badge) {
        const tagMap = { quiz: '🧠 Quiz', takeaway: '💡 Takeaway', highlight: '🔥 Highlight' };
        badge.textContent = tagMap[card.tag] || card.tag;
    }
}

function flipCard() {
    fcFlipped = !fcFlipped;
    const inner = document.getElementById('fcCardInner');
    if (inner) inner.style.transform = fcFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)';

    // Show rate buttons when flipped
    const rateBtns = document.getElementById('fcRateBtns');
    if (rateBtns) rateBtns.style.opacity = fcFlipped ? '1' : '0.3';
}

function fcNavigate(dir) {
    const next = fcIndex + dir;
    if (next < 0 || next >= fcFiltered.length) return;
    fcIndex = next;
    renderFcCard();
}

function rateCard(rating) {
    if (!fcFlipped) { flipCard(); return; } // must see answer first
    const card = fcFiltered[fcIndex];
    if (card) {
        // Update rating in master list
        const masterIdx = fcCards.indexOf(card);
        if (masterIdx !== -1) fcCards[masterIdx].rating = rating;
        card.rating = rating;
    }
    // Auto-advance
    if (fcIndex < fcFiltered.length - 1) {
        fcIndex++;
        renderFcCard();
    } else {
        showFcSummary();
    }
}

function showFcSummary() {
    const hard = fcCards.filter(c => c.rating === 'hard').length;
    const ok   = fcCards.filter(c => c.rating === 'ok').length;
    const easy = fcCards.filter(c => c.rating === 'easy').length;
    const unrated = fcCards.filter(c => !c.rating).length;
    const msg = '\uD83C\uDF89 Xong rồi!\n\n\uD83D\uDE30 Khó: ' + hard + '  \uD83D\uDE42 Ổn: ' + ok + '  \uD83D\uDE0A Dễ: ' + easy
        + (unrated ? '\n⏭ Bỏ qua: ' + unrated : '');
    showToast(msg, 4000);
}

function shuffleFcCards() {
    for (let i = fcFiltered.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [fcFiltered[i], fcFiltered[j]] = [fcFiltered[j], fcFiltered[i]];
    }
    fcIndex = 0;
    renderFcCard();
    showToast('🔀 Đã trộn thẻ!', 1500);
}

function fcRestart() {
    // Reset all ratings
    fcCards.forEach(c => c.rating = null);
    fcFilterKey = 'all';
    fcFiltered  = [...fcCards];
    fcIndex     = 0;
    updateFilterBtns();
    renderFcCard();
}

function fcFilterMode(mode) {
    fcFilterKey = mode;
    if (mode === 'hard') {
        fcFiltered = fcCards.filter(c => c.rating === 'hard');
        if (!fcFiltered.length) { showToast('Chưa có thẻ nào được đánh dấu Khó!', 2000); return; }
    } else {
        fcFiltered = [...fcCards];
    }
    fcIndex = 0;
    updateFilterBtns();
    renderFcCard();
}

function updateFilterBtns() {
    document.getElementById('fcFilterAll')?.classList.toggle('active', fcFilterKey === 'all');
    document.getElementById('fcFilterHard')?.classList.toggle('active', fcFilterKey === 'hard');
}

// ──────────────────────────────────────
// PDF EXPORT  (browser print → Save as PDF)
// ──────────────────────────────────────
function exportPDF() {
    if (!analysisData) return;
    const d = analysisData;
    const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    const letters = ['A', 'B', 'C', 'D'];

    const topicsHtml = (d.topics || []).map(t => `
        <div class="chapter">
            <span class="ts">${t.timestamp_str}</span>
            <div>
                <div class="ch-title">${t.emoji || '📌'} ${t.title}</div>
                <div class="ch-summary">${t.summary}</div>
            </div>
        </div>`).join('');

    const quizHtml = (d.quiz || []).map((q, i) => `
        <div class="quiz-item">
            <div class="quiz-q"><span class="qnum">${i + 1}</span>${q.question}
                <span class="diff-badge ${q.difficulty || 'medium'}">${q.difficulty || 'medium'}</span>
            </div>
            <div class="options">
                ${(q.options || []).map((opt, oi) =>
                    `<div class="option ${oi === q.correct_index ? 'correct' : ''}">${letters[oi]}. ${opt}</div>`
                ).join('')}
            </div>
            ${q.explanation ? `<div class="expl">💡 ${q.explanation}</div>` : ''}
        </div>`).join('');

    const takeawaysHtml = (d.key_takeaways || []).map(t =>
        `<div class="takeaway">${t}</div>`).join('');

    const videoUrl = d.video_id ? `youtube.com/watch?v=${d.video_id}` : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${d.title || 'Study Guide'} — LectureDigest</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', -apple-system, sans-serif;
    color: #111827;
    background: #ffffff;
    font-size: 11pt;
    line-height: 1.65;
    padding: 32px 40px 48px;
    max-width: 820px;
    margin: 0 auto;
  }

  /* ── Cover ── */
  .cover {
    background: linear-gradient(135deg, #6d28d9 0%, #4338ca 100%);
    color: white;
    padding: 36px 40px;
    border-radius: 16px;
    margin-bottom: 36px;
  }
  .cover-brand { font-size: 11pt; font-weight: 600; opacity: 0.75; margin-bottom: 12px; letter-spacing: 0.5px; }
  .cover h1 { font-size: 22pt; font-weight: 800; line-height: 1.2; margin-bottom: 14px; }
  .cover-meta { font-size: 10pt; opacity: 0.8; display: flex; gap: 12px; flex-wrap: wrap; }
  .cover-meta span { display: flex; align-items: center; gap: 5px; }
  .diff-pill {
    display: inline-block;
    background: rgba(255,255,255,0.2);
    border: 1px solid rgba(255,255,255,0.3);
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 9.5pt;
    font-weight: 600;
    letter-spacing: 0.3px;
  }

  /* ── Sections ── */
  .section { margin-bottom: 32px; }
  .section-title {
    font-size: 12pt;
    font-weight: 700;
    color: #5b21b6;
    margin-bottom: 14px;
    padding-bottom: 8px;
    border-bottom: 2px solid #ede9fe;
    display: flex; align-items: center; gap: 8px;
  }
  .overview-text { color: #374151; line-height: 1.8; }

  /* ── Takeaways ── */
  .takeaway {
    display: flex; gap: 10px;
    padding: 7px 0;
    border-bottom: 1px solid #f3f4f6;
    color: #374151;
    font-size: 10.5pt;
  }
  .takeaway:last-child { border-bottom: none; }
  .takeaway::before { content: '✓'; color: #059669; font-weight: 700; flex-shrink: 0; margin-top: 1px; }

  /* ── Chapters ── */
  .chapter {
    display: flex; gap: 14px;
    padding: 11px 14px;
    border-radius: 8px;
    margin-bottom: 6px;
    background: #fafafa;
    border: 1px solid #f3f4f6;
    align-items: flex-start;
  }
  .ts {
    background: #ede9fe; color: #5b21b6;
    padding: 3px 9px; border-radius: 5px;
    font-size: 9.5pt; font-weight: 700;
    white-space: nowrap; flex-shrink: 0;
    font-family: 'Courier New', monospace;
    margin-top: 2px;
  }
  .ch-title { font-weight: 600; font-size: 11pt; margin-bottom: 3px; }
  .ch-summary { color: #6b7280; font-size: 10pt; line-height: 1.55; }

  /* ── Quiz ── */
  .quiz-item {
    background: #fafafa;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 14px;
    break-inside: avoid;
  }
  .quiz-q {
    font-weight: 600;
    margin-bottom: 12px;
    display: flex; align-items: flex-start; gap: 8px;
    line-height: 1.5;
  }
  .qnum {
    display: inline-flex; align-items: center; justify-content: center;
    background: #6d28d9; color: white;
    width: 22px; height: 22px; border-radius: 50%;
    font-size: 9.5pt; font-weight: 700;
    flex-shrink: 0; margin-top: 1px;
  }
  .options {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 7px; margin-bottom: 10px;
  }
  .option {
    padding: 7px 11px; border-radius: 6px;
    font-size: 10pt;
    background: white; border: 1px solid #e5e7eb;
    line-height: 1.4;
  }
  .option.correct {
    background: #d1fae5; border-color: #34d399;
    color: #065f46; font-weight: 600;
  }
  .expl {
    font-size: 10pt; color: #374151;
    padding: 9px 12px;
    background: white; border-radius: 6px;
    border-left: 3px solid #10b981;
    line-height: 1.6;
  }
  .diff-badge {
    display: inline-block;
    padding: 1px 7px; border-radius: 4px;
    font-size: 9pt; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.3px;
    margin-left: 6px; flex-shrink: 0;
    vertical-align: middle;
  }
  .diff-badge.easy   { background: #d1fae5; color: #065f46; }
  .diff-badge.medium { background: #fef3c7; color: #92400e; }
  .diff-badge.hard   { background: #fee2e2; color: #991b1b; }

  /* ── Footer ── */
  .footer {
    text-align: center; color: #9ca3af;
    font-size: 9pt; margin-top: 48px;
    padding-top: 16px; border-top: 1px solid #e5e7eb;
  }
  .footer a { color: #6d28d9; text-decoration: none; }

  /* ── Print ── */
  @media print {
    body { padding: 0; }
    .cover { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .option.correct,
    .ts, .qnum, .diff-badge,
    .diff-pill { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .quiz-item { break-inside: avoid; page-break-inside: avoid; }
    .section { break-inside: avoid; }
  }
</style>
</head>
<body>

  <div class="cover">
    <div class="cover-brand">🎓 LectureDigest — Study Guide</div>
    <h1>${d.title || 'Study Guide'}</h1>
    <div class="cover-meta">
      ${d.author ? `<span>👤 ${d.author}</span>` : ''}
      ${d.difficulty ? `<span><span class="diff-pill">${d.difficulty}</span></span>` : ''}
      <span>📅 ${date}</span>
      ${videoUrl ? `<span>🔗 ${videoUrl}</span>` : ''}
    </div>
  </div>

  <div class="section">
    <div class="section-title">📋 Overview</div>
    <p class="overview-text">${d.overview || ''}</p>
  </div>

  <div class="section">
    <div class="section-title">✅ Key Takeaways</div>
    ${takeawaysHtml}
  </div>

  <div class="section">
    <div class="section-title">🗺️ Chapter Timeline</div>
    ${topicsHtml}
  </div>

  <div class="section">
    <div class="section-title">🧠 Knowledge Quiz</div>
    ${quizHtml}
  </div>

  <div class="footer">
    Generated by <strong>LectureDigest</strong> · Powered by Gemini AI
    ${videoUrl ? ` · <a href="https://${videoUrl}" target="_blank">${videoUrl}</a>` : ''}
  </div>

</body>
</html>`;

    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { alert('Please allow popups for this site to export PDF.'); return; }
    win.document.write(html);
    win.document.close();
    // Wait for Google Fonts to load, then print
    setTimeout(() => { win.focus(); win.print(); }, 1200);
}

// ──────────────────────────────────────
// UTILITIES
// ──────────────────────────────────────
function esc(str) {
    if (!str && str !== 0) return '';
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(String(str)));
    return d.innerHTML;
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

// ──────────────────────────────────────
// EVENT LISTENERS
// ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('urlInput');

    // Enter key → analyze
    urlInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') analyzeVideo();
    });

    // Paste: just focus the input, user clicks Analyze manually
});


// ══════════════════════════════════════════════════════════
// CHAT WITH LECTURE
// ══════════════════════════════════════════════════════════

function toggleChat() {
    const panel  = document.getElementById('chatPanel');
    const unread = document.getElementById('chatUnread');

    chatState.isOpen = !chatState.isOpen;
    panel?.classList.toggle('hidden', !chatState.isOpen);

    if (chatState.isOpen) {
        unread?.classList.add('hidden');
        setTimeout(() => document.getElementById('chatInput')?.focus(), 150);
        const msgs = document.getElementById('chatMessages');
        if (msgs) msgs.scrollTop = msgs.scrollHeight;
    }
}

function clearChat() {
    // Reset state
    chatState.history = [];
    chatState.isLoading = false;

    // Reset messages DOM to welcome message only
    const container = document.getElementById('chatMessages');
    if (container) {
        container.innerHTML = `
            <div class="chat-msg assistant">
                <div class="chat-bubble">
                    👋 Xin chào! Tôi đã đọc toàn bộ nội dung bài giảng này. Bạn có thể hỏi tôi bất cứ điều gì về video — nội dung, khái niệm, ví dụ, hay bất kỳ phần nào bạn chưa hiểu rõ!
                </div>
            </div>`;
    }

    // Show suggestions again
    document.getElementById('chatSuggestions')?.classList.remove('hidden');

    // Re-enable send button
    const sendBtn = document.getElementById('chatSendBtn');
    if (sendBtn) sendBtn.disabled = false;

    // Clear input
    const input = document.getElementById('chatInput');
    if (input) { input.value = ''; input.style.height = 'auto'; }
}

async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const message = input?.value.trim();
    if (!message || chatState.isLoading || !analysisData) return;

    // Clear suggestions after first message
    document.getElementById('chatSuggestions')?.classList.add('hidden');

    // Show user message
    appendChatMessage('user', message);
    chatState.history.push({ role: 'user', content: message });
    input.value = '';
    autoResizeChatInput(input);

    // Show typing indicator
    const typingId = showTypingIndicator();
    chatState.isLoading = true;
    document.getElementById('chatSendBtn').disabled = true;

    try {
        const res = await fetch(`${API_BASE}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                title: analysisData.title || '',
                transcript: analysisData.transcript || [],
                history: chatState.history.slice(-10),
                output_language: selectedLang,
            }),
        });

        // Remove typing indicator
        document.getElementById(typingId)?.remove();

        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
            throw new Error(err.detail || `Server error ${res.status}`);
        }

        const data = await res.json();
        const reply = data.reply || 'Xin lỗi, tôi không thể trả lời lúc này.';

        appendChatMessage('assistant', reply);
        chatState.history.push({ role: 'assistant', content: reply });

    } catch (err) {
        document.getElementById(typingId)?.remove();
        appendChatMessage('assistant', `❌ Lỗi: ${err.message}`);
    } finally {
        chatState.isLoading = false;
        document.getElementById('chatSendBtn').disabled = false;
        document.getElementById('chatInput')?.focus();
    }
}

function sendSuggestion(btn) {
    const text = btn.textContent.replace(/^[^\s]+\s/, ''); // strip emoji
    const input = document.getElementById('chatInput');
    if (input) {
        input.value = btn.textContent;
        sendChatMessage();
    }
}

function appendChatMessage(role, content) {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    const wrapper = document.createElement('div');
    wrapper.className = `chat-msg ${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = markdownToHtml(content);

    // Make timestamps clickable
    bubble.querySelectorAll('a[data-ts]').forEach(a => {
        a.addEventListener('click', e => {
            e.preventDefault();
            seekTo(parseInt(a.dataset.ts));
        });
    });

    wrapper.appendChild(bubble);
    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
}

function showTypingIndicator() {
    const container = document.getElementById('chatMessages');
    const id = 'typing_' + Date.now();
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-msg assistant';
    wrapper.id = id;
    wrapper.innerHTML = `<div class="chat-bubble typing-indicator"><span></span><span></span><span></span></div>`;
    container?.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
    return id;
}

function markdownToHtml(text) {
    return text
        // Bold
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        // Timestamps like [02:30] — make them clickable
        .replace(/\[(\d{1,2}):(\d{2})\]/g, (_, m, s) => {
            const secs = parseInt(m) * 60 + parseInt(s);
            return `<a class="chat-ts-link" data-ts="${secs}" href="#" title="Nhảy đến ${m}:${s}">⏱ ${m}:${s}</a>`;
        })
        // Line breaks
        .replace(/\n/g, '<br>');
}

function handleChatKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
    }
}

function autoResizeChatInput(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// Show chat FAB when results are visible, hide on hero
function updateChatFabVisibility() {
    const fab = document.getElementById('chatFab');
    if (!fab) return;
    const resultsVisible = !document.getElementById('resultsSection')?.classList.contains('hidden');
    fab.classList.toggle('hidden', !resultsVisible);
    // Close panel when going back to hero
    if (!resultsVisible && chatState.isOpen) {
        chatState.isOpen = false;
        document.getElementById('chatPanel')?.classList.add('hidden');
    }
}


// ══════════════════════════════════════════════════════════
// TRANSCRIPT SEARCH
// ══════════════════════════════════════════════════════════

let transcriptData = [];     // full [{text, start}, ...]
let matchIndices   = [];     // indices into transcriptData that match query
let currentMatch   = 0;      // which match is currently highlighted

function renderTranscript(transcript) {
    transcriptData = transcript || [];
    const list    = document.getElementById('transcriptList');
    const counter = document.getElementById('transcriptCount');
    if (!list) return;

    if (!transcriptData.length) {
        list.innerHTML = '<div class="transcript-empty">Không có transcript cho video này</div>';
        if (counter) counter.textContent = '';
        return;
    }
    if (counter) counter.textContent = transcriptData.length + ' đoạn';

    list.innerHTML = transcriptData.map((entry, i) => {
        const secs = Math.floor(entry.start || 0);
        const ts   = fmtSecs(secs);
        const text = escapeHtml(entry.text.trim().replace(/\n/g, ' '));
        return '<div class="transcript-line" id="tl-' + i + '" role="listitem" data-index="' + i + '" data-secs="' + secs + '" onclick="seekTo(' + secs + ')">'
             + '<span class="tl-ts">' + ts + '</span>'
             + '<span class="tl-text" id="tlt-' + i + '">' + text + '</span>'
             + '</div>';
    }).join('');

    // Start karaoke sync (will activate once player plays)
    startTranscriptSync();
}

function fmtSecs(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
    return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function searchTranscript(query) {
    const clearBtn  = document.getElementById('transcriptClearBtn');
    const matchInfo = document.getElementById('transcriptMatchInfo');
    if (!query.trim()) { clearTranscriptSearch(); return; }

    clearBtn?.classList.remove('hidden');
    const q = query.toLowerCase();
    matchIndices = [];
    transcriptData.forEach((entry, i) => {
        if (entry.text.toLowerCase().includes(q)) matchIndices.push(i);
    });
    currentMatch = 0;

    // Highlight matches, dim non-matches
    transcriptData.forEach((entry, i) => {
        const line   = document.getElementById('tl-' + i);
        const textEl = document.getElementById('tlt-' + i);
        if (!line || !textEl) return;
        const text = escapeHtml(entry.text.trim().replace(/\n/g, ' '));
        if (matchIndices.includes(i)) {
            line.classList.add('tl-match');
            line.classList.remove('tl-dim');
            textEl.innerHTML = text.replace(
                new RegExp('(' + escapeRegex(escapeHtml(query)) + ')', 'gi'),
                '<mark class="tl-highlight">$1</mark>'
            );
        } else {
            line.classList.remove('tl-match');
            line.classList.add('tl-dim');
            textEl.innerHTML = text;
        }
    });

    updateMatchCounter();
    matchInfo?.classList.toggle('hidden', matchIndices.length === 0);
    if (matchIndices.length > 0) scrollToMatch(matchIndices[0]);
}

function clearTranscriptSearch() {
    const inp = document.getElementById('transcriptSearchInput');
    if (inp) inp.value = '';
    document.getElementById('transcriptClearBtn')?.classList.add('hidden');
    document.getElementById('transcriptMatchInfo')?.classList.add('hidden');
    matchIndices = []; currentMatch = 0;
    transcriptData.forEach((entry, i) => {
        const line   = document.getElementById('tl-' + i);
        const textEl = document.getElementById('tlt-' + i);
        if (!line || !textEl) return;
        line.classList.remove('tl-match', 'tl-dim', 'tl-active');
        textEl.innerHTML = escapeHtml(entry.text.trim().replace(/\n/g, ' '));
    });
}

function navigateMatch(dir) {
    if (!matchIndices.length) return;
    currentMatch = (currentMatch + dir + matchIndices.length) % matchIndices.length;
    updateMatchCounter();
    scrollToMatch(matchIndices[currentMatch]);
}

function updateMatchCounter() {
    const el = document.getElementById('transcriptMatchText');
    if (el) el.textContent = matchIndices.length
        ? (currentMatch + 1) + '/' + matchIndices.length
        : 'Không tìm thấy';
}

function scrollToMatch(lineIndex) {
    document.querySelectorAll('.tl-active').forEach(el => el.classList.remove('tl-active'));
    const line = document.getElementById('tl-' + lineIndex);
    if (line) {
        line.classList.add('tl-active');
        line.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
}


// ══════════════════════════════════════════════════════════
// SHARE RESULTS
// ══════════════════════════════════════════════════════════

function openShareModal() {
    if (!analysisData) return;
    const d = analysisData;
    const videoUrl = 'https://www.youtube.com/watch?v=' + (d.video_id || '');

    setText('sharePreviewTitle',  d.title || '');
    setText('sharePreviewAuthor', d.author ? '\u{1F464} ' + d.author : '');
    setText('sharePreviewSummary', d.overview
        ? (d.overview.length > 200 ? d.overview.slice(0, 197) + '\u2026' : d.overview)
        : '');
    setText('sharePreviewUrl', videoUrl);

    const taEl = document.getElementById('sharePreviewTakeaways');
    if (taEl) {
        const items = (d.key_takeaways || []).slice(0, 3);
        taEl.innerHTML = items.map(t =>
            '<div class="sp-ta-item">\u2736 ' + escapeHtml(t.length > 100 ? t.slice(0,97)+'\u2026' : t) + '</div>'
        ).join('');
    }

    const nativeBtn = document.getElementById('shareNativeBtn');
    if (nativeBtn) nativeBtn.style.display = navigator.share ? 'flex' : 'none';

    document.getElementById('shareModalOverlay')?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function closeShareModalBtn() {
    document.getElementById('shareModalOverlay')?.classList.add('hidden');
    document.body.style.overflow = '';
}

function closeShareModal(e) {
    if (e.target.id === 'shareModalOverlay') closeShareModalBtn();
}

async function shareNative() {
    if (!analysisData || !navigator.share) return;
    const d = analysisData;
    const url = 'https://www.youtube.com/watch?v=' + (d.video_id || '');
    try {
        await navigator.share({ title: d.title || 'Bai giang hay', text: buildShareText(d), url: url });
    } catch (e) {
        if (e.name !== 'AbortError') showToast('Khong the chia se: ' + e.message);
    }
}

async function copyShareText() {
    if (!analysisData) return;
    try {
        await navigator.clipboard.writeText(buildShareText(analysisData));
        showToast('\u2705 Da copy noi dung!');
    } catch { showToast('\u274C Khong the copy'); }
}

async function copyYouTubeLink() {
    if (!analysisData?.video_id) return;
    const url = 'https://www.youtube.com/watch?v=' + analysisData.video_id;
    try {
        await navigator.clipboard.writeText(url);
        showToast('\u2705 Da copy link video!');
    } catch { showToast('\u274C Khong the copy'); }
}

function buildShareText(d) {
    const url = 'https://www.youtube.com/watch?v=' + (d.video_id || '');
    const sep = '\n' + '─'.repeat(40) + '\n';
    let text  = '📚 ' + (d.title || 'Bai giang') + '\n';
    if (d.author) text += '👤 ' + d.author + '\n';
    text += '🔗 ' + url + '\n';
    if (d.overview) text += sep + '📋 TOM TAT\n' + d.overview;
    const takes = (d.key_takeaways || []).slice(0, 5);
    if (takes.length) { text += sep + '💡 KEY TAKEAWAYS\n'; text += takes.map((t,i) => (i+1)+'. '+t).join('\n'); }
    const chaps = (d.chapters || []).slice(0, 6);
    if (chaps.length) { text += sep + '📑 CHAPTERS\n'; text += chaps.map(c => '[' + (c.timestamp_str||'') + '] ' + c.title).join('\n'); }
    text += sep + '✨ Phan tich boi LectureDigest AI';
    return text;
}


// ══════════════════════════════════════════════════════════
// MIND MAP  (D3.js radial tree)
// ══════════════════════════════════════════════════════════

let mmZoom = null;

// ── Build D3 hierarchy data from analysisData ──
function buildMindMapData(d) {
    const truncate = (s, n) => s && s.length > n ? s.slice(0, n - 1) + '…' : (s || '');

    const root = {
        name: truncate(d.title || 'Video', 50),
        type: 'root',
        children: []
    };

    // Chapters branch
    if (d.chapters && d.chapters.length) {
        root.children.push({
            name: '📑 Chapters',
            type: 'category',
            color: '#4f46e5',
            children: d.chapters.map(c => ({
                name: truncate(c.title, 999),
                type: 'chapter',
                extra: c.timestamp_str || '',
                color: '#4f46e5'
            }))
        });
    }

    // Key Takeaways branch
    if (d.key_takeaways && d.key_takeaways.length) {
        root.children.push({
            name: '💡 Takeaways',
            type: 'category',
            color: '#0891b2',
            children: d.key_takeaways.map(t => ({
                name: truncate(t, 999),
                type: 'takeaway',
                color: '#0891b2'
            }))
        });
    }

    // Highlights branch
    if (d.highlights && d.highlights.length) {
        root.children.push({
            name: '🔥 Key Moments',
            type: 'category',
            color: '#b45309',
            children: d.highlights.map(h => ({
                name: truncate(h.title, 999),
                type: 'highlight',
                extra: h.timestamp_str || '',
                color: '#b45309'
            }))
        });
    }

    // Key Terms from key_terms or vocabulary
    const terms = d.key_terms || d.vocabulary || [];
    if (terms.length) {
        root.children.push({
            name: '📖 Terms',
            type: 'category',
            color: '#059669',
            children: terms.slice(0, 12).map(t => ({
                name: truncate(typeof t === 'string' ? t : (t.term || t.word || ''), 999),
                type: 'term',
                color: '#059669'
            }))
        });
    }

    return root;
}

function openMindMap() {
    if (!analysisData) return;

    const overlay = document.getElementById('mmModalOverlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Set title
    const titleEl = document.getElementById('mmTitle');
    const vid = analysisData.title || 'Sơ đồ tư duy';
    if (titleEl) titleEl.textContent = vid.length > 50 ? vid.slice(0, 48) + '…' : vid;

    // Render after DOM is ready
    setTimeout(() => renderMindMap(), 50);

    document.addEventListener('keydown', mmKeyHandler);
}

function closeMindMap() {
    document.getElementById('mmModalOverlay')?.classList.add('hidden');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', mmKeyHandler);
}

function mmKeyHandler(e) {
    if (e.key === 'Escape') closeMindMap();
}

// ── Word-wrap helper for mind map labels — no truncation ──
function wrapText(str, limit) {
    const words = str.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
        if (cur && (cur + ' ' + w).length > limit) {
            lines.push(cur);
            cur = w;
        } else {
            cur = cur ? cur + ' ' + w : w;
        }
    }
    if (cur) lines.push(cur);
    return lines;
}

function renderMindMap() {
    recordGamifFeature('usedMindMap');
    const svg = d3.select('#mmSvg');
    svg.selectAll('*').remove();

    const area = document.getElementById('mmCanvasArea');
    const W    = area.clientWidth  || 960;
    const H    = area.clientHeight || 580;

    const COLORS = {
        root:     { node: '#7c3aed', glow: '#7c3aed', text: '#f1f1f1'  },
        category: { node: '#7c3aed', glow: '#9333ea', text: '#e9d5ff'  },
        chapter:  { node: '#4338ca', glow: '#6366f1', text: '#c7d2fe'  },
        takeaway: { node: '#0e7490', glow: '#22d3ee', text: '#a5f3fc'  },
        highlight:{ node: '#92400e', glow: '#f59e0b', text: '#fde68a'  },
        term:     { node: '#065f46', glow: '#10b981', text: '#a7f3d0'  },
    };
    const getColor = (d, prop) => (COLORS[d.data.type] || COLORS.chapter)[prop];

    // ── Build data + layout ──
    const rawData = buildMindMapData(analysisData);
    const root    = d3.hierarchy(rawData);
    const leaves  = root.leaves().length;

    // Enough radius so leaf labels don't overlap
    // base radius for depth-1 nodes, leafR for depth-2
    const innerR = Math.min(W, H) * 0.20;
    const outerR = Math.min(W, H) * 0.44;

    const treeLayout = d3.tree()
        .size([2 * Math.PI, outerR])
        .separation((a, b) => {
            if (a.depth === 0 || b.depth === 0) return 1;
            return (a.parent === b.parent ? 1.3 : 2.2) / a.depth;
        });

    treeLayout(root);

    // Push depth-1 nodes to innerR
    root.each(d => { if (d.depth === 1) d.y = innerR; });

    // ── SVG defs — glow filters ──
    const defs = svg.append('defs');
    Object.entries(COLORS).forEach(([type, col]) => {
        const f = defs.append('filter')
            .attr('id', 'glow-' + type)
            .attr('x', '-80%').attr('y', '-80%')
            .attr('width', '260%').attr('height', '260%');
        f.append('feGaussianBlur').attr('stdDeviation', '5').attr('result', 'blur');
        const fm = f.append('feMerge');
        fm.append('feMergeNode').attr('in', 'blur');
        fm.append('feMergeNode').attr('in', 'SourceGraphic');
    });

    // ── Main group + zoom ──
    const g = svg.append('g').attr('id', 'mmGroup');

    mmZoom = d3.zoom()
        .scaleExtent([0.25, 5])
        .on('zoom', ev => g.attr('transform', ev.transform));

    svg.call(mmZoom)
       .attr('width', W).attr('height', H)
       .call(mmZoom.transform, d3.zoomIdentity.translate(W/2, H/2));

    // Helper: radial → cartesian
    const pt = (angle, r) => [Math.sin(angle) * r, -Math.cos(angle) * r];

    // ── Links ──
    g.selectAll('.mm-link')
        .data(root.links())
        .join('path')
        .attr('class', 'mm-link')
        .attr('d', d3.linkRadial().angle(d => d.x).radius(d => d.y))
        .attr('fill', 'none')
        .attr('stroke', d => getColor(d.target, 'glow'))
        .attr('stroke-width', d => d.target.depth === 1 ? 2.5 : 1.5)
        .attr('stroke-opacity', d => d.target.depth === 1 ? 0.55 : 0.35)
        .attr('stroke-linecap', 'round');

    // ── Nodes ──
    const node = g.selectAll('.mm-node')
        .data(root.descendants())
        .join('g')
        .attr('class', 'mm-node')
        .attr('transform', d => {
            const [x, y] = pt(d.x, d.y);
            return 'translate(' + x + ',' + y + ')';
        });

    // Glow halo for depth 0-1
    node.filter(d => d.depth <= 1)
        .append('circle')
        .attr('r', d => d.depth === 0 ? 26 : 16)
        .attr('fill', d => getColor(d, 'node'))
        .attr('opacity', 0.18)
        .attr('filter', d => 'url(#glow-' + d.data.type + ')');

    // Main circle
    node.append('circle')
        .attr('r', d => d.depth === 0 ? 14 : d.depth === 1 ? 9 : 5)
        .attr('fill', d => getColor(d, 'node'))
        .attr('stroke', '#08081a')
        .attr('stroke-width', d => d.depth === 0 ? 3 : 2)
        .attr('filter', d => d.depth <= 1 ? 'url(#glow-' + d.data.type + ')' : null);

    // ── Labels — carefully positioned, no overlap ──
    node.each(function(d) {
        const el = d3.select(this);
        const [nx, ny] = pt(d.x, d.y);   // absolute pos (relative to g center)

        if (d.depth === 0) {
            // Root: short title BELOW the circle
            const short = (analysisData.title || 'Video').slice(0, 28);
            const label = short.length < (analysisData.title || '').length ? short + '…' : short;
            el.append('text')
              .attr('y', 24)
              .attr('text-anchor', 'middle')
              .attr('font-size', '11px')
              .attr('font-weight', '600')
              .attr('fill', '#c4b5fd')
              .attr('font-family', 'Inter, system-ui, sans-serif')
              .style('paint-order', 'stroke')
              .style('stroke', '#08081a')
              .style('stroke-width', '3px')
              .text(label);
            return;
        }

        // Determine left vs right based on x-coordinate of THIS node
        const isRight = nx >= 0;
        const pad = d.depth === 1 ? 15 : 10;

        const txt = el.append('text')
            .attr('dy', '0.35em')
            .attr('x', isRight ? pad : -pad)
            .attr('text-anchor', isRight ? 'start' : 'end')
            .attr('font-size', d.depth === 1 ? '11.5px' : '10px')
            .attr('font-weight', d.depth === 1 ? '700' : '400')
            .attr('fill', getColor(d, 'text'))
            .attr('font-family', 'Inter, system-ui, sans-serif')
            .style('paint-order', 'stroke')
            .style('stroke', '#08081a')
            .style('stroke-width', '4px');

        // Wrap text into ≤ 2 tspan lines of ~22 chars each
        const name  = d.data.name || '';
        const LIMIT = d.depth === 1 ? 24 : 22;
        if (name.length <= LIMIT) {
            txt.text(name);
        } else {
            // Break at space near LIMIT
            const sp = name.lastIndexOf(' ', LIMIT);
            const ln1 = name.slice(0, sp > 0 ? sp : LIMIT);
            const ln2 = name.slice(sp > 0 ? sp + 1 : LIMIT);
            const short2 = ln2.length > LIMIT ? ln2.slice(0, LIMIT - 1) + '…' : ln2;
            txt.append('tspan')
               .attr('x', isRight ? pad : -pad)
               .attr('dy', '-0.6em')
               .text(ln1);
            txt.append('tspan')
               .attr('x', isRight ? pad : -pad)
               .attr('dy', '1.2em')
               .text(short2);
        }
    });

    // ── Tooltip ──
    const tooltip = document.getElementById('mmTooltip');
    node.filter(d => d.depth > 0)
        .on('mouseover', function(event, d) {
            if (!tooltip) return;
            const txt = d.data.name + (d.data.extra ? '\n⏱ ' + d.data.extra : '');
            tooltip.textContent = txt;
            tooltip.classList.remove('hidden');
            moveTooltip(event);
        })
        .on('mousemove', moveTooltip)
        .on('mouseleave', () => tooltip?.classList.add('hidden'));

    function moveTooltip(event) {
        if (!tooltip) return;
        const rect = area.getBoundingClientRect();
        tooltip.style.left = (event.clientX - rect.left + 14) + 'px';
        tooltip.style.top  = (event.clientY - rect.top  - 10) + 'px';
    }

    g.style('opacity', 0).transition().duration(500).style('opacity', 1);
}


function mmResetZoom() {
    const area = document.getElementById('mmCanvasArea');
    const W = area?.clientWidth || 900;
    const H = area?.clientHeight || 560;
    const svg = d3.select('#mmSvg');
    if (mmZoom) svg.transition().duration(400)
        .call(mmZoom.transform, d3.zoomIdentity.translate(W / 2, H / 2));
}

function mmDownload() {
    const svgEl = document.getElementById('mmSvg');
    if (!svgEl) return;

    // Inline styles into SVG for export
    const serializer  = new XMLSerializer();
    let   svgStr      = serializer.serializeToString(svgEl);

    // Inject background
    svgStr = svgStr.replace('<svg', '<svg style="background:#0f0f1e"');

    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);

    // Convert to PNG via canvas
    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width  = svgEl.clientWidth  * 2;
        canvas.height = svgEl.clientHeight * 2;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0f0f1e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);

        canvas.toBlob(blob2 => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob2);
            const slug = (analysisData?.title || 'mindmap').slice(0, 30).replace(/\s+/g, '_');
            a.download = slug + '_mindmap.png';
            a.click();
        }, 'image/png');
    };
    img.src = url;
    showToast('⬇ Đang tải xuống PNG...', 2000);
}


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


// ══════════════════════════════════════════════════════════
// TRANSCRIPT AUTO-HIGHLIGHT SYNC  (karaoke-style)
// ══════════════════════════════════════════════════════════

let tsSync_interval  = null;
let tsSync_lastIndex = -1;
let tsSync_userScrolling = false;
let tsSync_scrollTimer   = null;

function startTranscriptSync() {
    stopTranscriptSync();
    tsSync_lastIndex = -1;

    // Detect manual scroll → pause auto-scroll briefly
    const container = document.getElementById('transcriptList');
    if (container) {
        container.addEventListener('scroll', onTsUserScroll, { passive: true });
    }

    tsSync_interval = setInterval(syncTranscriptHighlight, 500);
}

function stopTranscriptSync() {
    if (tsSync_interval) { clearInterval(tsSync_interval); tsSync_interval = null; }
    const container = document.getElementById('transcriptList');
    if (container) container.removeEventListener('scroll', onTsUserScroll);
}

function onTsUserScroll() {
    tsSync_userScrolling = true;
    clearTimeout(tsSync_scrollTimer);
    tsSync_scrollTimer = setTimeout(() => { tsSync_userScrolling = false; }, 3000);
}

function syncTranscriptHighlight() {
    if (!ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') return;
    const container = document.getElementById('transcriptList');
    if (!container) return;

    let currentSecs;
    try { currentSecs = ytPlayer.getCurrentTime() || 0; } catch { return; }

    // Get all transcript lines
    const lines = container.querySelectorAll('.transcript-line');
    if (!lines.length) return;

    // Binary-search for the active line (last line whose data-secs <= currentSecs)
    let lo = 0, hi = lines.length - 1, bestIdx = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (parseInt(lines[mid].dataset.secs, 10) <= currentSecs) {
            bestIdx = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    if (bestIdx === tsSync_lastIndex) return;   // no change
    tsSync_lastIndex = bestIdx;

    // Remove old active
    container.querySelectorAll('.tl-sync-active').forEach(el => el.classList.remove('tl-sync-active'));

    const activeLine = lines[bestIdx];
    activeLine.classList.add('tl-sync-active');

    // ── Smart scroll: ONLY move if line is outside visible area ──
    if (!tsSync_userScrolling) {
        const MARGIN    = 0.20;   // 20% buffer zone top and bottom
        const contH     = container.clientHeight;
        const scrollTop = container.scrollTop;

        // Position of line relative to container top
        const lineTop    = activeLine.offsetTop - container.offsetTop;
        const lineBottom = lineTop + activeLine.offsetHeight;

        const visTop    = scrollTop + contH * MARGIN;
        const visBottom = scrollTop + contH * (1 - MARGIN);

        // Only scroll if line is outside the comfortable visible zone
        if (lineTop < visTop || lineBottom > visBottom) {
            const target = lineTop - (contH / 2) + (activeLine.offsetHeight / 2);
            container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
        }
    }
}


// ══════════════════════════════════════════════════════════
// TRANSCRIPT TRANSLATION
// ══════════════════════════════════════════════════════════

let tsTranslations  = [];   // [{start, text, translation}]
let tsShowTranslation = true;

async function translateTranscript() {
    recordGamifFeature('usedTranslation');
    if (!transcriptData || !transcriptData.length) {
        showToast('⚠️ Không có transcript để dịch'); return;
    }
    const lang    = document.getElementById('tsLangSelect')?.value || 'Vietnamese';
    const btn     = document.getElementById('tsTranslateBtn');
    const chunks  = Math.ceil(transcriptData.length / 40);
    const plural  = chunks > 1 ? ' (' + chunks + ' phần)' : '';

    // Loading state
    if (btn) { btn.disabled = true; btn.textContent = 'Đang dịch...'; }
    showToast('🌐 Đang dịch transcript' + plural + '...', 0);

    try {
        const res = await fetch('/api/translate-transcript', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ transcript: transcriptData, target_language: lang })
        });

        if (!res.ok) {
            const errText = await res.text();
            if (res.status === 503) {
                showToast('⏳ Gemini đang bận, thử lại sau 10 giây...', 4000);
                // Auto retry once after 10s
                setTimeout(translateTranscript, 10000);
                return;
            }
            throw new Error(errText);
        }

        const data = await res.json();
        tsTranslations    = data.translations || [];
        tsShowTranslation = true;
        renderTranslations();
        document.getElementById('tsTranslateToggle')?.classList.remove('hidden');
        document.getElementById('tsTranslateClear')?.classList.remove('hidden');
        showToast('✅ Đã dịch xong ' + tsTranslations.length + ' đoạn!', 2500);
    } catch (e) {
        showToast('❌ Lỗi dịch: ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Dịch'; }
    }
}

function renderTranslations() {
    const list = document.getElementById('transcriptList');
    if (!list) return;

    // Remove existing translation spans
    list.querySelectorAll('.tl-translation').forEach(el => el.remove());

    if (!tsShowTranslation || !tsTranslations.length) return;

    tsTranslations.forEach((seg, i) => {
        if (!seg.translation) return;
        const line = document.getElementById('tl-' + i);
        if (!line) return;
        // Remove existing
        line.querySelector('.tl-translation')?.remove();
        const span = document.createElement('span');
        span.className = 'tl-translation';
        span.textContent = seg.translation;
        line.appendChild(span);
    });
}

function toggleTranslation() {
    tsShowTranslation = !tsShowTranslation;
    const btn = document.getElementById('tsTranslateToggle');
    if (btn) btn.textContent = tsShowTranslation ? 'Ẩn dịch' : 'Hiện dịch';
    renderTranslations();
}

function clearTranslation() {
    tsTranslations = [];
    tsShowTranslation = true;
    const list = document.getElementById('transcriptList');
    list?.querySelectorAll('.tl-translation').forEach(el => el.remove());
    document.getElementById('tsTranslateToggle')?.classList.add('hidden');
    document.getElementById('tsTranslateClear')?.classList.add('hidden');
    const btn = document.getElementById('tsTranslateToggle');
    if (btn) btn.textContent = 'Ẩn dịch';
    showToast('🗑 Đã xoá bản dịch', 1500);
}


// ══════════════════════════════════════════════════════════
// GAMIFICATION — STUDY STREAK + BADGES
// ══════════════════════════════════════════════════════════

const GAMIF_KEY = 'lectureDigest_gamification';

// ── Badge definitions ──────────────────────────────────────
const BADGES = [
    // 📚 Video Milestones
    { id: 'first_video',    cat: 'videos',   icon: '🎬', name: 'Người mới bắt đầu',  desc: 'Phân tích video đầu tiên',          check: g => g.totalVideos >= 1 },
    { id: 'videos_5',       cat: 'videos',   icon: '🎓', name: 'Học viên tích cực',   desc: 'Phân tích 5 videos',                check: g => g.totalVideos >= 5 },
    { id: 'videos_10',      cat: 'videos',   icon: '📚', name: 'Thư viện tri thức',   desc: 'Phân tích 10 videos',               check: g => g.totalVideos >= 10 },
    { id: 'videos_25',      cat: 'videos',   icon: '🏛️', name: 'Giáo sư',            desc: 'Phân tích 25 videos',               check: g => g.totalVideos >= 25 },
    // 🧠 Quiz
    { id: 'first_quiz',     cat: 'quiz',     icon: '🧪', name: 'Bắt đầu kiểm tra',  desc: 'Hoàn thành quiz đầu tiên',          check: g => g.totalQuizzes >= 1 },
    { id: 'quiz_ace',       cat: 'quiz',     icon: '⭐', name: 'Điểm hoàn hảo',      desc: 'Đạt 100% trong một quiz',           check: g => g.perfectQuizzes >= 1 },
    { id: 'quizzes_10',     cat: 'quiz',     icon: '🏆', name: 'Quiz Master',         desc: 'Hoàn thành 10 quizzes',             check: g => g.totalQuizzes >= 10 },
    { id: 'quizzes_25',     cat: 'quiz',     icon: '🎯', name: 'Chiến binh câu hỏi', desc: 'Hoàn thành 25 quizzes',             check: g => g.totalQuizzes >= 25 },
    // 🔥 Streaks
    { id: 'streak_3',       cat: 'streak',   icon: '🔥', name: 'Khởi động',          desc: 'Học 3 ngày liên tiếp',              check: g => g.longestStreak >= 3 },
    { id: 'streak_7',       cat: 'streak',   icon: '💥', name: 'Bùng cháy',          desc: 'Học 7 ngày liên tiếp',              check: g => g.longestStreak >= 7 },
    { id: 'streak_14',      cat: 'streak',   icon: '🌊', name: 'Không thể ngăn cản', desc: 'Học 14 ngày liên tiếp',             check: g => g.longestStreak >= 14 },
    { id: 'streak_30',      cat: 'streak',   icon: '🌟', name: 'Huyền thoại',        desc: 'Học 30 ngày liên tiếp',             check: g => g.longestStreak >= 30 },
    // 🛠 Features
    { id: 'bookmarker',     cat: 'feature',  icon: '🔖', name: 'Người đánh dấu',     desc: 'Tạo bookmark đầu tiên',             check: g => g.usedBookmark },
    { id: 'translator',     cat: 'feature',  icon: '🌐', name: 'Đa ngôn ngữ',        desc: 'Dịch transcript lần đầu',           check: g => g.usedTranslation },
    { id: 'mind_mapper',    cat: 'feature',  icon: '🗺️', name: 'Người lập bản đồ',  desc: 'Tạo sơ đồ tư duy',                 check: g => g.usedMindMap },
    { id: 'note_taker',     cat: 'feature',  icon: '📝', name: 'Người ghi chép',     desc: 'Viết ghi chú đầu tiên',             check: g => g.usedNotes },
    { id: 'flashcard_fan',  cat: 'feature',  icon: '🃏', name: 'Flashcard Fan',       desc: 'Ôn tập với flashcards',             check: g => g.usedFlashcards },
    { id: 'all_features',   cat: 'feature',  icon: '🚀', name: 'Người khám phá',     desc: 'Dùng tất cả tính năng',             check: g => g.usedBookmark && g.usedTranslation && g.usedMindMap && g.usedNotes && g.usedFlashcards },
];

const CAT_LABELS = { videos: '📚 Video', quiz: '🧠 Quiz', streak: '🔥 Streak', feature: '🛠 Tính năng' };

function defaultGamif() {
    return {
        currentStreak:  0,
        longestStreak:  0,
        lastStudyDate:  null,
        totalStudyDays: 0,
        totalVideos:    0,
        totalQuizzes:   0,
        perfectQuizzes: 0,
        usedBookmark:   false,
        usedTranslation:false,
        usedMindMap:    false,
        usedNotes:      false,
        usedFlashcards: false,
        earnedBadges:   [],
        studyDates:[]         // ISO date strings for last 28 days (calendar)
    };
}

function loadGamif() {
    try {
        const raw = JSON.parse(localStorage.getItem(GAMIF_KEY) || '{}');
        if (raw.studyDatesLast7 && !raw.studyDates) {
            raw.studyDates = raw.studyDatesLast7;
            delete raw.studyDatesLast7;
        }
        return Object.assign(defaultGamif(), raw);
    } catch { return defaultGamif(); }
}
function saveGamif(g) {
    try { localStorage.setItem(GAMIF_KEY, JSON.stringify(g)); } catch {}
}

// ── Record a study session (call on analyze complete / history open) ──
function recordStudySession() {
    const g = loadGamif();
    const today = todayISO();

    if (g.lastStudyDate === today) {
        // Already recorded today — just render, no change
        renderStreakCard(g);
        return;
    }

    const yesterday = dayOffsetISO(-1);
    if (g.lastStudyDate === yesterday) {
        g.currentStreak += 1;
    } else {
        g.currentStreak = 1;   // reset
    }

    g.longestStreak  = Math.max(g.longestStreak, g.currentStreak);
    g.lastStudyDate  = today;
    g.totalStudyDays += 1;
    g.totalVideos   += 1;

    // Update last-28-days list
    if (!g.studyDates) g.studyDates = [];
    if (!g.studyDates.includes(today)) g.studyDates.push(today);
    const cutoff = dayOffsetISO(-27);
    g.studyDates = g.studyDates.filter(d => d >= cutoff);

    saveGamif(g);
    checkAndAwardBadges(g);
    renderStreakCard(g);
}

// ── Record feature usage ──
function recordGamifFeature(feature) {
    const g = loadGamif();
    if (g[feature]) return;   // already recorded
    g[feature] = true;
    saveGamif(g);
    checkAndAwardBadges(g);
    renderStreakCard(g);
}

// ── Record quiz completion ──
function recordGamifQuiz(correct, total) {
    const g = loadGamif();
    g.totalQuizzes += 1;
    if (total > 0 && correct === total) g.perfectQuizzes += 1;
    saveGamif(g);
    checkAndAwardBadges(g);
    renderStreakCard(g);
}

// ── Check badges + show toast for new ones ──
function checkAndAwardBadges(g) {
    const newBadges = [];
    for (const badge of BADGES) {
        if (!g.earnedBadges.includes(badge.id) && badge.check(g)) {
            g.earnedBadges.push(badge.id);
            newBadges.push(badge);
        }
    }
    if (newBadges.length) {
        saveGamif(g);
        newBadges.forEach((b, i) => {
            setTimeout(() => showBadgeToast(b), i * 1200);
        });
    }
}

function showBadgeToast(badge) {
    const el = document.createElement('div');
    el.className = 'badge-toast';
    el.innerHTML = '<span class="bt-icon">' + badge.icon + '</span>'
        + '<div class="bt-text"><strong>Huy hiệu mới!</strong><span>' + badge.name + '</span></div>';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('bt-show'));
    setTimeout(() => {
        el.classList.remove('bt-show');
        setTimeout(() => el.remove(), 400);
    }, 3500);
}

// ── Render streak card ──
function renderStreakCard(g) {
    if (!g) g = loadGamif();
    const num   = document.getElementById('streakNum');
    const best  = document.getElementById('streakBest');
    const flame = document.getElementById('streakFlame');
    const weekEl = document.getElementById('streakWeek');
    const earnedEl = document.getElementById('badgesEarnedCount');

    if (num)    num.textContent   = g.currentStreak;
    if (best)   best.textContent  = 'Kỷ lục: ' + g.longestStreak + ' ngày';
    if (flame)  flame.textContent = g.currentStreak >= 7 ? '🔥🔥' : g.currentStreak >= 3 ? '🔥' : '✨';
    if (earnedEl) earnedEl.textContent = g.earnedBadges.length;

    // 7-day mini calendar
    if (weekEl) {
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const d = dayOffsetISO(-i);
            const active = g.studyDatesLast7?.includes(d);
            const dow = new Date(d).toLocaleDateString('vi-VN', { weekday: 'narrow' });
            days.push('<div class="streak-day' + (active ? ' streak-day-active' : '') + '" title="' + d + '">'
                + '<span class="streak-dot"></span>'
                + '<span class="streak-dow">' + dow + '</span>'
                + '</div>');
        }
        weekEl.innerHTML = days.join('');
    }
}

// ── Badges modal ──
// Singleton floating tooltip
function ensureBadgeTooltip() {
    let tip = document.getElementById('badgeTooltip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'badgeTooltip';
        document.body.appendChild(tip);
    }
    return tip;
}

function showBadgeTooltip(badgeEl, event) {
    const tip    = ensureBadgeTooltip();
    const name   = badgeEl.querySelector('.badge-name')?.textContent || '';
    const desc   = badgeEl.dataset.tooltip || '';
    const earned = badgeEl.classList.contains('badge-earned');

    tip.innerHTML = '<strong>' + name + '</strong>'
        + '<span class="bt-desc">' + desc + '</span>'
        + (earned
            ? '<span class="bt-status bt-earned">✅ Đã đạt được</span>'
            : '<span class="bt-status bt-locked">🔒 Chưa mở khóa</span>');

    // Measure
    tip.style.opacity = '0';
    tip.style.display = 'block';
    const tipW = tip.offsetWidth;
    const tipH = tip.offsetHeight;
    const GAP  = 8;

    const rect = badgeEl.getBoundingClientRect();

    // Center horizontally on badge
    let left = rect.left + (rect.width / 2) - (tipW / 2);
    // Clamp horizontally
    left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));

    // Prefer below; flip above if not enough space
    let top = rect.bottom + GAP;
    if (top + tipH > window.innerHeight - 8) {
        top = rect.top - tipH - GAP;
    }

    tip.style.left    = left + 'px';
    tip.style.top     = top  + 'px';
    tip.style.opacity = '1';
}

function hideBadgeTooltip() {
    const tip = document.getElementById('badgeTooltip');
    if (tip) { tip.style.opacity = '0'; tip.classList.remove('bt-visible'); }
}

// Track which section to return to
let _badgesPrevSection = 'resultsSection';

function openBadgesPage() {
    // Remember current visible section
    _badgesPrevSection = SECTION_IDS.find(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
    }) || 'resultsSection';

    renderBadgesPage();
    showSection('badgesSection');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeBadgesPage() {
    hideBadgeTooltip();
    // Explicitly hide the overlay section first (belt-and-suspenders)
    const bp = document.getElementById('badgesSection');
    if (bp) bp.classList.add('hidden');
    showSection(_badgesPrevSection);
    window.scrollTo({ top: 0, behavior: 'instant' });
}

// Keep backward-compat alias used by streak card button
function openBadgesModal() { openBadgesPage(); }
function closeBadgesModal() { closeBadgesPage(); }


function badgeItemHTML(b, g, idx) {
    const earned = g.earnedBadges.includes(b.id);
    return '<div class="badge-item bp-item' + (earned ? ' badge-earned' : ' badge-locked') + '"'
        + ' data-tooltip="' + b.desc + (earned ? ' ✅' : '') + '">'
        + '<span class="badge-icon">' + b.icon + '</span>'
        + '<span class="badge-name">' + b.name + '</span>'
        + '<span class="badge-desc">' + b.desc + '</span>'
        + (earned ? '<span class="badge-check">✓</span>' : '')
        + '</div>';
}

function renderBadgesPage() {
    const g       = loadGamif();
    const wrap    = document.getElementById('bpGridWrap');
    const stats   = document.getElementById('bpStatsRow');
    const streakEl= document.getElementById('bpStreakSummary');
    if (!wrap) return;

    // Stats chips
    if (stats) {
        const pct = BADGES.length ? Math.round(g.earnedBadges.length / BADGES.length * 100) : 0;
        stats.innerHTML = [
            statChip('📅', g.totalStudyDays + ' ngày học'),
            statChip('🎬', g.totalVideos + ' videos'),
            statChip('🧠', g.totalQuizzes + ' quizzes'),
            statChip('🔥', g.currentStreak + ' ngày streak'),
            statChip('🏆', g.earnedBadges.length + '/' + BADGES.length + ' huy hiệu (' + pct + '%)'),
        ].join('');
    }

    // Streak summary bar
    if (streakEl) {
        const pct = BADGES.length ? Math.round(g.earnedBadges.length / BADGES.length * 100) : 0;
        streakEl.innerHTML =
            '<div class="bp-streak-bar">'
            + '<div class="bp-sb-fill" style="width:' + pct + '%"></div>'
            + '</div>'
            + '<span class="bp-sb-label">' + pct + '% huy hiệu đã mở khoá</span>';
    }

    // Badge categories
    const cats = [...new Set(BADGES.map(b => b.cat))];
    wrap.innerHTML = cats.map(cat => {
        const catBadges = BADGES.filter(b => b.cat === cat);
        const earnedCount = catBadges.filter(b => g.earnedBadges.includes(b.id)).length;
        return '<div class="badge-category">'
            + '<h4 class="badge-cat-label">' + (CAT_LABELS[cat] || cat)
            + '<span class="bc-progress">' + earnedCount + '/' + catBadges.length + '</span></h4>'
            + '<div class="badge-cat-grid">' + catBadges.map((b, i) => badgeItemHTML(b, g, i)).join('') + '</div>'
            + '</div>';
    }).join('');

    // Wire up click-to-popover
    if (!wrap._tooltipBound) {
        wrap._tooltipBound = true;
        wrap.addEventListener('click', e => {
            const item = e.target.closest('.badge-item');
            const tip  = document.getElementById('badgeTooltip');
            if (tip && tip._anchor === item && tip.style.opacity === '1') {
                hideBadgeTooltip(); return;
            }
            if (item) { showBadgeTooltip(item, e); if (tip) tip._anchor = item; }
        });
        document.addEventListener('click', e => {
            if (!e.target.closest('.badge-item') && !e.target.closest('#badgeTooltip'))
                hideBadgeTooltip();
        }, { capture: true });
    }
}

// Legacy alias — no-op since we removed modal
function renderBadgesGrid() { renderBadgesPage(); }

function statChip(icon, text) {
    return '<span class="badge-stat-chip">' + icon + ' ' + text + '</span>';
}

// ── Date helpers ──
function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function dayOffsetISO(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// ── Init on page load ──
(function initGamifOnLoad() {
    const g = loadGamif();
    renderStreakCard(g);
})();

// ══════════════════════════════════════════════════════════
// THEME TOGGLE — DARK / LIGHT MODE
// ══════════════════════════════════════════════════════════

const THEME_KEY = 'lectureDigest_theme';

function applyTheme(theme) {
    const html = document.documentElement;
    const icon = document.getElementById('themeIcon');
    if (theme === 'light') {
        html.classList.add('light-mode');
        if (icon) icon.textContent = '☀️';
    } else {
        html.classList.remove('light-mode');
        if (icon) icon.textContent = '🌙';
    }
}

function toggleTheme() {
    const current = localStorage.getItem(THEME_KEY) || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
}

// Apply saved theme on load (before paint)
(function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) || 'dark';
    applyTheme(saved);
})();

// ══════════════════════════════════════════════════════════
// SPA ROUTING — URL changes per page
// ══════════════════════════════════════════════════════════

const SPA_ROUTES = {
    hero:           '/',
    loadingSection: null,   // no URL change while loading
    errorSection:   null,   // no URL change on error
    resultsSection: null,   // set dynamically with video id
    badgesSection:  '/badges',
};

// Called from showSection() to update URL
function pushSpaRoute(sectionId) {
    const route = SPA_ROUTES[sectionId];
    if (route === null) return;              // don't push for transient states

    let url = route;
    // Results page: include video ID in URL
    if (sectionId === 'resultsSection') {
        const vid = window._spaVideoId || (window.analysisData && window.analysisData.video_id);
        url = vid ? '/results/' + vid : '/results';
    }

    // Only push if URL actually changed
    if (location.pathname !== url) {
        history.pushState({ section: sectionId }, document.title, url);
    }
    updatePageTitle(sectionId);
}

function updatePageTitle(sectionId) {
    const titles = {
        hero:           'LectureDigest — AI-Powered YouTube Learning',
        resultsSection: 'Kết quả phân tích — LectureDigest',
        badgesSection:  'Huy hiệu — LectureDigest',
        loadingSection: 'Đang phân tích... — LectureDigest',
        errorSection:   'Lỗi — LectureDigest',
    };
    document.title = titles[sectionId] || titles.hero;
}

// Handle browser back / forward
window.addEventListener('popstate', function(e) {
    const path = location.pathname;
    if (path === '/' || path === '') {
        showSection('hero');
    } else if (path === '/badges') {
        openBadgesPage();
    } else if (path.startsWith('/results/')) {
        // Try to restore from history data stored in app
        const videoId = path.replace('/results/', '');
        const histEntry = (window._analysisHistory || []).find(h => h.video_id === videoId);
        if (histEntry) {
            showSection('resultsSection');
        } else {
            showSection('hero');
        }
    } else {
        showSection('hero');
    }
});

// Patch showSection to also push SPA route
(function patchShowSectionForRouting() {
    const _orig = window.showSection;
    window.showSection = function(id) {
        _orig(id);
        pushSpaRoute(id);
    };
})();

// On initial page load: parse current URL
(function initSpaRouteOnLoad() {
    const path = location.pathname;
    if (path === '/badges') {
        // Will be handled after DOM is ready — openBadgesPage needs gamif data
        window.addEventListener('DOMContentLoaded', function() {
            openBadgesPage();
        }, { once: true });
    }
    // /results/:id — don't attempt to restore since we need locally-stored data
    // Just show hero so user can paste a URL or use history panel
})();

// ════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// Ctrl+Enter = analyze, Escape = close panels,
// 1-4 = quiz answers, Space/Enter = flip flashcard
// ════════════════════════════════════════════════════════
document.addEventListener('keydown', function(e) {
    var tag = document.activeElement ? document.activeElement.tagName : '';
    var isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(tag) >= 0;

    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        var heroEl = document.getElementById('hero');
        if (heroEl && !heroEl.classList.contains('hidden')) { e.preventDefault(); analyzeVideo(); }
        return;
    }

    if (e.key === 'Escape') {
        var fcModal = document.getElementById('fcModalOverlay');
        if (fcModal && !fcModal.classList.contains('hidden')) { if(typeof closeFcModal==='function') closeFcModal(e); return; }
        var shareModal = document.getElementById('shareModalOverlay');
        if (shareModal && !shareModal.classList.contains('hidden')) { if(typeof closeShareModal==='function') closeShareModal(e); return; }
        var mmModal = document.getElementById('mmModalOverlay');
        if (mmModal && !mmModal.classList.contains('hidden')) { if(typeof closeMindMap==='function') closeMindMap(); return; }
        var histPanel = document.getElementById('historyPanel');
        if (histPanel && histPanel.classList.contains('open')) {
            toggleHistoryPanel(false);
            var inp = document.getElementById('histSearchInput');
            if (inp) { inp.value = ''; renderHistoryPanel(''); }
            return;
        }
        if (typeof chatState !== 'undefined' && chatState && chatState.isOpen && typeof toggleChat === 'function') { toggleChat(); return; }
        var vlen = document.getElementById('vlenOverlay');
        if (vlen && !vlen.classList.contains('hidden')) { closeVlenModal(); return; }
        return;
    }

    if (isTyping) return;

    var fcOpen = document.getElementById('fcModalOverlay') && !document.getElementById('fcModalOverlay').classList.contains('hidden');
    if (fcOpen) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if(typeof flipCard==='function') flipCard(); return; }
        if (e.key === 'ArrowLeft')  { e.preventDefault(); if(typeof fcNavigate==='function') fcNavigate(-1); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); if(typeof fcNavigate==='function') fcNavigate(1);  return; }
        if (e.key === '1') { if(typeof rateCard==='function') rateCard('hard'); return; }
        if (e.key === '2') { if(typeof rateCard==='function') rateCard('ok');   return; }
        if (e.key === '3') { if(typeof rateCard==='function') rateCard('easy'); return; }
        return;
    }

    var quizContainer = document.getElementById('quizContainer');
    if (quizContainer && !quizContainer.classList.contains('hidden')) {
        if (e.key === '1') { var o0=document.getElementById('opt-0'); if(o0) o0.click(); return; }
        if (e.key === '2') { var o1=document.getElementById('opt-1'); if(o1) o1.click(); return; }
        if (e.key === '3') { var o2=document.getElementById('opt-2'); if(o2) o2.click(); return; }
        if (e.key === '4') { var o3=document.getElementById('opt-3'); if(o3) o3.click(); return; }
        if (e.key === 'ArrowRight') {
            var nextBtn = document.getElementById('nextBtn');
            if (nextBtn && !nextBtn.classList.contains('hidden')) { e.preventDefault(); if(typeof nextQuestion==='function') nextQuestion(); return; }
        }
    }
}, false);

// Clear history search when panel closes
(function() {
    var _orig = window.toggleHistoryPanel;
    if (typeof _orig !== 'function') return;
    window.toggleHistoryPanel = function(force) {
        _orig(force);
        var panel = document.getElementById('historyPanel');
        if (panel && !panel.classList.contains('open')) {
            var inp = document.getElementById('histSearchInput');
            if (inp) { inp.value = ''; renderHistoryPanel(''); }
        }
    };
})();

(function initOsThemeSync() {
    var saved = localStorage.getItem('lectureDigest_theme');
    if (!saved) {
        applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
        if (!localStorage.getItem('lectureDigest_theme')) applyTheme(e.matches ? 'dark' : 'light');
    });
    var _origTT = window.toggleTheme;
    window.toggleTheme = function() {
        var cur = localStorage.getItem('lectureDigest_theme') ||
            (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        var next = cur === 'dark' ? 'light' : 'dark';
        localStorage.setItem('lectureDigest_theme', next);
        applyTheme(next);
    };
})();
