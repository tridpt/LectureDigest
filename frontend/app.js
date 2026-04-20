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
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
    });
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
const CORS_PROXIES = [
    url => `https://delicate-disk-ef3f.tranductrist.workers.dev/?url=${encodeURIComponent(url)}`, // Cloudflare Worker
    url => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

async function proxyFetch(url, options = {}) {
    for (const proxyFn of CORS_PROXIES) {
        try {
            const res = await fetch(proxyFn(url), options);
            if (res.ok) return res;
        } catch (_) { /* try next proxy */ }
    }
    throw new Error('All CORS proxies failed');
}

async function fetchTranscriptClientSide(videoId) {
    const innertubeUrl = 'https://www.youtube.com/youtubei/v1/player';
    const payload = {
        videoId,
        context: {
            client: {
                clientName: 'ANDROID',
                clientVersion: '17.31.35',
                androidSdkVersion: 30,
                userAgent: 'com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip',
                hl: 'en', timeZone: 'UTC', utcOffsetMinutes: 0,
            }
        }
    };

    // Step 1: Get player data — try direct first, then via CORS proxy
    let playerData = null;

    // Direct fetch with text/plain to avoid CORS preflight
    // (text/plain = "simple request" = no OPTIONS preflight = CORS only checks response)
    try {
        const res = await fetch(innertubeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' }, // intentional: avoids preflight
            body: JSON.stringify(payload),
        });
        if (res.ok) {
            playerData = await res.json();
            console.log('[LectureDigest] InnerTube: direct fetch OK');
        }
    } catch (e) {
        console.warn('[LectureDigest] InnerTube direct failed:', e.message);
    }

    // CORS proxy fallback
    if (!playerData) {
        for (const proxyFn of CORS_PROXIES) {
            try {
                const res = await fetch(proxyFn(innertubeUrl), {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain' },
                    body: JSON.stringify(payload),
                });
                if (res.ok) { playerData = await res.json(); break; }
            } catch (_) {}
        }
    }

    if (!playerData) throw new Error('Could not reach YouTube InnerTube API');

    // Step 2: Find caption track
    const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (!tracks.length) throw new Error('No caption tracks found');
    const track = tracks.find(t => t.languageCode?.startsWith('en')) || tracks[0];
    const captionUrl = track.baseUrl + '&fmt=json3';

    // Step 3: Fetch caption data — try direct then proxied
    let capData = null;
    try {
        const res = await fetch(captionUrl);
        if (res.ok) capData = await res.json();
    } catch (_) {}

    if (!capData) {
        for (const proxyFn of CORS_PROXIES) {
            try {
                const res = await fetch(proxyFn(captionUrl));
                if (res.ok) { capData = await res.json(); break; }
            } catch (_) {}
        }
    }

    if (!capData) throw new Error('Could not fetch caption data');

    // Step 4: Parse events
    const snippets = [];
    for (const event of capData.events || []) {
        if (!event.segs) continue;
        const start = (event.tStartMs || 0) / 1000;
        const text = event.segs.map(s => s.utf8 || '').join('').trim();
        if (text) snippets.push({ text, start });
    }
    if (!snippets.length) throw new Error('Transcript is empty');
    console.log(`[LectureDigest] Client transcript: ${snippets.length} segments`);
    return snippets;
}

// ──────────────────────────────────────
// MAIN ANALYSE FUNCTION
// ──────────────────────────────────────
async function analyzeVideo() {
    const urlInput = document.getElementById('urlInput');
    const searchBox = document.getElementById('searchBox');
    const url = urlInput.value.trim();

    if (!url) {
        urlInput.focus();
        searchBox.style.borderColor = 'rgba(239, 68, 68, 0.55)';
        setTimeout(() => { searchBox.style.borderColor = ''; }, 2200);
        return;
    }

    document.getElementById('analyzeBtn').disabled = true;
    showSection('loadingSection');
    const stopAnimation = startLoadingAnimation();

    try {
        // ── Try fetching transcript client-side first (works even on cloud deployments)
        let clientTranscript = null;
        try {
            const videoId = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
            if (videoId) clientTranscript = await fetchTranscriptClientSide(videoId);
        } catch (e) {
            console.warn('[LectureDigest] Client transcript failed, server will try:', e.message);
        }

        const reqBody = { url, language: 'en', output_language: selectedLang };
        if (clientTranscript?.length) reqBody.transcript = clientTranscript;

        const res = await fetch(`${API_BASE}/api/analyze`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(reqBody),
        });

        stopAnimation();

        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Unknown server error' }));
            throw new Error(err.detail || `Server error ${res.status}`);
        }

        analysisData = await res.json();

        if (!analysisData.video_id) throw new Error('Response missing video_id');

        renderResults(analysisData);
        showSection('resultsSection');

    } catch (err) {
        stopAnimation();
        const msgEl = document.getElementById('errorMessage');
        if (msgEl) msgEl.textContent = err.message || 'Failed to analyze video. Please try again.';
        showSection('errorSection');
        document.getElementById('analyzeBtn').disabled = false;
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

// ──────────────────────────────────────
// FLASHCARD EXPORT
// ──────────────────────────────────────
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
