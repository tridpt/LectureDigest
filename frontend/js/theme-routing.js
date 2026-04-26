/* ════════════════════════════════════════════════
   LectureDigest — Theme Toggle & SPA Routing & Keyboard Shortcuts
   ════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════════
// THEME TOGGLE — DARK / LIGHT MODE
// ══════════════════════════════════════════════════════════

const THEME_KEY = 'lectureDigest_theme';

function applyTheme(theme) {
    const html = document.documentElement;
    const icon = document.getElementById('themeIcon');
    if (theme === 'light') {
        html.classList.add('light-mode');
        if (icon) icon.textContent = '☀️';
    } else {
        html.classList.remove('light-mode');
        if (icon) icon.textContent = '🌙';
    }
}

function toggleTheme() {
    const current = localStorage.getItem(THEME_KEY) || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
}

// Apply saved theme on load (before paint)
(function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) || 'dark';
    applyTheme(saved);
})();

// ══════════════════════════════════════════════════════════
// SPA ROUTING — URL changes per page
// ══════════════════════════════════════════════════════════

const SPA_ROUTES = {
    hero:           '/',
    loadingSection: null,   // no URL change while loading
    errorSection:   null,   // no URL change on error
    resultsSection: null,   // set dynamically with video id
    badgesSection:  '/badges',
};

// Called from showSection() to update URL
function pushSpaRoute(sectionId) {
    const route = SPA_ROUTES[sectionId];
    // Skip transient states (loading, error) but NOT resultsSection
    if (route === null && sectionId !== 'resultsSection') return;

    let url = route;
    // Results page: include video ID in URL
    if (sectionId === 'resultsSection') {
        const vid = window._spaVideoId || (window.analysisData && window.analysisData.video_id);
        url = vid ? '/results/' + vid : '/results';
    }

    // Only push if URL actually changed
    if (location.pathname !== url) {
        history.pushState({ section: sectionId }, document.title, url);
    }
    updatePageTitle(sectionId);
}

function updatePageTitle(sectionId) {
    const titles = {
        hero:           'LectureDigest — AI-Powered YouTube Learning',
        resultsSection: 'Kết quả phân tích — LectureDigest',
        badgesSection:  'Huy hiệu — LectureDigest',
        loadingSection: 'Đang phân tích... — LectureDigest',
        errorSection:   'Lỗi — LectureDigest',
    };
    document.title = titles[sectionId] || titles.hero;
}

// Handle browser back / forward
window.addEventListener('popstate', function(e) {
    const path = location.pathname;
    if (path === '/' || path === '') {
        showSection('hero');
    } else if (path === '/badges') {
        openBadgesPage();
    } else if (path.indexOf('/results/') === 0) {
        var videoId = path.replace('/results/', '');
        var hist = [];
        try { hist = JSON.parse(localStorage.getItem('lectureDigest_history') || '[]'); } catch(e) {}
        var entry = null;
        for (var i = 0; i < hist.length; i++) {
            if (hist[i].video_id === videoId) { entry = hist[i]; break; }
        }
        if (entry && entry.data) {
            var urlInput = document.getElementById('urlInput');
            if (urlInput) urlInput.value = entry.url || ('https://youtube.com/watch?v=' + videoId);
            analysisData = entry.data;
            clearChat();
            renderResults(entry.data);
            initNotes(entry.video_id);
            renderTranscript(entry.data.transcript || entry.transcript || []);
            initProgress(entry.video_id);
            initBookmarks(entry.video_id);
            window._spaVideoId = entry.video_id;
            showSection('resultsSection');
        } else {
            showSection('hero');
        }
    } else {
        showSection('hero');
    }
});

// Patch showSection to also push SPA route
(function patchShowSectionForRouting() {
    const _orig = window.showSection;
    window.showSection = function(id) {
        _orig(id);
        pushSpaRoute(id);
    };
})();

// On initial page load: parse current URL
(function initSpaRouteOnLoad() {
    var path = location.pathname;
    if (path === '/badges') {
        window.addEventListener('DOMContentLoaded', function() {
            openBadgesPage();
        }, { once: true });
    } else if (path.indexOf('/results/') === 0) {
        // Direct URL access: /results/VIDEO_ID — try to load from localStorage history
        var videoId = path.replace('/results/', '');
        window.addEventListener('DOMContentLoaded', function() {
            var hist = [];
            try { hist = JSON.parse(localStorage.getItem('lectureDigest_history') || '[]'); } catch(e) {}
            var entry = null;
            // Find most recent entry for this video_id
            for (var i = 0; i < hist.length; i++) {
                if (hist[i].video_id === videoId) { entry = hist[i]; break; }
            }
            if (entry && entry.data) {
                // Load from history
                var urlInput = document.getElementById('urlInput');
                if (urlInput) urlInput.value = entry.url || ('https://youtube.com/watch?v=' + videoId);
                analysisData = entry.data;
                clearChat();
                renderResults(entry.data);
                initNotes(entry.video_id);
                renderTranscript(entry.data.transcript || entry.transcript || []);
                initProgress(entry.video_id);
                initBookmarks(entry.video_id);
                window._spaVideoId = entry.video_id;
                showSection('resultsSection');
            } else {
                // Not in history — pre-fill URL and let user click analyze
                var urlInput2 = document.getElementById('urlInput');
                if (urlInput2) urlInput2.value = 'https://youtube.com/watch?v=' + videoId;
                showSection('hero');
                showToast('Video chua co trong lich su. Bam Analyze de phan tich.');
            }
        }, { once: true });
    }
})();

// ════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// Ctrl+Enter = analyze, Escape = close panels,
// 1-4 = quiz answers, Space/Enter = flip flashcard
// ════════════════════════════════════════════════════════
document.addEventListener('keydown', function(e) {
    var tag = document.activeElement ? document.activeElement.tagName : '';
    var isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(tag) >= 0;

    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        var heroEl = document.getElementById('hero');
        if (heroEl && !heroEl.classList.contains('hidden')) { e.preventDefault(); analyzeVideo(); }
        return;
    }

    if (e.key === 'Escape') {
        var fcModal = document.getElementById('fcModalOverlay');
        if (fcModal && !fcModal.classList.contains('hidden')) { if(typeof closeFcModal==='function') closeFcModal(e); return; }
        var shareModal = document.getElementById('shareModalOverlay');
        if (shareModal && !shareModal.classList.contains('hidden')) { if(typeof closeShareModal==='function') closeShareModal(e); return; }
        var mmModal = document.getElementById('mmModalOverlay');
        if (mmModal && !mmModal.classList.contains('hidden')) { if(typeof closeMindMap==='function') closeMindMap(); return; }
        var histPanel = document.getElementById('historyPanel');
        if (histPanel && histPanel.classList.contains('open')) {
            toggleHistoryPanel(false);
            var inp = document.getElementById('histSearchInput');
            if (inp) { inp.value = ''; renderHistoryPanel(''); }
            return;
        }
        if (typeof chatState !== 'undefined' && chatState && chatState.isOpen && typeof toggleChat === 'function') { toggleChat(); return; }
        var vlen = document.getElementById('vlenOverlay');
        if (vlen && !vlen.classList.contains('hidden')) { closeVlenModal(); return; }
        return;
    }

    if (isTyping) return;

    var fcOpen = document.getElementById('fcModalOverlay') && !document.getElementById('fcModalOverlay').classList.contains('hidden');
    if (fcOpen) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if(typeof flipCard==='function') flipCard(); return; }
        if (e.key === 'ArrowLeft')  { e.preventDefault(); if(typeof fcNavigate==='function') fcNavigate(-1); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); if(typeof fcNavigate==='function') fcNavigate(1);  return; }
        if (e.key === '1') { if(typeof rateCard==='function') rateCard('hard'); return; }
        if (e.key === '2') { if(typeof rateCard==='function') rateCard('ok');   return; }
        if (e.key === '3') { if(typeof rateCard==='function') rateCard('easy'); return; }
        return;
    }

    var quizContainer = document.getElementById('quizContainer');
    if (quizContainer && !quizContainer.classList.contains('hidden')) {
        if (e.key === '1') { var o0=document.getElementById('opt-0'); if(o0) o0.click(); return; }
        if (e.key === '2') { var o1=document.getElementById('opt-1'); if(o1) o1.click(); return; }
        if (e.key === '3') { var o2=document.getElementById('opt-2'); if(o2) o2.click(); return; }
        if (e.key === '4') { var o3=document.getElementById('opt-3'); if(o3) o3.click(); return; }
        if (e.key === 'ArrowRight') {
            var nextBtn = document.getElementById('nextBtn');
            if (nextBtn && !nextBtn.classList.contains('hidden')) { e.preventDefault(); if(typeof nextQuestion==='function') nextQuestion(); return; }
        }
    }
}, false);

// Clear history search when panel closes
(function() {
    var _orig = window.toggleHistoryPanel;
    if (typeof _orig !== 'function') return;
    window.toggleHistoryPanel = function(force) {
        _orig(force);
        var panel = document.getElementById('historyPanel');
        if (panel && !panel.classList.contains('open')) {
            var inp = document.getElementById('histSearchInput');
            if (inp) { inp.value = ''; renderHistoryPanel(''); }
        }
    };
})();

(function initOsThemeSync() {
    var saved = localStorage.getItem('lectureDigest_theme');
    if (!saved) {
        applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
        if (!localStorage.getItem('lectureDigest_theme')) applyTheme(e.matches ? 'dark' : 'light');
    });
    var _origTT = window.toggleTheme;
    window.toggleTheme = function() {
        var cur = localStorage.getItem('lectureDigest_theme') ||
            (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        var next = cur === 'dark' ? 'light' : 'dark';
        localStorage.setItem('lectureDigest_theme', next);
        applyTheme(next);
    };
})();

