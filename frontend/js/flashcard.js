/* ════════════════════════════════════════════════
   LectureDigest — Flashcard Study, Export, Custom Cards & SM-2
   ════════════════════════════════════════════════ */

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

    // Include custom flashcards
    var videoId = window._spaVideoId || (d.video_id);
    if (videoId && typeof loadCustomCards === 'function') {
        var customs = loadCustomCards(videoId);
        customs.forEach(function(c) {
            cards.push({
                front: c.front,
                back: c.back,
                tag: 'custom',
                rating: null
            });
        });
    }

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

// ══════════════════════════════════════════════════════
// SM-2 SPACED REPETITION
// ══════════════════════════════════════════════════════

var SM2_KEY_PREFIX = 'lectureDigest_sm2_';

function sm2Key(videoId) { return SM2_KEY_PREFIX + videoId; }

function loadSm2(videoId) {
    try { return JSON.parse(localStorage.getItem(sm2Key(videoId)) || '{}'); }
    catch(e) { return {}; }
}

function saveSm2(videoId, data) {
    try {
        localStorage.setItem(sm2Key(videoId), JSON.stringify(data));
        // Sync to backend
        if (typeof dbFetch === 'function') {
            dbFetch('/notes/' + videoId + '_sm2', {
                method: 'PUT',
                body: JSON.stringify({ content: JSON.stringify(data) })
            });
        }
    } catch(e) {}
}

// SM-2 algorithm implementation
// q: quality of response (0-5)
//   0 = complete blackout, 1 = wrong, 2 = wrong but remembered after seeing answer
//   3 = correct with difficulty, 4 = correct, 5 = perfect
function sm2Calculate(card, quality) {
    var ef = card.ef || 2.5;
    var interval = card.interval || 0;
    var reps = card.repetitions || 0;

    if (quality < 3) {
        // Failed — reset
        reps = 0;
        interval = 0;
    } else {
        // Success
        if (reps === 0) {
            interval = 1;       // 1 day
        } else if (reps === 1) {
            interval = 3;       // 3 days
        } else {
            interval = Math.round(interval * ef);
        }
        reps += 1;
    }

    // Update easiness factor
    ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (ef < 1.3) ef = 1.3;

    // Calculate next review date
    var now = new Date();
    var next = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000);
    var nextISO = next.toISOString().split('T')[0]; // YYYY-MM-DD

    return {
        ef: Math.round(ef * 100) / 100,
        interval: interval,
        repetitions: reps,
        nextReview: nextISO,
        lastReview: now.toISOString().split('T')[0],
        quality: quality
    };
}

// Get number of cards due for review
function countDueCards(videoId) {
    var sm2Data = loadSm2(videoId);
    var today = new Date().toISOString().split('T')[0];
    var count = 0;
    for (var key in sm2Data) {
        if (sm2Data[key].nextReview && sm2Data[key].nextReview <= today) count++;
    }
    return count;
}

// Override rateCard to use SM-2
(function patchRateCardSM2() {
    rateCard = function(rating) {
        if (!fcFlipped) { flipCard(); return; }
        var card = fcFiltered[fcIndex];
        if (!card) return;

        // Map rating to SM-2 quality
        var qualityMap = { hard: 1, ok: 3, easy: 5 };
        var quality = qualityMap[rating] || 3;

        // Get video ID
        var videoId = window._spaVideoId || (window.analysisData && window.analysisData.video_id);
        if (!videoId) return;

        // Load SM-2 data
        var sm2Data = loadSm2(videoId);
        var cardKey = 'card_' + fcIndex + '_' + (card.front || '').substring(0, 20).replace(/\s+/g, '_');

        // Get existing card data or create new
        var cardSm2 = sm2Data[cardKey] || { ef: 2.5, interval: 0, repetitions: 0 };

        // Calculate new SM-2 values
        var result = sm2Calculate(cardSm2, quality);
        sm2Data[cardKey] = result;
        saveSm2(videoId, sm2Data);

        // Update card rating for visual feedback
        var masterIdx = fcCards.indexOf(card);
        if (masterIdx !== -1) fcCards[masterIdx].rating = rating;
        card.rating = rating;
        card._sm2 = result;

        // Show feedback
        var feedbackMap = {
            hard: 'Kho! On lai ngay mai',
            ok: 'OK! On lai sau ' + result.interval + ' ngay',
            easy: 'De! On lai sau ' + result.interval + ' ngay'
        };
        showSmallFeedback(feedbackMap[rating] || '');

        // Auto-advance
        if (fcIndex < fcFiltered.length - 1) {
            fcIndex++;
            renderFcCard();
        } else {
            showFcSummary();
        }
    };
})();

// Small feedback toast inside flashcard modal
function showSmallFeedback(text) {
    var existing = document.getElementById('sm2Feedback');
    if (existing) existing.remove();

    var el = document.createElement('div');
    el.id = 'sm2Feedback';
    el.style.cssText = 'position:absolute;bottom:100px;left:50%;transform:translateX(-50%);' +
        'background:rgba(139,92,246,0.9);color:white;padding:6px 16px;border-radius:8px;' +
        'font-size:12px;font-weight:600;z-index:9999;white-space:nowrap;' +
        'animation:fadeIn 0.2s ease;pointer-events:none;';
    el.textContent = text;

    var modal = document.querySelector('.compare-modal') || document.getElementById('fcModalOverlay');
    if (modal) modal.appendChild(el);
    else document.body.appendChild(el);

    setTimeout(function() { el.remove(); }, 1500);
}

// Override renderFcCard to show SM-2 info
(function patchRenderFcCardSM2() {
    var _origRender = renderFcCard;
    renderFcCard = function() {
        _origRender();

        var videoId = window._spaVideoId || (window.analysisData && window.analysisData.video_id);
        if (!videoId) return;

        var card = fcFiltered[fcIndex];
        if (!card) return;

        var sm2Data = loadSm2(videoId);
        var cardKey = 'card_' + fcIndex + '_' + (card.front || '').substring(0, 20).replace(/\s+/g, '_');
        var cardSm2 = sm2Data[cardKey];

        // Add SM-2 badge to card
        var badge = document.getElementById('fcModeBadge');
        if (badge && cardSm2) {
            var today = new Date().toISOString().split('T')[0];
            var isDue = !cardSm2.nextReview || cardSm2.nextReview <= today;
            var dueText = isDue ? ' | Can on!' : ' | On: ' + cardSm2.nextReview;
            var efText = ' | EF:' + cardSm2.ef;
            badge.textContent = badge.textContent + dueText;
        }

        // Update rate button labels with SM-2 intervals
        updateRateLabels(cardSm2);
    };
})();

function updateRateLabels(cardSm2) {
    var base = cardSm2 || { ef: 2.5, interval: 0, repetitions: 0 };
    var hardResult = sm2Calculate(Object.assign({}, base), 1);
    var okResult   = sm2Calculate(Object.assign({}, base), 3);
    var easyResult = sm2Calculate(Object.assign({}, base), 5);

    // Find rate buttons and update labels
    var btns = document.querySelectorAll('.fc-rate-btn');
    btns.forEach(function(btn) {
        var label = btn.querySelector('.fc-rate-sublabel');
        if (!label) {
            label = document.createElement('span');
            label.className = 'fc-rate-sublabel';
            label.style.cssText = 'display:block;font-size:9px;opacity:0.7;margin-top:2px;font-weight:400;';
            btn.appendChild(label);
        }
        var rating = btn.getAttribute('data-rating') || btn.textContent.toLowerCase().trim();
        if (rating.indexOf('hard') >= 0 || rating.indexOf('kho') >= 0) {
            label.textContent = hardResult.interval <= 1 ? 'Ngay mai' : hardResult.interval + ' ngay';
        } else if (rating.indexOf('ok') >= 0) {
            label.textContent = okResult.interval + ' ngay';
        } else if (rating.indexOf('easy') >= 0 || rating.indexOf('de') >= 0) {
            label.textContent = easyResult.interval + ' ngay';
        }
    });
}

// Override showFcSummary to include SM-2 stats
(function patchShowFcSummary() {
    showFcSummary = function() {
        var hard = fcCards.filter(function(c) { return c.rating === 'hard'; }).length;
        var ok   = fcCards.filter(function(c) { return c.rating === 'ok'; }).length;
        var easy = fcCards.filter(function(c) { return c.rating === 'easy'; }).length;
        var unrated = fcCards.filter(function(c) { return !c.rating; }).length;
        var total = fcCards.length;
        var reviewed = hard + ok + easy;

        var videoId = window._spaVideoId || (window.analysisData && window.analysisData.video_id);
        var dueCount = videoId ? countDueCards(videoId) : 0;

        var msg = 'Xong! Da on ' + reviewed + '/' + total + ' the.\n'
            + 'Kho: ' + hard + '  OK: ' + ok + '  De: ' + easy
            + (unrated ? '\nBo qua: ' + unrated : '')
            + (dueCount > 0 ? '\nCon ' + dueCount + ' the can on!' : '\nHen on lai ngay mai!');

        showToast(msg, 5000);
    };
})();

// Add filter for due cards in flashcard modal
(function patchFilterWithDue() {
    var _origUpdateFilter = typeof updateFilterBtns === 'function' ? updateFilterBtns : null;

    // Override fcFilter to support 'due' filter
    var _origFcFilter = typeof fcFilter === 'function' ? fcFilter : null;

    if (typeof fcFilter === 'function') {
        var _baseFcFilter = fcFilter;
        fcFilter = function(key) {
            if (key === 'due') {
                fcFilterKey = 'due';
                var videoId = window._spaVideoId || (window.analysisData && window.analysisData.video_id);
                var sm2Data = videoId ? loadSm2(videoId) : {};
                var today = new Date().toISOString().split('T')[0];

                fcFiltered = fcCards.filter(function(card, idx) {
                    var cardKey = 'card_' + idx + '_' + (card.front || '').substring(0, 20).replace(/\s+/g, '_');
                    var cardSm2 = sm2Data[cardKey];
                    // Include if: never reviewed, or due today/past
                    return !cardSm2 || !cardSm2.nextReview || cardSm2.nextReview <= today;
                });

                if (!fcFiltered.length) {
                    showToast('Khong co the nao can on hom nay!');
                    fcFiltered = [...fcCards];
                    fcFilterKey = 'all';
                }

                fcIndex = 0;
                if (_origUpdateFilter) _origUpdateFilter();
                renderFcCard();
            } else {
                _baseFcFilter(key);
            }
        };
    }
})();


// ══════════════════════════════════════════════════════
// CUSTOM FLASHCARDS
// ══════════════════════════════════════════════════════
var CUSTOM_FC_KEY = 'lectureDigest_customfc_';

function customFcKey(videoId) { return CUSTOM_FC_KEY + videoId; }

function loadCustomCards(videoId) {
    try { return JSON.parse(localStorage.getItem(customFcKey(videoId)) || '[]'); }
    catch(e) { return []; }
}

function saveCustomCards(videoId, cards) {
    try { localStorage.setItem(customFcKey(videoId), JSON.stringify(cards)); } catch(e) {}
}

function openAddCardForm() {
    var videoId = window._spaVideoId || (window.analysisData && window.analysisData.video_id);
    if (!videoId) { showToast('Hay analyze video truoc!'); return; }

    // Remove existing form
    var existing = document.getElementById('customFcOverlay');
    if (existing) { existing.remove(); return; }

    var overlay = document.createElement('div');
    overlay.id = 'customFcOverlay';
    overlay.className = 'custom-fc-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    overlay.innerHTML = '<div class="custom-fc-modal">'
        + '<div class="custom-fc-header">'
        + '<h3>\u2795 Tao Flashcard moi</h3>'
        + '<button class="custom-fc-close" onclick="document.getElementById(\'customFcOverlay\').remove()">&times;</button>'
        + '</div>'
        + '<div class="custom-fc-body">'
        + '<label class="custom-fc-label">Mat truoc (cau hoi)</label>'
        + '<textarea id="customFcFront" class="custom-fc-input" rows="3" placeholder="Nhap cau hoi hoac khai niem..."></textarea>'
        + '<label class="custom-fc-label">Mat sau (dap an)</label>'
        + '<textarea id="customFcBack" class="custom-fc-input" rows="3" placeholder="Nhap cau tra loi hoac giai thich..."></textarea>'
        + '<div class="custom-fc-actions">'
        + '<button class="custom-fc-save" onclick="saveNewCustomCard()">Luu Flashcard</button>'
        + '<span class="custom-fc-count" id="customFcCount"></span>'
        + '</div>'
        + '<div class="custom-fc-list" id="customFcList"></div>'
        + '</div></div>';

    document.body.appendChild(overlay);

    // Show existing custom cards
    renderCustomCardList(videoId);

    // Focus
    setTimeout(function() {
        var front = document.getElementById('customFcFront');
        if (front) front.focus();
    }, 100);

    // Keyboard: Ctrl+Enter to save
    overlay.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            saveNewCustomCard();
        }
        if (e.key === 'Escape') overlay.remove();
    });
}

function saveNewCustomCard() {
    var front = document.getElementById('customFcFront');
    var back = document.getElementById('customFcBack');
    if (!front || !back) return;
    var frontText = front.value.trim();
    var backText = back.value.trim();
    if (!frontText || !backText) { showToast('Nhap ca mat truoc va mat sau!'); return; }

    var videoId = window._spaVideoId || (window.analysisData && window.analysisData.video_id);
    if (!videoId) return;

    var cards = loadCustomCards(videoId);
    cards.push({
        id: Date.now(),
        front: frontText,
        back: backText,
        createdAt: new Date().toISOString()
    });
    saveCustomCards(videoId, cards);

    // Clear inputs
    front.value = '';
    back.value = '';
    front.focus();

    renderCustomCardList(videoId);
    showToast('Da them flashcard!');
}

function deleteCustomCard(cardId) {
    var videoId = window._spaVideoId || (window.analysisData && window.analysisData.video_id);
    if (!videoId) return;
    var cards = loadCustomCards(videoId).filter(function(c) { return c.id !== cardId; });
    saveCustomCards(videoId, cards);
    renderCustomCardList(videoId);
}

function renderCustomCardList(videoId) {
    var list = document.getElementById('customFcList');
    var count = document.getElementById('customFcCount');
    if (!list) return;
    var cards = loadCustomCards(videoId);
    if (count) count.textContent = cards.length + ' flashcard tu tao';

    if (!cards.length) {
        list.innerHTML = '<div class="custom-fc-empty">Chua co flashcard tu tao</div>';
        return;
    }

    list.innerHTML = cards.map(function(c) {
        return '<div class="custom-fc-item">'
            + '<div class="custom-fc-item-front">' + c.front.substring(0, 60) + (c.front.length > 60 ? '...' : '') + '</div>'
            + '<div class="custom-fc-item-back">' + c.back.substring(0, 60) + (c.back.length > 60 ? '...' : '') + '</div>'
            + '<button class="custom-fc-item-del" onclick="deleteCustomCard(' + c.id + ')" title="Xoa">&times;</button>'
            + '</div>';
    }).join('');
}

