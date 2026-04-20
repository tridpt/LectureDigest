/**
 * LectureDigest — YouTube InnerTube CORS Proxy
 * Cloudflare Worker (Free tier: 100,000 req/day)
 *
 * Deploy steps:
 * 1. Go to https://dash.cloudflare.com/workers
 * 2. Create Application → Create Worker
 * 3. Paste this entire file into the editor
 * 4. Click "Save and Deploy"
 * 5. Copy your worker URL (e.g. https://yt-proxy.yourname.workers.dev)
 * 6. In frontend/app.js, add it to CORS_PROXIES:
 *      url => `https://yt-proxy.yourname.workers.dev/?url=${encodeURIComponent(url)}`
 */

export default {
  async fetch(request) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Get target URL from ?url= query param
    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');
    if (!target) {
      return new Response('Missing ?url= parameter', { status: 400, headers: corsHeaders });
    }

    // Forward request to YouTube with Android client headers
    const ytResponse = await fetch(target, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip',
        'X-YouTube-Client-Name': '3',
        'X-YouTube-Client-Version': '17.31.35',
        'Origin': 'https://www.youtube.com',
      },
      body: request.method !== 'GET' ? request.body : undefined,
    });

    const body = await ytResponse.arrayBuffer();
    return new Response(body, {
      status: ytResponse.status,
      headers: {
        ...corsHeaders,
        'Content-Type': ytResponse.headers.get('Content-Type') || 'application/json',
      },
    });
  },
};
