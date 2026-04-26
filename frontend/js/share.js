/* ════════════════════════════════════════════════
   LectureDigest — Share Results
   ════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════════
// SHARE RESULTS
// ══════════════════════════════════════════════════════════

function openShareModal() {
    if (!analysisData) return;
    const d = analysisData;
    const videoUrl = 'https://www.youtube.com/watch?v=' + (d.video_id || '');

    setText('sharePreviewTitle',  d.title || '');
    setText('sharePreviewAuthor', d.author ? '\u{1F464} ' + d.author : '');
    setText('sharePreviewSummary', d.overview
        ? (d.overview.length > 200 ? d.overview.slice(0, 197) + '\u2026' : d.overview)
        : '');
    setText('sharePreviewUrl', videoUrl);

    const taEl = document.getElementById('sharePreviewTakeaways');
    if (taEl) {
        const items = (d.key_takeaways || []).slice(0, 3);
        taEl.innerHTML = items.map(t =>
            '<div class="sp-ta-item">\u2736 ' + escapeHtml(t.length > 100 ? t.slice(0,97)+'\u2026' : t) + '</div>'
        ).join('');
    }

    const nativeBtn = document.getElementById('shareNativeBtn');
    if (nativeBtn) nativeBtn.style.display = navigator.share ? 'flex' : 'none';

    document.getElementById('shareModalOverlay')?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

// setText → defined in core.js

function closeShareModalBtn() {
    document.getElementById('shareModalOverlay')?.classList.add('hidden');
    document.body.style.overflow = '';
}

function closeShareModal(e) {
    if (e.target.id === 'shareModalOverlay') closeShareModalBtn();
}

async function shareNative() {
    if (!analysisData || !navigator.share) return;
    const d = analysisData;
    const url = 'https://www.youtube.com/watch?v=' + (d.video_id || '');
    try {
        await navigator.share({ title: d.title || 'Bai giang hay', text: buildShareText(d), url: url });
    } catch (e) {
        if (e.name !== 'AbortError') showToast('Khong the chia se: ' + e.message);
    }
}

async function copyShareText() {
    if (!analysisData) return;
    try {
        await navigator.clipboard.writeText(buildShareText(analysisData));
        showToast('\u2705 Da copy noi dung!');
    } catch { showToast('\u274C Khong the copy'); }
}

async function copyYouTubeLink() {
    if (!analysisData?.video_id) return;
    const url = 'https://www.youtube.com/watch?v=' + analysisData.video_id;
    try {
        await navigator.clipboard.writeText(url);
        showToast('\u2705 Da copy link video!');
    } catch { showToast('\u274C Khong the copy'); }
}

function buildShareText(d) {
    const url = 'https://www.youtube.com/watch?v=' + (d.video_id || '');
    const sep = '\n' + '─'.repeat(40) + '\n';
    let text  = '📚 ' + (d.title || 'Bai giang') + '\n';
    if (d.author) text += '👤 ' + d.author + '\n';
    text += '🔗 ' + url + '\n';
    if (d.overview) text += sep + '📋 TOM TAT\n' + d.overview;
    const takes = (d.key_takeaways || []).slice(0, 5);
    if (takes.length) { text += sep + '💡 KEY TAKEAWAYS\n'; text += takes.map((t,i) => (i+1)+'. '+t).join('\n'); }
    const chaps = (d.chapters || []).slice(0, 6);
    if (chaps.length) { text += sep + '📑 CHAPTERS\n'; text += chaps.map(c => '[' + (c.timestamp_str||'') + '] ' + c.title).join('\n'); }
    text += sep + '✨ Phan tich boi LectureDigest AI';
    return text;
}

