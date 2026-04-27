/* ════════════════════════════════════════════════
   LectureDigest — Upload Module
   File upload handling, drag-and-drop, upload-analyze flow
   ════════════════════════════════════════════════ */

// ── State ──
var _uploadFile = null;
var _uploadXhr = null;

// ── Input Mode Tabs ──
function setInputMode(mode) {
    document.querySelectorAll('.input-tab').forEach(function(t) {
        t.classList.toggle('active', t.dataset.mode === mode);
    });
    var searchBox = document.getElementById('searchBox');
    var uploadZone = document.getElementById('uploadZone');

    if (mode === 'upload') {
        if (searchBox) searchBox.classList.add('hidden');
        if (uploadZone) uploadZone.classList.remove('hidden');
    } else {
        if (searchBox) searchBox.classList.remove('hidden');
        if (uploadZone) uploadZone.classList.add('hidden');
    }
}

// ── Drag & Drop ──
function handleUploadDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    var zone = document.getElementById('uploadZone');
    if (zone) zone.classList.add('drag-over');
}

function handleUploadDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    var zone = document.getElementById('uploadZone');
    if (zone) zone.classList.remove('drag-over');
}

function handleUploadDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    var zone = document.getElementById('uploadZone');
    if (zone) zone.classList.remove('drag-over');

    var files = e.dataTransfer?.files;
    if (files && files.length > 0) {
        processSelectedFile(files[0]);
    }
}

// ── File Selection ──
function triggerFileUpload() {
    // Don't open file picker if file is already selected or upload in progress
    if (_uploadFile || !document.getElementById('uploadProgress')?.classList.contains('hidden')) return;
    document.getElementById('uploadFileInput')?.click();
}

function handleFileSelected(e) {
    var file = e.target?.files?.[0];
    if (file) processSelectedFile(file);
}

function processSelectedFile(file) {
    // Validate extension
    var validExts = ['.mp3','.mp4','.wav','.m4a','.webm','.ogg','.flac','.aac','.mov','.mkv','.mpeg'];
    var ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
    if (validExts.indexOf(ext) === -1) {
        showToast('Định dạng file không được hỗ trợ. Hỗ trợ: ' + validExts.join(', '));
        return;
    }

    // Validate size (200MB)
    if (file.size > 200 * 1024 * 1024) {
        showToast('File quá lớn. Giới hạn: 200MB');
        return;
    }

    _uploadFile = file;

    // Show file preview
    var content = document.getElementById('uploadZoneContent');
    var preview = document.getElementById('uploadFilePreview');
    var analyzeBtn = document.getElementById('uploadAnalyzeBtn');
    if (content) content.classList.add('hidden');
    if (preview) preview.classList.remove('hidden');
    if (analyzeBtn) analyzeBtn.classList.remove('hidden');

    // Update file info
    var nameEl = document.getElementById('uploadFileName');
    var sizeEl = document.getElementById('uploadFileSize');
    if (nameEl) nameEl.textContent = file.name;
    if (sizeEl) {
        var sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        sizeEl.textContent = sizeMB + ' MB';
    }

    // Set icon based on type
    var iconEl = document.querySelector('.upload-file-icon');
    if (iconEl) {
        var isVideo = file.type.startsWith('video/') || ['.mp4','.webm','.mov','.mkv','.mpeg'].indexOf(ext) >= 0;
        iconEl.textContent = isVideo ? '🎬' : '🎵';
    }
}

function removeUploadFile() {
    _uploadFile = null;
    // Reset file input
    var inp = document.getElementById('uploadFileInput');
    if (inp) inp.value = '';

    // Show upload zone content, hide preview
    var content = document.getElementById('uploadZoneContent');
    var preview = document.getElementById('uploadFilePreview');
    var analyzeBtn = document.getElementById('uploadAnalyzeBtn');
    var progress = document.getElementById('uploadProgress');
    if (content) content.classList.remove('hidden');
    if (preview) preview.classList.add('hidden');
    if (analyzeBtn) analyzeBtn.classList.add('hidden');
    if (progress) progress.classList.add('hidden');
}

// ── Upload & Analyze ──
async function analyzeUploadedFile() {
    if (!_uploadFile) {
        showToast('Vui lòng chọn file trước');
        return;
    }

    var analyzeBtn = document.getElementById('uploadAnalyzeBtn');
    var progressEl = document.getElementById('uploadProgress');
    var progressFill = document.getElementById('uploadProgressFill');
    var progressText = document.getElementById('uploadProgressText');

    // Show progress
    if (progressEl) progressEl.classList.remove('hidden');
    if (analyzeBtn) analyzeBtn.disabled = true;
    if (progressFill) progressFill.style.width = '0%';
    if (progressText) progressText.textContent = 'Đang upload file...';

    // Switch to loading section
    showSection('loadingSection');
    var stopAnimation = startLoadingAnimation();

    // Update loading text for upload
    var statusEl = document.getElementById('loadingStatus');
    if (statusEl) statusEl.textContent = 'Uploading file & transcribing...';

    try {
        var formData = new FormData();
        formData.append('file', _uploadFile);
        formData.append('output_language', selectedLang);
        formData.append('title', _uploadFile.name.replace(/\.[^.]+$/, ''));

        // Use XMLHttpRequest for upload progress
        var result = await new Promise(function(resolve, reject) {
            var xhr = new XMLHttpRequest();
            _uploadXhr = xhr;

            xhr.upload.addEventListener('progress', function(e) {
                if (e.lengthComputable) {
                    var pct = Math.round((e.loaded / e.total) * 100);
                    if (progressFill) progressFill.style.width = pct + '%';
                    if (progressText) progressText.textContent = 'Uploading... ' + pct + '%';
                    if (pct >= 100) {
                        if (progressText) progressText.textContent = 'Đang phân tích với AI...';
                        if (statusEl) statusEl.textContent = 'Đang phiên dịch và phân tích nội dung...';
                    }
                }
            });

            xhr.addEventListener('load', function() {
                _uploadXhr = null;
                try {
                    var data = JSON.parse(xhr.responseText);
                    if (xhr.status >= 400) {
                        reject(new Error(data.detail || 'Server error ' + xhr.status));
                    } else {
                        resolve(data);
                    }
                } catch(e) {
                    reject(new Error('Invalid server response'));
                }
            });

            xhr.addEventListener('error', function() {
                _uploadXhr = null;
                reject(new Error('Network error'));
            });

            xhr.addEventListener('abort', function() {
                _uploadXhr = null;
                reject(new Error('Upload cancelled'));
            });

            xhr.open('POST', API_BASE + '/api/upload-analyze');
            xhr.send(formData);
        });

        stopAnimation();

        // Got result — use same rendering pipeline as YouTube
        analysisData = result;

        if (!analysisData.video_id) throw new Error('Response missing video_id');

        clearChat();
        renderUploadResults(analysisData);
        saveToHistory(analysisData);
        initNotes(analysisData.video_id);
        renderTranscript(analysisData.transcript || []);
        initProgress(analysisData.video_id);
        initBookmarks(analysisData.video_id);
        recordStudySession();
        window._spaVideoId = analysisData.video_id;
        showSection('resultsSection');

    } catch(err) {
        stopAnimation();
        var msgEl = document.getElementById('errorMessage');
        if (msgEl) msgEl.textContent = err.message || 'Failed to analyze file.';
        showSection('errorSection');
    } finally {
        // Reset upload UI
        if (analyzeBtn) analyzeBtn.disabled = false;
        if (progressEl) progressEl.classList.add('hidden');
        removeUploadFile();
    }
}

// ── Render results for uploaded files ──
// Similar to renderResults but handles missing YouTube player
function renderUploadResults(data) {
    // Title & author
    setText('videoTitle', data.title || data.upload_filename || 'Untitled');
    setText('videoAuthor', data.author ? 'By ' + data.author : '');

    // Difficulty badge
    var diffEl = document.getElementById('videoDifficulty');
    if (diffEl) {
        var diff = data.difficulty || 'Unknown';
        diffEl.textContent = diff;
        diffEl.className = 'video-difficulty-badge difficulty-' + diff.toLowerCase();
    }

    // Overview
    setText('overviewText', data.overview || '');

    // Key takeaways
    var list = document.getElementById('takeawaysList');
    if (list) {
        list.innerHTML = '';
        (data.key_takeaways || []).forEach(function(t) {
            var li = document.createElement('li');
            li.textContent = t;
            list.appendChild(li);
        });
    }

    // Chapter topics
    var topicsList = document.getElementById('topicsList');
    var chapterCount = document.getElementById('chapterCount');
    var topics = data.topics || [];

    if (topicsList) {
        topicsList.innerHTML = '';
        topics.forEach(function(topic) {
            var el = document.createElement('div');
            el.className = 'topic-item';
            el.setAttribute('role', 'listitem');
            el.innerHTML =
                '<div class="topic-emoji" aria-hidden="true">' + esc(topic.emoji || '📌') + '</div>' +
                '<div class="topic-content">' +
                    '<div class="topic-header">' +
                        '<span class="topic-title">' + esc(topic.title) + '</span>' +
                        '<span class="topic-timestamp">' + esc(topic.timestamp_str) + '</span>' +
                    '</div>' +
                    '<p class="topic-summary">' + esc(topic.summary) + '</p>' +
                '</div>';
            topicsList.appendChild(el);
        });
    }
    if (chapterCount) chapterCount.textContent = topics.length + ' chapter' + (topics.length !== 1 ? 's' : '');

    // No YouTube player for uploads — show upload file info
    var playerWrap = document.getElementById('youtubePlayer');
    if (playerWrap) {
        playerWrap.innerHTML =
            '<div class="upload-player-placeholder">' +
                '<div class="upload-player-icon">' + (data.upload_filename && /\.(mp4|webm|mov|mkv|mpeg)$/i.test(data.upload_filename) ? '🎬' : '🎵') + '</div>' +
                '<div class="upload-player-title">' + esc(data.upload_filename || data.title) + '</div>' +
                '<div class="upload-player-badge">Uploaded File</div>' +
            '</div>';
    }

    // Highlights
    renderHighlights(data.highlights || []);

    // Quiz
    initQuiz(data.quiz || []);
}
