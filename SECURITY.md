# Security Policy

This document records the security decisions, hardening measures, and reporting
process for LectureDigest. Read it before changing authentication, input
handling, or any code that renders user/AI-generated content — several patches
here close real vulnerabilities and are easy to re-open by accident.

## Reporting a Vulnerability

Please report security issues privately rather than opening a public issue:

- Open a GitHub **Security Advisory** (Settings → Security → Report a vulnerability), or
- Email the maintainer listed on the repository profile.

Include reproduction steps and the affected endpoint/file. We aim to acknowledge
within a few days. Please do not disclose publicly until a fix is released.

## Supported Versions

The `main` branch is the only actively maintained line. Fixes are applied there
and deployed from it.

## Hardening Measures & Design Decisions

### Cross-Site Scripting (XSS)

The frontend is vanilla JS that builds HTML with string concatenation and
`innerHTML`. This is XSS-prone, so the following rules apply:

- **All escape helpers escape quotes.** `esc` (core.js), `_crEsc`
  (chat-rooms.js), `_srEsc` (study-rooms.js), `_engEsc` (english.js),
  `_notifEsc` (notifications.js), and `escHtml` escape `& < > " '`. Quotes are
  escaped because values are frequently interpolated **inside HTML attributes**
  (e.g. `aria-label="..."`, `data-name="..."`), not only text nodes. Do not
  "simplify" these back to a `textContent`/`innerHTML` round-trip — that misses
  quotes and re-opens attribute-context XSS.
- **Never interpolate user/AI content into inline event handlers.** Patterns
  like `onclick="fn('" + name + "')"` mix HTML and JS escaping contexts and are
  unsafe. Use a `data-*` attribute plus `addEventListener` instead. See the
  mention dropdown (chat-rooms.js) and the kick buttons (study-rooms.js) for the
  correct pattern.
- **Escape AI output before rendering.** Gemini-generated text (titles,
  summaries, explanations, quiz content) is treated as untrusted. The chat
  renderer escapes before applying markdown; the concept explainer escapes
  before converting newlines to `<br>`.
- **Image viewers set `src` via DOM property**, not by interpolating a URL into
  an `innerHTML` string (chat-rooms.js `crViewImage`).

### Content-Security-Policy

A CSP header is set in `SecurityHeadersMiddleware` (backend/main.py). It
whitelists only the origins the app uses: YouTube player, Google Sign-In, the
D3 CDN (jsdelivr), Google Fonts, image/avatar hosts, and the transcript
Cloudflare Worker. It also sets `object-src 'none'`, `base-uri 'self'`,
`frame-ancestors 'self'`, and a restricted `connect-src`.

**Caveat:** `script-src` includes `'unsafe-inline'` because the frontend relies
on inline `onclick` handlers and inline `<script>` blocks. CSP here is
defense-in-depth (blocks off-origin scripts and data exfiltration), not a
complete inline-injection guard. Removing `'unsafe-inline'` would require
refactoring the frontend to external handlers — do that before tightening it.

### Input Validation

- **Chat `image_url` is server-path-only.** The send-message endpoint
  (routes/chat_rooms.py) rejects any `image_url` that is not a server-generated
  upload path matching `/uploads/chat/<token>.<ext>`. This prevents a client
  from storing `"><img onerror=...>` and turning it into stored XSS for everyone
  in the room. Keep this validation if you touch the message-send path.
- **Request body size limits** — JSON payloads capped at 10 MB, file uploads at
  200 MB (`BodySizeLimitMiddleware`).
- **Path traversal** — the `/uploads/` route and SPA catch-all resolve the
  absolute path and verify it stays within the allowed directory.

### Authentication & Accounts

- Passwords hashed with **bcrypt** (run off the event loop).
- **JWT** with expiry; secret comes from `JWT_SECRET` env in production, with a
  gitignored `.jwt_secret` fallback for local dev only.
- **Rate limiting** on login (per email), register (per IP), and password reset.
- `forgot-password` always returns success to prevent **email enumeration**.
- **Blocklist** — blocked emails are rejected at both login and register; admins
  cannot be blocked or self-deleted.

### Rate Limiting Behind a Proxy

`get_client_ip` (routes/client_ip.py) only trusts the `X-Forwarded-For` header
when `TRUST_PROXY` is set. Enable `TRUST_PROXY=true` **only** when running behind
a trusted reverse proxy (Render/Railway/Fly/nginx); otherwise the spoofable
header is ignored and the socket peer is used. The global rate-limit middleware
uses this helper so users behind a proxy are not lumped into one bucket.

### Authorization (IDOR)

All per-user data (history, notes, bookmarks, folders, English vocab) is scoped
by `user_id` in the SQL `WHERE` clause at the DB layer. Room actions
(kick/ban/role/delete/comment) verify the caller's role/ownership before acting.
When adding endpoints that take an id from the client, always scope the query by
the authenticated user or check ownership explicitly.

### Secrets

`.env`, `.jwt_secret`, `*.sqlite3`, and `backups/` are gitignored. Never commit
real keys. Use `backend/.env.example` as the template.

## Testing

Security regressions are covered by `backend/tests/test_security.py`
(image_url validation, path traversal, blocked-email enforcement, security
headers incl. CSP). Run the full suite with `pytest` from `backend/` before
shipping changes to auth, input handling, or rendering. CI runs these on every
push/PR via `.github/workflows/backend-tests.yml`.
