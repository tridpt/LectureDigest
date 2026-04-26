/* ════════════════════════════════════════════════
   LectureDigest — Chat with Lecture & Chapter Deep Dive
   ════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════════
// CHAT WITH LECTURE
// ══════════════════════════════════════════════════════════

function toggleChat() {
    const panel  = document.getElementById('chatPanel');
    const unread = document.getElementById('chatUnread');

    chatState.isOpen = !chatState.isOpen;
    panel?.classList.toggle('hidden', !chatState.isOpen);

    if (chatState.isOpen) {
        unread?.classList.add('hidden');
        setTimeout(() => document.getElementById('chatInput')?.focus(), 150);
        const msgs = document.getElementById('chatMessages');
        if (msgs) msgs.scrollTop = msgs.scrollHeight;
    }
}

function clearChat() {
    // Reset state
    chatState.history = [];
    chatState.isLoading = false;

    // Reset messages DOM to welcome message only
    const container = document.getElementById('chatMessages');
    if (container) {
        container.innerHTML = `
            <div class="chat-msg assistant">
                <div class="chat-bubble">
                    👋 Xin chào! Tôi đã đọc toàn bộ nội dung bài giảng này. Bạn có thể hỏi tôi bất cứ điều gì về video — nội dung, khái niệm, ví dụ, hay bất kỳ phần nào bạn chưa hiểu rõ!
                </div>
            </div>`;
    }

    // Show suggestions again
    document.getElementById('chatSuggestions')?.classList.remove('hidden');

    // Re-enable send button
    const sendBtn = document.getElementById('chatSendBtn');
    if (sendBtn) sendBtn.disabled = false;

    // Clear input
    const input = document.getElementById('chatInput');
    if (input) { input.value = ''; input.style.height = 'auto'; }
}

async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const message = input?.value.trim();
    if (!message || chatState.isLoading || !analysisData) return;

    // Clear suggestions after first message
    document.getElementById('chatSuggestions')?.classList.add('hidden');

    // Show user message
    appendChatMessage('user', message);
    chatState.history.push({ role: 'user', content: message });
    input.value = '';
    autoResizeChatInput(input);

    // Show typing indicator
    const typingId = showTypingIndicator();
    chatState.isLoading = true;
    document.getElementById('chatSendBtn').disabled = true;

    try {
        const res = await fetch(`${API_BASE}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                title: analysisData.title || '',
                transcript: analysisData.transcript || [],
                history: chatState.history.slice(-10),
                output_language: selectedLang,
            }),
        });

        // Remove typing indicator
        document.getElementById(typingId)?.remove();

        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
            throw new Error(err.detail || `Server error ${res.status}`);
        }

        const data = await res.json();
        const reply = data.reply || 'Xin lỗi, tôi không thể trả lời lúc này.';

        appendChatMessage('assistant', reply);
        chatState.history.push({ role: 'assistant', content: reply });

    } catch (err) {
        document.getElementById(typingId)?.remove();
        appendChatMessage('assistant', `❌ Lỗi: ${err.message}`);
    } finally {
        chatState.isLoading = false;
        document.getElementById('chatSendBtn').disabled = false;
        document.getElementById('chatInput')?.focus();
    }
}

function sendSuggestion(btn) {
    const text = btn.textContent.replace(/^[^\s]+\s/, ''); // strip emoji
    const input = document.getElementById('chatInput');
    if (input) {
        input.value = btn.textContent;
        sendChatMessage();
    }
}

function appendChatMessage(role, content) {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    const wrapper = document.createElement('div');
    wrapper.className = `chat-msg ${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = markdownToHtml(content);

    // Make timestamps clickable
    bubble.querySelectorAll('a[data-ts]').forEach(a => {
        a.addEventListener('click', e => {
            e.preventDefault();
            seekTo(parseInt(a.dataset.ts));
        });
    });

    wrapper.appendChild(bubble);
    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
}

function showTypingIndicator() {
    const container = document.getElementById('chatMessages');
    const id = 'typing_' + Date.now();
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-msg assistant';
    wrapper.id = id;
    wrapper.innerHTML = `<div class="chat-bubble typing-indicator"><span></span><span></span><span></span></div>`;
    container?.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
    return id;
}

function markdownToHtml(text) {
    return text
        // Bold
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        // Timestamps like [02:30] — make them clickable
        .replace(/\[(\d{1,2}):(\d{2})\]/g, (_, m, s) => {
            const secs = parseInt(m) * 60 + parseInt(s);
            return `<a class="chat-ts-link" data-ts="${secs}" href="#" title="Nhảy đến ${m}:${s}">⏱ ${m}:${s}</a>`;
        })
        // Line breaks
        .replace(/\n/g, '<br>');
}

function handleChatKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
    }
}

function autoResizeChatInput(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// Show chat FAB when results are visible, hide on hero
function updateChatFabVisibility() {
    const fab = document.getElementById('chatFab');
    if (!fab) return;
    const resultsVisible = !document.getElementById('resultsSection')?.classList.contains('hidden');
    fab.classList.toggle('hidden', !resultsVisible);
    // Close panel when going back to hero
    if (!resultsVisible && chatState.isOpen) {
        chatState.isOpen = false;
        document.getElementById('chatPanel')?.classList.add('hidden');
    }
}

// ══════════════════════════════════════════════════════
// CHAPTER DEEP DIVE
// ══════════════════════════════════════════════════════
function deepDiveChapter(topicIndex) {
    if (!analysisData || !analysisData.topics) return;
    var topic = analysisData.topics[topicIndex];
    if (!topic) return;

    // Force open chat panel
    var panel = document.getElementById('chatPanel');
    if (!panel) return;
    if (panel.classList.contains('hidden')) {
        chatState.isOpen = true;
        panel.classList.remove('hidden');
        var unread = document.getElementById('chatUnread');
        if (unread) unread.classList.add('hidden');
    }

    // Build a focused question
    var question = 'Giai thich chi tiet ve chapter "' + (topic.title || '') + '"'
        + (topic.timestamp_str ? ' (tai ' + topic.timestamp_str + ')' : '')
        + '. Noi dung: ' + (topic.summary || '')
        + '. Hay giai thich sau hon, cho vi du cu the, va neu nhung diem quan trong nhat cua phan nay.';

    // Set chat input and send
    var input = document.getElementById('chatInput');
    if (input) {
        input.value = question;
        // Auto-send after a brief delay
        setTimeout(function() {
            if (typeof sendChatMessage === 'function') sendChatMessage();
        }, 200);
    }

    // Show toast
    showToast('Dang hoi AI ve: ' + (topic.title || 'chapter'), 2000);
}

