# LectureDigest 🎓

**Transform any YouTube lecture into a smart study guide — powered by Gemini AI**

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

---

## ✨ Features

| Feature | Description |
|---|---|
| 📖 **AI Summary** | Comprehensive overview of the entire lecture |
| 🗺️ **Chapter Timeline** | Clickable timestamps → seek video to exact section |
| 🔥 **Key Moments** | AI-identified highlight moments (key insight, definition, example...) |
| ✅ **Key Takeaways** | Bullet-point list of core concepts |
| 🧠 **Interactive Quiz** | 8-12 AI-generated Q&As with explanations + timestamps |
| 📇 **Flashcard Export** | Export quiz + takeaways as Anki TSV or CSV |
| 📄 **PDF Study Guide** | Print-quality study guide via browser |
| 🌍 **Multilingual** | Output in Vietnamese, English, French, German, Japanese, Korean, Chinese |

---

## 🚀 Quick Start (Local)

### Option A — Docker (Recommended, no Python needed)

```bash
# 1. Clone the repo
git clone https://github.com/tridpt/LectureDigest.git
cd LectureDigest

# 2. Create .env with your Gemini API key
echo "GEMINI_API_KEY=your_key_here" > backend/.env

# 3. Build & run
docker compose up --build

# 4. Open http://localhost:8000
```

### Option B — Run Directly with Python

```bash
# Requirements: Python 3.9+
cd LectureDigest

# Copy env and add your API key
copy backend\.env.example backend\.env
# Edit backend\.env → set GEMINI_API_KEY=your_key_here

# Install deps & start
pip install -r backend/requirements.txt
cd backend
uvicorn main:app --reload --port 8000

# Open http://localhost:8000
```

Get your **Gemini API Key** → [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)

---

## ☁️ Deploy to the Internet

### Render.com (Free Tier — Recommended)

1. Push your fork to GitHub
2. Go to [render.com/deploy](https://dashboard.render.com/select-repo) → connect your repo
3. Render auto-detects `render.yaml` → click **Deploy**
4. In the **Environment** tab, add: `GEMINI_API_KEY = your_key_here`
5. Done! Your app is live at `https://lecturedigest.onrender.com` 🎉

> ⚠️ Free tier spins down after 15 min of inactivity — first request takes ~30s to wake up.

### Railway.app

```bash
# Install Railway CLI
npm install -g @railway/cli
railway login
railway link        # connect to your project
railway up          # deploy from local
```
Then set `GEMINI_API_KEY` in the Railway dashboard.

### Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh
fly auth login
fly launch          # auto-detects Dockerfile
fly secrets set GEMINI_API_KEY=your_key_here
fly deploy
```

---

## 🐳 Docker Reference

```bash
# Build image
docker build -t lecturedigest .

# Run with env var directly
docker run -p 8000:8000 -e GEMINI_API_KEY=your_key lecturedigest

# Using docker compose
docker compose up --build        # start
docker compose down              # stop
docker compose logs -f app       # view logs
```

---

## 🗂️ Project Structure

```
LectureDigest/
├── backend/
│   ├── main.py            # FastAPI app (transcript + Gemini AI)
│   ├── requirements.txt
│   └── .env               # Your API key (never commit this!)
├── frontend/
│   ├── index.html         # App shell
│   ├── style.css          # Premium dark UI
│   └── app.js             # All frontend logic
├── Dockerfile             # Production container
├── docker-compose.yml     # Local Docker dev
├── render.yaml            # Render.com deploy blueprint
└── run.bat                # Windows one-click start (no Docker)
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.13 + FastAPI |
| AI Engine | Google Gemini 2.5 Flash |
| Transcripts | youtube-transcript-api v1.x |
| Video Player | YouTube IFrame API |
| Frontend | Vanilla HTML/CSS/JS |
| Container | Docker + Docker Compose |
| Deployment | Render / Railway / Fly.io |
