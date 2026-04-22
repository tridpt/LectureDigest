
// ══════════════════════════════════════════════════════════
// CONCEPT EXPLAINER
// Select / highlight text → floating "Giải thích" button
// Click button → AI explanation popup
// ══════════════════════════════════════════════════════════

(function initConceptExplainer() {

    // ── Explainable zone selector ─────────────────────────
    const ZONE_SEL =
        '.transcript-line, .overview-text, .takeaway-item, ' +
        '.chapter-desc, .chapter-title, .key-term-chip, ' +
        '.highlight-text, .takeaway-text, .summary-text, p';

    // ── Floating "Giải thích" trigger button ─────────────
    let _triggerBtn = null;
    let _savedTerm  = '';
    let _savedCtx   = '';
    let _selRange   = null;

    function getTriggerBtn() {
        if (_triggerBtn) return _triggerBtn;
        _triggerBtn = document.createElement('button');
        _triggerBtn.id = 'ceExplainBtn';
        _triggerBtn.className = 'ce-trigger-btn';
        _triggerBtn.innerHTML = '💡 Giải thích';
        _triggerBtn.setAttribute('aria-label', 'Giải thích từ đã chọn');
        _triggerBtn.style.display = 'none';
        document.body.appendChild(_triggerBtn);

        _triggerBtn.addEventListener('mousedown', function(e) {
            e.preventDefault(); // don't lose selection
        });
        _triggerBtn.addEventListener('click', function() {
            hideTriggerBtn();
            if (_savedTerm) triggerExplain(_savedTerm, _savedCtx);
        });
        return _triggerBtn;
    }

    function showTriggerBtn(x, y, term, ctx) {
        const btn = getTriggerBtn();
        _savedTerm = term;
        _savedCtx  = ctx;

        btn.style.display = 'flex';
        btn.style.opacity = '0';

        const bw = btn.offsetWidth  || 110;
        const vw = window.innerWidth;

        let left = Math.max(8, Math.min(x - bw / 2, vw - bw - 8));
        let top  = y - 44; // appear above the selection
        if (top < 8) top = y + 16;

        btn.style.left = left + 'px';
        btn.style.top  = top  + 'px';
        requestAnimationFrame(() => { btn.style.opacity = '1'; });
    }

    function hideTriggerBtn() {
        if (_triggerBtn) {
            _triggerBtn.style.opacity = '0';
            setTimeout(() => { if (_triggerBtn) _triggerBtn.style.display = 'none'; }, 150);
        }
    }

    // ── Listen for text selections ────────────────────────
    document.addEventListener('mouseup', function(e) {
        // Don't interfere with the popup itself
        const popup = document.getElementById('conceptPopup');
        if (popup && popup.contains(e.target)) return;
        if (_triggerBtn && _triggerBtn.contains(e.target)) return;

        setTimeout(function() {      // tiny delay so selection is finalised
            const sel  = window.getSelection();
            const term = sel ? sel.toString().trim() : '';

            if (!term || term.length < 2 || term.length > 150) {
                hideTriggerBtn();
                return;
            }

            // Must be inside an explainable zone
            const anchor = sel.anchorNode && sel.anchorNode.parentElement;
            if (!anchor || !anchor.closest(ZONE_SEL)) {
                hideTriggerBtn();
                return;
            }

            // Gather context from the zone
            const zone = anchor.closest(ZONE_SEL);
            const ctx  = zone ? zone.textContent.replace(/\s+/g, ' ').trim().slice(0, 300) : '';

            // Position button above midpoint of selection
            const range = sel.getRangeAt(0);
            const rect  = range.getBoundingClientRect();
            const midX  = rect.left + rect.width  / 2 + window.scrollX;
            const topY  = rect.top               + window.scrollY;

            showTriggerBtn(midX, topY, term, ctx);
        }, 10);
    });

    // Hide trigger if user clicks elsewhere (not on trigger or popup)
    document.addEventListener('mousedown', function(e) {
        const popup = document.getElementById('conceptPopup');
        if (_triggerBtn && !_triggerBtn.contains(e.target) &&
            !(popup && popup.contains(e.target))) {
            hideTriggerBtn();
        }
    });

    // Also support keyboard selection: show on keyup if there's a selection
    document.addEventListener('keyup', function(e) {
        if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Shift'].includes(e.key)) return;
        const sel  = window.getSelection();
        const term = sel ? sel.toString().trim() : '';
        if (!term || term.length < 2 || term.length > 150) { hideTriggerBtn(); return; }

        const anchor = sel.anchorNode && sel.anchorNode.parentElement;
        if (!anchor || !anchor.closest(ZONE_SEL)) { hideTriggerBtn(); return; }

        const zone  = anchor.closest(ZONE_SEL);
        const ctx   = zone ? zone.textContent.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
        const range = sel.getRangeAt(0);
        const rect  = range.getBoundingClientRect();
        showTriggerBtn(
            rect.left + rect.width / 2 + window.scrollX,
            rect.top + window.scrollY,
            term, ctx
        );
    });

    // ── Explanation popup ─────────────────────────────────
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
            document.addEventListener('mousedown', function(e) {
                const pop = document.getElementById(POPUP_ID);
                if (pop && !pop.contains(e.target) &&
                    !(_triggerBtn && _triggerBtn.contains(e.target))) {
                    closeConceptPopup();
                }
            }, true);
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') { closeConceptPopup(); hideTriggerBtn(); }
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

    function positionPopup(popup, anchorRect) {
        popup.style.display = 'block';
        popup.style.opacity = '0';

        const pw = 290;
        const ph = popup.offsetHeight || 160;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const GAP = 10;

        // Prefer below selection, flip above if needed
        let left = anchorRect.left + anchorRect.width / 2 - pw / 2;
        let top  = anchorRect.bottom + GAP;

        if (top + ph > vh - 8) top = anchorRect.top - ph - GAP;
        left = Math.max(8, Math.min(left, vw - pw - 8));
        top  = Math.max(8, top);

        popup.style.left    = left + 'px';
        popup.style.top     = top  + 'px';
        popup.style.opacity = '1';
        popup.classList.add('ce-visible');
    }

    // ── Fetch + render explanation ────────────────────────
    async function triggerExplain(term, ctx) {
        const popup  = getPopup();
        const termEl = document.getElementById('ceTerm');
        const bodyEl = document.getElementById('ceBody');
        const footEl = document.getElementById('ceFooter');

        const videoTitle = (window.analysisData && window.analysisData.title)    || '';
        const language   = (window.analysisData && window.analysisData.language) || 'vi';

        if (termEl) termEl.textContent = '"' + term + '"';
        if (bodyEl) bodyEl.innerHTML =
            '<div class="ce-loading">' +
            '<div class="ce-spinner"></div>' +
            '<span>Đang giải thích...</span>' +
            '</div>';
        if (footEl) footEl.innerHTML = '';

        // Position near viewport center-top or near where text was
        const sel   = window.getSelection();
        let anchorRect = { left: window.innerWidth/2 - 145, right: window.innerWidth/2 + 145,
                           top: 200, bottom: 220, width: 290 };
        if (sel && sel.rangeCount) {
            const r = sel.getRangeAt(0).getBoundingClientRect();
            if (r.width) anchorRect = r;
        }

        positionPopup(popup, anchorRect);

        try {
            const res = await fetch('/api/explain-concept', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ term, context: ctx, video_title: videoTitle, language })
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();

            if (bodyEl) {
                bodyEl.innerHTML = '<p class="ce-explanation">' +
                    data.explanation.replace(/\n/g, '<br>') + '</p>';
            }

            if (footEl) {
                footEl.innerHTML =
                    '<button class="ce-ask-btn" id="ceAskBtn">' +
                    '💬 Hỏi thêm về chủ đề này' +
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

        // Re-position after text is rendered
        setTimeout(() => positionPopup(popup, anchorRect), 60);
    }

    // ── Pre-fill chat input ───────────────────────────────
    function askAboutTerm(term) {
        const chatInput =
            document.getElementById('chatInput') ||
            document.querySelector('textarea[placeholder*="hỏi"], textarea[placeholder*="chat"]');
        if (chatInput) {
            chatInput.value = 'Hãy giải thích chi tiết hơn về "' + term + '" trong ngữ cảnh bài giảng này.';
            chatInput.dispatchEvent(new Event('input', { bubbles: true }));
            chatInput.focus();
            chatInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    // ── One-time hint ─────────────────────────────────────
    function showSelectionHint() {
        if (sessionStorage.getItem('ce_hint_shown')) return;
        if (!window.analysisData) return;
        sessionStorage.setItem('ce_hint_shown', '1');

        const hint = document.createElement('div');
        hint.className = 'ce-hint-pill';
        hint.innerHTML = '🖱️ Bôi đen từ bất kỳ → nhấn <strong>💡 Giải thích</strong>';
        document.body.appendChild(hint);

        setTimeout(() => hint.classList.add('ce-hint-visible'), 200);
        setTimeout(() => {
            hint.classList.remove('ce-hint-visible');
            setTimeout(() => hint.remove(), 400);
        }, 4000);
    }

    // Hook into showSection
    const _origShow = window.showSection;
    window.showSection = function(id) {
        _origShow(id);
        if (id === 'resultsSection') setTimeout(showSelectionHint, 1500);
    };

})();
