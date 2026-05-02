"""
YouTube utilities — transcript fetching (InnerTube + youtube-transcript-api),
video metadata via oEmbed, and helper functions.
"""

import os
import re
import json
import base64
import tempfile
import atexit
import logging
import urllib.request

logger = logging.getLogger("youtube")

from fastapi import HTTPException
from youtube_transcript_api import YouTubeTranscriptApi


# ── YouTube Transcript API with optional cookie auth ──────────────────────────
_cookies_tmp_path: str | None = None


def _init_cookies() -> str | None:
    """Decode YOUTUBE_COOKIES_B64 env var into a temp Netscape cookies.txt file.
    Used to bypass YouTube IP blocks on cloud servers (Render, Railway, etc.)."""
    global _cookies_tmp_path
    b64 = os.getenv("YOUTUBE_COOKIES_B64", "").strip()
    if not b64:
        return None
    if _cookies_tmp_path and os.path.isfile(_cookies_tmp_path):
        return _cookies_tmp_path  # reuse across requests
    try:
        content = base64.b64decode(b64).decode("utf-8")
        tmp = tempfile.NamedTemporaryFile(
            mode="w", suffix="_yt_cookies.txt", delete=False, encoding="utf-8"
        )
        tmp.write(content)
        tmp.close()
        _cookies_tmp_path = tmp.name
        atexit.register(lambda: os.unlink(_cookies_tmp_path) if os.path.isfile(_cookies_tmp_path) else None)
        logger.info("YouTube cookies loaded from YOUTUBE_COOKIES_B64 (%d bytes)", len(content))
        return _cookies_tmp_path
    except Exception as e:
        logger.warning("Could not decode YOUTUBE_COOKIES_B64: %s", e)
        return None


def get_yt_api() -> YouTubeTranscriptApi:
    """Return a YouTubeTranscriptApi instance.
    Supports YOUTUBE_COOKIES_B64 and YOUTUBE_PROXY_URL env vars to bypass
    YouTube IP blocks on cloud servers (Render, Railway, etc.).
    """
    import httpx
    from http.cookiejar import MozillaCookieJar

    # ── 1. Load cookies ───────────────────────────────────────────────────────
    cookie_dict: dict = {}
    cookies_path = _init_cookies()
    if not cookies_path:
        direct = os.getenv("YOUTUBE_COOKIES_PATH", "").strip()
        if direct and os.path.isfile(direct):
            cookies_path = direct

    if cookies_path:
        try:
            jar = MozillaCookieJar(cookies_path)
            jar.load(ignore_discard=True, ignore_expires=True)
            cookie_dict = {c.name: c.value for c in jar}
            logger.info("Loaded %d cookies from %s", len(cookie_dict), cookies_path)
        except Exception as e:
            logger.warning("Cookie load failed: %s", e)

    # ── 2. Load proxy ─────────────────────────────────────────────────────────
    proxy_url = os.getenv("YOUTUBE_PROXY_URL", "").strip()
    # Format: http://username:password@host:port

    # ── 3. Build httpx client if any auth configured ──────────────────────────
    if cookie_dict or proxy_url:
        client_kwargs: dict = {}
        if cookie_dict:
            client_kwargs["cookies"] = cookie_dict
        if proxy_url:
            client_kwargs["proxy"] = proxy_url
            logger.info("Using proxy: %s", proxy_url.split('@')[-1])  # hide credentials
        try:
            client = httpx.Client(**client_kwargs)
            return YouTubeTranscriptApi(http_client=client)
        except Exception as e:
            logger.warning("Could not create custom http_client: %s, using default", e)

    return YouTubeTranscriptApi()


def extract_video_id(url: str) -> str:
    """Extract YouTube video ID from various URL formats."""
    patterns = [
        r'(?:youtube\.com/watch\?v=)([a-zA-Z0-9_-]{11})',
        r'(?:youtu\.be/)([a-zA-Z0-9_-]{11})',
        r'(?:youtube\.com/embed/)([a-zA-Z0-9_-]{11})',
        r'(?:youtube\.com/v/)([a-zA-Z0-9_-]{11})',
        r'(?:youtube\.com/shorts/)([a-zA-Z0-9_-]{11})',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    if re.match(r'^[a-zA-Z0-9_-]{11}$', url.strip()):
        return url.strip()
    raise ValueError("Invalid YouTube URL or video ID")


def format_seconds(seconds: float) -> str:
    """Convert seconds to HH:MM:SS or MM:SS format."""
    seconds = int(seconds)
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def get_video_info(video_id: str) -> dict:
    """Get video title and author from YouTube oEmbed (no API key needed)."""
    try:
        url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=8) as response:
            data = json.loads(response.read())
            return {
                "title": data.get("title", ""),
                "author": data.get("author_name", ""),
                "thumbnail": f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg",
            }
    except Exception:
        return {
            "title": "",
            "author": "",
            "thumbnail": f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg",
        }


def _snippets_to_list(fetched) -> list:
    """Convert FetchedTranscript (v1.x) or raw list (v0.x) to uniform list of dicts."""
    result = []
    for item in fetched:
        if isinstance(item, dict):
            result.append({"text": item.get("text", ""), "start": item.get("start", 0)})
        else:
            # TranscriptSnippet object (v1.x)
            result.append({"text": getattr(item, "text", ""), "start": getattr(item, "start", 0)})
    return result


def fetch_transcript_innertube(video_id: str) -> list:
    """Fetch transcript via YouTube InnerTube API.
    Tries multiple clients in order of reliability.
    """
    innertube_url = "https://www.youtube.com/youtubei/v1/player"

    # Try multiple InnerTube clients — TVHTML5 and WEB are most stable
    clients = [
        {
            "name": "TVHTML5",
            "payload": {
                "videoId": video_id,
                "context": {"client": {
                    "clientName": "TVHTML5",
                    "clientVersion": "7.20230405.08.01",
                    "hl": "en", "gl": "US",
                }},
            },
            "headers": {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.0) AppleWebKit/537.36",
                "X-YouTube-Client-Name": "7",
                "X-YouTube-Client-Version": "7.20230405.08.01",
            },
        },
        {
            "name": "WEB",
            "payload": {
                "videoId": video_id,
                "context": {"client": {
                    "clientName": "WEB",
                    "clientVersion": "2.20240101.00.00",
                    "hl": "en", "gl": "US",
                }},
            },
            "headers": {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "X-YouTube-Client-Name": "1",
                "X-YouTube-Client-Version": "2.20240101.00.00",
            },
        },
    ]

    last_err = None
    for client in clients:
        try:
            payload = json.dumps(client["payload"]).encode()
            req = urllib.request.Request(innertube_url, data=payload, headers=client["headers"], method="POST")
            with urllib.request.urlopen(req, timeout=15) as resp:
                player_data = json.loads(resp.read())

            tracks = (
                player_data
                .get("captions", {})
                .get("playerCaptionsTracklistRenderer", {})
                .get("captionTracks", [])
            )
            if not tracks:
                raise ValueError(f"No caption tracks ({client['name']})")

            # Prefer non-auto, then any track
            manual = [t for t in tracks if not t.get("kind")]
            track = manual[0] if manual else tracks[0]
            base_url = track.get("baseUrl", "")
            if not base_url:
                raise ValueError("Caption track has no baseUrl")

            caption_url = base_url + "&fmt=json3"
            req2 = urllib.request.Request(caption_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req2, timeout=15) as resp2:
                cap_data = json.loads(resp2.read())

            snippets = []
            for event in cap_data.get("events", []):
                if "segs" not in event:
                    continue
                start_sec = event.get("tStartMs", 0) / 1000.0
                text = "".join(seg.get("utf8", "") for seg in event["segs"]).strip()
                if text:
                    snippets.append({"text": text, "start": start_sec})

            if not snippets:
                raise ValueError("Transcript is empty")

            logger.info("InnerTube (%s): fetched %d segments", client['name'], len(snippets))
            return snippets

        except Exception as e:
            logger.warning("InnerTube %s failed: %s", client['name'], e)
            last_err = e
            continue

    raise ValueError(f"All InnerTube clients failed. Last: {last_err}")


def get_transcript(video_id: str, language: str = "en") -> list:
    """Fetch transcript: InnerTube first (cloud-safe), youtube-transcript-api as fallback."""

    # ── Primary: InnerTube Android client ─────────────────────────────────────
    try:
        return fetch_transcript_innertube(video_id)
    except Exception as e:
        logger.info("InnerTube failed (%s), trying youtube-transcript-api...", e)

    # ── Fallback: youtube-transcript-api ──────────────────────────────────────
    try:
        api = get_yt_api()
        transcript_list = api.list(video_id)
    except Exception as e:
        raise HTTPException(
            status_code=404,
            detail=f"Could not fetch transcript. This video may not have captions enabled. ({str(e)})",
        )

    # Build priority list: requested lang > English > any available
    lang_priority = []
    if language and language != "en":
        lang_priority.append(language)
    lang_priority.append("en")

    # Try manually created then auto-generated for each language
    for lang in lang_priority:
        for finder in [
            lambda l=lang: transcript_list.find_manually_created_transcript([l]),
            lambda l=lang: transcript_list.find_generated_transcript([l]),
        ]:
            try:
                return _snippets_to_list(finder().fetch())
            except Exception:
                continue

    # Last resort: grab whichever track is available
    for transcript in transcript_list:
        try:
            result = _snippets_to_list(transcript.fetch())
            if result:
                logger.info("Using fallback track: %s", transcript.language_code)
                return result
        except Exception:
            continue

    raise HTTPException(
        status_code=404,
        detail="No transcript found. This video may not have captions — try another video.",
    )


def extract_playlist_id(url: str) -> str:
    """Extract playlist ID from a YouTube URL containing list= parameter."""
    match = re.search(r'[?&]list=([a-zA-Z0-9_-]+)', url)
    if match:
        return match.group(1)
    raise ValueError("Invalid YouTube playlist URL")


def fetch_playlist_videos(playlist_id: str) -> dict:
    """Fetch playlist metadata and video list by parsing YouTube playlist page."""
    page_url = f"https://www.youtube.com/playlist?list={playlist_id}"
    req = urllib.request.Request(page_url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    })

    with urllib.request.urlopen(req, timeout=20) as resp:
        html = resp.read().decode("utf-8", errors="replace")

    # Extract ytInitialData JSON blob embedded in the page
    match = re.search(r'var\s+ytInitialData\s*=\s*(\{.+?\});\s*</', html, re.DOTALL)
    if not match:
        raise ValueError("Could not parse playlist page")

    data = json.loads(match.group(1))

    # ── Playlist title ────────────────────────────────────────────────
    title = ""
    try:
        title = data["metadata"]["playlistMetadataRenderer"]["title"]
    except (KeyError, TypeError):
        pass

    # ── Channel / author ──────────────────────────────────────────────
    author = ""
    try:
        sidebar = data["sidebar"]["playlistSidebarRenderer"]["items"]
        author = (sidebar[1]["playlistSidebarSecondaryInfoRenderer"]
                  ["videoOwner"]["videoOwnerRenderer"]["title"]["runs"][0]["text"])
    except Exception:
        pass

    # ── Video list ────────────────────────────────────────────────────
    videos = []
    try:
        tabs = data["contents"]["twoColumnBrowseResultsRenderer"]["tabs"]
        section = tabs[0]["tabRenderer"]["content"]["sectionListRenderer"]["contents"][0]
        items = (section["itemSectionRenderer"]["contents"][0]
                 ["playlistVideoListRenderer"]["contents"])

        for item in items:
            renderer = item.get("playlistVideoRenderer")
            if not renderer:
                continue
            vid = renderer.get("videoId", "")
            if not vid:
                continue

            vtitle = ""
            try:
                vtitle = renderer["title"]["runs"][0]["text"]
            except Exception:
                vtitle = renderer.get("title", {}).get("simpleText", "")

            duration = ""
            try:
                duration = renderer["lengthText"]["simpleText"]
            except Exception:
                pass

            videos.append({
                "video_id": vid,
                "title": vtitle,
                "duration": duration,
                "thumbnail": f"https://img.youtube.com/vi/{vid}/mqdefault.jpg",
                "index": len(videos) + 1,
            })
    except (KeyError, TypeError, IndexError) as e:
        raise ValueError(f"Could not extract videos: {e}")

    if not videos:
        raise ValueError("Playlist is empty or private")

    return {
        "playlist_id": playlist_id,
        "title": title or f"Playlist {playlist_id}",
        "author": author,
        "video_count": len(videos),
        "videos": videos,
    }
