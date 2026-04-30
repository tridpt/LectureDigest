/* ════════════════════════════════════════════════
   LectureDigest — Keyboard Shortcuts Help
   Press  ?  (Shift + /) to toggle
   ════════════════════════════════════════════════ */

var _shortcutsOpen = false;

function openShortcutsHelp() {
    if (_shortcutsOpen) { closeShortcutsHelp(); return; }
    _shortcutsOpen = true;

    var overlay = document.createElement('div');
    overlay.className = 'kbhelp-overlay';
    overlay.id = 'kbhelpOverlay';
    overlay.onclick = function(e) { if (e.target === overlay) closeShortcutsHelp(); };

    var sections = [
        {
            title: '🌐 Toàn trang',
            shortcuts: [
                ['Ctrl + K', 'Mở tìm kiếm toàn cục'],
                ['?', 'Mở / đóng bảng phím tắt'],
                ['Escape', 'Đóng modal / overlay đang mở'],
                ['Enter', 'Phân tích video (khi ở trang chủ)'],
            ]
        },
        {
            title: '🔍 Tìm kiếm (Ctrl+K)',
            shortcuts: [
                ['↑ / ↓', 'Di chuyển giữa kết quả'],
                ['Enter', 'Mở kết quả đang chọn'],
                ['Escape', 'Đóng tìm kiếm'],
            ]
        },
        {
            title: '🃏 Flashcard',
            shortcuts: [
                ['← / →', 'Qua thẻ trước / sau'],
                ['Space / Enter', 'Lật thẻ'],
                ['Escape', 'Đóng flashcard'],
            ]
        },
        {
            title: '🧠 SRS Review',
            shortcuts: [
                ['Space / Enter', 'Lật thẻ ôn tập'],
                ['Escape', 'Đóng phiên ôn tập'],
            ]
        },
        {
            title: '📝 Bookmark',
            shortcuts: [
                ['Enter', 'Lưu bookmark'],
                ['Escape', 'Hủy tạo bookmark'],
            ]
        },
        {
            title: '💬 Chat AI',
            shortcuts: [
                ['Enter', 'Gửi tin nhắn'],
                ['Shift + Enter', 'Xuống dòng'],
            ]
        },
    ];

    var html = '<div class="kbhelp-modal" onclick="event.stopPropagation()">' +
        '<div class="kbhelp-header">' +
        '<h2 class="kbhelp-title">⌨️ Phím tắt</h2>' +
        '<button class="kbhelp-close" onclick="closeShortcutsHelp()" aria-label="Đóng">&times;</button>' +
        '</div>' +
        '<div class="kbhelp-body">';

    sections.forEach(function(sec) {
        html += '<div class="kbhelp-section">' +
            '<h3 class="kbhelp-section-title">' + sec.title + '</h3>' +
            '<div class="kbhelp-list">';
        sec.shortcuts.forEach(function(s) {
            var keys = s[0].split(' + ').map(function(k) {
                return '<kbd class="kbhelp-kbd">' + escHtml(k.trim()) + '</kbd>';
            }).join('<span class="kbhelp-plus">+</span>');
            html += '<div class="kbhelp-row">' +
                '<div class="kbhelp-keys">' + keys + '</div>' +
                '<div class="kbhelp-desc">' + escHtml(s[1]) + '</div>' +
                '</div>';
        });
        html += '</div></div>';
    });

    html += '</div>' +
        '<div class="kbhelp-footer">' +
        'Nhấn <kbd class="kbhelp-kbd">?</kbd> để đóng' +
        '</div></div>';

    overlay.innerHTML = html;
    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(function() {
        overlay.classList.add('kbhelp-visible');
    });
}

function closeShortcutsHelp() {
    var ov = document.getElementById('kbhelpOverlay');
    if (ov) {
        ov.classList.remove('kbhelp-visible');
        setTimeout(function() { ov.remove(); }, 200);
    }
    _shortcutsOpen = false;
}

// Listen for ? key (Shift + /)
document.addEventListener('keydown', function(e) {
    // Don't trigger when typing in inputs/textareas
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.target.contentEditable === 'true') return;

    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        openShortcutsHelp();
    }
});
