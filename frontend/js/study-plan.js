/* ════════════════════════════════════════════════
   LectureDigest — AI Study Plan Module
   Personalized learning schedule based on video history,
   quiz scores, and spaced repetition data.
   ════════════════════════════════════════════════ */

// Register section + route
if (typeof SECTION_IDS !== 'undefined' && !SECTION_IDS.includes('studyPlanSection')) {
    SECTION_IDS.push('studyPlanSection');
}
if (typeof SPA_ROUTES !== 'undefined') SPA_ROUTES['studyPlanSection'] = '/study-plan';

var SP_STORAGE_KEY = 'lectureDigest_studyPlan';
var SP_COMPLETED_KEY = 'lectureDigest_studyPlan_completed';

var _spCurrentPlan = null;
var _spCurrentWeek = 0;
var _spCompletedTasks = {};

// ══════════════════════════════════════════════════════
// OPEN / CLOSE
// ══════════════════════════════════════════════════════

function openStudyPlan() {
    _spLoadSaved();
    if (_spCurrentPlan) {
        _spRenderPlan();
        _spShowContent();
    } else {
        _spShowEmpty();
    }
    showSection('studyPlanSection');
}

function closeStudyPlan() {
    showSection('hero');
}

function openStudyPlanConfig() {
    var configPanel = document.getElementById('spConfigPanel');
    var content = document.getElementById('spContent');
    var empty = document.getElementById('spEmpty');
    var loading = document.getElementById('spLoading');
    if (configPanel) configPanel.classList.remove('hidden');
    if (content) content.classList.add('hidden');
    if (empty) empty.classList.add('hidden');
    if (loading) loading.classList.add('hidden');

    // Show section if not already visible
    var section = document.getElementById('studyPlanSection');
    if (section && section.classList.contains('hidden')) {
        showSection('studyPlanSection');
    }
}

// ══════════════════════════════════════════════════════
// DATA GATHERING
// ══════════════════════════════════════════════════════

function _spGatherVideoData() {
    var history = [];
    try { history = JSON.parse(localStorage.getItem('lectureDigest_history') || '[]'); } catch(e) {}

    var videos = [];
    for (var i = 0; i < history.length; i++) {
        var h = history[i];
        if (!h.video_id) continue;

        var videoInfo = {
            video_id: h.video_id,
            title: h.title || 'Untitled',
            tags: [],
            quiz_score: -1,
            quiz_total: 0,
            has_flashcards: false,
            srs_due_count: 0,
            srs_mastered: 0,
            srs_total: 0,
            watch_progress: 0,
            analyzed_at: h.savedAt || h.analyzedAt || ''
        };

        // Get tags
        try {
            var tagsData = JSON.parse(localStorage.getItem('lectureDigest_tags') || '{}');
            if (tagsData[h.video_id]) {
                videoInfo.tags = tagsData[h.video_id];
            }
        } catch(e) {}

        // Get quiz score from history data
        if (h.data && h.data.quiz && h.data.quiz.length > 0) {
            videoInfo.has_flashcards = true;
        }

        // Check for quiz results in progress data
        try {
            var progressRaw = localStorage.getItem('lectureDigest_progress_' + h.video_id);
            if (progressRaw) {
                var progress = JSON.parse(progressRaw);
                if (progress.quizHistory && progress.quizHistory.length > 0) {
                    var lastQuiz = progress.quizHistory[progress.quizHistory.length - 1];
                    videoInfo.quiz_score = lastQuiz.score || 0;
                    videoInfo.quiz_total = lastQuiz.total || lastQuiz.answered || 0;
                }
                if (progress.watchProgress) {
                    videoInfo.watch_progress = progress.watchProgress;
                }
            }
        } catch(e) {}

        // Get SRS data
        try {
            var sm2Raw = localStorage.getItem('lectureDigest_sm2_' + h.video_id);
            if (sm2Raw) {
                var sm2Data = JSON.parse(sm2Raw);
                var today = new Date().toISOString().split('T')[0];
                var total = 0, mastered = 0, due = 0;
                for (var cardKey in sm2Data) {
                    total++;
                    var card = sm2Data[cardKey];
                    if (card.interval >= 21) mastered++;
                    if (!card.nextReview || card.nextReview <= today) due++;
                }
                videoInfo.srs_total = total;
                videoInfo.srs_mastered = mastered;
                videoInfo.srs_due_count = due;
                videoInfo.has_flashcards = true;
            }
        } catch(e) {}

        // Check if flashcards exist in analysis data
        if (h.data && h.data.flashcards && h.data.flashcards.length > 0) {
            videoInfo.has_flashcards = true;
            if (videoInfo.srs_total === 0) {
                videoInfo.srs_total = h.data.flashcards.length;
            }
        }

        videos.push(videoInfo);
    }

    return videos;
}

// ══════════════════════════════════════════════════════
// GENERATE PLAN
// ══════════════════════════════════════════════════════

async function generateStudyPlan() {
    var videos = _spGatherVideoData();
    if (videos.length < 1) {
        showToast('Cần ít nhất 1 video đã phân tích để tạo lộ trình', 3000);
        return;
    }

    var daysPerWeek = parseInt(document.getElementById('spDaysPerWeek').value) || 5;
    var minPerDay = parseInt(document.getElementById('spMinPerDay').value) || 30;
    var duration = parseInt(document.getElementById('spDuration').value) || 2;
    var goal = (document.getElementById('spGoal').value || '').trim();

    // Get gamification data
    var gamif = {};
    try { gamif = JSON.parse(localStorage.getItem('lectureDigest_gamification') || '{}'); } catch(e) {}

    var payload = {
        videos: videos,
        study_days_per_week: daysPerWeek,
        minutes_per_day: minPerDay,
        goal: goal,
        output_language: selectedLang || 'Vietnamese',
        current_streak: gamif.currentStreak || 0,
        total_study_days: gamif.totalStudyDays || 0,
        plan_duration_weeks: duration
    };

    // Show loading
    document.getElementById('spConfigPanel').classList.add('hidden');
    document.getElementById('spContent').classList.add('hidden');
    document.getElementById('spEmpty').classList.add('hidden');
    document.getElementById('spLoading').classList.remove('hidden');

    var btn = document.getElementById('spGenerateBtn');
    if (btn) btn.disabled = true;

    try {
        var res = await fetchWithTimeout(API_BASE + '/api/study-plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }, 60000);

        if (!res.ok) {
            var err = await res.json().catch(function() { return { detail: 'Unknown error' }; });
            throw new Error(err.detail || 'Failed to generate study plan');
        }

        var plan = await res.json();
        _spCurrentPlan = plan;
        _spCurrentWeek = 0;
        _spCompletedTasks = {};

        // Save to localStorage
        _spSavePlan();

        // Render
        _spRenderPlan();
        _spShowContent();

        showToast('✅ Lộ trình học tập đã được tạo!', 3000);

        // Record gamification
        if (typeof recordGamifFeature === 'function') {
            recordGamifFeature('usedStudyPlan');
        }

    } catch(err) {
        showToast('❌ ' + (err.message || 'Không thể tạo lộ trình'), 4000);
        // Show config again
        document.getElementById('spConfigPanel').classList.remove('hidden');
    } finally {
        document.getElementById('spLoading').classList.add('hidden');
        if (btn) btn.disabled = false;
    }
}

// ══════════════════════════════════════════════════════
// RENDER PLAN
// ══════════════════════════════════════════════════════

function _spRenderPlan() {
    if (!_spCurrentPlan) return;
    var plan = _spCurrentPlan;

    // Overview
    var overviewEl = document.getElementById('spOverview');
    if (overviewEl) {
        var genDate = plan.generated_at ? new Date(plan.generated_at).toLocaleDateString('vi-VN') : '';
        overviewEl.innerHTML = '<div class="sp-overview-header">'
            + '<h2 class="sp-plan-title">' + _spEsc(plan.plan_title || 'Lộ trình học tập') + '</h2>'
            + '<div class="sp-plan-meta">'
            + '<span>📅 ' + (plan.plan_duration_weeks || 2) + ' tuần</span>'
            + '<span>⏱️ ' + (plan.minutes_per_day || 30) + ' phút/ngày</span>'
            + '<span>📚 ' + (plan.total_videos || 0) + ' videos</span>'
            + (genDate ? '<span>🕐 ' + genDate + '</span>' : '')
            + '</div></div>'
            + '<p class="sp-overview-text">' + _spEsc(plan.overview || '') + '</p>';
    }

    // Priority videos
    _spRenderPriority(plan.priority_videos || []);

    // Week tabs
    _spRenderWeekTabs(plan.weekly_schedule || []);

    // Schedule for current week
    _spRenderWeekSchedule();

    // Milestones
    _spRenderMilestones(plan.milestones || []);

    // Recommendations
    _spRenderRecs(plan.recommendations || []);

    // Progress
    _spUpdateProgress();
}

function _spRenderPriority(priorities) {
    var el = document.getElementById('spPriorityList');
    if (!el || !priorities.length) {
        var section = document.getElementById('spPrioritySection');
        if (section) section.classList.add('hidden');
        return;
    }
    document.getElementById('spPrioritySection').classList.remove('hidden');

    el.innerHTML = priorities.map(function(p) {
        var priorityClass = 'sp-priority-' + (p.priority || 'medium');
        var icon = p.priority === 'high' ? '🔴' : p.priority === 'low' ? '🟢' : '🟡';
        var title = _spGetVideoTitle(p.video_id) || p.video_id;
        return '<div class="sp-priority-item ' + priorityClass + '">'
            + '<span class="sp-priority-icon">' + icon + '</span>'
            + '<div class="sp-priority-info">'
            + '<div class="sp-priority-title">' + _spEsc(title) + '</div>'
            + '<div class="sp-priority-reason">' + _spEsc(p.reason || '') + '</div>'
            + '</div></div>';
    }).join('');
}

function _spRenderWeekTabs(schedule) {
    var nav = document.getElementById('spWeeksNav');
    if (!nav || !schedule.length) return;

    nav.innerHTML = schedule.map(function(week, i) {
        var active = i === _spCurrentWeek ? ' sp-week-active' : '';
        return '<button type="button" class="sp-week-tab' + active + '" onclick="spSwitchWeek(' + i + ')">'
            + 'Tuần ' + (i + 1)
            + '</button>';
    }).join('');
}

function spSwitchWeek(weekIdx) {
    _spCurrentWeek = weekIdx;
    _spRenderWeekTabs(_spCurrentPlan.weekly_schedule || []);
    _spRenderWeekSchedule();
}

function _spRenderWeekSchedule() {
    var el = document.getElementById('spSchedule');
    if (!el || !_spCurrentPlan) return;

    var schedule = _spCurrentPlan.weekly_schedule || [];
    if (!schedule[_spCurrentWeek]) {
        el.innerHTML = '<p class="sp-empty-week">Không có dữ liệu cho tuần này</p>';
        return;
    }

    var week = schedule[_spCurrentWeek];
    var days = week.days || [];

    var themeHtml = week.theme ? '<div class="sp-week-theme">🎯 ' + _spEsc(week.theme) + '</div>' : '';

    var daysHtml = days.map(function(day, dayIdx) {
        var tasks = day.tasks || [];
        var dayKey = _spCurrentWeek + '-' + dayIdx;

        var tasksHtml = tasks.map(function(task, taskIdx) {
            var taskKey = dayKey + '-' + taskIdx;
            var isCompleted = _spCompletedTasks[taskKey];
            var completedClass = isCompleted ? ' sp-task-done' : '';
            var typeIcon = _spTaskIcon(task.type);
            var priorityDot = task.priority === 'high' ? ' sp-dot-high' : task.priority === 'low' ? ' sp-dot-low' : '';

            return '<div class="sp-task' + completedClass + '" onclick="spToggleTask(\'' + taskKey + '\')">'
                + '<div class="sp-task-check">' + (isCompleted ? '✅' : '⬜') + '</div>'
                + '<div class="sp-task-body">'
                + '<div class="sp-task-header">'
                + '<span class="sp-task-type">' + typeIcon + ' ' + _spEsc(task.title || '') + '</span>'
                + '<span class="sp-task-duration">' + (task.duration_min || 15) + ' phút</span>'
                + '</div>'
                + '<div class="sp-task-desc">' + _spEsc(task.description || '') + '</div>'
                + '</div>'
                + '<div class="sp-task-priority' + priorityDot + '"></div>'
                + '</div>';
        }).join('');

        var dayLabel = _spDayLabel(dayIdx);
        var allDone = tasks.length > 0 && tasks.every(function(_, ti) { return _spCompletedTasks[dayKey + '-' + ti]; });

        return '<div class="sp-day-card' + (allDone ? ' sp-day-complete' : '') + '">'
            + '<div class="sp-day-header">'
            + '<span class="sp-day-label">' + dayLabel + '</span>'
            + (allDone ? '<span class="sp-day-badge">✓ Hoàn thành</span>' : '')
            + '</div>'
            + '<div class="sp-tasks">' + tasksHtml + '</div>'
            + '</div>';
    }).join('');

    el.innerHTML = themeHtml + daysHtml;
}

function _spRenderMilestones(milestones) {
    var el = document.getElementById('spMilestones');
    var section = document.getElementById('spMilestonesSection');
    if (!el || !milestones.length) {
        if (section) section.classList.add('hidden');
        return;
    }
    if (section) section.classList.remove('hidden');

    el.innerHTML = milestones.map(function(m) {
        return '<div class="sp-milestone">'
            + '<div class="sp-milestone-icon">🏁</div>'
            + '<div class="sp-milestone-info">'
            + '<div class="sp-milestone-target">' + _spEsc(m.target || '') + '</div>'
            + '<div class="sp-milestone-meta">'
            + '<span>📅 Tuần ' + (m.by_week || 1) + '</span>'
            + '<span>📏 ' + _spEsc(m.metric || '') + '</span>'
            + '</div></div></div>';
    }).join('');
}

function _spRenderRecs(recs) {
    var el = document.getElementById('spRecs');
    var section = document.getElementById('spRecsSection');
    if (!el || !recs.length) {
        if (section) section.classList.add('hidden');
        return;
    }
    if (section) section.classList.remove('hidden');

    el.innerHTML = recs.map(function(r) {
        return '<div class="sp-rec-item">💡 ' + _spEsc(r) + '</div>';
    }).join('');
}

// ══════════════════════════════════════════════════════
// TASK COMPLETION
// ══════════════════════════════════════════════════════

function spToggleTask(taskKey) {
    if (_spCompletedTasks[taskKey]) {
        delete _spCompletedTasks[taskKey];
    } else {
        _spCompletedTasks[taskKey] = true;
    }
    _spSaveCompleted();
    _spRenderWeekSchedule();
    _spUpdateProgress();
}

function _spUpdateProgress() {
    if (!_spCurrentPlan) return;

    var totalTasks = 0;
    var completedCount = 0;
    var schedule = _spCurrentPlan.weekly_schedule || [];

    for (var w = 0; w < schedule.length; w++) {
        var days = schedule[w].days || [];
        for (var d = 0; d < days.length; d++) {
            var tasks = days[d].tasks || [];
            for (var t = 0; t < tasks.length; t++) {
                totalTasks++;
                if (_spCompletedTasks[w + '-' + d + '-' + t]) completedCount++;
            }
        }
    }

    var pct = totalTasks > 0 ? Math.round(completedCount / totalTasks * 100) : 0;
    var fillEl = document.getElementById('spProgressFill');
    var textEl = document.getElementById('spProgressText');
    var infoEl = document.getElementById('spCompletedInfo');

    if (fillEl) fillEl.style.width = pct + '%';
    if (textEl) textEl.textContent = pct + '%';
    if (infoEl) infoEl.textContent = completedCount + ' / ' + totalTasks + ' nhiệm vụ hoàn thành';
}

// ══════════════════════════════════════════════════════
// PERSISTENCE
// ══════════════════════════════════════════════════════

function _spSavePlan() {
    try {
        safeLsSet(SP_STORAGE_KEY, JSON.stringify(_spCurrentPlan));
    } catch(e) {}
}

function _spSaveCompleted() {
    try {
        safeLsSet(SP_COMPLETED_KEY, JSON.stringify(_spCompletedTasks));
    } catch(e) {}
}

function _spLoadSaved() {
    try {
        var raw = localStorage.getItem(SP_STORAGE_KEY);
        if (raw) _spCurrentPlan = JSON.parse(raw);
    } catch(e) { _spCurrentPlan = null; }

    try {
        var raw2 = localStorage.getItem(SP_COMPLETED_KEY);
        if (raw2) _spCompletedTasks = JSON.parse(raw2);
    } catch(e) { _spCompletedTasks = {}; }
}

// ══════════════════════════════════════════════════════
// UI HELPERS
// ══════════════════════════════════════════════════════

function _spShowContent() {
    document.getElementById('spContent').classList.remove('hidden');
    document.getElementById('spConfigPanel').classList.add('hidden');
    document.getElementById('spEmpty').classList.add('hidden');
    document.getElementById('spLoading').classList.add('hidden');
}

function _spShowEmpty() {
    document.getElementById('spEmpty').classList.remove('hidden');
    document.getElementById('spContent').classList.add('hidden');
    document.getElementById('spConfigPanel').classList.add('hidden');
    document.getElementById('spLoading').classList.add('hidden');
}

function _spTaskIcon(type) {
    var icons = {
        review: '📖',
        quiz: '🧠',
        flashcard: '📇',
        rewatch: '🔄',
        'new': '🆕'
    };
    return icons[type] || '📋';
}

function _spDayLabel(idx) {
    var labels = ['Ngày 1', 'Ngày 2', 'Ngày 3', 'Ngày 4', 'Ngày 5', 'Ngày 6', 'Ngày 7'];
    return labels[idx] || ('Ngày ' + (idx + 1));
}

function _spGetVideoTitle(videoId) {
    if (!videoId) return '';
    try {
        var history = JSON.parse(localStorage.getItem('lectureDigest_history') || '[]');
        for (var i = 0; i < history.length; i++) {
            if (history[i].video_id === videoId) return history[i].title || '';
        }
    } catch(e) {}
    return '';
}

function _spEsc(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ══════════════════════════════════════════════════════
// DASHBOARD WIDGET
// ══════════════════════════════════════════════════════

function renderStudyPlanBanner(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    _spLoadSaved();
    if (!_spCurrentPlan) {
        // Show "create plan" prompt
        var videoCount = 0;
        try { videoCount = JSON.parse(localStorage.getItem('lectureDigest_history') || '[]').length; } catch(e) {}
        if (videoCount >= 1) {
            container.innerHTML = '<div class="sp-banner sp-banner-create" onclick="openStudyPlan()">'
                + '<div class="sp-banner-icon">📅</div>'
                + '<div class="sp-banner-text">'
                + '<strong>Tạo lộ trình học tập</strong>'
                + '<span>AI sẽ phân tích ' + videoCount + ' video và tạo kế hoạch cá nhân hóa</span>'
                + '</div>'
                + '<div class="sp-banner-arrow">→</div>'
                + '</div>';
            container.classList.remove('hidden');
        } else {
            container.classList.add('hidden');
        }
        return;
    }

    // Show current plan progress
    var totalTasks = 0, completedCount = 0;
    var schedule = _spCurrentPlan.weekly_schedule || [];
    for (var w = 0; w < schedule.length; w++) {
        var days = schedule[w].days || [];
        for (var d = 0; d < days.length; d++) {
            var tasks = days[d].tasks || [];
            for (var t = 0; t < tasks.length; t++) {
                totalTasks++;
                if (_spCompletedTasks[w + '-' + d + '-' + t]) completedCount++;
            }
        }
    }
    var pct = totalTasks > 0 ? Math.round(completedCount / totalTasks * 100) : 0;

    container.innerHTML = '<div class="sp-banner sp-banner-active" onclick="openStudyPlan()">'
        + '<div class="sp-banner-icon">📅</div>'
        + '<div class="sp-banner-text">'
        + '<strong>' + _spEsc(_spCurrentPlan.plan_title || 'Lộ trình học tập') + '</strong>'
        + '<span>' + completedCount + '/' + totalTasks + ' nhiệm vụ · ' + pct + '% hoàn thành</span>'
        + '</div>'
        + '<div class="sp-banner-progress"><div class="sp-banner-fill" style="width:' + pct + '%"></div></div>'
        + '<div class="sp-banner-arrow">→</div>'
        + '</div>';
    container.classList.remove('hidden');
}
