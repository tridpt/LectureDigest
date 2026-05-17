/* ════════════════════════════════════════════════
   LectureDigest — English Learning Module
   Daily vocabulary, flashcard review, quiz
   ════════════════════════════════════════════════ */

if (typeof SECTION_IDS !== 'undefined' && !SECTION_IDS.includes('englishSection')) {
    SECTION_IDS.push('englishSection');
}
if (typeof SPA_ROUTES !== 'undefined') SPA_ROUTES['englishSection'] = '/english';

var _engWords = [];
var _engReviewWords = [];
var _engQuiz = null;
var _engQuizIdx = 0;
var _engQuizScore = 0;
var _engXP = { xp: 0, level: 1, xp_needed: 100, total_xp: 0, progress_pct: 0, can_hint: false };

var _engStudyTimerInterval = null;
var _engStudySeconds = 0;
var _engStudyGoal = 0;

function openEnglish() {
    showSection('englishSection');
    engLoadStats();
    engLoadXP();
    engLoadMissions();
    engStartStudyTimer();
    _engLoadCustomTopics();
    // Don't load today's words - tab "Tạo từ" starts empty, user generates fresh
    var footer = document.querySelector('.footer');
    if (footer) footer.style.display = 'none';
}

function closeEnglish() {
    engStopStudyTimer();
    showSection('hero');
    var footer = document.querySelector('.footer');
    if (footer) footer.style.display = '';
}

function _engHeaders() {
    var token = localStorage.getItem('ld_auth_token') || '';
    if (!token) {
        showToast('Vui lòng đăng nhập', 3000);
        if (typeof openAuthModal === 'function') openAuthModal('login');
        return null;
    }
    return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
}

// ── Stats ──
async function engLoadStats() {
    var headers = _engHeaders();
    if (!headers) return;
    try {
        var res = await fetchWithTimeout('/api/english/stats', { headers: headers }, 10000);
        if (!res.ok) return;
        var data = await res.json();
        var el = document.getElementById('engStats');
        if (el) {
            el.innerHTML = '<div class="eng-stat"><span class="eng-stat-num">' + data.current_streak + '</span><span class="eng-stat-label">🔥 Streak</span></div>'
                + '<div class="eng-stat"><span class="eng-stat-num">' + data.total_words + '</span><span class="eng-stat-label">📚 Từ đã học</span></div>'
                + '<div class="eng-stat"><span class="eng-stat-num">' + data.due_count + '</span><span class="eng-stat-label">🔄 Cần ôn</span></div>'
                + '<div class="eng-stat"><span class="eng-stat-num">' + data.total_quizzes + '</span><span class="eng-stat-label">🧠 Quiz</span></div>';
        }
    } catch(e) {}
}

// ── Study Timer ──
async function engStartStudyTimer() {
    var headers = _engHeaders();
    if (!headers) return;
    // Load today's time from server
    try {
        var res = await fetchWithTimeout('/api/english/study-time', { headers: headers }, 5000);
        if (res.ok) {
            var data = await res.json();
            _engStudySeconds = data.today_seconds || 0;
            _engStudyGoal = data.goal_minutes || 0;
            engUpdateTimerDisplay();
        }
    } catch(e) {}
    // Start counting
    if (_engStudyTimerInterval) clearInterval(_engStudyTimerInterval);
    _engStudyTimerInterval = setInterval(function() {
        _engStudySeconds++;
        engUpdateTimerDisplay();
        // Save every 30 seconds
        if (_engStudySeconds % 30 === 0) engSaveStudyTime();
    }, 1000);
}

function engStopStudyTimer() {
    if (_engStudyTimerInterval) {
        clearInterval(_engStudyTimerInterval);
        _engStudyTimerInterval = null;
        engSaveStudyTime();
    }
}

function engUpdateTimerDisplay() {
    var el = document.getElementById('engTimerDisplay');
    if (el) {
        var m = Math.floor(_engStudySeconds / 60);
        var s = _engStudySeconds % 60;
        el.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    var goalEl = document.getElementById('engTimerGoal');
    if (goalEl) {
        if (_engStudyGoal > 0) {
            var pct = Math.min(100, Math.round(_engStudySeconds / (_engStudyGoal * 60) * 100));
            goalEl.textContent = 'Mục tiêu: ' + _engStudyGoal + ' phút (' + pct + '%)';
            if (pct >= 100) goalEl.style.color = '#10b981';
            else goalEl.style.color = '';
        } else {
            goalEl.textContent = 'Mục tiêu: chưa đặt';
        }
    }
}

function engSaveStudyTime() {
    var headers = _engHeaders();
    if (!headers) return;
    fetchWithTimeout('/api/english/study-time', {
        method: 'POST', headers: headers,
        body: JSON.stringify({ seconds: _engStudySeconds })
    }, 5000).catch(function() {});
}

function engSetStudyGoal() {
    var current = _engStudyGoal || 15;
    var html = '<div class="eng-goal-modal">'
        + '<h3 style="margin:0 0 12px;color:var(--text-primary,#f1f5f9)">⏱️ Đặt mục tiêu học</h3>'
        + '<p style="font-size:13px;color:var(--text-secondary,#94a3b8);margin:0 0 12px">Mỗi ngày bạn muốn học bao lâu?</p>'
        + '<div class="eng-goal-options">'
        + '<button class="eng-goal-opt" onclick="engSaveGoal(10)">10 phút</button>'
        + '<button class="eng-goal-opt" onclick="engSaveGoal(15)">15 phút</button>'
        + '<button class="eng-goal-opt" onclick="engSaveGoal(30)">30 phút</button>'
        + '<button class="eng-goal-opt" onclick="engSaveGoal(45)">45 phút</button>'
        + '<button class="eng-goal-opt" onclick="engSaveGoal(60)">60 phút</button>'
        + '</div>'
        + '<div style="display:flex;gap:8px;align-items:center;margin-top:10px">'
        + '<input type="number" id="engGoalCustom" class="eng-count-input" value="' + current + '" min="1" max="480" style="width:70px">'
        + '<span style="font-size:12px;color:var(--text-secondary,#94a3b8)">phút</span>'
        + '<button class="eng-btn" onclick="engSaveGoal(parseInt(document.getElementById(\'engGoalCustom\').value)||15)">Lưu</button>'
        + '</div>'
        + '</div>';
    // Show as overlay
    var overlay = document.createElement('div');
    overlay.className = 'eng-levelup-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="eng-levelup-modal" style="max-width:340px">' + html + '</div>';
    document.body.appendChild(overlay);
}

function engSaveGoal(minutes) {
    _engStudyGoal = minutes;
    engUpdateTimerDisplay();
    var headers = _engHeaders();
    if (headers) {
        fetchWithTimeout('/api/english/study-goal', {
            method: 'POST', headers: headers,
            body: JSON.stringify({ minutes: minutes })
        }, 5000).catch(function() {});
    }
    // Close modal
    var overlay = document.querySelector('.eng-levelup-overlay');
    if (overlay) overlay.remove();
    showToast('✅ Mục tiêu: ' + minutes + ' phút/ngày', 2000);
}

// ── Manual Word Add ──
function engToggleAddWord() {
    var form = document.getElementById('engAddWordForm');
    if (form) form.classList.toggle('hidden');
}

async function engAddWordManual() {
    var word = document.getElementById('engAddWord')?.value.trim();
    var meaning = document.getElementById('engAddMeaning')?.value.trim();
    if (!word || !meaning) { showToast('Cần nhập từ và nghĩa!', 2000); return; }

    var phonetic = document.getElementById('engAddPhonetic')?.value.trim() || '';
    var pos = document.getElementById('engAddPos')?.value || '';
    var example = document.getElementById('engAddExample')?.value.trim() || '';

    var headers = _engHeaders();
    if (!headers) return;

    try {
        var res = await fetchWithTimeout('/api/english/add-word', {
            method: 'POST', headers: headers,
            body: JSON.stringify({ word: word, meaning: meaning, phonetic: phonetic, part_of_speech: pos, example: example })
        }, 10000);
        if (!res.ok) {
            var err = await res.json().catch(function() { return {}; });
            showToast(err.detail || 'Lỗi', 3000);
            return;
        }
        showToast('✅ Đã thêm "' + word + '"', 2000);
        // Clear form
        document.getElementById('engAddWord').value = '';
        document.getElementById('engAddMeaning').value = '';
        document.getElementById('engAddPhonetic').value = '';
        document.getElementById('engAddPos').value = '';
        document.getElementById('engAddExample').value = '';
        // Stay on saved tab
        engShowTab('saved');
        engLoadSavedWords(1);
        engLoadStats();
    } catch(e) { showToast('Lỗi: ' + e.message, 3000); }
}

// ── XP / Level ──
async function engLoadXP() {
    var headers = _engHeaders();
    if (!headers) return;
    try {
        var res = await fetchWithTimeout('/api/english/xp', { headers: headers }, 10000);
        if (!res.ok) return;
        _engXP = await res.json();
        if (_engXP.can_hint === undefined) _engXP.can_hint = (_engXP.xp > 0 || _engXP.level > 1);
        engRenderXPBar();
    } catch(e) {}
}

function engRenderXPBar() {
    var el = document.getElementById('engXPBar');
    if (!el) return;
    var pct = _engXP.progress_pct || 0;
    // Calculate true total: sum of all previous levels' XP + current XP
    var trueTotalXP = 0;
    for (var i = 1; i < _engXP.level; i++) trueTotalXP += i * 100;
    trueTotalXP += _engXP.xp;
    el.innerHTML = '<div class="eng-xp-level-badge">Lv.' + _engXP.level + '</div>'
        + '<div class="eng-xp-bar-wrap">'
        + '<div class="eng-xp-bar-fill" style="width:' + pct + '%"></div>'
        + '</div>'
        + '<div class="eng-xp-text">' + _engXP.xp + ' / ' + _engXP.xp_needed + ' XP</div>'
        + '<div class="eng-xp-total">Tổng: ' + trueTotalXP + ' XP</div>';
}

async function engAwardXP(source, score, total, quality) {
    var headers = _engHeaders();
    if (!headers) return;
    var body = { source: source, score: score || 0, total: total || 0 };
    if (quality !== undefined) body.quality = quality;
    try {
        var res = await fetchWithTimeout('/api/english/xp/award', {
            method: 'POST', headers: headers, body: JSON.stringify(body)
        }, 10000);
        if (!res.ok) return;
        var data = await res.json();
        // Blocked by server (XP = 0)
        if (data.blocked) return;
        if (data.xp_gained !== 0) {
            _engXP.xp = data.current_xp;
            _engXP.level = data.level;
            _engXP.xp_needed = data.xp_needed;
            _engXP.total_xp = data.total_xp;
            _engXP.progress_pct = Math.round(data.current_xp / data.xp_needed * 100);
            _engXP.can_hint = (data.current_xp > 0 || data.level > 1);
            engRenderXPBar();
            engShowXPGain(data.xp_gained, source, data.leveled_up, data.leveled_down, data.level);
        }
    } catch(e) {}
}

function engShowXPGain(amount, source, leveledUp, leveledDown, newLevel) {
    // Floating XP notification
    var popup = document.createElement('div');
    popup.className = 'eng-xp-popup';
    if (amount < 0) {
        popup.innerHTML = amount + ' XP';
        popup.classList.add('eng-xp-popup-penalty');
    } else {
        popup.innerHTML = '+' + amount + ' XP';
    }
    if (leveledUp) {
        popup.innerHTML += ' <span class="eng-xp-levelup">🎉 Level ' + newLevel + '!</span>';
        popup.classList.add('eng-xp-popup-levelup');
    }
    if (leveledDown) {
        popup.innerHTML += ' <span class="eng-xp-leveldown">⬇️ Level ' + newLevel + '</span>';
        popup.classList.add('eng-xp-popup-penalty');
    }
    var bar = document.getElementById('engXPBar');
    if (bar) {
        bar.appendChild(popup);
        setTimeout(function() { popup.remove(); }, 2500);
    }

    // Level up celebration
    if (leveledUp) {
        engShowLevelUpModal(newLevel);
    }
    // Level down warning
    if (leveledDown) {
        showToast('⚠️ Bạn đã rớt xuống Level ' + newLevel + '!', 3000);
    }
}

// ── Daily Missions ──
async function engLoadMissions() {
    var headers = _engHeaders();
    if (!headers) return;
    try {
        var res = await fetchWithTimeout('/api/english/missions', { headers: headers }, 10000);
        if (!res.ok) return;
        var data = await res.json();
        engRenderMissions(data.missions || []);
    } catch(e) {}
}

function engRenderMissions(missions) {
    var el = document.getElementById('engMissions');
    if (!el) return;
    if (missions.length === 0) { el.innerHTML = ''; return; }

    var completedCount = missions.filter(function(m) { return m.completed; }).length;
    var html = '<div class="eng-missions-header">'
        + '<span class="eng-missions-title">🎯 Nhiệm vụ hôm nay</span>'
        + '<div class="eng-missions-header-right">'
        + '<span class="eng-missions-count">' + completedCount + '/' + missions.length + '</span>'
        + '<button class="eng-missions-settings" onclick="engCustomizeMissions()" title="Tùy chỉnh">⚙️</button>'
        + '</div>'
        + '</div>'
        + '<div class="eng-missions-list">';

    missions.forEach(function(m) {
        var pct = Math.min(100, Math.round(m.progress / m.target * 100));
        var statusClass = m.claimed ? 'eng-mission-claimed' : m.completed ? 'eng-mission-done' : '';
        var btnHtml = '';
        if (m.claimed) {
            btnHtml = '<span class="eng-mission-claimed-label">✅</span>';
        } else if (m.completed) {
            btnHtml = '<button class="eng-mission-claim-btn" onclick="engClaimMission(' + m.id + ')">+' + m.xp_reward + ' XP</button>';
        }

        html += '<div class="eng-mission-item ' + statusClass + '">'
            + '<span class="eng-mission-icon">' + m.icon + '</span>'
            + '<div class="eng-mission-info">'
            + '<div class="eng-mission-label">' + _engEsc(m.desc) + '</div>'
            + '<div class="eng-mission-bar"><div class="eng-mission-bar-fill" style="width:' + pct + '%"></div></div>'
            + '</div>'
            + '<span class="eng-mission-progress-text">' + m.progress + '/' + m.target + '</span>'
            + btnHtml
            + '</div>';
    });

    html += '</div>';
    el.innerHTML = html;
}

async function engClaimMission(missionId) {
    var headers = _engHeaders();
    if (!headers) return;
    try {
        var res = await fetchWithTimeout('/api/english/missions/claim/' + missionId, {
            method: 'POST', headers: headers
        }, 10000);
        if (!res.ok) return;
        var data = await res.json();
        if (data.ok && data.xp_data) {
            _engXP.xp = data.xp_data.current_xp;
            _engXP.level = data.xp_data.level;
            _engXP.xp_needed = data.xp_data.xp_needed;
            _engXP.progress_pct = Math.round(data.xp_data.current_xp / data.xp_data.xp_needed * 100);
            _engXP.can_hint = (data.xp_data.current_xp > 0 || data.xp_data.level > 1);
            engRenderXPBar();
            engShowXPGain(data.xp_awarded, 'mission', data.xp_data.leveled_up, data.xp_data.leveled_down, data.xp_data.level);
        }
        engLoadMissions();
        showToast('🎯 Nhận thưởng +' + data.xp_awarded + ' XP!', 2000);
    } catch(e) {}
}

function engCustomizeMissions() {
    // Load current config first
    var headers = _engHeaders();
    if (!headers) return;
    fetchWithTimeout('/api/english/missions/config', { headers: headers }, 5000)
        .then(function(res) { return res.json(); })
        .then(function(data) {
            var cfg = data.config || {};
            _engShowMissionConfigModal(cfg);
        })
        .catch(function() { _engShowMissionConfigModal({}); });
}

function _engShowMissionConfigModal(cfg) {
    var overlay = document.createElement('div');
    overlay.className = 'eng-levelup-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    var html = '<div class="eng-levelup-modal" style="max-width:380px;text-align:left">'
        + '<h3 style="margin:0 0 8px;color:var(--text-primary,#f1f5f9);text-align:center">⚙️ Tùy chỉnh nhiệm vụ</h3>'
        + '<p style="font-size:12px;color:#fbbf24;margin:0 0 14px;text-align:center">⚡ Áp dụng từ ngày mai</p>'
        + '<div class="eng-custom-missions">'
        + '<div class="eng-cm-row"><span>📚 Học từ mới</span><input type="number" id="engCM_learn" value="' + (cfg.learn_words || 5) + '" min="1" max="50" class="eng-count-input"></div>'
        + '<div class="eng-cm-row"><span>🔄 Ôn tập</span><input type="number" id="engCM_review" value="' + (cfg.review_cards || 5) + '" min="1" max="50" class="eng-count-input"></div>'
        + '<div class="eng-cm-row"><span>🧠 Làm Quiz</span><input type="number" id="engCM_quiz" value="' + (cfg.quiz_complete || 1) + '" min="1" max="10" class="eng-count-input"></div>'
        + '<div class="eng-cm-row"><span>🎮 Chơi Game</span><input type="number" id="engCM_game" value="' + (cfg.game_play || 1) + '" min="1" max="10" class="eng-count-input"></div>'
        + '</div>'
        + '<button class="eng-btn" style="width:100%;margin-top:14px" onclick="engSaveMissionCustom()">💾 Lưu mục tiêu</button>'
        + '</div>';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
}

async function engSaveMissionCustom() {
    var missions = [
        { key: 'learn_words', target: parseInt(document.getElementById('engCM_learn')?.value) || 5 },
        { key: 'review_cards', target: parseInt(document.getElementById('engCM_review')?.value) || 5 },
        { key: 'quiz_complete', target: parseInt(document.getElementById('engCM_quiz')?.value) || 1 },
        { key: 'game_play', target: parseInt(document.getElementById('engCM_game')?.value) || 1 },
    ];
    var headers = _engHeaders();
    if (!headers) return;
    try {
        await fetchWithTimeout('/api/english/missions/customize', {
            method: 'POST', headers: headers,
            body: JSON.stringify({ missions: missions })
        }, 10000);
        showToast('✅ Đã lưu! Áp dụng từ ngày mai', 2500);
        engLoadMissions();
    } catch(e) {}
    var overlay = document.querySelector('.eng-levelup-overlay');
    if (overlay) overlay.remove();
}

function engShowLevelUpModal(level) {
    var overlay = document.createElement('div');
    overlay.className = 'eng-levelup-overlay';
    overlay.innerHTML = '<div class="eng-levelup-modal">'
        + '<div class="eng-levelup-icon">🏆</div>'
        + '<div class="eng-levelup-title">Level Up!</div>'
        + '<div class="eng-levelup-level">Level ' + level + '</div>'
        + '<div class="eng-levelup-msg">Tiếp tục học để lên level tiếp!</div>'
        + '<button class="eng-btn" onclick="this.closest(\'.eng-levelup-overlay\').remove()">Tuyệt vời! 🎉</button>'
        + '</div>';
    document.body.appendChild(overlay);
    setTimeout(function() { if (overlay.parentNode) overlay.remove(); }, 5000);
}

// ── Today's words ──
async function engLoadToday() {
    var headers = _engHeaders();
    if (!headers) return;
    try {
        var res = await fetchWithTimeout('/api/english/today', { headers: headers }, 10000);
        if (!res.ok) return;
        var data = await res.json();
        _engWords = data.words || [];
        engRenderWords();
    } catch(e) {}
}

function engRenderWords() {
    var el = document.getElementById('engWordList');
    if (!el) return;
    if (_engWords.length === 0) {
        el.innerHTML = '<div class="eng-empty">Chưa có từ vựng hôm nay. Bấm "Học từ mới" để bắt đầu!</div>';
        return;
    }
    el.innerHTML = _engWords.map(function(w) {
        var pos = w.part_of_speech ? '<span class="eng-pos">' + _engEsc(w.part_of_speech) + '</span>' : '';
        return '<div class="eng-word-card">'
            + '<div class="eng-word-header"><strong>' + _engEsc(w.word) + '</strong>' + pos + '<span class="eng-phonetic">' + _engEsc(w.phonetic) + '</span></div>'
            + '<div class="eng-meaning">' + _engEsc(w.meaning) + '</div>'
            + '<div class="eng-example">"' + _engEsc(w.example) + '"</div>'
            + (w.exam_tip ? '<div class="eng-tip">💡 ' + _engEsc(w.exam_tip) + '</div>' : '')
            + '</div>';
    }).join('');
}

// ── Generate new words ──
async function engGenerateWords() {
    var topicSelect = document.getElementById('engTopic')?.value || '';
    var customTopic = document.getElementById('engCustomTopic')?.value.trim() || '';
    var topic = customTopic || topicSelect || 'IELTS Academic';
    var count = parseInt(document.getElementById('engWordCount')?.value) || 5;
    count = Math.max(1, Math.min(100, count));

    var headers = _engHeaders();
    if (!headers) return;

    var btn = document.getElementById('engGenBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang tạo ' + count + ' từ...'; }

    try {
        var res = await fetchWithTimeout('/api/english/generate-vocab', {
            method: 'POST', headers: headers,
            body: JSON.stringify({ topic: topic, level: 'intermediate', count: count })
        }, 60000);
        if (!res.ok) {
            var err = await res.json().catch(function() { return {}; });
            showToast(err.detail || 'Lỗi', 3000);
            return;
        }
        var data = await res.json();
        _engWords = data.words || [];
        showToast('✅ Đã tạo ' + data.count + ' từ mới!', 2000);
        engRenderWords();
        engLoadStats();
        engLoadSavedWords(1);
        // Add custom topic to dropdown if not already there
        if (customTopic) {
            _engAddCustomTopic(customTopic);
            document.getElementById('engCustomTopic').value = '';
        }
    } catch(e) { showToast('Lỗi: ' + e.message, 3000); }
    finally { if (btn) { btn.disabled = false; btn.textContent = '✨ Tạo từ vựng'; } }
}

// ── Saved words with pagination ──
var _engSavedPage = 1;

async function engLoadSavedWords(page) {
    var headers = _engHeaders();
    if (!headers) return;
    _engSavedPage = page || 1;

    var topic = document.getElementById('engFilterTopic')?.value || '';
    var pos = document.getElementById('engFilterPos')?.value || '';
    var mastery = document.getElementById('engFilterMastery')?.value || '';

    var url = '/api/english/all?page=' + _engSavedPage + '&per_page=15';
    if (topic) url += '&topic=' + encodeURIComponent(topic);
    if (pos) url += '&pos=' + encodeURIComponent(pos);
    if (mastery) url += '&mastery=' + mastery;

    try {
        var res = await fetchWithTimeout(url, { headers: headers }, 10000);
        if (!res.ok) return;
        var data = await res.json();
        engRenderSavedList(data.words || [], data.total, data.page, data.total_pages);
    } catch(e) {}

    // Load topics for filter (only once)
    _engLoadFilterTopics();
}

function engApplyFilters() {
    engLoadSavedWords(1);
}

var _engFilterTopicsLoaded = false;
async function _engLoadFilterTopics() {
    if (_engFilterTopicsLoaded) return;
    var headers = _engHeaders();
    if (!headers) return;
    try {
        var res = await fetchWithTimeout('/api/english/topics', { headers: headers }, 5000);
        if (!res.ok) return;
        var data = await res.json();
        var sel = document.getElementById('engFilterTopic');
        if (sel && data.topics) {
            data.topics.forEach(function(t) {
                var opt = document.createElement('option');
                opt.value = t;
                opt.textContent = t;
                sel.appendChild(opt);
            });
            _engFilterTopicsLoaded = true;
        }
    } catch(e) {}
}

function engRenderSavedList(words, total, page, totalPages) {
    var el = document.getElementById('engSavedList');
    if (!el) return;

    if (words.length === 0) {
        el.innerHTML = '<div class="eng-empty">Chưa có từ nào được lưu</div>';
        document.getElementById('engPagination').innerHTML = '';
        return;
    }

    el.innerHTML = words.map(function(w, idx) {
        var pos = w.part_of_speech ? '<span class="eng-saved-pos">' + _engEsc(w.part_of_speech) + '</span>' : '';
        var mastery = w.mastery || { level: 1, label: 'Mới', color: '#94a3b8' };
        var masteryHtml = '<span class="eng-mastery-badge" style="--mastery-color:' + mastery.color + '">' + mastery.label + '</span>';
        return '<div class="eng-saved-item eng-saved-clickable" onclick="engToggleWordDetail(this, ' + idx + ')">'
            + '<strong>' + _engEsc(w.word) + '</strong>'
            + pos
            + masteryHtml
            + '<span class="eng-saved-meaning">' + _engEsc(w.meaning) + '</span>'
            + '<span class="eng-saved-topic">' + _engEsc(w.topic) + '</span>'
            + '</div>';
    }).join('');

    // Store words data for detail view
    el._wordsData = words;

    // Pagination
    var pagEl = document.getElementById('engPagination');
    if (!pagEl || totalPages <= 1) { if (pagEl) pagEl.innerHTML = ''; return; }

    var html = '<span class="eng-pag-info">' + total + ' từ · Trang ' + page + '/' + totalPages + '</span>';
    if (page > 1) html += '<button class="eng-pag-btn" onclick="engLoadSavedWords(' + (page - 1) + ')">← Trước</button>';
    if (page < totalPages) html += '<button class="eng-pag-btn" onclick="engLoadSavedWords(' + (page + 1) + ')">Sau →</button>';
    pagEl.innerHTML = html;
}

// ── Review (flashcard) ──
var _engReviewIdx = 0;
var _engFlipped = false;

async function engStartReview() {
    engShowTab('review');
    // Show options first
    var el = document.getElementById('engReviewArea');
    if (!el) return;
    el.innerHTML = '<div class="eng-options-panel">'
        + '<h3 style="margin:0 0 12px;color:var(--text-primary,#f1f5f9)">🔄 Tùy chọn ôn tập</h3>'
        + '<div class="eng-opt-row"><label>Số từ:</label><input type="number" id="engReviewCount" value="10" min="1" max="50" class="eng-count-input"></div>'
        + '<div class="eng-opt-row"><label>Chủ đề:</label><select id="engReviewTopic" class="eng-select" style="flex:1"><option value="">Tất cả</option></select></div>'
        + '<div class="eng-opt-row"><label>Loại:</label><select id="engReviewType" class="eng-select" style="flex:1">'
        + '<option value="due">Đến hạn ôn</option><option value="new">Chưa ôn lần nào</option><option value="all">Tất cả (ngẫu nhiên)</option><option value="pick">Chọn từ cụ thể</option></select></div>'
        + '<div id="engPickWordsWrap" style="display:none"></div>'
        + '<button class="eng-btn" style="width:100%;margin-top:12px" onclick="engDoReview()">▶️ Bắt đầu ôn tập</button>'
        + '</div>';
    _engLoadTopicOptions('engReviewTopic');
    // Show word picker when "pick" is selected
    document.getElementById('engReviewType').addEventListener('change', function() {
        var wrap = document.getElementById('engPickWordsWrap');
        var countInput = document.getElementById('engReviewCount');
        if (this.value === 'pick') {
            wrap.style.display = '';
            if (countInput) countInput.closest('.eng-opt-row').style.display = 'none';
            _engLoadWordPicker(wrap, 'review');
        } else {
            wrap.style.display = 'none';
            if (countInput) countInput.closest('.eng-opt-row').style.display = '';
        }
    });
}

async function _engLoadTopicOptions(selectId) {
    var headers = _engHeaders();
    if (!headers) return;
    try {
        var res = await fetchWithTimeout('/api/english/topics', { headers: headers }, 5000);
        if (!res.ok) return;
        var data = await res.json();
        var sel = document.getElementById(selectId);
        if (sel && data.topics) {
            data.topics.forEach(function(t) {
                sel.innerHTML += '<option value="' + _engEsc(t) + '">' + _engEsc(t) + '</option>';
            });
        }
    } catch(e) {}
}

async function engDoReview() {
    var count = parseInt(document.getElementById('engReviewCount')?.value) || 10;
    var topic = document.getElementById('engReviewTopic')?.value || '';
    var type = document.getElementById('engReviewType')?.value || 'due';
    var headers = _engHeaders();
    if (!headers) return;

    // If pick mode, use selected words directly
    if (type === 'pick') {
        var picked = _engGetPickedWords('engPickWordsWrap');
        if (picked.length === 0) { showToast('Chưa chọn từ nào!', 2000); return; }
        _engReviewWords = picked.map(function(w) { return { id: w.id, word: w.word, meaning: w.meaning, example: '', phonetic: '' }; });
        _engReviewIdx = 0;
        _engFlipped = false;
        engRenderReviewCard();
        return;
    }

    var url = '/api/english/review?limit=' + count + '&type=' + type;
    if (topic) url += '&topic=' + encodeURIComponent(topic);

    try {
        var res = await fetchWithTimeout(url, { headers: headers }, 10000);
        if (!res.ok) return;
        var data = await res.json();
        _engReviewWords = data.words || [];
        if (_engReviewWords.length === 0) {
            showToast('Không có từ nào phù hợp!', 2000);
            return;
        }
        _engReviewIdx = 0;
        _engFlipped = false;
        engRenderReviewCard();
    } catch(e) {}
}

function engRenderReviewCard() {
    var el = document.getElementById('engReviewArea');
    if (!el || _engReviewIdx >= _engReviewWords.length) {
        if (el) el.innerHTML = '<div class="eng-empty">🎉 Hoàn thành ôn tập!</div>';
        // Show options panel again after a short delay
        setTimeout(function() { engStartReview(); }, 1500);
        return;
    }
    var w = _engReviewWords[_engReviewIdx];
    var posHtml = w.part_of_speech ? '<div class="eng-review-pos">' + _engEsc(w.part_of_speech) + '</div>' : '';
    el.innerHTML = '<div class="eng-review-card" onclick="engFlipCard()">'
        + '<div class="eng-review-front' + (_engFlipped ? ' eng-hidden' : '') + '">'
        + '<div class="eng-review-word">' + _engEsc(w.word) + '</div>'
        + posHtml
        + '<div class="eng-review-phonetic">' + _engEsc(w.phonetic) + '</div>'
        + '<div class="eng-review-hint">Bấm để xem nghĩa</div>'
        + '</div>'
        + '<div class="eng-review-back' + (!_engFlipped ? ' eng-hidden' : '') + '">'
        + '<div class="eng-review-meaning">' + _engEsc(w.meaning) + '</div>'
        + '<div class="eng-review-example">"' + _engEsc(w.example) + '"</div>'
        + '</div></div>'
        + (_engFlipped ? '<div class="eng-review-btns">'
            + '<button class="eng-rate-btn eng-rate-hard" onclick="engRate(1)">😰 Khó</button>'
            + '<button class="eng-rate-btn eng-rate-ok" onclick="engRate(3)">🙂 Ổn</button>'
            + '<button class="eng-rate-btn eng-rate-easy" onclick="engRate(5)">😊 Dễ</button>'
            + '</div>' : '')
        + '<div class="eng-review-progress">' + (_engReviewIdx + 1) + ' / ' + _engReviewWords.length + '</div>';
}

function engFlipCard() {
    _engFlipped = true;
    engRenderReviewCard();
}

async function engRate(quality) {
    var w = _engReviewWords[_engReviewIdx];
    var headers = _engHeaders();
    if (headers) {
        fetchWithTimeout('/api/english/review/' + w.id + '?quality=' + quality, {
            method: 'POST', headers: headers
        }, 5000).catch(function() {});
    }
    // Award XP for review
    engAwardXP('review', 0, 0, quality);
    _engReviewIdx++;
    _engFlipped = false;
    engRenderReviewCard();
    if (_engReviewIdx >= _engReviewWords.length) {
        engLoadStats();
    }
}

// ── Quiz ──
async function engStartQuiz() {
    engShowTab('quiz');
    var el = document.getElementById('engQuizArea');
    if (!el) return;
    el.innerHTML = '<div class="eng-options-panel">'
        + '<h3 style="margin:0 0 12px;color:var(--text-primary,#f1f5f9)">🧠 Tùy chọn Quiz</h3>'
        + '<div class="eng-opt-row"><label>Số câu:</label><input type="number" id="engQuizCount" value="5" min="3" max="20" class="eng-count-input"></div>'
        + '<div class="eng-opt-row"><label>Chủ đề:</label><select id="engQuizTopic" class="eng-select" style="flex:1"><option value="">Tất cả</option></select></div>'
        + '<div class="eng-opt-row"><label></label><label style="min-width:auto"><input type="checkbox" id="engQuizPickMode"> Chọn từ cụ thể</label></div>'
        + '<div id="engQuizPickWrap" style="display:none"></div>'
        + '<button class="eng-btn" style="width:100%;margin-top:12px" onclick="engDoQuiz()">▶️ Bắt đầu Quiz</button>'
        + '</div>';
    _engLoadTopicOptions('engQuizTopic');
    document.getElementById('engQuizPickMode').addEventListener('change', function() {
        var wrap = document.getElementById('engQuizPickWrap');
        var countInput = document.getElementById('engQuizCount');
        if (this.checked) {
            wrap.style.display = '';
            if (countInput) countInput.closest('.eng-opt-row').style.display = 'none';
            _engLoadWordPicker(wrap, 'quiz');
        } else {
            wrap.style.display = 'none';
            if (countInput) countInput.closest('.eng-opt-row').style.display = '';
        }
    });
}

async function engDoQuiz() {
    var count = parseInt(document.getElementById('engQuizCount')?.value) || 5;
    var topic = document.getElementById('engQuizTopic')?.value || '';
    var pickMode = document.getElementById('engQuizPickMode')?.checked;
    var headers = _engHeaders();
    if (!headers) return;

    // If pick mode, build quiz from selected words locally
    if (pickMode) {
        var picked = _engGetPickedWords('engQuizPickWrap');
        if (picked.length < 4) { showToast('Cần chọn ít nhất 4 từ để tạo quiz', 2000); return; }
        var questions = [];
        var shuffled = picked.slice().sort(function() { return Math.random() - 0.5; });
        shuffled.slice(0, count).forEach(function(w, i) {
            var correct = w.meaning;
            var wrongPool = picked.filter(function(p) { return p.id !== w.id; }).map(function(p) { return p.meaning; });
            wrongPool.sort(function() { return Math.random() - 0.5; });
            var options = [correct].concat(wrongPool.slice(0, 3));
            options.sort(function() { return Math.random() - 0.5; });
            questions.push({ id: i + 1, word: w.word, options: options, correct_index: options.indexOf(correct) });
        });
        _engQuiz = questions;
        _engQuizIdx = 0;
        _engQuizScore = 0;
        engRenderQuizQ();
        return;
    }

    var url = '/api/english/quiz?count=' + count;
    if (topic) url += '&topic=' + encodeURIComponent(topic);

    try {
        var res = await fetchWithTimeout(url, { method: 'POST', headers: headers }, 10000);
        if (!res.ok) {
            var err = await res.json().catch(function() { return {}; });
            showToast(err.detail || 'Lỗi', 3000);
            return;
        }
        var data = await res.json();
        _engQuiz = data.questions || [];
        _engQuizIdx = 0;
        _engQuizScore = 0;
        engRenderQuizQ();
    } catch(e) { showToast('Lỗi', 3000); }
}

function engRenderQuizQ() {
    var el = document.getElementById('engQuizArea');
    if (!el) return;
    if (_engQuizIdx >= _engQuiz.length) {
        var pct = Math.round(_engQuizScore / _engQuiz.length * 100);
        el.innerHTML = '<div class="eng-quiz-result">'
            + '<div class="eng-quiz-score">' + pct + '%</div>'
            + '<div>' + _engQuizScore + '/' + _engQuiz.length + ' đúng</div>'
            + '<button class="eng-btn" onclick="engShowTab(\'words\');engLoadStats()">Quay lại</button>'
            + '</div>';
        // Award XP for quiz completion
        engAwardXP('quiz', _engQuizScore, _engQuiz.length);
        return;
    }
    var q = _engQuiz[_engQuizIdx];
    var posHtml = q.part_of_speech ? '<div class="eng-quiz-pos">' + _engEsc(q.part_of_speech) + '</div>' : '';
    var html = '<div class="eng-quiz-card">'
        + '<div class="eng-quiz-word">' + _engEsc(q.word) + '</div>'
        + posHtml
        + '<div class="eng-quiz-prompt">Nghĩa là gì?</div>'
        + '<div class="eng-quiz-options">';
    q.options.forEach(function(opt, i) {
        html += '<button class="eng-quiz-opt" onclick="engAnswer(' + i + ',' + q.correct_index + ')">' + _engEsc(opt) + '</button>';
    });
    html += '</div><div class="eng-quiz-progress">Câu ' + (_engQuizIdx + 1) + '/' + _engQuiz.length + '</div></div>';
    el.innerHTML = html;
}

function engAnswer(selected, correct) {
    var q = _engQuiz[_engQuizIdx];
    if (selected === correct) _engQuizScore++;
    // Track mastery
    _engReportMastery(q.word, selected === correct);
    var opts = document.querySelectorAll('.eng-quiz-opt');
    opts.forEach(function(btn, i) {
        btn.disabled = true;
        if (i === correct) btn.classList.add('eng-correct');
        if (i === selected && i !== correct) btn.classList.add('eng-wrong');
    });
    setTimeout(function() { _engQuizIdx++; engRenderQuizQ(); }, 1000);
}

// ── Tabs ──
function engShowTab(tab) {
    ['words', 'saved', 'review', 'quiz', 'games'].forEach(function(t) {
        var panel = document.getElementById('engPanel_' + t);
        var btn = document.getElementById('engTab_' + t);
        if (panel) panel.style.display = t === tab ? '' : 'none';
        if (btn) btn.classList.toggle('eng-tab-active', t === tab);
    });
    // Reset games menu when switching to games tab
    if (tab === 'games') {
        var menu = document.getElementById('engGamesMenu');
        var area = document.getElementById('engGameArea');
        if (menu) menu.style.display = '';
        if (area) area.style.display = 'none';
    }
}

async function _engLoadWordPicker(container, mode) {
    var headers = _engHeaders();
    if (!headers) return;
    container.innerHTML = '<div style="padding:8px;color:var(--text-secondary,#94a3b8);font-size:12px">Đang tải...</div>';

    try {
        var res = await fetchWithTimeout('/api/english/all?page=1&per_page=100', { headers: headers }, 10000);
        if (!res.ok) return;
        var data = await res.json();
        var words = data.words || [];
        if (words.length === 0) {
            container.innerHTML = '<div style="padding:8px;color:var(--text-secondary,#94a3b8);font-size:12px">Chưa có từ nào</div>';
            return;
        }
        var html = '<div class="eng-word-picker"><div class="eng-picker-actions">'
            + '<button class="eng-picker-action" onclick="_engPickAll(this,true)">Chọn tất cả</button>'
            + '<button class="eng-picker-action" onclick="_engPickAll(this,false)">Bỏ chọn</button></div>'
            + '<div class="eng-picker-list">';
        words.forEach(function(w) {
            html += '<label class="eng-picker-item"><input type="checkbox" value="' + w.id + '" data-word="' + _engEsc(w.word) + '" data-meaning="' + _engEsc(w.meaning) + '"><span>' + _engEsc(w.word) + '</span><span class="eng-picker-meaning">' + _engEsc(w.meaning) + '</span></label>';
        });
        html += '</div></div>';
        container.innerHTML = html;
    } catch(e) { container.innerHTML = '<div style="padding:8px;color:#f87171;font-size:12px">Lỗi tải từ</div>'; }
}

function _engPickAll(btn, check) {
    var picker = btn.closest('.eng-word-picker');
    if (picker) picker.querySelectorAll('input[type=checkbox]').forEach(function(cb) { cb.checked = check; });
}

function _engGetPickedWords(wrapperId) {
    var wrap = document.getElementById(wrapperId);
    if (!wrap) return [];
    var checked = wrap.querySelectorAll('input[type=checkbox]:checked');
    var words = [];
    checked.forEach(function(cb) {
        words.push({ id: parseInt(cb.value), word: cb.getAttribute('data-word'), meaning: cb.getAttribute('data-meaning') });
    });
    return words;
}

function _engEsc(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Report mastery (correct/wrong) for a word
function _engReportMastery(word, correct) {
    var headers = _engHeaders();
    if (!headers) return;
    fetchWithTimeout('/api/english/mastery/update', {
        method: 'POST', headers: headers,
        body: JSON.stringify({ results: [{ word: word, correct: correct }] })
    }, 5000).catch(function() {});
}

// Toggle word detail in saved list
function engToggleWordDetail(el, idx) {
    // If detail already open, close it
    var existing = el.nextElementSibling;
    if (existing && existing.classList.contains('eng-word-detail')) {
        existing.remove();
        el.classList.remove('eng-saved-expanded');
        return;
    }
    // Close any other open detail
    var list = document.getElementById('engSavedList');
    if (list) {
        list.querySelectorAll('.eng-word-detail').forEach(function(d) { d.remove(); });
        list.querySelectorAll('.eng-saved-expanded').forEach(function(d) { d.classList.remove('eng-saved-expanded'); });
    }
    // Get word data
    var words = list._wordsData;
    if (!words || !words[idx]) return;
    var w = words[idx];

    var pos = w.part_of_speech ? '<span class="eng-pos">' + _engEsc(w.part_of_speech) + '</span>' : '';
    var mastery = w.mastery || { level: 1, label: 'Mới', color: '#94a3b8' };
    var statsHtml = '<div class="eng-detail-stats">'
        + '<span class="eng-detail-stat">✅ ' + (w.correct_count || 0) + ' đúng</span>'
        + '<span class="eng-detail-stat">❌ ' + (w.wrong_count || 0) + ' sai</span>'
        + '<span class="eng-mastery-badge" style="--mastery-color:' + mastery.color + '">' + mastery.label + '</span>'
        + '</div>';

    var actionsHtml = '<div class="eng-detail-actions">'
        + '<button class="eng-detail-btn eng-detail-edit" onclick="engEditWord(' + w.id + ',' + idx + ')">✏️ Sửa</button>'
        + '<button class="eng-detail-btn eng-detail-delete" onclick="engDeleteWord(' + w.id + ')">🗑️ Xóa</button>'
        + '</div>';

    var detail = document.createElement('div');
    detail.className = 'eng-word-detail';
    detail.innerHTML = '<div class="eng-word-detail-inner">'
        + '<div class="eng-word-header"><strong>' + _engEsc(w.word) + '</strong>' + pos + '<span class="eng-phonetic">' + _engEsc(w.phonetic) + '</span></div>'
        + '<div class="eng-meaning">' + _engEsc(w.meaning) + '</div>'
        + (w.example ? '<div class="eng-example">"' + _engEsc(w.example) + '"</div>' : '')
        + statsHtml
        + actionsHtml
        + '</div>';

    el.classList.add('eng-saved-expanded');
    el.after(detail);
}

// Delete word
async function engDeleteWord(wordId) {
    if (typeof _crConfirmModal === 'function') {
        var result = await _crConfirmModal('🗑️ Xóa từ này?', 'Từ sẽ bị xóa vĩnh viễn khỏi danh sách.');
        if (result === 'ok') {
            await _engDoDelete(wordId);
        }
    } else {
        await _engDoDelete(wordId);
    }
}

async function _engDoDelete(wordId) {
    var headers = _engHeaders();
    if (!headers) return;
    try {
        var res = await fetchWithTimeout('/api/english/word/' + wordId, {
            method: 'DELETE', headers: headers
        }, 10000);
        if (res.ok) {
            showToast('🗑️ Đã xóa từ', 2000);
            engLoadSavedWords(_engSavedPage);
            engLoadStats();
        } else {
            showToast('Lỗi xóa từ', 2000);
        }
    } catch(e) { showToast('Lỗi: ' + e.message, 2000); }
}

// Edit word
function engEditWord(wordId, idx) {
    var list = document.getElementById('engSavedList');
    var words = list?._wordsData;
    if (!words || !words[idx]) return;
    var w = words[idx];

    // Replace detail with edit form
    var detail = list.querySelector('.eng-word-detail');
    if (!detail) return;

    detail.innerHTML = '<div class="eng-word-detail-inner eng-edit-form">'
        + '<div class="eng-add-row"><input type="text" class="eng-add-input" id="engEditWord" value="' + _engEsc(w.word) + '" placeholder="Từ *">'
        + '<input type="text" class="eng-add-input" id="engEditMeaning" value="' + _engEsc(w.meaning) + '" placeholder="Nghĩa *"></div>'
        + '<div class="eng-add-row"><input type="text" class="eng-add-input" id="engEditPhonetic" value="' + _engEsc(w.phonetic) + '" placeholder="Phiên âm">'
        + '<select class="eng-add-input" id="engEditPos">'
        + '<option value="">Loại từ</option>'
        + '<option value="noun"' + (w.part_of_speech === 'noun' ? ' selected' : '') + '>Noun</option>'
        + '<option value="verb"' + (w.part_of_speech === 'verb' ? ' selected' : '') + '>Verb</option>'
        + '<option value="adjective"' + (w.part_of_speech === 'adjective' ? ' selected' : '') + '>Adjective</option>'
        + '<option value="adverb"' + (w.part_of_speech === 'adverb' ? ' selected' : '') + '>Adverb</option>'
        + '<option value="phrase"' + (w.part_of_speech === 'phrase' ? ' selected' : '') + '>Phrase</option>'
        + '</select></div>'
        + '<div class="eng-add-row"><input type="text" class="eng-add-input eng-add-full" id="engEditExample" value="' + _engEsc(w.example || '') + '" placeholder="Câu ví dụ"></div>'
        + '<div class="eng-edit-btns">'
        + '<button class="eng-btn" onclick="engSaveEdit(' + wordId + ')">💾 Lưu</button>'
        + '<button class="eng-btn eng-btn-outline" onclick="engLoadSavedWords(' + _engSavedPage + ')">Hủy</button>'
        + '</div></div>';
}

async function engSaveEdit(wordId) {
    var word = document.getElementById('engEditWord')?.value.trim();
    var meaning = document.getElementById('engEditMeaning')?.value.trim();
    if (!word || !meaning) { showToast('Cần nhập từ và nghĩa!', 2000); return; }

    var headers = _engHeaders();
    if (!headers) return;

    try {
        var res = await fetchWithTimeout('/api/english/word/' + wordId, {
            method: 'PUT', headers: headers,
            body: JSON.stringify({
                word: word,
                meaning: meaning,
                phonetic: document.getElementById('engEditPhonetic')?.value.trim() || '',
                part_of_speech: document.getElementById('engEditPos')?.value || '',
                example: document.getElementById('engEditExample')?.value.trim() || ''
            })
        }, 10000);
        if (res.ok) {
            showToast('✅ Đã cập nhật', 2000);
            engLoadSavedWords(_engSavedPage);
        } else {
            showToast('Lỗi cập nhật', 2000);
        }
    } catch(e) { showToast('Lỗi: ' + e.message, 2000); }
}

// Add custom topic to dropdown select
function _engAddCustomTopic(topic) {
    var sel = document.getElementById('engTopic');
    if (!sel) return;
    // Check if already exists
    var exists = false;
    for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === topic) { exists = true; break; }
    }
    if (exists) {
        sel.value = topic;
        return;
    }
    // Find or create "Chủ đề của bạn" optgroup
    var customGroup = sel.querySelector('optgroup[label="Chủ đề của bạn"]');
    if (!customGroup) {
        customGroup = document.createElement('optgroup');
        customGroup.label = 'Chủ đề của bạn';
        sel.insertBefore(customGroup, sel.firstChild.nextSibling); // after the first empty option
    }
    var opt = document.createElement('option');
    opt.value = topic;
    opt.textContent = topic;
    customGroup.appendChild(opt);
    sel.value = topic;
    // Save to localStorage for persistence
    var saved = JSON.parse(localStorage.getItem('eng_custom_topics') || '[]');
    if (saved.indexOf(topic) === -1) {
        saved.push(topic);
        localStorage.setItem('eng_custom_topics', JSON.stringify(saved));
    }
}

// Load saved custom topics on page load
function _engLoadCustomTopics() {
    var saved = JSON.parse(localStorage.getItem('eng_custom_topics') || '[]');
    if (saved.length === 0) return;
    var sel = document.getElementById('engTopic');
    if (!sel) return;
    var customGroup = document.createElement('optgroup');
    customGroup.label = 'Chủ đề của bạn';
    saved.forEach(function(t) {
        var opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        customGroup.appendChild(opt);
    });
    sel.insertBefore(customGroup, sel.firstChild.nextSibling);
}


// ══════════════════════════════════════════════════════════════
// ── GAMES ──
// ══════════════════════════════════════════════════════════════

var _engGameWords = [];
var _engGameType = '';
var _engGameScore = 0;
var _engGameTotal = 0;
var _engGameRound = 0;
var _engGameTimer = null;
var _engGameTimeLeft = 0;
var _engGameHintUsed = false;
var _engGameHintPenalty = 0; // Total XP penalty from hints

async function engGameStart(type) {
    _engGameType = type;
    var headers = _engHeaders();
    if (!headers) return;

    // Load words for game
    try {
        var res = await fetchWithTimeout('/api/english/all?page=1&per_page=100', { headers: headers }, 10000);
        if (!res.ok) return;
        var data = await res.json();
        var words = data.words || [];
        if (words.length < 4) {
            showToast('Cần ít nhất 4 từ đã học để chơi game!', 3000);
            return;
        }
        _engGameWords = words.sort(function() { return Math.random() - 0.5; });
        _engGameScore = 0;
        _engGameRound = 0;
        _engGameHintPenalty = 0;

        var menu = document.getElementById('engGamesMenu');
        var area = document.getElementById('engGameArea');
        if (menu) menu.style.display = 'none';
        if (area) area.style.display = '';

        if (type === 'match') engGameMatch();
        else if (type === 'spelling') engGameSpelling();
        else if (type === 'scramble') engGameScramble();
    } catch(e) { showToast('Lỗi tải từ vựng', 3000); }
}

function engGameBack() {
    if (_engGameTimer) { clearInterval(_engGameTimer); _engGameTimer = null; }
    var menu = document.getElementById('engGamesMenu');
    var area = document.getElementById('engGameArea');
    if (menu) menu.style.display = '';
    if (area) { area.style.display = 'none'; area.innerHTML = ''; }
}

function engGameResult() {
    var area = document.getElementById('engGameArea');
    if (!area) return;
    var pct = Math.round(_engGameScore / _engGameTotal * 100);
    var emoji = pct >= 80 ? '🏆' : pct >= 50 ? '👍' : '💪';
    var penaltyHtml = _engGameHintPenalty > 0 ? '<div class="eng-game-result-penalty">💡 Gợi ý: -' + _engGameHintPenalty + ' XP</div>' : '';
    area.innerHTML = '<div class="eng-game-result">'
        + '<div class="eng-game-result-emoji">' + emoji + '</div>'
        + '<div class="eng-game-result-score">' + _engGameScore + '/' + _engGameTotal + '</div>'
        + '<div class="eng-game-result-pct">' + pct + '% đúng</div>'
        + penaltyHtml
        + '<div class="eng-game-result-btns">'
        + '<button class="eng-btn" onclick="engGameStart(\'' + _engGameType + '\')">🔄 Chơi lại</button>'
        + '<button class="eng-btn eng-btn-outline" onclick="engGameBack()">← Quay lại</button>'
        + '</div></div>';
    // Award XP for game completion
    engAwardXP('game_' + _engGameType, _engGameScore, _engGameTotal);
}

// ═══════════════════════════════════════
// GAME 1: Word Match (nối từ - nghĩa)
// ═══════════════════════════════════════
function engGameMatch() {
    var pool = _engGameWords.slice(0, Math.min(6, _engGameWords.length));
    _engGameTotal = pool.length;
    _engGameScore = 0;
    _engGameTimeLeft = pool.length * 10; // 10s per word

    var area = document.getElementById('engGameArea');
    if (!area) return;

    // Shuffle left (words) and right (meanings) independently
    var leftItems = pool.map(function(w, i) { return { id: i, word: w.word }; });
    var rightItems = pool.map(function(w, i) { return { id: i, meaning: w.meaning }; });
    rightItems.sort(function() { return Math.random() - 0.5; });

    var html = '<div class="eng-game-header">'
        + '<button class="eng-game-back-btn" onclick="engGameBack()">← Quay lại</button>'
        + '<span class="eng-game-label">🔗 Word Match</span>'
        + '<span class="eng-game-timer" id="engMatchTimer">⏱ ' + _engGameTimeLeft + 's</span>'
        + '</div>'
        + '<p class="eng-game-instruction">Bấm vào từ bên trái, rồi bấm nghĩa bên phải để nối</p>'
        + '<div class="eng-match-board">'
        + '<div class="eng-match-col eng-match-left">';
    leftItems.forEach(function(item) {
        html += '<button class="eng-match-item eng-match-word" data-id="' + item.id + '">' + _engEsc(item.word) + '</button>';
    });
    html += '</div><div class="eng-match-col eng-match-right">';
    rightItems.forEach(function(item) {
        html += '<button class="eng-match-item eng-match-meaning" data-id="' + item.id + '">' + _engEsc(item.meaning) + '</button>';
    });
    html += '</div></div>'
        + '<div class="eng-match-footer"><div class="eng-match-score" id="engMatchScore">Đã nối: 0/' + _engGameTotal + '</div>'
        + '<button class="eng-game-hint-btn" id="engMatchHintBtn" onclick="engMatchHint()">💡 Gợi ý (-5 XP)</button></div>';

    area.innerHTML = html;

    // Timer
    _engGameTimer = setInterval(function() {
        _engGameTimeLeft--;
        var timerEl = document.getElementById('engMatchTimer');
        if (timerEl) timerEl.textContent = '⏱ ' + _engGameTimeLeft + 's';
        if (_engGameTimeLeft <= 0) {
            clearInterval(_engGameTimer);
            _engGameTimer = null;
            engGameResult();
        }
    }, 1000);

    // Match logic
    var selectedWord = null;
    area.addEventListener('click', function(e) {
        var btn = e.target.closest('.eng-match-item');
        if (!btn || btn.classList.contains('eng-match-done')) return;

        if (btn.classList.contains('eng-match-word')) {
            // Select word
            area.querySelectorAll('.eng-match-word').forEach(function(b) { b.classList.remove('eng-match-selected'); });
            btn.classList.add('eng-match-selected');
            selectedWord = btn;
        } else if (btn.classList.contains('eng-match-meaning') && selectedWord) {
            // Try to match
            var wordId = parseInt(selectedWord.getAttribute('data-id'));
            var meaningId = parseInt(btn.getAttribute('data-id'));

            if (wordId === meaningId) {
                // Correct
                _engGameScore++;
                selectedWord.classList.add('eng-match-done', 'eng-match-correct');
                btn.classList.add('eng-match-done', 'eng-match-correct');
                selectedWord.classList.remove('eng-match-selected');
                selectedWord = null;
                var scoreEl = document.getElementById('engMatchScore');
                if (scoreEl) scoreEl.textContent = 'Đã nối: ' + _engGameScore + '/' + _engGameTotal;
                if (_engGameScore >= _engGameTotal) {
                    clearInterval(_engGameTimer);
                    _engGameTimer = null;
                    setTimeout(engGameResult, 600);
                }
            } else {
                // Wrong - flash red
                selectedWord.classList.add('eng-match-wrong');
                btn.classList.add('eng-match-wrong');
                var sw = selectedWord;
                setTimeout(function() {
                    sw.classList.remove('eng-match-wrong', 'eng-match-selected');
                    btn.classList.remove('eng-match-wrong');
                }, 500);
                selectedWord = null;
            }
        }
    });
}

function engMatchHint() {
    // Check if user can use hint
    if (!_engXP.can_hint) {
        showToast('❌ XP đã về 0, không thể dùng gợi ý!', 2000);
        return;
    }
    // Find a word that hasn't been matched yet
    var area = document.getElementById('engGameArea');
    if (!area) return;
    var unmatched = area.querySelectorAll('.eng-match-word:not(.eng-match-done)');
    if (unmatched.length === 0) return;

    // Pick first unmatched word, highlight its correct meaning
    var wordBtn = unmatched[0];
    var wordId = wordBtn.getAttribute('data-id');
    var meaningBtn = area.querySelector('.eng-match-meaning[data-id="' + wordId + '"]:not(.eng-match-done)');
    if (!meaningBtn) return;

    // Penalty - deduct immediately
    _engGameHintPenalty += 5;
    engAwardXP('hint_penalty', -5, 0);
    showToast('💡 Gợi ý: -5 XP', 1500);

    // Highlight hint
    wordBtn.classList.add('eng-match-hint-flash');
    meaningBtn.classList.add('eng-match-hint-flash');
    setTimeout(function() {
        wordBtn.classList.remove('eng-match-hint-flash');
        meaningBtn.classList.remove('eng-match-hint-flash');
    }, 2000);
}

// ═══════════════════════════════════════
// GAME 2: Spelling Bee (đọc nghĩa, gõ từ)
// ═══════════════════════════════════════
function engGameSpelling() {
    var pool = _engGameWords.slice(0, Math.min(8, _engGameWords.length));
    _engGameTotal = pool.length;
    _engGameScore = 0;
    _engGameRound = 0;
    _engSpellingRevealed = []; // track revealed letter indices per round
    engSpellingRound(pool);
}

var _engSpellingRevealed = [];

function engSpellingRound(pool) {
    var area = document.getElementById('engGameArea');
    if (!area) return;

    if (_engGameRound >= pool.length) {
        engGameResult();
        return;
    }

    _engSpellingRevealed = [0]; // always reveal first letter
    var w = pool[_engGameRound];
    var hintStr = _engBuildSpellingHint(w.word, _engSpellingRevealed);

    area.innerHTML = '<div class="eng-game-header">'
        + '<button class="eng-game-back-btn" onclick="engGameBack()">← Quay lại</button>'
        + '<span class="eng-game-label">✍️ Spelling Bee</span>'
        + '<span class="eng-game-progress">' + (_engGameRound + 1) + '/' + _engGameTotal + '</span>'
        + '</div>'
        + '<div class="eng-spelling-card">'
        + '<div class="eng-spelling-meaning">' + _engEsc(w.meaning) + (w.part_of_speech ? ' <span class="eng-pos">' + _engEsc(w.part_of_speech) + '</span>' : '') + '</div>'
        + '<div class="eng-spelling-hint" id="engSpellingHintDisplay">Gợi ý: <strong>' + hintStr + '</strong> (' + w.word.length + ' chữ cái)</div>'
        + '<input type="text" class="eng-spelling-input" id="engSpellingInput" placeholder="Gõ từ tiếng Anh..." autocomplete="off" autofocus>'
        + '<div class="eng-spelling-feedback" id="engSpellingFeedback"></div>'
        + '<div class="eng-spelling-btns"><button class="eng-btn" id="engSpellingSubmit" onclick="engSpellingCheck()">Kiểm tra</button>'
        + '<button class="eng-game-hint-btn" id="engSpellingHintBtn" onclick="engSpellingHint()">💡 Gợi ý (-5 XP)</button>'
        + '<button class="eng-btn eng-btn-outline" onclick="engSpellingSkip()">Bỏ qua</button></div>'
        + '</div>'
        + '<div class="eng-game-score-bar">Điểm: ' + _engGameScore + '/' + _engGameTotal + '</div>';

    var input = document.getElementById('engSpellingInput');
    if (input) {
        input.focus();
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') engSpellingCheck();
        });
    }
}

function _engBuildSpellingHint(word, revealedIndices) {
    var result = '';
    for (var i = 0; i < word.length; i++) {
        if (revealedIndices.indexOf(i) !== -1) result += word[i];
        else result += ' _';
    }
    return result.trim();
}

function engSpellingHint() {
    // Check if user can use hint
    if (!_engXP.can_hint) {
        showToast('❌ XP đã về 0, không thể dùng gợi ý!', 2000);
        return;
    }
    var pool = _engGameWords.slice(0, Math.min(8, _engGameWords.length));
    var w = pool[_engGameRound];
    if (!w) return;

    var word = w.word;
    var maxRevealed = Math.ceil(word.length * 0.7); // max 70% letters revealed

    if (_engSpellingRevealed.length >= maxRevealed) {
        showToast('Đã gợi ý tối đa!', 1500);
        return;
    }

    // Find a random unrevealed index
    var unrevealed = [];
    for (var i = 0; i < word.length; i++) {
        if (_engSpellingRevealed.indexOf(i) === -1) unrevealed.push(i);
    }
    if (unrevealed.length === 0) return;

    var randIdx = unrevealed[Math.floor(Math.random() * unrevealed.length)];
    _engSpellingRevealed.push(randIdx);

    _engGameHintPenalty += 5;
    engAwardXP('hint_penalty', -5, 0);
    showToast('💡 Gợi ý: -5 XP', 1500);

    var hintStr = _engBuildSpellingHint(word, _engSpellingRevealed);
    var hintEl = document.getElementById('engSpellingHintDisplay');
    if (hintEl) {
        hintEl.innerHTML = 'Gợi ý: <strong style="letter-spacing:3px;color:#fbbf24">' + hintStr + '</strong> (' + word.length + ' chữ cái)';
    }

    // Disable hint button if max reached
    if (_engSpellingRevealed.length >= maxRevealed) {
        var btn = document.getElementById('engSpellingHintBtn');
        if (btn) { btn.disabled = true; btn.textContent = '💡 Hết gợi ý'; }
    }
}

function engSpellingSkip() {
    var pool = _engGameWords.slice(0, Math.min(8, _engGameWords.length));
    var w = pool[_engGameRound];
    var feedback = document.getElementById('engSpellingFeedback');
    if (feedback) {
        feedback.innerHTML = '<span class="eng-spelling-wrong">Đáp án: <strong>' + _engEsc(w.word) + '</strong></span>';
        feedback.className = 'eng-spelling-feedback eng-fb-wrong';
    }
    var input = document.getElementById('engSpellingInput');
    if (input) input.disabled = true;
    // Disable other buttons, change skip to "next"
    var btns = document.querySelector('.eng-spelling-btns');
    if (btns) {
        btns.innerHTML = '<button class="eng-btn" onclick="engSpellingNext()">Câu tiếp theo →</button>';
    }
}

function engSpellingNext() {
    var pool = _engGameWords.slice(0, Math.min(8, _engGameWords.length));
    _engGameRound++;
    engSpellingRound(pool);
}

function engSpellingCheck() {
    var input = document.getElementById('engSpellingInput');
    var feedback = document.getElementById('engSpellingFeedback');
    if (!input || !feedback) return;

    var pool = _engGameWords.slice(0, Math.min(8, _engGameWords.length));
    var w = pool[_engGameRound];
    var answer = input.value.trim().toLowerCase();
    var correct = w.word.toLowerCase();

    if (answer === correct) {
        _engGameScore++;
        input.disabled = true;
        feedback.innerHTML = '<span class="eng-spelling-correct">✅ Chính xác!</span>';
        feedback.className = 'eng-spelling-feedback eng-fb-correct';
        _engReportMastery(w.word, true);
        // Show "next" button
        var btns = document.querySelector('.eng-spelling-btns');
        if (btns) {
            btns.innerHTML = '<button class="eng-btn" onclick="engSpellingNext()">Câu tiếp theo →</button>';
        }
    } else {
        // Wrong - let user try again
        feedback.innerHTML = '<span class="eng-spelling-wrong">❌ Sai rồi! Thử lại...</span>';
        feedback.className = 'eng-spelling-feedback eng-fb-wrong';
        input.value = '';
        input.focus();
    }
}

// ═══════════════════════════════════════
// GAME 3: Word Scramble (xáo chữ cái)
// ═══════════════════════════════════════
var _engScrambleRevealed = [];

function engGameScramble() {
    var pool = _engGameWords.filter(function(w) { return w.word.length >= 4; }).slice(0, Math.min(8, _engGameWords.length));
    if (pool.length < 3) {
        pool = _engGameWords.slice(0, Math.min(8, _engGameWords.length));
    }
    _engGameTotal = pool.length;
    _engGameScore = 0;
    _engGameRound = 0;
    _engScrambleRevealed = [];
    engScrambleRound(pool);
}

function _engScrambleWord(word) {
    var arr = word.split('');
    for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    var scrambled = arr.join('');
    // Make sure it's actually different
    if (scrambled === word && word.length > 1) {
        return word.charAt(word.length - 1) + word.slice(1, -1) + word.charAt(0);
    }
    return scrambled;
}

function _engBuildScrambleHint(word, revealedIndices) {
    var result = '';
    for (var i = 0; i < word.length; i++) {
        if (revealedIndices.indexOf(i) !== -1) result += word[i];
        else result += '_';
    }
    return result;
}

function engScrambleRound(pool) {
    var area = document.getElementById('engGameArea');
    if (!area) return;

    if (_engGameRound >= pool.length) {
        engGameResult();
        return;
    }

    _engScrambleRevealed = [];
    var w = pool[_engGameRound];
    var scrambled = _engScrambleWord(w.word.toLowerCase());

    area.innerHTML = '<div class="eng-game-header">'
        + '<button class="eng-game-back-btn" onclick="engGameBack()">← Quay lại</button>'
        + '<span class="eng-game-label">🔀 Word Scramble</span>'
        + '<span class="eng-game-progress">' + (_engGameRound + 1) + '/' + _engGameTotal + '</span>'
        + '</div>'
        + '<div class="eng-scramble-card">'
        + '<div class="eng-scramble-meaning">💡 ' + _engEsc(w.meaning) + (w.part_of_speech ? ' <span class="eng-pos">' + _engEsc(w.part_of_speech) + '</span>' : '') + '</div>'
        + '<div class="eng-scramble-letters">' + scrambled.split('').map(function(c) {
            return '<span class="eng-scramble-letter">' + c.toUpperCase() + '</span>';
        }).join('') + '</div>'
        + '<div class="eng-scramble-hint-display" id="engScrambleHintDisplay" style="display:none"></div>'
        + '<input type="text" class="eng-spelling-input" id="engScrambleInput" placeholder="Sắp xếp lại thành từ đúng..." autocomplete="off" autofocus>'
        + '<div class="eng-spelling-feedback" id="engScrambleFeedback"></div>'
        + '<div class="eng-scramble-btns">'
        + '<button class="eng-btn" onclick="engScrambleCheck()">Kiểm tra</button>'
        + '<button class="eng-game-hint-btn" id="engScrambleHintBtn" onclick="engScrambleHint()">💡 Gợi ý (-5 XP)</button>'
        + '<button class="eng-btn eng-btn-outline" onclick="engScrambleSkip()">Bỏ qua</button>'
        + '</div>'
        + '</div>'
        + '<div class="eng-game-score-bar">Điểm: ' + _engGameScore + '/' + _engGameTotal + '</div>';

    var input = document.getElementById('engScrambleInput');
    if (input) {
        input.focus();
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') engScrambleCheck();
        });
    }
}

function engScrambleHint() {
    // Check if user can use hint
    if (!_engXP.can_hint) {
        showToast('❌ XP đã về 0, không thể dùng gợi ý!', 2000);
        return;
    }
    var pool = _engGameWords.filter(function(w) { return w.word.length >= 4; }).slice(0, Math.min(8, _engGameWords.length));
    if (pool.length < 3) pool = _engGameWords.slice(0, Math.min(8, _engGameWords.length));
    var w = pool[_engGameRound];
    if (!w) return;

    var word = w.word;
    var maxRevealed = Math.ceil(word.length * 0.7);

    if (_engScrambleRevealed.length >= maxRevealed) {
        showToast('Đã gợi ý tối đa!', 1500);
        return;
    }

    // Reveal next letter in order (from left to right)
    var nextIdx = _engScrambleRevealed.length;
    _engScrambleRevealed.push(nextIdx);

    _engGameHintPenalty += 5;
    engAwardXP('hint_penalty', -5, 0);
    showToast('💡 Gợi ý: -5 XP', 1500);

    var hintStr = _engBuildScrambleHint(word, _engScrambleRevealed);
    var hintEl = document.getElementById('engScrambleHintDisplay');
    if (hintEl) {
        hintEl.style.display = '';
        hintEl.innerHTML = '🔑 Vị trí đúng: <strong style="letter-spacing:3px;color:#fbbf24">' + hintStr.split('').map(function(c) {
            return c === '_' ? '·' : c.toUpperCase();
        }).join(' ') + '</strong>';
    }

    // Disable hint button if max reached
    if (_engScrambleRevealed.length >= maxRevealed) {
        var btn = document.getElementById('engScrambleHintBtn');
        if (btn) { btn.disabled = true; btn.textContent = '💡 Hết gợi ý'; }
    }
}

function engScrambleCheck() {
    var input = document.getElementById('engScrambleInput');
    var feedback = document.getElementById('engScrambleFeedback');
    if (!input || !feedback) return;

    var pool = _engGameWords.filter(function(w) { return w.word.length >= 4; }).slice(0, Math.min(8, _engGameWords.length));
    if (pool.length < 3) pool = _engGameWords.slice(0, Math.min(8, _engGameWords.length));
    var w = pool[_engGameRound];
    var answer = input.value.trim().toLowerCase();
    var correct = w.word.toLowerCase();

    if (answer === correct) {
        _engGameScore++;
        input.disabled = true;
        feedback.innerHTML = '<span class="eng-spelling-correct">✅ Chính xác!</span>';
        feedback.className = 'eng-spelling-feedback eng-fb-correct';
        _engReportMastery(w.word, true);
        // Show "next" button
        var btns = document.querySelector('.eng-scramble-btns');
        if (btns) {
            btns.innerHTML = '<button class="eng-btn" onclick="engScrambleNext()">Câu tiếp theo →</button>';
        }
    } else {
        // Wrong - let user try again
        feedback.innerHTML = '<span class="eng-spelling-wrong">❌ Sai rồi! Thử lại...</span>';
        feedback.className = 'eng-spelling-feedback eng-fb-wrong';
        input.value = '';
        input.focus();
    }
}

function engScrambleSkip() {
    var pool = _engGameWords.filter(function(w) { return w.word.length >= 4; }).slice(0, Math.min(8, _engGameWords.length));
    if (pool.length < 3) pool = _engGameWords.slice(0, Math.min(8, _engGameWords.length));
    var w = pool[_engGameRound];
    var feedback = document.getElementById('engScrambleFeedback');
    if (feedback) {
        feedback.innerHTML = '<span class="eng-spelling-wrong">Đáp án: <strong>' + _engEsc(w.word) + '</strong></span>';
        feedback.className = 'eng-spelling-feedback eng-fb-wrong';
    }
    var input = document.getElementById('engScrambleInput');
    if (input) input.disabled = true;
    // Change buttons to "next"
    var btns = document.querySelector('.eng-scramble-btns');
    if (btns) {
        btns.innerHTML = '<button class="eng-btn" onclick="engScrambleNext()">Câu tiếp theo →</button>';
    }
}

function engScrambleNext() {
    var pool = _engGameWords.filter(function(w) { return w.word.length >= 4; }).slice(0, Math.min(8, _engGameWords.length));
    if (pool.length < 3) pool = _engGameWords.slice(0, Math.min(8, _engGameWords.length));
    _engGameRound++;
    engScrambleRound(pool);
}
