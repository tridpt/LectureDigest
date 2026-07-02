/* ════════════════════════════════════════════════
   LectureDigest — Weekly Learning Goals
   ════════════════════════════════════════════════ */

const WEEKLY_GOALS_KEY = 'lectureDigest_weeklyGoals';

const DEFAULT_GOALS = {
    videos:   { target: 3,  label: 'Video phân tích', icon: '🎬', color: '#1e40af' },
    quizzes:  { target: 5,  label: 'Quiz hoàn thành', icon: '🧠', color: '#10b981' },
    pomodoro: { target: 5,  label: 'Phiên Pomodoro',  icon: '🍅', color: '#ef4444' },
    studyDays:{ target: 5,  label: 'Ngày học',        icon: '📅', color: '#f59e0b' },
};

/* ── Load / Save ─────────────────────────────── */
function loadWeeklyGoals() {
    try {
        var raw = JSON.parse(localStorage.getItem(WEEKLY_GOALS_KEY) || '{}');
        // Ensure all fields exist
        if (!raw.targets) raw.targets = {};
        Object.keys(DEFAULT_GOALS).forEach(function(k) {
            if (!raw.targets[k]) raw.targets[k] = DEFAULT_GOALS[k].target;
        });
        if (!raw.weekStart) raw.weekStart = _getWeekStartISO();
        return raw;
    } catch (e) {
        return { targets: _defaultTargets(), weekStart: _getWeekStartISO() };
    }
}

function saveWeeklyGoals(data) {
    safeLsSet(WEEKLY_GOALS_KEY, JSON.stringify(data));
    // Sync to cloud
    if (typeof dbFetch === 'function') {
        var extra = {};
        extra[WEEKLY_GOALS_KEY] = JSON.stringify(data);
        dbFetch('/sync', {
            method: 'POST',
            body: JSON.stringify({ history: [], notes: {}, bookmarks: {}, gamification: {}, extra_data: extra })
        });
    }
}

function _defaultTargets() {
    var t = {};
    Object.keys(DEFAULT_GOALS).forEach(function(k) { t[k] = DEFAULT_GOALS[k].target; });
    return t;
}

/* ── Week helpers ────────────────────────────── */
function _getWeekStartISO() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    var day = d.getDay();
    var diff = day === 0 ? 6 : day - 1; // Monday = start of week
    d.setDate(d.getDate() - diff);
    return d.toISOString().slice(0, 10);
}

function _isCurrentWeek(weekStart) {
    return weekStart === _getWeekStartISO();
}

function _getWeekDates() {
    var start = new Date(_getWeekStartISO() + 'T00:00:00');
    var dates = [];
    for (var i = 0; i < 7; i++) {
        var d = new Date(start);
        d.setDate(start.getDate() + i);
        dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
}

/* ── Calculate current week progress ─────────── */
function getWeeklyProgress() {
    var g = loadGamif();
    var history = [];
    try { history = JSON.parse(localStorage.getItem('lectureDigest_history') || '[]'); } catch (e) {}

    var weekDates = _getWeekDates();
    var weekStart = weekDates[0];
    var weekEnd = weekDates[6];

    // Videos analyzed this week
    var weekVideos = 0;
    history.forEach(function(h) {
        var raw = h.analyzedAt || h.savedAt;
        if (!raw) return;
        var date;
        if (typeof raw === 'number') {
            // Unix timestamp (seconds or ms)
            var ts = raw > 1e12 ? raw : raw * 1000;
            date = new Date(ts).toISOString().slice(0, 10);
        } else {
            date = String(raw).slice(0, 10);
        }
        if (date >= weekStart && date <= weekEnd) weekVideos++;
    });

    // Quizzes this week — from progress storage
    var weekQuizzes = 0;
    var seenVids = {};
    history.forEach(function(h) {
        if (seenVids[h.video_id]) return;
        seenVids[h.video_id] = true;
        if (typeof loadProgress === 'function') {
            var prog = loadProgress(h.video_id);
            (prog.quizSessions || []).forEach(function(qs) {
                if (qs.date) {
                    var qDate = qs.date.slice(0, 10);
                    if (qDate >= weekStart && qDate <= weekEnd) weekQuizzes++;
                }
            });
        }
    });

    // Pomodoro sessions this week
    var weekPomo = g.pomoSessions || 0;
    // We track total only, so estimate from this week's study dates
    // Better: use a weekly counter that resets
    var goalsData = loadWeeklyGoals();
    if (!_isCurrentWeek(goalsData.weekStart)) {
        // New week — reset weekly counters
        goalsData.weekStart = _getWeekStartISO();
        goalsData.weekPomo = 0;
        goalsData.weekPomoMin = 0;
        saveWeeklyGoals(goalsData);
    }
    weekPomo = goalsData.weekPomo || 0;

    // Study days this week
    var studyDates = g.studyDates || [];
    var weekStudyDays = 0;
    studyDates.forEach(function(d) {
        if (d >= weekStart && d <= weekEnd) weekStudyDays++;
    });

    return {
        videos:    weekVideos,
        quizzes:   weekQuizzes,
        pomodoro:  weekPomo,
        studyDays: weekStudyDays
    };
}

/* ── Increment weekly Pomodoro counter ────────── */
function incrementWeeklyPomo(minutes) {
    var goalsData = loadWeeklyGoals();
    if (!_isCurrentWeek(goalsData.weekStart)) {
        goalsData.weekStart = _getWeekStartISO();
        goalsData.weekPomo = 0;
        goalsData.weekPomoMin = 0;
    }
    goalsData.weekPomo = (goalsData.weekPomo || 0) + 1;
    goalsData.weekPomoMin = (goalsData.weekPomoMin || 0) + (minutes || 25);
    saveWeeklyGoals(goalsData);
}

/* ── Render in Dashboard ─────────────────────── */
function renderWeeklyGoals() {
    var el = document.getElementById('dbWeeklyGoals');
    if (!el) return;

    var goalsData = loadWeeklyGoals();
    var targets = goalsData.targets;
    var progress = getWeeklyProgress();

    // Week range label
    var weekDates = _getWeekDates();
    var weekLabel = _fmtShortDate(weekDates[0]) + ' — ' + _fmtShortDate(weekDates[6]);

    var html = '';
    html += '<div class="wg-header">';
    html += '<span class="wg-week-label">📆 ' + weekLabel + '</span>';
    html += '<button class="wg-edit-btn" onclick="openGoalsSettings()" title="Chỉnh mục tiêu">⚙️</button>';
    html += '</div>';

    // Goal rows
    var goalKeys = ['videos', 'quizzes', 'pomodoro', 'studyDays'];
    var allComplete = true;

    goalKeys.forEach(function(key) {
        var def = DEFAULT_GOALS[key];
        var target = targets[key] || def.target;
        var current = progress[key] || 0;
        var pct = Math.min(100, Math.round((current / Math.max(target, 1)) * 100));
        var done = current >= target;
        if (!done) allComplete = false;

        html += '<div class="wg-goal-row' + (done ? ' wg-goal-done' : '') + '">';
        html += '<div class="wg-goal-info">';
        html += '<span class="wg-goal-icon">' + def.icon + '</span>';
        html += '<span class="wg-goal-name">' + def.label + '</span>';
        html += '<span class="wg-goal-count">' + current + ' / ' + target + '</span>';
        html += '</div>';
        html += '<div class="wg-goal-bar-track">';
        html += '<div class="wg-goal-bar-fill" style="width:' + pct + '%;background:' + def.color + '"></div>';
        html += '</div>';
        if (done) html += '<span class="wg-check">✓</span>';
        html += '</div>';
    });

    // Overall progress
    var totalPct = 0;
    var count = 0;
    goalKeys.forEach(function(key) {
        var target = targets[key] || DEFAULT_GOALS[key].target;
        var current = progress[key] || 0;
        totalPct += Math.min(100, Math.round((current / Math.max(target, 1)) * 100));
        count++;
    });
    var overallPct = Math.round(totalPct / count);

    html += '<div class="wg-overall">';
    html += '<div class="wg-overall-bar-track">';
    html += '<div class="wg-overall-bar-fill" style="width:' + overallPct + '%"></div>';
    html += '</div>';
    html += '<span class="wg-overall-label">' + overallPct + '% tuần này</span>';
    if (allComplete) {
        html += '<span class="wg-trophy">🏆 Hoàn thành tất cả!</span>';
    }
    html += '</div>';

    el.innerHTML = html;
}

/* ── Goals Settings Modal ────────────────────── */
function openGoalsSettings() {
    var overlay = document.getElementById('goalsSettingsOverlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');

    var goalsData = loadWeeklyGoals();
    var targets = goalsData.targets;

    var form = document.getElementById('goalsSettingsForm');
    if (!form) return;

    var html = '';
    Object.keys(DEFAULT_GOALS).forEach(function(key) {
        var def = DEFAULT_GOALS[key];
        var val = targets[key] || def.target;
        html += '<div class="gs-field">';
        html += '<label class="gs-label">';
        html += '<span class="gs-icon">' + def.icon + '</span>';
        html += '<span>' + def.label + '</span>';
        html += '</label>';
        html += '<div class="gs-input-wrap">';
        html += '<button class="gs-minus" onclick="_gsAdjust(\'' + key + '\', -1)">−</button>';
        html += '<input type="number" class="gs-input" id="gsInput_' + key + '" value="' + val + '" min="1" max="50">';
        html += '<button class="gs-plus" onclick="_gsAdjust(\'' + key + '\', 1)">+</button>';
        html += '</div>';
        html += '</div>';
    });

    form.innerHTML = html;
}

function closeGoalsSettings() {
    var overlay = document.getElementById('goalsSettingsOverlay');
    if (overlay) overlay.classList.add('hidden');
}

function saveGoalsSettings() {
    var goalsData = loadWeeklyGoals();

    Object.keys(DEFAULT_GOALS).forEach(function(key) {
        var inp = document.getElementById('gsInput_' + key);
        if (inp) {
            var val = parseInt(inp.value, 10);
            if (val >= 1 && val <= 50) goalsData.targets[key] = val;
        }
    });

    saveWeeklyGoals(goalsData);
    closeGoalsSettings();
    renderWeeklyGoals();
    showToast('✅ Đã cập nhật mục tiêu tuần!');
}

function _gsAdjust(key, delta) {
    var inp = document.getElementById('gsInput_' + key);
    if (!inp) return;
    var val = parseInt(inp.value, 10) + delta;
    if (val >= 1 && val <= 50) inp.value = val;
}

/* ── Helpers ──────────────────────────────────── */
function _fmtShortDate(isoStr) {
    var d = new Date(isoStr + 'T00:00:00');
    return d.getDate() + '/' + (d.getMonth() + 1);
}
