/* ════════════════════════════════════════════════
   LectureDigest — Core Module
   State, constants, utilities, section management
   ════════════════════════════════════════════════ */

const API_BASE = '';  // Same origin as frontend (served by FastAPI at localhost:8000)


// ──────────────────────────────────────
// STATE
// ──────────────────────────────────────
let ytPlayer         = null;
let ytApiReady       = false;
let pendingVideoId   = null;
let analysisData     = null;
let selectedLang     = 'Vietnamese'; // default output language

const quizState = {
    questions:    [],
    currentIndex: 0,
    score:        0,
    skipped:      0,
    answered:     false,
};

const chatState = {
    history:  [],   // [{role:'user'|'assistant', content:'...'}]
    isOpen:   false,
    isLoading: false,
};

// ──────────────────────────────────────
// SECTION MANAGEMENT
// ──────────────────────────────────────
const SECTION_IDS = ['hero', 'loadingSection', 'errorSection', 'resultsSection', 'playlistSection'];

// SPA Routes mapping (section → URL path). Modules add their routes here.
const SPA_ROUTES = {
    hero:           '/',
    loadingSection: null,
    errorSection:   null,
    resultsSection: null,
    badgesSection:  '/badges',
};

function showSection(id) {
    SECTION_IDS.forEach(sid => {
        const el = document.getElementById(sid);
        if (el) el.classList.add('hidden');
    });
    const target = document.getElementById(id);
    if (target) target.classList.remove('hidden');
    updateChatFabVisibility();
    // Update browser URL to match the displayed section
    if (typeof pushSpaRoute === 'function') pushSpaRoute(id);
}

var _toastLastMsg = '';
var _toastLastTime = 0;
var _TOAST_MAX = 5;

function _getToastContainer() {
    var c = document.getElementById('toastContainer');
    if (!c) {
        c = document.createElement('div');
        c.id = 'toastContainer';
        c.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
            'z-index:9999;display:flex;flex-direction:column-reverse;align-items:center;gap:8px;' +
            'pointer-events:none;';
        document.body.appendChild(c);
    }
    return c;
}

function showToast(message, duration) {
    if (!duration) duration = 3000;

    // Deduplicate rapid identical toasts (within 500ms)
    var now = Date.now();
    if (message === _toastLastMsg && now - _toastLastTime < 500) return;
    _toastLastMsg = message;
    _toastLastTime = now;

    var container = _getToastContainer();

    // Cap max visible toasts
    var existing = container.children;
    if (existing.length >= _TOAST_MAX) {
        existing[existing.length - 1].remove();
    }

    var toast = document.createElement('div');
    toast.className = 'toast-item';
    toast.style.cssText = 'background:#1e1e3a;border:1px solid rgba(139,92,246,0.4);' +
        'color:#f1f5f9;padding:12px 20px;border-radius:12px;font-size:14px;font-weight:500;' +
        'box-shadow:0 8px 32px rgba(0,0,0,0.5);pointer-events:auto;cursor:pointer;' +
        'max-width:400px;text-align:center;word-break:break-word;' +
        'animation:toastIn 0.3s ease forwards;';
    toast.textContent = message;
    toast.onclick = function() { _dismissToast(toast); };

    container.insertBefore(toast, container.firstChild);

    setTimeout(function() { _dismissToast(toast); }, duration);
}

function _dismissToast(el) {
    if (!el || !el.parentNode) return;
    el.style.animation = 'toastOut 0.25s ease forwards';
    setTimeout(function() { if (el.parentNode) el.remove(); }, 250);
}

function goHome() {
    // Always go back to hero from any section
    resetToHero();
    // Close any open modals/overlays
    var footer = document.querySelector('.footer');
    if (footer) footer.style.display = '';
    // Stop chat polling if active
    if (typeof _crStopPolling === 'function') _crStopPolling();
    if (typeof _srStopPolling === 'function') _srStopPolling();
}

function resetToHero() {
    showSection('hero');
    document.getElementById('urlInput').value = '';
    document.getElementById('analyzeBtn').disabled = false;

    analysisData = null;
    Object.assign(quizState, { questions: [], currentIndex: 0, score: 0, skipped: 0, answered: false });

    if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
        try { ytPlayer.pauseVideo(); } catch (_) {}
    }

    // Scroll back to top smoothly
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Focus the URL input
    setTimeout(() => document.getElementById('urlInput')?.focus(), 300);
}

// ──────────────────────────────────────
// LANGUAGE SELECTOR
// ──────────────────────────────────────
function setLang(btn) {
    selectedLang = btn.dataset.lang;
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

// ──────────────────────────────────────
// UTILITIES
// ──────────────────────────────────────
function esc(str) {
    if (!str && str !== 0) return '';
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(String(str)));
    return d.innerHTML;
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Fetch with timeout ────────────────────────────────
/**
 * Drop-in replacement for fetch() that adds an AbortController timeout.
 * Prevents requests from hanging forever if the server doesn't respond.
 *
 * @param {string} url
 * @param {Object} [opts] - Standard fetch options
 * @param {number} [timeoutMs=30000] - Timeout in milliseconds (default 30s)
 * @returns {Promise<Response>}
 */
function fetchWithTimeout(url, opts, timeoutMs) {
    if (typeof opts === 'number') { timeoutMs = opts; opts = undefined; }
    timeoutMs = timeoutMs || 30000;
    opts = opts || {};

    var controller = new AbortController();
    // If caller already set a signal, chain them
    var originalSignal = opts.signal;
    opts.signal = controller.signal;

    var timer = setTimeout(function() {
        controller.abort();
    }, timeoutMs);

    return fetch(url, opts)
        .then(function(response) {
            clearTimeout(timer);
            return response;
        })
        .catch(function(err) {
            clearTimeout(timer);
            if (err.name === 'AbortError') {
                // Check if it was our timeout or the caller's abort
                if (originalSignal && originalSignal.aborted) throw err;
                throw new Error('Request timed out after ' + (timeoutMs / 1000) + 's: ' + url);
            }
            throw err;
        });
}

// ── Safe localStorage wrappers ────────────────────────
/**
 * Safely write to localStorage with QuotaExceededError handling.
 * On quota overflow: attempts to free space by pruning old history entries,
 * then retries once. Shows a toast if storage is truly full.
 * @param {string} key
 * @param {string} value
 * @returns {boolean} true if write succeeded
 */
function safeLsSet(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (e) {
        if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
            console.warn('[Storage] Quota exceeded, attempting cleanup for key:', key);
            // Try to free space: remove oldest history entries
            _lsFreeSpace();
            try {
                localStorage.setItem(key, value);
                return true;
            } catch (e2) {
                console.error('[Storage] Still full after cleanup:', e2);
                if (typeof showToast === 'function') {
                    showToast('⚠️ Bộ nhớ trình duyệt đầy! Hãy xóa bớt lịch sử.', 5000);
                }
                return false;
            }
        }
        console.error('[Storage] setItem error:', e);
        return false;
    }
}

/**
 * Safely read from localStorage with error handling.
 * @param {string} key
 * @param {*} fallback - value to return on error (default: null)
 * @returns {string|null}
 */
function safeLsGet(key, fallback) {
    try {
        return localStorage.getItem(key);
    } catch (e) {
        console.error('[Storage] getItem error:', e);
        return arguments.length > 1 ? fallback : null;
    }
}

/**
 * Free localStorage space by trimming the oldest history entries.
 * Removes up to 20 oldest entries from the history array.
 */
function _lsFreeSpace() {
    try {
        var raw = localStorage.getItem('lectureDigest_history');
        if (!raw) return;
        var history = JSON.parse(raw);
        if (!Array.isArray(history) || history.length <= 10) return;
        // Keep only newest 80% (remove oldest 20%)
        var keep = Math.max(10, Math.floor(history.length * 0.8));
        history = history.slice(0, keep);
        localStorage.setItem('lectureDigest_history', JSON.stringify(history));
        console.info('[Storage] Freed space: trimmed history to', keep, 'entries');
    } catch (e) {
        console.error('[Storage] _lsFreeSpace error:', e);
    }
}

function fmtSecs(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
    return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

// slugify, csvQuote, downloadFile → defined in flashcard.js

// downloadFile → defined in flashcard.js

// ── Confirm Modal ──────────────────────────────────────
var _confirmCallback = null;

function showConfirmModal(message, onConfirm) {
    _confirmCallback = onConfirm;
    var msgEl = document.getElementById('confirmMsg');
    if (msgEl) msgEl.textContent = message;
    var overlay = document.getElementById('confirmOverlay');
    if (overlay) overlay.classList.remove('hidden');
}

function closeConfirmModal() {
    var overlay = document.getElementById('confirmOverlay');
    if (overlay) overlay.classList.add('hidden');
    _confirmCallback = null;
}

function doConfirmAction() {
    if (typeof _confirmCallback === 'function') _confirmCallback();
    closeConfirmModal();
}

// ──────────────────────────────────────
// EVENT LISTENERS
// ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('urlInput');

    // Enter key → analyze
    urlInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') analyzeVideo();
    });

    // Paste: just focus the input, user clicks Analyze manually
});

// copyResultLink → defined in tags.js

// ── Back to top button ────────────────────────────────
(function initBtt() {
    var btn = document.getElementById('bttBtn');
    if (!btn) return;
    var _bttTimer = null;
    window.addEventListener('scroll', function() {
        clearTimeout(_bttTimer);
        _bttTimer = setTimeout(function() {
            if (window.scrollY > 400) {
                btn.classList.add('btt-visible');
            } else {
                btn.classList.remove('btt-visible');
            }
        }, 150);
    }, { passive: true });
})();
