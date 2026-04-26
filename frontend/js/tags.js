/* ════════════════════════════════════════════════
   LectureDigest — Video Tags / Categorization
   ════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════
// VIDEO TAGS / CATEGORIZATION
// ══════════════════════════════════════════════════════

var TAG_KEY = 'lectureDigest_tags';
var PREDEFINED_TAGS = [
    { id: 'programming', label: 'Lap trinh',  color: '#3b82f6', icon: '\ud83d\udcbb' },
    { id: 'math',        label: 'Toan',       color: '#8b5cf6', icon: '\ud83d\udcca' },
    { id: 'science',     label: 'Khoa hoc',   color: '#10b981', icon: '\ud83d\udd2c' },
    { id: 'language',    label: 'Ngon ngu',    color: '#f59e0b', icon: '\ud83c\udf0d' },
    { id: 'business',    label: 'Kinh doanh',  color: '#ef4444', icon: '\ud83d\udcb0' },
    { id: 'design',      label: 'Thiet ke',    color: '#ec4899', icon: '\ud83c\udfa8' },
    { id: 'music',       label: 'Am nhac',     color: '#06b6d4', icon: '\ud83c\udfb5' },
    { id: 'history',     label: 'Lich su',     color: '#78716c', icon: '\ud83d\udcdc' },
    { id: 'health',      label: 'Suc khoe',    color: '#22c55e', icon: '\ud83c\udfc3' },
    { id: 'other',       label: 'Khac',        color: '#6b7280', icon: '\ud83d\udccc' }
];

function loadAllTags() {
    try { return JSON.parse(localStorage.getItem(TAG_KEY) || '{}'); }
    catch(e) { return {}; }
}

function saveAllTags(data) {
    try { localStorage.setItem(TAG_KEY, JSON.stringify(data)); } catch(e) {}
}

function getVideoTags(videoId) {
    var all = loadAllTags();
    return all[videoId] || [];
}

function setVideoTags(videoId, tags) {
    var all = loadAllTags();
    all[videoId] = tags;
    saveAllTags(all);
}

function addTagToVideo(videoId, tagId) {
    var tags = getVideoTags(videoId);
    if (tags.indexOf(tagId) < 0) {
        tags.push(tagId);
        setVideoTags(videoId, tags);
    }
    renderHistoryPanel();
}

function removeTagFromVideo(videoId, tagId) {
    var tags = getVideoTags(videoId).filter(function(t) { return t !== tagId; });
    setVideoTags(videoId, tags);
    renderHistoryPanel();
}

function getTagInfo(tagId) {
    for (var i = 0; i < PREDEFINED_TAGS.length; i++) {
        if (PREDEFINED_TAGS[i].id === tagId) return PREDEFINED_TAGS[i];
    }
    return { id: tagId, label: tagId, color: '#6b7280', icon: '\ud83c\udff7\ufe0f' };
}

function renderTagBadges(videoId) {
    var tags = getVideoTags(videoId);
    if (!tags.length) return '';
    return tags.map(function(tagId) {
        var tag = getTagInfo(tagId);
        return '<span class="hist-tag" style="background:' + tag.color + '22;color:' + tag.color + ';border:1px solid ' + tag.color + '44" title="' + tag.label + '">'
            + tag.icon + ' ' + tag.label
            + '<span class="hist-tag-x" onclick="event.stopPropagation();removeTagFromVideo(\'' + videoId + '\',\'' + tagId + '\')">&times;</span>'
            + '</span>';
    }).join('');
}

// Tag picker dropdown
function showTagPicker(videoId, btnEl) {
    // Remove existing
    var existing = document.getElementById('tagPickerDrop');
    if (existing) { existing.remove(); return; }

    var currentTags = getVideoTags(videoId);
    var drop = document.createElement('div');
    drop.id = 'tagPickerDrop';
    drop.className = 'tag-picker-drop';

    var html = '<div class="tag-picker-title">Gan tag</div>';
    PREDEFINED_TAGS.forEach(function(tag) {
        var isActive = currentTags.indexOf(tag.id) >= 0;
        html += '<div class="tag-picker-item' + (isActive ? ' active' : '') + '" '
            + 'onclick="event.stopPropagation();toggleVideoTag(\'' + videoId + '\',\'' + tag.id + '\')">'
            + '<span class="tag-picker-icon">' + tag.icon + '</span>'
            + '<span class="tag-picker-label">' + tag.label + '</span>'
            + (isActive ? '<span class="tag-picker-check">\u2713</span>' : '')
            + '</div>';
    });
    drop.innerHTML = html;

    // Position near the button
    if (btnEl) {
        btnEl.style.position = 'relative';
        btnEl.appendChild(drop);
    } else {
        document.body.appendChild(drop);
    }

    // Close on outside click
    setTimeout(function() {
        document.addEventListener('click', function closeTagPicker(e) {
            if (!drop.contains(e.target)) {
                drop.remove();
                document.removeEventListener('click', closeTagPicker);
            }
        });
    }, 50);
}

function toggleVideoTag(videoId, tagId) {
    var tags = getVideoTags(videoId);
    var idx = tags.indexOf(tagId);
    if (idx >= 0) {
        tags.splice(idx, 1);
    } else {
        tags.push(tagId);
    }
    setVideoTags(videoId, tags);
    // Close picker and re-render
    var picker = document.getElementById('tagPickerDrop');
    if (picker) picker.remove();
    renderHistoryPanel();
}

// Active tag filter for history
var _historyTagFilter = '';

function filterHistoryByTag(tagId) {
    _historyTagFilter = (_historyTagFilter === tagId) ? '' : tagId;
    renderHistoryPanel();
    // Update filter button states
    var btns = document.querySelectorAll('.tag-filter-btn');
    btns.forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-tag') === _historyTagFilter);
    });
}


// ── Copy Result Link ──────────────────────
function copyResultLink() {
    var vid = window._spaVideoId || (window.analysisData && window.analysisData.video_id);
    if (!vid) { showToast('Chua co video nao'); return; }
    var url = window.location.origin + '/results/' + vid;
    navigator.clipboard.writeText(url).then(function() {
        showToast('Da copy link ket qua!');
    }).catch(function() {
        // Fallback
        var ta = document.createElement('textarea');
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('Da copy link ket qua!');
    });
}


