/* ════════════════════════════════════════════════
   LectureDigest — Badges Page
   ════════════════════════════════════════════════ */

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

