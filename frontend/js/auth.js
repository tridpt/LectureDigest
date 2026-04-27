/* ════════════════════════════════════════════════
   LectureDigest — Auth Module
   Login, Register, Profile management
   ════════════════════════════════════════════════ */

var _authUser = null;
var _authToken = localStorage.getItem('ld_auth_token') || null;

// ── Initialize auth on page load ──
(function _initAuth() {
    if (_authToken) {
        _authFetchMe();
    } else {
        _authUpdateUI();
    }
})();

// ── Fetch current user ──
async function _authFetchMe() {
    if (!_authToken) { _authUpdateUI(); return; }
    try {
        var res = await fetch(API_BASE + '/api/auth/me', {
            headers: { 'Authorization': 'Bearer ' + _authToken }
        });
        if (!res.ok) throw new Error('Token expired');
        var data = await res.json();
        _authUser = data.user;
    } catch (e) {
        _authToken = null;
        _authUser = null;
        localStorage.removeItem('ld_auth_token');
    }
    _authUpdateUI();
}

// ── Update header UI ──
function _authUpdateUI() {
    var loginBtn = document.getElementById('authLoginBtn');
    var userAvatar = document.getElementById('authUserAvatar');
    var userMenu = document.getElementById('authUserMenu');

    if (_authUser) {
        // Logged in
        if (loginBtn) loginBtn.classList.add('hidden');
        if (userAvatar) {
            userAvatar.classList.remove('hidden');
            var initials = _authGetInitials(_authUser.display_name);
            userAvatar.innerHTML = '<span class="auth-avatar-circle" style="background:' + _authUser.avatar_color + '">' + initials + '</span>';
        }
    } else {
        // Not logged in
        if (loginBtn) loginBtn.classList.remove('hidden');
        if (userAvatar) userAvatar.classList.add('hidden');
        if (userMenu) userMenu.classList.add('hidden');
    }
}

function _authGetInitials(name) {
    if (!name) return '?';
    var parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
}

// ── Open auth modal ──
function openAuthModal(mode) {
    var overlay = document.getElementById('authModalOverlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    _authSetMode(mode || 'login');
    // Focus first input
    setTimeout(function() {
        var inp = overlay.querySelector('.auth-input:not(.hidden) input');
        if (inp) inp.focus();
    }, 100);
}

function closeAuthModal() {
    var overlay = document.getElementById('authModalOverlay');
    if (overlay) overlay.classList.add('hidden');
    // Clear form
    var form = document.getElementById('authForm');
    if (form) form.reset();
    var errEl = document.getElementById('authError');
    if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
}

function _authSetMode(mode) {
    var isRegister = mode === 'register';
    var title = document.getElementById('authModalTitle');
    var nameRow = document.getElementById('authNameRow');
    var submitBtn = document.getElementById('authSubmitBtn');
    var switchText = document.getElementById('authSwitchText');

    if (title) title.textContent = isRegister ? 'Đăng ký tài khoản' : 'Đăng nhập';
    if (nameRow) nameRow.classList.toggle('hidden', !isRegister);
    if (submitBtn) submitBtn.textContent = isRegister ? 'Đăng ký' : 'Đăng nhập';
    if (switchText) {
        switchText.innerHTML = isRegister
            ? 'Đã có tài khoản? <a href="#" onclick="event.preventDefault();_authSetMode(\'login\')">Đăng nhập</a>'
            : 'Chưa có tài khoản? <a href="#" onclick="event.preventDefault();_authSetMode(\'register\')">Đăng ký ngay</a>';
    }

    document.getElementById('authForm')?.setAttribute('data-mode', mode);
    var errEl = document.getElementById('authError');
    if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
}

// ── Submit auth form ──
async function submitAuthForm(event) {
    event.preventDefault();
    var form = document.getElementById('authForm');
    var mode = form?.getAttribute('data-mode') || 'login';
    var email = document.getElementById('authEmail')?.value.trim();
    var password = document.getElementById('authPassword')?.value;
    var displayName = document.getElementById('authDisplayName')?.value.trim();
    var errEl = document.getElementById('authError');
    var submitBtn = document.getElementById('authSubmitBtn');

    if (!email || !password) {
        _authShowError('Vui lòng nhập email và mật khẩu');
        return;
    }

    if (mode === 'register' && !displayName) {
        _authShowError('Vui lòng nhập tên hiển thị');
        return;
    }

    if (mode === 'register' && password.length < 6) {
        _authShowError('Mật khẩu tối thiểu 6 ký tự');
        return;
    }

    var origText = submitBtn?.textContent;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Đang xử lý...'; }

    try {
        var endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
        var body = { email: email, password: password };
        if (mode === 'register') body.display_name = displayName;

        var res = await fetch(API_BASE + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        var data = await res.json();
        if (!res.ok) {
            throw new Error(data.detail || 'Lỗi xử lý');
        }

        // Success
        _authToken = data.token;
        _authUser = data.user;
        localStorage.setItem('ld_auth_token', data.token);
        _authUpdateUI();
        closeAuthModal();

        // Trigger cloud sync — pull user's data from server
        if (typeof doDbSync === 'function') {
            setTimeout(doDbSync, 300);
        }

        showToast('👋 Xin chào, ' + _authUser.display_name + '!', 3000);

    } catch (err) {
        _authShowError(err.message);
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origText; }
    }
}

function _authShowError(msg) {
    var errEl = document.getElementById('authError');
    if (errEl) {
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
    }
}

// ── Logout ──
function authLogout() {
    _authToken = null;
    _authUser = null;
    localStorage.removeItem('ld_auth_token');

    // Clear user-specific data from localStorage
    localStorage.removeItem('lectureDigest_history');
    localStorage.removeItem('lectureDigest_gamification');
    // Clear notes and bookmarks
    var keysToRemove = [];
    for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && (key.indexOf('lectureDigest_note_') === 0 ||
                    key.indexOf('lectureDigest_bookmarks_') === 0)) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(function(k) { localStorage.removeItem(k); });

    _authUpdateUI();
    _authCloseUserMenu();

    // Re-render history panel (now empty)
    if (typeof renderHistoryPanel === 'function') renderHistoryPanel();

    // Navigate back to home page
    if (typeof showSection === 'function') showSection('hero');
    history.pushState(null, '', '/');

    // Re-sync to load anonymous data (if any)
    if (typeof doDbSync === 'function') {
        setTimeout(doDbSync, 300);
    }

    showToast('👋 Đã đăng xuất', 2000);
}

// ── User menu toggle ──
function toggleAuthUserMenu() {
    var menu = document.getElementById('authUserMenu');
    if (!menu) return;
    menu.classList.toggle('hidden');

    // Fill user info
    if (!menu.classList.contains('hidden') && _authUser) {
        var nameEl = document.getElementById('authMenuName');
        var emailEl = document.getElementById('authMenuEmail');
        if (nameEl) nameEl.textContent = _authUser.display_name;
        if (emailEl) emailEl.textContent = _authUser.email;
    }
}

function _authCloseUserMenu() {
    var menu = document.getElementById('authUserMenu');
    if (menu) menu.classList.add('hidden');
}

// Close menu on outside click
document.addEventListener('click', function(e) {
    var avatar = document.getElementById('authUserAvatar');
    var menu = document.getElementById('authUserMenu');
    if (!menu || menu.classList.contains('hidden')) return;
    if (avatar && (avatar.contains(e.target) || menu.contains(e.target))) return;
    menu.classList.add('hidden');
});

// ── Profile Modal ──
function openProfileModal() {
    _authCloseUserMenu();
    var overlay = document.getElementById('profileModalOverlay');
    if (!overlay || !_authUser) return;
    overlay.classList.remove('hidden');

    document.getElementById('profileName').value = _authUser.display_name || '';
    document.getElementById('profileEmail').value = _authUser.email || '';
    document.getElementById('profileCurrentPw').value = '';
    document.getElementById('profileNewPw').value = '';

    // Set active color
    document.querySelectorAll('.profile-color-option').forEach(function(el) {
        el.classList.toggle('active', el.dataset.color === _authUser.avatar_color);
    });

    var errEl = document.getElementById('profileError');
    if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
    var successEl = document.getElementById('profileSuccess');
    if (successEl) successEl.classList.add('hidden');
}

function closeProfileModal() {
    var overlay = document.getElementById('profileModalOverlay');
    if (overlay) overlay.classList.add('hidden');
}

function selectProfileColor(el) {
    document.querySelectorAll('.profile-color-option').forEach(function(o) { o.classList.remove('active'); });
    el.classList.add('active');
}

async function saveProfile(event) {
    event.preventDefault();
    var displayName = document.getElementById('profileName')?.value.trim();
    var currentPw = document.getElementById('profileCurrentPw')?.value;
    var newPw = document.getElementById('profileNewPw')?.value;
    var activeColor = document.querySelector('.profile-color-option.active');
    var avatarColor = activeColor ? activeColor.dataset.color : _authUser.avatar_color;
    var errEl = document.getElementById('profileError');
    var successEl = document.getElementById('profileSuccess');
    var saveBtn = document.getElementById('profileSaveBtn');

    if (!displayName) {
        if (errEl) { errEl.textContent = 'Tên hiển thị không được để trống'; errEl.classList.remove('hidden'); }
        return;
    }

    var body = { display_name: displayName, avatar_color: avatarColor };
    if (newPw) {
        if (!currentPw) {
            if (errEl) { errEl.textContent = 'Nhập mật khẩu hiện tại để đổi mật khẩu'; errEl.classList.remove('hidden'); }
            return;
        }
        body.current_password = currentPw;
        body.new_password = newPw;
    }

    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Đang lưu...'; }
    if (errEl) errEl.classList.add('hidden');
    if (successEl) successEl.classList.add('hidden');

    try {
        var res = await fetch(API_BASE + '/api/auth/profile', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + _authToken
            },
            body: JSON.stringify(body)
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Lỗi cập nhật');

        _authUser = data.user;
        _authUpdateUI();
        if (successEl) { successEl.textContent = '✅ Đã cập nhật thành công!'; successEl.classList.remove('hidden'); }
        showToast('✅ Hồ sơ đã được cập nhật!', 2000);

    } catch (err) {
        if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Lưu thay đổi'; }
    }
}
