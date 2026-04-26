/* ════════════════════════════════════════════════
   LectureDigest — PDF Export
   ════════════════════════════════════════════════ */

// ──────────────────────────────────────
// PDF EXPORT  (browser print → Save as PDF)
// ──────────────────────────────────────
function exportPDF() {
    if (!analysisData) return;
    const d = analysisData;
    const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    const letters = ['A', 'B', 'C', 'D'];

    const topicsHtml = (d.topics || []).map(t => `
        <div class="chapter">
            <span class="ts">${t.timestamp_str}</span>
            <div>
                <div class="ch-title">${t.emoji || '📌'} ${t.title}</div>
                <div class="ch-summary">${t.summary}</div>
            </div>
        </div>`).join('');

    const quizHtml = (d.quiz || []).map((q, i) => `
        <div class="quiz-item">
            <div class="quiz-q"><span class="qnum">${i + 1}</span>${q.question}
                <span class="diff-badge ${q.difficulty || 'medium'}">${q.difficulty || 'medium'}</span>
            </div>
            <div class="options">
                ${(q.options || []).map((opt, oi) =>
                    `<div class="option ${oi === q.correct_index ? 'correct' : ''}">${letters[oi]}. ${opt}</div>`
                ).join('')}
            </div>
            ${q.explanation ? `<div class="expl">💡 ${q.explanation}</div>` : ''}
        </div>`).join('');

    const takeawaysHtml = (d.key_takeaways || []).map(t =>
        `<div class="takeaway">${t}</div>`).join('');

    const videoUrl = d.video_id ? `youtube.com/watch?v=${d.video_id}` : '';

    // Personal notes
    let notesText = '';
    try {
        const notesKey = 'lectureDigest_note_' + d.video_id;
        notesText = localStorage.getItem(notesKey) || '';
    } catch(e) {}
    const notesHtml = notesText.trim()
        ? '<pre style="white-space:pre-wrap;font-family:Inter,sans-serif;font-size:10.5pt;color:#374151;line-height:1.7;background:#fafafa;padding:14px 16px;border-radius:8px;border:1px solid #f3f4f6">' + notesText.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</pre>'
        : '<p style="color:#9ca3af;font-style:italic">Chua co ghi chu</p>';

    // Bookmarks
    let bookmarksList = [];
    try {
        const bmKey = 'lectureDigest_bookmarks_' + d.video_id;
        bookmarksList = JSON.parse(localStorage.getItem(bmKey) || '[]');
    } catch(e) {}
    const bookmarksHtml = bookmarksList.length
        ? bookmarksList.map(function(bm) {
            var ts = typeof bm.time === 'number' ? fmtSecs(bm.time) : (bm.timestamp_str || '');
            var lbl = bm.label || bm.note || bm.title || '';
            return '<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:10.5pt">'
                + '<span style="background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:4px;font-size:9.5pt;font-weight:700;white-space:nowrap;font-family:Courier New,monospace">'
                + ts + '</span>'
                + '<span style="color:#374151">' + lbl + '</span></div>';
          }).join('')
        : '<p style="color:#9ca3af;font-style:italic">Chua co bookmark</p>';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${d.title || 'Study Guide'} — LectureDigest</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', -apple-system, sans-serif;
    color: #111827;
    background: #ffffff;
    font-size: 11pt;
    line-height: 1.65;
    padding: 32px 40px 48px;
    max-width: 820px;
    margin: 0 auto;
  }

  /* ── Cover ── */
  .cover {
    background: linear-gradient(135deg, #6d28d9 0%, #4338ca 100%);
    color: white;
    padding: 36px 40px;
    border-radius: 16px;
    margin-bottom: 36px;
  }
  .cover-brand { font-size: 11pt; font-weight: 600; opacity: 0.75; margin-bottom: 12px; letter-spacing: 0.5px; }
  .cover h1 { font-size: 22pt; font-weight: 800; line-height: 1.2; margin-bottom: 14px; }
  .cover-meta { font-size: 10pt; opacity: 0.8; display: flex; gap: 12px; flex-wrap: wrap; }
  .cover-meta span { display: flex; align-items: center; gap: 5px; }
  .diff-pill {
    display: inline-block;
    background: rgba(255,255,255,0.2);
    border: 1px solid rgba(255,255,255,0.3);
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 9.5pt;
    font-weight: 600;
    letter-spacing: 0.3px;
  }

  /* ── Sections ── */
  .section { margin-bottom: 32px; }
  .section-title {
    font-size: 12pt;
    font-weight: 700;
    color: #5b21b6;
    margin-bottom: 14px;
    padding-bottom: 8px;
    border-bottom: 2px solid #ede9fe;
    display: flex; align-items: center; gap: 8px;
  }
  .overview-text { color: #374151; line-height: 1.8; }

  /* ── Takeaways ── */
  .takeaway {
    display: flex; gap: 10px;
    padding: 7px 0;
    border-bottom: 1px solid #f3f4f6;
    color: #374151;
    font-size: 10.5pt;
  }
  .takeaway:last-child { border-bottom: none; }
  .takeaway::before { content: '✓'; color: #059669; font-weight: 700; flex-shrink: 0; margin-top: 1px; }

  /* ── Chapters ── */
  .chapter {
    display: flex; gap: 14px;
    padding: 11px 14px;
    border-radius: 8px;
    margin-bottom: 6px;
    background: #fafafa;
    border: 1px solid #f3f4f6;
    align-items: flex-start;
  }
  .ts {
    background: #ede9fe; color: #5b21b6;
    padding: 3px 9px; border-radius: 5px;
    font-size: 9.5pt; font-weight: 700;
    white-space: nowrap; flex-shrink: 0;
    font-family: 'Courier New', monospace;
    margin-top: 2px;
  }
  .ch-title { font-weight: 600; font-size: 11pt; margin-bottom: 3px; }
  .ch-summary { color: #6b7280; font-size: 10pt; line-height: 1.55; }

  /* ── Quiz ── */
  .quiz-item {
    background: #fafafa;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 14px;
    break-inside: avoid;
  }
  .quiz-q {
    font-weight: 600;
    margin-bottom: 12px;
    display: flex; align-items: flex-start; gap: 8px;
    line-height: 1.5;
  }
  .qnum {
    display: inline-flex; align-items: center; justify-content: center;
    background: #6d28d9; color: white;
    width: 22px; height: 22px; border-radius: 50%;
    font-size: 9.5pt; font-weight: 700;
    flex-shrink: 0; margin-top: 1px;
  }
  .options {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 7px; margin-bottom: 10px;
  }
  .option {
    padding: 7px 11px; border-radius: 6px;
    font-size: 10pt;
    background: white; border: 1px solid #e5e7eb;
    line-height: 1.4;
  }
  .option.correct {
    background: #d1fae5; border-color: #34d399;
    color: #065f46; font-weight: 600;
  }
  .expl {
    font-size: 10pt; color: #374151;
    padding: 9px 12px;
    background: white; border-radius: 6px;
    border-left: 3px solid #10b981;
    line-height: 1.6;
  }
  .diff-badge {
    display: inline-block;
    padding: 1px 7px; border-radius: 4px;
    font-size: 9pt; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.3px;
    margin-left: 6px; flex-shrink: 0;
    vertical-align: middle;
  }
  .diff-badge.easy   { background: #d1fae5; color: #065f46; }
  .diff-badge.medium { background: #fef3c7; color: #92400e; }
  .diff-badge.hard   { background: #fee2e2; color: #991b1b; }

  /* ── Footer ── */
  .footer {
    text-align: center; color: #9ca3af;
    font-size: 9pt; margin-top: 48px;
    padding-top: 16px; border-top: 1px solid #e5e7eb;
  }
  .footer a { color: #6d28d9; text-decoration: none; }

  /* ── Print ── */
  @media print {
    body { padding: 0; }
    .cover { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .option.correct,
    .ts, .qnum, .diff-badge,
    .diff-pill { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .quiz-item { break-inside: avoid; page-break-inside: avoid; }
    .section { break-inside: avoid; }
  }
</style>
</head>
<body>

  <div class="cover">
    <div class="cover-brand">🎓 LectureDigest — Study Guide</div>
    <h1>${d.title || 'Study Guide'}</h1>
    <div class="cover-meta">
      ${d.author ? `<span>👤 ${d.author}</span>` : ''}
      ${d.difficulty ? `<span><span class="diff-pill">${d.difficulty}</span></span>` : ''}
      <span>📅 ${date}</span>
      ${videoUrl ? `<span>🔗 ${videoUrl}</span>` : ''}
    </div>
  </div>

  <div class="section">
    <div class="section-title">📋 Overview</div>
    <p class="overview-text">${d.overview || ''}</p>
  </div>

  <div class="section">
    <div class="section-title">✅ Key Takeaways</div>
    ${takeawaysHtml}
  </div>

  <div class="section">
    <div class="section-title">🗺️ Chapter Timeline</div>
    ${topicsHtml}
  </div>

  <div class="section">
    <div class="section-title">🧠 Knowledge Quiz</div>
    ${quizHtml}
  </div>

  <div class="section">
    <div class="section-title">\u270f\ufe0f Ghi chu ca nhan</div>
    ${notesHtml}
  </div>

  <div class="section">
    <div class="section-title">\ud83d\udd16 Bookmarks</div>
    ${bookmarksHtml}
  </div>

  <div class="footer">
    Generated by <strong>LectureDigest</strong> · Powered by Gemini AI
    ${videoUrl ? ` · <a href="https://${videoUrl}" target="_blank">${videoUrl}</a>` : ''}
  </div>

</body>
</html>`;

    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { alert('Please allow popups for this site to export PDF.'); return; }
    win.document.write(html);
    win.document.close();
    // Wait for Google Fonts to load, then print
    setTimeout(() => { win.focus(); win.print(); }, 1200);
}

