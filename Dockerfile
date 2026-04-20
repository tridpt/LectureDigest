# ════════════════════════════════════════════════
#  LectureDigest — Production Dockerfile
#  Single container: FastAPI backend + Frontend
# ════════════════════════════════════════════════
FROM python:3.13-slim

# Prevent Python from writing .pyc files and buffering stdout
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install minimal system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Install Python dependencies ──────────────────
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# ── Copy application files ────────────────────────
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# ── Health check ──────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8000}/api/health || exit 1

# ── Expose default port ───────────────────────────
EXPOSE 8000

# ── Start server ──────────────────────────────────
# Uses $PORT env var for Render/Railway/Fly.io compatibility,
# falls back to 8000 for local Docker.
WORKDIR /app/backend
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
