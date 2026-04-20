/**
 * LectureDigest — YouTube Transcript Worker
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
    if (!videoId || videoId === 'null') return json({ error: 'Missing ?videoId=' }, 400, cors);

    const errors = [];

    // ── Method 1: InnerTube Android ────────────────────────────────────────
    try {
      const snippets = await fetchInnerTube(videoId);
      if (snippets.length) return json(snippets, 200, cors);
      errors.push('InnerTube: empty transcript');
    } catch (e) { errors.push(`InnerTube: ${e.message}`); }

    // ── Method 2: timedtext — list tracks first, then fetch best one ───────
    try {
      const snippets = await fetchTimedTextSmart(videoId);
      if (snippets.length) return json(snippets, 200, cors);
      errors.push('timedtext: empty transcript');
    } catch (e) { errors.push(`timedtext: ${e.message}`); }

    return json({ error: errors.join(' | ') }, 502, cors);
  },
};

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function parseXmlTranscript(xml) {
  const snippets = [];
  const regex = /<text\s+start="([^"]+)"[^>]*dur="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    const text = m[3].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/<[^>]+>/g,'').trim();
    if (text) snippets.push({ text, start: parseFloat(m[1]) });
  }
  return snippets;
}

function parseJsonTranscript(data) {
  return (data.events || []).flatMap(e => {
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
        context: { client: { clientName: 'ANDROID', clientVersion: '17.31.35', androidSdkVersion: 30, hl: 'en' } },
      }),
    }
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!tracks.length) throw new Error('No caption tracks');
  const track = tracks.find(t => t.languageCode?.startsWith('en')) || tracks[0];
  const capResp = await fetch(track.baseUrl + '&fmt=json3');
  if (!capResp.ok) throw new Error(`Caption HTTP ${capResp.status}`);
  return parseJsonTranscript(await capResp.json());
}

async function fetchTimedTextSmart(videoId) {
  // Step 1: get list of available caption tracks
  const listUrl = `https://www.youtube.com/api/timedtext?type=list&v=${videoId}`;
  let langs = ['en']; // fallback
  try {
    const listResp = await fetch(listUrl);
    const listXml = await listResp.text();
    const matches = [...listXml.matchAll(/lang_code="([^"]+)"/g)];
    if (matches.length) langs = matches.map(m => m[1]);
  } catch (_) {}

  // Step 2: try each lang in JSON3 then XML format
  for (const lang of langs) {
    for (const fmt of ['json3', '']) {
      try {
        const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}${fmt ? '&fmt=' + fmt : ''}`;
        const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!resp.ok) continue;
        if (fmt === 'json3') {
          const snippets = parseJsonTranscript(await resp.json());
          if (snippets.length) return snippets;
        } else {
          const snippets = parseXmlTranscript(await resp.text());
          if (snippets.length) return snippets;
        }
      } catch (_) {}
    }
  }
  throw new Error('All timedtext attempts failed');
}
