/* ════════════════════════════════════════════════
   LectureDigest — Lazy Feature Loader
   Stub functions that auto-load scripts on first use.
   Once loaded, the real function replaces the stub.
   ════════════════════════════════════════════════ */

/**
 * Creates a lazy stub for a function.
 * First call loads the module, then invokes the real function.
 * Subsequent calls go directly to the real function (stub is replaced).
 */
function _lazyStub(moduleName, fnName) {
    return function() {
        var args = Array.prototype.slice.call(arguments);
        loadFeature(moduleName).then(function() {
            if (typeof window[fnName] === 'function') {
                window[fnName].apply(null, args);
            }
        }).catch(function(err) {
            console.error('[LazyLoader] Failed to load', moduleName, ':', err.message);
        });
    };
}

// ── Mind Map ──
window.openMindMap = _lazyStub('mindmap', 'openMindMap');

// ── Knowledge Graph ──
window.openKnowledgeGraph = _lazyStub('knowledgeGraph', 'openKnowledgeGraph');

// ── Multi-Video Exam ──
window.openMexam = _lazyStub('exam', 'openMexam');

// ── Exercises ──
window.showExercises = _lazyStub('exercises', 'showExercises');
window.generateExercises = _lazyStub('exercises', 'generateExercises');

// ── PDF Export ──
window.exportPDF = _lazyStub('pdfExport', 'exportPDF');

// ── Study Plan ──
window.openStudyPlan = _lazyStub('studyPlan', 'openStudyPlan');

// ── Study Rooms ──
window.openStudyRooms = _lazyStub('studyRooms', 'openStudyRooms');

// ── Chat Rooms ──
window.openChatRooms = _lazyStub('chatRooms', 'openChatRooms');

// ── English Learning ──
window.openEnglish = _lazyStub('english', 'openEnglish');

// ── Compare ──
window.openCompare = _lazyStub('compare', 'openCompare');

// ── Playlist ──
window.analyzePlaylist = _lazyStub('playlist', 'analyzePlaylist');

// ── Auto Notes ──
window.generateAutoNotes = _lazyStub('autoNotes', 'generateAutoNotes');

// ── TTS (lightweight stubs for controls that are always visible) ──
window.ttsRead = _lazyStub('tts', 'ttsRead');
window.ttsPause = function() {
    if (window.speechSynthesis) window.speechSynthesis.pause();
};
window.ttsStop = function() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    var el = document.getElementById('ttsControls');
    if (el) el.classList.remove('visible');
};

// ── Weekly Goals ──
window.openWeeklyGoals = _lazyStub('weeklyGoals', 'openWeeklyGoals');

// ── Leaderboard ──
window.openLeaderboard = _lazyStub('leaderboard', 'openLeaderboard');

// ── Concept Explainer ──
window.explainConcept = _lazyStub('conceptExplainer', 'explainConcept');

// ── Analytics ──
window.openAnalytics = _lazyStub('analytics', 'openAnalytics');

// ── Share Notes ──
window.openShareNotes = _lazyStub('shareNotes', 'openShareNotes');

// ── Admin Panel ──
window.openAdmin = _lazyStub('admin', 'openAdmin');
