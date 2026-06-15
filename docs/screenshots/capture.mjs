// Automated screenshot capture for the README, using Playwright.
//
// It seeds localStorage with a realistic sample lecture (so data-driven pages
// render without calling Gemini), then drives the real UI and captures PNGs
// into docs/screenshots/.
//
// Playwright is NOT a project dependency (it pulls a ~300MB browser), so install
// it on demand only when you need to regenerate screenshots.
//
// Usage:
//   1. Install Playwright + Chromium:  npm i -D playwright && npx playwright install chromium
//   2. Start the server:               cd backend ; uvicorn main:app --port 8000
//   3. Run:                            node docs/screenshots/capture.mjs
//
// Re-run any time the UI changes to refresh the screenshots.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'http://localhost:8000';
const OUT = __dirname;
const VW = 1280, VH = 860;

// ── Sample lecture data (shape matches what /api/analyze returns) ──
const SAMPLE = {
  video_id: 'dQw4w9WgXcQ',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  title: 'Introduction to Neural Networks',
  author: 'Stanford Online',
  difficulty: 'Intermediate',
  language: 'English',
  overview:
    'This lecture introduces the fundamentals of neural networks: how artificial neurons combine weighted inputs through an activation function, how layers stack to learn hierarchical features, and how backpropagation adjusts weights to minimize error. It builds intuition before the math, then connects each idea to a concrete training example.',
  key_takeaways: [
    'A neuron computes a weighted sum of its inputs and passes it through a non-linear activation.',
    'Hidden layers let the network learn increasingly abstract features.',
    'Backpropagation uses the chain rule to assign error to each weight.',
    'Learning rate controls how big each gradient-descent step is.',
    'Overfitting is countered with regularization, dropout, and more data.',
  ],
  topics: [
    { emoji: '🧠', title: 'What is a neuron?', timestamp_str: '00:45', timestamp: 45,
      summary: 'The perceptron model: weighted inputs, bias, and a step/sigmoid activation.' },
    { emoji: '🔗', title: 'Layers & forward pass', timestamp_str: '04:12', timestamp: 252,
      summary: 'How signals flow from input through hidden layers to the output.' },
    { emoji: '📉', title: 'Loss functions', timestamp_str: '09:30', timestamp: 570,
      summary: 'Measuring prediction error with MSE and cross-entropy.' },
    { emoji: '🔄', title: 'Backpropagation', timestamp_str: '14:05', timestamp: 845,
      summary: 'Propagating gradients backward to update each weight.' },
    { emoji: '🎯', title: 'Training & generalization', timestamp_str: '21:18', timestamp: 1278,
      summary: 'Epochs, batches, and avoiding overfitting.' },
  ],
  highlights: [
    { type: 'insight', timestamp_str: '05:20', timestamp: 320, title: 'Non-linearity is the key',
      description: 'Without non-linear activations, stacked layers collapse into a single linear map.' },
    { type: 'definition', timestamp_str: '11:02', timestamp: 662, title: 'Gradient descent',
      description: 'An optimization step that moves weights opposite to the error gradient.' },
    { type: 'example', timestamp_str: '17:40', timestamp: 1060, title: 'Recognizing digits',
      description: 'A worked MNIST example showing how pixels map to a predicted label.' },
  ],
  quiz: [
    { question: 'What makes a neural network able to model non-linear relationships?',
      options: ['Weighted sums', 'Non-linear activation functions', 'A larger learning rate', 'More input features'],
      correct_index: 1, difficulty: 'medium', timestamp_str: '05:20', timestamp: 320,
      explanation: 'Non-linear activations between layers let the network represent non-linear functions.' },
    { question: 'What does backpropagation compute?',
      options: ['The forward pass output', 'Gradients of the loss w.r.t. each weight', 'The learning rate', 'The number of layers'],
      correct_index: 1, difficulty: 'medium', timestamp_str: '14:05', timestamp: 845,
      explanation: 'It applies the chain rule to attribute the loss to every weight.' },
    { question: 'Which technique helps reduce overfitting?',
      options: ['Increasing model size', 'Dropout', 'Removing the validation set', 'Raising the learning rate'],
      correct_index: 1, difficulty: 'easy', timestamp_str: '21:18', timestamp: 1278,
      explanation: 'Dropout randomly disables units during training, improving generalization.' },
  ],
};

// Build 30 days of SRS review history so the retention chart is populated.
function buildSrsHistory() {
  const hist = {};
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().split('T')[0];
    if (i % 7 === 6) continue; // skip ~1 day/week for realism
    const total = 4 + Math.floor(Math.random() * 16);
    const hard = Math.floor(Math.random() * Math.max(1, total * 0.3));
    const easy = Math.floor(Math.random() * (total - hard));
    hist[key] = { hard, ok: total - hard - easy, easy, total };
  }
  return hist;
}

const HISTORY_ENTRY = {
  entry_id: SAMPLE.video_id,
  video_id: SAMPLE.video_id,
  url: SAMPLE.url,
  title: SAMPLE.title,
  author: SAMPLE.author,
  thumbnail: `https://img.youtube.com/vi/${SAMPLE.video_id}/mqdefault.jpg`,
  savedAt: Date.now(),
  lang: 'en',
  data: SAMPLE,
};

const GAMIF = {
  currentStreak: 12, longestStreak: 21, totalStudyDays: 34,
  xp: 2450, level: 7, videosAnalyzed: 9,
  totalSrsReviews: 28, totalCardsReviewed: 240,
  earnedBadges: ['first_video', 'first_review', 'review_50', 'review_100', 'days_7'],
};

async function seed(page) {
  await page.addInitScript((payload) => {
    localStorage.setItem('lectureDigest_history', JSON.stringify([payload.entry]));
    localStorage.setItem('lectureDigest_gamification', JSON.stringify(payload.gamif));
    localStorage.setItem('lectureDigest_srsHistory', JSON.stringify(payload.srs));
    localStorage.setItem('lectureDigest_theme', 'dark');
    // Seed SM-2 data so the SRS review deck has cards.
    const sm2 = {};
    payload.entry.data.quiz.forEach((q, i) => {
      sm2['card_' + i] = {
        ef: 2.5, interval: 0, repetitions: 0, nextReview: '2000-01-01',
        _front: 'Q: ' + q.question, _back: q.options[q.correct_index], _tag: 'quiz',
      };
    });
    localStorage.setItem('lectureDigest_sm2_' + payload.entry.video_id, JSON.stringify(sm2));
  }, { entry: HISTORY_ENTRY, gamif: GAMIF, srs: buildSrsHistory() });
}

async function shot(page, name) {
  const path = join(OUT, name);
  await page.screenshot({ path, fullPage: false });
  console.log('  ✓ ' + name);
}

async function main() {
  const browser = await chromium.launch();
  // bypassCSP so we control resource loading; the headless browser has no
  // internet, so we intercept the D3 CDN request and serve the local copy.
  const context = await browser.newContext({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: 2,
    bypassCSP: true,
  });
  const d3Src = readFileSync(join(__dirname, '..', '..', 'node_modules', 'd3', 'dist', 'd3.min.js'), 'utf8');
  await context.route('**/d3@*/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: d3Src })
  );
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await seed(page);

  console.log('Capturing screenshots from', BASE);

  // 1. Hero / landing
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await shot(page, 'hero.png');

  // 2. Analysis result page — render from the seeded sample.
  //    NOTE: `analysisData` is a `let` in core.js (global lexical scope), which
  //    is NOT the same as `window.analysisData`. Features like the mind map read
  //    the lexical binding, so we assign it bare (no `window.`) to hit it.
  await page.evaluate((data) => {
    try { analysisData = data; } catch (e) { window.analysisData = data; }
    window.analysisData = data;
    window._spaVideoId = data.video_id;
    if (typeof clearChat === 'function') clearChat();
    if (typeof renderResults === 'function') renderResults(data);
    if (typeof showSection === 'function') showSection('resultsSection');
  }, SAMPLE);
  await page.waitForTimeout(1200);
  await shot(page, 'analysis.png');

  // 3. Quiz — the quiz renders into #quizContainer on the results page.
  //    Scroll it into view (centered) so the card fills the shot.
  await page.evaluate(() => {
    const q = document.getElementById('quizContainer');
    if (q) q.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(700);
  await shot(page, 'quiz.png');
  // Scroll back to top so the mind-map modal opens over a clean view.
  await page.evaluate(() => window.scrollTo({ top: 0 }));

  // 4. Mind map — the lazy loader fetches D3 from a CDN, which is flaky in a
  //    headless/offline browser. With bypassCSP on, inject D3 directly, mark it
  //    as loaded so the lazy loader is a no-op, then render the map.
  await page.addScriptTag({ content: d3Src });
  await page.evaluate(() => {
    // openMindMap shows the modal; renderMindMap (in mindmap.js) draws into #mmSvg.
    if (typeof openMindMap === 'function') openMindMap();
  });
  try {
    await page.waitForFunction(() => {
      const svg = document.getElementById('mmSvg');
      const overlay = document.getElementById('mmModalOverlay');
      return overlay && !overlay.classList.contains('hidden') &&
             svg && svg.querySelectorAll('g, circle, path').length > 3;
    }, { timeout: 15000 });
  } catch (e) {
    console.warn('  ! mind map did not render in time — capturing anyway');
  }
  await page.waitForTimeout(1200); // let the entrance transition settle
  await shot(page, 'mindmap.png');
  await page.evaluate(() => { if (typeof closeMindMap === 'function') closeMindMap(); });

  // 5. Dashboard
  await page.evaluate(() => {
    if (typeof openDashboard === 'function') openDashboard();
    else if (typeof renderDashboard === 'function') { renderDashboard(); }
  });
  await page.waitForTimeout(1500);
  await shot(page, 'dashboard.png');

  // 6. SRS review + retention chart
  await page.evaluate(() => { if (typeof openSrsReview === 'function') openSrsReview(); });
  await page.waitForTimeout(1200);
  await shot(page, 'flashcards.png');

  await browser.close();
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
