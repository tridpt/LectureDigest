/* ════════════════════════════════════════════════
   LectureDigest — Auth Module
   Login, Register, Profile management + Google OAuth
   ════════════════════════════════════════════════ */

var _authUser = null;
var _authToken = localStorage.getItem('ld_auth_token') || null;
var _googleClientId = null;

// ── Initialize auth on page load ──
(function _initAuth() {
    if (_authToken) {
        _authFetchMe();
    } else {
        _authUpdateUI();
    }
    // Load Google Sign-In
    _loadGoogleSignIn();
})();

// ── Google Sign-In ──────────────────────────────────────
function _loadGoogleSignIn() {
    // 1. Fetch client ID from backend
    fetch(API_BASE + '/api/auth/google-client-id')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            _googleClientId = data.client_id;
            if (!_googleClientId) return;
            // 2. Load GSI script
            var script = document.createElement('script');
            script.src = 'https://accounts.google.com/gsi/client';
            script.async = true;
            script.defer = true;
            script.onload = function() { _initGoogleButton(); };
            document.head.appendChild(script);
        })
        .catch(function() { /* Google Sign-In not available */ });
}

function _initGoogleButton() {
    if (!window.google || !_googleClientId) return;
    window.google.accounts.id.initialize({
        client_id: _googleClientId,
        callback: _handleGoogleCallback,
        auto_select: false,
        cancel_on_tap_outside: true,
    });
    // Render button into auth modal placeholder
    var target = document.getElementById('googleSignInBtn');
    if (target) {
        window.google.accounts.id.renderButton(target, {
            theme: 'outline',
            size: 'large',
            width: 340,
            text: 'continue_with',
            shape: 'pill',
            logo_alignment: 'center',
        });
    }
}

async function _handleGoogleCallback(response) {
    if (!response || !response.credential) return;
    var errEl = document.getElementById('authError');
    try {
        var res = await fetch(API_BASE + '/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: response.credential })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Google login failed');

        _authToken = data.token;
        _authUser = data.user;
        localStorage.setItem('ld_auth_token', data.token);
        _authUpdateUI();
        closeAuthModal();

        // Clear stale localStorage & sync
        _authClearLocalData();
        if (typeof doDbSync === 'function') setTimeout(doDbSync, 300);

        showToast('👋 Xin chào, ' + _authUser.display_name + '!', 3000);
    } catch (err) {
        if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
    }
}

function _authClearLocalData() {
    localStorage.removeItem('lectureDigest_history');
    localStorage.removeItem('lectureDigest_gamification');
    var keysToRemove = [];
    for (var ci = 0; ci < localStorage.length; ci++) {
        var ck = localStorage.key(ci);
        if (ck && (
            ck.indexOf('lectureDigest_note_') === 0 ||
            ck.indexOf('lectureDigest_bookmarks_') === 0 ||
            ck.indexOf('lectureDigest_examHistory') === 0 ||
            ck.indexOf('lectureDigest_sm2_') === 0 ||
            ck.indexOf('lectureDigest_customfc_') === 0 ||
            ck.indexOf('lectureDigest_tags') === 0 ||
            ck.indexOf('lectureDigest_progress_') === 0 ||
            ck.indexOf('lectureDigest_playlist_') === 0
        )) {
            keysToRemove.push(ck);
        }
    }
    keysToRemove.forEach(function(k) { localStorage.removeItem(k); });
}

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
            if (_authUser.avatar_url) {
                userAvatar.innerHTML = '<img class="auth-avatar-img" src="' + _authUser.avatar_url + '" alt="" referrerpolicy="no-referrer">';
            } else {
                var initials = _authGetInitials(_authUser.display_name);
                userAvatar.innerHTML = '<span class="auth-avatar-circle" style="background:' + _authUser.avatar_color + '">' + initials + '</span>';
            }
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
    // Re-render Google button (GSI needs visible container)
    setTimeout(function() { _initGoogleButton(); }, 50);
    // Focus first input
    setTimeout(function() {
        var inp = overlay.querySelector('.auth-field:not(.hidden) input');
        if (inp) inp.focus();
    }, 150);
}

function closeAuthModal() {
    var overlay = document.getElementById('authModalOverlay');
    if (overlay) overlay.classList.add('hidden');
    // Clear form
    var form = document.getElementById('authForm');
    if (form) form.reset();
    var errEl = document.getElementById('authError');
    if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
    // Reset forgot form state
    var forgotForm = document.getElementById('authForgotForm');
    if (forgotForm) {
        forgotForm.classList.add('hidden');
        // Re-show hidden fields/buttons in case they were hidden after success
        var emailField = forgotForm.querySelector('.auth-field');
        if (emailField) emailField.style.display = '';
        var btn = document.getElementById('authForgotSubmitBtn');
        if (btn) btn.style.display = '';
        var forgotEmail = document.getElementById('authForgotEmail');
        if (forgotEmail) forgotEmail.value = '';
    }
    var forgotErr = document.getElementById('authForgotError');
    if (forgotErr) { forgotErr.textContent = ''; forgotErr.classList.add('hidden'); }
    var forgotSuccess = document.getElementById('authForgotSuccess');
    if (forgotSuccess) { forgotSuccess.textContent = ''; forgotSuccess.classList.add('hidden'); }
    // Ensure auth form is visible for next open
    var authForm = document.getElementById('authForm');
    if (authForm) authForm.classList.remove('hidden');
}

function _authSetMode(mode) {
    var isRegister = mode === 'register';
    var isForgot = mode === 'forgot';
    var title = document.getElementById('authModalTitle');
    var nameRow = document.getElementById('authNameRow');
    var submitBtn = document.getElementById('authSubmitBtn');
    var switchText = document.getElementById('authSwitchText');
    var authForm = document.getElementById('authForm');
    var forgotForm = document.getElementById('authForgotForm');
    var authIcon = document.querySelector('.auth-modal-icon');
    var authSubtitle = document.querySelector('.auth-modal-subtitle');
    var googleWrap = document.getElementById('authGoogleWrap');
    var divider = document.querySelector('.auth-divider');
    var forgotLink = document.getElementById('authForgotLink');
    var passwordRow = document.getElementById('authPasswordRow');

    // Hide all messages
    var errEl = document.getElementById('authError');
    if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
    var successEl = document.getElementById('authSuccess');
    if (successEl) { successEl.textContent = ''; successEl.classList.add('hidden'); }
    var forgotErr = document.getElementById('authForgotError');
    if (forgotErr) { forgotErr.textContent = ''; forgotErr.classList.add('hidden'); }
    var forgotSuccess = document.getElementById('authForgotSuccess');
    if (forgotSuccess) { forgotSuccess.textContent = ''; forgotSuccess.classList.add('hidden'); }

    if (isForgot) {
        // Show forgot password form, hide auth form
        if (authForm) authForm.classList.add('hidden');
        if (forgotForm) forgotForm.classList.remove('hidden');
        if (title) title.textContent = 'Quên mật khẩu';
        if (authIcon) authIcon.textContent = '📧';
        if (authSubtitle) authSubtitle.textContent = 'Nhập email để nhận link đặt lại mật khẩu';
        if (googleWrap) googleWrap.classList.add('hidden');
        if (divider) divider.classList.add('hidden');
        // Focus email input
        setTimeout(function() {
            var inp = document.getElementById('authForgotEmail');
            if (inp) inp.focus();
        }, 100);
    } else {
        // Show auth form, hide forgot form
        if (authForm) authForm.classList.remove('hidden');
        if (forgotForm) forgotForm.classList.add('hidden');
        if (googleWrap) googleWrap.classList.remove('hidden');
        if (divider) divider.classList.remove('hidden');

        if (title) title.textContent = isRegister ? 'Đăng ký tài khoản' : 'Đăng nhập';
        if (authIcon) authIcon.textContent = '🔐';
        if (authSubtitle) authSubtitle.textContent = 'Lưu tiến trình học tập của bạn';
        if (nameRow) nameRow.classList.toggle('hidden', !isRegister);
        if (submitBtn) submitBtn.textContent = isRegister ? 'Đăng ký' : 'Đăng nhập';
        if (forgotLink) forgotLink.classList.toggle('hidden', isRegister);
        if (switchText) {
            switchText.innerHTML = isRegister
                ? 'Đã có tài khoản? <a href="#" onclick="event.preventDefault();_authSetMode(\'login\')">Đăng nhập</a>'
                : 'Chưa có tài khoản? <a href="#" onclick="event.preventDefault();_authSetMode(\'register\')">Đăng ký ngay</a>';
        }

        authForm?.setAttribute('data-mode', mode);
    }
}

// ── Submit Forgot Password ──
async function submitForgotPassword() {
    var email = document.getElementById('authForgotEmail')?.value.trim();
    var errEl = document.getElementById('authForgotError');
    var successEl = document.getElementById('authForgotSuccess');
    var btn = document.getElementById('authForgotSubmitBtn');

    if (errEl) errEl.classList.add('hidden');
    if (successEl) successEl.classList.add('hidden');

    if (!email || email.indexOf('@') === -1) {
        if (errEl) { errEl.textContent = 'Vui lòng nhập email hợp lệ'; errEl.classList.remove('hidden'); }
        return;
    }

    var origText = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Đang gửi...'; }

    try {
        var res = await fetch(API_BASE + '/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Lỗi xử lý');

        // Show success message
        if (successEl) {
            successEl.innerHTML = '✅ ' + data.message + '<br><small style="opacity:0.7;margin-top:4px;display:block;">Kiểm tra hộp thư (và thư mục spam) của bạn</small>';
            successEl.classList.remove('hidden');
        }
        // Hide email input
        var emailField = document.querySelector('#authForgotForm .auth-field');
        if (emailField) emailField.style.display = 'none';
        if (btn) btn.style.display = 'none';

    } catch (err) {
        if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = origText; }
    }
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

        // Clear stale data & sync
        _authClearLocalData();
        if (typeof doDbSync === 'function') setTimeout(doDbSync, 300);

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

    // Clear ALL user-specific data from localStorage
    localStorage.removeItem('lectureDigest_history');
    localStorage.removeItem('lectureDigest_gamification');
    // Clear notes, bookmarks, and all per-user extra data
    var keysToRemove = [];
    for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && (
            key.indexOf('lectureDigest_note_') === 0 ||
            key.indexOf('lectureDigest_bookmarks_') === 0 ||
            key.indexOf('lectureDigest_examHistory') === 0 ||
            key.indexOf('lectureDigest_sm2_') === 0 ||
            key.indexOf('lectureDigest_customfc_') === 0 ||
            key.indexOf('lectureDigest_tags') === 0 ||
            key.indexOf('lectureDigest_progress_') === 0 ||
            key.indexOf('lectureDigest_playlist_') === 0
        )) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(function(k) { localStorage.removeItem(k); });

    _authUpdateUI();
    _authCloseUserMenu();

    // Re-render history panel (now empty)
    if (typeof renderHistoryPanel === 'function') renderHistoryPanel();
    // Re-render streak (now empty)
    if (typeof renderStreakCard === 'function') renderStreakCard();

    // Navigate back to home page
    if (typeof showSection === 'function') showSection('hero');
    history.pushState(null, '', '/');

    // DO NOT re-sync anonymous data — it would restore old data into localStorage
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

// ── Delete Account ──
async function authDeleteAccount() {
    var password = document.getElementById('deleteAccountPw')?.value || '';
    var errEl = document.getElementById('deleteAccountError');
    var btn = document.getElementById('deleteAccountBtn');

    if (errEl) errEl.classList.add('hidden');

    // Double confirmation
    if (!confirm('Bạn có chắc chắn muốn XÓA VĨNH VIỄN tài khoản? Tất cả dữ liệu sẽ bị mất và không thể khôi phục!')) {
        return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Đang xóa...'; }

    try {
        var res = await fetch(API_BASE + '/api/auth/delete-account', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + _authToken
            },
            body: JSON.stringify({ password: password })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Không thể xóa tài khoản');

        // Clear everything client-side
        _authToken = null;
        _authUser = null;
        localStorage.clear();
        closeProfileModal();
        _authUpdateUI();
        showToast('👋 Tài khoản đã được xóa. Tạm biệt!', 4000);
        if (typeof showSection === 'function') showSection('hero');

    } catch (err) {
        if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🗑️ Xóa tài khoản vĩnh viễn'; }
    }
}

// ── Export Data ──
async function authExportData() {
    if (!_authToken) {
        showToast('⚠️ Vui lòng đăng nhập để tải dữ liệu', 2000);
        return;
    }

    showToast('📦 Đang chuẩn bị dữ liệu...', 2000);

    try {
        var res = await fetch(API_BASE + '/api/auth/export-data', {
            headers: { 'Authorization': 'Bearer ' + _authToken }
        });
        if (!res.ok) throw new Error('Không thể tải dữ liệu');
        var data = await res.json();

        // Download as JSON file
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'lecturedigest-data-' + new Date().toISOString().split('T')[0] + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast('✅ Đã tải xuống dữ liệu!', 2000);
    } catch (err) {
        showToast('❌ ' + err.message, 3000);
    }
}
