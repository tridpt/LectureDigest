/* ════════════════════════════════════════════════
   LectureDigest — PWA Install Prompt
   ════════════════════════════════════════════════ */

var _pwaInstallEvent = null;
var _pwaInstallDismissed = false;

// ── Capture the beforeinstallprompt event ──
window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    _pwaInstallEvent = e;
    console.log('[PWA] Install prompt captured');

    // Don't show if already dismissed recently
    try {
        var dismissed = localStorage.getItem('pwa_install_dismissed');
        if (dismissed) {
            var dismissedAt = parseInt(dismissed);
            // Show again after 7 days
            if (Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) {
                _pwaInstallDismissed = true;
                return;
            }
        }
    } catch(e) {}

    // Delay showing the banner slightly so it doesn't overwhelm on first visit
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
    if (!banner || !_pwaInstallEvent) return;
    banner.classList.remove('hidden');
    // Trigger animation
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
        localStorage.setItem('pwa_install_dismissed', Date.now().toString());
    } catch(e) {}
    hidePwaInstallBanner();
}

// ── Trigger native install prompt ──
async function installPwa() {
    if (!_pwaInstallEvent) {
        showToast('Không thể cài đặt lúc này');
        return;
    }

    var btn = document.getElementById('pwaInstallBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang cài...'; }

    try {
        _pwaInstallEvent.prompt();
        var choice = await _pwaInstallEvent.userChoice;

        if (choice.outcome === 'accepted') {
            console.log('[PWA] User accepted install');
            hidePwaInstallBanner();
        } else {
            console.log('[PWA] User dismissed install');
            dismissPwaInstall();
        }
    } catch(e) {
        console.warn('[PWA] Install error:', e);
    } finally {
        _pwaInstallEvent = null;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke-linecap="round" stroke-linejoin="round"/></svg> Cài đặt';
        }
    }
}
