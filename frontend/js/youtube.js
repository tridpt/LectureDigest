/* ════════════════════════════════════════════════
   LectureDigest — YouTube Player Module
   ════════════════════════════════════════════════ */

// ──────────────────────────────────────
// YOUTUBE IFRAME API
// ──────────────────────────────────────
function onYouTubeIframeAPIReady() {
    ytApiReady = true;
    if (pendingVideoId) {
        createPlayer(pendingVideoId);
        pendingVideoId = null;
    }
}

function initYouTubePlayer(videoId) {
    if (!ytApiReady) {
        pendingVideoId = videoId;
        return;
    }

    if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
        ytPlayer.loadVideoById(videoId);
        stopTranscriptSync();   // reset sync for new video
        tsSync_lastIndex = -1;
        return;
    }

    createPlayer(videoId);
}

function createPlayer(videoId) {
    const wrapper = document.getElementById('youtubePlayer');
    wrapper.innerHTML = '';

    const div = document.createElement('div');
    div.id = 'yt-player-div';
    div.style.cssText = 'width:100%;height:100%;';
    wrapper.appendChild(div);

    ytPlayer = new YT.Player('yt-player-div', {
        height: '100%',
        width: '100%',
        videoId,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: window.location.origin },
        events: {
            onStateChange: onYtStateChange
        }
    });
}

function onYtStateChange(event) {
    // YT.PlayerState: PLAYING=1, PAUSED=2, ENDED=0, BUFFERING=3
    if (event.data === 1 || event.data === 3) {   // playing or buffering
        startTranscriptSync();
    } else {
        // Keep sync running on pause so highlight stays accurate
        // but stop only when ended
        if (event.data === 0) stopTranscriptSync();
    }
}

function seekTo(seconds) {
    if (ytPlayer && typeof ytPlayer.seekTo === 'function') {
        ytPlayer.seekTo(seconds, true);
        ytPlayer.playVideo();

        // On mobile, scroll the player into view
        if (window.innerWidth < 900) {
            document.getElementById('youtubePlayer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
}

// ── Seek from bookmark — scroll to top + overlay flash ──
function seekToBookmark(secs) {
    // 1. Seek + play
    if (ytPlayer && typeof ytPlayer.seekTo === 'function') {
        ytPlayer.seekTo(secs, true);
        ytPlayer.playVideo();
    }

    // 2. Scroll to very top of page so player is visible
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // 3. Overlay flash on the player wrapper
    const wrapper = document.getElementById('youtubePlayer');
    if (!wrapper) return;

    // Create a temporary flash overlay
    let flash = document.getElementById('bmFlashOverlay');
    if (!flash) {
        flash = document.createElement('div');
        flash.id = 'bmFlashOverlay';
        flash.style.cssText =
            'position:absolute;inset:0;border-radius:12px;pointer-events:none;z-index:10;'
            + 'border:2px solid rgba(139,92,246,0);transition:border-color 0.1s,opacity 0.5s;opacity:0;';
        // Ensure wrapper is positioned
        wrapper.style.position = 'relative';
        wrapper.appendChild(flash);
    }

    // Animate: flash in then fade out
    flash.style.borderColor = 'rgba(139,92,246,0.9)';
    flash.style.opacity = '1';
    flash.style.boxShadow = 'inset 0 0 0 3px rgba(139,92,246,0.4), 0 0 24px rgba(139,92,246,0.5)';
    flash.style.transition = 'none';

    setTimeout(() => {
        flash.style.transition = 'border-color 0.6s ease, opacity 0.6s ease, box-shadow 0.6s ease';
        flash.style.borderColor = 'rgba(139,92,246,0)';
        flash.style.opacity = '0';
        flash.style.boxShadow = 'none';
    }, 300);
}

// ──────────────────────────────────────
// CLIENT-SIDE TRANSCRIPT FETCHER
// Fetches from browser (not blocked by YouTube) and sends to backend.
// Bypasses cloud IP blocks on Render/Railway/etc.
// ──────────────────────────────────────
const CF_WORKER = 'https://delicate-disk-ef3f.tranductrist.workers.dev';

async function fetchTranscriptClientSide(videoId) {
    // Call our Cloudflare Worker which handles YouTube API internally
    const res = await fetch(`${CF_WORKER}/?videoId=${videoId}`);
    let data;
    try {
        data = await res.json();
    } catch (_) {
        throw new Error(`Worker returned non-JSON response (HTTP ${res.status})`);
    }
    if (!res.ok) throw new Error(data?.error || `Worker HTTP ${res.status}`);
    if (!Array.isArray(data) || !data.length) throw new Error('Empty transcript from Worker');
    console.log(`[LectureDigest] Worker transcript: ${data.length} segments`);
    return data;
}
