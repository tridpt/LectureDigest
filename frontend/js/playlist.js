/* ════════════════════════════════════════════════
   LectureDigest — Playlist / Course Mode
   ════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════
// PLAYLIST / COURSE MODE
// ══════════════════════════════════════════════════════

var playlistState = {
    data: null,         // API response { playlist_id, title, author, videos:[] }
    currentIndex: -1,   // index of the video currently being analyzed
    analyzed: [],       // list of analyzed video IDs
};

var PL_PROGRESS_KEY = 'lectureDigest_playlist_';

function plProgressKey(id) { return PL_PROGRESS_KEY + id; }

function loadPlProgress(playlistId) {
    try { return JSON.parse(localStorage.getItem(plProgressKey(playlistId)) || '{"analyzed":[]}'); }
    catch(e) { return { analyzed: [] }; }
}

function savePlProgress(playlistId, analyzed) {
    try {
        localStorage.setItem(plProgressKey(playlistId), JSON.stringify({ analyzed: analyzed }));
    } catch(e) {}
}

async function loadPlaylist(url) {
    showSection('loadingSection');
    var statusEl = document.getElementById('loadingStatus');
    if (statusEl) statusEl.textContent = 'Dang tai playlist...';

    try {
        var res = await fetch(API_BASE + '/api/playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url })
        });
        if (!res.ok) {
            var err = await res.json().catch(function() { return { detail: 'Unknown error' }; });
            throw new Error(err.detail || 'Failed to load playlist');
        }
        var data = await res.json();
        playlistState.data = data;
        playlistState.currentIndex = -1;

        // Load saved progress
        var saved = loadPlProgress(data.playlist_id);
        playlistState.analyzed = saved.analyzed || [];

        renderPlaylistView();
        showSection('playlistSection');
    } catch(err) {
        var msgEl = document.getElementById('errorMessage');
        if (msgEl) msgEl.textContent = err.message || 'Failed to load playlist';
        showSection('errorSection');
        document.getElementById('analyzeBtn').disabled = false;
    }
}

function renderPlaylistView() {
    var data = playlistState.data;
    if (!data) return;

    var analyzed = playlistState.analyzed;
    var total = data.videos.length;
    var done = analyzed.length;
    var pct = total > 0 ? Math.round(done / total * 100) : 0;

    // Header
    var titleEl = document.getElementById('plTitle');
    var authorEl = document.getElementById('plAuthor');
    var countEl = document.getElementById('plVideoCount');
    var analyzedEl = document.getElementById('plAnalyzedCount');
    if (titleEl) titleEl.textContent = data.title;
    if (authorEl) authorEl.textContent = data.author || '';
    if (countEl) countEl.innerHTML = countEl.innerHTML.replace(/\d+ video(s?)/, total + ' video' + (total !== 1 ? 's' : ''));
    if (analyzedEl) analyzedEl.innerHTML = analyzedEl.innerHTML.replace(/\d+/, done);

    // Progress
    var pctEl = document.getElementById('plProgressPct');
    var fillEl = document.getElementById('plProgressFill');
    if (pctEl) pctEl.textContent = pct + '%';
    if (fillEl) fillEl.style.width = pct + '%';

    // Video list
    var listEl = document.getElementById('plVideoList');
    if (!listEl) return;

    listEl.innerHTML = data.videos.map(function(v, i) {
        var isDone = analyzed.indexOf(v.video_id) >= 0;
        var isCurrent = i === playlistState.currentIndex;
        var classes = 'pl-video-card';
        if (isDone) classes += ' analyzed';
        if (isCurrent) classes += ' active';

        var statusHtml = '';
        if (isDone) {
            statusHtml = '<span class="pl-status-badge pl-status-done">\u2713 Da xong</span>';
        } else if (isCurrent) {
            statusHtml = '<span class="pl-status-badge pl-status-current">\u25B6 Dang xem</span>';
        } else {
            statusHtml = '<span class="pl-status-badge pl-status-pending">\u25CB Chua xem</span>';
        }

        return '<div class="' + classes + '" onclick="analyzePlaylistVideo(' + i + ')" tabindex="0" role="button">'
            + '<div class="pl-video-num">' + (isDone ? '\u2713' : v.index) + '</div>'
            + '<img class="pl-video-thumb" src="' + v.thumbnail + '" alt="" loading="lazy">'
            + '<div class="pl-video-info">'
            + '<div class="pl-video-title">' + (v.title || 'Video ' + v.index) + '</div>'
            + '<div class="pl-video-duration">' + (v.duration || '') + '</div>'
            + '</div>'
            + '<div class="pl-video-status">' + statusHtml + '</div>'
            + '</div>';
    }).join('');
}

function analyzePlaylistVideo(index) {
    var data = playlistState.data;
    if (!data || !data.videos[index]) return;

    var video = data.videos[index];
    playlistState.currentIndex = index;

    // Set URL input and trigger normal analysis flow
    var urlInput = document.getElementById('urlInput');
    if (urlInput) urlInput.value = 'https://www.youtube.com/watch?v=' + video.video_id;

    window._plVideoMode = true;
    analyzeVideo();
    setTimeout(function() { window._plVideoMode = false; }, 200);
}

// Patch: after analysis completes, update playlist progress
(function patchAnalyzeForPlaylist() {
    var _origShowSection = showSection;
    showSection = function(id) {
        _origShowSection(id);
        if (id === 'resultsSection' && playlistState.data) {
            // Mark video as analyzed
            var vid = window._spaVideoId || (analysisData && analysisData.video_id);
            if (vid && playlistState.analyzed.indexOf(vid) < 0) {
                playlistState.analyzed.push(vid);
                savePlProgress(playlistState.data.playlist_id, playlistState.analyzed);
            }
            // Show nav bar
            updatePlNavBar();
        }
    };
})();

function updatePlNavBar() {
    var navBar = document.getElementById('plNavBar');
    if (!navBar || !playlistState.data) { if (navBar) navBar.classList.add('hidden'); return; }

    navBar.classList.remove('hidden');
    var total = playlistState.data.videos.length;
    var idx = playlistState.currentIndex;

    var posEl = document.getElementById('plNavPos');
    if (posEl) posEl.textContent = 'Video ' + (idx + 1) + ' / ' + total;

    var prevBtn = document.getElementById('plNavPrevBtn');
    var nextBtn = document.getElementById('plNavNextBtn');
    if (prevBtn) prevBtn.disabled = idx <= 0;
    if (nextBtn) nextBtn.disabled = idx >= total - 1;
}

function plNavPrev() {
    if (playlistState.currentIndex > 0) {
        analyzePlaylistVideo(playlistState.currentIndex - 1);
    }
}

function plNavNext() {
    var total = playlistState.data ? playlistState.data.videos.length : 0;
    if (playlistState.currentIndex < total - 1) {
        analyzePlaylistVideo(playlistState.currentIndex + 1);
    }
}

function showPlaylistView() {
    renderPlaylistView();
    showSection('playlistSection');
}

function closePlaylist() {
    playlistState.data = null;
    playlistState.currentIndex = -1;
    playlistState.analyzed = [];
    showSection('hero');
    document.getElementById('urlInput').value = '';
    document.getElementById('analyzeBtn').disabled = false;
}

