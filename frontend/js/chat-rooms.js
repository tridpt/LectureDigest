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
    // Update URL back to /chat
    if (location.pathname !== '/chat') {
        history.pushState({ section: 'chatRoomsSection' }, '', '/chat');
    }
}

async function _crOpenRoomById(roomId) {
    // Fetch room list first, then open the room
    var headers = _crAuthHeaders();
    if (!headers) return;

    try {
        var res = await fetchWithTimeout('/api/chat-rooms', { headers: headers }, 10000);
        if (!res.ok) return;
        var data = await res.json();
        _crRooms = data.rooms || [];

        // Find the room
        var room = null;
        for (var i = 0; i < _crRooms.length; i++) {
            if (_crRooms[i].id === roomId) { room = _crRooms[i]; break; }
        }
        if (room) {
            crOpenRoom(roomId);
        } else {
            showToast('Phòng không tồn tại hoặc bạn chưa tham gia', 3000);
            openChatRooms();
        }
    } catch(e) {
        openChatRooms();
    }
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
            _crUpdateHeaderBadge(data.total_unread || 0);
        })
        .catch(function(err) {
            console.error('Failed to load chat rooms:', err);
            showToast('Không thể tải phòng chat', 3000);
        });
}

function _crUpdateHeaderBadge(totalUnread) {
    // Update badge on header "Phòng chat" menu item
    var menuItem = document.querySelector('.hdr-more-item[onclick*="openChatRooms"]');
    if (menuItem) {
        // Remove existing badge
        var existing = menuItem.querySelector('.cr-header-unread-badge');
        if (existing) existing.remove();
        if (totalUnread > 0) {
            var badge = document.createElement('span');
            badge.className = 'cr-header-unread-badge';
            badge.textContent = totalUnread > 99 ? '99+' : totalUnread;
            menuItem.appendChild(badge);
        }
    }
}

// Poll unread count periodically (even when not in chat)
setInterval(function() {
    var token = localStorage.getItem('ld_auth_token');
    if (!token) return;
    // Only poll if not currently in a chat room
    if (_crCurrentRoom) return;
    fetchWithTimeout('/api/chat-rooms', {
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
    }, 10000)
        .then(function(r) { if (r.ok) return r.json(); throw new Error(); })
        .then(function(data) { _crUpdateHeaderBadge(data.total_unread || 0); })
        .catch(function() {});
}, 30000);

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
        var preview = 'Chưa có tin nhắn';
        if (lastMsg) {
            preview = lastMsg.username ? (lastMsg.username + ': ' + lastMsg.content) : lastMsg.content;
        }
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
        if (room.unread > 0) {
            html += '  <span class="cr-room-unread">' + (room.unread > 99 ? '99+' : room.unread) + '</span>';
        }
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
    if (!room) {
        // Room not in list yet — try loading it directly
        _crOpenRoomById(roomId);
        return;
    }

    _crCurrentRoom = room;
    showSection('chatDetailSection');
    var footer = document.querySelector('.footer');
    if (footer) footer.style.display = 'none';

    // Push URL for this room
    if (location.pathname !== '/chat/' + roomId) {
        history.pushState({ section: 'chatDetailSection', roomId: roomId }, '', '/chat/' + roomId);
    }

    // Update header
    var iconEl = document.getElementById('crChatRoomIcon');
    var nameEl = document.getElementById('crChatRoomName');
    var membersEl = document.getElementById('crChatRoomMembers');
    if (iconEl) iconEl.textContent = room.icon;
    if (nameEl) nameEl.textContent = room.name;
    if (membersEl) membersEl.textContent = (room.member_count || 0) + ' thành viên';

    // Show/hide admin items in header menu
    var isCreator = String(room.created_by) === _crCurrentUserId;
    var hmClear = document.getElementById('crHmClear');
    var hmLock = document.getElementById('crHmLock');
    var hmUnlock = document.getElementById('crHmUnlock');
    var reportsBtn = document.getElementById('crReportsBtn');
    if (hmClear) hmClear.style.display = isCreator ? '' : 'none';
    if (hmLock) hmLock.style.display = isCreator ? '' : 'none';
    if (hmUnlock) hmUnlock.style.display = 'none';
    // Show reports button for admin/creator
    if (reportsBtn) {
        reportsBtn.classList.add('hidden');
    }
    _crCheckReports();
    _crSendHeartbeat();

    // Load messages
    _crLoadMessages();
    _crLoadPinnedMessages();

    // Start polling
    _crStartPolling();
    _crJumpedToUnread = false;

    // Auto mark-as-read when scrolled to bottom
    var area = document.getElementById('crMessagesArea');
    if (area) {
        area.onscroll = function() {
            if (_crIsAtBottom()) {
                var btn = document.getElementById('crUnreadBtn');
                if (btn && !btn.classList.contains('hidden')) {
                    _crMarkAsRead();
                    _crJumpedToUnread = false;
                }
            }
        };
    }
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
            _crUpdateMuteStatus(data.muted_until, data.chat_locked);
            _crUpdateUnreadUI(data);

            // Scroll: if unreads, don't scroll to bottom (let user use the button)
            var lastRead = data.last_read_at || 0;
            var hasUnread = _crMessages.some(function(m) {
                return m.created_at > lastRead && String(m.user_id) !== _crCurrentUserId && String(m.user_id) !== '__system__';
            });
            if (!hasUnread) {
                _crScrollToBottom();
            }
            // Update room owner if changed (transfer)
            if (data.created_by && _crCurrentRoom && String(_crCurrentRoom.created_by) !== String(data.created_by)) {
                _crCurrentRoom.created_by = data.created_by;
                _crOnOwnershipChanged();
            }
        })
        .catch(function(err) {
            console.error('Failed to load messages:', err);
        });
}

function _crUpdateMuteStatus(mutedUntil, chatLocked) {
    var inputBar = document.querySelector('.cr-input-bar');
    var muteBar = document.getElementById('crMuteBar');
    var hmLock = document.getElementById('crHmLock');
    var hmUnlock = document.getElementById('crHmUnlock');
    var isCreator = _crCurrentRoom && String(_crCurrentRoom.created_by) === _crCurrentUserId;

    // Update lock/unlock menu items
    if (isCreator) {
        if (hmLock) hmLock.style.display = chatLocked ? 'none' : '';
        if (hmUnlock) hmUnlock.style.display = chatLocked ? '' : 'none';
    }

    // Chat locked (not creator)
    if (chatLocked && !isCreator) {
        if (inputBar) inputBar.style.display = 'none';
        if (!muteBar) {
            muteBar = document.createElement('div');
            muteBar.id = 'crMuteBar';
            muteBar.className = 'cr-mute-bar';
            var chatContainer = document.querySelector('.cr-chat-container');
            if (chatContainer) chatContainer.appendChild(muteBar);
        }
        muteBar.innerHTML = '🔒 Chat đang bị khóa. Chỉ chủ phòng và người được chỉ định mới có thể nhắn.';
        muteBar.style.display = '';
        return;
    }

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

        if (inputBar) inputBar.style.display = 'none';
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
        if (inputBar) inputBar.style.display = '';
        if (muteBar) muteBar.style.display = 'none';
    }
}

function _crLoadPinnedMessages() {
    if (!_crCurrentRoom) return;
    var headers = _crAuthHeaders();
    if (!headers) return;

    fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/pinned', { headers: headers }, 10000)
        .then(function(r) { return r.json(); })
        .then(function(data) {
            _crRenderPinnedBar(data.messages || []);
        })
        .catch(function() {});
}

var _crPinnedMessages = [];

function _crRenderPinnedBar(pinnedMsgs) {
    _crPinnedMessages = pinnedMsgs;
    var trigger = document.getElementById('crPinnedTrigger');
    var text = document.getElementById('crPinnedTriggerText');
    if (!trigger) return;

    if (pinnedMsgs.length === 0) {
        trigger.classList.add('hidden');
    } else {
        trigger.classList.remove('hidden');
        if (text) text.textContent = pinnedMsgs.length + ' tin nhắn đã ghim';
    }
}

function crOpenPinnedPanel() {
    if (_crPinnedMessages.length === 0) return;

    var html = '<div class="cr-modal-overlay" id="crPinnedModal" onclick="if(event.target===this)this.remove()">'
        + '<div class="cr-modal" style="max-width:450px;max-height:70vh;overflow-y:auto">'
        + '<div class="cr-modal-header"><h3>📌 Tin nhắn đã ghim (' + _crPinnedMessages.length + ')</h3>'
        + '<button type="button" class="cr-modal-close" onclick="document.getElementById(\'crPinnedModal\').remove()">&times;</button></div>'
        + '<div class="cr-modal-body" style="padding:12px">';

    _crPinnedMessages.forEach(function(msg) {
        var content = msg.content || '📷 Ảnh';
        html += '<div class="cr-pinned-msg-item" onclick="document.getElementById(\'crPinnedModal\').remove();crScrollToMessage(\'' + msg.id + '\')">'
            + '<div class="cr-pinned-msg-author">' + _crEsc(msg.username) + '</div>'
            + '<div class="cr-pinned-msg-content">' + _crEsc(content) + '</div>'
            + '</div>';
    });

    html += '</div></div></div>';

    var existing = document.getElementById('crPinnedModal');
    if (existing) existing.remove();
    var container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container.firstElementChild);
}

function crScrollToMessage(msgId) {
    var msgEl = document.querySelector('[data-msg-id="' + msgId + '"]');
    if (msgEl) {
        msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        msgEl.classList.add('cr-msg-highlight');
        setTimeout(function() { msgEl.classList.remove('cr-msg-highlight'); }, 2000);
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

        // System messages (join/leave/kick/ban)
        if (String(msg.user_id) === '__system__') {
            html += '<div class="cr-msg-system">' + _crEsc(msg.content) + '</div>';
            continue;
        }

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
                menuItems += '<button class="cr-msg-menu-item cr-msg-menu-danger" onclick="event.stopPropagation();crKickUser(' + msg.user_id + ')">🚪 Kick</button>';
                menuItems += '<button class="cr-msg-menu-item cr-msg-menu-danger" onclick="event.stopPropagation();crMuteUser(' + msg.user_id + ')">🔇 Cấm chat</button>';
                menuItems += '<button class="cr-msg-menu-item cr-msg-menu-danger" onclick="event.stopPropagation();crBanUser(' + msg.user_id + ')">🚫 Chặn</button>';
            }
            // Report option for non-own messages (non-creator members only)
            if (!isOwn && !isCreator) {
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

        html += '<div class="cr-msg ' + (isOwn ? 'cr-msg-own' : 'cr-msg-other') + '" data-msg-id="' + msg.id + '">';
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

function _crOnOwnershipChanged() {
    // Re-render messages to update menus (new owner sees admin options)
    _crRenderMessages();
    // Update header buttons
    var isCreator = _crCurrentRoom && String(_crCurrentRoom.created_by) === _crCurrentUserId;
    var hmClear = document.getElementById('crHmClear');
    if (hmClear) hmClear.style.display = isCreator ? '' : 'none';
    // Re-check reports (new owner can now see them)
    _crCheckReports();
    // Show toast if I became the owner
    if (isCreator) {
        showToast('👑 Bạn đã trở thành chủ phòng!', 3000);
    }
}

function crToggleHeaderMenu() {
    var menu = document.getElementById('crHeaderMenu');
    if (menu) menu.classList.toggle('hidden');
}
function crCloseHeaderMenu() {
    var menu = document.getElementById('crHeaderMenu');
    if (menu) menu.classList.add('hidden');
}

function crToggleMsgMenu(msgId) {
    var menu = document.getElementById('crMsgMenu_' + msgId);
    if (!menu) return;
    var wasHidden = menu.classList.contains('hidden');

    // Close all menus first
    document.querySelectorAll('.cr-msg-menu').forEach(function(m) { m.classList.add('hidden'); });

    if (wasHidden) {
        // Position using the ⋯ button coordinates
        var btn = menu.closest('.cr-msg-menu-wrap').querySelector('.cr-msg-menu-btn');
        if (btn) {
            var rect = btn.getBoundingClientRect();
            menu.classList.remove('hidden');
            var menuH = menu.offsetHeight;
            // Show above the button
            menu.style.top = (rect.top - menuH - 4) + 'px';
            menu.style.left = (rect.left - 60) + 'px';
            // If off-screen top, show below
            if (rect.top - menuH - 4 < 10) {
                menu.style.top = (rect.bottom + 4) + 'px';
            }
        } else {
            menu.classList.remove('hidden');
        }
    }
}

// Close menus on outside click
document.addEventListener('click', function(e) {
    if (!e.target.closest('.cr-msg-menu-wrap')) {
        document.querySelectorAll('.cr-msg-menu').forEach(function(m) { m.classList.add('hidden'); });
    }
    if (!e.target.closest('.cr-header-more-wrap')) {
        crCloseHeaderMenu();
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

function _crIsAtBottom() {
    var area = document.getElementById('crMessagesArea');
    if (!area) return true;
    return area.scrollHeight - area.scrollTop - area.clientHeight < 80;
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
    _crLastTypingSent = 0; // Reset so typing indicator clears immediately

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
            _crLoadPinnedMessages();
        }
    } catch(e) { showToast('Lỗi: ' + e.message, 3000); }
}

// ── Custom confirm modal (replaces browser confirm) ──
function _crConfirmModal(title, message, options) {
    return new Promise(function(resolve) {
        var id = 'crConfirm_' + Date.now();
        var btnsHtml = '';
        if (options && options.length) {
            options.forEach(function(opt, i) {
                var cls = opt.danger ? 'cr-btn cr-btn-danger-sm' : opt.primary ? 'cr-btn cr-btn-primary' : 'cr-btn cr-btn-outline';
                btnsHtml += '<button class="' + cls + '" style="padding:8px 16px;font-size:13px" data-val="' + i + '">' + opt.label + '</button>';
            });
        } else {
            btnsHtml = '<button class="cr-btn cr-btn-outline" style="padding:8px 16px;font-size:13px" data-val="cancel">Hủy</button>'
                + '<button class="cr-btn cr-btn-primary" style="padding:8px 16px;font-size:13px" data-val="ok">Xác nhận</button>';
        }

        var html = '<div class="cr-modal-overlay" id="' + id + '" style="z-index:99999">'
            + '<div class="cr-modal" style="max-width:380px;overflow:visible">'
            + '<div style="padding:24px;text-align:center">'
            + '<div style="font-size:28px;margin-bottom:12px">' + (title || '⚠️') + '</div>'
            + '<div style="font-size:14px;color:var(--text-primary,#f1f5f9);font-weight:600;margin-bottom:8px">' + (message || '') + '</div>'
            + '<div style="display:flex;gap:8px;justify-content:center;margin-top:20px;flex-wrap:wrap">' + btnsHtml + '</div>'
            + '</div></div></div>';

        var container = document.createElement('div');
        container.innerHTML = html;
        var overlay = container.firstElementChild;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', function(e) {
            var btn = e.target.closest('[data-val]');
            if (btn) {
                overlay.remove();
                resolve(btn.getAttribute('data-val'));
            } else if (e.target === overlay) {
                overlay.remove();
                resolve('cancel');
            }
        });
    });
}

async function crBanUser(userId) {
    if (!_crCurrentRoom) return;
    document.querySelectorAll('.cr-msg-menu').forEach(function(m) { m.classList.add('hidden'); });

    var result = await _crConfirmModal('🚫 Chặn thành viên', 'Người này sẽ bị kick và không thể tham gia lại.', [
        { label: 'Hủy', danger: false },
        { label: 'Chặn + Giữ tin nhắn', primary: true },
        { label: 'Chặn + Xóa tin nhắn', danger: true }
    ]);
    if (result === '0' || result === 'cancel') return;

    var deleteMsg = result === '2';
    var headers = _crAuthHeaders();
    if (!headers) return;

    try {
        var url = '/api/chat-rooms/' + _crCurrentRoom.id + '/ban/' + userId + (deleteMsg ? '?delete_messages=true' : '');
        var res = await fetchWithTimeout(url, { method: 'POST', headers: headers }, 10000);
        if (res.ok) {
            showToast('🚫 Đã chặn' + (deleteMsg ? ' + xóa tin nhắn' : ''), 2000);
            _crLoadMessages();
            _crLoadPinnedMessages();
            crCloseMembersPanel();
        } else {
            var err = await res.json().catch(function() { return {}; });
            showToast(err.detail || 'Không thể chặn', 3000);
        }
    } catch(e) { showToast('Lỗi: ' + e.message, 3000); }
}

async function crKickUser(userId) {
    if (!_crCurrentRoom) return;

    var result = await _crConfirmModal('🚪 Kick thành viên', 'Người này sẽ bị đuổi khỏi phòng.', [
        { label: 'Hủy', danger: false },
        { label: 'Kick + Giữ tin nhắn', primary: true },
        { label: 'Kick + Xóa tin nhắn', danger: true }
    ]);
    if (result === '0' || result === 'cancel') return;

    var deleteMsg = result === '2';
    var headers = _crAuthHeaders();
    if (!headers) return;

    try {
        var url = '/api/chat-rooms/' + _crCurrentRoom.id + '/kick/' + userId + (deleteMsg ? '?delete_messages=true' : '');
        var res = await fetchWithTimeout(url, { method: 'POST', headers: headers }, 10000);
        if (res.ok) {
            showToast('✅ Đã kick' + (deleteMsg ? ' + xóa tin nhắn' : ''), 2000);
            _crLoadMessages();
            _crLoadPinnedMessages();
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

async function crShowRoomInfo() {
    if (!_crCurrentRoom) return;
    var room = _crCurrentRoom;
    var headers = _crAuthHeaders();
    if (!headers) return;

    // Fetch members for count and creator info
    var membersData = { members: [], banned: [] };
    try {
        var res = await fetchWithTimeout('/api/chat-rooms/' + room.id + '/members', { headers: headers }, 10000);
        if (res.ok) membersData = await res.json();
    } catch(e) {}

    var members = membersData.members || [];
    var isCreator = String(room.created_by) === _crCurrentUserId;
    var creatorMember = members.find(function(m) { return m.is_creator; });
    var creatorName = creatorMember ? creatorMember.display_name : (room.creator_name || 'Unknown');
    var adminCount = members.filter(function(m) { return m.role === 'admin'; }).length;
    var createdDate = new Date(room.created_at * 1000).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    var html = '<div class="cr-modal-overlay" id="crInfoModal" onclick="if(event.target===this)this.remove()">'
        + '<div class="cr-modal" style="max-width:420px;max-height:85vh;overflow-y:auto">'
        + '<div class="cr-modal-header"><h3>ℹ️ Thông tin phòng</h3>'
        + '<button type="button" class="cr-modal-close" onclick="document.getElementById(\'crInfoModal\').remove()">&times;</button></div>'
        + '<div class="cr-modal-body" style="padding:20px">'
        + '<div class="cr-info-icon">' + _crEsc(room.icon) + '</div>'
        + '<div class="cr-info-name">' + _crEsc(room.name) + '</div>'
        + '<div class="cr-info-grid">'
        + '<div class="cr-info-row"><span class="cr-info-label">👑 Chủ phòng</span><span class="cr-info-value">' + _crEsc(creatorName) + '</span></div>'
        + '<div class="cr-info-row"><span class="cr-info-label">👥 Thành viên</span><span class="cr-info-value">' + members.length + ' / ' + room.max_members + '</span></div>'
        + '<div class="cr-info-row"><span class="cr-info-label">🛡️ Quản trị viên</span><span class="cr-info-value">' + adminCount + '</span></div>'
        + '<div class="cr-info-row"><span class="cr-info-label">🌐 Loại phòng</span><span class="cr-info-value">' + (room.is_public ? 'Công khai' : 'Riêng tư') + '</span></div>'
        + '<div class="cr-info-row"><span class="cr-info-label">📅 Ngày tạo</span><span class="cr-info-value">' + createdDate + '</span></div>'
        + '</div>';

    // Edit button for creator
    if (isCreator) {
        html += '<div style="margin-top:16px;border-top:1px solid rgba(255,255,255,0.06);padding-top:16px">'
            + '<h4 style="font-size:13px;color:var(--text-secondary,#94a3b8);margin:0 0 10px">⚙️ Cài đặt (chủ phòng)</h4>'
            + '<div class="cr-info-edit-row"><label>Tên phòng</label><input type="text" class="cr-input" id="crInfoEditName" value="' + _crEsc(room.name) + '" maxlength="100"></div>'
            + '<div class="cr-info-edit-row"><label>Loại</label><select class="cr-input" id="crInfoEditPublic"><option value="1"' + (room.is_public ? ' selected' : '') + '>Công khai</option><option value="0"' + (!room.is_public ? ' selected' : '') + '>Riêng tư</option></select></div>'
            + '<div class="cr-info-edit-row"><label>Tối đa</label><input type="number" class="cr-input" id="crInfoEditMax" value="' + room.max_members + '" min="2" max="200"></div>'
            + '<button class="cr-btn cr-btn-primary" style="width:100%;margin-top:10px" onclick="crSaveRoomInfo()">💾 Lưu thay đổi</button>';

        // Transfer ownership (above delete)
        var otherMembers = members.filter(function(m) { return !m.is_creator; });
        if (otherMembers.length > 0) {
            html += '<div style="margin-top:16px;border-top:1px solid rgba(255,255,255,0.06);padding-top:12px">'
                + '<h4 style="font-size:13px;color:var(--text-secondary,#94a3b8);margin:0 0 8px">👑 Chuyển quyền chủ phòng</h4>'
                + '<select class="cr-input cr-select-dark" id="crTransferSelect">';
            otherMembers.forEach(function(m) {
                html += '<option value="' + m.user_id + '">' + _crEsc(m.display_name) + '</option>';
            });
            html += '</select>'
                + '<button class="cr-btn cr-btn-primary" style="width:100%;margin-top:8px;background:#f59e0b" onclick="crTransferOwnership()">👑 Chuyển quyền</button>'
                + '</div>';
        }

        // Delete room (last, most dangerous)
        html += '<div style="margin-top:16px;border-top:1px solid rgba(248,113,113,0.2);padding-top:12px">'
            + '<button class="cr-btn cr-btn-danger-sm" style="width:100%;padding:10px" onclick="document.getElementById(\'crInfoModal\').remove();crDeleteRoom()">🗑️ Xóa phòng vĩnh viễn</button>'
            + '</div>';

        html += '</div>';
    }

    html += '</div></div></div>';

    var existing = document.getElementById('crInfoModal');
    if (existing) existing.remove();
    var container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container.firstElementChild);
}

async function crSaveRoomInfo() {
    if (!_crCurrentRoom) return;
    var headers = _crAuthHeaders();
    if (!headers) return;

    var name = document.getElementById('crInfoEditName')?.value.trim();
    var isPublic = document.getElementById('crInfoEditPublic')?.value === '1';
    var maxMembers = parseInt(document.getElementById('crInfoEditMax')?.value) || 50;

    try {
        var res = await fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id, {
            method: 'PUT', headers: headers,
            body: JSON.stringify({ name: name || undefined, is_public: isPublic, max_members: maxMembers })
        }, 10000);
        if (res.ok) {
            showToast('💾 Đã lưu', 2000);
            if (name) _crCurrentRoom.name = name;
            _crCurrentRoom.is_public = isPublic;
            _crCurrentRoom.max_members = maxMembers;
            var nameEl = document.getElementById('crChatRoomName');
            if (nameEl && name) nameEl.textContent = name;
            document.getElementById('crInfoModal')?.remove();
        } else {
            var err = await res.json().catch(function() { return {}; });
            showToast(err.detail || 'Lỗi', 3000);
        }
    } catch(e) { showToast('Lỗi', 3000); }
}

async function crTransferOwnership() {
    if (!_crCurrentRoom) return;
    var select = document.getElementById('crTransferSelect');
    if (!select) return;
    var newOwnerId = select.value;
    if (!newOwnerId) return;

    var result = await _crConfirmModal('👑 Chuyển quyền chủ phòng', 'Bạn sẽ mất quyền chủ phòng. Không thể hoàn tác.', [
        { label: 'Hủy' }, { label: 'Chuyển quyền', danger: true }
    ]);
    if (result !== '1') return;

    var headers = _crAuthHeaders();
    if (!headers) return;

    try {
        var res = await fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/transfer/' + newOwnerId, {
            method: 'POST', headers: headers
        }, 10000);
        if (res.ok) {
            showToast('👑 Đã chuyển quyền chủ phòng', 2000);
            _crCurrentRoom.created_by = newOwnerId;
            document.getElementById('crInfoModal')?.remove();
            // Refresh room
            crOpenRoom(_crCurrentRoom.id);
        } else {
            var err = await res.json().catch(function() { return {}; });
            showToast(err.detail || 'Lỗi', 3000);
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

    var html = '<div class="cr-modal-overlay" id="crMembersModal" onclick="if(event.target===this)crCloseMembersPanel()">'
        + '<div class="cr-modal cr-modal-lg">'
        + '<div class="cr-modal-header"><h3>👥 Thành viên (' + members.length + ')</h3>'
        + '<button type="button" class="cr-modal-close" onclick="crCloseMembersPanel()">&times;</button>'
        + '</div>'
        + '<div class="cr-modal-body">';

    html += '<div class="cr-members-list">';
    members.forEach(function(m) {
        var initial = (m.display_name || '?').charAt(0).toUpperCase();
        var isOnline = !_crMyOnlineHidden && _crOnlineIds.indexOf(String(m.user_id)) >= 0;
        var onlineDotHtml = isOnline ? '<span class="cr-member-online-dot"></span>' : '';
        var avatarHtml = m.avatar_url
            ? '<div class="cr-member-av-wrap">' + onlineDotHtml + '<img class="cr-member-av" src="' + _crEsc(m.avatar_url) + '" alt=""></div>'
            : '<div class="cr-member-av-wrap">' + onlineDotHtml + '<span class="cr-member-av" style="background:' + (m.avatar_color || '#8b5cf6') + '">' + initial + '</span></div>';
        var badge = m.is_creator ? ' <span class="cr-creator-badge">👑</span>'
            : m.role === 'admin' ? ' <span class="cr-admin-badge">🛡️</span>' : '';
        var muteInfo = '';
        if (m.muted_until) {
            var remaining = Math.max(0, Math.floor(m.muted_until - Date.now() / 1000));
            var muteStr = remaining > 3600 ? Math.floor(remaining / 3600) + 'h' : Math.floor(remaining / 60) + 'm';
            muteInfo = ' <span class="cr-mute-badge">🔇 ' + muteStr + '</span>';
        }

        // Compact dropdown menu for admin actions
        var actions = '';
        if (isCreator && String(m.user_id) !== _crCurrentUserId && !m.is_creator) {
            var menuId = 'crMemberMenu_' + m.user_id;
            actions = '<div class="cr-member-menu-wrap">'
                + '<button class="cr-member-menu-btn" onclick="event.stopPropagation();crToggleMemberMenu(\'' + menuId + '\')">⋯</button>'
                + '<div class="cr-member-menu hidden" id="' + menuId + '">';
            if (m.role === 'admin') {
                actions += '<button class="cr-mm-item" onclick="crDemoteUser(' + m.user_id + ')">👤 Hạ cấp</button>';
            } else {
                actions += '<button class="cr-mm-item" onclick="crPromoteUser(' + m.user_id + ')">🛡️ Bổ nhiệm QTV</button>';
            }
            if (m.muted_until) {
                actions += '<button class="cr-mm-item" onclick="crUnmuteUser(' + m.user_id + ')">🔊 Bỏ cấm chat</button>';
            } else {
                actions += '<button class="cr-mm-item" onclick="crMuteUser(' + m.user_id + ')">🔇 Cấm chat</button>';
            }
            actions += '<button class="cr-mm-item cr-mm-danger" onclick="crKickUser(' + m.user_id + ')">🚪 Kick</button>';
            actions += '<button class="cr-mm-item cr-mm-danger" onclick="crBanUser(' + m.user_id + ')">🚫 Chặn</button>';
            actions += '</div></div>';
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

    var existing = document.getElementById('crMembersModal');
    if (existing) existing.remove();
    var container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container.firstElementChild);
}

function crToggleMemberMenu(menuId) {
    var menu = document.getElementById(menuId);
    if (!menu) return;
    var wasHidden = menu.classList.contains('hidden');

    // Close all menus first
    document.querySelectorAll('.cr-member-menu').forEach(function(m) { m.classList.add('hidden'); });

    if (wasHidden) {
        // Position relative to the button
        var btn = menu.previousElementSibling || menu.parentElement.querySelector('.cr-member-menu-btn');
        if (btn) {
            var rect = btn.getBoundingClientRect();
            menu.style.top = (rect.top - menu.offsetHeight - 4) + 'px';
            menu.style.left = (rect.right - 150) + 'px';
            menu.classList.remove('hidden');
            // Adjust if off-screen top
            var menuRect = menu.getBoundingClientRect();
            if (menuRect.top < 10) {
                menu.style.top = (rect.bottom + 4) + 'px';
            }
        } else {
            menu.classList.remove('hidden');
        }
    }
}

function crCloseMembersPanel() {
    var modal = document.getElementById('crMembersModal');
    if (modal) modal.remove();
}

async function crClearAllMessages() {
    if (!_crCurrentRoom) return;
    var result = await _crConfirmModal('🗑️ Xóa tất cả', 'Xóa toàn bộ tin nhắn trong phòng?\nKhông thể hoàn tác.', [
        { label: 'Hủy' }, { label: 'Xóa tất cả', danger: true }
    ]);
    if (result !== '1') return;
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
            _crLoadPinnedMessages();
        }
    } catch(e) { showToast('Lỗi', 3000); }
}

async function crReportMessage(msgId) {
    if (!_crCurrentRoom) return;
    document.querySelectorAll('.cr-msg-menu').forEach(function(m) { m.classList.add('hidden'); });

    // Show custom report modal with preset reasons + text input
    var reason = await _crShowReportModal();
    if (reason === null) return; // cancelled

    var headers = _crAuthHeaders();
    if (!headers) return;

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

function _crShowReportModal() {
    return new Promise(function(resolve) {
        var id = 'crReportModal_' + Date.now();
        var html = '<div class="cr-modal-overlay" id="' + id + '" style="z-index:99999">'
            + '<div class="cr-modal" style="max-width:400px;overflow:visible">'
            + '<div class="cr-modal-header"><h3>⚠️ Báo cáo tin nhắn</h3>'
            + '<button type="button" class="cr-modal-close" data-action="cancel">&times;</button></div>'
            + '<div class="cr-modal-body" style="padding:16px 20px">'
            + '<p style="font-size:13px;color:var(--text-secondary,#94a3b8);margin:0 0 12px">Chọn lý do hoặc nhập nội dung:</p>'
            + '<div class="cr-report-reasons">'
            + '<button class="cr-report-reason-btn" data-reason="Spam / Quảng cáo">🚫 Spam / Quảng cáo</button>'
            + '<button class="cr-report-reason-btn" data-reason="Nội dung không phù hợp">⛔ Nội dung không phù hợp</button>'
            + '<button class="cr-report-reason-btn" data-reason="Quấy rối / Xúc phạm">😡 Quấy rối / Xúc phạm</button>'
            + '<button class="cr-report-reason-btn" data-reason="Thông tin sai lệch">❌ Thông tin sai lệch</button>'
            + '</div>'
            + '<textarea class="cr-report-input" id="crReportInput_' + id + '" placeholder="Hoặc nhập lý do khác..." maxlength="500" rows="2"></textarea>'
            + '</div>'
            + '<div class="cr-modal-footer">'
            + '<button class="cr-btn cr-btn-outline" data-action="cancel">Hủy</button>'
            + '<button class="cr-btn cr-btn-primary" data-action="submit">Gửi báo cáo</button>'
            + '</div></div></div>';

        var container = document.createElement('div');
        container.innerHTML = html;
        var overlay = container.firstElementChild;
        document.body.appendChild(overlay);

        var selectedReason = '';
        var input = document.getElementById('crReportInput_' + id);

        // Click preset reason buttons
        overlay.querySelectorAll('.cr-report-reason-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                overlay.querySelectorAll('.cr-report-reason-btn').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                selectedReason = btn.getAttribute('data-reason');
            });
        });

        overlay.addEventListener('click', function(e) {
            var action = e.target.getAttribute('data-action') || e.target.closest('[data-action]')?.getAttribute('data-action');
            if (action === 'cancel' || e.target === overlay) {
                overlay.remove();
                resolve(null);
            } else if (action === 'submit') {
                var customText = input ? input.value.trim() : '';
                var finalReason = customText || selectedReason || '';
                if (!finalReason) {
                    showToast('Vui lòng chọn hoặc nhập lý do', 2000);
                    return;
                }
                overlay.remove();
                resolve(finalReason);
            }
        });
    });
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

    // Custom in-app duration picker
    var result = await _crConfirmModal('🔇 Cấm chat', 'Chọn thời gian cấm:', [
        { label: '1 giờ', primary: false },
        { label: '6 giờ', primary: false },
        { label: '1 ngày', primary: false },
        { label: '3 ngày', primary: false },
        { label: '7 ngày', primary: false },
    ]);

    var durations = ['1h', '6h', '1d', '3d', '7d'];
    var duration = durations[parseInt(result)];
    if (!duration) return; // cancelled

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
    var isCreator = _crCurrentRoom && String(_crCurrentRoom.created_by) === _crCurrentUserId;

    var html = '<div class="cr-modal-overlay" id="crReportsModal" onclick="if(event.target===this)this.remove()">'
        + '<div class="cr-modal cr-modal-lg">'
        + '<div class="cr-modal-header"><h3>⚠️ Báo cáo (' + reports.length + ')</h3>'
        + '<button type="button" class="cr-modal-close" onclick="document.getElementById(\'crReportsModal\').remove()">&times;</button></div>'
        + '<div class="cr-modal-body" style="max-height:60vh;overflow-y:auto">';

    if (reports.length === 0) {
        html += '<div class="cr-empty"><p>Không có báo cáo nào</p></div>';
    } else {
        reports.forEach(function(r) {
            var time = new Date(r.created_at * 1000).toLocaleString('vi-VN');
            var authorId = r.msg_author;
            // Check if we can take action on this user
            // Creator can act on anyone except themselves
            // Admin can act on members only (not creator or other admins)
            var canAct = false;
            if (authorId && String(authorId) !== _crCurrentUserId) {
                if (isCreator) {
                    canAct = true; // creator can act on anyone
                } else {
                    // Admin: can only act on regular members (check role from reports data)
                    canAct = !r.author_is_admin && !r.author_is_creator;
                }
            }

            html += '<div class="cr-report-item">'
                + '<div class="cr-report-header">'
                + '<strong>' + _crEsc(r.reporter_name) + '</strong> báo cáo <strong>' + _crEsc(r.author_name) + '</strong>'
                + '<span class="cr-report-time">' + time + '</span></div>'
                + '<div class="cr-report-content">"' + _crEsc(r.msg_content) + '"</div>'
                + (r.reason ? '<div class="cr-report-reason">Lý do: ' + _crEsc(r.reason) + '</div>' : '')
                + '<div class="cr-report-actions">'
                + '<button class="cr-btn cr-btn-danger-sm" onclick="crDeleteMessage(\'' + r.msg_id + '\');crDismissReport(' + r.id + ')">🗑️ Xóa tin nhắn</button>';

            if (canAct && authorId) {
                html += '<button class="cr-btn cr-btn-danger-sm" onclick="crReportActionKick(' + authorId + ',' + r.id + ')">🚪 Kick</button>'
                    + '<button class="cr-btn cr-btn-danger-sm" onclick="crReportActionBan(' + authorId + ',' + r.id + ')">🚫 Chặn</button>'
                    + '<button class="cr-btn cr-btn-danger-sm" onclick="crReportActionMute(' + authorId + ',' + r.id + ')">🔇 Cấm chat</button>';
            }

            html += '<button class="cr-btn cr-btn-outline" style="font-size:11px;padding:4px 8px" onclick="crDismissReport(' + r.id + ')">Bỏ qua</button>'
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

async function crReportActionKick(userId, reportId) {
    document.getElementById('crReportsModal')?.remove();
    await crKickUser(userId);
    crDismissReport(reportId);
}

async function crReportActionBan(userId, reportId) {
    document.getElementById('crReportsModal')?.remove();
    await crBanUser(userId);
    crDismissReport(reportId);
}

async function crReportActionMute(userId, reportId) {
    document.getElementById('crReportsModal')?.remove();
    await crMuteUser(userId);
    crDismissReport(reportId);
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
                    var wasAtBottom = _crIsAtBottom();
                    _crMessages = newMsgs;
                    _crRenderMessages();
                    if (wasAtBottom) _crScrollToBottom();
                }
                _crUpdateMuteStatus(data.muted_until, data.chat_locked);
            _crUpdateUnreadUI(data);
                // Update room owner if changed (transfer)
                if (data.created_by && _crCurrentRoom && String(_crCurrentRoom.created_by) !== String(data.created_by)) {
                    _crCurrentRoom.created_by = data.created_by;
                    _crOnOwnershipChanged();
                }
            })
            .catch(function() {});

        // Also check reports for admins
        _crCheckReports();
        // Check typing indicators
        _crPollTyping();
        // Send heartbeat (online status)
        _crSendHeartbeat();
        // Check online users
        _crPollOnline();
    }, 5000);
}

function _crStopPolling() {
    if (_crPollTimer) {
        clearInterval(_crPollTimer);
        _crPollTimer = null;
    }
}

// ── Emoji Picker ──
var _crEmojiData = {
    '😀': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😗','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐'],
    '👋': ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏'],
    '❤️': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️','🔥','⭐','🌟','✨','💫','💥','💢','💦','💨','🕊️'],
    '🎉': ['🎉','🎊','🎈','🎁','🎀','🏆','🥇','🥈','🥉','⚽','🏀','🎮','🎯','🎲','🎵','🎶','🎸','🎹','🎤','📚','📖','✏️','📝','💡','🔔','📌','📎','✅','❌','⚠️']
};

function crToggleEmojiPicker() {
    var picker = document.getElementById('crEmojiPicker');
    if (!picker) return;

    if (!picker.classList.contains('hidden')) {
        picker.classList.add('hidden');
        return;
    }

    // Build picker content if empty
    if (!picker.innerHTML) {
        var html = '<div class="cr-emoji-tabs">';
        var categories = Object.keys(_crEmojiData);
        categories.forEach(function(cat, i) {
            html += '<button class="cr-emoji-tab' + (i === 0 ? ' active' : '') + '" onclick="crSwitchEmojiTab(' + i + ')">' + cat + '</button>';
        });
        html += '</div><div class="cr-emoji-grid" id="crEmojiGrid"></div>';
        picker.innerHTML = html;
        crSwitchEmojiTab(0);
    }

    picker.classList.remove('hidden');
}

function crSwitchEmojiTab(idx) {
    var categories = Object.keys(_crEmojiData);
    var emojis = _crEmojiData[categories[idx]] || [];
    var grid = document.getElementById('crEmojiGrid');
    if (grid) {
        grid.innerHTML = emojis.map(function(e) {
            return '<button class="cr-emoji-item" onclick="crInsertEmoji(\'' + e + '\')">' + e + '</button>';
        }).join('');
    }
    // Update active tab
    document.querySelectorAll('.cr-emoji-tab').forEach(function(t, i) {
        t.classList.toggle('active', i === idx);
    });
}

function crInsertEmoji(emoji) {
    var input = document.getElementById('crMessageInput');
    if (input) {
        var start = input.selectionStart || input.value.length;
        input.value = input.value.substring(0, start) + emoji + input.value.substring(input.selectionEnd || start);
        input.focus();
        input.selectionStart = input.selectionEnd = start + emoji.length;
    }
}

// Close emoji picker on outside click
document.addEventListener('click', function(e) {
    if (!e.target.closest('.cr-emoji-wrap')) {
        var picker = document.getElementById('crEmojiPicker');
        if (picker) picker.classList.add('hidden');
    }
});

// ── Typing indicator ──
var _crTypingTimer = null;
var _crLastTypingSent = 0;

function _crOnTyping() {
    if (!_crCurrentRoom) return;
    var now = Date.now();
    // Only send typing signal every 3 seconds
    if (now - _crLastTypingSent < 3000) return;
    _crLastTypingSent = now;

    var headers = _crAuthHeaders();
    if (!headers) return;
    fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/typing', {
        method: 'POST', headers: headers
    }, 5000).catch(function() {});
}

function _crPollTyping() {
    if (!_crCurrentRoom) return;
    var headers = _crAuthHeaders();
    if (!headers) return;

    fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/typing', { headers: headers }, 5000)
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var typers = data.typing || [];
            var el = document.getElementById('crTypingIndicator');
            if (!el) return;
            if (typers.length === 0) {
                el.classList.add('hidden');
                el.textContent = '';
            } else {
                var text = typers.length === 1
                    ? typers[0] + ' đang nhập...'
                    : typers.slice(0, 2).join(', ') + (typers.length > 2 ? ' và ' + (typers.length - 2) + ' người khác' : '') + ' đang nhập...';
                el.textContent = '✏️ ' + text;
                el.classList.remove('hidden');
            }
        })
        .catch(function() {});
}

// ── Unread & Notification Mute ──
var _crLastReadAt = 0;
var _crNotifMuted = false;

function _crUpdateUnreadUI(data) {
    var lastRead = data.last_read_at || 0;
    var notifMuted = data.notif_muted || false;
    _crLastReadAt = lastRead;
    _crNotifMuted = notifMuted;

    // Count unread messages
    var unreadCount = 0;
    _crMessages.forEach(function(m) {
        if (m.created_at > lastRead && String(m.user_id) !== _crCurrentUserId && String(m.user_id) !== '__system__') {
            unreadCount++;
        }
    });

    // Show/hide unread button
    var btn = document.getElementById('crUnreadBtn');
    var btnText = document.getElementById('crUnreadBtnText');
    if (btn) {
        if (unreadCount > 0) {
            btn.classList.remove('hidden');
            if (btnText) btnText.textContent = '↓ ' + unreadCount + ' tin nhắn mới';
        } else {
            btn.classList.add('hidden');
        }
    }

    // Update mute menu text
    var hmNotif = document.getElementById('crHmNotif');
    if (hmNotif) {
        hmNotif.textContent = notifMuted ? '🔔 Bật thông báo' : '🔕 Tắt thông báo';
    }
}

var _crJumpedToUnread = false;

function crJumpToUnread() {
    if (!_crJumpedToUnread) {
        // First click: jump to first unread message
        var firstUnread = null;
        for (var i = 0; i < _crMessages.length; i++) {
            var m = _crMessages[i];
            if (m.created_at > _crLastReadAt && String(m.user_id) !== _crCurrentUserId && String(m.user_id) !== '__system__') {
                firstUnread = m;
                break;
            }
        }
        if (firstUnread) {
            crScrollToMessage(firstUnread.id);
        } else {
            _crScrollToBottom();
        }
        _crJumpedToUnread = true;
        // Change button text to "go to bottom"
        var btnText = document.getElementById('crUnreadBtnText');
        if (btnText) btnText.textContent = '↓ Xuống cuối';
    } else {
        // Second click: scroll to bottom + mark as read
        _crScrollToBottom();
        _crMarkAsRead();
        _crJumpedToUnread = false;
    }
}

function _crMarkAsRead() {
    if (!_crCurrentRoom) return;
    var headers = _crAuthHeaders();
    if (!headers) return;
    fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/mark-read', {
        method: 'POST', headers: headers
    }, 5000).then(function() {
        _crLastReadAt = Date.now() / 1000;
        var btn = document.getElementById('crUnreadBtn');
        if (btn) btn.classList.add('hidden');
    }).catch(function() {});
}

async function crToggleNotifMute() {
    if (!_crCurrentRoom) return;
    var headers = _crAuthHeaders();
    if (!headers) return;
    try {
        var res = await fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/toggle-notifications', {
            method: 'POST', headers: headers
        }, 5000);
        if (res.ok) {
            var data = await res.json();
            _crNotifMuted = data.muted;
            showToast(data.muted ? '🔕 Đã tắt thông báo phòng này' : '🔔 Đã bật thông báo', 2000);
            var hmNotif = document.getElementById('crHmNotif');
            if (hmNotif) hmNotif.textContent = data.muted ? '🔔 Bật thông báo' : '🔕 Tắt thông báo';
        }
    } catch(e) {}
}

function _crSendHeartbeat() {
    if (!_crCurrentRoom) return;
    var headers = _crAuthHeaders();
    if (!headers) return;
    fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/heartbeat', {
        method: 'POST', headers: headers
    }, 5000).catch(function() {});
}

var _crOnlineIds = []; // list of user_ids currently online
var _crMyOnlineHidden = false;

function _crPollOnline() {
    if (!_crCurrentRoom) return;
    var headers = _crAuthHeaders();
    if (!headers) return;

    fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/online', { headers: headers }, 5000)
        .then(function(r) { return r.json(); })
        .then(function(data) {
            _crOnlineIds = data.online_ids || [];
            _crMyOnlineHidden = data.my_hidden || false;
            var count = data.count || 0;
            var membersEl = document.getElementById('crChatRoomMembers');
            if (membersEl) {
                if (_crMyOnlineHidden) {
                    membersEl.innerHTML = '<span class="cr-offline-dot"></span> Ẩn danh';
                } else {
                    membersEl.innerHTML = '<span class="cr-online-dot"></span> ' + count + ' online';
                }
            }
            // Update online dots on visible messages
            _crUpdateOnlineDots();
            // Update menu text
            var hmOnline = document.getElementById('crHmOnline');
            if (hmOnline) {
                hmOnline.textContent = _crMyOnlineHidden ? '🟢 Hiện trạng thái online' : '👻 Ẩn trạng thái online';
            }
        })
        .catch(function() {});
}

function _crUpdateOnlineDots() {
    // Add/remove online dot class on message avatars
    document.querySelectorAll('.cr-msg[data-msg-id]').forEach(function(msgEl) {
        var avatar = msgEl.querySelector('.cr-msg-avatar');
        if (!avatar) return;
        // Get user_id from the message data
        var msgId = msgEl.getAttribute('data-msg-id');
        var msg = _crMessages.find(function(m) { return m.id === msgId; });
        if (msg && _crOnlineIds.indexOf(String(msg.user_id)) >= 0) {
            avatar.classList.add('cr-avatar-online');
        } else {
            avatar.classList.remove('cr-avatar-online');
        }
    });
}

async function crToggleOnlineVisibility() {
    var headers = _crAuthHeaders();
    if (!headers) return;
    try {
        var res = await fetchWithTimeout('/api/chat-rooms/toggle-online-visibility', {
            method: 'POST', headers: headers
        }, 5000);
        if (res.ok) {
            var data = await res.json();
            _crMyOnlineHidden = data.hidden;
            showToast(data.hidden ? '👻 Đã ẩn trạng thái online — bạn không thấy ai online' : '🟢 Đã hiện trạng thái online', 3000);
            _crPollOnline();
        }
    } catch(e) {}
}

async function crLockChat() {
    if (!_crCurrentRoom) return;
    var isCreator = String(_crCurrentRoom.created_by) === _crCurrentUserId;
    if (!isCreator) { showToast('Chỉ chủ phòng mới có thể khóa chat', 3000); return; }

    // Fetch members to let creator pick who can still chat
    var headers = _crAuthHeaders();
    if (!headers) return;
    var membersData = [];
    try {
        var mRes = await fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/members', { headers: headers }, 10000);
        if (mRes.ok) { var mData = await mRes.json(); membersData = mData.members || []; }
    } catch(e) {}

    var otherMembers = membersData.filter(function(m) { return String(m.user_id) !== _crCurrentUserId; });

    // Show picker modal
    var allowedIds = await _crShowLockPickerModal(otherMembers);
    if (allowedIds === null) return; // cancelled

    try {
        var res = await fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/lock-chat', {
            method: 'POST', headers: headers,
            body: JSON.stringify({ locked: true, allowed_user_ids: allowedIds })
        }, 10000);
        if (res.ok) {
            showToast('🔒 Đã khóa chat' + (allowedIds.length ? ' (' + allowedIds.length + ' người được phép)' : ''), 2000);
            _crLoadMessages();
        }
    } catch(e) { showToast('Lỗi', 3000); }
}

function _crShowLockPickerModal(members) {
    return new Promise(function(resolve) {
        var id = 'crLockPicker_' + Date.now();
        var listHtml = members.map(function(m) {
            return '<label class="cr-lock-member">'
                + '<input type="checkbox" value="' + m.user_id + '">'
                + '<span>' + _crEsc(m.display_name) + '</span>'
                + '</label>';
        }).join('');

        var html = '<div class="cr-modal-overlay" id="' + id + '" style="z-index:99999" onclick="if(event.target===this){this.remove();}">'
            + '<div class="cr-modal" style="max-width:380px;max-height:80vh;overflow-y:auto">'
            + '<div class="cr-modal-header"><h3>🔒 Khóa chat</h3>'
            + '<button type="button" class="cr-modal-close" data-action="cancel">&times;</button></div>'
            + '<div class="cr-modal-body" style="padding:16px">'
            + '<p style="font-size:13px;color:var(--text-secondary,#94a3b8);margin:0 0 12px">Chọn người vẫn được phép nhắn tin (ngoài bạn):</p>'
            + '<div class="cr-lock-members-list">' + (listHtml || '<p style="opacity:0.6">Không có thành viên khác</p>') + '</div>'
            + '</div>'
            + '<div class="cr-modal-footer">'
            + '<button class="cr-btn cr-btn-outline" data-action="cancel">Hủy</button>'
            + '<button class="cr-btn cr-btn-primary" data-action="lock" style="background:#ef4444">🔒 Khóa</button>'
            + '</div></div></div>';

        var container = document.createElement('div');
        container.innerHTML = html;
        var overlay = container.firstElementChild;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', function(e) {
            var action = e.target.getAttribute('data-action') || (e.target.closest('[data-action]') || {}).getAttribute?.('data-action');
            if (action === 'cancel') { overlay.remove(); resolve(null); }
            else if (action === 'lock') {
                var checked = overlay.querySelectorAll('input[type=checkbox]:checked');
                var ids = [];
                checked.forEach(function(cb) { ids.push(parseInt(cb.value)); });
                overlay.remove();
                resolve(ids);
            }
        });
    });
}

async function crUnlockChat() {
    if (!_crCurrentRoom) return;
    var headers = _crAuthHeaders();
    if (!headers) return;
    try {
        var res = await fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/lock-chat', {
            method: 'POST', headers: headers,
            body: JSON.stringify({ locked: false, allowed_user_ids: [] })
        }, 10000);
        if (res.ok) {
            showToast('🔓 Đã mở khóa chat', 2000);
            _crLoadMessages();
        }
    } catch(e) { showToast('Lỗi', 3000); }
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

async function crLeaveRoom() {
    if (!_crCurrentRoom) return;

    // Creator cannot leave — must transfer ownership
    var isCreator = String(_crCurrentRoom.created_by) === _crCurrentUserId;
    if (isCreator) {
        await _crConfirmModal('❌ Không thể rời phòng', 'Bạn là chủ phòng. Hãy chuyển quyền chủ phòng\n(trong Thông tin phòng → ⚙️ Cài đặt)\nhoặc xóa phòng trước khi rời.', [
            { label: 'Đã hiểu', primary: true }
        ]);
        return;
    }

    var result = await _crConfirmModal('🚪 Rời phòng', 'Bạn có chắc muốn rời phòng chat này?', [
        { label: 'Ở lại' }, { label: 'Rời phòng', danger: true }
    ]);
    if (result !== '1') return;

    var headers = _crAuthHeaders();
    if (!headers) return;

    try {
        var res = await fetchWithTimeout('/api/chat-rooms/' + _crCurrentRoom.id + '/leave', {
            method: 'POST', headers: headers
        }, 10000);
        if (res.ok) {
            var data = await res.json();
            if (data.ok) {
                showToast('Đã rời phòng', 2000);
                crBackToList();
            }
        } else {
            var err = await res.json().catch(function() { return {}; });
            showToast(err.detail || 'Không thể rời phòng', 3000);
        }
    } catch(e) {
        showToast('Lỗi kết nối', 3000);
    }
}

async function crDeleteRoom() {
    if (!_crCurrentRoom) return;
    var result = await _crConfirmModal('🗑️ Xóa phòng', 'Xóa phòng chat này?\nTất cả tin nhắn sẽ bị mất vĩnh viễn.', [
        { label: 'Hủy' }, { label: 'Xóa phòng', danger: true }
    ]);
    if (result !== '1') return;

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
