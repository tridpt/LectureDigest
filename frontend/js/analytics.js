/* ════════════════════════════════════════════════
   LectureDigest — Study Analytics & Insights
   (Embedded inside Dashboard)
   ════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════
// GITHUB-STYLE HEATMAP (last 90 days)
// ═══════════════════════════════════════════════════

function _anRenderHeatmap(g) {
    var container = document.getElementById('anHeatmap');
    if (!container) return;

    var studySet = {};
    (g.studyDates || []).forEach(function(d) { studySet[d] = 1; });

    // Also count from history for older dates
    try {
        var history = JSON.parse(localStorage.getItem('lectureDigest_history') || '[]');
        history.forEach(function(h) {
            var d = new Date(h.savedAt || h.analyzedAt).toISOString().slice(0,10);
            studySet[d] = (studySet[d] || 0) + 1;
        });
    } catch(e) {}

    var DAYS = 91; // 13 weeks
    var today = new Date(); today.setHours(0,0,0,0);

    // Find the start: go back to the nearest Sunday
    var start = new Date(today);
    start.setDate(today.getDate() - DAYS + 1);
    while (start.getDay() !== 0) start.setDate(start.getDate() - 1);

    var totalDays = Math.ceil((today - start) / 86400000) + 1;
    var weeks = Math.ceil(totalDays / 7);
    var activeDays = 0;

    var cellsHtml = '';
    for (var w = 0; w < weeks; w++) {
        var colHtml = '';
        for (var d = 0; d < 7; d++) {
            var cellDate = new Date(start);
            cellDate.setDate(start.getDate() + w * 7 + d);
            if (cellDate > today) {
                colHtml += '<div class="an-hm-cell an-hm-future"></div>';
                continue;
            }
            var key = cellDate.toISOString().slice(0,10);
            var count = studySet[key] || 0;
            if (count > 0) activeDays++;
            var level = count === 0 ? 0 : count <= 1 ? 1 : count <= 2 ? 2 : count <= 4 ? 3 : 4;
            var isToday = cellDate.getTime() === today.getTime();
            var dateStr = cellDate.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit' });
            colHtml += '<div class="an-hm-cell an-hm-l' + level + (isToday ? ' an-hm-today' : '') + '" title="' + dateStr + ': ' + count + ' hoạt động"></div>';
        }
        cellsHtml += '<div class="an-hm-col">' + colHtml + '</div>';
    }

    var DOW = ['', 'T2', '', 'T4', '', 'T6', ''];
    var dowHtml = DOW.map(function(d) { return '<div class="an-hm-dow">' + d + '</div>'; }).join('');

    // Month labels
    var monthHtml = '';
    var lastMonth = -1;
    var MONTHS = ['Th1','Th2','Th3','Th4','Th5','Th6','Th7','Th8','Th9','Th10','Th11','Th12'];
    for (var w2 = 0; w2 < weeks; w2++) {
        var dt = new Date(start); dt.setDate(start.getDate() + w2 * 7);
        var m = dt.getMonth();
        if (m !== lastMonth) {
            monthHtml += '<div class="an-hm-month" style="grid-column:' + (w2 + 1) + '">' + MONTHS[m] + '</div>';
            lastMonth = m;
        }
    }

    container.innerHTML =
        '<div class="an-hm-header">' +
            '<span class="an-hm-summary">' + activeDays + ' ngày hoạt động trong ' + DAYS + ' ngày qua</span>' +
            '<div class="an-hm-legend">' +
                '<span class="an-hm-legend-label">Ít</span>' +
                '<div class="an-hm-cell an-hm-l0"></div>' +
                '<div class="an-hm-cell an-hm-l1"></div>' +
                '<div class="an-hm-cell an-hm-l2"></div>' +
                '<div class="an-hm-cell an-hm-l3"></div>' +
                '<div class="an-hm-cell an-hm-l4"></div>' +
                '<span class="an-hm-legend-label">Nhiều</span>' +
            '</div>' +
        '</div>' +
        '<div class="an-hm-months">' + monthHtml + '</div>' +
        '<div class="an-hm-wrap">' +
            '<div class="an-hm-dows">' + dowHtml + '</div>' +
            '<div class="an-hm-grid">' + cellsHtml + '</div>' +
        '</div>';
}

// ═══════════════════════════════════════════════════
// QUIZ TREND LINE CHART (pure CSS/HTML)
// ═══════════════════════════════════════════════════

function _anRenderQuizTrend(history) {
    var container = document.getElementById('anQuizTrend');
    if (!container) return;

    var sessions = [];
    var seenVids = {};
    history.forEach(function(h) {
        if (seenVids[h.video_id]) return;
        seenVids[h.video_id] = true;
        if (typeof loadProgress === 'function') {
            var prog = loadProgress(h.video_id);
            (prog.quizSessions || []).forEach(function(qs) {
                sessions.push({ date: qs.date, pct: qs.pct || 0, title: h.title || 'Video' });
            });
        }
    });

    // Sort by date
    sessions.sort(function(a,b) { return new Date(a.date) - new Date(b.date); });
    var last20 = sessions.slice(-20);

    if (last20.length < 2) {
        container.innerHTML = '<div class="an-empty">Cần ít nhất 2 lần quiz để hiển thị xu hướng.<br>Hãy làm thêm quiz!</div>';
        return;
    }

    // Build SVG line chart
    var W = 600, H = 200, PAD = 40;
    var chartW = W - PAD * 2, chartH = H - PAD * 2;
    var n = last20.length;

    // Points
    var points = last20.map(function(s, i) {
        var x = PAD + (i / (n - 1)) * chartW;
        var y = PAD + chartH - (s.pct / 100) * chartH;
        return { x: x, y: y, pct: s.pct, date: s.date, title: s.title };
    });

    // Grid lines
    var gridHtml = '';
    [0, 25, 50, 75, 100].forEach(function(v) {
        var y = PAD + chartH - (v / 100) * chartH;
        gridHtml += '<line x1="' + PAD + '" y1="' + y + '" x2="' + (W - PAD) + '" y2="' + y + '" stroke="rgba(255,255,255,0.06)" stroke-dasharray="4,4"/>';
        gridHtml += '<text x="' + (PAD - 8) + '" y="' + (y + 4) + '" text-anchor="end" fill="rgba(255,255,255,0.3)" font-size="10">' + v + '%</text>';
    });

    // Line path
    var pathD = points.map(function(p, i) { return (i === 0 ? 'M' : 'L') + p.x + ',' + p.y; }).join(' ');

    // Gradient area
    var areaD = pathD + ' L' + points[points.length-1].x + ',' + (PAD + chartH) + ' L' + points[0].x + ',' + (PAD + chartH) + ' Z';

    // Trend calculation
    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    points.forEach(function(p, i) {
        sumX += i; sumY += p.pct; sumXY += i * p.pct; sumX2 += i * i;
    });
    var slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    var avg = Math.round(sumY / n);
    var trendIcon = slope > 0.5 ? '📈' : slope < -0.5 ? '📉' : '➡️';
    var trendText = slope > 0.5 ? 'Đang tiến bộ!' : slope < -0.5 ? 'Cần cố gắng hơn' : 'Ổn định';
    var trendColor = slope > 0.5 ? '#10b981' : slope < -0.5 ? '#f87171' : '#fbbf24';

    // Dots
    var dotsHtml = points.map(function(p) {
        var color = p.pct >= 80 ? '#10b981' : p.pct >= 60 ? '#fbbf24' : '#f87171';
        var dateStr = new Date(p.date).toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit' });
        return '<circle cx="' + p.x + '" cy="' + p.y + '" r="4" fill="' + color + '" stroke="#1a1a2e" stroke-width="2">' +
            '<title>' + dateStr + ': ' + p.pct + '% — ' + (typeof escHtml === 'function' ? escHtml(p.title) : p.title) + '</title></circle>';
    }).join('');

    container.innerHTML =
        '<div class="an-trend-header">' +
            '<div class="an-trend-avg">Trung bình: <strong>' + avg + '%</strong></div>' +
            '<div class="an-trend-badge" style="color:' + trendColor + '">' + trendIcon + ' ' + trendText + '</div>' +
        '</div>' +
        '<div class="an-trend-chart">' +
            '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' +
                '<defs>' +
                    '<linearGradient id="anTrendGrad" x1="0" y1="0" x2="0" y2="1">' +
                        '<stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.3"/>' +
                        '<stop offset="100%" stop-color="#8b5cf6" stop-opacity="0.02"/>' +
                    '</linearGradient>' +
                '</defs>' +
                gridHtml +
                '<path d="' + areaD + '" fill="url(#anTrendGrad)"/>' +
                '<path d="' + pathD + '" fill="none" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
                dotsHtml +
            '</svg>' +
        '</div>' +
        '<div class="an-trend-footer">' + last20.length + ' lần quiz gần nhất</div>';
}

// ═══════════════════════════════════════════════════
// WEEKLY REPORT
// ═══════════════════════════════════════════════════

function _anRenderWeeklyReport(g, history) {
    var container = document.getElementById('anWeeklyReport');
    if (!container) return;

    var now = new Date(); now.setHours(0,0,0,0);
    var weekStart = new Date(now); weekStart.setDate(now.getDate() - 6);
    var weekStartStr = weekStart.toISOString().slice(0,10);

    // This week videos
    var weekVideos = 0;
    history.forEach(function(h) {
        var d = new Date(h.savedAt || h.analyzedAt).toISOString().slice(0,10);
        if (d >= weekStartStr) weekVideos++;
    });

    // This week study days
    var weekStudyDays = 0;
    (g.studyDates || []).forEach(function(d) { if (d >= weekStartStr) weekStudyDays++; });

    // This week quiz scores
    var weekQuizScores = [];
    var seenV = {};
    history.forEach(function(h) {
        if (seenV[h.video_id]) return;
        seenV[h.video_id] = true;
        if (typeof loadProgress === 'function') {
            var prog = loadProgress(h.video_id);
            (prog.quizSessions || []).forEach(function(qs) {
                var d = new Date(qs.date).toISOString().slice(0,10);
                if (d >= weekStartStr) weekQuizScores.push(qs.pct || 0);
            });
        }
    });
    var weekQuizAvg = weekQuizScores.length ? Math.round(weekQuizScores.reduce(function(a,b){return a+b;},0) / weekQuizScores.length) : null;

    // Rating
    var rating, ratingIcon, ratingColor;
    var score = weekStudyDays * 15 + weekVideos * 10 + (weekQuizScores.length * 5);
    if (score >= 80) { rating = 'Xuất sắc'; ratingIcon = '🏆'; ratingColor = '#10b981'; }
    else if (score >= 50) { rating = 'Tốt'; ratingIcon = '⭐'; ratingColor = '#fbbf24'; }
    else if (score >= 20) { rating = 'Khá'; ratingIcon = '👍'; ratingColor = '#60a5fa'; }
    else { rating = 'Cần cố gắng'; ratingIcon = '💪'; ratingColor = '#f87171'; }

    // Day-by-day activity (sparkline)
    var DOW = ['CN','T2','T3','T4','T5','T6','T7'];
    var dayBars = '';
    for (var i = 6; i >= 0; i--) {
        var d = new Date(now); d.setDate(now.getDate() - i);
        var key = d.toISOString().slice(0,10);
        var active = (g.studyDates || []).indexOf(key) >= 0;
        dayBars += '<div class="an-wr-day' + (active ? ' active' : '') + '">' +
            '<div class="an-wr-day-bar' + (active ? ' active' : '') + '"></div>' +
            '<span>' + DOW[d.getDay()] + '</span>' +
        '</div>';
    }

    container.innerHTML =
        '<div class="an-wr-rating" style="color:' + ratingColor + '">' +
            '<span class="an-wr-rating-icon">' + ratingIcon + '</span>' +
            '<span class="an-wr-rating-text">' + rating + '</span>' +
        '</div>' +
        '<div class="an-wr-metrics">' +
            '<div class="an-wr-metric"><span class="an-wr-metric-val">' + weekStudyDays + '/7</span><span class="an-wr-metric-label">Ngày học</span></div>' +
            '<div class="an-wr-metric"><span class="an-wr-metric-val">' + weekVideos + '</span><span class="an-wr-metric-label">Video</span></div>' +
            '<div class="an-wr-metric"><span class="an-wr-metric-val">' + weekQuizScores.length + '</span><span class="an-wr-metric-label">Quiz</span></div>' +
            '<div class="an-wr-metric"><span class="an-wr-metric-val">' + (weekQuizAvg != null ? weekQuizAvg + '%' : '—') + '</span><span class="an-wr-metric-label">Quiz TB</span></div>' +
        '</div>' +
        '<div class="an-wr-days">' + dayBars + '</div>';
}

// ═══════════════════════════════════════════════════
// TOPIC MASTERY (based on tags + quiz scores)
// ═══════════════════════════════════════════════════

function _anRenderTopicMastery(history) {
    var container = document.getElementById('anTopicMastery');
    if (!container) return;

    if (typeof loadAllTags !== 'function' || typeof PREDEFINED_TAGS === 'undefined') {
        container.innerHTML = '<div class="an-empty">Gắn tag cho video để xem topic mastery</div>';
        return;
    }

    var allTags = loadAllTags();
    var tagScores = {};

    history.forEach(function(h) {
        var vid = h.video_id;
        var tags = allTags[vid] || [];
        if (!tags.length) return;

        var scores = [];
        if (typeof loadProgress === 'function') {
            var prog = loadProgress(vid);
            (prog.quizSessions || []).forEach(function(qs) { scores.push(qs.pct || 0); });
        }
        var avgScore = scores.length ? Math.round(scores.reduce(function(a,b){return a+b;},0) / scores.length) : null;

        tags.forEach(function(tagId) {
            if (!tagScores[tagId]) tagScores[tagId] = { count: 0, scores: [], total: 0 };
            tagScores[tagId].count++;
            if (avgScore != null) tagScores[tagId].scores.push(avgScore);
        });
    });

    var tagIds = Object.keys(tagScores);
    if (!tagIds.length) {
        container.innerHTML = '<div class="an-empty">Chưa có dữ liệu. Hãy gắn tag cho video và làm quiz!</div>';
        return;
    }

    tagIds.sort(function(a,b) { return tagScores[b].count - tagScores[a].count; });

    container.innerHTML = tagIds.map(function(tagId) {
        var data = tagScores[tagId];
        var tag = PREDEFINED_TAGS.find(function(t) { return t.id === tagId; }) || { label: tagId, icon: '📌', color: '#6b7280' };
        var avg = data.scores.length ? Math.round(data.scores.reduce(function(a,b){return a+b;},0) / data.scores.length) : null;
        var masteryPct = avg != null ? avg : 0;
        var masteryLabel = avg == null ? 'Chưa quiz' : avg >= 80 ? 'Thành thạo' : avg >= 60 ? 'Khá tốt' : avg >= 40 ? 'Cần ôn' : 'Yếu';
        var masteryColor = avg == null ? '#555' : avg >= 80 ? '#10b981' : avg >= 60 ? '#fbbf24' : avg >= 40 ? '#f97316' : '#ef4444';

        return '<div class="an-tm-row">' +
            '<div class="an-tm-info">' +
                '<span class="an-tm-icon">' + tag.icon + '</span>' +
                '<span class="an-tm-name">' + tag.label + '</span>' +
                '<span class="an-tm-count">' + data.count + ' video</span>' +
            '</div>' +
            '<div class="an-tm-bar-wrap">' +
                '<div class="an-tm-bar" style="width:' + masteryPct + '%;background:' + masteryColor + '"></div>' +
            '</div>' +
            '<div class="an-tm-score" style="color:' + masteryColor + '">' +
                (avg != null ? avg + '%' : '—') +
                '<span class="an-tm-badge">' + masteryLabel + '</span>' +
            '</div>' +
        '</div>';
    }).join('');
}

// ═══════════════════════════════════════════════════
// STUDY HOURS DISTRIBUTION (by day of week)
// ═══════════════════════════════════════════════════

function _anRenderStudyHours(g) {
    var container = document.getElementById('anStudyHours');
    if (!container) return;

    var dowCount = [0,0,0,0,0,0,0];
    (g.studyDates || []).forEach(function(d) {
        var day = new Date(d + 'T00:00:00').getDay();
        dowCount[day]++;
    });

    // Also count from history
    try {
        var history = JSON.parse(localStorage.getItem('lectureDigest_history') || '[]');
        var seenDates = {};
        history.forEach(function(h) {
            var d = new Date(h.savedAt || h.analyzedAt);
            var key = d.toISOString().slice(0,10);
            if (!seenDates[key]) {
                seenDates[key] = true;
                dowCount[d.getDay()]++;
            }
        });
    } catch(e) {}

    var maxCount = Math.max.apply(null, dowCount) || 1;
    var DOW = ['CN','T2','T3','T4','T5','T6','T7'];
    var COLORS = ['#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#f97316'];

    // Find most active day
    var bestDay = 0;
    dowCount.forEach(function(c, i) { if (c > dowCount[bestDay]) bestDay = i; });

    container.innerHTML =
        '<div class="an-sh-chart">' +
            dowCount.map(function(count, i) {
                var pct = Math.round(count / maxCount * 100);
                return '<div class="an-sh-col">' +
                    '<div class="an-sh-val">' + count + '</div>' +
                    '<div class="an-sh-track"><div class="an-sh-fill" style="height:' + Math.max(4, pct) + '%;background:' + COLORS[i] + '"></div></div>' +
                    '<div class="an-sh-label">' + DOW[i] + '</div>' +
                '</div>';
            }).join('') +
        '</div>' +
        '<div class="an-sh-insight">Bạn học nhiều nhất vào <strong style="color:#8b5cf6">' + DOW[bestDay] + '</strong></div>';
}
