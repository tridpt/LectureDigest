/**
 * LectureDigest — YouTube Transcript Worker
 * Dedicated transcript fetcher (not a generic CORS proxy).
 * Tries InnerTube (Android) → timedtext API fallback.
 * Usage: GET https://your-worker.workers.dev/?videoId=VIDEO_ID
 */

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('videoId');
    if (!videoId) return json({ error: 'Missing ?videoId=' }, 400, cors);

    // ── Method 1: InnerTube Android client ─────────────────────────────────
    try {
      const snippets = await fetchInnerTube(videoId);
      return json(snippets, 200, cors);
    } catch (e) {
      console.log('InnerTube failed:', e.message);
    }

    // ── Method 2: timedtext GET API ────────────────────────────────────────
    try {
      const snippets = await fetchTimedText(videoId);
      return json(snippets, 200, cors);
    } catch (e) {
      console.log('Timedtext failed:', e.message);
      return json({ error: e.message }, 502, cors);
    }
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function parseEvents(events = []) {
  return events.flatMap(e => {
    if (!e.segs) return [];
    const text = e.segs.map(s => s.utf8 || '').join('').trim();
    return text ? [{ text, start: (e.tStartMs || 0) / 1000 }] : [];
  });
}

async function fetchInnerTube(videoId) {
  const resp = await fetch(
    'https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'ANDROID', clientVersion: '17.31.35', androidSdkVersion: 30,
            userAgent: 'com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip',
            hl: 'en', timeZone: 'UTC', utcOffsetMinutes: 0,
          },
        },
      }),
    }
  );
  if (!resp.ok) throw new Error(`InnerTube HTTP ${resp.status}`);
  const data = await resp.json();
  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!tracks.length) throw new Error('No caption tracks');
  const track = tracks.find(t => t.languageCode?.startsWith('en')) || tracks[0];
  const capResp = await fetch(track.baseUrl + '&fmt=json3');
  if (!capResp.ok) throw new Error(`Caption HTTP ${capResp.status}`);
  const capData = await capResp.json();
  const snippets = parseEvents(capData.events);
  if (!snippets.length) throw new Error('Empty InnerTube transcript');
  return snippets;
}

async function fetchTimedText(videoId) {
  const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!resp.ok) throw new Error(`Timedtext HTTP ${resp.status}`);
  const data = await resp.json();
  const snippets = parseEvents(data.events);
  if (!snippets.length) throw new Error('Empty timedtext transcript');
  return snippets;
}
