/* ════════════════════════════════════════════════
   LectureDigest — Quiz Module
   ════════════════════════════════════════════════ */

function initQuiz(questions) {
    Object.assign(quizState, {
        questions,
        currentIndex: 0,
        score:        0,
        skipped:      0,
        answered:     false,
    });

    // Reset UI
    document.getElementById('quizResults')?.classList.add('hidden');
    document.getElementById('quizContainer')?.classList.remove('hidden');
    document.getElementById('quizNav')?.classList.remove('hidden');
    document.getElementById('scoreBadge')?.classList.add('hidden');

    renderCurrentQuestion();
}

function renderCurrentQuestion() {
    const { questions, currentIndex } = quizState;
    const total = questions.length;

    if (currentIndex >= total) {
        showQuizResults();
        return;
    }

    const q = questions[currentIndex];

    // Progress
    const pct = total > 0 ? (currentIndex / total) * 100 : 0;
    const fillEl = document.getElementById('quizProgressFill');
    const textEl = document.getElementById('quizProgressText');
    const barEl  = document.getElementById('quizProgressBar');
    if (fillEl) fillEl.style.width = `${pct}%`;
    if (textEl) textEl.textContent = `Question ${currentIndex + 1} of ${total}`;
    if (barEl)  barEl.setAttribute('aria-valuenow', Math.round(pct));

    // Reset nav
    quizState.answered = false;
    document.getElementById('nextBtn')?.classList.add('hidden');
    document.getElementById('skipBtn')?.classList.remove('hidden');

    // Render question HTML
    const letters = ['A', 'B', 'C', 'D'];
    const optionsHtml = (q.options || []).map((opt, i) => `
        <button
            class="quiz-option"
            onclick="selectAnswer(${i})"
            id="opt-${i}"
            aria-label="Option ${letters[i]}: ${esc(opt)}"
        >
            <span class="option-letter" aria-hidden="true">${letters[i]}</span>
            <span class="option-text">${esc(opt)}</span>
        </button>
    `).join('');

    const container = document.getElementById('quizContainer');
    if (container) {
        container.innerHTML = `
            <div class="quiz-question">
                <div class="quiz-question-header">
                    <span class="quiz-diff-badge ${q.difficulty || 'medium'}">${q.difficulty || 'medium'}</span>
                    <button class="quiz-ts-btn" onclick="seekTo(${q.timestamp})" aria-label="Jump to ${q.timestamp_str} in video">
                        ▶ ${esc(q.timestamp_str)}
                    </button>
                </div>
                <p class="quiz-question-text">${esc(q.question)}</p>
                <div class="quiz-options" role="group" aria-label="Answer choices">
                    ${optionsHtml}
                </div>
            </div>
        `;
    }
}

function selectAnswer(selectedIdx) {
    if (quizState.answered) return;
    quizState.answered = true;

    const q = quizState.questions[quizState.currentIndex];
    const correctIdx = q.correct_index ?? 0;
    const isCorrect  = selectedIdx === correctIdx;

    if (isCorrect) quizState.score++;

    // Style options
    const options = document.querySelectorAll('.quiz-option');
    options.forEach((btn, i) => {
        btn.disabled = true;
        if (i === selectedIdx && isCorrect)  btn.classList.add('correct');
        if (i === selectedIdx && !isCorrect) btn.classList.add('wrong');
        if (i === correctIdx && !isCorrect)  btn.classList.add('reveal-correct');
    });

    // Explanation
    if (q.explanation) {
        const expl = document.createElement('div');
        expl.className = 'quiz-explanation';
        expl.innerHTML = `
            <p class="quiz-explanation-label">${isCorrect ? '✓ Correct' : '✗ Incorrect'} — Explanation</p>
            <p class="quiz-explanation-text">${esc(q.explanation)}</p>
        `;
        document.getElementById('quizContainer')?.appendChild(expl);
    }

    // Score badge
    const badge = document.getElementById('scoreBadge');
    if (badge) {
        badge.textContent = `${quizState.score}/${quizState.currentIndex + 1}`;
        badge.classList.remove('hidden');
    }

    // Show Next/Finish button
    document.getElementById('skipBtn')?.classList.add('hidden');
    const nextBtn = document.getElementById('nextBtn');
    if (nextBtn) {
        const isLast = quizState.currentIndex >= quizState.questions.length - 1;
        nextBtn.innerHTML = isLast
            ? 'See Results <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 7l5 5m0 0l-5 5m5-5H6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            : 'Next Question <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 7l5 5m0 0l-5 5m5-5H6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        nextBtn.classList.remove('hidden');
    }
}

function skipQuestion() {
    quizState.skipped++;
    quizState.currentIndex++;
    renderCurrentQuestion();
}

function nextQuestion() {
    quizState.currentIndex++;
    renderCurrentQuestion();
}

function showQuizResults() {
    const { score, questions, skipped } = quizState;
    const answered = questions.length - skipped;
    const pct      = answered > 0 ? Math.round((score / answered) * 100) : 0;

    // Hide active quiz
    document.getElementById('quizContainer')?.classList.add('hidden');
    document.getElementById('quizNav')?.classList.add('hidden');

    // Fill progress bar to 100%
    const fillEl = document.getElementById('quizProgressFill');
    if (fillEl) fillEl.style.width = '100%';
    setText('quizProgressText', 'Quiz Complete!');

    // Result content
    let emoji, message;
    if      (pct >= 90) { emoji = '🏆'; message = 'Outstanding! You mastered this lecture!'; }
    else if (pct >= 75) { emoji = '🎉'; message = 'Great job! You have a solid understanding.'; }
    else if (pct >= 60) { emoji = '👍'; message = 'Good effort! Review the missed sections.'; }
    else if (pct >= 40) { emoji = '📚'; message = 'Keep studying — try rewatching the harder parts.'; }
    else                { emoji = '💪'; message = "Don't give up! Review the lecture and try again."; }

    setText('resultsEmoji',   emoji);
    setText('resultsTitle',   'Quiz Complete!');
    setText('resultsScore',   `${score}/${answered}`);
    setText('resultsMessage', message);

    const breakdown = document.getElementById('resultsBreakdown');
    if (breakdown) {
        breakdown.innerHTML = statBox(score,           'Correct',  'var(--success)')
                            + statBox(answered - score, 'Wrong',    'var(--error)')
                            + statBox(skipped,           'Skipped', 'var(--text-muted)');
    }

    document.getElementById('quizResults')?.classList.remove('hidden');

    // ── Track quiz session ──
    if (answered > 0 && analysisData?.video_id) {
        recordQuizSession(analysisData.video_id, score, answered);
        recordGamifQuiz(score, answered);    // gamification
    }
}

function statBox(num, label, color) {
    return `<div class="breakdown-item">
        <span class="breakdown-num" style="color:${color}">${num}</span>
        <span class="breakdown-label">${label}</span>
    </div>`;
}

function restartQuiz() {
    if (analysisData) initQuiz(analysisData.quiz || []);
}

async function regenerateQuiz() {
    if (!analysisData) return;

    const btn = document.getElementById('regenQuizBtn');
    const origHtml = btn?.innerHTML || '';

    // Get transcript — from current session, history, or re-fetch
    const histEntry = loadHistory().find(h => h.video_id === analysisData.video_id);
    let transcript = analysisData.transcript
        || histEntry?.transcript
        || histEntry?.data?.transcript;

    // If still no transcript, try fetching it now client-side
    if (!transcript?.length) {
        if (btn) { btn.disabled = true; btn.textContent = 'Đang lấy transcript...'; }
        try {
            transcript = await fetchTranscriptClientSide(analysisData.video_id);
            analysisData.transcript = transcript;
        } catch (e) {
            if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
            alert('Không lấy được transcript. Hãy analyze lại video để dùng tính năng này.');
            return;
        }
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v16m8-8H4" stroke-linecap="round" stroke-linejoin="round"/></svg> Đang tạo...`;
    }

    try {
        const existingQuestions = analysisData.quiz || [];

        const res = await fetch(`${API_BASE}/api/quiz`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: analysisData.title || '',
                output_language: selectedLang,
                transcript,
                existing_questions: existingQuestions,
            }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
            throw new Error(err.detail || `Server error ${res.status}`);
        }
        const data = await res.json();
        if (!data.quiz?.length) throw new Error('No quiz questions returned');

        // APPEND new questions to existing ones
        const merged = [...existingQuestions, ...data.quiz];
        analysisData.quiz = merged;

        saveToHistory(analysisData);

        // Restart quiz from beginning with all questions
        initQuiz(merged);
        document.getElementById('quizCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

        showToast(`➕ Đã thêm ${data.quiz.length} câu hỏi mới! Tổng: ${merged.length} câu`);

    } catch (err) {
        alert(`Thêm câu hỏi thất bại: ${err.message}`);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
    }
}
