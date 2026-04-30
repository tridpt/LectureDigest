/* ════════════════════════════════════════════════
   LectureDigest — AI Auto-Notes (Cornell Format)
   ════════════════════════════════════════════════ */

let _autoNotesLoading = false;

/**
 * Generate AI-powered notes in Cornell format from the current video's analysis data.
 * Uses the transcript, topics, and key takeaways to create structured notes.
 */
async function generateAutoNotes() {
    if (_autoNotesLoading) return;
    if (!analysisData) {
        showToast('⚠️ Chưa có dữ liệu phân tích video');
        return;
    }

    const textarea = document.getElementById('notesTextarea');
    if (!textarea) return;

    // Warn if there are existing notes
    if (textarea.value.trim().length > 0) {
        const ok = confirm('Bạn đã có ghi chú. Tạo AI notes sẽ THAY THẾ nội dung hiện tại.\n\nBạn có muốn tiếp tục?');
        if (!ok) return;
    }

    const btn = document.getElementById('autoNotesBtn');
    if (btn) {
        btn.disabled = true;
        btn.classList.add('auto-notes-loading');
        btn.title = 'Đang tạo ghi chú...';
    }
    _autoNotesLoading = true;

    try {
        const body = {
            title: analysisData.title || '',
            overview: analysisData.overview || '',
            topics: (analysisData.topics || []).map(t => ({
                title: t.title || '',
                summary: t.summary || '',
                timestamp_str: t.timestamp_str || ''
            })),
            key_takeaways: analysisData.key_takeaways || [],
            transcript: (analysisData.transcript || []).slice(0, 200),
            output_language: selectedLang || 'Vietnamese'
        };

        const resp = await fetch(API_BASE + '/api/auto-notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || 'Server error');
        }

        const data = await resp.json();
        if (data.notes) {
            textarea.value = data.notes;
            textarea.dispatchEvent(new Event('input'));
            showToast('📝 Đã tạo ghi chú Cornell thành công!');
            if (typeof recordGamifFeature === 'function') recordGamifFeature('usedNotes');
        }

    } catch (e) {
        console.error('[AutoNotes]', e);
        showToast('❌ Tạo ghi chú thất bại: ' + e.message);
    } finally {
        _autoNotesLoading = false;
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('auto-notes-loading');
            btn.title = 'AI tạo ghi chú Cornell';
        }
    }
}
