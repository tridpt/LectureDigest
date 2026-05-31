
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
    _dashShowSkeleton();
    showSection('dashboardSection');
    window.scrollTo({ top: 0, behavior: 'instant' });
    // Load weekly goals module, then render dashboard
    var loadPromises = [
        typeof loadFeature === 'function' ? loadFeature('weeklyGoals') : Promise.resolve(),
        typeof loadFeature === 'function' ? loadFeature('analytics') : Promise.resolve(),
    ];
    Promise.all(loadPromises).then(function() {
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                renderDashboard();
            });
        });
    }).catch(function() {
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                renderDashboard();
            });
        });
    });
}

function closeDashboard() {
    const ds = document.getElementById('dashboardSection');
    if (ds) ds.classList.add('hidden');
    showSection(_dashPrevSection);
    window.scrollTo({ top: 0, behavior: 'instant' });
}

function getDashboardData() {
    var g = {};
    try { g = loadGamif(); } catch (e) { console.error('[Dashboard] loadGamif error:', e); }
    var history = [];
    try {
        var raw = localStorage.getItem('lectureDigest_history');
        history = raw ? JSON.parse(raw) : [];
    } catch (e) { console.error('[Dashboard] history parse error:', e); }
    return { g: g, history: history };
}

function renderDashboard() {
    var g, history;
    try {
        var data = getDashboardData();
        g = data.g;
        history = data.history;
    } catch (e) {
        console.error('[Dashboard] getDashboardData error:', e);
        g = {}; history = [];
    }

    // Date
    try {
        const dateEl = document.getElementById('dbDate');
        if (dateEl) {
            const now = new Date();
            dateEl.textContent = now.toLocaleDateString('vi-VN', {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
            });
        }
    } catch (e) { console.error('[Dashboard] date error:', e); }

    var renders = [
        ['renderDbStats',     'dbStatGrid',      function() { renderDbStats(g, history); }],
        ['renderContinueLearning', 'dbContinueLearning', function() { renderContinueLearning(history); }],
        ['renderWeeklyGoals', 'dbWeeklyGoals',   function() { if (typeof renderWeeklyGoals === 'function') renderWeeklyGoals(); }],
        ['renderDbStreak',    'dbCalendar',       function() { renderDbStreak(g); }],
        ['renderDbPomodoro',  'dbPomoStats',      function() { renderDbPomodoro(g); }],
        ['renderDbVideos',    'dbVideoList',      function() { renderDbVideos(history); }],
        ['renderDbBadgeCats', 'dbBadgeCats',      function() { renderDbBadgeCats(g); }],
        ['renderSrsBanner',   'srsBannerWrap',    function() { if (typeof renderSrsBanner === 'function') renderSrsBanner('srsBannerWrap'); }],
        ['renderStudyPlanBanner', 'spBannerWrap', function() { if (typeof renderStudyPlanBanner === 'function') renderStudyPlanBanner('spBannerWrap'); }],
        ['anHeatmap',         'anHeatmap',        function() { if (typeof _anRenderHeatmap === 'function') _anRenderHeatmap(g); }],
        ['anQuizTrend',       'anQuizTrend',      function() { if (typeof _anRenderQuizTrend === 'function') _anRenderQuizTrend(history); }],
        ['anWeeklyReport',    'anWeeklyReport',   function() { if (typeof _anRenderWeeklyReport === 'function') _anRenderWeeklyReport(g, history); }],
        ['anTopicMastery',    'anTopicMastery',   function() { if (typeof _anRenderTopicMastery === 'function') _anRenderTopicMastery(history); }],
    ];

    renders.forEach(function(entry) {
        var name = entry[0], containerId = entry[1], fn = entry[2];
        try {
            fn();
        } catch (e) {
            console.error('[Dashboard] ' + name + ' error:', e);
            // Show inline error UI inside the failed card's container
            _dashShowCardError(containerId, name, e);
        }
    });
}

/**
 * Show a styled error message inside a dashboard card that failed to render.
 * Includes a retry button that re-runs the full dashboard render.
 */
function _dashShowCardError(containerId, renderName, error) {
    var container = containerId ? document.getElementById(containerId) : null;
    if (!container) return;

    container.innerHTML =
        '<div class="db-card-error">' +
            '<div class="db-card-error-icon">⚠️</div>' +
            '<div class="db-card-error-text">' +
                '<span>Không thể tải phần này</span>' +
                '<small>' + escHtml(renderName + ': ' + (error.message || error)) + '</small>' +
            '</div>' +
            '<button class="db-card-error-retry" onclick="try{renderDashboard()}catch(e){}" title="Thử lại">' +
                '↻ Thử lại' +
            '</button>' +
        '</div>';
}

// ── Stat cards ──────────────────────────────────────────
function renderDbStats(g, history) {
    const grid = document.getElementById('dbStatGrid');
    if (!grid) return;

    const scores = [];
    const seenV = new Set();
    history.forEach(h => {
        if (seenV.has(h.video_id)) return;
        seenV.add(h.video_id);
        if (typeof loadProgress === 'function') {
            const prog = loadProgress(h.video_id);
            (prog.quizSessions || []).forEach(qs => { if (qs.pct != null) scores.push(qs.pct); });
        }
    });
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
        { icon: '🍅', label: 'Pomodoro',        value: g.pomoSessions || 0, sub: (g.pomoTotalMin || 0) + ' phút focus', color: '#ef4444' },
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
            '<span class="db-sn-val" style="color:#8b5cf6">' + (g.longestStreak || 0) + '</span>' +
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

    // Collect quiz sessions from progress storage (per-video)
    const sessions = [];
    const seenVids = new Set();
    history.slice().reverse().forEach(h => {
        if (seenVids.has(h.video_id)) return;
        seenVids.add(h.video_id);
        if (typeof loadProgress === 'function') {
            const prog = loadProgress(h.video_id);
            (prog.quizSessions || []).forEach(qs => {
                sessions.push({ title: h.title || 'Video', score: qs.pct || 0 });
            });
        }
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
        let scores = [];
        if (typeof loadProgress === 'function') {
            const vProg = loadProgress(h.video_id);
            scores = (vProg.quizSessions || []).map(qs => qs.pct || 0);
        }
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

// ── Pomodoro Focus Stats ────────────────────────────────
function renderDbPomodoro(g) {
    var el = document.getElementById('dbPomoStats');
    if (!el) return;

    var sessions   = g.pomoSessions || 0;
    var totalMin   = g.pomoTotalMin || 0;
    var avgPerSess = sessions > 0 ? Math.round(totalMin / sessions) : 0;
    var totalHours = (totalMin / 60).toFixed(1);

    if (!sessions) {
        el.innerHTML = '<div class="db-pomo-empty">' +
            '<div class="db-pomo-empty-icon">🍅</div>' +
            '<p>Chưa có phiên Pomodoro nào.</p>' +
            '<p class="db-pomo-empty-hint">Bấm nút Pomodoro khi xem video để bắt đầu!</p>' +
            '</div>';
        return;
    }

    // Build the stats grid
    var html = '<div class="db-pomo-grid">';
    html += _dbPomoStatItem('🎯', sessions, 'Phiên focus', '#8b5cf6');
    html += _dbPomoStatItem('⏱️', totalMin + ' ph', 'Tổng focus', '#f59e0b');
    html += _dbPomoStatItem('📊', avgPerSess + ' ph', 'TB / phiên', '#10b981');
    html += _dbPomoStatItem('🕐', totalHours + 'h', 'Giờ tập trung', '#60a5fa');
    html += '</div>';

    // Productivity message
    var msg = '';
    if (totalMin >= 300) msg = '🏆 Xuất sắc! Bạn đã tập trung hơn 5 giờ!';
    else if (totalMin >= 120) msg = '🔥 Tuyệt vời! Hơn 2 giờ tập trung!';
    else if (totalMin >= 60)  msg = '💪 Tiếp tục phát huy! Đã focus 1 giờ+';
    else if (sessions >= 1)   msg = '🌱 Khởi đầu tốt! Hãy tiếp tục!';

    if (msg) {
        html += '<div class="db-pomo-msg">' + msg + '</div>';
    }

    // Visual progress bar (how many pomodoro sessions = how many 🍅)
    var tomatoCount = Math.min(sessions, 20);
    var tomatoes = '';
    for (var i = 0; i < tomatoCount; i++) {
        tomatoes += '<span class="db-pomo-tomato" style="animation-delay:' + (i * 0.05) + 's">🍅</span>';
    }
    if (sessions > 20) tomatoes += '<span class="db-pomo-more">+' + (sessions - 20) + '</span>';
    html += '<div class="db-pomo-tomatoes">' + tomatoes + '</div>';

    el.innerHTML = html;
}

function _dbPomoStatItem(icon, value, label, color) {
    return '<div class="db-pomo-stat-item">' +
        '<div class="db-pomo-stat-icon">' + icon + '</div>' +
        '<div class="db-pomo-stat-val" style="color:' + color + '">' + value + '</div>' +
        '<div class="db-pomo-stat-lbl">' + label + '</div>' +
        '</div>';
}


// ═══════════════════════════════════════════════════════
// STUDY STATISTICS
// ═══════════════════════════════════════════════════════

function renderStudyStats(g, history) {
    var container = document.getElementById('dbStudyStats');
    if (!container) return;

    var sections = [
        ['📊 Hoat dong 7 ngay qua', 'stats-week-chart', function() { return buildWeekChart(g); }],
        ['🏷️ Phan loai video',      'stats-categories', function() { return buildCategoryChart(history); }],
        ['🧠 Spaced Repetition',    'stats-sm2',        function() { return buildSm2Stats(); }],
        ['📈 Tien do hoc tap',      'stats-timeline',   function() { return buildLearningTimeline(history); }, true],
    ];

    var html = '';
    sections.forEach(function(s) {
        var title = s[0], cls = s[1], builder = s[2], isWide = s[3];
        var content;
        try {
            content = builder();
        } catch (e) {
            console.error('[Dashboard] ' + cls + ' error:', e);
            content = '<div class="db-card-error" style="padding:12px">' +
                '<span>⚠️</span> <small>' + escHtml(e.message || String(e)) + '</small>' +
                '</div>';
        }
        html += '<div class="stats-card' + (isWide ? ' stats-card-wide' : '') + '">' +
            '<div class="stats-card-title">' + title + '</div>' +
            '<div class="' + cls + '">' + content + '</div>' +
            '</div>';
    });
    container.innerHTML = html;
}

function buildWeekChart(g) {
    var DOW = ['CN','T2','T3','T4','T5','T6','T7'];
    var today = new Date(); today.setHours(0,0,0,0);
    var studySet = {};
    (g.studyDates || []).forEach(function(d){ studySet[d]=1; });
    var bars = '';
    var activeDays = 0;
    for (var i = 6; i >= 0; i--) {
        var d = new Date(today); d.setDate(today.getDate()-i);
        var key = d.toISOString().slice(0,10);
        var active = studySet[key] ? 1 : 0;
        if (active) activeDays++;
        bars += '<div class="stats-bar-col"><div class="stats-bar-track"><div class="stats-bar-fill'+(active?' active':'')+'" style="height:'+(active?'100':'15')+'%"></div></div><div class="stats-bar-label'+(i===0?' today':'')+'">'+DOW[d.getDay()]+'</div><div class="stats-bar-day">'+d.getDate()+'</div></div>';
    }
    return '<div class="stats-bar-header"><span>'+activeDays+'/7 ngay</span><span>'+Math.round(activeDays/7*100)+'% tuan nay</span></div><div class="stats-bar-chart">'+bars+'</div>';
}

function buildCategoryChart(history) {
    var tagCounts = {}, total = 0;
    if (typeof loadAllTags === 'function') {
        var allTags = loadAllTags();
        for (var vid in allTags) {
            (allTags[vid]||[]).forEach(function(tagId){ tagCounts[tagId]=(tagCounts[tagId]||0)+1; total++; });
        }
    }
    if (total === 0) return '<div class="stats-empty">Chua gan tag cho video nao</div>';
    var TAGS = (typeof PREDEFINED_TAGS !== 'undefined') ? PREDEFINED_TAGS : [];
    var sorted = Object.keys(tagCounts).sort(function(a,b){return tagCounts[b]-tagCounts[a];});
    var html = '';
    sorted.forEach(function(tagId){
        var count = tagCounts[tagId];
        var pct = Math.round(count/total*100);
        var tag = {label:tagId,color:'#6b7280',icon:''};
        for(var i=0;i<TAGS.length;i++){if(TAGS[i].id===tagId){tag=TAGS[i];break;}}
        html += '<div class="stats-cat-row"><div class="stats-cat-info"><span class="stats-cat-icon">'+tag.icon+'</span><span>'+tag.label+'</span></div><div class="stats-cat-bar-wrap"><div class="stats-cat-bar" style="width:'+pct+'%;background:'+tag.color+'"></div></div><span class="stats-cat-pct">'+count+' ('+pct+'%)</span></div>';
    });
    return html;
}

function buildSm2Stats() {
    var totalCards=0,totalDue=0,totalReviewed=0,efSum=0,efCount=0;
    var today = new Date().toISOString().split('T')[0];
    for(var i=0;i<localStorage.length;i++){
        var key = localStorage.key(i);
        if(key && key.indexOf('lectureDigest_sm2_')===0){
            try{
                var data = JSON.parse(localStorage.getItem(key));
                for(var ck in data){
                    totalCards++;
                    if(data[ck].nextReview && data[ck].nextReview<=today) totalDue++;
                    if(data[ck].repetitions>0) totalReviewed++;
                    if(data[ck].ef){efSum+=data[ck].ef;efCount++;}
                }
            }catch(e){}
        }
    }
    var avgEf = efCount?(efSum/efCount).toFixed(2):'N/A';
    return '<div class="stats-sm2-grid">'
        +'<div class="stats-sm2-item"><div class="stats-sm2-num" style="color:#8b5cf6">'+totalCards+'</div><div class="stats-sm2-lbl">Tong card</div></div>'
        +'<div class="stats-sm2-item"><div class="stats-sm2-num" style="color:#f59e0b">'+totalDue+'</div><div class="stats-sm2-lbl">Can on hom nay</div></div>'
        +'<div class="stats-sm2-item"><div class="stats-sm2-num" style="color:#10b981">'+totalReviewed+'</div><div class="stats-sm2-lbl">Da on</div></div>'
        +'<div class="stats-sm2-item"><div class="stats-sm2-num" style="color:#60a5fa">'+avgEf+'</div><div class="stats-sm2-lbl">EF trung binh</div></div>'
        +'</div>';
}

function buildLearningTimeline(history) {
    if(!history.length) return '<div class="stats-empty">Chua co du lieu hoc tap</div>';
    var byDate = {};
    history.forEach(function(h){var date=new Date(h.savedAt).toISOString().slice(0,10);byDate[date]=(byDate[date]||0)+1;});
    var dates = Object.keys(byDate).sort();
    var last14 = dates.slice(-14);
    var maxVal = 1;
    last14.forEach(function(d){if(byDate[d]>maxVal)maxVal=byDate[d];});
    var html = '<div class="stats-tl-chart">';
    last14.forEach(function(date){
        var count = byDate[date];
        var pct = Math.round(count/maxVal*100);
        html += '<div class="stats-tl-col"><div class="stats-tl-count">'+count+'</div><div class="stats-tl-track"><div class="stats-tl-fill" style="height:'+Math.max(8,pct)+'%"></div></div><div class="stats-tl-date">'+date.slice(5)+'</div></div>';
    });
    html += '</div>';
    var totalVideos = history.length;
    var uniqueDays = dates.length;
    html += '<div class="stats-tl-summary"><span>'+totalVideos+' video</span><span>'+uniqueDays+' ngay hoc</span><span>TB '+(totalVideos/Math.max(uniqueDays,1)).toFixed(1)+' video/ngay</span></div>';
    return html;
}

// ══════════════════════════════════════════════════════
// SKELETON LOADING
// ══════════════════════════════════════════════════════

function _skl(w, h, r) {
    r = r || '8px';
    return '<div class="db-skel" style="width:' + w + ';height:' + h + ';border-radius:' + r + '"></div>';
}

function _dashShowSkeleton() {
    // Date
    var dateEl = document.getElementById('dbDate');
    if (dateEl) dateEl.innerHTML = _skl('180px', '14px');

    // Stat grid — 5 skeleton stat cards
    var statGrid = document.getElementById('dbStatGrid');
    if (statGrid) {
        var cards = '';
        for (var i = 0; i < 5; i++) {
            cards += '<div class="db-stat-card">' +
                _skl('32px', '32px', '10px') +
                '<div style="flex:1;display:flex;flex-direction:column;gap:6px">' +
                _skl('50px', '22px') +
                _skl('70px', '12px') +
                '</div></div>';
        }
        statGrid.innerHTML = cards;
    }

    // Weekly goals
    var goalsEl = document.getElementById('dbWeeklyGoals');
    if (goalsEl) {
        goalsEl.innerHTML = '<div style="display:flex;flex-direction:column;gap:10px;padding:4px 0">' +
            _skl('100%', '40px', '10px') +
            _skl('100%', '40px', '10px') +
            _skl('60%', '40px', '10px') +
            '</div>';
    }

    // Streak — numbers + calendar grid
    var streakNums = document.getElementById('dbStreakNums');
    if (streakNums) {
        streakNums.innerHTML = '<div style="display:flex;gap:16px;align-items:center">' +
            _skl('60px', '36px', '10px') +
            '<div style="width:1px;height:40px;background:rgba(255,255,255,0.06)"></div>' +
            _skl('60px', '36px', '10px') +
            '</div>';
    }
    var calendar = document.getElementById('dbCalendar');
    if (calendar) {
        var cells = '';
        for (var c = 0; c < 28; c++) {
            cells += '<div class="db-skel" style="aspect-ratio:1;border-radius:6px"></div>';
        }
        calendar.innerHTML = cells;
    }

    // Quiz chart
    var quiz = document.getElementById('dbQuizChart');
    if (quiz) {
        var bars = '';
        for (var b = 0; b < 5; b++) {
            bars += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
                _skl((30 + Math.random() * 60) + '%', '12px', '99px') +
                _skl('30px', '12px') +
                '</div>';
        }
        quiz.innerHTML = bars;
    }

    // Pomodoro
    var pomo = document.getElementById('dbPomoStats');
    if (pomo) {
        pomo.innerHTML = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">' +
            _skl('100%', '70px', '12px') +
            _skl('100%', '70px', '12px') +
            _skl('100%', '70px', '12px') +
            _skl('100%', '70px', '12px') +
            '</div>';
    }

    // Study stats
    var stats = document.getElementById('dbStudyStats');
    if (stats) {
        stats.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
            _skl('100%', '150px', '14px') +
            _skl('100%', '150px', '14px') +
            '</div>';
    }

    // Video list — 4 skeleton video items
    var vids = document.getElementById('dbVideoList');
    if (vids) {
        var items = '';
        for (var v = 0; v < 4; v++) {
            items += '<div style="display:flex;align-items:center;gap:14px;padding:10px 0">' +
                _skl('80px', '52px', '8px') +
                '<div style="flex:1;display:flex;flex-direction:column;gap:6px">' +
                _skl((60 + Math.random() * 30) + '%', '13px') +
                '<div style="display:flex;gap:10px">' +
                _skl('50px', '11px') + _skl('40px', '11px') +
                '</div></div></div>';
        }
        vids.innerHTML = items;
    }

    // Badges
    var badges = document.getElementById('dbBadgeCats');
    if (badges) {
        var cats = '';
        for (var bg = 0; bg < 3; bg++) {
            cats += '<div style="margin-bottom:14px">' +
                _skl('80px', '13px') +
                '<div style="display:flex;gap:6px;margin:8px 0">' +
                _skl('28px', '28px', '6px') + _skl('28px', '28px', '6px') +
                _skl('28px', '28px', '6px') + _skl('28px', '28px', '6px') +
                '</div>' +
                _skl('100%', '6px', '99px') +
                '</div>';
        }
        badges.innerHTML = cats;
    }
}


// ══════════════════════════════════════════════════════
// CONTINUE LEARNING WIDGET
// In-progress videos (watched but not finished) + due SRS cards
// ══════════════════════════════════════════════════════

function renderContinueLearning(history) {
    var el = document.getElementById('dbContinueLearning');
    if (!el) return;

    // Find videos that are in-progress: watched between 5% and 95%
    var inProgress = [];
    var seen = {};
    (history || []).forEach(function(h) {
        if (!h.video_id || seen[h.video_id]) return;
        seen[h.video_id] = true;
        if (typeof loadProgress !== 'function') return;
        var prog = loadProgress(h.video_id);
        var pct = prog.watchedPct || 0;
        if (pct >= 5 && pct < 95) {
            inProgress.push({
                video_id: h.video_id,
                title: h.title || 'Video chưa đặt tên',
                pct: pct,
                lastWatched: prog.lastWatched || null
            });
        }
    });

    // Sort by most recently watched
    inProgress.sort(function(a, b) {
        var ta = a.lastWatched ? new Date(a.lastWatched).getTime() : 0;
        var tb = b.lastWatched ? new Date(b.lastWatched).getTime() : 0;
        return tb - ta;
    });
    inProgress = inProgress.slice(0, 4);

    // Due SRS cards count
    var dueCount = 0;
    if (typeof srsGetGlobalStats === 'function') {
        try { dueCount = srsGetGlobalStats().dueCards || 0; } catch (e) {}
    }

    // Nothing to continue → hide widget
    if (!inProgress.length && dueCount === 0) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
    }

    var html = '<div class="db-card db-continue-panel">';
    html += '<h3 class="db-card-title">▶️ Tiếp tục học</h3>';
    html += '<div class="db-continue-grid">';

    // Due SRS card tile (first, if any)
    if (dueCount > 0) {
        html += '<div class="db-cont-item db-cont-srs" onclick="closeDashboard(); openSrsReview();" role="button" tabindex="0">'
            + '<div class="db-cont-srs-icon">🧠</div>'
            + '<div class="db-cont-body">'
            + '<div class="db-cont-title">' + dueCount + ' thẻ cần ôn hôm nay</div>'
            + '<div class="db-cont-sub">Ôn tập spaced repetition</div>'
            + '</div>'
            + '<div class="db-cont-arrow">→</div>'
            + '</div>';
    }

    // In-progress video tiles
    inProgress.forEach(function(v) {
        var thumb = 'https://img.youtube.com/vi/' + v.video_id + '/mqdefault.jpg';
        var timeAgo = v.lastWatched ? _dbTimeAgo(v.lastWatched) : '';
        html += '<div class="db-cont-item" onclick="loadVideoFromDashboard(\'' + v.video_id + '\')" role="button" tabindex="0">'
            + '<div class="db-cont-thumb-wrap">'
            + '<img class="db-cont-thumb" src="' + thumb + '" onerror="this.style.display=\'none\'" alt="" loading="lazy">'
            + '<div class="db-cont-pct-badge">' + v.pct + '%</div>'
            + '</div>'
            + '<div class="db-cont-body">'
            + '<div class="db-cont-title">' + escHtml(v.title) + '</div>'
            + '<div class="db-cont-progress-track"><div class="db-cont-progress-fill" style="width:' + v.pct + '%"></div></div>'
            + (timeAgo ? '<div class="db-cont-sub">' + timeAgo + '</div>' : '')
            + '</div>'
            + '<div class="db-cont-arrow">→</div>'
            + '</div>';
    });

    html += '</div></div>';
    el.innerHTML = html;
    el.classList.remove('hidden');
}

// Relative time helper ("2 giờ trước", "hôm qua", ...)
function _dbTimeAgo(iso) {
    try {
        var then = new Date(iso).getTime();
        var diff = Date.now() - then;
        var mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Vừa xong';
        if (mins < 60) return mins + ' phút trước';
        var hours = Math.floor(mins / 60);
        if (hours < 24) return hours + ' giờ trước';
        var days = Math.floor(hours / 24);
        if (days === 1) return 'Hôm qua';
        if (days < 30) return days + ' ngày trước';
        return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
    } catch (e) { return ''; }
}
