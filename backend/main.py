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
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from database import init_db

# ═══════════════════════════════════════════════════════
# APP INITIALIZATION
# ═══════════════════════════════════════════════════════

app = FastAPI(title="LectureDigest API", version="1.0.0")

# Initialize SQLite database
init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ═══════════════════════════════════════════════════════
# REGISTER ROUTE MODULES
# ═══════════════════════════════════════════════════════

from routes.auth import router as auth_router
from routes.analyze import router as analyze_router
from routes.ai_tools import router as ai_tools_router
from routes.sync import router as sync_router
from routes.content import router as content_router

app.include_router(auth_router)
app.include_router(analyze_router)
app.include_router(ai_tools_router)
app.include_router(sync_router)
app.include_router(content_router)


# ═══════════════════════════════════════════════════════
# FRONTEND SPA SERVING
# ═══════════════════════════════════════════════════════

_FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

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
