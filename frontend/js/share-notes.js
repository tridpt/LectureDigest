/* ════════════════════════════════════════════════
   LectureDigest — Share Notes Module
   Create shareable links for notes & bookmarks
   ════════════════════════════════════════════════ */

function openShareNotesModal() {
    if (!analysisData) { showToast('Chưa có bài giảng để chia sẻ'); return; }

    var notes = document.getElementById('notesTextarea')?.value || '';
    var bookmarks = _getBookmarksForShare();

    if (!notes.trim() && bookmarks.length === 0) {
        showToast('📝 Thêm ghi chú hoặc bookmark trước khi chia sẻ');
        return;
    }

    // Update counts
    var wordCount = notes.trim() ? notes.trim().split(/\s+/).length : 0;
    var wcEl = document.getElementById('shareNotesWordCount');
    if (wcEl) wcEl.textContent = wordCount > 0 ? '(' + wordCount + ' từ)' : '(trống)';

    var bcEl = document.getElementById('shareBookmarkCount');
    if (bcEl) bcEl.textContent = '(' + bookmarks.length + ')';

    // Disable checkboxes if empty
    var notesCb = document.getElementById('shareIncludeNotes');
    var bmCb = document.getElementById('shareIncludeBookmarks');
    if (notesCb) {
        notesCb.disabled = !notes.trim();
        notesCb.checked = !!notes.trim();
    }
    if (bmCb) {
        bmCb.disabled = bookmarks.length === 0;
        bmCb.checked = bookmarks.length > 0;
    }

    // Show config, hide result
    var config = document.getElementById('shareNotesConfig');
    var result = document.getElementById('shareNotesResult');
    var error = document.getElementById('shareNotesError');
    if (config) config.classList.remove('hidden');
    if (result) result.classList.add('hidden');
    if (error) error.classList.add('hidden');

    document.getElementById('shareNotesOverlay')?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeShareNotesModal() {
    document.getElementById('shareNotesOverlay')?.classList.add('hidden');
    document.body.style.overflow = '';
}

function resetShareNotesModal() {
    var config = document.getElementById('shareNotesConfig');
    var result = document.getElementById('shareNotesResult');
    if (config) config.classList.remove('hidden');
    if (result) result.classList.add('hidden');
}

function _getBookmarksForShare() {
    // Read from localStorage (source of truth) instead of DOM scraping
    if (!bmCurrentVideoId) return [];
    var bms = loadBookmarks(bmCurrentVideoId);
    return bms.map(function(bm) {
        return {
            label: bm.label || '',
            time_str: fmtSecs(bm.time || 0),
            time_secs: bm.time || 0
        };
    });
}

async function generateShareLink() {
    if (!analysisData) return;

    var includeNotes = document.getElementById('shareIncludeNotes')?.checked;
    var includeBookmarks = document.getElementById('shareIncludeBookmarks')?.checked;
    var includeOverview = document.getElementById('shareIncludeOverview')?.checked;

    var notes = includeNotes ? (document.getElementById('notesTextarea')?.value || '') : '';
    var bookmarks = includeBookmarks ? _getBookmarksForShare() : [];
    var overview = includeOverview ? (analysisData.overview || '') : '';

    if (!notes.trim() && bookmarks.length === 0) {
        showToast('Chọn ít nhất ghi chú hoặc bookmarks để chia sẻ');
        return;
    }

    var btn = document.getElementById('shareNotesGenerateBtn');
    var error = document.getElementById('shareNotesError');
    if (error) error.classList.add('hidden');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang tạo...'; }

    // Get user display name if logged in
    var sharedBy = '';
    try {
        var profileName = document.getElementById('profileDisplayName');
        if (profileName) sharedBy = profileName.textContent || '';
    } catch(e) {}

    try {
        var res = await fetchWithTimeout(API_BASE + '/api/share-notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                video_id: analysisData.video_id,
                title: analysisData.title || '',
                author: analysisData.author || '',
                notes: notes,
                bookmarks: bookmarks,
                overview: overview,
                shared_by: sharedBy
            })
        });

        var data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Lỗi tạo link');

        // Show result
        var config = document.getElementById('shareNotesConfig');
        var result = document.getElementById('shareNotesResult');
        var linkInput = document.getElementById('shareNotesLink');

        if (config) config.classList.add('hidden');
        if (result) result.classList.remove('hidden');
        if (linkInput) {
            linkInput.value = data.share_url;
            linkInput.select();
        }

        showToast('✅ Link chia sẻ đã tạo!');

    } catch(err) {
        if (error) {
            error.textContent = err.message;
            error.classList.remove('hidden');
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Tạo link chia sẻ';
        }
    }
}

async function copyShareNotesLink() {
    var linkInput = document.getElementById('shareNotesLink');
    var btn = document.getElementById('shareNotesCopyBtn');
    if (!linkInput?.value) return;

    try {
        await navigator.clipboard.writeText(linkInput.value);
        if (btn) btn.innerHTML = '✅ Đã copy!';
        setTimeout(function() {
            if (btn) btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy';
        }, 2000);
        showToast('✅ Đã copy link!');
    } catch(e) {
        showToast('❌ Không thể copy');
    }
}
