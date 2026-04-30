"""
LectureDigest API — FastAPI application entry point.

This is the main orchestrator that:
  1. Initializes the database
  2. Registers all route modules
  3. Serves the frontend SPA with proper routing

Route modules:
  - routes/auth.py     — Authentication (register, login, Google OAuth, password reset)
  - routes/analyze.py  — Video analysis (YouTube + file upload)
  - routes/ai_tools.py — Quiz regen, AI chat, translate, concept explainer
  - routes/sync.py     — Database sync (history, notes, bookmarks, gamification, shared notes)
  - routes/content.py  — Exercises, multi-video exam, playlist
"""

import os
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from database import init_db

# ═══════════════════════════════════════════════════════
# APP INITIALIZATION
# ═══════════════════════════════════════════════════════

app = FastAPI(title="LectureDigest API", version="1.0.0")

# Initialize SQLite database
init_db()

# CORS: read allowed origins from env, default to localhost for development
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), override=True)
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
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


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

        # Prevent caching of API responses (HTML/static assets are fine)
        path = request.url.path
        if path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["Pragma"] = "no-cache"

        return response


app.add_middleware(SecurityHeadersMiddleware)


# ═══════════════════════════════════════════════════════
# REGISTER ROUTE MODULES
# ═══════════════════════════════════════════════════════

from routes.auth import router as auth_router
from routes.analyze import router as analyze_router
from routes.ai_tools import router as ai_tools_router
from routes.sync import router as sync_router
from routes.content import router as content_router
from routes.folders import router as folders_router

app.include_router(auth_router)
app.include_router(analyze_router)
app.include_router(ai_tools_router)
app.include_router(sync_router)
app.include_router(content_router)
app.include_router(folders_router)


# ═══════════════════════════════════════════════════════
# FRONTEND SPA SERVING
# ═══════════════════════════════════════════════════════

_FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

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
        # Try to serve the actual file
        target = os.path.join(_FRONTEND_DIR, full_path)
        # Security: prevent path traversal
        target = os.path.abspath(target)
        if not target.startswith(_FRONTEND_DIR):
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

        # Fallback: serve index.html for all SPA routes
        index = os.path.join(_FRONTEND_DIR, "index.html")
        if os.path.isfile(index):
            return FileResponse(index)
        raise HTTPException(status_code=404, detail="Not found")
