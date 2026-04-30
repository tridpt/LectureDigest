/* ════════════════════════════════════════════════
   LectureDigest — PWA Install Prompt
   ════════════════════════════════════════════════ */

var _pwaInstallEvent = null;
var _pwaInstallDismissed = false;

// ── Capture the beforeinstallprompt event ──
window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    _pwaInstallEvent = e;
    console.log('[PWA] Install prompt captured and saved');

    // Don't show if already dismissed recently
    try {
        var dismissed = localStorage.getItem('pwa_install_dismissed');
        if (dismissed) {
            var dismissedAt = parseInt(dismissed);
            if (Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) {
                _pwaInstallDismissed = true;
                return;
            }
        }
    } catch(err) {}

    // Delay showing the banner
    setTimeout(function() {
        if (!_pwaInstallDismissed) showPwaInstallBanner();
    }, 5000);
});

// ── Detect if already installed ──
window.addEventListener('appinstalled', function() {
    console.log('[PWA] App installed!');
    _pwaInstallEvent = null;
    hidePwaInstallBanner();
    showToast('✅ LectureDigest đã được cài đặt!');
});

// ── Show install banner ──
function showPwaInstallBanner() {
    var banner = document.getElementById('pwaInstallBanner');
    if (!banner) return;
    // Show even if _pwaInstallEvent is null (for manual install instructions)
    banner.classList.remove('hidden');
    requestAnimationFrame(function() {
        banner.classList.add('show');
    });
}

// ── Hide install banner ──
function hidePwaInstallBanner() {
    var banner = document.getElementById('pwaInstallBanner');
    if (!banner) return;
    banner.classList.remove('show');
    setTimeout(function() {
        banner.classList.add('hidden');
    }, 300);
}

// ── Dismiss (don't show for 7 days) ──
function dismissPwaInstall() {
    _pwaInstallDismissed = true;
    try {
        safeLsSet('pwa_install_dismissed', Date.now().toString());
    } catch(err) {}
    hidePwaInstallBanner();
}

// ── Trigger native install prompt ──
function installPwa() {
    var btn = document.getElementById('pwaInstallBtn');

    // If we have the deferred prompt, use it
    if (_pwaInstallEvent && typeof _pwaInstallEvent.prompt === 'function') {
        if (btn) { btn.disabled = true; btn.textContent = 'Đang cài...'; }

        try {
            _pwaInstallEvent.prompt();
        } catch(e) {
            console.warn('[PWA] prompt() failed:', e);
            _showManualInstallGuide();
            _resetInstallBtn(btn);
            return;
        }

        _pwaInstallEvent.userChoice.then(function(choice) {
            console.log('[PWA] User choice:', choice.outcome);
            if (choice.outcome === 'accepted') {
                hidePwaInstallBanner();
                showToast('✅ Đang cài đặt LectureDigest!');
            } else {
                dismissPwaInstall();
            }
            _pwaInstallEvent = null;
            _resetInstallBtn(btn);
        }).catch(function(err) {
            console.warn('[PWA] userChoice failed:', err);
            _resetInstallBtn(btn);
        });

    } else {
        // No deferred event — show manual install guide
        console.log('[PWA] No install event available, showing guide');
        _showManualInstallGuide();
    }
}

function _resetInstallBtn(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke-linecap="round" stroke-linejoin="round"/></svg> Cài đặt';
}

function _showManualInstallGuide() {
    // Detect browser and show appropriate instructions
    var ua = navigator.userAgent.toLowerCase();
    var msg = '';

    if (ua.indexOf('chrome') > -1 && ua.indexOf('edg') === -1) {
        msg = '💡 Bấm ⋮ (menu Chrome) → "Cài đặt ứng dụng" hoặc "Install app"';
    } else if (ua.indexOf('edg') > -1) {
        msg = '💡 Bấm ⋯ (menu Edge) → "Ứng dụng" → "Cài đặt trang này dưới dạng ứng dụng"';
    } else if (ua.indexOf('firefox') > -1) {
        msg = '💡 Firefox chưa hỗ trợ cài PWA trực tiếp. Hãy dùng Chrome hoặc Edge.';
    } else if (ua.indexOf('safari') > -1) {
        msg = '💡 Trên Safari: bấm nút Chia sẻ ↗ → "Thêm vào Màn hình chính"';
    } else {
        msg = '💡 Mở menu trình duyệt → tìm "Cài đặt ứng dụng" hoặc "Add to Home Screen"';
    }

    showToast(msg, 6000);
}
