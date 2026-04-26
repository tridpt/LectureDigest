/* ════════════════════════════════════════════════
   LectureDigest — Multi-Video Exam
   ════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════
// MULTI-VIDEO EXAM
// ══════════════════════════════════════════════════════

var _mexam = {
    selectedVideos: [],
    examData: null,
    currentQ: 0,
    answers: {},        // { questionId: selectedIndex }
    submitted: false,
    timerInterval: null,
    startTime: 0,
    elapsed: 0
};

function openMexam() {
    document.getElementById('mexamSection').classList.remove('hidden');
    _mexam.selectedVideos = [];
    _mexam.examData = null;
    _mexam.currentQ = 0;
    _mexam.answers = {};
    _mexam.submitted = false;
    _mexamStopTimer();
    _mexamSwitchTab('new');
    _mexamRenderVideoList();
    _mexamUpdateHistCount();
}

function closeMexam() {
    document.getElementById('mexamSection').classList.add('hidden');
    _mexamStopTimer();
}

function _mexamShowStep(n) {
    for (var i = 1; i <= 5; i++) {
        var el = document.getElementById('mexamStep' + i);
        if (el) el.classList.toggle('hidden', i !== n);
    }
    // Hide tabs during exam/loading/results
    var tabs = document.getElementById('mexamTabs');
    if (tabs) tabs.style.display = (n <= 1 || n === 5) ? 'flex' : 'none';
}

function _mexamRenderVideoList() {
    var history = [];
    try { history = JSON.parse(localStorage.getItem('lectureDigest_history') || '[]'); } catch(e) {}

    // Deduplicate by video_id, keep newest
    var seen = {};
    var unique = [];
    history.forEach(function(h) {
        if (!seen[h.video_id]) {
            seen[h.video_id] = true;
            unique.push(h);
        }
    });

    var container = document.getElementById('mexamVideoList');
    if (unique.length < 2) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary)">Cần ít nhất 2 video trong lịch sử để tạo đề thi.<br>Hãy phân tích thêm video trước.</div>';
        return;
    }

    container.innerHTML = unique.map(function(h, i) {
        var topicCount = (h.data && h.data.topics) ? h.data.topics.length : 0;
        var topicNames = topicCount > 0 ? h.data.topics.slice(0, 3).map(function(t) { return t.title || ''; }).join(', ') : '';
        return '<div class="mexam-video-item" data-idx="' + i + '" onclick="_mexamToggleVideo(' + i + ')">' +
            '<div class="mexam-video-check">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" width="14" height="14"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</div>' +
            '<img class="mexam-video-thumb" src="' + (h.thumbnail || '') + '" alt="" loading="lazy">' +
            '<div class="mexam-video-info">' +
                '<div class="mexam-video-name">' + escHtml(h.title || 'Untitled') + '</div>' +
                '<div class="mexam-video-meta">' + escHtml(h.author || '') + ' · ' + topicCount + ' chủ đề</div>' +
                (topicNames ? '<div class="mexam-video-topics">' + escHtml(topicNames) + '</div>' : '') +
            '</div>' +
        '</div>';
    }).join('');

    // Store reference to unique list
    _mexam._uniqueHistory = unique;
    _mexamUpdateCount();
}

function _mexamToggleVideo(idx) {
    var pos = _mexam.selectedVideos.indexOf(idx);
    if (pos >= 0) {
        _mexam.selectedVideos.splice(pos, 1);
    } else {
        _mexam.selectedVideos.push(idx);
    }
    // Update UI
    var items = document.querySelectorAll('.mexam-video-item');
    items.forEach(function(el) {
        var i = parseInt(el.getAttribute('data-idx'));
        el.classList.toggle('selected', _mexam.selectedVideos.indexOf(i) >= 0);
    });
    _mexamUpdateCount();
}

function _mexamUpdateCount() {
    var count = _mexam.selectedVideos.length;
    var el = document.getElementById('mexamCount');
    if (el) el.textContent = count + ' đã chọn';
    var btn = document.getElementById('mexamGenerateBtn');
    if (btn) btn.disabled = count < 2;
    var sub = document.getElementById('mexamSubtitle');
    if (sub) sub.textContent = count < 2 ? 'Chọn ít nhất 2 video' : count + ' video đã chọn';
}

async function generateMexam() {
    if (_mexam.selectedVideos.length < 2) return;

    var videos = _mexam.selectedVideos.map(function(idx) {
        var h = _mexam._uniqueHistory[idx];
        var d = h.data || {};
        return {
            title: h.title || d.title || 'Untitled',
            overview: d.overview || '',
            topics: (d.topics || []).map(function(t) {
                return { title: t.title || '', summary: t.summary || '' };
            }),
            key_takeaways: d.key_takeaways || []
        };
    });

    var numQ = parseInt(document.getElementById('mexamNumQ').value) || 20;
    var lang = selectedLang || 'Vietnamese';

    _mexamShowStep(2);

    try {
        var res = await fetch('/api/multi-exam', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                videos: videos,
                num_questions: numQ,
                output_language: lang
            })
        });

        if (!res.ok) {
            var err = await res.json().catch(function() { return { detail: 'Server error' }; });
            throw new Error(err.detail || 'Lỗi server');
        }

        _mexam.examData = await res.json();
        _mexam.currentQ = 0;
        _mexam.answers = {};
        _mexam.submitted = false;
        _mexamStartTimer();
        _mexamShowStep(3);
        _mexamRenderQuestion();

        var titleEl = document.getElementById('mexamExamTitle');
        if (titleEl) titleEl.textContent = _mexam.examData.exam_title || 'Đề thi tổng hợp';
        document.getElementById('mexamSubtitle').textContent =
            _mexam.examData.questions.length + ' câu hỏi · ' + _mexam.examData.video_count + ' video';

    } catch(err) {
        _mexamShowStep(1);
        showToast('Lỗi: ' + err.message, 'error');
    }
}

function _mexamRenderQuestion() {
    var questions = _mexam.examData.questions;
    var q = questions[_mexam.currentQ];
    if (!q) return;

    var total = questions.length;
    var idx = _mexam.currentQ;

    // Update progress
    document.getElementById('mexamQProgress').textContent = (idx + 1) + ' / ' + total;
    document.getElementById('mexamProgressFill').style.width = ((idx + 1) / total * 100) + '%';

    // Badges
    var badges = '';
    var diff = (q.difficulty || 'medium').toLowerCase();
    badges += '<span class="mexam-badge mexam-badge-' + diff + '">' + diff + '</span>';
    if (q.is_cross_video) {
        badges += '<span class="mexam-badge mexam-badge-cross">⚡ Cross-Video</span>';
    }
    if (q.source && q.source.length) {
        q.source.forEach(function(s) {
            var short = s.length > 25 ? s.substring(0, 25) + '…' : s;
            badges += '<span class="mexam-badge mexam-badge-source" title="' + escHtml(s) + '">' + escHtml(short) + '</span>';
        });
    }

    var selectedAnswer = _mexam.answers[q.id];
    var isAnswered = selectedAnswer !== undefined;

    // Options
    var letters = ['A', 'B', 'C', 'D'];
    var optsHtml = (q.options || []).map(function(opt, oi) {
        var cls = 'mexam-opt';
        if (_mexam.submitted) {
            if (oi === q.correct_index) cls += ' correct';
            else if (oi === selectedAnswer && oi !== q.correct_index) cls += ' wrong';
        } else if (oi === selectedAnswer) {
            cls += ' selected';
        }
        var disabled = _mexam.submitted ? ' disabled' : '';
        return '<button class="' + cls + '"' + disabled + ' onclick="_mexamSelectAnswer(' + q.id + ',' + oi + ')">' +
            '<span class="mexam-opt-letter">' + letters[oi] + '</span>' +
            '<span>' + escHtml(opt) + '</span>' +
        '</button>';
    }).join('');

    // Explanation (show after submit)
    var explHtml = '';
    if (_mexam.submitted && q.explanation) {
        var icon = selectedAnswer === q.correct_index ? '✅' : '❌';
        explHtml = '<div class="mexam-explanation">' + icon + ' ' + escHtml(q.explanation) + '</div>';
    }

    document.getElementById('mexamQuestionArea').innerHTML =
        '<div class="mexam-q-card">' +
            '<div class="mexam-q-badges">' + badges + '</div>' +
            '<div class="mexam-q-text"><span class="mexam-q-num">Q' + (idx + 1) + '.</span>' + escHtml(q.question) + '</div>' +
            '<div class="mexam-options">' + optsHtml + '</div>' +
            explHtml +
        '</div>';

    // Nav buttons
    document.getElementById('mexamPrevBtn').disabled = idx === 0;
    var nextBtn = document.getElementById('mexamNextBtn');
    var submitBtn = document.getElementById('mexamSubmitBtn');

    if (_mexam.submitted) {
        nextBtn.classList.toggle('hidden', idx >= total - 1);
        submitBtn.classList.add('hidden');
    } else {
        if (idx >= total - 1) {
            nextBtn.classList.add('hidden');
            submitBtn.classList.remove('hidden');
        } else {
            nextBtn.classList.remove('hidden');
            submitBtn.classList.add('hidden');
        }
    }
}

function _mexamSelectAnswer(qId, optIndex) {
    if (_mexam.submitted) return;
    _mexam.answers[qId] = optIndex;
    _mexamRenderQuestion();
}

function mexamNav(dir) {
    var total = _mexam.examData.questions.length;
    _mexam.currentQ = Math.max(0, Math.min(total - 1, _mexam.currentQ + dir));
    _mexamRenderQuestion();
}

function mexamSubmit() {
    _mexam.submitted = true;
    _mexamStopTimer();
    _mexamSaveToHistory();
    _mexamShowStep(4);
    _mexamRenderResults();
}

function _mexamStartTimer() {
    _mexam.startTime = Date.now();
    _mexam.elapsed = 0;
    _mexamStopTimer();
    _mexam.timerInterval = setInterval(function() {
        _mexam.elapsed = Math.floor((Date.now() - _mexam.startTime) / 1000);
        var m = String(Math.floor(_mexam.elapsed / 60)).padStart(2, '0');
        var s = String(_mexam.elapsed % 60).padStart(2, '0');
        var el = document.getElementById('mexamTimer');
        if (el) el.textContent = m + ':' + s;
    }, 1000);
}

function _mexamStopTimer() {
    if (_mexam.timerInterval) { clearInterval(_mexam.timerInterval); _mexam.timerInterval = null; }
}

function _mexamRenderResults() {
    var questions = _mexam.examData.questions;
    var total = questions.length;
    var correct = 0;
    var byDiff = { easy: { total: 0, correct: 0 }, medium: { total: 0, correct: 0 }, hard: { total: 0, correct: 0 } };
    var crossCorrect = 0, crossTotal = 0;

    questions.forEach(function(q) {
        var userAns = _mexam.answers[q.id];
        var isCorrect = userAns === q.correct_index;
        if (isCorrect) correct++;

        var diff = (q.difficulty || 'medium').toLowerCase();
        if (!byDiff[diff]) byDiff[diff] = { total: 0, correct: 0 };
        byDiff[diff].total++;
        if (isCorrect) byDiff[diff].correct++;

        if (q.is_cross_video) {
            crossTotal++;
            if (isCorrect) crossCorrect++;
        }
    });

    var pct = Math.round((correct / total) * 100);
    var grade = pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 50 ? 'D' : 'F';
    var emoji = pct >= 80 ? '🎉' : pct >= 60 ? '👍' : pct >= 40 ? '📖' : '💪';
    var message = pct >= 80 ? 'Xuất sắc!' : pct >= 60 ? 'Tốt lắm!' : pct >= 40 ? 'Cần ôn thêm' : 'Hãy xem lại bài giảng';

    var minutes = Math.floor(_mexam.elapsed / 60);
    var seconds = _mexam.elapsed % 60;
    var timeStr = minutes + ' phút ' + seconds + ' giây';

    // Build review list
    var reviewHtml = questions.map(function(q, i) {
        var userAns = _mexam.answers[q.id];
        var isCorrect = userAns === q.correct_index;
        var letters = ['A', 'B', 'C', 'D'];
        var yourAnswer = userAns !== undefined ? letters[userAns] + '. ' + (q.options[userAns] || '') : 'Chưa trả lời';
        var correctAnswer = letters[q.correct_index] + '. ' + (q.options[q.correct_index] || '');

        return '<div class="mexam-review-item ' + (isCorrect ? 'correct' : 'wrong') + '">' +
            '<div class="mexam-review-q">' + (isCorrect ? '✅' : '❌') + ' Q' + (i + 1) + '. ' + escHtml(q.question) + '</div>' +
            '<div class="mexam-review-answer">' +
                'Bạn chọn: <strong>' + escHtml(yourAnswer) + '</strong>' +
                (!isCorrect ? ' · Đáp án: <strong style="color:#10b981">' + escHtml(correctAnswer) + '</strong>' : '') +
            '</div>' +
            (q.explanation ? '<div class="mexam-review-answer" style="margin-top:4px;opacity:.7">' + escHtml(q.explanation) + '</div>' : '') +
        '</div>';
    }).join('');

    document.getElementById('mexamResults').innerHTML =
        '<div class="mexam-score-circle">' +
            '<div class="mexam-score-num">' + pct + '%</div>' +
            '<div class="mexam-score-label">Grade: ' + grade + '</div>' +
        '</div>' +
        '<div class="mexam-result-title">' + emoji + ' ' + message + '</div>' +
        '<div class="mexam-result-subtitle">' + correct + '/' + total + ' câu đúng · Thời gian: ' + timeStr + '</div>' +

        '<div class="mexam-result-stats">' +
            '<div class="mexam-stat"><div class="mexam-stat-num" style="color:#34d399">' + byDiff.easy.correct + '/' + byDiff.easy.total + '</div><div class="mexam-stat-label">Easy</div></div>' +
            '<div class="mexam-stat"><div class="mexam-stat-num" style="color:#fbbf24">' + byDiff.medium.correct + '/' + byDiff.medium.total + '</div><div class="mexam-stat-label">Medium</div></div>' +
            '<div class="mexam-stat"><div class="mexam-stat-num" style="color:#f87171">' + byDiff.hard.correct + '/' + byDiff.hard.total + '</div><div class="mexam-stat-label">Hard</div></div>' +
            (crossTotal > 0 ? '<div class="mexam-stat"><div class="mexam-stat-num" style="color:#60a5fa">' + crossCorrect + '/' + crossTotal + '</div><div class="mexam-stat-label">Cross-Video</div></div>' : '') +
        '</div>' +

        '<div class="mexam-result-actions">' +
            '<button class="mexam-result-btn" onclick="_mexamShowStep(3);_mexam.currentQ=0;_mexamRenderQuestion()">📋 Xem lại đề</button>' +
            '<button class="mexam-result-btn" onclick="_mexamDownloadExam()">⬇ Tải đề thi</button>' +
            '<button class="mexam-result-btn primary" onclick="openMexam()">🔄 Thi lại</button>' +
            '<button class="mexam-result-btn" onclick="closeMexam()">✕ Đóng</button>' +
        '</div>' +

        '<div class="mexam-review-list">' + reviewHtml + '</div>';
}


// ── Exam History ──
var MEXAM_HISTORY_KEY = 'lectureDigest_examHistory';
var MEXAM_HISTORY_MAX = 20;

function _mexamSwitchTab(tab) {
    document.getElementById('mexamTabNew').classList.toggle('active', tab === 'new');
    document.getElementById('mexamTabHistory').classList.toggle('active', tab === 'history');
    if (tab === 'new') {
        _mexamShowStep(1);
    } else {
        _mexamShowStep(5);
        _mexamRenderHistory();
    }
}

function _mexamLoadExamHistory() {
    try { return JSON.parse(localStorage.getItem(MEXAM_HISTORY_KEY) || '[]'); }
    catch(e) { return []; }
}

function _mexamUpdateHistCount() {
    var count = _mexamLoadExamHistory().length;
    var el = document.getElementById('mexamHistCount');
    if (el) el.textContent = count;
}

function _mexamSaveToHistory() {
    var questions = _mexam.examData.questions;
    var total = questions.length;
    var correct = 0;
    questions.forEach(function(q) {
        if (_mexam.answers[q.id] === q.correct_index) correct++;
    });
    var pct = Math.round((correct / total) * 100);

    var entry = {
        id: 'exam_' + Date.now(),
        savedAt: Date.now(),
        title: _mexam.examData.exam_title || 'Đề thi tổng hợp',
        videoTitles: _mexam.examData.video_titles || [],
        videoCount: _mexam.examData.video_count || 0,
        totalQuestions: total,
        correctAnswers: correct,
        percentage: pct,
        elapsed: _mexam.elapsed,
        questions: questions,
        answers: Object.assign({}, _mexam.answers)
    };

    var list = _mexamLoadExamHistory();
    list.unshift(entry);
    list.splice(MEXAM_HISTORY_MAX);
    localStorage.setItem(MEXAM_HISTORY_KEY, JSON.stringify(list));
    _mexamUpdateHistCount();
}

function _mexamRenderHistory() {
    var list = _mexamLoadExamHistory();
    var container = document.getElementById('mexamHistoryList');
    if (!container) return;

    if (list.length === 0) {
        container.innerHTML = '<div class="mexam-hist-empty">📭 Chưa có đề thi nào.<br>Tạo đề thi mới để bắt đầu!</div>';
        return;
    }

    container.innerHTML = list.map(function(e, idx) {
        var pct = e.percentage;
        var gradeClass = pct >= 80 ? 'grade-a' : pct >= 60 ? 'grade-b' : pct >= 40 ? 'grade-c' : 'grade-f';
        var grade = pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 50 ? 'D' : 'F';
        var date = new Date(e.savedAt);
        var dateStr = date.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' });
        var timeStr = date.toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit' });
        var mins = Math.floor((e.elapsed || 0) / 60);
        var secs = (e.elapsed || 0) % 60;

        return '<div class="mexam-hist-card" onclick="_mexamReplayExam(' + idx + ')">' +
            '<div class="mexam-hist-score ' + gradeClass + '">' +
                pct + '%' +
                '<div class="mexam-hist-grade">' + grade + '</div>' +
            '</div>' +
            '<div class="mexam-hist-info">' +
                '<div class="mexam-hist-name">' + escHtml(e.title) + '</div>' +
                '<div class="mexam-hist-detail">' +
                    e.correctAnswers + '/' + e.totalQuestions + ' đúng · ' +
                    e.videoCount + ' video · ' + mins + 'm' + secs + 's · ' +
                    dateStr + ' ' + timeStr +
                '</div>' +
                '<div class="mexam-hist-diff-bar">' +
                    (e.videoTitles || []).slice(0, 2).map(function(t) {
                        var short = t.length > 20 ? t.substring(0, 20) + '…' : t;
                        return '<span class="mexam-hist-diff-chip" style="background:rgba(139,92,246,0.12);color:var(--accent)">' + escHtml(short) + '</span>';
                    }).join('') +
                    ((e.videoTitles || []).length > 2 ? '<span class="mexam-hist-diff-chip" style="background:rgba(139,92,246,0.12);color:var(--accent)">+' + ((e.videoTitles || []).length - 2) + '</span>' : '') +
                '</div>' +
            '</div>' +
            '<div class="mexam-hist-actions">' +
                '<button class="mexam-hist-action-btn" onclick="event.stopPropagation();_mexamDownloadFromHistory(' + idx + ')" title="Tải về">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                '</button>' +
                '<button class="mexam-hist-action-btn delete" onclick="event.stopPropagation();_mexamDeleteFromHistory(' + idx + ')" title="Xóa">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                '</button>' +
            '</div>' +
        '</div>';
    }).join('');
}

function _mexamDeleteFromHistory(idx) {
    var list = _mexamLoadExamHistory();
    if (idx >= 0 && idx < list.length) {
        list.splice(idx, 1);
        localStorage.setItem(MEXAM_HISTORY_KEY, JSON.stringify(list));
        _mexamUpdateHistCount();
        _mexamRenderHistory();
        showToast('Đã xóa đề thi', 'info');
    }
}

function _mexamReplayExam(idx) {
    var list = _mexamLoadExamHistory();
    var entry = list[idx];
    if (!entry) return;

    // Restore exam state for review
    _mexam.examData = {
        exam_title: entry.title,
        questions: entry.questions,
        video_count: entry.videoCount,
        video_titles: entry.videoTitles
    };
    _mexam.answers = Object.assign({}, entry.answers || {});
    _mexam.submitted = true;
    _mexam.currentQ = 0;
    _mexam.elapsed = entry.elapsed || 0;

    document.getElementById('mexamSubtitle').textContent =
        entry.totalQuestions + ' câu hỏi · ' + entry.videoCount + ' video';
    var titleEl = document.getElementById('mexamExamTitle');
    if (titleEl) titleEl.textContent = entry.title;

    _mexamShowStep(3);
    _mexamRenderQuestion();
}

// ── Download Exam ──
function _mexamDownloadExam() {
    if (!_mexam.examData) return;
    _mexamBuildAndDownload(_mexam.examData, _mexam.answers, _mexam.elapsed);
}

function _mexamDownloadFromHistory(idx) {
    var list = _mexamLoadExamHistory();
    var entry = list[idx];
    if (!entry) return;
    _mexamBuildAndDownload(
        { exam_title: entry.title, questions: entry.questions, video_count: entry.videoCount, video_titles: entry.videoTitles },
        entry.answers,
        entry.elapsed
    );
}

function _mexamBuildAndDownload(examData, answers, elapsed) {
    var questions = examData.questions;
    var total = questions.length;
    var correct = 0;
    questions.forEach(function(q) {
        if (answers[q.id] === q.correct_index) correct++;
    });
    var pct = Math.round((correct / total) * 100);
    var letters = ['A', 'B', 'C', 'D'];
    var mins = Math.floor((elapsed || 0) / 60);
    var secs = (elapsed || 0) % 60;

    var html = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
        '<title>' + escHtml(examData.exam_title || 'Multi-Video Exam') + '</title>' +
        '<style>' +
        'body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#1a1a2e;line-height:1.6}' +
        'h1{text-align:center;color:#7c3aed;font-size:24px}' +
        '.meta{text-align:center;color:#666;margin-bottom:30px;font-size:14px}' +
        '.score{text-align:center;font-size:48px;font-weight:900;color:#7c3aed;margin:20px 0}' +
        '.stats{display:flex;justify-content:center;gap:20px;margin-bottom:30px;flex-wrap:wrap}' +
        '.stat{background:#f5f3ff;border-radius:10px;padding:10px 16px;text-align:center}' +
        '.stat-num{font-size:20px;font-weight:800}' +
        '.stat-label{font-size:11px;color:#666}' +
        '.q{margin-bottom:24px;padding:16px;border:1px solid #e5e7eb;border-radius:12px}' +
        '.q-num{font-weight:700;color:#7c3aed;margin-right:6px}' +
        '.q-text{font-size:15px;font-weight:600;margin-bottom:10px}' +
        '.q-badges{margin-bottom:8px}' +
        '.badge{display:inline-block;font-size:10px;padding:2px 8px;border-radius:6px;margin-right:4px;font-weight:700}' +
        '.badge-easy{background:#d1fae5;color:#059669}.badge-medium{background:#fef3c7;color:#b45309}.badge-hard{background:#fee2e2;color:#dc2626}' +
        '.badge-cross{background:#dbeafe;color:#2563eb}' +
        '.opt{padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;margin:4px 0;font-size:13px}' +
        '.opt.correct{border-color:#10b981;background:#ecfdf5}.opt.wrong{border-color:#ef4444;background:#fef2f2}' +
        '.opt.user{font-weight:700}' +
        '.explain{margin-top:8px;padding:10px;background:#f5f3ff;border-left:3px solid #7c3aed;border-radius:6px;font-size:12px;color:#555}' +
        'hr{border:none;border-top:1px solid #eee;margin:30px 0}' +
        '@media print{body{margin:20px}h1{font-size:18px}.q{break-inside:avoid}}' +
        '</style></head><body>' +
        '<h1>📝 ' + escHtml(examData.exam_title || 'Multi-Video Exam') + '</h1>' +
        '<div class="meta">' + total + ' câu hỏi · ' + (examData.video_count || 0) + ' video · Thời gian: ' + mins + 'm ' + secs + 's</div>' +
        '<div class="score">' + pct + '%</div>' +
        '<div class="stats">' +
            '<div class="stat"><div class="stat-num" style="color:#10b981">' + correct + '</div><div class="stat-label">Đúng</div></div>' +
            '<div class="stat"><div class="stat-num" style="color:#ef4444">' + (total - correct) + '</div><div class="stat-label">Sai</div></div>' +
            '<div class="stat"><div class="stat-num">' + total + '</div><div class="stat-label">Tổng</div></div>' +
        '</div>';

    if (examData.video_titles && examData.video_titles.length) {
        html += '<div class="meta"><strong>Video:</strong> ' + examData.video_titles.map(function(t) { return escHtml(t); }).join(' · ') + '</div>';
    }

    html += '<hr>';

    questions.forEach(function(q, i) {
        var userAns = answers[q.id];
        var isCorrect = userAns === q.correct_index;
        var diff = (q.difficulty || 'medium').toLowerCase();

        html += '<div class="q">';
        html += '<div class="q-badges">';
        html += '<span class="badge badge-' + diff + '">' + diff.toUpperCase() + '</span>';
        if (q.is_cross_video) html += '<span class="badge badge-cross">CROSS-VIDEO</span>';
        if (q.source) html += q.source.map(function(s) { return '<span class="badge" style="background:#f3f4f6;color:#6b7280">' + escHtml(s) + '</span>'; }).join('');
        html += '</div>';
        html += '<div class="q-text"><span class="q-num">Q' + (i + 1) + '.</span> ' + escHtml(q.question) + '</div>';

        (q.options || []).forEach(function(opt, oi) {
            var cls = 'opt';
            if (oi === q.correct_index) cls += ' correct';
            if (oi === userAns && oi !== q.correct_index) cls += ' wrong';
            if (oi === userAns) cls += ' user';
            var marker = oi === q.correct_index ? ' ✅' : (oi === userAns && oi !== q.correct_index ? ' ❌' : '');
            html += '<div class="' + cls + '">' + letters[oi] + '. ' + escHtml(opt) + marker + '</div>';
        });

        if (q.explanation) {
            html += '<div class="explain">' + (isCorrect ? '✅' : '❌') + ' ' + escHtml(q.explanation) + '</div>';
        }
        html += '</div>';
    });

    html += '<div class="meta" style="margin-top:30px">LectureDigest — AI-Powered Learning · ' + new Date().toLocaleDateString('vi-VN') + '</div>';
    html += '</body></html>';

    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.getElementById('mexamDownloadLink') || document.createElement('a');
    a.href = url;
    a.download = (examData.exam_title || 'Multi-Video-Exam').replace(/[^\w\s-]/g, '').replace(/\s+/g, '_') + '.html';
    a.click();
    setTimeout(function() { URL.revokeObjectURL(url); }, 5000);
    showToast('Đã tải đề thi!', 'success');
}


