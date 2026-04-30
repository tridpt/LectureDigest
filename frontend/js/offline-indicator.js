/* ════════════════════════════════════════════════
   LectureDigest — Offline / Online Indicator
   Shows a banner when the user loses internet,
   and a brief success banner when they reconnect.
   ════════════════════════════════════════════════ */

(function initOfflineIndicator() {
    // Create bar element once
    var bar = document.createElement('div');
    bar.className = 'offline-bar';
    bar.id = 'offlineBar';
    bar.setAttribute('role', 'alert');
    bar.setAttribute('aria-live', 'assertive');
    document.body.appendChild(bar);

    var _hideTimer = null;
    var _wasOffline = false;

    function showOffline() {
        _wasOffline = true;
        clearTimeout(_hideTimer);
        bar.className = 'offline-bar offline visible';
        bar.innerHTML =
            '<span class="offline-dot"></span>' +
            '<span class="offline-icon">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                    '<line x1="1" y1="1" x2="23" y2="23"/>' +
                    '<path d="M16.72 11.06A10.94 10.94 0 0119 12.55"/>' +
                    '<path d="M5 12.55a10.94 10.94 0 015.17-2.39"/>' +
                    '<path d="M10.71 5.05A16 16 0 0122.56 9"/>' +
                    '<path d="M1.42 9a15.91 15.91 0 014.7-2.88"/>' +
                    '<path d="M8.53 16.11a6 6 0 016.95 0"/>' +
                    '<line x1="12" y1="20" x2="12.01" y2="20"/>' +
                '</svg>' +
            '</span>' +
            '<span>Mất kết nối mạng</span>' +
            '<button class="offline-retry" onclick="location.reload()">Thử lại</button>';
    }

    function showOnline() {
        clearTimeout(_hideTimer);

        // Only show "back online" if we were previously offline
        if (!_wasOffline) return;
        _wasOffline = false;

        bar.className = 'offline-bar online visible';
        bar.innerHTML =
            '<span class="offline-dot"></span>' +
            '<span class="offline-icon">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                    '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>' +
                    '<polyline points="22 4 12 14.01 9 11.01"/>' +
                '</svg>' +
            '</span>' +
            '<span>Đã kết nối lại!</span>';

        // Auto-hide after 3 seconds
        _hideTimer = setTimeout(function() {
            bar.classList.remove('visible');
        }, 3000);

        // Trigger sync if logged in
        if (typeof doDbSync === 'function') {
            setTimeout(function() { doDbSync(); }, 500);
        }
    }

    // Listen for online/offline events
    window.addEventListener('offline', showOffline);
    window.addEventListener('online', showOnline);

    // Check initial state
    if (!navigator.onLine) {
        // Delay slightly to let DOM render
        setTimeout(showOffline, 500);
    }
})();
