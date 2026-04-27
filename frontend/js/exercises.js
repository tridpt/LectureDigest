/* ════════════════════════════════════════════════
   LectureDigest — Exercises Module
   Fill-in-the-Blank, True/False, Matching, Short Answer
   ════════════════════════════════════════════════ */

var _exercises = {
    data: null,           // { fill_blank: [], true_false: [], matching: [], short_answer: [] }
    activeTab: 'fill_blank',
    answers: {},          // { type_index: value }
    checked: {},          // { type_index: true/false }
    score: { total: 0, correct: 0 },
    loading: false,
    generated: false
};

// ── Generate exercises from Gemini ──
async function generateExercises() {
    if (!analysisData) { showToast('Hãy analyze video trước!'); return; }

    var btn = document.getElementById('exGenBtn');
    var container = document.getElementById('exContent');

    // Get transcript
    var transcript = analysisData.transcript;
    if (!transcript || !transcript.length) {
        var histEntry = loadHistory().find(function(h) { return h.video_id === analysisData.video_id; });
        transcript = (histEntry && histEntry.transcript) || (histEntry && histEntry.data && histEntry.data.transcript);
    }
    if (!transcript || !transcript.length) {
        try {
            transcript = await fetchTranscriptClientSide(analysisData.video_id);
            analysisData.transcript = transcript;
        } catch (e) {
            showToast('Không lấy được transcript!', 3000);
            return;
        }
    }

    _exercises.loading = true;
    _exercises.answers = {};
    _exercises.checked = {};
    _exercises.score = { total: 0, correct: 0 };

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> Đang tạo bài tập...';
    }
    if (container) container.innerHTML = '<div class="ex-loading"><div class="ex-loading-spinner"></div><p>AI đang tạo bài tập đa dạng...</p></div>';

    // Show tabs area
    var tabBar = document.getElementById('exTabBar');
    if (tabBar) tabBar.classList.add('hidden');

    try {
        var res = await fetch(API_BASE + '/api/exercises', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: analysisData.title || '',
                transcript: transcript,
                topics: (analysisData.topics || []).map(function(t) { return { title: t.title, summary: t.summary }; }),
                key_takeaways: analysisData.key_takeaways || [],
                output_language: selectedLang || 'Vietnamese'
            })
        });

        if (!res.ok) {
            var err = await res.json().catch(function() { return { detail: 'Server error' }; });
            throw new Error(err.detail || 'Lỗi server');
        }

        _exercises.data = await res.json();
        _exercises.generated = true;
        _exercises.activeTab = 'fill_blank';
        _exercises.loading = false;

        // Show tab bar
        if (tabBar) tabBar.classList.remove('hidden');
        _exUpdateTabCounts();
        _exRenderTab('fill_blank');

        showToast('✅ Đã tạo bài tập thành công!');

    } catch (err) {
        _exercises.loading = false;
        if (container) container.innerHTML = '<div class="ex-error"><p>❌ ' + escHtml(err.message) + '</p><button class="ex-retry-btn" onclick="generateExercises()">Thử lại</button></div>';
        showToast('Lỗi: ' + err.message, 3000);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 4v16m8-8H4" stroke-linecap="round" stroke-linejoin="round"/></svg> Tạo bài tập mới';
        }
    }
}

// ── Tab switching ──
function exSwitchTab(tab) {
    _exercises.activeTab = tab;
    document.querySelectorAll('.ex-tab').forEach(function(t) {
        t.classList.toggle('active', t.dataset.tab === tab);
    });
    _exRenderTab(tab);
}

function _exUpdateTabCounts() {
    var d = _exercises.data;
    if (!d) return;
    var counts = {
        fill_blank: (d.fill_blank || []).length,
        true_false: (d.true_false || []).length,
        matching: (d.matching || []).length,
        short_answer: (d.short_answer || []).length
    };
    for (var key in counts) {
        var badge = document.querySelector('.ex-tab[data-tab="' + key + '"] .ex-tab-count');
        if (badge) badge.textContent = counts[key];
    }
}

// ── Render active tab ──
function _exRenderTab(tab) {
    var container = document.getElementById('exContent');
    if (!container || !_exercises.data) return;

    switch (tab) {
        case 'fill_blank':  _exRenderFillBlank(container); break;
        case 'true_false':  _exRenderTrueFalse(container); break;
        case 'matching':    _exRenderMatching(container); break;
        case 'short_answer': _exRenderShortAnswer(container); break;
    }
}

// ══════════════════════════════════════════════
// FILL IN THE BLANK
// ══════════════════════════════════════════════
function _exRenderFillBlank(container) {
    var items = _exercises.data.fill_blank || [];
    if (!items.length) { container.innerHTML = '<div class="ex-empty">Không có bài tập điền từ</div>'; return; }

    var html = '<div class="ex-section">';
    html += '<div class="ex-section-header"><span class="ex-section-icon">✏️</span><h4>Điền từ vào chỗ trống</h4><span class="ex-section-hint">Điền từ đúng vào ô trống</span></div>';

    items.forEach(function(item, i) {
        var key = 'fb_' + i;
        var userAnswer = _exercises.answers[key] || '';
        var isChecked = _exercises.checked[key];
        var isCorrect = isChecked && userAnswer.trim().toLowerCase() === item.answer.trim().toLowerCase();

        // Replace ____ with input
        var sentence = escHtml(item.sentence).replace(/_{3,}/g, function() {
            var inputCls = 'ex-blank-input';
            if (isChecked) inputCls += isCorrect ? ' correct' : ' wrong';
            return '<input type="text" class="' + inputCls + '" ' +
                'id="fb_input_' + i + '" ' +
                'value="' + escHtml(userAnswer) + '" ' +
                'placeholder="..." ' +
                'oninput="_exFbInput(' + i + ', this.value)" ' +
                'onkeydown="if(event.key===\'Enter\')_exCheckFb(' + i + ')" ' +
                (isChecked ? 'disabled' : '') + '>';
        });

        html += '<div class="ex-item ex-fb-item' + (isChecked ? (isCorrect ? ' checked-correct' : ' checked-wrong') : '') + '">';
        html += '<div class="ex-item-num">' + (i + 1) + '</div>';
        html += '<div class="ex-item-body">';
        html += '<div class="ex-fb-sentence">' + sentence + '</div>';

        if (item.hint) {
            html += '<div class="ex-hint">💡 Gợi ý: ' + escHtml(item.hint) + '</div>';
        }

        if (isChecked) {
            html += '<div class="ex-feedback ' + (isCorrect ? 'correct' : 'wrong') + '">';
            html += isCorrect ? '✅ Chính xác!' : '❌ Sai — Đáp án: <strong>' + escHtml(item.answer) + '</strong>';
            if (item.explanation) html += '<div class="ex-fb-explain">' + escHtml(item.explanation) + '</div>';
            html += '</div>';
        } else {
            html += '<button class="ex-check-btn" onclick="_exCheckFb(' + i + ')">Kiểm tra</button>';
        }

        html += '</div></div>';
    });

    html += '</div>';
    container.innerHTML = html;
}

function _exFbInput(idx, value) {
    _exercises.answers['fb_' + idx] = value;
}

function _exCheckFb(idx) {
    var key = 'fb_' + idx;
    var item = _exercises.data.fill_blank[idx];
    if (!item || _exercises.checked[key]) return;

    var userAnswer = (_exercises.answers[key] || '').trim();
    if (!userAnswer) {
        var input = document.getElementById('fb_input_' + idx);
        if (input) input.focus();
        return;
    }

    _exercises.checked[key] = true;
    var isCorrect = userAnswer.toLowerCase() === item.answer.trim().toLowerCase();
    _exercises.score.total++;
    if (isCorrect) _exercises.score.correct++;

    _exRenderFillBlank(document.getElementById('exContent'));
    _exUpdateScoreBadge();
}

// ══════════════════════════════════════════════
// TRUE / FALSE
// ══════════════════════════════════════════════
function _exRenderTrueFalse(container) {
    var items = _exercises.data.true_false || [];
    if (!items.length) { container.innerHTML = '<div class="ex-empty">Không có bài tập đúng/sai</div>'; return; }

    var html = '<div class="ex-section">';
    html += '<div class="ex-section-header"><span class="ex-section-icon">⚖️</span><h4>Đúng hay Sai?</h4><span class="ex-section-hint">Chọn Đúng hoặc Sai cho mỗi câu</span></div>';

    items.forEach(function(item, i) {
        var key = 'tf_' + i;
        var userAnswer = _exercises.answers[key]; // true / false / undefined
        var isChecked = _exercises.checked[key];
        var isCorrect = isChecked && userAnswer === item.answer;

        html += '<div class="ex-item ex-tf-item' + (isChecked ? (isCorrect ? ' checked-correct' : ' checked-wrong') : '') + '">';
        html += '<div class="ex-item-num">' + (i + 1) + '</div>';
        html += '<div class="ex-item-body">';
        html += '<div class="ex-tf-statement">' + escHtml(item.statement) + '</div>';

        // True/False buttons
        html += '<div class="ex-tf-buttons">';
        var trueCls = 'ex-tf-btn ex-tf-true';
        var falseCls = 'ex-tf-btn ex-tf-false';
        if (isChecked) {
            if (item.answer === true) trueCls += ' reveal-correct';
            if (item.answer === false) falseCls += ' reveal-correct';
            if (userAnswer === true && !isCorrect) trueCls += ' wrong';
            if (userAnswer === false && !isCorrect) falseCls += ' wrong';
            if (userAnswer === true && isCorrect) trueCls += ' correct';
            if (userAnswer === false && isCorrect) falseCls += ' correct';
        } else {
            if (userAnswer === true) trueCls += ' selected';
            if (userAnswer === false) falseCls += ' selected';
        }

        html += '<button class="' + trueCls + '" onclick="_exTfSelect(' + i + ', true)" ' + (isChecked ? 'disabled' : '') + '>';
        html += '<span class="ex-tf-icon">✓</span> Đúng</button>';
        html += '<button class="' + falseCls + '" onclick="_exTfSelect(' + i + ', false)" ' + (isChecked ? 'disabled' : '') + '>';
        html += '<span class="ex-tf-icon">✗</span> Sai</button>';
        html += '</div>';

        if (isChecked) {
            html += '<div class="ex-feedback ' + (isCorrect ? 'correct' : 'wrong') + '">';
            html += isCorrect ? '✅ Chính xác!' : '❌ Sai — Đáp án: <strong>' + (item.answer ? 'Đúng' : 'Sai') + '</strong>';
            if (item.explanation) html += '<div class="ex-fb-explain">' + escHtml(item.explanation) + '</div>';
            html += '</div>';
        }

        html += '</div></div>';
    });

    html += '</div>';
    container.innerHTML = html;
}

function _exTfSelect(idx, value) {
    var key = 'tf_' + idx;
    if (_exercises.checked[key]) return;

    _exercises.answers[key] = value;
    _exercises.checked[key] = true;
    var item = _exercises.data.true_false[idx];
    var isCorrect = value === item.answer;
    _exercises.score.total++;
    if (isCorrect) _exercises.score.correct++;

    _exRenderTrueFalse(document.getElementById('exContent'));
    _exUpdateScoreBadge();
}

// ══════════════════════════════════════════════
// MATCHING
// ══════════════════════════════════════════════
function _exRenderMatching(container) {
    var items = _exercises.data.matching || [];
    if (!items.length) { container.innerHTML = '<div class="ex-empty">Không có bài tập nối cặp</div>'; return; }

    var html = '<div class="ex-section">';
    html += '<div class="ex-section-header"><span class="ex-section-icon">🔗</span><h4>Nối cặp</h4><span class="ex-section-hint">Kéo thả hoặc chọn để nối thuật ngữ với định nghĩa</span></div>';

    // Check if already completed
    var isAllChecked = _exercises.checked['match_all'];

    // Left column: terms (fixed order), Right column: definitions (shuffled)
    var terms = items.map(function(item, i) { return { idx: i, term: item.term }; });

    // Build shuffled definitions if not already stored
    if (!_exercises._matchShuffle) {
        _exercises._matchShuffle = items.map(function(item, i) { return { idx: i, definition: item.definition }; });
        // Shuffle
        for (var i = _exercises._matchShuffle.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var temp = _exercises._matchShuffle[i];
            _exercises._matchShuffle[i] = _exercises._matchShuffle[j];
            _exercises._matchShuffle[j] = temp;
        }
    }
    var defs = _exercises._matchShuffle;

    html += '<div class="ex-match-container">';

    // Terms column
    html += '<div class="ex-match-col ex-match-terms">';
    terms.forEach(function(t) {
        var selected = _exercises._matchSelected === t.idx;
        var matched = _exercises.answers['match_' + t.idx] !== undefined;
        var matchedDef = matched ? _exercises.answers['match_' + t.idx] : null;
        var cls = 'ex-match-card ex-match-term';
        if (selected) cls += ' selected';
        if (matched) cls += ' matched';
        if (isAllChecked) {
            cls += matchedDef === t.idx ? ' correct' : ' wrong';
        }

        html += '<div class="' + cls + '" data-term="' + t.idx + '" onclick="_exMatchSelectTerm(' + t.idx + ')">';
        html += '<span class="ex-match-letter">' + String.fromCharCode(65 + t.idx) + '</span>';
        html += '<span>' + escHtml(t.term) + '</span>';
        if (matched && !isAllChecked) {
            html += '<span class="ex-match-linked">→ ' + (matchedDef + 1) + '</span>';
        }
        html += '</div>';
    });
    html += '</div>';

    // Definitions column
    html += '<div class="ex-match-col ex-match-defs">';
    defs.forEach(function(d, di) {
        var matchedBy = null;
        for (var k in _exercises.answers) {
            if (k.startsWith('match_') && _exercises.answers[k] === d.idx) {
                matchedBy = parseInt(k.replace('match_', ''));
                break;
            }
        }
        var cls = 'ex-match-card ex-match-def';
        if (matchedBy !== null) cls += ' matched';
        if (isAllChecked && matchedBy !== null) {
            cls += matchedBy === d.idx ? ' correct' : ' wrong';
        }

        html += '<div class="' + cls + '" data-def="' + d.idx + '" onclick="_exMatchSelectDef(' + d.idx + ')">';
        html += '<span class="ex-match-num">' + (di + 1) + '</span>';
        html += '<span>' + escHtml(d.definition) + '</span>';
        if (matchedBy !== null && !isAllChecked) {
            html += '<span class="ex-match-linked">← ' + String.fromCharCode(65 + matchedBy) + '</span>';
        }
        html += '</div>';
    });
    html += '</div>';

    html += '</div>'; // match-container

    // Action buttons
    html += '<div class="ex-match-actions">';
    if (!isAllChecked) {
        var matchedCount = Object.keys(_exercises.answers).filter(function(k) { return k.startsWith('match_'); }).length;
        html += '<button class="ex-check-btn ex-match-check" onclick="_exCheckMatching()" ' + (matchedCount < items.length ? 'disabled' : '') + '>Kiểm tra tất cả</button>';
        html += '<button class="ex-reset-btn" onclick="_exResetMatching()">Làm lại</button>';
    } else {
        // Show results
        var correct = 0;
        items.forEach(function(item, i) {
            if (_exercises.answers['match_' + i] === i) correct++;
        });
        html += '<div class="ex-match-result">';
        html += '<span class="ex-match-score">' + correct + '/' + items.length + ' cặp đúng</span>';
        html += '<button class="ex-reset-btn" onclick="_exResetMatching()">Làm lại</button>';
        html += '</div>';
    }
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;
}

function _exMatchSelectTerm(idx) {
    if (_exercises.checked['match_all']) return;
    _exercises._matchSelected = idx;
    _exRenderMatching(document.getElementById('exContent'));
}

function _exMatchSelectDef(defIdx) {
    if (_exercises.checked['match_all']) return;
    var termIdx = _exercises._matchSelected;
    if (termIdx === undefined || termIdx === null) return;

    // Remove any previous match for this term
    delete _exercises.answers['match_' + termIdx];
    // Remove any previous match to this definition
    for (var k in _exercises.answers) {
        if (k.startsWith('match_') && _exercises.answers[k] === defIdx) {
            delete _exercises.answers[k];
        }
    }

    _exercises.answers['match_' + termIdx] = defIdx;
    _exercises._matchSelected = null;
    _exRenderMatching(document.getElementById('exContent'));
}

function _exCheckMatching() {
    var items = _exercises.data.matching || [];
    _exercises.checked['match_all'] = true;

    var correct = 0;
    items.forEach(function(item, i) {
        if (_exercises.answers['match_' + i] === i) correct++;
    });
    _exercises.score.total += items.length;
    _exercises.score.correct += correct;
    _exUpdateScoreBadge();
    _exRenderMatching(document.getElementById('exContent'));
}

function _exResetMatching() {
    // Clear matching answers
    for (var k in _exercises.answers) {
        if (k.startsWith('match_')) delete _exercises.answers[k];
    }
    delete _exercises.checked['match_all'];
    _exercises._matchSelected = null;
    _exercises._matchShuffle = null; // re-shuffle
    _exRenderMatching(document.getElementById('exContent'));
}

// ══════════════════════════════════════════════
// SHORT ANSWER
// ══════════════════════════════════════════════
function _exRenderShortAnswer(container) {
    var items = _exercises.data.short_answer || [];
    if (!items.length) { container.innerHTML = '<div class="ex-empty">Không có bài tập tự luận</div>'; return; }

    var html = '<div class="ex-section">';
    html += '<div class="ex-section-header"><span class="ex-section-icon">📝</span><h4>Tự luận ngắn</h4><span class="ex-section-hint">Viết câu trả lời rồi xem đáp án mẫu</span></div>';

    items.forEach(function(item, i) {
        var key = 'sa_' + i;
        var userAnswer = _exercises.answers[key] || '';
        var isRevealed = _exercises.checked[key];

        html += '<div class="ex-item ex-sa-item">';
        html += '<div class="ex-item-num">' + (i + 1) + '</div>';
        html += '<div class="ex-item-body">';
        html += '<div class="ex-sa-question">' + escHtml(item.question) + '</div>';

        if (item.hint) {
            html += '<div class="ex-hint">💡 Gợi ý: ' + escHtml(item.hint) + '</div>';
        }

        html += '<textarea class="ex-sa-textarea" id="sa_input_' + i + '" ' +
            'placeholder="Nhập câu trả lời của bạn..." ' +
            'oninput="_exSaInput(' + i + ', this.value)" ' +
            (isRevealed ? 'disabled' : '') + '>' + escHtml(userAnswer) + '</textarea>';

        if (isRevealed) {
            html += '<div class="ex-sa-model-answer">';
            html += '<div class="ex-sa-label">📋 Đáp án mẫu:</div>';
            html += '<div class="ex-sa-answer-text">' + escHtml(item.model_answer) + '</div>';
            if (item.key_points && item.key_points.length) {
                html += '<div class="ex-sa-keypoints"><strong>Điểm chính cần có:</strong><ul>';
                item.key_points.forEach(function(kp) {
                    html += '<li>' + escHtml(kp) + '</li>';
                });
                html += '</ul></div>';
            }
            html += '</div>';

            // Self-assessment
            html += '<div class="ex-sa-self-assess">';
            html += '<span class="ex-sa-assess-label">Tự đánh giá:</span>';
            var selfScore = _exercises.answers['sa_score_' + i];
            ['bad', 'ok', 'good'].forEach(function(level) {
                var labels = { bad: '😟 Chưa tốt', ok: '🙂 Tạm ổn', good: '🎉 Tốt lắm' };
                var cls = 'ex-sa-assess-btn' + (selfScore === level ? ' active' : '');
                html += '<button class="' + cls + '" onclick="_exSaSelfScore(' + i + ',\'' + level + '\')">' + labels[level] + '</button>';
            });
            html += '</div>';
        } else {
            html += '<button class="ex-check-btn ex-reveal-btn" onclick="_exRevealSa(' + i + ')" ' + (!userAnswer.trim() ? 'disabled' : '') + '>';
            html += '👁 Xem đáp án mẫu</button>';
        }

        html += '</div></div>';
    });

    html += '</div>';
    container.innerHTML = html;
}

function _exSaInput(idx, value) {
    _exercises.answers['sa_' + idx] = value;
    // Enable/disable reveal button
    var btn = document.querySelector('.ex-sa-item:nth-child(' + (idx + 1) + ') .ex-reveal-btn');
    if (btn) btn.disabled = !value.trim();
}

function _exRevealSa(idx) {
    _exercises.checked['sa_' + idx] = true;
    _exRenderShortAnswer(document.getElementById('exContent'));
}

function _exSaSelfScore(idx, score) {
    _exercises.answers['sa_score_' + idx] = score;
    if (score === 'good') {
        _exercises.score.total++;
        _exercises.score.correct++;
    } else if (score === 'ok') {
        _exercises.score.total++;
        _exercises.score.correct += 0.5;
    } else {
        _exercises.score.total++;
    }
    _exUpdateScoreBadge();
    _exRenderShortAnswer(document.getElementById('exContent'));
}

// ── Score badge ──
function _exUpdateScoreBadge() {
    var badge = document.getElementById('exScoreBadge');
    if (badge) {
        var s = _exercises.score;
        if (s.total > 0) {
            badge.textContent = Math.round(s.correct) + '/' + s.total;
            badge.classList.remove('hidden');
        }
    }
}
