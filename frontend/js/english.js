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
        if (this.value === 'pick') {
            wrap.style.display = '';
            _engLoadWordPicker(wrap, 'review');
        } else {
            wrap.style.display = 'none';
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
        if (this.checked) {
            wrap.style.display = '';
            _engLoadWordPicker(wrap, 'quiz');
        } else {
            wrap.style.display = 'none';
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
