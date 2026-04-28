/* ════════════════════════════════════════════════
   LectureDigest — Folders Module
   Organize videos into custom folders
   ════════════════════════════════════════════════ */

var _folders = [];
var _folderVideos = {};   // { folderId: [videoId, ...] }
var _activeFolderId = null; // null = show all

var FOLDER_ICONS = ['📁','📚','💻','📊','🔬','🌍','💰','🎨','🎵','🏃','📐','🧪','🎓','📝','🔧','⚡','🎯','🌟','💡','🧠'];
var FOLDER_COLORS = ['#8b5cf6','#6366f1','#3b82f6','#0ea5e9','#14b8a6','#10b981','#f59e0b','#ef4444','#ec4899','#f97316'];

// ── API helpers ────────────────────────────────────────
function _folderFetch(endpoint, opts) {
    var headers = { 'Content-Type': 'application/json' };
    var token = localStorage.getItem('ld_auth_token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var base = (window.API_BASE || '') + '/api/folders';
    return fetch(base + endpoint, Object.assign({ headers: headers }, opts || {}))
        .then(function(r) { return r.json(); })
        .catch(function(e) { console.warn('[Folders]', e); return null; });
}

function loadFolders() {
    return _folderFetch('').then(function(data) {
        if (data && data.folders) {
            _folders = data.folders;
            _folderVideos = {};
            _folders.forEach(function(f) {
                _folderVideos[f.id] = f.video_ids || [];
            });
        }
        return _folders;
    });
}

// ── Render folder filter bar ──────────────────────────
function renderFolderBar() {
    var bar = document.getElementById('folderBar');
    if (!bar) return;

    var html = '';

    // "All" chip
    html += '<button class="folder-chip folder-chip-all' + (_activeFolderId === null ? ' active' : '') + '" onclick="filterByFolder(null)">' +
        '<span class="folder-icon">📋</span>Tất cả</button>';

    // Folder chips
    _folders.forEach(function(f) {
        var count = (_folderVideos[f.id] || []).length;
        html += '<button class="folder-chip' + (_activeFolderId === f.id ? ' active' : '') + '" ' +
            'onclick="filterByFolder(' + f.id + ')" ' +
            'oncontextmenu="event.preventDefault();openFolderModal(' + f.id + ')" ' +
            'title="Click: filter | Right-click: edit">' +
            '<span class="folder-icon">' + f.icon + '</span>' +
            '<span>' + escHtml(f.name) + '</span>' +
            (count > 0 ? '<span class="folder-count">' + count + '</span>' : '') +
            '</button>';
    });

    // "+ New" button
    html += '<button class="folder-chip folder-chip-add" onclick="openFolderModal(null)">' +
        '<span class="folder-icon">+</span>Mới</button>';

    bar.innerHTML = html;
}

function filterByFolder(folderId) {
    _activeFolderId = folderId;
    renderFolderBar();
    renderHistoryPanel();
}

// ── Get video folder IDs (for filtering) ──────────────
function getVideoFolderIds(videoId) {
    var result = [];
    for (var fid in _folderVideos) {
        if (_folderVideos[fid].indexOf(videoId) >= 0) {
            result.push(parseInt(fid));
        }
    }
    return result;
}

function getVideoFolderBadges(videoId) {
    var fids = getVideoFolderIds(videoId);
    if (!fids.length) return '';
    return fids.map(function(fid) {
        var folder = _folders.find(function(f) { return f.id === fid; });
        if (!folder) return '';
        return '<span class="hist-folder-badge" style="background:' + folder.color + '22;color:' + folder.color + '">' +
            folder.icon + ' ' + escHtml(folder.name) + '</span>';
    }).join('');
}

// ── Folder picker (dropdown on history items) ─────────
var _folderPickerEl = null;

function showFolderPicker(videoId, btnEl) {
    closeFolderPicker();

    var picker = document.createElement('div');
    picker.className = 'folder-picker';
    picker.id = 'folderPicker';

    var currentFids = getVideoFolderIds(videoId);

    var html = '<div class="folder-picker-title">Thêm vào folder</div>';

    if (_folders.length === 0) {
        html += '<div style="padding:12px;font-size:12px;color:var(--text-secondary);text-align:center">Chưa có folder nào</div>';
    } else {
        _folders.forEach(function(f) {
            var inFolder = currentFids.indexOf(f.id) >= 0;
            html += '<button class="folder-picker-item' + (inFolder ? ' in-folder' : '') + '" ' +
                'onclick="toggleVideoInFolder(' + f.id + ',\'' + videoId + '\',' + (inFolder ? 'true' : 'false') + ')">' +
                '<span class="fp-icon">' + f.icon + '</span>' +
                '<span class="fp-name">' + escHtml(f.name) + '</span>' +
                (inFolder ? '<span class="fp-check">✓</span>' : '') +
                '</button>';
        });
    }

    html += '<div class="folder-picker-divider"></div>';
    html += '<button class="folder-picker-item folder-picker-new" onclick="closeFolderPicker();openFolderModal(null)">' +
        '<span class="fp-icon">+</span><span class="fp-name">Tạo folder mới</span></button>';

    picker.innerHTML = html;

    // Position near the button
    var rect = btnEl.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.top = (rect.bottom + 4) + 'px';
    picker.style.left = Math.max(8, rect.left - 120) + 'px';

    document.body.appendChild(picker);
    _folderPickerEl = picker;

    // Close on outside click
    setTimeout(function() {
        document.addEventListener('click', _closeFolderPickerHandler);
    }, 10);
}

function _closeFolderPickerHandler(e) {
    if (_folderPickerEl && !_folderPickerEl.contains(e.target)) {
        closeFolderPicker();
    }
}

function closeFolderPicker() {
    if (_folderPickerEl) {
        _folderPickerEl.remove();
        _folderPickerEl = null;
    }
    document.removeEventListener('click', _closeFolderPickerHandler);
}

function toggleVideoInFolder(folderId, videoId, isCurrentlyIn) {
    closeFolderPicker();
    if (isCurrentlyIn) {
        // Remove
        _folderFetch('/' + folderId + '/videos/' + encodeURIComponent(videoId), { method: 'DELETE' });
        var arr = _folderVideos[folderId] || [];
        _folderVideos[folderId] = arr.filter(function(v) { return v !== videoId; });
    } else {
        // Add
        _folderFetch('/' + folderId + '/videos', {
            method: 'POST',
            body: JSON.stringify({ video_id: videoId })
        });
        if (!_folderVideos[folderId]) _folderVideos[folderId] = [];
        _folderVideos[folderId].push(videoId);
    }
    renderFolderBar();
    renderHistoryPanel();
    if (typeof showToast === 'function') {
        showToast(isCurrentlyIn ? 'Đã xóa khỏi folder' : 'Đã thêm vào folder');
    }
}

// ── Create / Edit folder modal ────────────────────────
function openFolderModal(folderId) {
    var existing = folderId ? _folders.find(function(f) { return f.id === folderId; }) : null;
    var isEdit = !!existing;

    var selIcon = existing ? existing.icon : '📁';
    var selColor = existing ? existing.color : '#8b5cf6';

    var overlay = document.createElement('div');
    overlay.className = 'folder-modal-overlay';
    overlay.id = 'folderModalOverlay';
    overlay.onclick = function(e) { if (e.target === overlay) closeFolderModal(); };

    var iconGrid = FOLDER_ICONS.map(function(ic) {
        return '<button type="button" class="folder-icon-option' + (ic === selIcon ? ' selected' : '') + '" data-icon="' + ic + '" onclick="selectFolderIcon(this,\'' + ic + '\')">' + ic + '</button>';
    }).join('');

    var colorGrid = FOLDER_COLORS.map(function(c) {
        return '<button type="button" class="folder-color-option' + (c === selColor ? ' selected' : '') + '" style="background:' + c + '" data-color="' + c + '" onclick="selectFolderColor(this,\'' + c + '\')"></button>';
    }).join('');

    overlay.innerHTML =
        '<div class="folder-modal">' +
        '<h3>' + (isEdit ? '✏️ Chỉnh sửa folder' : '📁 Tạo folder mới') + '</h3>' +
        '<div class="folder-modal-field">' +
        '<label>Tên folder</label>' +
        '<input type="text" id="folderNameInput" maxlength="50" placeholder="VD: Machine Learning, IELTS..." value="' + (existing ? escHtml(existing.name) : '') + '">' +
        '</div>' +
        '<div class="folder-modal-field">' +
        '<label>Icon</label>' +
        '<div class="folder-icon-grid" id="folderIconGrid">' + iconGrid + '</div>' +
        '</div>' +
        '<div class="folder-modal-field">' +
        '<label>Màu</label>' +
        '<div class="folder-color-grid" id="folderColorGrid">' + colorGrid + '</div>' +
        '</div>' +
        '<div class="folder-modal-actions">' +
        (isEdit ? '<button class="folder-btn-delete" onclick="deleteFolder(' + folderId + ')">Xóa</button>' : '') +
        '<button class="folder-btn-cancel" onclick="closeFolderModal()">Hủy</button>' +
        '<button class="folder-btn-save" onclick="saveFolder(' + (folderId || 'null') + ')">Lưu</button>' +
        '</div>' +
        '</div>';

    document.body.appendChild(overlay);

    // Focus the name input
    setTimeout(function() {
        var inp = document.getElementById('folderNameInput');
        if (inp) inp.focus();
    }, 100);
}

var _selectedFolderIcon = '📁';
var _selectedFolderColor = '#8b5cf6';

function selectFolderIcon(el, icon) {
    _selectedFolderIcon = icon;
    document.querySelectorAll('#folderIconGrid .folder-icon-option').forEach(function(b) { b.classList.remove('selected'); });
    el.classList.add('selected');
}

function selectFolderColor(el, color) {
    _selectedFolderColor = color;
    document.querySelectorAll('#folderColorGrid .folder-color-option').forEach(function(b) { b.classList.remove('selected'); });
    el.classList.add('selected');
}

function closeFolderModal() {
    var ov = document.getElementById('folderModalOverlay');
    if (ov) ov.remove();
}

function saveFolder(folderId) {
    var name = (document.getElementById('folderNameInput').value || '').trim();
    if (!name) {
        if (typeof showToast === 'function') showToast('Vui lòng nhập tên folder');
        return;
    }

    // Read selected icon/color from DOM
    var iconEl = document.querySelector('#folderIconGrid .folder-icon-option.selected');
    var colorEl = document.querySelector('#folderColorGrid .folder-color-option.selected');
    var icon = iconEl ? iconEl.dataset.icon : '📁';
    var color = colorEl ? colorEl.dataset.color : '#8b5cf6';

    closeFolderModal();

    if (folderId) {
        // Update
        _folderFetch('/' + folderId, {
            method: 'PUT',
            body: JSON.stringify({ name: name, icon: icon, color: color })
        }).then(function() {
            loadFolders().then(function() {
                renderFolderBar();
                renderHistoryPanel();
            });
        });
    } else {
        // Create
        _folderFetch('', {
            method: 'POST',
            body: JSON.stringify({ name: name, icon: icon, color: color })
        }).then(function() {
            loadFolders().then(function() {
                renderFolderBar();
                renderHistoryPanel();
            });
        });
    }
    if (typeof showToast === 'function') showToast(folderId ? 'Đã cập nhật folder' : 'Đã tạo folder "' + name + '"');
}

function deleteFolder(folderId) {
    closeFolderModal();
    if (typeof showConfirmModal === 'function') {
        showConfirmModal('Xóa folder này? (Video trong folder không bị xóa)', function() {
            _folderFetch('/' + folderId, { method: 'DELETE' }).then(function() {
                if (_activeFolderId === folderId) _activeFolderId = null;
                loadFolders().then(function() {
                    renderFolderBar();
                    renderHistoryPanel();
                });
            });
            if (typeof showToast === 'function') showToast('Đã xóa folder');
        });
    } else {
        _folderFetch('/' + folderId, { method: 'DELETE' }).then(function() {
            if (_activeFolderId === folderId) _activeFolderId = null;
            loadFolders().then(function() {
                renderFolderBar();
                renderHistoryPanel();
            });
        });
    }
}

// ── Init: load folders on page load ───────────────────
(function initFolders() {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(function() { loadFolders().then(renderFolderBar); }, 800);
    } else {
        window.addEventListener('DOMContentLoaded', function() {
            setTimeout(function() { loadFolders().then(renderFolderBar); }, 800);
        });
    }
})();
