# LectureDigest 🎓

**Transform any YouTube lecture into a smart study guide — powered by Gemini AI**

## Features
- 📖 **AI Summary** — Comprehensive overview of the entire lecture
- 🗺️ **Chapter Timeline** — Clickable timestamps that jump the video to exact sections
- 🧠 **Interactive Quiz** — 8-12 AI-generated questions with explanations linked to timestamps
- 🎯 **Score Tracking** — Track correct, wrong, and skipped questions

## Quick Start

### 1. Prerequisites
- Python 3.9+
- A **Gemini API Key** → [Get one here](https://aistudio.google.com/app/apikey)

### 2. Setup
```bash
# Clone / open the project folder
cd D:\App\LectureDigest

# Copy the env template and add your API key
copy backend\.env.example backend\.env
# Then edit backend\.env and set: GEMINI_API_KEY=your_key_here
```

### 3. Run
```bash
# Double-click run.bat  OR  run from terminal:
.\run.bat
```
The frontend (`frontend/index.html`) opens automatically in your browser.

## Manual Start
```bash
# Install dependencies
pip install -r backend/requirements.txt

# Start backend
cd backend
uvicorn main:app --reload --port 8000

# Open frontend/index.html in your browser
```

## Project Structure
```
LectureDigest/
├── backend/
│   ├── main.py            # FastAPI app (transcript + Gemini AI)
│   ├── requirements.txt
│   └── .env               # Your API key goes here (create from .env.example)
├── frontend/
│   ├── index.html         # Main page
│   ├── style.css          # Premium dark UI styles
│   └── app.js             # YouTube player + quiz logic
└── run.bat                # One-click startup
```

## Tech Stack
| Layer | Technology |
|---|---|
| Backend | Python + FastAPI |
| AI Engine | Google Gemini 2.0 Flash |
| Transcripts | youtube-transcript-api |
| Video Player | YouTube IFrame API |
| Frontend | Vanilla HTML/CSS/JS |

## Notes
- The video **must have captions/subtitles enabled** on YouTube
- Very long videos (3h+) may take longer to analyze
- The backend runs on `localhost:8000` and the frontend calls it via fetch
