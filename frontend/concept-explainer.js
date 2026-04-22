
// ══════════════════════════════════════════════════════════
// CONCEPT EXPLAINER
// Double-click any word in transcript/summary → AI popup
// ══════════════════════════════════════════════════════════

(function initConceptExplainer() {
    // ── Popup singleton ──────────────────────────────────
    const POPUP_ID = 'conceptPopup';

    function getPopup() {
        let el = document.getElementById(POPUP_ID);
        if (!el) {
            el = document.createElement('div');
            el.id = POPUP_ID;
            el.className = 'ce-popup';
            el.innerHTML =
                '<div class="ce-header">' +
                '<span class="ce-term" id="ceTerm"></span>' +
                '<button class="ce-close" id="ceClose" aria-label="Đóng">✕</button>' +
                '</div>' +
                '<div class="ce-body" id="ceBody"></div>' +
                '<div class="ce-footer" id="ceFooter"></div>';
            document.body.appendChild(el);

            document.getElementById('ceClose').addEventListener('click', closeConceptPopup);
            // Close on outside click
            document.addEventListener('mousedown', function(e) {
                const popup = document.getElementById(POPUP_ID);
                if (popup && !popup.contains(e.target)) closeConceptPopup();
            }, true);
            // Close on Escape
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') closeConceptPopup();
            });
        }
        return el;
    }

    function closeConceptPopup() {
        const el = document.getElementById(POPUP_ID);
        if (el) {
            el.classList.remove('ce-visible');
            setTimeout(() => { if (el) el.style.display = 'none'; }, 200);
        }
    }

    function positionPopup(popup, x, y) {
        popup.style.display = 'block';
        popup.style.opacity = '0';

        const pw = popup.offsetWidth  || 280;
        const ph = popup.offsetHeight || 160;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const GAP = 12;

        let left = x - pw / 2;
        let top  = y + GAP;

        // Flip above if not enough room below
        if (top + ph > vh - 8) top = y - ph - GAP;
        // Clamp horizontally
        left = Math.max(8, Math.min(left, vw - pw - 8));
        // Clamp vertically
        top  = Math.max(8, top);

        popup.style.left = left + 'px';
        popup.style.top  = top  + 'px';
        popup.style.opacity = '1';
        popup.classList.add('ce-visible');
    }

    // ── Main handler ─────────────────────────────────────
    async function handleDoubleClick(e) {
        // Only trigger inside explainable zones
        const zone = e.target.closest(
            '.transcript-line, .overview-text, .takeaway-item, ' +
            '.chapter-desc, .chapter-title, .key-term-chip, ' +
            '.highlight-text, .takeaway-text, p'
        );
        if (!zone) return;

        // Get selected text (the double-clicked word)
        const sel  = window.getSelection();
        const term = sel ? sel.toString().trim() : '';
        if (!term || term.length < 2 || term.length > 80) return;

        // Get surrounding context (up to 300 chars)
        const context = zone.textContent.replace(/\s+/g, ' ').trim().slice(0, 300);

        // Video info for better explanations
        const videoTitle = (window.analysisData && window.analysisData.title) || '';
        const language   = (window.analysisData && window.analysisData.language) || 'vi';

        // Position popup at click location
        const popup  = getPopup();
        const termEl = document.getElementById('ceTerm');
        const bodyEl = document.getElementById('ceBody');
        const footEl = document.getElementById('ceFooter');

        if (termEl) termEl.textContent = term;
        if (bodyEl) bodyEl.innerHTML =
            '<div class="ce-loading">' +
            '<div class="ce-spinner"></div>' +
            '<span>Đang giải thích...</span>' +
            '</div>';
        if (footEl) footEl.innerHTML = '';

        positionPopup(popup, e.clientX, e.clientY);

        // Fetch explanation
        try {
            const res = await fetch('/api/explain-concept', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ term, context, video_title: videoTitle, language })
            });

            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();

            if (bodyEl) {
                bodyEl.innerHTML = '<p class="ce-explanation">' +
                    data.explanation.replace(/\n/g, '<br>') + '</p>';
            }

            // Footer: "Hỏi thêm" button
            if (footEl) {
                footEl.innerHTML =
                    '<button class="ce-ask-btn" id="ceAskBtn">' +
                    '💬 Hỏi thêm về "' + term + '"' +
                    '</button>';
                document.getElementById('ceAskBtn').addEventListener('click', function() {
                    closeConceptPopup();
                    askAboutTerm(term);
                });
            }

        } catch (err) {
            if (bodyEl) bodyEl.innerHTML =
                '<p class="ce-error">❌ Không thể giải thích. Thử lại sau.</p>';
        }

        // Re-position after content loaded
        setTimeout(() => positionPopup(popup, e.clientX, e.clientY), 50);
    }

    // ── Ask about term in chat ────────────────────────────
    function askAboutTerm(term) {
        // Find chat input and populate it
        const chatInput = document.getElementById('chatInput') ||
                          document.querySelector('.chat-input, [id*="chat"] input, [id*="chat"] textarea');
        if (chatInput) {
            const question = 'Hãy giải thích chi tiết hơn về "' + term + '" trong ngữ cảnh bài giảng này.';
            chatInput.value = question;
            chatInput.dispatchEvent(new Event('input', { bubbles: true }));
            chatInput.focus();
            // Scroll to chat
            chatInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    // ── Attach listener (use capture to beat other handlers) ──
    document.addEventListener('dblclick', handleDoubleClick, false);

    // ── Hint badge: show once per session ────────────────
    function showDoubleClickHint() {
        if (sessionStorage.getItem('ce_hint_shown')) return;
        if (!window.analysisData) return;   // only after analysis

        sessionStorage.setItem('ce_hint_shown', '1');
        const hint = document.createElement('div');
        hint.className = 'ce-hint-pill';
        hint.textContent = '💡 Double-click vào từ bất kỳ để giải thích';
        document.body.appendChild(hint);

        setTimeout(() => hint.classList.add('ce-hint-visible'), 100);
        setTimeout(() => {
            hint.classList.remove('ce-hint-visible');
            setTimeout(() => hint.remove(), 400);
        }, 3500);
    }

    // Show hint when results section becomes visible
    const _origShow = window.showSection;
    window.showSection = function(id) {
        _origShow(id);
        if (id === 'resultsSection') setTimeout(showDoubleClickHint, 1200);
    };

})();
