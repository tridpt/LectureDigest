/* ════════════════════════════════════════════════
   LectureDigest — Chat Rooms
   Standalone real-time chat system
   ════════════════════════════════════════════════ */

// Register sections + routes
if (typeof SECTION_IDS !== 'undefined') {
    if (!SECTION_IDS.includes('chatRoomsSection')) SECTION_IDS.push('chatRoomsSection');
    if (!SECTION_IDS.includes('chatDetailSection')) SECTION_IDS.push('chatDetailSection');
}
if (typeof SPA_ROUTES !== 'undefined') {
    SPA_ROUTES['chatRoomsSection'] = '/chat';
    SPA_ROUTES['chatDetailSection'] = null; // dynamic
}

var _crRooms = [];
var _crCurrentRoom = null;
var _crMessages = [];
var _crPollTimer = null;
var _crSelectedIcon = '💬';
var _crCurrentUserId = null;

// ══════════════════════════════════════════════════════
// OPEN / CLOSE
// ══════════════════════════════════════════════════════

function openChatRooms() {
    _crCurrentUserId = _crGetCurrentUserId();
    showSection('chatRoomsSection');
    crLoadRooms();
    var footer = document.querySelector('.footer');
    if (footer) footer.style.display = 'none';
}

function closeChatRooms() {
    _crStopPolling();
    showSection('hero');
    var footer = document.querySelector('.footer');
    if (footer) footer.style.display = '';
}

function crBackToList() {
    _crStopPolling();
    _crCurrentRoom = null;
    _crMessages = [];
    showSection('chatRoomsSection');
    crLoadRooms();
    var footer = document.querySelector('.footer');
    if (footer) footer.style.display = 'none';
}

// ══════════════════════════════════════════════════════
// AUTH HELPER
// ══════════════════════════════════════════════════════

function _crAuthHeaders() {
    var token = '';
    try { token = localStorage.getItem('ld_auth_token') || ''; } catch(e) {}
    if (!token) {
        showToast('Vui lòng đăng nhập để sử dụng phòng chat', 3000);
        if (typeof openAuthModal === 'function') openAuthModal('login');
        return null;
    }
    return {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
    };
}

function _crGetCurrentUserId() {
    try {
        var token = localStorage.getItem('ld_auth_token') || '';
        if (!token) return null;
        var payload = JSON.parse(atob(token.split('.')[1]));
        var uid = payload.sub || payload.user_id || null;
        return uid !== null ? String(uid) : null;
    } catch(e) { return null; }
}

// ══════════════════════════════════════════════════════
// ROOM LIST
// ══════════════════════════════════════════════════════

function crLoadRooms() {
    var headers = _crAuthHeaders();
    if (!headers) return;

    fetchWithTimeout('/api/chat-rooms', { headers: headers }, 10000)
        .then(function(r) { return r.json(); })
        .then(function(data) {
            _crRooms = data.rooms || [];
            _crRenderRoomList();
        })
        .catch(function(err) {
            console.error('Failed to load chat rooms:', err);
            showToast('Không thể tải phòng chat', 3000);
        });
}

function _crRenderRoomList() {
    var container = document.getElementById('crRoomList');
    if (!container) return;

    if (_crRooms.length === 0) {
        container.innerHTML = '<div class="cr-empty" id="crEmptyState"><div style="font-size:3rem">💬</div><p>Chưa có phòng chat nào</p><p style="opacity:0.6;font-size:0.85rem">Tạo phòng mới hoặc tham gia phòng công khai</p></div>';
        return;
    }

    var html = '';
    for (var i = 0; i < _crRooms.length; i++) {
        var room = _crRooms[i];
        var lastMsg = room.last_message;
        var preview = lastMsg ? (lastMsg.username + ': ' + lastMsg.content) : 'Chưa có tin nhắn';
        if (preview.length > 60) preview = preview.substring(0, 60) + '...';

        html += '<div class="cr-room-card" onclick="crOpenRoom(\'' + room.id + '\')">';
        html += '  <div class="cr-room-icon">' + _crEsc(room.icon) + '</div>';
        html += '  <div class="cr-room-info">';
        html += '    <div class="cr-room-name">' + _crEsc(room.name) + '</div>';
        html += '    <div class="cr-room-meta">';
        html += '      <span>👥 ' + (room.member_count || 0) + '</span>';
        html += '      <span>' + (room.is_public ? '🌐 Công khai' : '🔒 Riêng tư') + '</span>';
        html += '    </div>';
        html += '    <div class="cr-room-preview">' + _crEsc(preview) + '</div>';
        html += '  </div>';
        html += '</div>';
    }
    container.innerHTML = html;
}

// ══════════════════════════════════════════════════════
// OPEN ROOM / CHAT VIEW
// ══════════════════════════════════════════════════════

function crOpenRoom(roomId) {
    var headers = _crAuthHeaders();
    if (!headers) return;

    _crCurrentUserId = _crGetCurrentUserId();

    // Find room in list
    var room = null;
    for (var i = 0; i < _crRooms.length; i++) {
        if (_crRooms[i].id === roomId) { room = _crRooms[i]; break; }
    }
    if (!room) return;

    _crCurrentRoom = room;
    showSection('chatDetailSection');
    var footer = document.querySelector('.footer');
    if (footer) footer.style.display = 'none';

    // Update header
    var iconEl = document.getElementById('crChatRoomIcon');
    var nameEl = document.getElementById('crChatRoomName');
    var membersEl = document.getElementById('crChatRoomMembers');
    if (iconEl) iconEl.textContent = room.icon;
    if (nameEl) nameEl.textContent = room.name;
    if (membersEl) membersEl.textContent = (room.member_count || 0) + ' thành viên';

    // Show/hide delete button (creator only)
    var deleteBtn = document.getElementById('crDeleteRoomBtn');
    var clearBtn = document.getElementById('crClearMsgsBtn');
    var reportsBtn = document.getElementById('crReportsBtn');
    var isCreator = String(room.created_by) === _crCurrentUserId;
    if (deleteBtn) deleteBtn.style.display = isCreator ? '' : 'none';
    if (clearBtn) clearBtn.style.display = isCreator ? '' : 'none';
    // Show reports button for admin/creator
    if (reportsBtn) {
        reportsBtn.classList.add('hidden'); // hidden until _crCheckReports confirms admin
    }
    _crCheckReports();

    // Load messages
    _crLoadMessages();

    // Start polling
    _crStartPolling();
}

function _crLoadMessages() {
    if (!_crCurrentRoom) return;
    var headers = _crAuthHeaders();
    if (!headers) return;

    fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/messages?limit=50', { headers: headers }, 10000)
        .then(function(r) { return r.json(); })
        .then(function(data) {
            _crMessages = data.messages || [];
            _crRenderMessages();
            _crScrollToBottom();
            _crUpdateMuteStatus(data.muted_until);
        })
        .catch(function(err) {
            console.error('Failed to load messages:', err);
        });
}

function _crUpdateMuteStatus(mutedUntil) {
    var inputBar = document.querySelector('.cr-input-bar');
    var muteBar = document.getElementById('crMuteBar');

    if (mutedUntil) {
        var remaining = Math.max(0, Math.floor(mutedUntil - Date.now() / 1000));
        var timeStr;
        if (remaining > 86400) {
            timeStr = Math.floor(remaining / 86400) + ' ngày ' + Math.floor((remaining % 86400) / 3600) + ' giờ';
        } else if (remaining > 3600) {
            timeStr = Math.floor(remaining / 3600) + ' giờ ' + Math.floor((remaining % 3600) / 60) + ' phút';
        } else if (remaining > 60) {
            timeStr = Math.floor(remaining / 60) + ' phút';
        } else {
            timeStr = remaining + ' giây';
        }

        // Hide input bar
        if (inputBar) inputBar.style.display = 'none';

        // Show mute notice
        if (!muteBar) {
            muteBar = document.createElement('div');
            muteBar.id = 'crMuteBar';
            muteBar.className = 'cr-mute-bar';
            var chatContainer = document.querySelector('.cr-chat-container');
            if (chatContainer) chatContainer.appendChild(muteBar);
        }
        muteBar.innerHTML = '🔇 Bạn đã bị cấm chat. Còn <strong>' + timeStr + '</strong> nữa.';
        muteBar.style.display = '';
    } else {
        // Not muted — show input, hide mute bar
        if (inputBar) inputBar.style.display = '';
        if (muteBar) muteBar.style.display = 'none';
    }
}

function _crRenderMessages() {
    var container = document.getElementById('crMessagesList');
    if (!container) return;

    if (_crMessages.length === 0) {
        container.innerHTML = '<div class="cr-empty"><p style="opacity:0.6">Chưa có tin nhắn. Hãy bắt đầu cuộc trò chuyện!</p></div>';
        return;
    }

    var html = '';
    for (var i = 0; i < _crMessages.length; i++) {
        var msg = _crMessages[i];
        var isOwn = String(msg.user_id) === _crCurrentUserId;
        var canDelete = isOwn || (_crCurrentRoom && String(_crCurrentRoom.created_by) === _crCurrentUserId);

        var avatarHtml = _crRenderAvatar(msg.username, msg.avatar_url);
        var timeStr = _crFormatTime(msg.created_at);

        // 3-dot menu (like Messenger)
        var menuHtml = '';
        var isCreator = _crCurrentRoom && String(_crCurrentRoom.created_by) === _crCurrentUserId;
        var showMenu = canDelete || isCreator || !isOwn; // Everyone can report others
        if (showMenu) {
            var menuItems = '';
            if (canDelete) {
                menuItems += '<button class="cr-msg-menu-item cr-msg-menu-danger" onclick="event.stopPropagation();crDeleteMessage(\'' + msg.id + '\')">🗑️ Xóa tin nhắn</button>';
            }
            if (isCreator) {
                var pinLabel = msg.pinned ? '📌 Bỏ ghim' : '📌 Ghim tin nhắn';
                menuItems += '<button class="cr-msg-menu-item" onclick="event.stopPropagation();crPinMessage(\'' + msg.id + '\')">' + pinLabel + '</button>';
            }
            if (isCreator && !isOwn) {
                menuItems += '<button class="cr-msg-menu-item cr-msg-menu-danger" onclick="event.stopPropagation();crBanUser(' + msg.user_id + ')">🚫 Chặn người này</button>';
            }
            // Report option for non-own messages (any member)
            if (!isOwn) {
                menuItems += '<button class="cr-msg-menu-item" onclick="event.stopPropagation();crReportMessage(\'' + msg.id + '\')">⚠️ Báo cáo</button>';
            }
            menuHtml = '<div class="cr-msg-menu-wrap">'
                + '<button class="cr-msg-menu-btn" onclick="event.stopPropagation();crToggleMsgMenu(\'' + msg.id + '\')" title="Tùy chọn">⋯</button>'
                + '<div class="cr-msg-menu hidden" id="crMsgMenu_' + msg.id + '">'
                + menuItems
                + '</div></div>';
        }

        // Pinned indicator
        var pinnedBadge = msg.pinned ? '<div class="cr-msg-pinned">📌 Đã ghim</div>' : '';

        html += '<div class="cr-msg ' + (isOwn ? 'cr-msg-own' : 'cr-msg-other') + '">';
        if (!isOwn) {
            html += '<div class="cr-msg-avatar">' + avatarHtml + '</div>';
        }
        html += '<div class="cr-msg-row">';
        if (isOwn) html += menuHtml;
        html += '<div class="cr-msg-bubble">';
        html += pinnedBadge;
        if (!isOwn) {
            html += '<div class="cr-msg-name">' + _crEsc(msg.username) + '</div>';
        }
        if (msg.image_url) {
            html += '<div class="cr-msg-image"><img src="' + _crEsc(msg.image_url) + '" alt="Ảnh" onclick="crViewImage(\'' + _crEsc(msg.image_url) + '\')"></div>';
        }
        if (msg.content) {
            html += '<div class="cr-msg-content">' + _crEsc(msg.content) + '</div>';
        }
        html += '<div class="cr-msg-time">' + timeStr + '</div>';
        html += '</div>';
        if (!isOwn) html += menuHtml;
        html += '</div>';
        html += '</div>';
    }
    container.innerHTML = html;
}

function crToggleMsgMenu(msgId) {
    // Close all other menus first
    document.querySelectorAll('.cr-msg-menu').forEach(function(m) {
        if (m.id !== 'crMsgMenu_' + msgId) m.classList.add('hidden');
    });
    var menu = document.getElementById('crMsgMenu_' + msgId);
    if (menu) menu.classList.toggle('hidden');
}

// Close menus on outside click
document.addEventListener('click', function(e) {
    if (!e.target.closest('.cr-msg-menu-wrap')) {
        document.querySelectorAll('.cr-msg-menu').forEach(function(m) { m.classList.add('hidden'); });
    }
});

function _crRenderAvatar(username, avatarUrl) {
    if (avatarUrl) {
        return '<img src="' + _crEsc(avatarUrl) + '" alt="' + _crEsc(username) + '">';
    }
    var initial = (username || '?').charAt(0).toUpperCase();
    var colors = ['#8b5cf6','#3b82f6','#10b981','#f59e0b','#ef4444','#ec4899','#06b6d4','#6366f1'];
    var colorIdx = 0;
    for (var i = 0; i < (username || '').length; i++) {
        colorIdx += (username || '').charCodeAt(i);
    }
    var bg = colors[colorIdx % colors.length];
    return '<span style="background:' + bg + ';width:100%;height:100%;display:flex;align-items:center;justify-content:center;border-radius:50%">' + initial + '</span>';
}

function _crScrollToBottom() {
    var area = document.getElementById('crMessagesArea');
    if (area) {
        setTimeout(function() { area.scrollTop = area.scrollHeight; }, 50);
    }
}

function _crFormatTime(ts) {
    var d = new Date(ts * 1000);
    var now = new Date();
    var hours = d.getHours().toString().padStart(2, '0');
    var mins = d.getMinutes().toString().padStart(2, '0');

    if (d.toDateString() === now.toDateString()) {
        return hours + ':' + mins;
    }
    var day = d.getDate().toString().padStart(2, '0');
    var month = (d.getMonth() + 1).toString().padStart(2, '0');
    return day + '/' + month + ' ' + hours + ':' + mins;
}

// ══════════════════════════════════════════════════════
// SEND MESSAGE
// ══════════════════════════════════════════════════════

var _crPendingImage = null; // File object waiting to be sent

function crPreviewImage(input) {
    if (!input.files || !input.files[0]) return;
    var file = input.files[0];
    if (file.size > 5 * 1024 * 1024) {
        showToast('Ảnh tối đa 5MB', 3000);
        input.value = '';
        return;
    }
    _crPendingImage = file;
    var reader = new FileReader();
    reader.onload = function(e) {
        var preview = document.getElementById('crImgPreview');
        var img = document.getElementById('crImgPreviewImg');
        if (img) img.src = e.target.result;
        if (preview) preview.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

function crCancelImage() {
    _crPendingImage = null;
    var preview = document.getElementById('crImgPreview');
    if (preview) preview.classList.add('hidden');
    var input = document.getElementById('crImageInput');
    if (input) input.value = '';
}

async function crSendMessage() {
    if (!_crCurrentRoom) return;
    var input = document.getElementById('crMessageInput');
    if (!input) return;
    var content = input.value.trim();

    // Must have content or image
    if (!content && !_crPendingImage) return;

    var headers = _crAuthHeaders();
    if (!headers) return;

    var imageUrl = '';

    // Upload image first if pending
    if (_crPendingImage) {
        try {
            var formData = new FormData();
            formData.append('file', _crPendingImage);
            var token = localStorage.getItem('ld_auth_token') || '';
            var uploadRes = await fetchWithTimeout('/api/chat-rooms/upload-image', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token },
                body: formData
            }, 30000);
            if (!uploadRes.ok) {
                var err = await uploadRes.json().catch(function() { return {}; });
                throw new Error(err.detail || 'Upload failed');
            }
            var uploadData = await uploadRes.json();
            imageUrl = uploadData.image_url || '';
        } catch(e) {
            showToast('Không thể tải ảnh: ' + e.message, 3000);
            return;
        }
        crCancelImage();
    }

    input.value = '';

    try {
        var res = await fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/messages', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ content: content, image_url: imageUrl })
        }, 10000);
        var data = await res.json();
        if (data.ok && data.message) {
            _crMessages.push(data.message);
            _crRenderMessages();
            _crScrollToBottom();
        }
    } catch(err) {
        console.error('Failed to send message:', err);
        showToast('Không thể gửi tin nhắn', 3000);
        input.value = content;
    }
}

// ══════════════════════════════════════════════════════
// DELETE MESSAGE
// ══════════════════════════════════════════════════════

function crDeleteMessage(msgId) {
    if (!_crCurrentRoom) return;
    var headers = _crAuthHeaders();
    if (!headers) return;

    // Close the menu
    document.querySelectorAll('.cr-msg-menu').forEach(function(m) { m.classList.add('hidden'); });

    fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/messages/' + msgId, {
        method: 'DELETE',
        headers: headers
    }, 10000)
        .then(function(r) {
            if (!r.ok) return r.json().then(function(d) { throw new Error(d.detail || 'Lỗi'); });
            return r.json();
        })
        .then(function(data) {
            if (data.ok) {
                _crMessages = _crMessages.filter(function(m) { return String(m.id) !== String(msgId); });
                _crRenderMessages();
            }
        })
        .catch(function(err) {
            console.error('Failed to delete message:', err);
            showToast('Không thể xóa: ' + err.message, 3000);
        });
}

// ══════════════════════════════════════════════════════
// ADMIN: PIN, BAN, KICK, MEMBERS, CLEAR
// ══════════════════════════════════════════════════════

async function crPinMessage(msgId) {
    if (!_crCurrentRoom) return;
    var headers = _crAuthHeaders();
    if (!headers) return;
    document.querySelectorAll('.cr-msg-menu').forEach(function(m) { m.classList.add('hidden'); });

    try {
        var res = await fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/pin/' + msgId, {
            method: 'POST', headers: headers
        }, 10000);
        var data = await res.json();
        if (data.ok) {
            showToast(data.pinned ? '📌 Đã ghim' : '📌 Đã bỏ ghim', 2000);
            _crLoadMessages();
        }
    } catch(e) { showToast('Lỗi: ' + e.message, 3000); }
}

async function crBanUser(userId) {
    if (!_crCurrentRoom) return;
    if (!confirm('Chặn người này? Họ sẽ bị kick và không thể tham gia lại.')) return;
    var headers = _crAuthHeaders();
    if (!headers) return;
    document.querySelectorAll('.cr-msg-menu').forEach(function(m) { m.classList.add('hidden'); });

    try {
        var res = await fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/ban/' + userId, {
            method: 'POST', headers: headers
        }, 10000);
        if (res.ok) {
            showToast('🚫 Đã chặn', 2000);
            _crLoadMessages();
        } else {
            var err = await res.json().catch(function() { return {}; });
            showToast(err.detail || 'Không thể chặn', 3000);
        }
    } catch(e) { showToast('Lỗi: ' + e.message, 3000); }
}

async function crKickUser(userId) {
    if (!_crCurrentRoom) return;
    if (!confirm('Kick người này khỏi phòng?')) return;
    var headers = _crAuthHeaders();
    if (!headers) return;

    try {
        var res = await fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/kick/' + userId, {
            method: 'POST', headers: headers
        }, 10000);
        if (res.ok) {
            showToast('✅ Đã kick', 2000);
            crShowMembers();
        } else {
            var err = await res.json().catch(function() { return {}; });
            showToast(err.detail || 'Không thể kick', 3000);
        }
    } catch(e) { showToast('Lỗi: ' + e.message, 3000); }
}

async function crUnbanUser(userId) {
    if (!_crCurrentRoom) return;
    var headers = _crAuthHeaders();
    if (!headers) return;

    try {
        var res = await fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/unban/' + userId, {
            method: 'POST', headers: headers
        }, 10000);
        if (res.ok) {
            showToast('✅ Đã bỏ chặn', 2000);
            crShowMembers();
        }
    } catch(e) { showToast('Lỗi', 3000); }
}

async function crShowMembers() {
    if (!_crCurrentRoom) return;
    var headers = _crAuthHeaders();
    if (!headers) return;

    try {
        var res = await fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/members', { headers: headers }, 10000);
        var data = await res.json();
        _crRenderMembersPanel(data.members || [], data.banned || []);
    } catch(e) { showToast('Không thể tải danh sách', 3000); }
}

function _crRenderMembersPanel(members, banned) {
    var isCreator = _crCurrentRoom && String(_crCurrentRoom.created_by) === _crCurrentUserId;
    var isAdmin = isCreator; // TODO: check from member list

    var html = '<div class="cr-modal-overlay" id="crMembersModal" onclick="if(event.target===this)crCloseMembersPanel()">'
        + '<div class="cr-modal cr-modal-lg">'
        + '<div class="cr-modal-header"><h3>👥 Thành viên (' + members.length + ')</h3>'
        + '<div style="display:flex;gap:8px">';
    if (isCreator) {
        html += '<button type="button" class="cr-btn cr-btn-outline" style="font-size:12px" onclick="crCloseMembersPanel();crViewReports()">⚠️ Báo cáo</button>';
    }
    html += '<button type="button" class="cr-modal-close" onclick="crCloseMembersPanel()">&times;</button>'
        + '</div></div>'
        + '<div class="cr-modal-body">';

    html += '<div class="cr-members-list">';
    members.forEach(function(m) {
        var initial = (m.display_name || '?').charAt(0).toUpperCase();
        var avatarHtml = m.avatar_url
            ? '<img class="cr-member-av" src="' + _crEsc(m.avatar_url) + '" alt="">'
            : '<span class="cr-member-av" style="background:' + (m.avatar_color || '#8b5cf6') + '">' + initial + '</span>';
        var badge = m.is_creator ? ' <span class="cr-creator-badge">👑 Chủ phòng</span>'
            : m.role === 'admin' ? ' <span class="cr-admin-badge">🛡️ QTV</span>' : '';
        // Mute status
        var muteInfo = '';
        if (m.muted_until) {
            var remaining = Math.max(0, Math.floor(m.muted_until - Date.now() / 1000));
            var muteStr = remaining > 3600 ? Math.floor(remaining / 3600) + 'h' : Math.floor(remaining / 60) + 'm';
            muteInfo = ' <span class="cr-mute-badge">🔇 ' + muteStr + '</span>';
        }
        var actions = '';
        if (isCreator && String(m.user_id) !== _crCurrentUserId && !m.is_creator) {
            actions = '<div class="cr-member-actions">';
            if (m.role === 'admin') {
                actions += '<button class="cr-btn cr-btn-outline" style="font-size:11px;padding:3px 8px" onclick="crDemoteUser(' + m.user_id + ')">Hạ cấp</button>';
            } else {
                actions += '<button class="cr-btn cr-btn-outline" style="font-size:11px;padding:3px 8px" onclick="crPromoteUser(' + m.user_id + ')">🛡️ QTV</button>';
            }
            // Mute/unmute
            if (m.muted_until) {
                actions += '<button class="cr-btn cr-btn-outline" style="font-size:11px;padding:3px 8px" onclick="crUnmuteUser(' + m.user_id + ')">🔊 Bỏ cấm</button>';
            } else {
                actions += '<button class="cr-btn cr-btn-outline" style="font-size:11px;padding:3px 8px" onclick="crMuteUser(' + m.user_id + ')">🔇 Cấm chat</button>';
            }
            actions += '<button class="cr-btn cr-btn-danger-sm" style="font-size:11px;padding:3px 8px" onclick="crKickUser(' + m.user_id + ')">Kick</button>';
            actions += '<button class="cr-btn cr-btn-danger-sm" style="font-size:11px;padding:3px 8px" onclick="crBanUser(' + m.user_id + ')">Chặn</button>';
            actions += '</div>';
        }
        html += '<div class="cr-member-row">' + avatarHtml
            + '<span class="cr-member-name">' + _crEsc(m.display_name) + badge + muteInfo + '</span>'
            + actions + '</div>';
    });
    html += '</div>';

    // Banned list (creator only)
    if (isCreator && banned.length > 0) {
        html += '<h4 style="margin-top:16px;font-size:13px;color:#f87171">🚫 Đã chặn (' + banned.length + ')</h4>';
        html += '<div class="cr-members-list">';
        banned.forEach(function(b) {
            html += '<div class="cr-member-row">'
                + '<span class="cr-member-name" style="opacity:0.6">' + _crEsc(b.display_name) + '</span>'
                + '<button class="cr-btn cr-btn-outline" style="font-size:11px;padding:4px 8px" onclick="crUnbanUser(' + b.user_id + ')">Bỏ chặn</button>'
                + '</div>';
        });
        html += '</div>';
    }

    html += '</div></div></div>';

    // Remove existing
    var existing = document.getElementById('crMembersModal');
    if (existing) existing.remove();
    var container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container.firstElementChild);
}

function crCloseMembersPanel() {
    var modal = document.getElementById('crMembersModal');
    if (modal) modal.remove();
}

async function crClearAllMessages() {
    if (!_crCurrentRoom) return;
    if (!confirm('Xóa TẤT CẢ tin nhắn trong phòng? Không thể hoàn tác.')) return;
    var headers = _crAuthHeaders();
    if (!headers) return;

    try {
        var res = await fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/clear-messages', {
            method: 'POST', headers: headers
        }, 10000);
        if (res.ok) {
            showToast('🗑️ Đã xóa tất cả tin nhắn', 2000);
            _crMessages = [];
            _crRenderMessages();
        }
    } catch(e) { showToast('Lỗi', 3000); }
}

async function crReportMessage(msgId) {
    if (!_crCurrentRoom) return;
    var reason = prompt('Lý do báo cáo (tùy chọn):') || '';
    var headers = _crAuthHeaders();
    if (!headers) return;
    document.querySelectorAll('.cr-msg-menu').forEach(function(m) { m.classList.add('hidden'); });

    try {
        var res = await fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/report/' + msgId, {
            method: 'POST', headers: headers,
            body: JSON.stringify({ reason: reason })
        }, 10000);
        if (res.ok) {
            showToast('⚠️ Đã báo cáo tin nhắn', 2000);
        } else {
            var err = await res.json().catch(function() { return {}; });
            showToast(err.detail || 'Không thể báo cáo', 3000);
        }
    } catch(e) { showToast('Lỗi: ' + e.message, 3000); }
}

async function crPromoteUser(userId) {
    if (!_crCurrentRoom) return;
    var headers = _crAuthHeaders();
    if (!headers) return;
    try {
        var res = await fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/promote/' + userId, {
            method: 'POST', headers: headers
        }, 10000);
        if (res.ok) {
            showToast('✅ Đã bổ nhiệm quản trị viên', 2000);
            crShowMembers();
        } else {
            var err = await res.json().catch(function() { return {}; });
            showToast(err.detail || 'Lỗi', 3000);
        }
    } catch(e) { showToast('Lỗi', 3000); }
}

async function crDemoteUser(userId) {
    if (!_crCurrentRoom) return;
    var headers = _crAuthHeaders();
    if (!headers) return;
    try {
        var res = await fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/demote/' + userId, {
            method: 'POST', headers: headers
        }, 10000);
        if (res.ok) {
            showToast('✅ Đã hạ cấp', 2000);
            crShowMembers();
        } else {
            var err = await res.json().catch(function() { return {}; });
            showToast(err.detail || 'Lỗi', 3000);
        }
    } catch(e) { showToast('Lỗi', 3000); }
}

async function crMuteUser(userId) {
    if (!_crCurrentRoom) return;
    // Show duration picker
    var duration = prompt('Chọn thời gian cấm chat:\n• 1h = 1 giờ\n• 6h = 6 giờ\n• 1d = 1 ngày\n• 3d = 3 ngày\n• 7d = 7 ngày\n\nNhập:', '1h');
    if (!duration) return;
    duration = duration.trim().toLowerCase();
    if (['1h','6h','1d','3d','7d'].indexOf(duration) < 0) {
        showToast('Thời gian không hợp lệ. Dùng: 1h, 6h, 1d, 3d, 7d', 3000);
        return;
    }

    var headers = _crAuthHeaders();
    if (!headers) return;
    try {
        var res = await fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/mute/' + userId, {
            method: 'POST', headers: headers,
            body: JSON.stringify({ duration: duration })
        }, 10000);
        if (res.ok) {
            var data = await res.json();
            showToast('🔇 Đã cấm chat ' + (data.duration || duration), 2000);
            crShowMembers();
        } else {
            var err = await res.json().catch(function() { return {}; });
            showToast(err.detail || 'Lỗi', 3000);
        }
    } catch(e) { showToast('Lỗi', 3000); }
}

async function crUnmuteUser(userId) {
    if (!_crCurrentRoom) return;
    var headers = _crAuthHeaders();
    if (!headers) return;
    try {
        var res = await fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/unmute/' + userId, {
            method: 'POST', headers: headers
        }, 10000);
        if (res.ok) {
            showToast('🔊 Đã bỏ cấm chat', 2000);
            crShowMembers();
        }
    } catch(e) { showToast('Lỗi', 3000); }
}

async function crViewReports() {
    if (!_crCurrentRoom) return;
    var headers = _crAuthHeaders();
    if (!headers) return;
    try {
        var res = await fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/reports', { headers: headers }, 10000);
        var data = await res.json();
        _crRenderReportsPanel(data.reports || []);
    } catch(e) { showToast('Lỗi', 3000); }
}

function _crRenderReportsPanel(reports) {
    var html = '<div class="cr-modal-overlay" id="crReportsModal" onclick="if(event.target===this)this.remove()">'
        + '<div class="cr-modal cr-modal-lg">'
        + '<div class="cr-modal-header"><h3>⚠️ Báo cáo (' + reports.length + ')</h3>'
        + '<button type="button" class="cr-modal-close" onclick="document.getElementById(\'crReportsModal\').remove()">&times;</button></div>'
        + '<div class="cr-modal-body">';

    if (reports.length === 0) {
        html += '<div class="cr-empty"><p>Không có báo cáo nào</p></div>';
    } else {
        reports.forEach(function(r) {
            var time = new Date(r.created_at * 1000).toLocaleString('vi-VN');
            html += '<div class="cr-report-item">'
                + '<div class="cr-report-header">'
                + '<strong>' + _crEsc(r.reporter_name) + '</strong> báo cáo <strong>' + _crEsc(r.author_name) + '</strong>'
                + '<span class="cr-report-time">' + time + '</span></div>'
                + '<div class="cr-report-content">"' + _crEsc(r.msg_content) + '"</div>'
                + (r.reason ? '<div class="cr-report-reason">Lý do: ' + _crEsc(r.reason) + '</div>' : '')
                + '<div class="cr-report-actions">'
                + '<button class="cr-btn cr-btn-danger-sm" onclick="crDeleteMessage(\'' + r.msg_id + '\');crDismissReport(' + r.id + ')">🗑️ Xóa tin nhắn</button>'
                + '<button class="cr-btn cr-btn-outline" style="font-size:11px;padding:4px 8px" onclick="crDismissReport(' + r.id + ')">Bỏ qua</button>'
                + '</div></div>';
        });
    }
    html += '</div></div></div>';

    var existing = document.getElementById('crReportsModal');
    if (existing) existing.remove();
    var container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container.firstElementChild);
}

async function crDismissReport(reportId) {
    if (!_crCurrentRoom) return;
    var headers = _crAuthHeaders();
    if (!headers) return;
    try {
        await fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/reports/' + reportId + '/dismiss', {
            method: 'POST', headers: headers
        }, 10000);
        crViewReports(); // Refresh
    } catch(e) {}
}

// ══════════════════════════════════════════════════════
// POLLING
// ══════════════════════════════════════════════════════

function _crStartPolling() {
    _crStopPolling();
    _crPollTimer = setInterval(function() {
        if (!_crCurrentRoom) return;
        var headers = _crAuthHeaders();
        if (!headers) return;

        fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/messages?limit=50', { headers: headers }, 10000)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var newMsgs = data.messages || [];
                if (newMsgs.length !== _crMessages.length || (newMsgs.length > 0 && _crMessages.length > 0 && newMsgs[newMsgs.length-1].id !== _crMessages[_crMessages.length-1].id)) {
                    _crMessages = newMsgs;
                    _crRenderMessages();
                    _crScrollToBottom();
                }
                _crUpdateMuteStatus(data.muted_until);
            })
            .catch(function() {});

        // Also check reports for admins
        _crCheckReports();
    }, 5000);
}

function _crStopPolling() {
    if (_crPollTimer) {
        clearInterval(_crPollTimer);
        _crPollTimer = null;
    }
}

function _crCheckReports() {
    if (!_crCurrentRoom) return;
    var headers = _crAuthHeaders();
    if (!headers) return;

    fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/reports', { headers: headers }, 10000)
        .then(function(r) {
            if (!r.ok) throw new Error('not admin');
            return r.json();
        })
        .then(function(data) {
            var count = (data.reports || []).length;
            var btn = document.getElementById('crReportsBtn');
            var badge = document.getElementById('crReportsBadge');
            // Admin confirmed — always show button
            if (btn) btn.classList.remove('hidden');
            // Badge only when there are reports
            if (badge) {
                badge.textContent = count;
                if (count > 0) {
                    badge.classList.remove('hidden');
                } else {
                    badge.classList.add('hidden');
                }
            }
        })
        .catch(function() {
            // Not admin or error — hide button
            var btn = document.getElementById('crReportsBtn');
            if (btn) btn.classList.add('hidden');
        });
}

// ══════════════════════════════════════════════════════
// CREATE ROOM
// ══════════════════════════════════════════════════════

function crOpenCreateModal() {
    var overlay = document.getElementById('crCreateModalOverlay');
    if (overlay) overlay.classList.remove('hidden');
    _crSelectedIcon = '💬';
    var nameInput = document.getElementById('crCreateName');
    if (nameInput) nameInput.value = '';
    var publicCb = document.getElementById('crCreatePublic');
    if (publicCb) publicCb.checked = true;
    var maxInput = document.getElementById('crCreateMaxMembers');
    if (maxInput) maxInput.value = '50';
    // Reset icon selection
    var icons = document.querySelectorAll('#crIconPicker .cr-icon-opt');
    for (var i = 0; i < icons.length; i++) {
        icons[i].classList.toggle('selected', icons[i].getAttribute('data-icon') === '💬');
    }
}

function crCloseCreateModal() {
    var overlay = document.getElementById('crCreateModalOverlay');
    if (overlay) overlay.classList.add('hidden');
}

function crSelectIcon(el) {
    _crSelectedIcon = el.getAttribute('data-icon') || '💬';
    var icons = document.querySelectorAll('#crIconPicker .cr-icon-opt');
    for (var i = 0; i < icons.length; i++) {
        icons[i].classList.toggle('selected', icons[i] === el);
    }
}

function crCreateRoom() {
    var nameInput = document.getElementById('crCreateName');
    var name = nameInput ? nameInput.value.trim() : '';
    if (!name) {
        showToast('Vui lòng nhập tên phòng', 3000);
        return;
    }

    var publicCb = document.getElementById('crCreatePublic');
    var isPublic = publicCb ? publicCb.checked : true;
    var maxInput = document.getElementById('crCreateMaxMembers');
    var maxMembers = maxInput ? parseInt(maxInput.value) || 50 : 50;

    var headers = _crAuthHeaders();
    if (!headers) return;

    fetchWithTimeout('/api/chat-rooms', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
            name: name,
            icon: _crSelectedIcon,
            is_public: isPublic,
            max_members: maxMembers
        })
    }, 10000)
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok) {
                showToast('Đã tạo phòng chat!', 2000);
                crCloseCreateModal();
                crLoadRooms();
            } else {
                showToast(data.detail || 'Không thể tạo phòng', 3000);
            }
        })
        .catch(function(err) {
            console.error('Failed to create room:', err);
            showToast('Không thể tạo phòng chat', 3000);
        });
}

// ══════════════════════════════════════════════════════
// PUBLIC ROOMS BROWSER
// ══════════════════════════════════════════════════════

function crOpenPublicBrowser() {
    var overlay = document.getElementById('crPublicModalOverlay');
    if (overlay) overlay.classList.remove('hidden');
    _crLoadPublicRooms();
}

function crClosePublicBrowser() {
    var overlay = document.getElementById('crPublicModalOverlay');
    if (overlay) overlay.classList.add('hidden');
}

function _crLoadPublicRooms() {
    var headers = _crAuthHeaders();
    if (!headers) return;

    var container = document.getElementById('crPublicList');
    if (container) container.innerHTML = '<div class="cr-empty"><p>Đang tải...</p></div>';

    fetchWithTimeout('/api/chat-rooms/public', { headers: headers }, 10000)
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var rooms = data.rooms || [];
            _crRenderPublicRooms(rooms);
        })
        .catch(function(err) {
            console.error('Failed to load public rooms:', err);
            if (container) container.innerHTML = '<div class="cr-empty"><p>Không thể tải danh sách</p></div>';
        });
}

function _crRenderPublicRooms(rooms) {
    var container = document.getElementById('crPublicList');
    if (!container) return;

    if (rooms.length === 0) {
        container.innerHTML = '<div class="cr-empty"><p>Chưa có phòng công khai nào</p></div>';
        return;
    }

    var html = '';
    for (var i = 0; i < rooms.length; i++) {
        var room = rooms[i];
        var btnHtml = '';
        if (room.is_member) {
            btnHtml = '<button class="cr-btn cr-btn-outline" disabled style="opacity:0.6">Đã tham gia</button>';
        } else {
            btnHtml = '<button class="cr-btn cr-btn-primary" onclick="crJoinRoom(\'' + room.id + '\')">Tham gia</button>';
        }

        html += '<div class="cr-public-card">';
        html += '  <div class="cr-room-icon">' + _crEsc(room.icon) + '</div>';
        html += '  <div class="cr-public-card-info">';
        html += '    <div class="cr-public-card-name">' + _crEsc(room.name) + '</div>';
        html += '    <div class="cr-public-card-meta">👥 ' + (room.member_count || 0) + '/' + room.max_members + ' · Tạo bởi ' + _crEsc(room.creator_name || 'Unknown') + '</div>';
        html += '  </div>';
        html += '  ' + btnHtml;
        html += '</div>';
    }
    container.innerHTML = html;
}

function crJoinRoom(roomId) {
    var headers = _crAuthHeaders();
    if (!headers) return;

    fetchWithTimeout('/api/chat-rooms/join/' + roomId, {
        method: 'POST',
        headers: headers
    }, 10000)
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok) {
                showToast('Đã tham gia phòng!', 2000);
                crClosePublicBrowser();
                crLoadRooms();
            } else {
                showToast(data.detail || 'Không thể tham gia', 3000);
            }
        })
        .catch(function(err) {
            console.error('Failed to join room:', err);
            showToast('Không thể tham gia phòng', 3000);
        });
}

// ══════════════════════════════════════════════════════
// LEAVE / DELETE ROOM
// ══════════════════════════════════════════════════════

function crLeaveRoom() {
    if (!_crCurrentRoom) return;
    if (!confirm('Bạn có chắc muốn rời phòng chat này?')) return;

    var headers = _crAuthHeaders();
    if (!headers) return;

    fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/leave', {
        method: 'POST',
        headers: headers
    }, 10000)
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok) {
                showToast('Đã rời phòng', 2000);
                crBackToList();
            }
        })
        .catch(function(err) {
            console.error('Failed to leave room:', err);
            showToast('Không thể rời phòng', 3000);
        });
}

function crDeleteRoom() {
    if (!_crCurrentRoom) return;
    if (!confirm('Xóa phòng chat này? Tất cả tin nhắn sẽ bị mất.')) return;

    var headers = _crAuthHeaders();
    if (!headers) return;

    fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id, {
        method: 'DELETE',
        headers: headers
    }, 10000)
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok) {
                showToast('Đã xóa phòng chat', 2000);
                crBackToList();
            }
        })
        .catch(function(err) {
            console.error('Failed to delete room:', err);
            showToast('Không thể xóa phòng', 3000);
        });
}

// ══════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════

function _crEsc(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function crViewImage(url) {
    var overlay = document.createElement('div');
    overlay.className = 'cr-img-viewer';
    overlay.onclick = function() { overlay.remove(); };
    overlay.innerHTML = '<img src="' + url + '" alt="Ảnh"><button class="cr-img-viewer-close" onclick="this.parentElement.remove()">✕</button>';
    document.body.appendChild(overlay);
}
