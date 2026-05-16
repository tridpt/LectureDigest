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

function openEnglish() {
    showSection('englishSection');
    engLoadStats();
    engLoadToday();
    var footer = document.querySelector('.footer');
    if (footer) footer.style.display = 'none';
}

function closeEnglish() {
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
        return '<div class="eng-word-card">'
            + '<div class="eng-word-header"><strong>' + _engEsc(w.word) + '</strong><span class="eng-phonetic">' + _engEsc(w.phonetic) + '</span></div>'
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
    } catch(e) { showToast('Lỗi: ' + e.message, 3000); }
    finally { if (btn) { btn.disabled = false; btn.textContent = '✨ Tạo từ vựng'; } }
}

// ── Saved words with pagination ──
var _engSavedPage = 1;

async function engLoadSavedWords(page) {
    var headers = _engHeaders();
    if (!headers) return;
    _engSavedPage = page || 1;

    try {
        var res = await fetchWithTimeout('/api/english/all?page=' + _engSavedPage + '&per_page=15', { headers: headers }, 10000);
        if (!res.ok) return;
        var data = await res.json();
        engRenderSavedList(data.words || [], data.total, data.page, data.total_pages);
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

    el.innerHTML = words.map(function(w) {
        return '<div class="eng-saved-item">'
            + '<strong>' + _engEsc(w.word) + '</strong>'
            + '<span class="eng-saved-meaning">' + _engEsc(w.meaning) + '</span>'
            + '<span class="eng-saved-topic">' + _engEsc(w.topic) + '</span>'
            + '</div>';
    }).join('');

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
    var headers = _engHeaders();
    if (!headers) return;
    try {
        var res = await fetchWithTimeout('/api/english/review', { headers: headers }, 10000);
        if (!res.ok) return;
        var data = await res.json();
        _engReviewWords = data.words || [];
        if (_engReviewWords.length === 0) {
            showToast('Không có từ nào cần ôn tập!', 2000);
            return;
        }
        _engReviewIdx = 0;
        _engFlipped = false;
        engShowTab('review');
        engRenderReviewCard();
    } catch(e) {}
}

function engRenderReviewCard() {
    var el = document.getElementById('engReviewArea');
    if (!el || _engReviewIdx >= _engReviewWords.length) {
        if (el) el.innerHTML = '<div class="eng-empty">🎉 Hoàn thành ôn tập!</div>';
        return;
    }
    var w = _engReviewWords[_engReviewIdx];
    el.innerHTML = '<div class="eng-review-card" onclick="engFlipCard()">'
        + '<div class="eng-review-front' + (_engFlipped ? ' eng-hidden' : '') + '">'
        + '<div class="eng-review-word">' + _engEsc(w.word) + '</div>'
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
    _engReviewIdx++;
    _engFlipped = false;
    engRenderReviewCard();
    if (_engReviewIdx >= _engReviewWords.length) {
        engLoadStats();
    }
}

// ── Quiz ──
async function engStartQuiz() {
    var headers = _engHeaders();
    if (!headers) return;
    try {
        var res = await fetchWithTimeout('/api/english/quiz', { method: 'POST', headers: headers }, 10000);
        if (!res.ok) {
            var err = await res.json().catch(function() { return {}; });
            showToast(err.detail || 'Lỗi', 3000);
            return;
        }
        var data = await res.json();
        _engQuiz = data.questions || [];
        _engQuizIdx = 0;
        _engQuizScore = 0;
        engShowTab('quiz');
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
        return;
    }
    var q = _engQuiz[_engQuizIdx];
    var html = '<div class="eng-quiz-card">'
        + '<div class="eng-quiz-word">' + _engEsc(q.word) + '</div>'
        + '<div class="eng-quiz-prompt">Nghĩa là gì?</div>'
        + '<div class="eng-quiz-options">';
    q.options.forEach(function(opt, i) {
        html += '<button class="eng-quiz-opt" onclick="engAnswer(' + i + ',' + q.correct_index + ')">' + _engEsc(opt) + '</button>';
    });
    html += '</div><div class="eng-quiz-progress">Câu ' + (_engQuizIdx + 1) + '/' + _engQuiz.length + '</div></div>';
    el.innerHTML = html;
}

function engAnswer(selected, correct) {
    if (selected === correct) _engQuizScore++;
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
    ['words', 'saved', 'review', 'quiz'].forEach(function(t) {
        var panel = document.getElementById('engPanel_' + t);
        var btn = document.getElementById('engTab_' + t);
        if (panel) panel.style.display = t === tab ? '' : 'none';
        if (btn) btn.classList.toggle('eng-tab-active', t === tab);
    });
}

function _engEsc(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
