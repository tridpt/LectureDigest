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
    // Check local reminders after a short delay
    setTimeout(_notifCheckLocalReminders, 3000);
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

        // id/link live in data attributes (escaped) and the click is wired via a
        // listener below — never interpolate link into an inline handler, which
        // mixes HTML + JS escaping and is XSS-prone if link ever becomes dynamic.
        return '<div class="notif-item' + readClass + '" data-notif-id="' + n.id + '" data-notif-link="' + _notifEsc(n.link || '') + '">'
            + '<div class="notif-icon">' + icon + '</div>'
            + '<div class="notif-content">'
            + '<div class="notif-title">' + _notifEsc(n.title) + '</div>'
            + (n.message ? '<div class="notif-message">' + _notifEsc(n.message) + '</div>' : '')
            + '<div class="notif-time">' + timeStr + '</div>'
            + '</div></div>';
    }).join('');

    body.querySelectorAll('.notif-item[data-notif-id]').forEach(function(item) {
        item.addEventListener('click', function() {
            notifClick(parseInt(item.getAttribute('data-notif-id'), 10), item.getAttribute('data-notif-link') || '');
        });
    });
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
    // Mark as read — only call server for server-side notifications (id > 0)
    if (id > 0) {
        var token = localStorage.getItem('ld_auth_token');
        if (token) {
            try {
                await fetchWithTimeout(API_BASE + '/api/notifications/read/' + id, {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token }
                }, 5000);
            } catch(e) {}
        }
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
    } else if (link && link.indexOf('/chat/') === 0) {
        // Chat room link, possibly with #msg_id
        var parts = link.split('#');
        var roomPath = parts[0];
        var msgHash = parts[1] || '';
        var roomId = roomPath.replace('/chat/', '');
        if (typeof _crOpenRoomById === 'function') {
            _crOpenRoomById(roomId).then(function() {
                if (msgHash && msgHash.indexOf('msg_') === 0) {
                    var msgId = msgHash.replace('msg_', '');
                    setTimeout(function() { if (typeof crScrollToMessage === 'function') crScrollToMessage(msgId); }, 1000);
                }
            });
        } else if (typeof openChatRooms === 'function') {
            openChatRooms();
        }
    } else if (link === '/chat') {
        if (typeof openChatRooms === 'function') openChatRooms();
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
    // Escape quotes too so the result is safe inside HTML attributes
    // (e.g. data-notif-link="..."), not just in text nodes.
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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

// ══════════════════════════════════════════════════════
// LOCAL REMINDERS (SRS + Study Plan)
// ══════════════════════════════════════════════════════

var _NOTIF_LOCAL_KEY = 'lectureDigest_localNotifDate';

function _notifCheckLocalReminders() {
    // Only show once per day
    var today = new Date().toISOString().split('T')[0];
    var lastCheck = localStorage.getItem(_NOTIF_LOCAL_KEY) || '';
    if (lastCheck === today) return;

    var added = false;

    // 1. SRS Flashcard reminder
    added = _notifCheckSRS() || added;

    // 2. Study Plan reminder
    added = _notifCheckStudyPlan() || added;

    // Mark today as checked
    safeLsSet(_NOTIF_LOCAL_KEY, today);

    // If we added local notifications, update the panel
    if (added) {
        _notifUpdateBadge();
        if (_notifPanelOpen) _notifRenderPanel();
    }
}

function _notifCheckSRS() {
    // Count due flashcards across all videos
    var today = new Date().toISOString().split('T')[0];
    var dueCount = 0;

    try {
        for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i);
            if (!key || key.indexOf('lectureDigest_sm2_') !== 0) continue;
            var sm2Data = JSON.parse(localStorage.getItem(key));
            for (var cardKey in sm2Data) {
                var card = sm2Data[cardKey];
                if (!card.nextReview || card.nextReview <= today) dueCount++;
            }
        }
    } catch(e) {}

    if (dueCount > 0) {
        // Add local notification to the list
        _notifData.unshift({
            id: -1,
            type: 'srs_reminder',
            title: '🧠 Bạn có ' + dueCount + ' flashcard cần ôn tập',
            message: 'Ôn tập hàng ngày giúp ghi nhớ lâu hơn!',
            link: '/review',
            is_read: false,
            created_at: Date.now(),
            _local: true
        });
        _notifUnread++;
        return true;
    }
    return false;
}

function _notifCheckStudyPlan() {
    try {
        var planRaw = localStorage.getItem('lectureDigest_studyPlan');
        if (!planRaw) return false;
        var plan = JSON.parse(planRaw);
        if (!plan || !plan.weekly_schedule) return false;

        // Count total tasks and completed tasks
        var completedRaw = localStorage.getItem('lectureDigest_studyPlan_completed');
        var completed = completedRaw ? JSON.parse(completedRaw) : {};

        var totalTasks = 0;
        var completedCount = 0;
        var schedule = plan.weekly_schedule || [];
        for (var w = 0; w < schedule.length; w++) {
            var days = schedule[w].days || [];
            for (var d = 0; d < days.length; d++) {
                var tasks = days[d].tasks || [];
                for (var t = 0; t < tasks.length; t++) {
                    totalTasks++;
                    if (completed[w + '-' + d + '-' + t]) completedCount++;
                }
            }
        }

        var remaining = totalTasks - completedCount;
        if (remaining > 0 && completedCount < totalTasks) {
            _notifData.unshift({
                id: -2,
                type: 'study_plan',
                title: '📅 Lộ trình: còn ' + remaining + ' nhiệm vụ chưa hoàn thành',
                message: 'Tiếp tục học để đạt mục tiêu!',
                link: '/study-plan',
                is_read: false,
                created_at: Date.now(),
                _local: true
            });
            _notifUnread++;
            return true;
        }
    } catch(e) {}
    return false;
}
