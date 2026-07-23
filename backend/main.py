"""
LectureDigest API — FastAPI application entry point.

This is the main orchestrator that:
  1. Validates environment configuration
  2. Initializes the database
  3. Registers all route modules
  4. Serves the frontend SPA with proper routing

Route modules:
  - routes/auth.py     — Authentication (register, login, Google OAuth, password reset)
  - routes/analyze.py  — Video analysis (YouTube + file upload)
  - routes/ai_tools.py — Quiz regen, AI chat, translate, concept explainer
  - routes/sync.py     — Database sync (history, notes, bookmarks, gamification, shared notes)
  - routes/content.py  — Exercises, multi-video exam, playlist
  - routes/folders.py  — Video folder organization
"""

import os
import sys
import json
import asyncio
from contextlib import asynccontextmanager
import time as _startup_time
import logging
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from database import init_db, db_create_backup

# ═══════════════════════════════════════════════════════
# STRUCTURED LOGGING
# ═══════════════════════════════════════════════════════

_LOG_FORMAT = "[%(asctime)s] %(levelname)-7s %(name)s — %(message)s"
_LOG_DATE_FORMAT = "%H:%M:%S"

logging.basicConfig(
    level=logging.INFO,
    format=_LOG_FORMAT,
    datefmt=_LOG_DATE_FORMAT,
    handlers=[logging.StreamHandler(sys.stdout)],
)

# Reduce noise from third-party libraries
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

logger = logging.getLogger("lecturedigest")
logger.setLevel(logging.INFO)


# ═══════════════════════════════════════════════════════
# ENVIRONMENT VALIDATION
# ═══════════════════════════════════════════════════════

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), override=True)

def _validate_environment():
    """Check required and optional env vars at startup. Warn early instead of failing later."""
    issues = []
    warnings = []

    # ── Required ──
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not gemini_key:
        issues.append("GEMINI_API_KEY is not set — video analysis and all AI features will fail!")
    elif len(gemini_key) < 10:
        warnings.append("GEMINI_API_KEY looks too short — double-check your key")

    # ── Optional but important ──
    jwt_secret = os.getenv("JWT_SECRET", "").strip()
    if not jwt_secret:
        warnings.append("JWT_SECRET not set — using default. Set a strong random secret for production!")

    google_client = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    if not google_client:
        warnings.append("GOOGLE_CLIENT_ID not set — Google OAuth sign-in will be disabled")

    # SMTP for password reset
    smtp_host = os.getenv("SMTP_HOST", "").strip()
    smtp_user = os.getenv("SMTP_USER", "").strip()
    if not smtp_host or not smtp_user:
        warnings.append("SMTP not configured — password reset links will only print to console")

    # ── Report ──
    if issues:
        logger.error("=" * 60)
        logger.error("⚠️  CRITICAL CONFIGURATION ISSUES:")
        for issue in issues:
            logger.error(f"   ❌ {issue}")
        logger.error("=" * 60)

    if warnings:
        logger.warning("Configuration warnings:")
        for w in warnings:
            logger.warning(f"   ⚡ {w}")

    if not issues and not warnings:
        logger.info("✅ All environment variables validated")

    return len(issues) == 0

_env_ok = _validate_environment()


# ═══════════════════════════════════════════════════════
# APP INITIALIZATION
# ═══════════════════════════════════════════════════════

_startup_ts = _startup_time.time()


# ── Self-ping to keep Render free tier awake ──
import httpx as _httpx

async def _keep_alive_ping():
    """Ping own health endpoint every 10 minutes to prevent Render sleep."""
    render_url = os.getenv("RENDER_EXTERNAL_URL", "").strip()
    if not render_url:
        return  # Only run on Render (not local)
    await asyncio.sleep(60)  # Wait 1 min after startup
    while True:
        try:
            async with _httpx.AsyncClient() as client:
                await client.get(f"{render_url}/health", timeout=10)
        except Exception as e:
            logger.debug("Keep-alive ping failed: %s", e)
        await asyncio.sleep(600)  # Every 10 minutes


@asynccontextmanager
async def lifespan(app):
    """FastAPI lifespan: startup and shutdown events."""
    # ── Startup ──
    init_db()
    db_create_backup()

    # Keep references to background tasks so we can cancel them cleanly on
    # shutdown — otherwise they leak and asyncio warns about pending tasks.
    background_tasks: list[asyncio.Task] = []

    if os.getenv("RENDER_EXTERNAL_URL"):
        background_tasks.append(asyncio.create_task(_keep_alive_ping()))
    # Daily SRS email reminder sweep (no-op for users who haven't opted in)
    try:
        from routes.srs_reminder import srs_reminder_loop
        background_tasks.append(asyncio.create_task(srs_reminder_loop()))
    except Exception as _e:
        logger.warning("Could not start SRS reminder loop: %s", _e)
    logger.info(f"🚀 LectureDigest API ready (startup: {_startup_time.time() - _startup_ts:.2f}s)")
    yield
    # ── Shutdown ──
    logger.info("LectureDigest API shutting down")
    for task in background_tasks:
        task.cancel()
    # Wait for cancellations to settle; swallow the resulting CancelledErrors.
    if background_tasks:
        await asyncio.gather(*background_tasks, return_exceptions=True)


app = FastAPI(title="LectureDigest API", version="1.0.0", lifespan=lifespan)

# CORS: read allowed origins from env, default to localhost for development
_allowed_origins = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()
] or [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS", "PUT", "DELETE"],
    allow_headers=["*"],
)


# ── Global Exception Handler ─────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Catch all unhandled exceptions and return JSON instead of plain text 500.

    The full traceback is logged server-side with a correlation id, but the
    client only ever receives a generic message so we never leak internal
    paths, SQL, or stack details.
    """
    import traceback
    import uuid
    error_id = uuid.uuid4().hex[:12]
    logger.error("Unhandled error [%s]: %s\n%s", error_id, str(exc), traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error_id": error_id},
    )


# ── Rate Limiting Middleware (in-memory) ─────────────────────────
from collections import defaultdict
import time as _rl_time
from routes.client_ip import get_client_ip

_rate_limit_store = defaultdict(list)  # {ip: [timestamps]} — fast in-memory
_RATE_LIMIT_MAX = 60  # max requests per window
_RATE_LIMIT_WINDOW = 60  # window in seconds
_rl_last_sweep = 0.0  # last time we purged stale IP buckets
_RL_SWEEP_INTERVAL = 300  # sweep at most every 5 minutes


def _sweep_rate_limit_store(now: float):
    """Drop IP buckets whose timestamps are all outside the window.

    Without this, every IP ever seen leaves a permanent (eventually empty)
    entry in the dict — a slow memory leak on long-running deploys.
    """
    stale = [
        key for key, hits in _rate_limit_store.items()
        if not hits or hits[-1] < now - _RATE_LIMIT_WINDOW
    ]
    for key in stale:
        del _rate_limit_store[key]


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Only rate-limit API calls
        if not request.url.path.startswith("/api/"):
            return await call_next(request)

        # Skip health check
        if request.url.path == "/health":
            return await call_next(request)

        # Resolve real client IP (respects TRUST_PROXY behind a reverse proxy);
        # avoids lumping every user behind the proxy into a single shared bucket.
        ip = get_client_ip(request)
        now = _rl_time.time()

        # Periodically purge stale IP buckets to keep the dict bounded.
        global _rl_last_sweep
        if now - _rl_last_sweep > _RL_SWEEP_INTERVAL:
            _sweep_rate_limit_store(now)
            _rl_last_sweep = now

        # Clean old entries
        _rate_limit_store[ip] = [t for t in _rate_limit_store[ip] if now - t < _RATE_LIMIT_WINDOW]

        if len(_rate_limit_store[ip]) >= _RATE_LIMIT_MAX:
            return JSONResponse(
                status_code=429,
                content={"detail": "Quá nhiều yêu cầu. Vui lòng thử lại sau."},
                headers={"Retry-After": str(_RATE_LIMIT_WINDOW)}
            )

        _rate_limit_store[ip].append(now)
        return await call_next(request)

app.add_middleware(RateLimitMiddleware)


# Content-Security-Policy — built once at import. Whitelists only the external
# origins the app actually uses (YouTube player, Google Sign-In, D3 CDN, Google
# Fonts, image/avatar hosts, and the transcript Cloudflare Worker).
_CSP_POLICY = "; ".join([
    "default-src 'self'",
    # 'unsafe-inline' required for inline handlers/scripts (see note above).
    # YouTube + GSI host the player and sign-in libraries; jsdelivr serves D3.
    "script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com "
    "https://accounts.google.com https://cdn.jsdelivr.net",
    # Inline styles + Google Fonts stylesheet.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    # Thumbnails, Google avatars, base64 data URLs (uploaded avatars), blobs.
    "img-src 'self' data: blob: https://img.youtube.com https://i.ytimg.com "
    "https://*.ggpht.com https://*.googleusercontent.com",
    # XHR/fetch targets: same-origin API + the transcript worker.
    "connect-src 'self' https://*.workers.dev https://accounts.google.com",
    # Embedded players + Google Sign-In iframe.
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://accounts.google.com",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
])


# ── Security Headers Middleware ──────────────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Injects standard HTTP security headers on every response to mitigate
    clickjacking, MIME sniffing, and other common web vulnerabilities.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        # Prevent MIME type sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"

        # Clickjacking protection — allow YouTube iframes via SAMEORIGIN
        response.headers["X-Frame-Options"] = "SAMEORIGIN"

        # Control referrer information sent with requests
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Disable unused browser features/APIs
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(), payment=()"
        )

        # Legacy XSS protection for older browsers
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # Content-Security-Policy — defense-in-depth against XSS and data
        # exfiltration. NOTE: 'unsafe-inline' is required in script-src because
        # the frontend relies heavily on inline onclick handlers and inline
        # <script> blocks; removing it would need a full frontend refactor.
        # Even with that caveat, CSP still blocks loading scripts from
        # non-whitelisted origins, restricts where data can be sent
        # (connect-src), forbids plugins (object-src), and hardens framing.
        response.headers["Content-Security-Policy"] = _CSP_POLICY

        # Prevent caching of API responses (HTML/static assets are fine)
        path = request.url.path
        if path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["Pragma"] = "no-cache"

        # JS/CSS: revalidate every load so code updates apply immediately.
        # (Avoids users getting stuck on stale app code after a deploy.)
        if path.endswith(('.css', '.js')):
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
        elif path.endswith(('.png', '.jpg', '.svg', '.ico', '.webp', '.woff2')):
            response.headers["Cache-Control"] = "public, max-age=2592000"  # 30 days

        return response


app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=500)


# ── Request Body Size Limit ─────────────────────────────
_MAX_BODY_BYTES = 10 * 1024 * 1024       # 10 MB for JSON API payloads
_MAX_UPLOAD_BYTES = 200 * 1024 * 1024    # 200 MB for file uploads


class _BodyTooLarge(Exception):
    """Raised internally when a streaming request body exceeds its limit."""


async def _send_json_response(send, status: int, payload: dict):
    body = json.dumps(payload).encode()
    await send({
        "type": "http.response.start",
        "status": status,
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode()),
        ],
    })
    await send({"type": "http.response.body", "body": body})


async def _send_too_large(send, limit: int):
    limit_mb = limit // (1024 * 1024)
    await _send_json_response(
        send, 413, {"detail": f"Request body too large (max {limit_mb}MB)"}
    )


class BodySizeLimitMiddleware:
    """Reject oversized request bodies to prevent abuse and OOM.

    Pure-ASGI (not BaseHTTPMiddleware) so it can enforce the cap *while the body
    streams in*, not just from the declared ``Content-Length``. A chunked or
    dishonest request that omits/understates ``Content-Length`` is still counted
    byte-by-byte and aborted the moment it crosses the limit — closing the
    memory-exhaustion bypass that a header-only check leaves open.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        limit = _MAX_UPLOAD_BYTES if path == "/api/analyze-file" else _MAX_BODY_BYTES

        # Fast path: reject up front when the declared size already exceeds the cap.
        headers = dict(scope.get("headers") or [])
        content_length = headers.get(b"content-length")
        if content_length is not None:
            try:
                if int(content_length) > limit:
                    await _send_too_large(send, limit)
                    return
            except ValueError:
                await _send_json_response(send, 400, {"detail": "Invalid Content-Length"})
                return

        received = 0
        response_started = False

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise _BodyTooLarge()
            return message

        async def send_wrapper(message):
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, send_wrapper)
        except _BodyTooLarge:
            # Only safe to emit our own response if the app hasn't started one.
            if not response_started:
                await _send_too_large(send, limit)
            else:
                raise

app.add_middleware(BodySizeLimitMiddleware)


# ═══════════════════════════════════════════════════════
# REGISTER ROUTE MODULES
# ═══════════════════════════════════════════════════════

from routes.auth import router as auth_router
from routes.analyze import router as analyze_router
from routes.ai_tools import router as ai_tools_router
from routes.sync import router as sync_router
from routes.content import router as content_router
from routes.folders import router as folders_router
from routes.study_plan import router as study_plan_router
from routes.study_rooms import router as study_rooms_router
from routes.notifications import router as notifications_router
from routes.chat_rooms import router as chat_rooms_router
from routes.english import router as english_router
from routes.srs_reminder import router as srs_reminder_router
from routes.admin import router as admin_router

app.include_router(auth_router)
app.include_router(analyze_router)
app.include_router(ai_tools_router)
app.include_router(sync_router)
app.include_router(content_router)
app.include_router(folders_router)
app.include_router(study_plan_router)
app.include_router(study_rooms_router)
app.include_router(notifications_router)
app.include_router(chat_rooms_router)
app.include_router(english_router)
app.include_router(srs_reminder_router)
app.include_router(admin_router)


# ═══════════════════════════════════════════════════════
# HEALTH CHECK & MONITORING
# ═══════════════════════════════════════════════════════

@app.get("/health", tags=["monitoring"])
async def health_check():
    """Health check endpoint for deployment monitoring."""
    import sqlite3
    from database import DB_PATH

    uptime = _startup_time.time() - _startup_ts

    # Check DB connectivity
    db_ok = False
    try:
        conn = sqlite3.connect(DB_PATH, timeout=2)
        conn.execute("SELECT 1").fetchone()
        conn.close()
        db_ok = True
    except Exception:
        pass

    # Check Gemini key presence
    gemini_ok = bool(os.getenv("GEMINI_API_KEY", "").strip())

    status = "healthy" if (db_ok and gemini_ok) else "degraded"

    return JSONResponse({
        "status": status,
        "uptime_seconds": round(uptime, 1),
        "database": "ok" if db_ok else "error",
        "gemini_api": "configured" if gemini_ok else "missing",
        "environment": "ok" if _env_ok else "issues",
    })


# ═══════════════════════════════════════════════════════
# SERVE UPLOADED FILES (chat images, etc.)
# ═══════════════════════════════════════════════════════

_UPLOADS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "uploads"))


def _safe_join(base_dir: str, relative_path: str):
    """Resolve *relative_path* inside *base_dir*, blocking path traversal.

    Returns the absolute target path only if it is genuinely contained within
    *base_dir*. Uses ``Path.is_relative_to`` (via ``os.path.commonpath``) rather
    than a naive ``startswith`` check, which is vulnerable to prefix confusion
    (e.g. ``/app/uploads_evil`` starts with ``/app/uploads``). Returns ``None``
    when the path escapes the base directory.
    """
    base = os.path.abspath(base_dir)
    target = os.path.abspath(os.path.join(base, relative_path))
    try:
        if os.path.commonpath([base, target]) != base:
            return None
    except ValueError:
        # Different drives on Windows, etc. — treat as escape.
        return None
    return target


@app.get("/uploads/{file_path:path}", include_in_schema=False)
async def serve_upload(file_path: str):
    """Serve uploaded files (chat images)."""
    target = _safe_join(_UPLOADS_DIR, file_path)
    if target is None:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(target)


# ═══════════════════════════════════════════════════════
# FRONTEND SPA SERVING
# ═══════════════════════════════════════════════════════

_FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

# ── Jinja2 Template Engine for index.html partials ──
from jinja2 import Environment, FileSystemLoader
import time as _time2

# auto_reload re-stats template files on every render — handy in dev, wasteful
# in production. Default to off when running on a known cloud host, else on.
_JINJA_AUTORELOAD = os.getenv(
    "JINJA_AUTO_RELOAD",
    "false" if os.getenv("RENDER_EXTERNAL_URL") else "true",
).strip().lower() in ("1", "true", "yes", "on")

_jinja_env = Environment(
    loader=FileSystemLoader(_FRONTEND_DIR),
    auto_reload=_JINJA_AUTORELOAD,
)

_index_cache = {"html": None, "ts": 0}

def _render_index():
    """Render index.html with Jinja2 includes. Cached for 60s in dev."""
    now = _time2.time()
    if _index_cache["html"] and now - _index_cache["ts"] < 60:
        return _index_cache["html"]
    template = _jinja_env.get_template("index.html")
    _index_cache["html"] = template.render()
    _index_cache["ts"] = now
    return _index_cache["html"]


# ── Dynamic Service Worker with auto-versioned cache ──
import hashlib
import time as _time

_sw_cache = {"hash": None, "content": None, "ts": 0}

def _compute_frontend_hash():
    """Compute a short hash from all CSS/JS file modification times."""
    mtimes = []
    for root, dirs, files in os.walk(_FRONTEND_DIR):
        for f in sorted(files):
            if f.endswith((".css", ".js", ".html")):
                fpath = os.path.join(root, f)
                try:
                    mtimes.append(f"{f}:{os.path.getmtime(fpath):.0f}")
                except OSError:
                    pass
    combined = "|".join(mtimes)
    return hashlib.md5(combined.encode()).hexdigest()[:10]


@app.get("/sw.js", include_in_schema=False)
async def serve_service_worker():
    """Serve sw.js with auto-computed cache version based on file hashes."""
    now = _time.time()
    # Recompute hash at most every 60 seconds
    if now - _sw_cache["ts"] > 60 or _sw_cache["content"] is None:
        version_hash = _compute_frontend_hash()
        cache_name = f"lecturedigest-{version_hash}"
        sw_path = os.path.join(_FRONTEND_DIR, "sw.js")
        try:
            with open(sw_path, "r", encoding="utf-8") as f:
                sw_template = f.read()
            _sw_cache["content"] = sw_template.replace("%%CACHE_VERSION%%", cache_name)
            _sw_cache["hash"] = version_hash
            _sw_cache["ts"] = now
        except FileNotFoundError:
            from fastapi.responses import PlainTextResponse
            return PlainTextResponse("// sw.js not found", status_code=404)

    from fastapi.responses import Response
    return Response(
        content=_sw_cache["content"],
        media_type="application/javascript",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Service-Worker-Allowed": "/",
        },
    )


# MIME type map for static assets
_MIME_TYPES = {
    ".css": "text/css",
    ".js":  "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".html": "text/html",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
}

if os.path.isdir(_FRONTEND_DIR):
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_catch_all(full_path: str):
        """
        SPA routing: serve the real file if it exists (css/js/images),
        otherwise fall back to index.html so client-side routing works.
        """
        # Uploaded files are handled by serve_upload route
        if full_path.startswith("uploads/"):
            target = _safe_join(_UPLOADS_DIR, full_path[8:])
            if target is None:
                raise HTTPException(status_code=403, detail="Forbidden")
            if os.path.isfile(target):
                return FileResponse(target)
            raise HTTPException(status_code=404, detail="Not found")

        # Try to serve the actual file
        # Security: prevent path traversal
        target = _safe_join(_FRONTEND_DIR, full_path)
        if target is None:
            raise HTTPException(status_code=403, detail="Forbidden")
        if os.path.isfile(target):
            ext = os.path.splitext(target)[1].lower()
            mime = _MIME_TYPES.get(ext)
            if mime:
                return FileResponse(target, media_type=mime)
            return FileResponse(target)

        # Dedicated pages for specific routes
        if full_path.rstrip("/") == "reset-password":
            reset_page = os.path.join(_FRONTEND_DIR, "reset-password.html")
            if os.path.isfile(reset_page):
                return FileResponse(reset_page, media_type="text/html")

        if full_path.rstrip("/") == "shared-notes":
            shared_page = os.path.join(_FRONTEND_DIR, "shared-notes.html")
            if os.path.isfile(shared_page):
                return FileResponse(shared_page, media_type="text/html")

        # Fallback: render index.html with Jinja2 partials
        from fastapi.responses import HTMLResponse
        try:
            html = _render_index()
            return HTMLResponse(content=html)
        except Exception:
            raise HTTPException(status_code=404, detail="Not found")
