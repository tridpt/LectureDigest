/* ════════════════════════════════════════════════
   LectureDigest — Collaborative Study Rooms
   Create rooms, invite members, discuss, compare progress
   ════════════════════════════════════════════════ */

// Register sections + routes
if (typeof SECTION_IDS !== 'undefined') {
    if (!SECTION_IDS.includes('studyRoomsSection')) SECTION_IDS.push('studyRoomsSection');
    if (!SECTION_IDS.includes('roomDetailSection')) SECTION_IDS.push('roomDetailSection');
}
if (typeof SPA_ROUTES !== 'undefined') {
    SPA_ROUTES['studyRoomsSection'] = '/rooms';
    SPA_ROUTES['roomDetailSection'] = null; // dynamic
}

var _srRooms = [];
var _srCurrentRoom = null;
var _srCurrentTab = 'discussion';
var _srSelectedIcon = '📚';
var _srPollTimer = null;

// ══════════════════════════════════════════════════════
// OPEN / CLOSE
// ══════════════════════════════════════════════════════

function openStudyRooms() {
    showSection('studyRoomsSection');
    srLoadRooms();
}

function closeStudyRooms() {
    _srStopPolling();
    showSection('hero');
}

function srBackToList() {
    _srStopPolling();
    _srCurrentRoom = null;
    showSection('studyRoomsSection');
    srLoadRooms();
}

// ══════════════════════════════════════════════════════
// AUTH HELPER
// ══════════════════════════════════════════════════════

function _srAuthHeaders() {
    var token = '';
    try { token = localStorage.getItem('ld_auth_token') || ''; } catch(e) {}
    if (!token) {
        // Only show auth modal if it's not already open
        var overlay = document.getElementById('authModalOverlay');
        var isAlreadyOpen = overlay && !overlay.classList.contains('hidden');
        if (!isAlreadyOpen) {
            showToast('Vui lòng đăng nhập để sử dụng phòng học nhóm', 3000);
            if (typeof openAuthModal === 'function') openAuthModal('login');
        }
        return null;
    }
    return {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
    };
}

async function _srFetch(url, opts) {
    var headers = _srAuthHeaders();
    if (!headers) return null;
    opts = opts || {};
    opts.headers = headers;
    try {
        var res = await fetchWithTimeout(API_BASE + url, opts, 15000);
        if (res.status === 401) {
            showToast('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại', 3000);
            return null;
        }
        return res;
    } catch(e) {
        showToast('Lỗi kết nối: ' + e.message, 3000);
        return null;
    }
}

// ══════════════════════════════════════════════════════
// ROOM LIST
// ══════════════════════════════════════════════════════

async function srLoadRooms() {
    var listEl = document.getElementById('srRoomList');
    var emptyEl = document.getElementById('srEmpty');
    if (listEl) listEl.innerHTML = '<div class="sr-loading">Đang tải...</div>';
    if (emptyEl) emptyEl.classList.add('hidden');

    var res = await _srFetch('/api/rooms');
    if (!res) return;

    if (!res.ok) {
        if (listEl) listEl.innerHTML = '<div class="sr-error">Không thể tải danh sách phòng</div>';
        return;
    }

    _srRooms = await res.json();

    if (_srRooms.length === 0) {
        if (listEl) listEl.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');
    if (listEl) {
        listEl.innerHTML = _srRooms.map(function(room) {
            return '<div class="sr-room-card" onclick="srOpenRoom(\'' + room.id + '\')">'
                + '<div class="sr-room-icon">' + (room.icon || '📚') + '</div>'
                + '<div class="sr-room-info">'
                + '<div class="sr-room-name">' + _srEsc(room.name) + '</div>'
                + '<div class="sr-room-meta">'
                + '<span>👤 ' + room.member_count + ' thành viên</span>'
                + '<span>🎬 ' + room.video_count + ' videos</span>'
                + '</div></div>'
                + '<div class="sr-room-role">' + (room.role === 'owner' ? '👑' : '👤') + '</div>'
                + '</div>';
        }).join('');
    }
}

// ══════════════════════════════════════════════════════
// ROOM DETAIL
// ══════════════════════════════════════════════════════

async function srOpenRoom(roomId) {
    var res = await _srFetch('/api/rooms/' + roomId);
    if (!res || !res.ok) {
        showToast('Không thể mở phòng', 3000);
        return;
    }

    _srCurrentRoom = await res.json();
    _srRenderRoomDetail();
    showSection('roomDetailSection');
    srSwitchTab('discussion');
    _srStartPolling();
}

function _srRenderRoomDetail() {
    if (!_srCurrentRoom) return;
    var room = _srCurrentRoom;

    var titleEl = document.getElementById('srRoomTitle');
    var descEl = document.getElementById('srRoomDesc');
    if (titleEl) titleEl.textContent = (room.icon || '📚') + ' ' + room.name;
    if (descEl) descEl.textContent = room.description || '';
}

// ══════════════════════════════════════════════════════
// TABS
// ══════════════════════════════════════════════════════

function srSwitchTab(tab) {
    _srCurrentTab = tab;
    var tabs = ['discussion', 'videos', 'progress', 'members'];
    tabs.forEach(function(t) {
        var tabBtn = document.getElementById('srTab' + t.charAt(0).toUpperCase() + t.slice(1));
        var panel = document.getElementById('srPanel' + t.charAt(0).toUpperCase() + t.slice(1));
        if (tabBtn) tabBtn.classList.toggle('sr-tab-active', t === tab);
        if (panel) panel.classList.toggle('hidden', t !== tab);
    });

    if (tab === 'discussion') srLoadComments();
    else if (tab === 'videos') _srRenderVideos();
    else if (tab === 'progress') srLoadProgress();
    else if (tab === 'members') _srRenderMembers();
}

// ══════════════════════════════════════════════════════
// DISCUSSION / COMMENTS
// ══════════════════════════════════════════════════════

async function srLoadComments() {
    if (!_srCurrentRoom) return;
    var msgEl = document.getElementById('srMessages');
    if (!msgEl) return;

    var res = await _srFetch('/api/rooms/' + _srCurrentRoom.id + '/comments?limit=100');
    if (!res || !res.ok) return;

    var comments = await res.json();
    comments.reverse(); // oldest first

    if (comments.length === 0) {
        msgEl.innerHTML = '<div class="sr-no-comments">Chưa có bình luận nào. Hãy bắt đầu thảo luận! 💬</div>';
        return;
    }

    var canModerate = _srIsModOrOwner();
    var myId = _authUser ? _authUser.id : null;

    msgEl.innerHTML = comments.map(function(c) {
        var time = new Date(c.created_at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
        var initial = (c.display_name || '?').charAt(0).toUpperCase();
        var avatarHtml = c.avatar_url
            ? '<img class="sr-msg-avatar-img" src="' + c.avatar_url + '" alt="">'
            : '<div class="sr-msg-avatar" style="background:' + (c.avatar_color || '#8b5cf6') + '">' + initial + '</div>';

        // Owner/moderator can delete any message, user can delete their own
        var canDelete = canModerate || c.user_id === myId;
        var deleteBtn = canDelete
            ? '<button class="sr-msg-del" onclick="srDeleteComment(' + c.id + ')" title="Xóa">✕</button>'
            : '';

        return '<div class="sr-msg">'
            + avatarHtml
            + '<div class="sr-msg-body">'
            + '<div class="sr-msg-header">'
            + '<span class="sr-msg-name">' + _srEsc(c.display_name) + '</span>'
            + '<span class="sr-msg-time">' + time + '</span>'
            + deleteBtn
            + '</div>'
            + '<div class="sr-msg-text">' + _srEsc(c.content) + '</div>'
            + (c.video_id ? '<div class="sr-msg-tag">🎬 ' + _srEsc(c.video_id) + '</div>' : '')
            + '</div></div>';
    }).join('');

    msgEl.scrollTop = msgEl.scrollHeight;
}

async function srDeleteComment(commentId) {
    if (!_srCurrentRoom) return;
    var res = await _srFetch('/api/rooms/' + _srCurrentRoom.id + '/comments/' + commentId, { method: 'DELETE' });
    if (res && res.ok) {
        srLoadComments();
    } else {
        showToast('❌ Không thể xóa bình luận', 3000);
    }
}

async function srPostComment() {
    if (!_srCurrentRoom) return;
    var input = document.getElementById('srCommentInput');
    var content = (input.value || '').trim();
    if (!content) return;

    var payload = { content: content, video_id: '', chapter: '' };
    var res = await _srFetch('/api/rooms/' + _srCurrentRoom.id + '/comments', {
        method: 'POST',
        body: JSON.stringify(payload)
    });

    if (res && res.ok) {
        input.value = '';
        srLoadComments();
    }
}

// ══════════════════════════════════════════════════════
// VIDEOS
// ══════════════════════════════════════════════════════

function _srIsOwner() {
    if (!_srCurrentRoom || !_authUser) return false;
    return _srCurrentRoom.owner_id === _authUser.id;
}

function _srIsModOrOwner() {
    if (!_srCurrentRoom || !_authUser) return false;
    if (_srCurrentRoom.owner_id === _authUser.id) return true;
    var members = _srCurrentRoom.members || [];
    for (var i = 0; i < members.length; i++) {
        if (members[i].user_id === _authUser.id && members[i].role === 'moderator') return true;
    }
    return false;
}

function _srMyRole() {
    if (!_srCurrentRoom || !_authUser) return 'member';
    if (_srCurrentRoom.owner_id === _authUser.id) return 'owner';
    var members = _srCurrentRoom.members || [];
    for (var i = 0; i < members.length; i++) {
        if (members[i].user_id === _authUser.id) return members[i].role;
    }
    return 'member';
}

function _srRenderVideos() {
    if (!_srCurrentRoom) return;
    var el = document.getElementById('srVideoList');
    if (!el) return;

    var videos = _srCurrentRoom.videos || [];
    if (videos.length === 0) {
        el.innerHTML = '<div class="sr-no-comments">Chưa có video nào. Thêm video từ lịch sử phân tích!</div>';
        return;
    }

    var canManage = _srIsModOrOwner();
    el.innerHTML = videos.map(function(v) {
        var deleteBtn = canManage
            ? '<button class="sr-video-del-btn" onclick="event.stopPropagation();srRemoveVideo(\'' + v.video_id + '\')" title="Xóa video">🗑️</button>'
            : '';
        return '<div class="sr-video-card" onclick="srViewVideo(\'' + v.video_id + '\')" style="cursor:pointer">'
            + (v.thumbnail ? '<img class="sr-video-thumb" src="' + v.thumbnail + '" alt="">' : '<div class="sr-video-thumb-placeholder">🎬</div>')
            + '<div class="sr-video-info">'
            + '<div class="sr-video-title">' + _srEsc(v.title || v.video_id) + '</div>'
            + '<div class="sr-video-meta">Thêm lúc ' + new Date(v.added_at).toLocaleDateString('vi-VN') + '</div>'
            + '</div>'
            + '<div class="sr-video-actions">'
            + '<button class="sr-video-view-btn" onclick="event.stopPropagation();srViewVideo(\'' + v.video_id + '\')">📖 Xem phân tích</button>'
            + deleteBtn
            + '</div></div>';
    }).join('');
}

async function srRemoveVideo(videoId) {
    if (!_srCurrentRoom) return;
    if (!confirm('Xóa video này khỏi phòng?')) return;

    var res = await _srFetch('/api/rooms/' + _srCurrentRoom.id + '/videos/' + videoId, { method: 'DELETE' });
    if (res && res.ok) {
        showToast('✅ Đã xóa video', 2000);
        srOpenRoom(_srCurrentRoom.id);
    } else {
        showToast('❌ Không thể xóa video', 3000);
    }
}

function _srHasVideoInHistory(videoId) {
    try {
        var history = JSON.parse(localStorage.getItem('lectureDigest_history') || '[]');
        for (var i = 0; i < history.length; i++) {
            if (history[i].video_id === videoId && history[i].data) return true;
        }
    } catch(e) {}
    return false;
}

function srViewVideo(videoId) {
    // Try to load from local history first
    var history = [];
    try { history = JSON.parse(localStorage.getItem('lectureDigest_history') || '[]'); } catch(e) {}
    var entry = null;
    for (var i = 0; i < history.length; i++) {
        if (history[i].video_id === videoId && history[i].data) {
            entry = history[i];
            break;
        }
    }
    if (entry) {
        if (typeof loadFromHistory === 'function') {
            loadFromHistory(entry.entry_id || entry.video_id);
        }
        return;
    }
    // Not in local history — fetch from room server
    _srFetchAndViewVideo(videoId);
}

async function _srFetchAndViewVideo(videoId) {
    if (!_srCurrentRoom) return;
    showToast('Đang tải bài phân tích...', 2000);

    var res = await _srFetch('/api/rooms/' + _srCurrentRoom.id + '/videos/' + videoId);
    if (!res || !res.ok) {
        showToast('Không thể tải bài phân tích', 3000);
        return;
    }

    var videoData = await res.json();
    if (!videoData.data_json) {
        showToast('Video này chưa có dữ liệu phân tích', 3000);
        return;
    }

    var data;
    try { data = JSON.parse(videoData.data_json); } catch(e) {
        showToast('Dữ liệu phân tích bị lỗi', 3000);
        return;
    }

    // Load the analysis into the app
    var urlInput = document.getElementById('urlInput');
    if (urlInput) urlInput.value = videoData.url || ('https://www.youtube.com/watch?v=' + videoId);
    window.analysisData = data;
    window._spaVideoId = videoId;
    if (typeof clearChat === 'function') clearChat();
    if (typeof renderResults === 'function') renderResults(data);
    if (typeof initNotes === 'function') initNotes(videoId);
    if (typeof renderTranscript === 'function') renderTranscript(data.transcript || []);
    if (typeof initProgress === 'function') initProgress(videoId);
    if (typeof initBookmarks === 'function') initBookmarks(videoId);
    showSection('resultsSection');
}

function srAnalyzeVideo(videoId) {
    var url = 'https://www.youtube.com/watch?v=' + videoId;
    var urlInput = document.getElementById('urlInput');
    if (urlInput) urlInput.value = url;
    showSection('hero');
    // Auto-trigger analysis
    setTimeout(function() {
        if (typeof analyzeVideo === 'function') analyzeVideo();
    }, 200);
}

async function srAddCurrentVideo() {
    // This is now handled by the picker — kept for backward compat
    srOpenVideoPicker();
}

function srOpenVideoPicker() {
    if (!_srCurrentRoom) return;

    var history = [];
    try { history = JSON.parse(localStorage.getItem('lectureDigest_history') || '[]'); } catch(e) {}

    // Filter: only videos with analysis data, exclude already-added ones
    var existingIds = (_srCurrentRoom.videos || []).map(function(v) { return v.video_id; });
    var available = history.filter(function(h) {
        return h.video_id && h.data && existingIds.indexOf(h.video_id) < 0;
    });

    if (available.length === 0) {
        showToast('Không có video mới để thêm. Hãy phân tích video trước hoặc tất cả đã được thêm.', 3000);
        return;
    }

    // Build picker modal
    var html = '<div class="sr-modal-overlay" id="srVideoPickerModal" onclick="if(event.target===this)srCloseVideoPicker()">'
        + '<div class="sr-modal" style="max-width:560px;max-height:80vh;display:flex;flex-direction:column">'
        + '<h2 class="sr-modal-title">📤 Chọn video để chia sẻ</h2>'
        + '<p class="sr-modal-desc">Chọn video đã phân tích để thêm vào phòng học nhóm:</p>'
        + '<div class="sr-picker-list" style="overflow-y:auto;flex:1;margin:12px 0">';

    available.forEach(function(h) {
        var thumb = h.thumbnail || ('https://img.youtube.com/vi/' + h.video_id + '/mqdefault.jpg');
        html += '<div class="sr-picker-item" onclick="srPickVideo(\'' + h.video_id + '\')">'
            + '<img class="sr-picker-thumb" src="' + thumb + '" alt="" onerror="this.style.display=\'none\'">'
            + '<div class="sr-picker-info">'
            + '<div class="sr-picker-title">' + _srEsc(h.title || h.video_id) + '</div>'
            + '<div class="sr-picker-meta">' + (h.author || '') + '</div>'
            + '</div></div>';
    });

    html += '</div>'
        + '<div class="sr-modal-actions"><button type="button" class="sr-modal-cancel" onclick="srCloseVideoPicker()">Đóng</button></div>'
        + '</div></div>';

    // Append to body
    var container = document.createElement('div');
    container.id = 'srPickerWrap';
    container.innerHTML = html;
    document.body.appendChild(container);
}

function srCloseVideoPicker() {
    var wrap = document.getElementById('srPickerWrap');
    if (wrap) wrap.remove();
}

async function srPickVideo(videoId) {
    var history = [];
    try { history = JSON.parse(localStorage.getItem('lectureDigest_history') || '[]'); } catch(e) {}

    var entry = null;
    for (var i = 0; i < history.length; i++) {
        if (history[i].video_id === videoId) { entry = history[i]; break; }
    }

    if (!entry || !entry.data) {
        showToast('Không tìm thấy dữ liệu phân tích', 3000);
        return;
    }

    srCloseVideoPicker();
    showToast('Đang tải lên...', 2000);

    var dataJson = JSON.stringify(entry.data);
    var res = await _srFetch('/api/rooms/' + _srCurrentRoom.id + '/videos', {
        method: 'POST',
        body: JSON.stringify({
            video_id: entry.video_id,
            title: entry.title || '',
            thumbnail: entry.thumbnail || '',
            url: entry.url || ('https://www.youtube.com/watch?v=' + entry.video_id),
            data_json: dataJson
        })
    });

    if (res && res.ok) {
        showToast('✅ Đã thêm video vào phòng', 2000);
        srOpenRoom(_srCurrentRoom.id);
    } else if (res) {
        var err = await res.json().catch(function() { return {}; });
        showToast('❌ ' + (err.detail || 'Không thể thêm video'), 3000);
    }
}

// ══════════════════════════════════════════════════════
// PROGRESS COMPARISON
// ══════════════════════════════════════════════════════

async function srLoadProgress() {
    if (!_srCurrentRoom) return;
    var el = document.getElementById('srProgressGrid');
    if (!el) return;

    var res = await _srFetch('/api/rooms/' + _srCurrentRoom.id + '/progress');
    if (!res || !res.ok) return;

    var data = await res.json();
    if (data.length === 0) {
        el.innerHTML = '<div class="sr-no-comments">Chưa có dữ liệu tiến độ. Thành viên cần đồng bộ tiến độ quiz/flashcard.</div>';
        return;
    }

    // Group by video
    var byVideo = {};
    data.forEach(function(p) {
        if (!byVideo[p.video_id]) byVideo[p.video_id] = [];
        byVideo[p.video_id].push(p);
    });

    var html = '';
    for (var vid in byVideo) {
        var entries = byVideo[vid];
        var videoTitle = '';
        // Try to find title from room videos
        (_srCurrentRoom.videos || []).forEach(function(v) {
            if (v.video_id === vid) videoTitle = v.title;
        });

        html += '<div class="sr-progress-card">';
        html += '<div class="sr-progress-video-title">🎬 ' + _srEsc(videoTitle || vid) + '</div>';
        html += '<div class="sr-progress-table">';
        html += '<div class="sr-progress-row sr-progress-header"><span>Thành viên</span><span>Quiz</span><span>Xem</span><span>Flashcard</span></div>';

        entries.forEach(function(p) {
            var quizPct = p.quiz_total > 0 ? Math.round(p.quiz_score / p.quiz_total * 100) + '%' : '—';
            var fcPct = p.flashcards_total > 0 ? Math.round(p.flashcards_mastered / p.flashcards_total * 100) + '%' : '—';
            html += '<div class="sr-progress-row">'
                + '<span class="sr-progress-name">' + _srEsc(p.display_name) + '</span>'
                + '<span class="sr-progress-val">' + quizPct + '</span>'
                + '<span class="sr-progress-val">' + p.watch_pct + '%</span>'
                + '<span class="sr-progress-val">' + fcPct + '</span>'
                + '</div>';
        });

        html += '</div></div>';
    }

    el.innerHTML = html;
}

// ══════════════════════════════════════════════════════
// MEMBERS
// ══════════════════════════════════════════════════════

function _srRenderMembers() {
    if (!_srCurrentRoom) return;
    var el = document.getElementById('srMemberList');
    if (!el) return;

    var members = _srCurrentRoom.members || [];
    var isOwner = _srIsOwner();
    var myRole = _srMyRole();
    var myId = _authUser ? _authUser.id : null;

    el.innerHTML = members.map(function(m) {
        var initial = (m.display_name || '?').charAt(0).toUpperCase();
        var avatarHtml = m.avatar_url
            ? '<img class="sr-member-avatar-img" src="' + m.avatar_url + '" alt="">'
            : '<div class="sr-member-avatar" style="background:' + (m.avatar_color || '#8b5cf6') + '">' + initial + '</div>';

        var roleLabel = m.role === 'owner' ? '👑 Chủ phòng' : m.role === 'moderator' ? '🛡️ Quản lý' : '👤 Thành viên';
        var joinDate = new Date(m.joined_at).toLocaleDateString('vi-VN');

        // Admin controls
        var adminHtml = '';
        if (m.user_id !== myId) {
            if (isOwner) {
                // Owner can promote/demote and kick anyone
                adminHtml = '<div class="sr-member-actions">';
                if (m.role === 'member') {
                    adminHtml += '<button class="sr-member-action-btn sr-promote-btn" onclick="srChangeRole(' + m.user_id + ',\'moderator\')" title="Thăng quản lý">🛡️</button>';
                } else if (m.role === 'moderator') {
                    adminHtml += '<button class="sr-member-action-btn sr-demote-btn" onclick="srChangeRole(' + m.user_id + ',\'member\')" title="Hạ thành viên">👤</button>';
                }
                adminHtml += '<button class="sr-member-action-btn sr-kick-btn" onclick="srKickMember(' + m.user_id + ',\'' + _srEsc(m.display_name) + '\')" title="Kick">❌</button>';
                adminHtml += '</div>';
            } else if (myRole === 'moderator' && m.role === 'member') {
                // Moderator can only kick regular members
                adminHtml = '<div class="sr-member-actions">';
                adminHtml += '<button class="sr-member-action-btn sr-kick-btn" onclick="srKickMember(' + m.user_id + ',\'' + _srEsc(m.display_name) + '\')" title="Kick">❌</button>';
                adminHtml += '</div>';
            }
        }

        return '<div class="sr-member-card">'
            + avatarHtml
            + '<div class="sr-member-info">'
            + '<div class="sr-member-name">' + _srEsc(m.display_name) + (m.user_id === myId ? ' <span style="opacity:0.5">(bạn)</span>' : '') + '</div>'
            + '<div class="sr-member-meta">' + roleLabel + ' · Tham gia ' + joinDate + '</div>'
            + '</div>'
            + adminHtml
            + '</div>';
    }).join('');
}

async function srKickMember(userId, name) {
    if (!_srCurrentRoom) return;
    if (!confirm('Kick "' + name + '" khỏi phòng?')) return;

    var res = await _srFetch('/api/rooms/' + _srCurrentRoom.id + '/kick/' + userId, { method: 'POST' });
    if (res && res.ok) {
        showToast('✅ Đã kick ' + name, 2000);
        srOpenRoom(_srCurrentRoom.id);
    } else {
        showToast('❌ Không thể kick thành viên', 3000);
    }
}

async function srChangeRole(userId, newRole) {
    if (!_srCurrentRoom) return;

    var res = await _srFetch('/api/rooms/' + _srCurrentRoom.id + '/role/' + userId, {
        method: 'POST',
        body: JSON.stringify({ role: newRole })
    });
    if (res && res.ok) {
        var label = newRole === 'moderator' ? 'quản lý' : 'thành viên';
        showToast('✅ Đã đổi quyền thành ' + label, 2000);
        srOpenRoom(_srCurrentRoom.id);
    } else {
        showToast('❌ Không thể đổi quyền', 3000);
    }
}

// ══════════════════════════════════════════════════════
// CREATE ROOM
// ══════════════════════════════════════════════════════

function srOpenCreateModal() {
    document.getElementById('srCreateModal').classList.remove('hidden');
    document.getElementById('srNewName').value = '';
    document.getElementById('srNewDesc').value = '';
    _srSelectedIcon = '📚';
}

function srCloseCreateModal() {
    document.getElementById('srCreateModal').classList.add('hidden');
}

function srPickIcon(btn, icon) {
    _srSelectedIcon = icon;
    document.querySelectorAll('.sr-icon-opt').forEach(function(b) { b.classList.remove('sr-icon-selected'); });
    btn.classList.add('sr-icon-selected');
}

async function srCreateRoom() {
    var name = (document.getElementById('srNewName').value || '').trim();
    if (!name) {
        showToast('Vui lòng nhập tên phòng', 2000);
        return;
    }

    var desc = (document.getElementById('srNewDesc').value || '').trim();
    var btn = document.getElementById('srCreateBtn');
    if (btn) btn.disabled = true;

    var res = await _srFetch('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({ name: name, description: desc, icon: _srSelectedIcon })
    });

    if (btn) btn.disabled = false;

    if (res && res.ok) {
        var room = await res.json();
        showToast('✅ Đã tạo phòng "' + name + '"', 3000);
        srCloseCreateModal();
        srLoadRooms();
    } else if (res) {
        var err = await res.json().catch(function() { return {}; });
        showToast('❌ ' + (err.detail || 'Không thể tạo phòng'), 3000);
    }
}

// ══════════════════════════════════════════════════════
// JOIN
// ══════════════════════════════════════════════════════

async function srJoinByCode() {
    var input = document.getElementById('srJoinInput');
    var code = (input.value || '').trim();
    if (!code) {
        showToast('Vui lòng nhập mã mời', 2000);
        return;
    }

    var res = await _srFetch('/api/rooms/join/' + encodeURIComponent(code), { method: 'POST' });
    if (res && res.ok) {
        var data = await res.json();
        input.value = '';
        if (data.already_member) {
            showToast('Bạn đã là thành viên phòng này', 2000);
        } else {
            showToast('✅ Đã tham gia phòng "' + (data.room_name || '') + '"', 3000);
        }
        srLoadRooms();
    } else if (res) {
        var err = await res.json().catch(function() { return {}; });
        showToast('❌ ' + (err.detail || 'Mã mời không hợp lệ'), 3000);
    }
}

// ══════════════════════════════════════════════════════
// INVITE
// ══════════════════════════════════════════════════════

function srShowInvite() {
    if (!_srCurrentRoom) return;
    document.getElementById('srInviteCode').textContent = _srCurrentRoom.invite_code;
    document.getElementById('srInviteModal').classList.remove('hidden');
}

function srCloseInviteModal() {
    document.getElementById('srInviteModal').classList.add('hidden');
}

function srCopyInvite() {
    if (!_srCurrentRoom) return;
    try {
        navigator.clipboard.writeText(_srCurrentRoom.invite_code);
        showToast('📋 Đã copy mã mời!', 2000);
    } catch(e) {
        // Fallback
        var el = document.getElementById('srInviteCode');
        var range = document.createRange();
        range.selectNodeContents(el);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
        showToast('📋 Đã copy mã mời!', 2000);
    }
}

// ══════════════════════════════════════════════════════
// POLLING (simple refresh for "real-time" feel)
// ══════════════════════════════════════════════════════

function _srStartPolling() {
    _srStopPolling();
    _srPollTimer = setInterval(function() {
        if (_srCurrentTab === 'discussion' && _srCurrentRoom) {
            srLoadComments();
        }
    }, 10000); // Poll every 10 seconds
}

function _srStopPolling() {
    if (_srPollTimer) {
        clearInterval(_srPollTimer);
        _srPollTimer = null;
    }
}

// ══════════════════════════════════════════════════════
// SYNC PROGRESS TO ROOM
// ══════════════════════════════════════════════════════

async function srSyncMyProgress() {
    if (!_srCurrentRoom) return;
    var videos = _srCurrentRoom.videos || [];
    if (videos.length === 0) return;

    for (var i = 0; i < videos.length; i++) {
        var v = videos[i];
        var videoId = v.video_id;
        var payload = { video_id: videoId, quiz_score: -1, quiz_total: 0, watch_pct: 0, flashcards_mastered: 0, flashcards_total: 0 };

        // Get quiz data
        try {
            var progressRaw = localStorage.getItem('lectureDigest_progress_' + videoId);
            if (progressRaw) {
                var progress = JSON.parse(progressRaw);
                if (progress.quizHistory && progress.quizHistory.length > 0) {
                    var lastQuiz = progress.quizHistory[progress.quizHistory.length - 1];
                    payload.quiz_score = lastQuiz.score || 0;
                    payload.quiz_total = lastQuiz.total || lastQuiz.answered || 0;
                }
                if (progress.watchProgress) payload.watch_pct = progress.watchProgress;
            }
        } catch(e) {}

        // Get SRS data
        try {
            var sm2Raw = localStorage.getItem('lectureDigest_sm2_' + videoId);
            if (sm2Raw) {
                var sm2Data = JSON.parse(sm2Raw);
                var total = 0, mastered = 0;
                for (var key in sm2Data) {
                    total++;
                    if (sm2Data[key].interval >= 21) mastered++;
                }
                payload.flashcards_total = total;
                payload.flashcards_mastered = mastered;
            }
        } catch(e) {}

        // Only sync if there's actual data
        if (payload.quiz_score >= 0 || payload.watch_pct > 0 || payload.flashcards_total > 0) {
            await _srFetch('/api/rooms/' + _srCurrentRoom.id + '/progress', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
        }
    }

    showToast('✅ Đã đồng bộ tiến độ', 2000);
}

// ══════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════

function _srEsc(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
