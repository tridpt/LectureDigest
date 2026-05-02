/* ════════════════════════════════════════════════
   LectureDigest — Text-to-Speech (Web Speech API)
   Read aloud: overview, notes, key takeaways
   ════════════════════════════════════════════════ */

(function () {
    'use strict';

    var synth = window.speechSynthesis;
    var _ttsUtterance = null;
    var _ttsPaused = false;
    var _ttsActive = false;

    // ── Public API ──

    /**
     * Toggle TTS for a specific content area.
     * @param {'overview'|'notes'|'takeaways'} source
     */
    window.ttsToggle = function (source) {
        if (!synth) {
            if (typeof showToast === 'function') showToast('Trình duyệt không hỗ trợ đọc to', 'error');
            return;
        }

        // If already reading, stop
        if (_ttsActive) {
            ttsStop();
            return;
        }

        var text = _getTextForSource(source);
        if (!text || !text.trim()) {
            if (typeof showToast === 'function') showToast('Không có nội dung để đọc', 'warning');
            return;
        }

        _ttsSpeak(text, source);
    };

    window.ttsPause = function () {
        if (synth && _ttsActive) {
            if (_ttsPaused) {
                synth.resume();
                _ttsPaused = false;
                _updateTtsUI('playing');
            } else {
                synth.pause();
                _ttsPaused = true;
                _updateTtsUI('paused');
            }
        }
    };

    window.ttsStop = function () {
        if (synth) {
            synth.cancel();
        }
        _ttsActive = false;
        _ttsPaused = false;
        _ttsUtterance = null;
        _updateTtsUI('idle');
    };

    window.ttsIsActive = function () {
        return _ttsActive;
    };

    // ── Internal ──

    function _getTextForSource(source) {
        switch (source) {
            case 'overview':
                var overviewEl = document.getElementById('overviewText');
                var takeawaysEl = document.getElementById('takeawaysList');
                var text = '';
                if (overviewEl) text += overviewEl.textContent + '. ';
                if (takeawaysEl) {
                    var items = takeawaysEl.querySelectorAll('li');
                    for (var i = 0; i < items.length; i++) {
                        text += items[i].textContent + '. ';
                    }
                }
                return text;

            case 'notes':
                var textarea = document.getElementById('notesTextarea');
                return textarea ? textarea.value : '';

            case 'takeaways':
                var el = document.getElementById('takeawaysList');
                if (!el) return '';
                var lis = el.querySelectorAll('li');
                var t = '';
                for (var j = 0; j < lis.length; j++) {
                    t += (j + 1) + '. ' + lis[j].textContent + '. ';
                }
                return t;

            default:
                return '';
        }
    }

    function _ttsSpeak(text, source) {
        // Cancel any ongoing speech
        synth.cancel();

        // Split long text into chunks (some browsers have a 15k char limit)
        var chunks = _splitText(text, 3000);
        var chunkIdx = 0;

        _ttsActive = true;
        _ttsPaused = false;
        _updateTtsUI('playing');

        function speakNext() {
            if (chunkIdx >= chunks.length || !_ttsActive) {
                _ttsActive = false;
                _ttsPaused = false;
                _updateTtsUI('idle');
                return;
            }

            var utterance = new SpeechSynthesisUtterance(chunks[chunkIdx]);
            _ttsUtterance = utterance;

            // Try to pick a good voice for the detected language
            var voice = _pickVoice(text);
            if (voice) utterance.voice = voice;

            utterance.rate = 1.0;
            utterance.pitch = 1.0;

            utterance.onend = function () {
                chunkIdx++;
                speakNext();
            };
            utterance.onerror = function (e) {
                if (e.error !== 'canceled') {
                    console.warn('[TTS] Error:', e.error);
                }
                _ttsActive = false;
                _updateTtsUI('idle');
            };

            synth.speak(utterance);
        }

        speakNext();
    }

    function _splitText(text, maxLen) {
        if (text.length <= maxLen) return [text];
        var chunks = [];
        var sentences = text.split(/(?<=[.!?。])\s+/);
        var current = '';
        for (var i = 0; i < sentences.length; i++) {
            if ((current + sentences[i]).length > maxLen && current.length > 0) {
                chunks.push(current.trim());
                current = '';
            }
            current += sentences[i] + ' ';
        }
        if (current.trim()) chunks.push(current.trim());
        return chunks;
    }

    function _pickVoice(text) {
        var voices = synth.getVoices();
        if (!voices.length) return null;

        // Detect if text is Vietnamese
        var isVietnamese = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i.test(text);

        var langCode = isVietnamese ? 'vi' : 'en';

        // Prefer voices matching the detected language
        for (var i = 0; i < voices.length; i++) {
            if (voices[i].lang.toLowerCase().indexOf(langCode) === 0) {
                return voices[i];
            }
        }

        return null; // fallback to browser default
    }

    function _updateTtsUI(state) {
        // Update all TTS buttons
        var btns = document.querySelectorAll('.tts-btn');
        for (var i = 0; i < btns.length; i++) {
            btns[i].classList.remove('tts-playing', 'tts-paused');
            if (state === 'playing') btns[i].classList.add('tts-playing');
            if (state === 'paused') btns[i].classList.add('tts-paused');
        }

        // Update the floating TTS controls
        var controls = document.getElementById('ttsControls');
        if (controls) {
            if (state === 'idle') {
                controls.classList.remove('tts-controls-visible');
            } else {
                controls.classList.add('tts-controls-visible');

                var pauseBtn = document.getElementById('ttsPauseBtn');
                if (pauseBtn) {
                    pauseBtn.textContent = state === 'paused' ? '▶' : '⏸';
                    pauseBtn.title = state === 'paused' ? 'Tiếp tục đọc' : 'Tạm dừng';
                }
            }
        }
    }

    // Preload voices (some browsers load async)
    if (synth) {
        synth.getVoices();
        if (synth.onvoiceschanged !== undefined) {
            synth.onvoiceschanged = function () { synth.getVoices(); };
        }
    }

    // Stop TTS when navigating away
    window.addEventListener('beforeunload', function () {
        if (synth) synth.cancel();
    });

})();
