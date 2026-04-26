/* ════════════════════════════════════════════════
   LectureDigest — Notes Module
   ════════════════════════════════════════════════ */

const NOTES_KEY_PREFIX = 'lectureDigest_note_';
let notesSaveTimer = null;

function notesKey(videoId) { return NOTES_KEY_PREFIX + videoId; }

function loadNote(videoId) {
    try { return localStorage.getItem(notesKey(videoId)) || ''; }
    catch { return ''; }
}

function saveNote(videoId, text) {
    try {
        localStorage.setItem(notesKey(videoId), text);
        if (text.trim().length > 0) recordGamifFeature('usedNotes');
    } catch {}
}

function initNotes(videoId) {
    const textarea = document.getElementById('notesTextarea');
    const status   = document.getElementById('notesSaveStatus');
    const counter  = document.getElementById('notesWordCount');
    if (!textarea) return;

    // Load saved note
    textarea.value = loadNote(videoId);
    updateWordCount(textarea.value, counter);

    // Remove old listener by replacing element clone
    const fresh = textarea.cloneNode(true);
    textarea.parentNode.replaceChild(fresh, textarea);

    fresh.addEventListener('input', () => {
        updateWordCount(fresh.value, counter);
        if (status) { status.textContent = '...'; status.style.color = 'var(--text-muted)'; }
        clearTimeout(notesSaveTimer);
        notesSaveTimer = setTimeout(() => {
            saveNote(videoId, fresh.value);
            if (status) { status.textContent = '✓ Đã lưu'; status.style.color = '#4ade80'; }
        }, 800);
    });
}

function updateWordCount(text, el) {
    if (!el) return;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    el.textContent = words + ' từ';
}

function insertNoteTimestamp() {
    const textarea = document.getElementById('notesTextarea');
    if (!textarea || !ytPlayer) return;

    let secs = 0;
    try { secs = Math.floor(ytPlayer.getCurrentTime() || 0); } catch {}
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    const stamp = `[${m}:${s}] `;

    // Insert at cursor position
    const start = textarea.selectionStart;
    const end   = textarea.selectionEnd;
    const before = textarea.value.substring(0, start);
    const after  = textarea.value.substring(end);
    textarea.value = before + stamp + after;
    textarea.selectionStart = textarea.selectionEnd = start + stamp.length;
    textarea.focus();
    textarea.dispatchEvent(new Event('input'));
}

async function copyNotes() {
    const textarea = document.getElementById('notesTextarea');
    const btn = document.getElementById('notesCopyBtn');
    if (!textarea?.value.trim()) { showToast('📝 Chưa có ghi chú để copy'); return; }
    try {
        await navigator.clipboard.writeText(textarea.value);
        if (btn) {
            btn.style.color = '#4ade80';
            setTimeout(() => btn.style.color = '', 1500);
        }
        showToast('✅ Đã copy ghi chú!');
    } catch {
        showToast('❌ Không thể copy');
    }
}

function exportNotesMarkdown() {
    var textarea = document.getElementById('notesTextarea');
    if (!textarea || !textarea.value.trim()) { showToast('Chua co ghi chu de xuat'); return; }
    var title    = (analysisData && analysisData.title)  || (document.getElementById('videoTitle') && document.getElementById('videoTitle').textContent) || 'Video';
    var author   = (analysisData && analysisData.author) || '';
    var videoUrl = (document.getElementById('urlInput') && document.getElementById('urlInput').value.trim()) || '';
    var now = new Date().toLocaleDateString('vi-VN');
    var md = '# Ghi chu: ' + title + '\n\n';
    if (author)   md += '**Tac gia:** ' + author + '  \n';
    if (videoUrl) md += '**Link:** ' + videoUrl + '  \n';
    md += '**Ngay:** ' + now + '  \n\n---\n\n' + textarea.value;
    var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'notes-' + (title || 'lecture').replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40) + '.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    showToast('Da tai xuong file .md!');
}
