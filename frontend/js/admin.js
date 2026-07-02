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
    html += _adminStatCard('👤', u.total || 0, 'Tổng người dùng', '#1e40af');
    html += _adminStatCard('🆕', u.new_7d || 0, 'Mới (7 ngày)', '#10b981');
    html += _adminStatCard('📅', u.new_30d || 0, 'Mới (30 ngày)', '#06b6d4');
    html += _adminStatCard('🔑', u.google || 0, 'Google', '#f59e0b');
    html += _adminStatCard('✉️', u.password || 0, 'Email/MK', '#ec4899');
    html += '</div>';

    html += '<div class="admin-section-label">📚 Nội dung</div>';
    html += '<div class="admin-stat-grid">';
    html += _adminStatCard('🎬', c.distinct_videos || 0, 'Video đã phân tích', '#1e40af');
    html += _adminStatCard('📊', c.history_entries || 0, 'Lượt phân tích', '#2554c7');
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
            : '<div class="admin-user-avatar" style="background:' + (u.avatar_color || '#1e40af') + '">'
                + (u.display_name || '?').charAt(0).toUpperCase() + '</div>';
        var date = u.created_at ? new Date(u.created_at).toLocaleDateString('vi-VN') : '';
        var badges = '';
        if (u.is_admin) badges += '<span class="admin-badge admin-badge-admin">ADMIN</span>';
        if (u.is_blocked) {
            var blockTitle = u.block_permanent ? 'Chặn vĩnh viễn' : ('Chặn đến ' + _adminFmtExpiry(u.block_expires_at));
            if (u.block_reason) blockTitle += ' — ' + u.block_reason;
            var blockLabel = u.block_permanent ? 'CHẶN ∞' : 'CHẶN ' + _adminBanShort(u.block_expires_at);
            badges += '<span class="admin-badge admin-badge-blocked" title="' + _adminEsc(blockTitle) + '">' + blockLabel + '</span>';
        }
        // Risk flag (system-detected unusual behavior)
        if (u.risk_level && u.risk_level !== 'none') {
            var riskTitle = (u.risk_flags || []).map(function(f) { return '• ' + f.label; }).join('\n') || 'Hành vi bất thường';
            var riskLabel = { high: '⚠️ RỦI RO CAO', medium: '⚠️ NGHI VẤN', low: '⚑ THEO DÕI' }[u.risk_level] || '⚑';
            badges += '<span class="admin-badge admin-risk-' + u.risk_level + '" title="' + _adminEsc(riskTitle) + '">' + riskLabel + '</span>';
        }
        badges += u.is_google
            ? '<span class="admin-badge admin-badge-google">Google</span>'
            : '<span class="admin-badge admin-badge-email">Email</span>';

        // Action buttons: block/unblock + delete (admins are protected)
        var actions = '';
        if (u.is_admin) {
            actions = '<button class="admin-act-btn" disabled title="Tài khoản admin được bảo vệ">🔒</button>';
        } else {
            if (u.is_blocked) {
                actions += '<button class="admin-act-btn admin-unblock-btn" onclick="adminUnblockUser(\'' + _adminEsc(u.email) + '\')" title="Bỏ chặn email">✅</button>';
            } else {
                actions += '<button class="admin-act-btn admin-block-btn" onclick="adminBlockUser(\'' + _adminEsc(u.email) + '\')" title="Chặn email">🚫</button>';
            }
            actions += '<button class="admin-act-btn admin-del-btn" onclick="adminDeleteUser(' + u.id + ', \'' + _adminEsc(u.email) + '\')" title="Xóa người dùng">🗑️</button>';
        }

        return '<div class="admin-user-row' + (u.is_blocked ? ' admin-user-blocked' : '') + '">'
            + avatar
            + '<div class="admin-user-info">'
            + '<div class="admin-user-name">' + escHtml(u.display_name || 'Chưa đặt tên') + ' ' + badges + '</div>'
            + '<div class="admin-user-email">' + escHtml(u.email || '') + '</div>'
            + (u.is_blocked ? _adminBlockDetail(u) : (u.risk_level && u.risk_level !== 'none' ? _adminRiskDetail(u) : ''))
            + '</div>'
            + '<div class="admin-user-meta">'
            + '<span title="Số video phân tích">🎬 ' + (u.history_count || 0) + '</span>'
            + '<span title="Ngày tạo">📅 ' + date + '</span>'
            + '</div>'
            + '<div class="admin-user-actions">' + actions + '</div>'
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
    showConfirm({
        title: 'Xóa người dùng',
        message: 'Xóa vĩnh viễn "' + email + '" và toàn bộ dữ liệu của họ?\nHành động này KHÔNG THỂ hoàn tác.',
        confirmText: '🗑️ Xóa vĩnh viễn',
        cancelText: 'Huỷ',
        danger: true
    }).then(function(ok) {
        if (!ok) return;
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
    });
}

// ── Block / Unblock email ──
function adminBlockUser(email) {
    _adminShowBlockModal(email);
}

// Modal: choose ban duration + reason
function _adminShowBlockModal(email) {
    var existing = document.getElementById('adminBlockOverlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'adminBlockOverlay';
    overlay.className = 'admin-block-overlay';

    var durations = [
        { key: '1h', label: '1 giờ' },
        { key: '1d', label: '1 ngày' },
        { key: '1w', label: '1 tuần' },
        { key: '1m', label: '1 tháng' },
        { key: 'permanent', label: 'Vĩnh viễn' }
    ];
    var durBtns = durations.map(function(d, i) {
        return '<button type="button" class="admin-dur-btn' + (d.key === 'permanent' ? ' admin-dur-perm' : '') + (i === 0 ? ' active' : '') + '" '
            + 'data-dur="' + d.key + '" onclick="_adminPickDuration(this)">' + d.label + '</button>';
    }).join('');

    // Preset reasons — last one ("Khác") reveals the free-text box
    var presetReasons = ['Spam', 'Vi phạm điều khoản', 'Lạm dụng hệ thống', 'Nội dung không phù hợp', 'Khác'];
    var reasonBtns = presetReasons.map(function(rs) {
        return '<button type="button" class="admin-reason-btn" data-reason="' + _adminEsc(rs) + '" onclick="_adminPickReason(this)">' + escHtml(rs) + '</button>';
    }).join('');

    overlay.innerHTML =
        '<div class="admin-block-modal">' +
            '<div class="admin-block-header">' +
                '<span class="admin-block-icon">🚫</span>' +
                '<div class="admin-block-title">Chặn tài khoản</div>' +
                '<div class="admin-block-email">' + escHtml(email) + '</div>' +
            '</div>' +
            '<div class="admin-block-field">' +
                '<label class="admin-block-label">Thời hạn chặn</label>' +
                '<div class="admin-dur-grid" id="adminDurGrid">' + durBtns + '</div>' +
            '</div>' +
            '<div class="admin-block-field">' +
                '<label class="admin-block-label">Lý do chặn</label>' +
                '<div class="admin-reason-grid" id="adminReasonGrid">' + reasonBtns + '</div>' +
                '<textarea class="admin-block-reason hidden" id="adminBlockReason" rows="3" maxlength="300" ' +
                'placeholder="Nhập lý do cụ thể..."></textarea>' +
            '</div>' +
            '<div class="admin-block-actions">' +
                '<button type="button" class="admin-block-cancel" onclick="_adminCloseBlockModal()">Huỷ</button>' +
                '<button type="button" class="admin-block-confirm" onclick="_adminConfirmBlock(\'' + _adminEsc(email) + '\')">🚫 Chặn</button>' +
            '</div>' +
        '</div>';

    overlay.onclick = function(e) { if (e.target === overlay) _adminCloseBlockModal(); };
    document.body.appendChild(overlay);
    overlay._selectedDuration = '1h';
    overlay._selectedReason = '';
}

function _adminPickReason(btn) {
    var grid = document.getElementById('adminReasonGrid');
    if (grid) grid.querySelectorAll('.admin-reason-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');

    var overlay = document.getElementById('adminBlockOverlay');
    var reason = btn.getAttribute('data-reason');
    var ta = document.getElementById('adminBlockReason');

    if (reason === 'Khác') {
        // Reveal free-text box, reason comes from textarea
        if (ta) { ta.classList.remove('hidden'); ta.value = ''; setTimeout(function() { ta.focus(); }, 50); }
        if (overlay) overlay._selectedReason = '__custom__';
    } else {
        if (ta) ta.classList.add('hidden');
        if (overlay) overlay._selectedReason = reason;
    }
}

function _adminPickDuration(btn) {
    var grid = document.getElementById('adminDurGrid');
    if (grid) {
        grid.querySelectorAll('.admin-dur-btn').forEach(function(b) { b.classList.remove('active'); });
    }
    btn.classList.add('active');
    var overlay = document.getElementById('adminBlockOverlay');
    if (overlay) overlay._selectedDuration = btn.getAttribute('data-dur');
}

function _adminCloseBlockModal() {
    var overlay = document.getElementById('adminBlockOverlay');
    if (overlay) overlay.remove();
}

function _adminConfirmBlock(email) {
    var overlay = document.getElementById('adminBlockOverlay');
    var duration = (overlay && overlay._selectedDuration) || '1h';
    var selected = (overlay && overlay._selectedReason) || '';
    var reason = '';

    if (selected === '__custom__') {
        var reasonEl = document.getElementById('adminBlockReason');
        reason = reasonEl ? reasonEl.value.trim() : '';
        if (!reason) {
            if (typeof showToast === 'function') showToast('Vui lòng nhập lý do', 2000);
            return;
        }
    } else {
        reason = selected;
    }

    fetch((window.API_BASE || '') + '/api/admin/block-email', {
        method: 'POST',
        headers: _adminAuthHeaders(),
        body: JSON.stringify({ email: email, reason: reason, duration: duration })
    })
        .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
        .then(function(res) {
            _adminCloseBlockModal();
            if (res.ok) {
                var label = res.data.permanent ? 'vĩnh viễn' : duration;
                if (typeof showToast === 'function') showToast('🚫 Đã chặn ' + email + ' (' + label + ')', 2800);
                _adminLoadUsers();
            } else {
                if (typeof showToast === 'function') showToast('❌ ' + (res.data.detail || 'Không thể chặn'), 3000);
            }
        })
        .catch(function() {
            _adminCloseBlockModal();
            if (typeof showToast === 'function') showToast('❌ Lỗi khi chặn', 2500);
        });
}

function adminUnblockUser(email) {
    fetch((window.API_BASE || '') + '/api/admin/unblock-email', {
        method: 'POST',
        headers: _adminAuthHeaders(),
        body: JSON.stringify({ email: email })
    })
        .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
        .then(function(res) {
            if (res.ok) {
                if (typeof showToast === 'function') showToast('✅ Đã bỏ chặn ' + email, 2500);
                _adminLoadUsers();
            } else {
                if (typeof showToast === 'function') showToast('❌ ' + (res.data.detail || 'Không thể bỏ chặn'), 3000);
            }
        })
        .catch(function() { if (typeof showToast === 'function') showToast('❌ Lỗi khi bỏ chặn', 2500); });
}

function _adminEsc(s) {
    return String(s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function _adminFmtExpiry(ms) {
    if (!ms) return '';
    try {
        return new Date(ms).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (e) { return ''; }
}

// Block detail box shown under a blocked user's email
function _adminBlockDetail(u) {
    var lines = '';
    lines += '<div class="admin-block-detail-row">🚫 <strong>Lý do:</strong> ' + escHtml(u.block_reason || 'Không ghi rõ') + '</div>';
    if (u.block_created_at) {
        lines += '<div class="admin-block-detail-row">📅 <strong>Chặn lúc:</strong> ' + _adminFmtExpiry(u.block_created_at) + '</div>';
    }
    if (u.block_permanent) {
        lines += '<div class="admin-block-detail-row">⏳ <strong>Hết hạn:</strong> Vĩnh viễn</div>';
    } else if (u.block_expires_at) {
        lines += '<div class="admin-block-detail-row">⏳ <strong>Hết hạn:</strong> ' + _adminFmtExpiry(u.block_expires_at) + ' (còn ' + _adminBanShort(u.block_expires_at) + ')</div>';
    }
    return '<div class="admin-block-detail">' + lines + '</div>';
}

// Risk detail box shown under a flagged (unusual-behavior) user
function _adminRiskDetail(u) {
    var flags = u.risk_flags || [];
    if (!flags.length) return '';
    var items = flags.map(function(f) {
        var dot = f.severity === 'high' ? '🔴' : f.severity === 'medium' ? '🟠' : '🟡';
        return '<div class="admin-risk-detail-row">' + dot + ' ' + escHtml(f.label) + '</div>';
    }).join('');
    return '<div class="admin-risk-detail admin-risk-detail-' + u.risk_level + '">'
        + '<div class="admin-risk-detail-head">⚠️ Hệ thống phát hiện hành vi bất thường</div>'
        + items
        + '</div>';
}

// Short remaining-time label, e.g. "2d", "5h", "30m"
function _adminBanShort(ms) {
    if (!ms) return '';
    var diff = ms - Date.now();
    if (diff <= 0) return 'hết hạn';
    var mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + 'm';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h';
    var days = Math.floor(hours / 24);
    return days + 'd';
}
