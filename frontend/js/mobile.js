/* ════════════════════════════════════════════════
   LectureDigest — Mobile UX Helpers
   ════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════
// MOBILE UX HELPERS
// ══════════════════════════════════════════════════════

function mobScrollTo(elementId) {
    var el = document.getElementById(elementId);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Brief highlight effect
        el.style.transition = 'box-shadow 0.3s';
        el.style.boxShadow = '0 0 0 2px rgba(139,92,246,0.5)';
        setTimeout(function() { el.style.boxShadow = ''; }, 1500);
    }
}

// Show/hide mobile bottom nav based on current section
(function initMobileNav() {
    function updateMobileNav() {
        var nav = document.getElementById('mobileBottomNav');
        if (!nav || window.innerWidth > 640) { if (nav) nav.style.display = 'none'; return; }
        var results = document.getElementById('resultsSection');
        var isVisible = results && !results.classList.contains('hidden');
        nav.style.display = isVisible ? 'block' : 'none';
    }

    // Use MutationObserver for reliable visibility tracking
    function setupObserver() {
        var results = document.getElementById('resultsSection');
        if (!results) { setTimeout(setupObserver, 500); return; }
        var observer = new MutationObserver(updateMobileNav);
        observer.observe(results, { attributes: true, attributeFilter: ['class'] });
        updateMobileNav();
    }

    var _resizeNavTimer = null;
    window.addEventListener('resize', function() {
        clearTimeout(_resizeNavTimer);
        _resizeNavTimer = setTimeout(updateMobileNav, 150);
    });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupObserver);
    } else {
        setupObserver();
    }
})();

// Fix 100vh on mobile browsers (address bar issue)
(function fixMobileVh() {
    var _resizeVhTimer = null;
    function setVh() {
        document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');
    }
    setVh();
    window.addEventListener('resize', function() {
        clearTimeout(_resizeVhTimer);
        _resizeVhTimer = setTimeout(setVh, 150);
    });
})();

