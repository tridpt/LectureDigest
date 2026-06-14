/* ════════════════════════════════════════════════
   LectureDigest — SRS Daily Review Module
   Aggregates due flashcards across ALL videos
   ════════════════════════════════════════════════ */

// Register section + route
if (typeof SECTION_IDS !== 'undefined' && !SECTION_IDS.includes('srsReviewSection')) {
    SECTION_IDS.push('srsReviewSection');
}
if (typeof SPA_ROUTES !== 'undefined') SPA_ROUTES['srsReviewSection'] = '/review';

// ── Gather all due cards across every video ──
function srsGetAllDueCards() {
    var today = new Date().toISOString().split('T')[0];
    var history = [];
    try { history = JSON.parse(localStorage.getItem('lectureDigest_history') || '[]'); } catch(e) {}

    var allDue = [];
    var videoMap = {};
    history.forEach(function(h) { if (h.video_id) videoMap[h.video_id] = h; });

    for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || key.indexOf('lectureDigest_sm2_') !== 0) continue;
        var videoId = key.replace('lectureDigest_sm2_', '');
        try {
            var sm2Data = JSON.parse(localStorage.getItem(key));
            for (var cardKey in sm2Data) {
                var card = sm2Data[cardKey];
                var isDue = !card.nextReview || card.nextReview <= today;
                if (isDue) {
                    allDue.push({
                        videoId: videoId,
                        cardKey: cardKey,
                        sm2: card,
                        videoTitle: (videoMap[videoId] || {}).title || videoId
                    });
                }
            }
        } catch(e) {}
    }

    // Also include cards that have NEVER been reviewed (new cards from history)
    history.forEach(function(h) {
        if (!h.video_id) return;
        var sm2Key = 'lectureDigest_sm2_' + h.video_id;
        var hasSm2 = localStorage.getItem(sm2Key);
        if (!hasSm2) {
            // This video has flashcards but no SM2 data yet — count as "new"
            allDue.push({
                videoId: h.video_id,
                cardKey: '__new__',
                sm2: null,
                videoTitle: h.title || h.video_id,
                isNew: true
            });
        }
    });

    return allDue;
}

// ── Get global SRS statistics ──
function srsGetGlobalStats() {
    var today = new Date().toISOString().split('T')[0];
    var totalCards = 0, dueCards = 0, masteredCards = 0, reviewedToday = 0;
    var efSum = 0, efCount = 0;

    for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || key.indexOf('lectureDigest_sm2_') !== 0) continue;
        try {
            var sm2Data = JSON.parse(localStorage.getItem(key));
            for (var ck in sm2Data) {
                totalCards++;
                var c = sm2Data[ck];
                if (c.nextReview && c.nextReview <= today) dueCards++;
                if (c.interval >= 21) masteredCards++; // 21+ days = mastered
                if (c.lastReview === today) reviewedToday++;
                if (c.ef) { efSum += c.ef; efCount++; }
            }
        } catch(e) {}
    }

    var avgEf = efCount ? (efSum / efCount) : 2.5;
    var retention = totalCards > 0 ? Math.round((masteredCards / totalCards) * 100) : 0;

    return {
        totalCards: totalCards,
        dueCards: dueCards,
        masteredCards: masteredCards,
        reviewedToday: reviewedToday,
        avgEf: Math.round(avgEf * 100) / 100,
        retention: retention
    };
}

// ── State ──
var _srsCards = [];       // cards to review in this session
var _srsIndex = 0;
var _srsFlipped = false;
var _srsSessionStats = { hard: 0, ok: 0, easy: 0, total: 0 };
var _srsPrevSection = 'hero';

// ── Open the SRS review page ──
function openSrsReview() {
    _srsPrevSection = (typeof SECTION_IDS !== 'undefined' ? SECTION_IDS.find(function(id) {
        var el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
    }) : null) || 'hero';

    // Build the list of due cards (with actual card content)
    _srsCards = _buildReviewDeck();
    _srsIndex = 0;
    _srsFlipped = false;
    _srsSessionStats = { hard: 0, ok: 0, easy: 0, total: 0 };

    _renderSrsPage();
    showSection('srsReviewSection');
    window.scrollTo({ top: 0, behavior: 'instant' });
}

function closeSrsReview() {
    var el = document.getElementById('srsReviewSection');
    if (el) el.classList.add('hidden');
    showSection(_srsPrevSection);
    window.scrollTo({ top: 0, behavior: 'instant' });
    // Re-render dashboard if going back there
    if (_srsPrevSection === 'dashboardSection' && typeof renderDashboard === 'function') {
        renderDashboard();
    }
}

// ── Build actual card deck with content ──
function _buildReviewDeck() {
    var today = new Date().toISOString().split('T')[0];
    var history = [];
    try { history = JSON.parse(localStorage.getItem('lectureDigest_history') || '[]'); } catch(e) {}
    var videoMap = {};
    history.forEach(function(h) { if (h.video_id) videoMap[h.video_id] = h; });

    var deck = [];

    for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || key.indexOf('lectureDigest_sm2_') !== 0) continue;
        var videoId = key.replace('lectureDigest_sm2_', '');
        var videoTitle = (videoMap[videoId] || {}).title || videoId;

        try {
            var sm2Data = JSON.parse(localStorage.getItem(key));
            for (var cardKey in sm2Data) {
                var card = sm2Data[cardKey];
                if (card.nextReview && card.nextReview > today) continue; // not due

                // Try to reconstruct card content from the key
                var label = cardKey.replace(/^card_\d+_/, '').replace(/_/g, ' ');

                deck.push({
                    videoId: videoId,
                    videoTitle: videoTitle,
                    cardKey: cardKey,
                    sm2: Object.assign({}, card),
                    front: card._front || label || 'Flashcard',
                    back: card._back || '',
                    tag: card._tag || 'quiz'
                });
            }
        } catch(e) {}
    }

    // Shuffle for variety
    for (var j = deck.length - 1; j > 0; j--) {
        var r = Math.floor(Math.random() * (j + 1));
        var tmp = deck[j]; deck[j] = deck[r]; deck[r] = tmp;
    }

    // Limit to 30 cards per session to avoid burnout
    return deck.slice(0, 30);
}

// ── Render the full SRS page ──
function _renderSrsPage() {
    var container = document.getElementById('srsReviewContent');
    if (!container) return;

    var stats = srsGetGlobalStats();

    if (_srsCards.length === 0) {
        _renderSrsEmpty(container, stats);
        return;
    }

    var circumference = 2 * Math.PI * 42;
    var progressPct = _srsSessionStats.total / _srsCards.length;
    var offset = circumference * (1 - progressPct);

    var html = '';

    // Stats row
    html += '<div class="srs-stats-row">'
        + '<div class="srs-stat"><div class="srs-stat-num" style="color:#f59e0b">' + stats.dueCards + '</div><div class="srs-stat-lbl">Cần ôn</div></div>'
        + '<div class="srs-stat"><div class="srs-stat-num" style="color:#10b981">' + stats.reviewedToday + '</div><div class="srs-stat-lbl">Đã ôn hôm nay</div></div>'
        + '<div class="srs-stat"><div class="srs-stat-num" style="color:#8b5cf6">' + stats.masteredCards + '</div><div class="srs-stat-lbl">Đã thuộc</div></div>'
        + '<div class="srs-stat"><div class="srs-stat-num" style="color:#60a5fa">' + stats.retention + '%</div><div class="srs-stat-lbl">Retention</div></div>'
        + '</div>';

    // Retention-over-time chart
    html += _srsRenderRetentionChart();

    // Progress ring + info
    html += '<div class="srs-progress-wrap">'
        + '<div class="srs-ring-wrap">'
        + '<svg class="srs-ring-svg" width="100" height="100" viewBox="0 0 100 100">'
        + '<circle class="srs-ring-bg" cx="50" cy="50" r="42"/>'
        + '<circle class="srs-ring-fill" cx="50" cy="50" r="42" stroke-dasharray="' + circumference.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '"/>'
        + '</svg>'
        + '<div class="srs-ring-text">'
        + '<span class="srs-ring-num">' + _srsSessionStats.total + '/' + _srsCards.length + '</span>'
        + '<span class="srs-ring-label">hoàn thành</span>'
        + '</div></div>'
        + '<div class="srs-progress-info">'
        + '<div class="srs-progress-title">Phiên ôn tập hôm nay</div>'
        + '<div class="srs-progress-detail">'
        + '😰 Khó: <strong>' + _srsSessionStats.hard + '</strong> · '
        + '🙂 Ổn: <strong>' + _srsSessionStats.ok + '</strong> · '
        + '😊 Dễ: <strong>' + _srsSessionStats.easy + '</strong>'
        + '</div></div></div>';

    // Current card
    if (_srsIndex < _srsCards.length) {
        var card = _srsCards[_srsIndex];

        // Video label
        html += '<div class="srs-card-area">';
        html += '<div class="srs-video-label">📺 ' + _escHtml((card.videoTitle || '').substring(0, 60)) + '</div>';
        html += '<div class="srs-counter-badge">Thẻ ' + (_srsIndex + 1) + ' / ' + _srsCards.length + '</div>';

        // The card
        html += '<div class="srs-review-card" onclick="srsFlipCard()" tabindex="0">'
            + '<div class="srs-review-inner" id="srsCardInner">'
            + '<div class="srs-review-front">'
            + '<div class="srs-review-side-label">Câu hỏi</div>'
            + '<div class="srs-review-text">' + _escHtml(card.front) + '</div>'
            + '<div class="srs-review-hint">👆 Click để xem đáp án</div>'
            + '</div>'
            + '<div class="srs-review-back">'
            + '<div class="srs-review-side-label">Đáp án</div>'
            + '<div class="srs-review-text">' + _escHtml(card.back) + '</div>'
            + '</div></div></div>';

        // Rate buttons
        var rateOpacity = _srsFlipped ? '1' : '0.45';
        var hardResult = typeof sm2Calculate === 'function' ? sm2Calculate(card.sm2 || {ef:2.5, interval:0, repetitions:0}, 1) : {interval: 1};
        var okResult   = typeof sm2Calculate === 'function' ? sm2Calculate(card.sm2 || {ef:2.5, interval:0, repetitions:0}, 3) : {interval: 3};
        var easyResult = typeof sm2Calculate === 'function' ? sm2Calculate(card.sm2 || {ef:2.5, interval:0, repetitions:0}, 5) : {interval: 7};

        html += '<div class="srs-rate-row" style="opacity:' + rateOpacity + '" id="srsRateRow">'
            + '<button class="srs-rate-btn srs-rate-hard" onclick="srsRateCard(\'hard\')">'
            + '😰 Khó<span class="srs-rate-sub">' + _formatInterval(hardResult.interval) + '</span></button>'
            + '<button class="srs-rate-btn srs-rate-ok" onclick="srsRateCard(\'ok\')">'
            + '🙂 Ổn<span class="srs-rate-sub">' + _formatInterval(okResult.interval) + '</span></button>'
            + '<button class="srs-rate-btn srs-rate-easy" onclick="srsRateCard(\'easy\')">'
            + '😊 Dễ<span class="srs-rate-sub">' + _formatInterval(easyResult.interval) + '</span></button>'
            + '</div>';

        html += '</div>';
    } else {
        // Session complete!
        _renderSrsComplete(container);
        return;
    }

    container.innerHTML = html;
}

function _renderSrsEmpty(container, stats) {
    var html = '<div class="srs-stats-row">'
        + '<div class="srs-stat"><div class="srs-stat-num" style="color:#f59e0b">0</div><div class="srs-stat-lbl">Cần ôn</div></div>'
        + '<div class="srs-stat"><div class="srs-stat-num" style="color:#10b981">' + stats.reviewedToday + '</div><div class="srs-stat-lbl">Đã ôn hôm nay</div></div>'
        + '<div class="srs-stat"><div class="srs-stat-num" style="color:#8b5cf6">' + stats.masteredCards + '</div><div class="srs-stat-lbl">Đã thuộc</div></div>'
        + '<div class="srs-stat"><div class="srs-stat-num" style="color:#60a5fa">' + stats.retention + '%</div><div class="srs-stat-lbl">Retention</div></div>'
        + '</div>';

    html += _srsRenderRetentionChart();

    html += '<div class="srs-complete">'
        + '<div class="srs-complete-icon">🎉</div>'
        + '<div class="srs-complete-title">Không có thẻ nào cần ôn!</div>'
        + '<div class="srs-complete-sub">'
        + (stats.totalCards > 0
            ? 'Tuyệt vời! Bạn đã ôn xong tất cả. Hẹn gặp lại vào ngày mai!'
            : 'Hãy học flashcards trong một video bất kỳ để bắt đầu hệ thống ôn tập.')
        + '</div>'
        + '<button class="srs-complete-btn" onclick="closeSrsReview()">← Quay lại</button>'
        + '</div>';

    container.innerHTML = html;
}

function _renderSrsComplete(container) {
    var total = _srsSessionStats.total;
    var html = '<div class="srs-complete">'
        + '<div class="srs-complete-icon">🏆</div>'
        + '<div class="srs-complete-title">Phiên ôn tập hoàn thành!</div>'
        + '<div class="srs-complete-sub">Bạn đã ôn ' + total + ' thẻ trong phiên này. Tuyệt vời!</div>'
        + '<div class="srs-complete-stats">'
        + '<div class="srs-complete-stat"><div class="srs-complete-stat-num" style="color:#ef4444">' + _srsSessionStats.hard + '</div><div class="srs-complete-stat-lbl">😰 Khó</div></div>'
        + '<div class="srs-complete-stat"><div class="srs-complete-stat-num" style="color:#eab308">' + _srsSessionStats.ok + '</div><div class="srs-complete-stat-lbl">🙂 Ổn</div></div>'
        + '<div class="srs-complete-stat"><div class="srs-complete-stat-num" style="color:#10b981">' + _srsSessionStats.easy + '</div><div class="srs-complete-stat-lbl">😊 Dễ</div></div>'
        + '</div>'
        + '<button class="srs-complete-btn" onclick="closeSrsReview()">← Quay lại Dashboard</button>'
        + '</div>';
    container.innerHTML = html;

    // Record gamification
    if (typeof recordGamifFeature === 'function') recordGamifFeature('usedFlashcards');

    // Update gamification with review stats
    _srsUpdateGamifReview(total);
}

// ── Card interaction ──
function srsFlipCard() {
    _srsFlipped = !_srsFlipped;
    var inner = document.getElementById('srsCardInner');
    if (inner) inner.style.transform = _srsFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)';
    var rateRow = document.getElementById('srsRateRow');
    if (rateRow) rateRow.style.opacity = _srsFlipped ? '1' : '0.45';
}

function srsRateCard(rating) {
    if (!_srsFlipped) { srsFlipCard(); return; }

    var card = _srsCards[_srsIndex];
    if (!card) return;

    // Map to SM-2 quality
    var qualityMap = { hard: 1, ok: 3, easy: 5 };
    var quality = qualityMap[rating] || 3;

    // Load SM-2 data for this video
    var sm2DataStr = localStorage.getItem('lectureDigest_sm2_' + card.videoId);
    var sm2Data = {};
    try { sm2Data = JSON.parse(sm2DataStr || '{}'); } catch(e) {}

    var cardSm2 = sm2Data[card.cardKey] || { ef: 2.5, interval: 0, repetitions: 0 };

    // Calculate new SM-2 values
    if (typeof sm2Calculate === 'function') {
        var result = sm2Calculate(cardSm2, quality);
        // Persist front/back text for future review sessions
        result._front = card.front;
        result._back = card.back;
        result._tag = card.tag;
        sm2Data[card.cardKey] = result;

        // Save
        if (typeof saveSm2 === 'function') {
            saveSm2(card.videoId, sm2Data);
        } else {
            safeLsSet('lectureDigest_sm2_' + card.videoId, JSON.stringify(sm2Data));
        }
    }

    // Update session stats
    _srsSessionStats[rating]++;
    _srsSessionStats.total++;

    // Log this review into the per-day history (for the retention chart)
    _srsLogReview(rating);

    // Next card
    _srsIndex++;
    _srsFlipped = false;
    _renderSrsPage();
}

// ── Per-day review history (for the retention-over-time chart) ──
var SRS_HISTORY_KEY = 'lectureDigest_srsHistory';

function _srsLoadHistory() {
    try { return JSON.parse(localStorage.getItem(SRS_HISTORY_KEY) || '{}'); }
    catch (e) { return {}; }
}

// Record one rated card into today's bucket: { 'YYYY-MM-DD': {hard,ok,easy,total} }
function _srsLogReview(rating) {
    var today = new Date().toISOString().split('T')[0];
    var hist = _srsLoadHistory();
    var day = hist[today] || { hard: 0, ok: 0, easy: 0, total: 0 };
    if (rating === 'hard' || rating === 'ok' || rating === 'easy') day[rating]++;
    day.total++;
    hist[today] = day;

    // Prune to the last 180 days to keep storage bounded
    var keys = Object.keys(hist).sort();
    if (keys.length > 180) {
        keys.slice(0, keys.length - 180).forEach(function (k) { delete hist[k]; });
    }

    safeLsSet(SRS_HISTORY_KEY, JSON.stringify(hist));

    // Sync to backend KV store (same mechanism as other extra data)
    if (typeof dbFetch === 'function') {
        var extra = {};
        extra[SRS_HISTORY_KEY] = JSON.stringify(hist);
        dbFetch('/sync', {
            method: 'POST',
            body: JSON.stringify({ history: [], notes: {}, bookmarks: {}, gamification: {}, extra_data: extra })
        });
    }
}

// ── Retention-over-time chart (last 30 days, pure CSS bars) ──
function _srsRenderRetentionChart() {
    var hist = _srsLoadHistory();
    var days = [];
    var today = new Date();
    for (var i = 29; i >= 0; i--) {
        var d = new Date(today);
        d.setDate(today.getDate() - i);
        var key = d.toISOString().split('T')[0];
        var rec = hist[key] || { hard: 0, ok: 0, easy: 0, total: 0 };
        days.push({ key: key, date: d, rec: rec });
    }

    var totalReviewed = days.reduce(function (s, d) { return s + d.rec.total; }, 0);
    if (totalReviewed === 0) return '';  // nothing to show yet

    var maxTotal = days.reduce(function (m, d) { return Math.max(m, d.rec.total); }, 1);
    var activeDays = days.filter(function (d) { return d.rec.total > 0; }).length;

    // "Recall" = share of reviews rated ok/easy (i.e. not hard) — a rough proxy.
    var goodSum = days.reduce(function (s, d) { return s + d.rec.ok + d.rec.easy; }, 0);
    var recallPct = totalReviewed > 0 ? Math.round(goodSum / totalReviewed * 100) : 0;

    var bars = days.map(function (d) {
        var h = Math.round(d.rec.total / maxTotal * 100);
        var good = d.rec.ok + d.rec.easy;
        var goodH = d.rec.total > 0 ? Math.round(good / d.rec.total * h) : 0;
        var label = d.date.getDate() + '/' + (d.date.getMonth() + 1);
        var title = label + ': ' + d.rec.total + ' thẻ'
            + (d.rec.total > 0 ? ' (😰' + d.rec.hard + ' 🙂' + d.rec.ok + ' 😊' + d.rec.easy + ')' : '');
        return '<div class="srs-chart-bar-wrap" title="' + _escHtml(title) + '">'
            + '<div class="srs-chart-bar" style="height:' + Math.max(h, 2) + '%">'
            + (goodH > 0 ? '<div class="srs-chart-bar-good" style="height:' + goodH + '%"></div>' : '')
            + '</div></div>';
    }).join('');

    return '<div class="srs-chart-card">'
        + '<div class="srs-chart-head">'
        + '<div class="srs-chart-title">📈 Tiến độ ôn tập (30 ngày)</div>'
        + '<div class="srs-chart-legend">'
        + '<span><i class="srs-dot-good"></i> Nhớ tốt</span>'
        + '<span><i class="srs-dot-all"></i> Tổng ôn</span>'
        + '</div></div>'
        + '<div class="srs-chart-bars">' + bars + '</div>'
        + '<div class="srs-chart-foot">'
        + '<span>' + totalReviewed + ' thẻ trong ' + activeDays + ' ngày</span>'
        + '<span>Tỉ lệ nhớ tốt: <strong>' + recallPct + '%</strong></span>'
        + '</div></div>';
}

// ── Keyboard handler ──
function _srsKeyHandler(e) {
    var section = document.getElementById('srsReviewSection');
    if (!section || section.classList.contains('hidden')) return;

    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); srsFlipCard(); }
    if (e.key === '1') srsRateCard('hard');
    if (e.key === '2') srsRateCard('ok');
    if (e.key === '3') srsRateCard('easy');
    if (e.key === 'Escape') closeSrsReview();
}
document.addEventListener('keydown', _srsKeyHandler);

// ── Update gamification with daily review tracking ──
function _srsUpdateGamifReview(cardsReviewed) {
    if (typeof loadGamif !== 'function' || typeof saveGamif !== 'function') return;
    var g = loadGamif();
    if (!g.totalSrsReviews) g.totalSrsReviews = 0;
    if (!g.totalCardsReviewed) g.totalCardsReviewed = 0;
    g.totalSrsReviews++;
    g.totalCardsReviewed += cardsReviewed;
    saveGamif(g);
    if (typeof checkAndAwardBadges === 'function') checkAndAwardBadges(g);
}

// ── Helper: format interval nicely ──
function _formatInterval(days) {
    if (!days || days <= 0) return 'Ngay mai';
    if (days === 1) return '1 ngày';
    if (days < 30) return days + ' ngày';
    if (days < 365) return Math.round(days / 30) + ' tháng';
    return Math.round(days / 365) + ' năm';
}

function _escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── SRS Banner for Dashboard ──
function renderSrsBanner(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;

    var stats = srsGetGlobalStats();
    var dueCount = stats.dueCards;

    if (dueCount > 0) {
        el.innerHTML = '<div class="srs-banner" onclick="openSrsReview()">'
            + '<div class="srs-banner-icon">🧠</div>'
            + '<div class="srs-banner-body">'
            + '<div class="srs-banner-title">Bạn có ' + dueCount + ' thẻ cần ôn hôm nay!</div>'
            + '<div class="srs-banner-sub">Ôn tập đúng lúc giúp ghi nhớ tốt hơn 300%. Đã ôn hôm nay: ' + stats.reviewedToday + ' thẻ</div>'
            + '</div>'
            + '<button class="srs-banner-btn" onclick="event.stopPropagation(); openSrsReview()">Ôn ngay →</button>'
            + '</div>';
        el.classList.remove('hidden');
    } else if (stats.reviewedToday > 0) {
        el.innerHTML = '<div class="srs-banner srs-banner-done">'
            + '<div class="srs-banner-icon">✅</div>'
            + '<div class="srs-banner-body">'
            + '<div class="srs-banner-title">Đã ôn xong hôm nay! 🎉</div>'
            + '<div class="srs-banner-sub">Bạn đã ôn ' + stats.reviewedToday + ' thẻ. ' + stats.masteredCards + ' thẻ đã thuộc (' + stats.retention + '% retention)</div>'
            + '</div></div>';
        el.classList.remove('hidden');
    } else if (stats.totalCards > 0) {
        el.innerHTML = '<div class="srs-banner srs-banner-done">'
            + '<div class="srs-banner-icon">📚</div>'
            + '<div class="srs-banner-body">'
            + '<div class="srs-banner-title">Không có thẻ cần ôn hôm nay</div>'
            + '<div class="srs-banner-sub">' + stats.totalCards + ' thẻ tổng cộng · ' + stats.masteredCards + ' đã thuộc</div>'
            + '</div></div>';
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}


// ══════════════════════════════════════════════════════
// EMAIL REMINDER PREFERENCE
// ══════════════════════════════════════════════════════

var _srsReminderEnabled = false;

// Load preference when the review page opens
(function patchOpenSrsReviewForReminder() {
    if (typeof openSrsReview !== 'function') return;
    var _origOpen = openSrsReview;
    openSrsReview = function() {
        _origOpen.apply(this, arguments);
        _srsLoadReminderPref();
    };
})();

function _srsAuthHeaders() {
    var headers = { 'Content-Type': 'application/json' };
    try {
        var token = localStorage.getItem('ld_auth_token');
        if (token) headers['Authorization'] = 'Bearer ' + token;
    } catch (e) {}
    return headers;
}

function _srsIsLoggedIn() {
    try { return !!localStorage.getItem('ld_auth_token'); }
    catch (e) { return false; }
}

function _srsLoadReminderPref() {
    var btn = document.getElementById('srsReminderToggle');
    if (!btn) return;
    // Only relevant for logged-in users
    if (!_srsIsLoggedIn()) {
        btn.style.display = 'none';
        return;
    }
    btn.style.display = '';
    fetch((window.API_BASE || '') + '/api/srs-reminder/preference', {
        headers: _srsAuthHeaders()
    })
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(data) {
            if (!data) return;
            _srsReminderEnabled = !!data.enabled;
            _srsUpdateReminderBtn(data.smtp_configured);
        })
        .catch(function() {});
}

function _srsUpdateReminderBtn(smtpConfigured) {
    var btn = document.getElementById('srsReminderToggle');
    if (!btn) return;
    if (_srsReminderEnabled) {
        btn.classList.add('active');
        btn.innerHTML = '🔔 Đang bật';
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '🔕 Nhắc nhở';
    }
    if (smtpConfigured === false) {
        btn.title = 'Máy chủ chưa cấu hình email — nhắc nhở sẽ chỉ ghi log';
    } else {
        btn.title = 'Nhắc nhở ôn tập qua email mỗi ngày';
    }
}

function toggleSrsReminder() {
    if (!_srsIsLoggedIn()) {
        if (typeof showToast === 'function') showToast('Hãy đăng nhập để bật nhắc nhở qua email', 3000);
        return;
    }
    var newState = !_srsReminderEnabled;
    fetch((window.API_BASE || '') + '/api/srs-reminder/preference', {
        method: 'POST',
        headers: _srsAuthHeaders(),
        body: JSON.stringify({ enabled: newState })
    })
    .then(function(res) { return res.ok ? res.json() : null; })
    .then(function(data) {
        if (!data) return;
        _srsReminderEnabled = !!data.enabled;
        _srsUpdateReminderBtn();
        if (typeof showToast === 'function') {
            showToast(_srsReminderEnabled
                ? '🔔 Đã bật nhắc nhở ôn tập qua email!'
                : '🔕 Đã tắt nhắc nhở qua email', 2500);
        }
    })
    .catch(function() {
        if (typeof showToast === 'function') showToast('Không thể cập nhật cài đặt', 2500);
    });
}
