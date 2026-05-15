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
    if (deleteBtn) {
        deleteBtn.style.display = (String(room.created_by) === _crCurrentUserId) ? '' : 'none';
    }

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
        })
        .catch(function(err) {
            console.error('Failed to load messages:', err);
        });
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
        if (canDelete) {
            menuHtml = '<div class="cr-msg-menu-wrap">'
                + '<button class="cr-msg-menu-btn" onclick="event.stopPropagation();crToggleMsgMenu(\'' + msg.id + '\')" title="Tùy chọn">⋯</button>'
                + '<div class="cr-msg-menu hidden" id="crMsgMenu_' + msg.id + '">'
                + '<button class="cr-msg-menu-item" onclick="event.stopPropagation();crDeleteMessage(\'' + msg.id + '\')">🗑️ Xóa tin nhắn</button>'
                + '</div></div>';
        }

        html += '<div class="cr-msg ' + (isOwn ? 'cr-msg-own' : 'cr-msg-other') + '">';
        if (!isOwn) {
            html += '<div class="cr-msg-avatar">' + avatarHtml + '</div>';
        }
        html += '<div class="cr-msg-row">';
        if (isOwn) html += menuHtml;
        html += '<div class="cr-msg-bubble">';
        if (!isOwn) {
            html += '<div class="cr-msg-name">' + _crEsc(msg.username) + '</div>';
        }
        html += '<div class="cr-msg-content">' + _crEsc(msg.content) + '</div>';
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

function crSendMessage() {
    if (!_crCurrentRoom) return;
    var input = document.getElementById('crMessageInput');
    if (!input) return;
    var content = input.value.trim();
    if (!content) return;

    var headers = _crAuthHeaders();
    if (!headers) return;

    input.value = '';

    fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/messages', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ content: content })
    }, 10000)
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok && data.message) {
                _crMessages.push(data.message);
                _crRenderMessages();
                _crScrollToBottom();
            }
        })
        .catch(function(err) {
            console.error('Failed to send message:', err);
            showToast('Không thể gửi tin nhắn', 3000);
            input.value = content; // restore
        });
}

// ══════════════════════════════════════════════════════
// DELETE MESSAGE
// ══════════════════════════════════════════════════════

function crDeleteMessage(msgId) {
    if (!_crCurrentRoom) return;
    var headers = _crAuthHeaders();
    if (!headers) return;

    fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/messages/' + msgId, {
        method: 'DELETE',
        headers: headers
    }, 10000)
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok) {
                _crMessages = _crMessages.filter(function(m) { return m.id !== msgId; });
                _crRenderMessages();
            }
        })
        .catch(function(err) {
            console.error('Failed to delete message:', err);
            showToast('Không thể xóa tin nhắn', 3000);
        });
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
            })
            .catch(function() {});
    }, 5000);
}

function _crStopPolling() {
    if (_crPollTimer) {
        clearInterval(_crPollTimer);
        _crPollTimer = null;
    }
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
