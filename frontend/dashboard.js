
// ══════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════

// Add dashboardSection to SECTION_IDS (patched after definition)
if (typeof SECTION_IDS !== 'undefined' && !SECTION_IDS.includes('dashboardSection')) {
    SECTION_IDS.push('dashboardSection');
}
// SPA route
if (typeof SPA_ROUTES !== 'undefined') SPA_ROUTES['dashboardSection'] = '/dashboard';

let _dashPrevSection = 'hero';

function openDashboard() {
    _dashPrevSection = SECTION_IDS.find(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
    }) || 'hero';
    renderDashboard();
    showSection('dashboardSection');
    window.scrollTo({ top: 0, behavior: 'instant' });
}

function closeDashboard() {
    const ds = document.getElementById('dashboardSection');
    if (ds) ds.classList.add('hidden');
    showSection(_dashPrevSection);
    window.scrollTo({ top: 0, behavior: 'instant' });
}

function getDashboardData() {
    const g   = loadGamif();
    const raw = localStorage.getItem('lectureDigest_history');
    const history = raw ? JSON.parse(raw) : [];
    return { g, history };
}

function renderDashboard() {
    const { g, history } = getDashboardData();

    // Date
    const dateEl = document.getElementById('dbDate');
    if (dateEl) {
        const now = new Date();
        dateEl.textContent = now.toLocaleDateString('vi-VN', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
    }

    renderDbStats(g, history);
    renderDbStreak(g);
    renderDbQuizChart(history);
    renderDbVideos(history);
    renderDbBadgeCats(g);
}

// ── Stat cards ──────────────────────────────────────────
function renderDbStats(g, history) {
    const grid = document.getElementById('dbStatGrid');
    if (!grid) return;

    const scores = history.flatMap(h => h.quizScores || []).filter(s => s != null);
    const avgScore = scores.length
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null;

    const earnedCount = (g.earnedBadges || []).length;

    const cards = [
        { icon: '🎬', label: 'Video đã học',    value: g.totalVideos   || 0,  sub: 'lần phân tích',   color: '#8b5cf6' },
        { icon: '🔥', label: 'Streak hiện tại', value: g.currentStreak || 0,  sub: 'ngày liên tiếp',  color: '#f59e0b' },
        { icon: '🧠', label: 'Quiz đã làm',     value: g.totalQuizzes  || 0,  sub: 'bài kiểm tra',    color: '#10b981' },
        { icon: '⭐', label: 'Điểm quiz TB',    value: avgScore != null ? avgScore + '%' : 'N/A', sub: 'trung bình', color: '#60a5fa' },
        { icon: '🏆', label: 'Huy hiệu',        value: earnedCount + '/' + (typeof BADGES !== 'undefined' ? BADGES.length : 0), sub: 'đã mở khoá', color: '#f472b6' },
        { icon: '📅', label: 'Ngày học',        value: g.totalStudyDays || 0, sub: 'tổng cộng',       color: '#34d399' },
    ];

    grid.innerHTML = cards.map(c =>
        '<div class="db-stat-card" style="--card-accent:' + c.color + '">' +
        '<div class="db-sc-icon">' + c.icon + '</div>' +
        '<div class="db-sc-body">' +
        '<div class="db-sc-value">' + c.value + '</div>' +
        '<div class="db-sc-label">' + c.label + '</div>' +
        '<div class="db-sc-sub">' + c.sub + '</div>' +
        '</div></div>'
    ).join('');
}

// ── Streak / Activity Calendar (last 28 days) ──────────
function renderDbStreak(g) {
    const numsEl = document.getElementById('dbStreakNums');
    const calEl  = document.getElementById('dbCalendar');
    if (!calEl) return;

    if (numsEl) {
        numsEl.innerHTML =
            '<div class="db-sn-item">' +
            '<span class="db-sn-val" style="color:#f59e0b">' + (g.currentStreak || 0) + '</span>' +
            '<span class="db-sn-lbl">🔥 Hiện tại</span></div>' +
            '<div class="db-sn-sep"></div>' +
            '<div class="db-sn-item">' +
            '<span class="db-sn-val" style="color:#8b5cf6">' + (g.bestStreak || 0) + '</span>' +
            '<span class="db-sn-lbl">🏆 Kỷ lục</span></div>' +
            '<div class="db-sn-sep"></div>' +
            '<div class="db-sn-item">' +
            '<span class="db-sn-val" style="color:#34d399">' + (g.totalStudyDays || 0) + '</span>' +
            '<span class="db-sn-lbl">📅 Tổng</span></div>';
    }

    const days = 28;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const studySet = new Set(g.studyDates || []);

    const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    let html = '';
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const key    = d.toISOString().slice(0, 10);
        const active = studySet.has(key);
        const isToday = i === 0;
        const dow    = DOW[d.getDay()];
        html += '<div class="db-cal-cell' +
            (active  ? ' db-cal-active'  : '') +
            (isToday ? ' db-cal-today'   : '') +
            '" title="' + key + '">' +
            '<span class="db-cal-dow">' + dow + '</span>' +
            '</div>';
    }
    calEl.innerHTML = html;
}

// ── Quiz performance bar chart ─────────────────────────
function renderDbQuizChart(history) {
    const chartEl = document.getElementById('dbQuizChart');
    const avgEl   = document.getElementById('dbQuizAvg');
    if (!chartEl) return;

    // Collect quiz sessions (score per attempt)
    const sessions = [];
    history.slice().reverse().slice(0, 8).forEach(h => {
        (h.quizScores || []).forEach(score => {
            sessions.push({ title: h.title || 'Video', score });
        });
    });

    if (!sessions.length) {
        chartEl.innerHTML = '<p class="db-empty">Chưa có dữ liệu quiz. Hãy làm quiz sau khi phân tích video!</p>';
        if (avgEl) avgEl.textContent = '';
        return;
    }

    chartEl.innerHTML = sessions.map(s => {
        const pct   = Math.min(100, Math.max(0, s.score));
        const color = pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444';
        return '<div class="db-qbar-wrap">' +
            '<div class="db-qbar-track">' +
            '<div class="db-qbar-fill" style="width:' + pct + '%;background:' + color + '" title="' + s.title + '"></div>' +
            '</div>' +
            '<span class="db-qbar-label">' + Math.round(pct) + '%</span>' +
            '</div>';
    }).join('');

    if (avgEl) {
        const avg = Math.round(sessions.reduce((a, s) => a + s.score, 0) / sessions.length);
        const color = avg >= 80 ? '#10b981' : avg >= 60 ? '#f59e0b' : '#ef4444';
        avgEl.innerHTML = 'Trung bình: <strong style="color:' + color + '">' + avg + '%</strong> trên ' + sessions.length + ' lần làm';
    }
}

// ── Recent videos ──────────────────────────────────────
function renderDbVideos(history) {
    const listEl = document.getElementById('dbVideoList');
    if (!listEl) return;

    const recent = history.slice(0, 8);
    if (!recent.length) {
        listEl.innerHTML = '<p class="db-empty">Chưa có video nào được phân tích. Hãy dán link YouTube để bắt đầu!</p>';
        return;
    }

    listEl.innerHTML = recent.map(h => {
        const scores   = (h.quizScores || []);
        const avgScore = scores.length
            ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
            : null;
        const dateStr  = h.analyzedAt
            ? new Date(h.analyzedAt).toLocaleDateString('vi-VN')
            : '';
        const thumb = 'https://img.youtube.com/vi/' + (h.video_id || '') + '/mqdefault.jpg';
        const vid   = h.video_id || '';

        return '<div class="db-video-item" onclick="loadVideoFromDashboard(\'' + vid + '\')" role="button" tabindex="0">' +
            '<img class="db-vid-thumb" src="' + thumb + '" onerror="this.style.display=\'none\'" alt="" loading="lazy">' +
            '<div class="db-vid-meta">' +
            '<div class="db-vid-title">' + (h.title || 'Video chưa đặt tên') + '</div>' +
            '<div class="db-vid-info">' +
            (dateStr ? '<span>📅 ' + dateStr + '</span>' : '') +
            (h.language ? '<span>🌐 ' + h.language + '</span>' : '') +
            (avgScore != null ? '<span class="db-quiz-tag">🧠 ' + avgScore + '%</span>' : '') +
            '</div></div>' +
            '<div class="db-vid-arrow">›</div>' +
            '</div>';
    }).join('');
}

// Wrapper: close dashboard first, then load the video results
function loadVideoFromDashboard(videoId) {
    // Hide dashboard overlay immediately
    const ds = document.getElementById('dashboardSection');
    if (ds) ds.classList.add('hidden');
    // Load the video results (handles showSection internally)
    if (typeof loadFromHistory === 'function') {
        loadFromHistory(videoId);
    }
}

// ── Badge category progress bars ───────────────────────
function renderDbBadgeCats(g) {
    const el = document.getElementById('dbBadgeCats');
    if (!el || typeof BADGES === 'undefined') return;

    const cats = [...new Set(BADGES.map(b => b.cat))];
    el.innerHTML = cats.map(cat => {
        const all    = BADGES.filter(b => b.cat === cat);
        const earned = all.filter(b => g.earnedBadges.includes(b.id)).length;
        const pct    = Math.round(earned / all.length * 100);
        const icons  = all.slice(0, 6).map(b =>
            '<span class="db-bcat-icon' + (g.earnedBadges.includes(b.id) ? ' earned' : ' locked') + '">' + b.icon + '</span>'
        ).join('');

        return '<div class="db-bcat-row">' +
            '<div class="db-bcat-head">' +
            '<span class="db-bcat-name">' + (typeof CAT_LABELS !== 'undefined' ? CAT_LABELS[cat] || cat : cat) + '</span>' +
            '<span class="db-bcat-count">' + earned + '/' + all.length + '</span>' +
            '</div>' +
            '<div class="db-bcat-icons">' + icons + '</div>' +
            '<div class="db-bcat-track"><div class="db-bcat-fill" style="width:' + pct + '%"></div></div>' +
            '</div>';
    }).join('');
}
