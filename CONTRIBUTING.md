# Contributing to LectureDigest

Thanks for your interest in improving LectureDigest! This guide covers local
setup, running tests, and the pull-request workflow.

## Getting started

```bash
git clone https://github.com/tridpt/LectureDigest.git
cd LectureDigest

# Backend
cd backend
pip install -r requirements.txt
echo "GEMINI_API_KEY=your_key_here" > .env
uvicorn main:app --reload        # http://localhost:8000

# Frontend tests (from repo root)
npm install
```

See [README.md](README.md) for full setup options (Docker, etc.) and
[ARCHITECTURE.md](ARCHITECTURE.md) for how the code is organized.

## Running tests & lint

Before opening a PR, make sure everything passes:

```bash
# Backend
cd backend
ruff check .          # lint
pytest                # full suite

# Frontend
npm test              # Vitest
```

Both suites also run in CI on every pull request.

## Pull-request workflow

1. Fork the repo and create a branch off `main` (e.g. `fix/login-redirect`).
2. Make your change. Add or update tests for any behavior you change.
3. Run lint + tests locally (see above).
4. Open a PR against `main` and fill in the template. Link any related issue.
5. Keep PRs focused — one logical change per PR is easier to review.

## Coding conventions

- **Python:** follow the existing style; `ruff` enforces the rules (see
  `backend/pyproject.toml`). No unused imports, no bare ambiguous names.
- **JavaScript:** vanilla JS, no build step. Match the surrounding file's style.
- **Security:** when rendering user/AI content, always escape it. Never
  interpolate user input into inline `onclick` handlers. Read
  [SECURITY.md](SECURITY.md) before touching auth, input handling, or rendering.
- **Commits:** use clear, imperative messages (e.g. `fix: prevent XSS in chat`).

## Reporting bugs & security issues

- **Bugs / features:** open an issue using the provided templates.
- **Security vulnerabilities:** do **not** open a public issue. Follow the
  process in [SECURITY.md](SECURITY.md).
