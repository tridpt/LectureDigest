/* ════════════════════════════════════════════════
   LectureDigest — Analyze Module
   Loading animation, video length warning, main analyze flow, renderResults
   ════════════════════════════════════════════════ */

// ──────────────────────────────────────
// LOADING PROGRESS
// ──────────────────────────────────────
var _loadProgress = { pct: 0, tick: null, startTime: 0, targetPct: 0 };

function setLoadingProgress(pct, stepIndex, statusText) {
    _loadProgress.pct = pct;
    _loadProgress.targetPct = pct;

    // Update progress bar
    var fill = document.getElementById('loadingProgressFill');
    var pctEl = document.getElementById('loadingPct');
    var etaEl = document.getElementById('loadingEta');
    if (fill) fill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = Math.round(pct) + '%';

    // ETA calculation
    if (etaEl && pct > 5 && pct < 100) {
        var elapsed = (Date.now() - _loadProgress.startTime) / 1000;
        var remaining = (elapsed / pct) * (100 - pct);
        if (remaining > 60) {
            etaEl.textContent = '~' + Math.ceil(remaining / 60) + ' phút còn lại';
        } else {
            etaEl.textContent = '~' + Math.ceil(remaining) + 's còn lại';
        }
    } else if (etaEl) {
        etaEl.textContent = pct >= 100 ? '' : 'Đang ước tính...';
    }

    // Update steps
    var stepIds = ['step1', 'step2', 'step3', 'step4'];
    stepIds.forEach(function(id, i) {
        var el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('active', 'done');
        if (i < stepIndex) el.classList.add('done');
        else if (i === stepIndex) el.classList.add('active');
    });

    // Update status text
    var statusEl = document.getElementById('loadingStatus');
    if (statusEl && statusText) statusEl.textContent = statusText;
}

function _startProgressTick(fromPct, toPct, durationMs) {
    // Slowly tick from fromPct toward toPct over durationMs
    clearInterval(_loadProgress.tick);
    var step = (toPct - fromPct) / (durationMs / 800);
    _loadProgress.tick = setInterval(function() {
        if (_loadProgress.pct >= toPct - 1) {
            clearInterval(_loadProgress.tick);
            return;
        }
        var next = Math.min(_loadProgress.pct + step, toPct - 1);
        setLoadingProgress(next, _getStepForPct(next), null);
    }, 800);
}

function _getStepForPct(pct) {
    if (pct < 15) return 0;
    if (pct < 75) return 1;
    if (pct < 90) return 2;
    return 3;
}

function startLoadingAnimation() {
    _loadProgress.startTime = Date.now();
    _loadProgress.pct = 0;
    setLoadingProgress(0, 0, 'Fetching video transcript...');
    return function() {
        clearInterval(_loadProgress.tick);
    };
}

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
    // Detect playlist URL — redirect to playlist mode
    if (/[?&]list=[a-zA-Z0-9_-]+/.test(url) && !window._plVideoMode) {
        loadPlaylist(url);
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

        // Step 1: Get transcript (0→15%)
        setLoadingProgress(5, 0, 'Fetching video transcript...');
        if (!clientTranscript) {
            try {
                var videoId2 = (url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/) || [])[1];
                if (videoId2) clientTranscript = await fetchTranscriptClientSide(videoId2);
            } catch(e) {
                console.warn('[LectureDigest] Client transcript failed, server will try:', e.message);
            }
        }
        setLoadingProgress(15, 1, 'Analyzing content with Gemini AI...');

        // Step 2: AI Analysis (15→75%) — slow tick during server call
        _startProgressTick(15, 74, 60000);

        var reqBody = { url: url, language: 'en', output_language: selectedLang };
        if (clientTranscript && clientTranscript.length) reqBody.transcript = clientTranscript;
        var res = await fetchWithTimeout(API_BASE + '/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqBody),
        }, 120000);
        stopAnimation();

        // Step 3: Parse response (75→90%)
        setLoadingProgress(75, 2, 'Generating quiz questions...');
        if (!res.ok) {
            var err = await res.json().catch(function() { return { detail: 'Unknown server error' }; });
            throw new Error(err.detail || ('Server error ' + res.status));
        }
        analysisData = await res.json();
        if (!analysisData.video_id) throw new Error('Response missing video_id');
        if ((!analysisData.transcript || !analysisData.transcript.length) && clientTranscript && clientTranscript.length) {
            analysisData.transcript = clientTranscript;
        }
        setLoadingProgress(90, 3, 'Building results...');

        // Step 4: Render results (90→100%)
        clearChat();
        renderResults(analysisData);
        saveToHistory(analysisData);
        initNotes(analysisData.video_id);
        renderTranscript(analysisData.transcript || []);
        initProgress(analysisData.video_id);
        initBookmarks(analysisData.video_id);
        recordStudySession();
        window._spaVideoId = analysisData.video_id;
        setLoadingProgress(100, 4, 'Done!');
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
                    <button class="deep-dive-btn" onclick="event.stopPropagation();deepDiveChapter(${topics.indexOf(topic)})" title="Hoi AI ve chapter nay">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                        Hoi AI
                    </button>
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
