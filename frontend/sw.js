// ══════════════════════════════════════════════════════
// LectureDigest Service Worker — Offline-first caching
// ══════════════════════════════════════════════════════

const CACHE_NAME = '%%CACHE_VERSION%%';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/base.css',
  '/css/ambient.css',
  '/css/header.css',
  '/css/hero.css',
  '/css/loading.css',
  '/css/error.css',
  '/css/results.css',
  '/css/history.css',
  '/css/highlights.css',
  '/css/quiz.css',
  '/css/flashcard.css',
  '/css/transcript.css',
  '/css/transcript-sync.css',
  '/css/translate.css',
  '/css/notes.css',
  '/css/chat.css',
  '/css/share.css',
  '/css/mindmap.css',
  '/css/progress.css',
  '/css/bookmarks.css',
  '/css/gamification.css',
  '/css/badges-page.css',
  '/css/theme.css',
  '/css/dashboard.css',
  '/css/concept-explainer.css',
  '/css/playlist.css',
  '/css/knowledge-graph.css',
  '/css/exam.css',
  '/css/exercises.css',
  '/css/auth.css',
  '/css/upload.css',
  '/css/share-notes.css',
  '/css/search.css',
  '/css/srs-review.css',
  '/css/pomodoro.css',
  '/css/weekly-goals.css',
  '/css/leaderboard.css',
  '/css/pwa-install.css',
  '/css/utilities.css',
  '/css/mobile.css',
  '/css/study-rooms.css',
  '/css/chat-rooms.css',
  '/css/english.css',
  '/css/notifications.css',
  '/css/study-plan.css',
  '/css/analytics.css',
  '/css/offline.css',
  '/css/folders.css',
  '/css/shortcuts-help.css',
  '/js/core.js',
  '/js/auth.js',
  '/js/youtube.js',
  '/js/history.js',
  '/js/folders.js',
  '/js/notes.js',
  '/js/analyze.js',
  '/js/quiz.js',
  '/js/flashcard.js',
  '/js/srs-review.js',
  '/js/chat.js',
  '/js/transcript.js',
  '/js/mindmap.js',
  '/js/progress.js',
  '/js/gamification.js',
  '/js/badges-page.js',
  '/js/theme-routing.js',
  '/js/tags.js',
  '/js/compare.js',
  '/js/share.js',
  '/js/pdf-export.js',
  '/js/playlist.js',
  '/js/knowledge-graph.js',
  '/js/exam.js',
  '/js/exercises.js',
  '/js/db-sync.js',
  '/js/mobile.js',
  '/js/upload.js',
  '/js/share-notes.js',
  '/js/auto-notes.js',
  '/js/pomodoro.js',
  '/js/weekly-goals.js',
  '/js/leaderboard.js',
  '/js/search.js',
  '/js/pwa-install.js',
  '/js/offline-indicator.js',
  '/js/shortcuts-help.js',
  '/js/study-rooms.js',
  '/js/chat-rooms.js',
  '/js/english.js',
  '/js/notifications.js',
  '/js/study-plan.js',
  '/js/lazy-loader.js',
  '/js/analytics.js',
  '/js/tts.js',
  '/js/admin.js',
  '/dashboard.js',
  '/concept-explainer.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Install — cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Allow the page to tell a waiting SW to activate immediately
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch — network-first for API, cache-first for static
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET
  if (event.request.method !== 'GET') return;

  // API calls — network only, return offline JSON if failed
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'Offline', detail: 'Không có kết nối mạng' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Google Fonts — cache with stale-while-revalidate
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const fetchPromise = fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // External resources — network with cache fallback
  if (url.origin !== location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const fetchPromise = fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // App code (JS/CSS) — network-first so updates apply immediately,
  // fall back to cache only when offline.
  if (url.origin === location.origin && (url.pathname.endsWith('.js') || url.pathname.endsWith('.css'))) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets — cache-first, network fallback (stale-while-revalidate)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // Update cache in background
        fetch(event.request).then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, response));
          }
        }).catch(() => {});
        return cached;
      }

      // Not cached — fetch and cache
      return fetch(event.request).then(response => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // SPA fallback — return index.html for navigation
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});
