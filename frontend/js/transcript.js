/* ════════════════════════════════════════════════
   LectureDigest — Transcript Search, Render, Sync & Translation
   ════════════════════════════════════════════════ */

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

// fmtSecs, escapeHtml, escapeRegex → defined in core.js

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

