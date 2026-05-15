/* ════════════════════════════════════════════════
   LectureDigest — Notifications Module
   Bell icon, dropdown panel, polling for new notifications
   ════════════════════════════════════════════════ */

var _notifData = [];
var _notifUnread = 0;
var _notifPollTimer = null;
var _notifPanelOpen = false;

// ══════════════════════════════════════════════════════
// INIT & POLLING
// ══════════════════════════════════════════════════════

function notifInit() {
    var token = localStorage.getItem('ld_auth_token');
    if (!token) return;
    notifFetch();
    _notifStartPolling();
}

function _notifStartPolling() {
    _notifStopPolling();
    _notifPollTimer = setInterval(function() {
        var token = localStorage.getItem('ld_auth_token');
        if (token) notifFetch();
    }, 30000); // Poll every 30s
}

function _notifStopPolling() {
    if (_notifPollTimer) { clearInterval(_notifPollTimer); _notifPollTimer = null; }
}

// ══════════════════════════════════════════════════════
// FETCH
// ══════════════════════════════════════════════════════

async function notifFetch() {
    var token = localStorage.getItem('ld_auth_token');
    if (!token) return;

    try {
        var res = await fetchWithTimeout(API_BASE + '/api/notifications', {
            headers: { 'Authorization': 'Bearer ' + token }
        }, 10000);
        if (!res.ok) return;
        var data = await res.json();
        _notifData = data.notifications || [];
        var prevUnread = _notifUnread;
        _notifUnread = data.unread_count || 0;
        _notifUpdateBadge();

        // Show toast for new notifications
        if (_notifUnread > prevUnread && prevUnread >= 0) {
            var newest = _notifData.find(function(n) { return !n.is_read; });
            if (newest) showToast('🔔 ' + newest.title, 3000);
        }

        if (_notifPanelOpen) _notifRenderPanel();
    } catch(e) {}
}

// ══════════════════════════════════════════════════════
// UI
// ══════════════════════════════════════════════════════

function _notifUpdateBadge() {
    var badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (_notifUnread > 0) {
        badge.textContent = _notifUnread > 99 ? '99+' : _notifUnread;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function toggleNotifPanel() {
    var panel = document.getElementById('notifPanel');
    if (!panel) return;
    _notifPanelOpen = !_notifPanelOpen;
    panel.classList.toggle('hidden', !_notifPanelOpen);
    if (_notifPanelOpen) {
        _notifRenderPanel();
        notifFetch(); // Refresh on open
    }
}

function closeNotifPanel() {
    var panel = document.getElementById('notifPanel');
    if (panel) panel.classList.add('hidden');
    _notifPanelOpen = false;
}

function _notifRenderPanel() {
    var body = document.getElementById('notifBody');
    if (!body) return;

    if (_notifData.length === 0) {
        body.innerHTML = '<div class="notif-empty"><div style="font-size:2rem">🔔</div><p>Không có thông báo</p></div>';
        return;
    }

    body.innerHTML = _notifData.map(function(n) {
        var timeStr = _notifTimeAgo(n.created_at);
        var icon = _notifIcon(n.type);
        var readClass = n.is_read ? ' notif-read' : '';

        return '<div class="notif-item' + readClass + '" onclick="notifClick(' + n.id + ',\'' + (n.link || '') + '\')">'
            + '<div class="notif-icon">' + icon + '</div>'
            + '<div class="notif-content">'
            + '<div class="notif-title">' + _notifEsc(n.title) + '</div>'
            + (n.message ? '<div class="notif-message">' + _notifEsc(n.message) + '</div>' : '')
            + '<div class="notif-time">' + timeStr + '</div>'
            + '</div></div>';
    }).join('');
}

function _notifIcon(type) {
    var icons = {
        room_join: '👋',
        room_kicked: '🚫',
        room_promoted: '🛡️',
        room_demoted: '👤',
        room_video: '🎬',
        room_comment: '💬',
        srs_reminder: '🧠',
        study_plan: '📅'
    };
    return icons[type] || '🔔';
}

function _notifTimeAgo(ts) {
    var diff = Date.now() - ts;
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Vừa xong';
    if (mins < 60) return mins + ' phút trước';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + ' giờ trước';
    var days = Math.floor(hours / 24);
    if (days < 7) return days + ' ngày trước';
    return new Date(ts).toLocaleDateString('vi-VN');
}

// ══════════════════════════════════════════════════════
// ACTIONS
// ══════════════════════════════════════════════════════

async function notifClick(id, link) {
    // Mark as read
    var token = localStorage.getItem('ld_auth_token');
    if (token) {
        try {
            await fetchWithTimeout(API_BASE + '/api/notifications/read/' + id, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token }
            }, 5000);
        } catch(e) {}
    }

    // Update local state
    _notifData.forEach(function(n) { if (n.id === id) n.is_read = true; });
    _notifUnread = Math.max(0, _notifUnread - 1);
    _notifUpdateBadge();
    _notifRenderPanel();

    // Navigate
    closeNotifPanel();
    if (link === '/rooms') {
        if (typeof openStudyRooms === 'function') openStudyRooms();
    } else if (link === '/review') {
        if (typeof openSrsReview === 'function') openSrsReview();
    } else if (link === '/study-plan') {
        if (typeof openStudyPlan === 'function') openStudyPlan();
    }
}

async function notifMarkAllRead() {
    var token = localStorage.getItem('ld_auth_token');
    if (!token) return;
    try {
        await fetchWithTimeout(API_BASE + '/api/notifications/read-all', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token }
        }, 5000);
    } catch(e) {}
    _notifData.forEach(function(n) { n.is_read = true; });
    _notifUnread = 0;
    _notifUpdateBadge();
    _notifRenderPanel();
}

async function notifClearAll() {
    var token = localStorage.getItem('ld_auth_token');
    if (!token) return;
    try {
        await fetchWithTimeout(API_BASE + '/api/notifications', {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token }
        }, 5000);
    } catch(e) {}
    _notifData = [];
    _notifUnread = 0;
    _notifUpdateBadge();
    _notifRenderPanel();
}

function _notifEsc(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ── Init on page load (after auth loads) ──
setTimeout(notifInit, 2000);

// Close panel when clicking outside
document.addEventListener('click', function(e) {
    if (!_notifPanelOpen) return;
    var panel = document.getElementById('notifPanel');
    var btn = document.getElementById('notifToggleBtn');
    if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
        closeNotifPanel();
    }
});
