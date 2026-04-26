/* ════════════════════════════════════════════════
   LectureDigest — Auto-Summarize Comparison
   ════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════
// AUTO-SUMMARIZE COMPARISON
// ══════════════════════════════════════════════════════

function closeCompareModal() {
    var ov = document.getElementById('compareOverlay');
    if (ov) ov.classList.add('hidden');
}

function openCompareForVideo(videoId) {
    var hist = loadHistory();
    var entries = hist.filter(function(h) { return h.video_id === videoId; });
    if (entries.length < 2) {
        showToast('Can it nhat 2 ban phan tich de so sanh');
        return;
    }
    // Use two most recent
    var a = entries[0];
    var b = entries[1];
    renderComparison(a, b);
    var ov = document.getElementById('compareOverlay');
    if (ov) ov.classList.remove('hidden');
}

function renderComparison(a, b) {
    var body = document.getElementById('compareBody');
    if (!body) return;

    var da = a.data || {};
    var db = b.data || {};

    // Compute similarity stats
    var overviewSim = textSimilarity(da.overview || '', db.overview || '');
    var takeA = (da.key_takeaways || []);
    var takeB = (db.key_takeaways || []);
    var topicCountA = (da.topics || []).length;
    var topicCountB = (db.topics || []).length;

    var dateA = new Date(a.savedAt).toLocaleDateString('vi-VN', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    var dateB = new Date(b.savedAt).toLocaleDateString('vi-VN', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});

    var simPct = Math.round(overviewSim * 100);
    var simClass = simPct > 70 ? 'compare-diff-same' : 'compare-diff-diff';

    var html = '';

    // Stats bar
    html += '<div class="compare-stats">';
    html += '<div class="compare-stat"><div class="compare-stat-num">' + simPct + '%</div><div class="compare-stat-label">Do tuong dong Overview</div></div>';
    html += '<div class="compare-stat"><div class="compare-stat-num">' + takeA.length + ' vs ' + takeB.length + '</div><div class="compare-stat-label">Key Takeaways</div></div>';
    html += '<div class="compare-stat"><div class="compare-stat-num">' + topicCountA + ' vs ' + topicCountB + '</div><div class="compare-stat-label">Chapters</div></div>';
    html += '</div>';

    // Side by side
    html += '<div class="compare-grid">';

    // Column A
    html += '<div class="compare-col">';
    html += '<div class="compare-col-header"><span class="compare-label compare-label-a">Ban A</span><span class="compare-meta">' + dateA + ' &bull; ' + (a.lang || 'en') + '</span></div>';

    html += '<div class="compare-section"><div class="compare-section-title">Overview</div>';
    html += '<div class="compare-text">' + escHtml(da.overview || 'Khong co') + '</div></div>';

    html += '<div class="compare-section"><div class="compare-section-title">Key Takeaways</div>';
    html += '<ul class="compare-list">' + takeA.map(function(t) { return '<li>' + escHtml(t) + '</li>'; }).join('') + '</ul></div>';

    html += '<div class="compare-section"><div class="compare-section-title">Chapters (' + topicCountA + ')</div>';
    html += '<ul class="compare-list">' + (da.topics || []).map(function(t) {
        return '<li><strong>' + (t.timestamp_str || '') + '</strong> ' + escHtml(t.title || '') + '</li>';
    }).join('') + '</ul></div>';
    html += '</div>';

    // Column B
    html += '<div class="compare-col">';
    html += '<div class="compare-col-header"><span class="compare-label compare-label-b">Ban B</span><span class="compare-meta">' + dateB + ' &bull; ' + (b.lang || 'en') + '</span></div>';

    html += '<div class="compare-section"><div class="compare-section-title">Overview</div>';
    html += '<div class="compare-text">' + escHtml(db.overview || 'Khong co') + '</div></div>';

    html += '<div class="compare-section"><div class="compare-section-title">Key Takeaways</div>';
    html += '<ul class="compare-list">' + takeB.map(function(t) { return '<li>' + escHtml(t) + '</li>'; }).join('') + '</ul></div>';

    html += '<div class="compare-section"><div class="compare-section-title">Chapters (' + topicCountB + ')</div>';
    html += '<ul class="compare-list">' + (db.topics || []).map(function(t) {
        return '<li><strong>' + (t.timestamp_str || '') + '</strong> ' + escHtml(t.title || '') + '</li>';
    }).join('') + '</ul></div>';
    html += '</div>';

    html += '</div>'; // end compare-grid

    body.innerHTML = html;
}

// Simple text similarity (Jaccard on words)
function textSimilarity(a, b) {
    if (!a && !b) return 1;
    if (!a || !b) return 0;
    var wordsA = a.toLowerCase().split(/\s+/);
    var wordsB = b.toLowerCase().split(/\s+/);
    var setA = {};
    var setB = {};
    wordsA.forEach(function(w) { setA[w] = 1; });
    wordsB.forEach(function(w) { setB[w] = 1; });
    var intersection = 0;
    var union = Object.assign({}, setA);
    for (var w in setB) {
        if (setA[w]) intersection++;
        union[w] = 1;
    }
    var unionSize = Object.keys(union).length;
    return unionSize ? intersection / unionSize : 0;
}

