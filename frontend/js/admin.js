/* ════════════════════════════════════════════════
   LectureDigest — Admin Panel
   System stats + user management. Access gated server-side
   by ADMIN_EMAILS env var; this UI only shows for admins.
   ════════════════════════════════════════════════ */

// Register section + route
if (typeof SECTION_IDS !== 'undefined' && !SECTION_IDS.includes('adminSection')) {
    SECTION_IDS.push('adminSection');
}
if (typeof SPA_ROUTES !== 'undefined') SPA_ROUTES['adminSection'] = '/admin';

var _adminPrevSection = 'hero';
var _adminUserPage = 1;
var _adminUserSearch = '';
var _adminSearchTimer = null;

function _adminAuthHeaders() {
    var headers = { 'Content-Type': 'application/json' };
    try {
        var token = localStorage.getItem('ld_auth_token');
        if (token) headers['Authorization'] = 'Bearer ' + token;
    } catch (e) {}
    return headers;
}

// ── Check admin status (called on login/init to show/hide the nav link) ──
function adminCheckAccess() {
    var link = document.getElementById('adminNavLink');
    fetch((window.API_BASE || '') + '/api/admin/check', { headers: _adminAuthHeaders() })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (link) link.style.display = (data && data.is_admin) ? '' : 'none';
        })
        .catch(function() { if (link) link.style.display = 'none'; });
}

// ── Open / Close ──
function openAdmin() {
    _adminPrevSection = (typeof SECTION_IDS !== 'undefined' ? SECTION_IDS.find(function(id) {
        var el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
    }) : null) || 'hero';

    if (typeof _authCloseUserMenu === 'function') _authCloseUserMenu();
    showSection('adminSection');
    window.scrollTo({ top: 0, behavior: 'instant' });

    _adminUserPage = 1;
    _adminUserSearch = '';
    _adminLoadStats();
    _adminLoadUsers();
}

function closeAdmin() {
    var el = document.getElementById('adminSection');
    if (el) el.classList.add('hidden');
    showSection(_adminPrevSection);
    window.scrollTo({ top: 0, behavior: 'instant' });
}

// ── Stats ──
function _adminLoadStats() {
    var el = document.getElementById('adminStats');
    if (!el) return;
    el.innerHTML = '<div class="admin-loading">Đang tải thống kê...</div>';

    fetch((window.API_BASE || '') + '/api/admin/stats', { headers: _adminAuthHeaders() })
        .then(function(r) {
            if (r.status === 403) throw new Error('forbidden');
            return r.ok ? r.json() : null;
        })
        .then(function(d) {
            if (!d) { el.innerHTML = '<div class="admin-error">Không tải được thống kê</div>'; return; }
            _adminRenderStats(el, d);
        })
        .catch(function(e) {
            if (e.message === 'forbidden') {
                el.innerHTML = '<div class="admin-error">⛔ Bạn không có quyền truy cập</div>';
                setTimeout(closeAdmin, 1500);
            } else {
                el.innerHTML = '<div class="admin-error">Lỗi tải thống kê</div>';
            }
        });
}

function _adminStatCard(icon, value, label, color) {
    return '<div class="admin-stat-card" style="--ac:' + color + '">'
        + '<div class="admin-stat-icon">' + icon + '</div>'
        + '<div class="admin-stat-value">' + value + '</div>'
        + '<div class="admin-stat-label">' + label + '</div>'
        + '</div>';
}

function _adminRenderStats(el, d) {
    var u = d.users || {};
    var c = d.content || {};
    var html = '';

    html += '<div class="admin-section-label">👥 Người dùng</div>';
    html += '<div class="admin-stat-grid">';
    html += _adminStatCard('👤', u.total || 0, 'Tổng người dùng', '#8b5cf6');
    html += _adminStatCard('🆕', u.new_7d || 0, 'Mới (7 ngày)', '#10b981');
    html += _adminStatCard('📅', u.new_30d || 0, 'Mới (30 ngày)', '#06b6d4');
    html += _adminStatCard('🔑', u.google || 0, 'Google', '#f59e0b');
    html += _adminStatCard('✉️', u.password || 0, 'Email/MK', '#ec4899');
    html += '</div>';

    html += '<div class="admin-section-label">📚 Nội dung</div>';
    html += '<div class="admin-stat-grid">';
    html += _adminStatCard('🎬', c.distinct_videos || 0, 'Video đã phân tích', '#8b5cf6');
    html += _adminStatCard('📊', c.history_entries || 0, 'Lượt phân tích', '#6366f1');
    html += _adminStatCard('📝', c.notes || 0, 'Ghi chú', '#10b981');
    html += _adminStatCard('🔖', c.bookmarks || 0, 'Bookmark', '#f59e0b');
    html += _adminStatCard('🔗', c.shared_notes || 0, 'Note chia sẻ', '#06b6d4');
    html += _adminStatCard('📁', c.folders || 0, 'Thư mục', '#a855f7');
    html += _adminStatCard('⚡', c.cached_analyses || 0, 'Cache phân tích', '#ef4444');
    html += '</div>';

    el.innerHTML = html;
}

// ── Users ──
function _adminLoadUsers() {
    var el = document.getElementById('adminUsersList');
    if (!el) return;
    el.innerHTML = '<div class="admin-loading">Đang tải danh sách...</div>';

    var url = (window.API_BASE || '') + '/api/admin/users?page=' + _adminUserPage
        + '&per_page=20&search=' + encodeURIComponent(_adminUserSearch);

    fetch(url, { headers: _adminAuthHeaders() })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) {
            if (!d) { el.innerHTML = '<div class="admin-error">Không tải được danh sách</div>'; return; }
            _adminRenderUsers(el, d);
        })
        .catch(function() { el.innerHTML = '<div class="admin-error">Lỗi tải danh sách</div>'; });
}

function _adminRenderUsers(el, d) {
    var users = d.users || [];
    if (!users.length) {
        el.innerHTML = '<div class="admin-empty">Không có người dùng nào' + (_adminUserSearch ? ' khớp "' + escHtml(_adminUserSearch) + '"' : '') + '</div>';
        return;
    }

    var rows = users.map(function(u) {
        var avatar = u.avatar_url
            ? '<img class="admin-user-avatar" src="' + u.avatar_url + '" alt="">'
            : '<div class="admin-user-avatar" style="background:' + (u.avatar_color || '#8b5cf6') + '">'
                + (u.display_name || '?').charAt(0).toUpperCase() + '</div>';
        var date = u.created_at ? new Date(u.created_at).toLocaleDateString('vi-VN') : '';
        var badges = '';
        if (u.is_admin) badges += '<span class="admin-badge admin-badge-admin">ADMIN</span>';
        badges += u.is_google
            ? '<span class="admin-badge admin-badge-google">Google</span>'
            : '<span class="admin-badge admin-badge-email">Email</span>';

        var delBtn = u.is_admin
            ? '<button class="admin-del-btn" disabled title="Không thể xóa admin">🔒</button>'
            : '<button class="admin-del-btn" onclick="adminDeleteUser(' + u.id + ', \'' + _adminEsc(u.email) + '\')" title="Xóa người dùng">🗑️</button>';

        return '<div class="admin-user-row">'
            + avatar
            + '<div class="admin-user-info">'
            + '<div class="admin-user-name">' + escHtml(u.display_name || 'Chưa đặt tên') + ' ' + badges + '</div>'
            + '<div class="admin-user-email">' + escHtml(u.email || '') + '</div>'
            + '</div>'
            + '<div class="admin-user-meta">'
            + '<span title="Số video phân tích">🎬 ' + (u.history_count || 0) + '</span>'
            + '<span title="Ngày tạo">📅 ' + date + '</span>'
            + '</div>'
            + delBtn
            + '</div>';
    }).join('');

    var pageInfo = 'Trang ' + d.page + ' · ' + d.total + ' người dùng';
    var pager = '<div class="admin-pager">'
        + '<button class="admin-page-btn" ' + (d.page <= 1 ? 'disabled' : '') + ' onclick="adminUsersPage(-1)">← Trước</button>'
        + '<span class="admin-page-info">' + pageInfo + '</span>'
        + '<button class="admin-page-btn" ' + (d.has_more ? '' : 'disabled') + ' onclick="adminUsersPage(1)">Sau →</button>'
        + '</div>';

    el.innerHTML = '<div class="admin-user-rows">' + rows + '</div>' + pager;
}

function adminUsersPage(dir) {
    _adminUserPage = Math.max(1, _adminUserPage + dir);
    _adminLoadUsers();
}

function adminSearchUsers(value) {
    _adminUserSearch = value || '';
    _adminUserPage = 1;
    clearTimeout(_adminSearchTimer);
    _adminSearchTimer = setTimeout(_adminLoadUsers, 300);
}

function adminDeleteUser(userId, email) {
    if (!confirm('Xóa vĩnh viễn người dùng "' + email + '" và toàn bộ dữ liệu của họ?\n\nHành động này KHÔNG THỂ hoàn tác.')) {
        return;
    }
    fetch((window.API_BASE || '') + '/api/admin/users/' + userId, {
        method: 'DELETE',
        headers: _adminAuthHeaders()
    })
        .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
        .then(function(res) {
            if (res.ok) {
                if (typeof showToast === 'function') showToast('🗑️ Đã xóa người dùng', 2500);
                _adminLoadUsers();
                _adminLoadStats();
            } else {
                if (typeof showToast === 'function') showToast('❌ ' + (res.data.detail || 'Không thể xóa'), 3000);
            }
        })
        .catch(function() {
            if (typeof showToast === 'function') showToast('❌ Lỗi khi xóa', 2500);
        });
}

function _adminEsc(s) {
    return String(s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
