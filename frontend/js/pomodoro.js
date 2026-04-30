/* ════════════════════════════════════════════════
   LectureDigest — Pomodoro Study Timer
   ════════════════════════════════════════════════ */

const POMO_FOCUS_MIN    = 25;
const POMO_BREAK_MIN    = 5;
const POMO_LONG_BREAK   = 15;
const POMO_LONG_AFTER   = 4; // long break after every N sessions

const pomoState = {
    running:       false,
    paused:        false,
    mode:          'focus',   // 'focus' | 'break'
    secondsLeft:   POMO_FOCUS_MIN * 60,
    totalSeconds:  POMO_FOCUS_MIN * 60,
    sessions:      0,
    totalFocusMin: 0,
    intervalId:    null,
};

/* ── Open / Close ────────────────────────────── */
function openPomodoro() {
    const panel = document.getElementById('pomoPanel');
    if (panel) {
        panel.classList.remove('hidden');
        panel.classList.add('pomo-enter');
        setTimeout(() => panel.classList.remove('pomo-enter'), 300);
    }
    renderPomodoro();
}

function closePomodoro() {
    const panel = document.getElementById('pomoPanel');
    if (panel) panel.classList.add('hidden');
}

/* ── Start / Pause / Reset ───────────────────── */
function pomoStart() {
    if (pomoState.running && !pomoState.paused) return;

    if (!pomoState.running) {
        // Fresh start
        pomoState.mode = 'focus';
        pomoState.secondsLeft = POMO_FOCUS_MIN * 60;
        pomoState.totalSeconds = POMO_FOCUS_MIN * 60;
        pomoState.running = true;
        pomoState.paused = false;
    } else if (pomoState.paused) {
        pomoState.paused = false;
    }

    clearInterval(pomoState.intervalId);
    pomoState.intervalId = setInterval(pomoTick, 1000);
    renderPomodoro();

    // Resume video if in focus mode
    if (pomoState.mode === 'focus' && ytPlayer && typeof ytPlayer.playVideo === 'function') {
        try { ytPlayer.playVideo(); } catch (_) {}
    }
}

function pomoPause() {
    if (!pomoState.running) return;
    pomoState.paused = true;
    clearInterval(pomoState.intervalId);
    renderPomodoro();
}

function pomoReset() {
    clearInterval(pomoState.intervalId);
    pomoState.running = false;
    pomoState.paused = false;
    pomoState.mode = 'focus';
    pomoState.secondsLeft = POMO_FOCUS_MIN * 60;
    pomoState.totalSeconds = POMO_FOCUS_MIN * 60;
    renderPomodoro();
}

/* ── Timer Tick ───────────────────────────────── */
function pomoTick() {
    if (pomoState.secondsLeft <= 0) {
        clearInterval(pomoState.intervalId);
        pomoTimerComplete();
        return;
    }
    pomoState.secondsLeft--;
    renderPomodoro();
}

function pomoTimerComplete() {
    if (pomoState.mode === 'focus') {
        // Focus session completed
        pomoState.sessions++;
        pomoState.totalFocusMin += POMO_FOCUS_MIN;

        // Log to gamification
        _pomoLogStudyTime(POMO_FOCUS_MIN);

        // Switch to break
        const isLongBreak = pomoState.sessions % POMO_LONG_AFTER === 0;
        const breakMin = isLongBreak ? POMO_LONG_BREAK : POMO_BREAK_MIN;
        pomoState.mode = 'break';
        pomoState.secondsLeft = breakMin * 60;
        pomoState.totalSeconds = breakMin * 60;

        // Pause video during break
        if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
            try { ytPlayer.pauseVideo(); } catch (_) {}
        }

        _pomoNotify('⏸️ Nghỉ giải lao!', isLongBreak
            ? `Nghỉ dài ${POMO_LONG_BREAK} phút — bạn đã hoàn thành ${pomoState.sessions} phiên!`
            : `Nghỉ ${POMO_BREAK_MIN} phút rồi tiếp tục nhé!`);
        showToast(`☕ Nghỉ giải lao ${breakMin} phút! (Phiên ${pomoState.sessions} hoàn thành)`);

    } else {
        // Break completed → start new focus
        pomoState.mode = 'focus';
        pomoState.secondsLeft = POMO_FOCUS_MIN * 60;
        pomoState.totalSeconds = POMO_FOCUS_MIN * 60;

        // Resume video
        if (ytPlayer && typeof ytPlayer.playVideo === 'function') {
            try { ytPlayer.playVideo(); } catch (_) {}
        }

        _pomoNotify('🔥 Bắt đầu học tiếp!', 'Focus session mới — 25 phút tập trung!');
        showToast('🔥 Focus time! 25 phút tập trung');
    }

    // Auto-continue
    pomoState.intervalId = setInterval(pomoTick, 1000);
    renderPomodoro();
}

/* ── Render ───────────────────────────────────── */
function renderPomodoro() {
    const timerEl   = document.getElementById('pomoTimer');
    const statusEl  = document.getElementById('pomoStatus');
    const sessEl    = document.getElementById('pomoSessions');
    const totalEl   = document.getElementById('pomoTotal');
    const startBtn  = document.getElementById('pomoStartBtn');
    const pauseBtn  = document.getElementById('pomoPauseBtn');
    const resetBtn  = document.getElementById('pomoResetBtn');
    const ringEl    = document.getElementById('pomoRing');
    const panel     = document.getElementById('pomoPanel');

    if (!timerEl) return;

    // Timer display
    const min = Math.floor(pomoState.secondsLeft / 60);
    const sec = pomoState.secondsLeft % 60;
    timerEl.textContent = String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');

    // Status text
    if (statusEl) {
        if (!pomoState.running) {
            statusEl.textContent = 'Sẵn sàng';
            statusEl.className = 'pomo-status';
        } else if (pomoState.paused) {
            statusEl.textContent = 'Tạm dừng';
            statusEl.className = 'pomo-status pomo-status-paused';
        } else if (pomoState.mode === 'focus') {
            statusEl.textContent = '🎯 Tập trung';
            statusEl.className = 'pomo-status pomo-status-focus';
        } else {
            statusEl.textContent = '☕ Nghỉ giải lao';
            statusEl.className = 'pomo-status pomo-status-break';
        }
    }

    // Progress ring
    if (ringEl) {
        const pct = pomoState.totalSeconds > 0
            ? (1 - pomoState.secondsLeft / pomoState.totalSeconds)
            : 0;
        const circumference = 2 * Math.PI * 54; // r=54
        ringEl.style.strokeDasharray = circumference;
        ringEl.style.strokeDashoffset = circumference * (1 - pct);
        ringEl.style.stroke = pomoState.mode === 'focus'
            ? 'var(--accent-primary, #8b5cf6)'
            : '#10b981';
    }

    // Panel mode class
    if (panel) {
        panel.classList.toggle('pomo-break-mode', pomoState.mode === 'break' && pomoState.running);
    }

    // Session stats
    if (sessEl) sessEl.textContent = pomoState.sessions;
    if (totalEl) totalEl.textContent = pomoState.totalFocusMin + ' phút';

    // Button states
    if (startBtn) startBtn.classList.toggle('hidden', pomoState.running && !pomoState.paused);
    if (pauseBtn) pauseBtn.classList.toggle('hidden', !pomoState.running || pomoState.paused);
    if (resetBtn) resetBtn.classList.toggle('hidden', !pomoState.running);

    // Update mini timer in header button
    const miniTime = document.getElementById('pomoMiniTime');
    const headerBtn = document.getElementById('pomoBtnHeader');
    if (miniTime) {
        if (pomoState.running) {
            miniTime.textContent = String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
        } else {
            miniTime.textContent = '';
        }
    }
    if (headerBtn) {
        headerBtn.classList.toggle('pomo-active', pomoState.running && !pomoState.paused);
    }
}

/* ── Helpers ──────────────────────────────────── */
function _pomoNotify(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification(title, { body, icon: '/icon-192.png' }); } catch (_) {}
    }
}

function _pomoLogStudyTime(minutes) {
    // Record study time in gamification
    try {
        const g = loadGamif();
        g.pomoSessions = (g.pomoSessions || 0) + 1;
        g.pomoTotalMin = (g.pomoTotalMin || 0) + minutes;
        saveGamif(g);

        // Also record a study session if not already recorded today
        if (typeof recordStudySession === 'function') {
            const today = todayISO();
            if (g.lastStudyDate !== today) {
                // Don't call recordStudySession directly as it increments totalVideos
                // Instead just update the streak manually
                const yesterday = dayOffsetISO(-1);
                if (g.lastStudyDate === yesterday) {
                    g.currentStreak += 1;
                } else if (g.lastStudyDate !== today) {
                    g.currentStreak = 1;
                }
                g.longestStreak = Math.max(g.longestStreak, g.currentStreak);
                g.lastStudyDate = today;
                if (!g.studyDates) g.studyDates = [];
                if (!g.studyDates.includes(today)) g.studyDates.push(today);
                saveGamif(g);
            }
        }
        renderStreakCard(g);
    } catch (_) {}
}

/* ── Request notification permission ──────────── */
function pomoRequestNotification() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

/* ── Initialize on DOMContentLoaded ──────────── */
document.addEventListener('DOMContentLoaded', function() {
    // Request notification permission when user first opens pomodoro
    const pomoBtn = document.getElementById('pomoBtnHeader');
    if (pomoBtn) {
        pomoBtn.addEventListener('click', function() {
            pomoRequestNotification();
            openPomodoro();
        });
    }
    renderPomodoro();
});
