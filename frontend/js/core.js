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

function showToast(message, duration = 3000) {
    const existing = document.getElementById('toastNotif');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'toastNotif';
    toast.style.cssText = `
        position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
        background:#1e1e3a; border:1px solid rgba(139,92,246,0.4);
        color:#f1f5f9; padding:12px 20px; border-radius:12px;
        font-size:14px; font-weight:500; z-index:9999;
        box-shadow:0 8px 32px rgba(0,0,0,0.5);
        animation:slideUp 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
}

function goHome() {
    // If results, playlist, or loading are showing, go back to hero
    const resultsVisible = !document.getElementById('resultsSection')?.classList.contains('hidden');
    const loadingVisible = !document.getElementById('loadingSection')?.classList.contains('hidden');
    const playlistVisible = !document.getElementById('playlistSection')?.classList.contains('hidden');
    if (resultsVisible || loadingVisible || playlistVisible) resetToHero();
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
