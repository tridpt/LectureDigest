/* ════════════════════════════════════════════════
   LectureDigest — Gamification — Study Streak & Badges
   ════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════════
// GAMIFICATION — STUDY STREAK + BADGES
// ══════════════════════════════════════════════════════════

const GAMIF_KEY = 'lectureDigest_gamification';

// ── Badge definitions ──────────────────────────────────────
const BADGES = [
    // 📚 Video Milestones
    { id: 'first_video',    cat: 'videos',   icon: '🎬', name: 'Người mới bắt đầu',  desc: 'Phân tích video đầu tiên',          check: g => g.totalVideos >= 1 },
    { id: 'videos_5',       cat: 'videos',   icon: '🎓', name: 'Học viên tích cực',   desc: 'Phân tích 5 videos',                check: g => g.totalVideos >= 5 },
    { id: 'videos_10',      cat: 'videos',   icon: '📚', name: 'Thư viện tri thức',   desc: 'Phân tích 10 videos',               check: g => g.totalVideos >= 10 },
    { id: 'videos_25',      cat: 'videos',   icon: '🏛️', name: 'Giáo sư',            desc: 'Phân tích 25 videos',               check: g => g.totalVideos >= 25 },
    // 🧠 Quiz
    { id: 'first_quiz',     cat: 'quiz',     icon: '🧪', name: 'Bắt đầu kiểm tra',  desc: 'Hoàn thành quiz đầu tiên',          check: g => g.totalQuizzes >= 1 },
    { id: 'quiz_ace',       cat: 'quiz',     icon: '⭐', name: 'Điểm hoàn hảo',      desc: 'Đạt 100% trong một quiz',           check: g => g.perfectQuizzes >= 1 },
    { id: 'quizzes_10',     cat: 'quiz',     icon: '🏆', name: 'Quiz Master',         desc: 'Hoàn thành 10 quizzes',             check: g => g.totalQuizzes >= 10 },
    { id: 'quizzes_25',     cat: 'quiz',     icon: '🎯', name: 'Chiến binh câu hỏi', desc: 'Hoàn thành 25 quizzes',             check: g => g.totalQuizzes >= 25 },
    // 🔥 Streaks
    { id: 'streak_3',       cat: 'streak',   icon: '🔥', name: 'Khởi động',          desc: 'Học 3 ngày liên tiếp',              check: g => g.longestStreak >= 3 },
    { id: 'streak_7',       cat: 'streak',   icon: '💥', name: 'Bùng cháy',          desc: 'Học 7 ngày liên tiếp',              check: g => g.longestStreak >= 7 },
    { id: 'streak_14',      cat: 'streak',   icon: '🌊', name: 'Không thể ngăn cản', desc: 'Học 14 ngày liên tiếp',             check: g => g.longestStreak >= 14 },
    { id: 'streak_30',      cat: 'streak',   icon: '🌟', name: 'Huyền thoại',        desc: 'Học 30 ngày liên tiếp',             check: g => g.longestStreak >= 30 },
    // 🛠 Features
    { id: 'bookmarker',     cat: 'feature',  icon: '🔖', name: 'Người đánh dấu',     desc: 'Tạo bookmark đầu tiên',             check: g => g.usedBookmark },
    { id: 'translator',     cat: 'feature',  icon: '🌐', name: 'Đa ngôn ngữ',        desc: 'Dịch transcript lần đầu',           check: g => g.usedTranslation },
    { id: 'mind_mapper',    cat: 'feature',  icon: '🗺️', name: 'Người lập bản đồ',  desc: 'Tạo sơ đồ tư duy',                 check: g => g.usedMindMap },
    { id: 'note_taker',     cat: 'feature',  icon: '📝', name: 'Người ghi chép',     desc: 'Viết ghi chú đầu tiên',             check: g => g.usedNotes },
    { id: 'flashcard_fan',  cat: 'feature',  icon: '🃏', name: 'Flashcard Fan',       desc: 'Ôn tập với flashcards',             check: g => g.usedFlashcards },
    { id: 'all_features',   cat: 'feature',  icon: '🚀', name: 'Người khám phá',     desc: 'Dùng tất cả tính năng',             check: g => g.usedBookmark && g.usedTranslation && g.usedMindMap && g.usedNotes && g.usedFlashcards },
];

const CAT_LABELS = { videos: '📚 Video', quiz: '🧠 Quiz', streak: '🔥 Streak', feature: '🛠 Tính năng' };

function defaultGamif() {
    return {
        currentStreak:  0,
        longestStreak:  0,
        lastStudyDate:  null,
        totalStudyDays: 0,
        totalVideos:    0,
        totalQuizzes:   0,
        perfectQuizzes: 0,
        usedBookmark:   false,
        usedTranslation:false,
        usedMindMap:    false,
        usedNotes:      false,
        usedFlashcards: false,
        earnedBadges:   [],
        studyDates:[]         // ISO date strings for last 28 days (calendar)
    };
}

function loadGamif() {
    try {
        const raw = JSON.parse(localStorage.getItem(GAMIF_KEY) || '{}');
        if (raw.studyDatesLast7 && !raw.studyDates) {
            raw.studyDates = raw.studyDatesLast7;
            delete raw.studyDatesLast7;
        }
        return Object.assign(defaultGamif(), raw);
    } catch { return defaultGamif(); }
}
function saveGamif(g) {
    try { localStorage.setItem(GAMIF_KEY, JSON.stringify(g)); } catch {}
}

// ── Record a study session (call on analyze complete / history open) ──
function recordStudySession() {
    const g = loadGamif();
    const today = todayISO();

    if (g.lastStudyDate === today) {
        // Already recorded today — just render, no change
        renderStreakCard(g);
        return;
    }

    const yesterday = dayOffsetISO(-1);
    if (g.lastStudyDate === yesterday) {
        g.currentStreak += 1;
    } else {
        g.currentStreak = 1;   // reset
    }

    g.longestStreak  = Math.max(g.longestStreak, g.currentStreak);
    g.lastStudyDate  = today;
    g.totalStudyDays += 1;
    g.totalVideos   += 1;

    // Update last-28-days list
    if (!g.studyDates) g.studyDates = [];
    if (!g.studyDates.includes(today)) g.studyDates.push(today);
    const cutoff = dayOffsetISO(-27);
    g.studyDates = g.studyDates.filter(d => d >= cutoff);

    saveGamif(g);
    checkAndAwardBadges(g);
    renderStreakCard(g);
}

// ── Record feature usage ──
function recordGamifFeature(feature) {
    const g = loadGamif();
    if (g[feature]) return;   // already recorded
    g[feature] = true;
    saveGamif(g);
    checkAndAwardBadges(g);
    renderStreakCard(g);
}

// ── Record quiz completion ──
function recordGamifQuiz(correct, total) {
    const g = loadGamif();
    g.totalQuizzes += 1;
    if (total > 0 && correct === total) g.perfectQuizzes += 1;
    saveGamif(g);
    checkAndAwardBadges(g);
    renderStreakCard(g);
}

// ── Check badges + show toast for new ones ──
function checkAndAwardBadges(g) {
    const newBadges = [];
    for (const badge of BADGES) {
        if (!g.earnedBadges.includes(badge.id) && badge.check(g)) {
            g.earnedBadges.push(badge.id);
            newBadges.push(badge);
        }
    }
    if (newBadges.length) {
        saveGamif(g);
        newBadges.forEach((b, i) => {
            setTimeout(() => showBadgeToast(b), i * 1200);
        });
    }
}

function showBadgeToast(badge) {
    const el = document.createElement('div');
    el.className = 'badge-toast';
    el.innerHTML = '<span class="bt-icon">' + badge.icon + '</span>'
        + '<div class="bt-text"><strong>Huy hiệu mới!</strong><span>' + badge.name + '</span></div>';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('bt-show'));
    setTimeout(() => {
        el.classList.remove('bt-show');
        setTimeout(() => el.remove(), 400);
    }, 3500);
}

// ── Render streak card ──
function renderStreakCard(g) {
    if (!g) g = loadGamif();
    const num   = document.getElementById('streakNum');
    const best  = document.getElementById('streakBest');
    const flame = document.getElementById('streakFlame');
    const weekEl = document.getElementById('streakWeek');
    const earnedEl = document.getElementById('badgesEarnedCount');

    if (num)    num.textContent   = g.currentStreak;
    if (best)   best.textContent  = 'Kỷ lục: ' + g.longestStreak + ' ngày';
    if (flame)  flame.textContent = g.currentStreak >= 7 ? '🔥🔥' : g.currentStreak >= 3 ? '🔥' : '✨';
    if (earnedEl) earnedEl.textContent = g.earnedBadges.length;

    // 7-day mini calendar
    if (weekEl) {
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const d = dayOffsetISO(-i);
            const active = g.studyDatesLast7?.includes(d);
            const dow = new Date(d).toLocaleDateString('vi-VN', { weekday: 'narrow' });
            days.push('<div class="streak-day' + (active ? ' streak-day-active' : '') + '" title="' + d + '">'
                + '<span class="streak-dot"></span>'
                + '<span class="streak-dow">' + dow + '</span>'
                + '</div>');
        }
        weekEl.innerHTML = days.join('');
    }
}

