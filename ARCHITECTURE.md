# LectureDigest — Architecture & Technical Reference

Technical documentation for developers working on LectureDigest. For features
and setup, see [README.md](README.md); for security decisions, see
[SECURITY.md](SECURITY.md).

## Overview

LectureDigest is a single-container web app: a **FastAPI** backend serves both
the JSON API (`/api/*`) and a **vanilla-JS single-page frontend** (no build
step, no framework). AI work is delegated to **Google Gemini**; transcripts come
from `youtube-transcript-api` with a Cloudflare Worker fallback for cloud hosts.

```
Browser (vanilla JS SPA)
   │  fetch /api/*
   ▼
FastAPI (main.py)
   ├─ middleware: rate limit → security headers (CSP) → gzip → body-size limit
   ├─ routes/*  (auth, analyze, ai_tools, sync, content, folders,
   │            study_rooms, chat_rooms, english, notifications,
   │            study_plan, srs_reminder, admin)
   ├─ gemini_client.py  →  Google Gemini API
   ├─ youtube.py        →  transcript / playlist fetch
   └─ database.py → db/* →  SQLite (local) or PostgreSQL (prod)
```

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.13, FastAPI, Uvicorn |
| AI | Google Gemini (async client, auto-fallback) |
| Database | SQLite (local/dev) or PostgreSQL (prod) — same schema |
| Auth | JWT (PyJWT) + bcrypt + Google OAuth 2.0 |
| Frontend | Vanilla HTML/CSS/JS, Jinja2 partials, D3.js (graphs) |
| Tests | pytest (backend), Vitest + jsdom (frontend) |
| Lint | ruff |
| CI | GitHub Actions (backend + frontend) |
| Deploy | Docker; Render/Railway/Fly.io |

## Repository Layout

```
LectureDigest/
├── backend/
│   ├── main.py              # App entry: env validation, middleware, routing, SPA serving
│   ├── database.py          # Re-export shim → db/ package
│   ├── db/                  # connection, schema, and per-domain CRUD modules
│   ├── routes/              # API route modules (one per domain)
│   ├── gemini_client.py     # Gemini API wrapper (sync + async)
│   ├── youtube.py           # Transcript + playlist extraction
│   ├── email_sender.py      # Resend HTTP API / SMTP
│   ├── tests/               # pytest suite + conftest fixtures
│   └── requirements.txt
├── frontend/
│   ├── index.html           # SPA shell (Jinja2 {% include %} partials)
│   ├── partials/            # HTML fragments composed into index.html
│   ├── js/                  # Feature modules (global functions, lazy-loaded)
│   ├── css/                 # Modular stylesheets
│   ├── tests/               # Vitest tests (XSS escapers, markdown builder)
│   └── sw.js                # Service worker (offline cache)
├── cloudflare-worker/       # Optional transcript-fetch worker
├── Dockerfile, docker-compose.yml, render.yaml
└── .github/workflows/       # backend-tests.yml, frontend-tests.yml
```

## Backend

### Request pipeline (middleware order)

Registered in `main.py`, applied outermost-first:

1. **RateLimitMiddleware** — per-IP limit on `/api/*` (60 req/60s), skips `/health`. Resolves client IP via `get_client_ip` (honours `TRUST_PROXY`).
2. **SecurityHeadersMiddleware** — sets CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and cache-control.
3. **GZipMiddleware** — compresses responses ≥ 500 bytes.
4. **BodySizeLimitMiddleware** — caps JSON at 10 MB, uploads at 200 MB.

### Route modules

| Module | Prefix | Responsibility |
|---|---|---|
| `auth.py` | `/api/auth` | Register, login, JWT, Google OAuth, profile, password reset, account delete, GDPR export, leaderboard |
| `analyze.py` | `/api` | `analyze` (YouTube), `upload-analyze` (file) |
| `ai_tools.py` | `/api` | quiz regen, chat, translate, explain-concept, auto-notes, smart-bookmark, quiz-analysis |
| `content.py` | `/api` | exercises, multi-exam, playlist |
| `sync.py` | `/api` | history/notes/bookmarks/gamification sync, full `/db/sync`, shared notes |
| `folders.py` | `/api/folders` | Folder CRUD + video membership |
| `study_rooms.py` | `/api/rooms` | Collaborative rooms: members, videos, comments, progress |
| `chat_rooms.py` | `/api/chat-rooms` | Real-time chat: messages, moderation, presence, pins |
| `english.py` | `/api/english` | Vocabulary learning + SM-2 review |
| `study_plan.py` | `/api` | AI study-plan generation |
| `srs_reminder.py` | `/api/srs-reminder` | Email reminder preference + daily sweep |
| `notifications.py` | `/api/notifications` | In-app notifications |
| `admin.py` | `/api/admin` | Stats, user management, email blocklist (gated by `ADMIN_EMAILS`) |

### AI & transcripts

- `gemini_client.py` exposes `call_gemini` (sync) and `async_call_gemini`. AI routes parse JSON from the model, stripping ```` ```json ```` fences, and return HTTP 500 on malformed responses.
- `youtube.py` extracts video/playlist IDs and fetches transcripts; on cloud hosts blocked by YouTube, the frontend falls back to a Cloudflare Worker.
- `analysis_cache` table caches analysis by `(video_id, language)` to avoid re-spending tokens.

## Database

`database.py` is a compatibility shim re-exporting the `db/` package. `db/schema.py`
builds the same schema for both SQLite and PostgreSQL (chosen via `USE_POSTGRES`).

Key tables:

| Table | Purpose |
|---|---|
| `users` | Accounts (email, bcrypt hash, google_id, avatar) |
| `history` | Analyzed videos (per user; `user_id IS NULL` = anonymous) |
| `notes`, `bookmarks` | Per-video study data, scoped by `user_id` |
| `gamification`, `user_gamification` | Streaks, badges, stats |
| `user_kv_store` | Generic per-user KV (exam history, SRS data, tags, flashcards) |
| `folders`, `folder_videos` | Video organization |
| `shared_notes` | Public read-only share links |
| `analysis_cache` | Cached AI analysis by video+language |
| `password_reset_tokens`, `login_attempts`, `blocked_emails` | Auth security |

**Anonymous vs authenticated:** per-user data is scoped by `user_id` in every
query; anonymous use stores rows with `user_id IS NULL`. On login, the frontend
pushes localStorage to `/api/db/sync` and the server becomes the source of truth.

## Frontend

No framework, no bundler. `index.html` is a Jinja2 template composing `partials/`.
JS modules in `frontend/js/` define **global functions**; there are no ES modules
at runtime.

### Loading strategy

- **Critical** (`core.js`, `auth.js`, `theme-routing.js`) load synchronously.
- **Deferred** modules load with `defer`.
- **Lazy** feature modules (mindmap, exam, study-rooms, etc.) load on first use via `lazy-loader.js`, which installs stub functions that fetch the real module then call through. D3.js loads from CDN only when a graph feature is opened.

### Client storage & sync

State lives in `localStorage` (`lectureDigest_*` keys). `db-sync.js` pushes/pulls
to the backend for logged-in users; large or feature-specific blobs (SRS data,
exam history, tags, custom flashcards) ride the `user_kv_store` via `/api/db/sync`.

### XSS escaping

All HTML is built by string concatenation, so escaping is mandatory. Escape
helpers (`esc`, `escHtml`, `_crEsc`, `_srEsc`, `_engEsc`, `_notifEsc`) escape
`& < > " '` — quotes included, because values are interpolated into HTML
attributes. Never interpolate user/AI content into inline `onclick`; use
`data-*` + `addEventListener`. See SECURITY.md for the full policy.

## Testing

- **Backend:** `cd backend && pytest` — ~235 tests against an isolated temp SQLite DB (`tests/conftest.py`). Gemini and network calls are mocked. `BCRYPT_ROUNDS=4` is set in tests to keep hashing fast.
- **Frontend:** `npm test` (Vitest) — ~41 tests covering the XSS escapers and the Markdown builder, extracted from real source so unsafe edits fail.
- **Lint:** `cd backend && ruff check .`
- **CI:** `.github/workflows/` runs lint + both test suites on push/PR.

## Configuration

Environment variables (see `backend/.env.example`):

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Gemini API access |
| `JWT_SECRET` | Prod | JWT signing (falls back to gitignored `.jwt_secret` locally) |
| `TRUST_PROXY` | Behind proxy | Trust `X-Forwarded-For` for rate-limit IP resolution |
| `ADMIN_EMAILS` | Optional | Comma-separated admin emails |
| `GOOGLE_CLIENT_ID` | Optional | Google OAuth |
| `RESEND_API_KEY` / `EMAIL_FROM` | Optional | Email (preferred on cloud) |
| `SMTP_*` | Optional | Email via SMTP (local only; cloud hosts block SMTP) |
| `APP_BASE_URL` | Optional | Base URL for links in emails/shares |
| `BCRYPT_ROUNDS` | No | Defaults to 12; lowered only in tests |

## Deployment

Single Docker image runs `uvicorn main:app` and serves the frontend. `$PORT` is
honoured for Render/Railway/Fly. `render.yaml` is a ready Blueprint: set
`GEMINI_API_KEY`, let Render generate `JWT_SECRET`, and `TRUST_PROXY=true` is
pre-set. Health check: `GET /health`.
