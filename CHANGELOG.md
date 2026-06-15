# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-06-15

First stable release. LectureDigest turns any YouTube lecture (or uploaded
audio/video) into an AI-powered study companion: summaries, chapters, quizzes,
flashcards, mind maps, knowledge graphs, study plans, and more — with accounts,
cloud sync, collaborative rooms, and offline PWA support.

### Added

- **Markdown export** — export a study guide (overview, takeaways, chapters,
  key moments, quiz, personal notes, bookmarks) to a `.md` file with YAML
  front-matter, ready for Obsidian/Notion.
- **SRS retention-over-time chart** — a 30-day review-history chart on the
  review page, with daily totals synced across devices via the KV store.
- **Content-Security-Policy** header plus a full set of security headers
  (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`).
- **GitHub Actions CI** — backend (`ruff` + `pytest`) and frontend (Vitest)
  suites run on every push and pull request.
- **Vitest frontend tests** — cover the XSS escape helpers and the Markdown
  builder, extracted from real source so unsafe edits fail.
- **Project docs & meta** — `ARCHITECTURE.md`, `SECURITY.md`, `CONTRIBUTING.md`,
  `LICENSE` (MIT), issue/PR templates, Dependabot config, CI badges, and
  auto-captured UI screenshots.

### Fixed

- **Stored XSS via chat `image_url`** — the send-message endpoint now rejects
  any value that is not a server-generated `/uploads/chat/<token>.<ext>` path,
  and the image viewer builds DOM via properties instead of `innerHTML`.
- **Stored XSS via `display_name`** in study rooms — kick actions are now
  event-delegated and escape helpers escape quotes for attribute safety.
- **Attribute-context XSS** — `esc`, `_crEsc`, `_srEsc`, `_engEsc`, `_notifEsc`
  now escape `& < > " '`; AI/user content is escaped in the knowledge graph,
  concept explainer, SRS review, dashboard, and shared-notes views.
- **Per-IP rate limiting behind a proxy** — client IP is resolved via
  `X-Forwarded-For` only when `TRUST_PROXY` is set; the rate-limit store is
  bounded to prevent unbounded growth.
- **Anonymous full-sync crash** — a `%d` log format with `user_id=None` raised
  under INFO logging and made the endpoint report failure despite committing.
- **SRS test-reminder abuse** — the test-email endpoint is now rate-limited per
  user (3/hour) to prevent it being used as a spam vector.
- **Google sign-in `is_new` flag** corrected; `/admin` route restored on reload.

### Changed

- **bcrypt cost** is configurable via `BCRYPT_ROUNDS` (default 12; tests use 4),
  cutting the test suite runtime roughly in half.
- **Service worker** caches `lazy-loader.js` and previously missing JS so
  lazy-loaded features work offline; network-first for app code so updates apply
  without manual cache clears.
- **Linting** — adopted `ruff` with a curated rule set; fixed 145 lint issues.

### Security

See [SECURITY.md](SECURITY.md) for the full hardening policy (XSS escaping
rules, CSP, input validation, rate limiting) and how to report a vulnerability.

[1.0.0]: https://github.com/tridpt/LectureDigest/releases/tag/v1.0.0
