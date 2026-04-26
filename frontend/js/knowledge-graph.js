/* ════════════════════════════════════════════════
   LectureDigest — Knowledge Graph
   ════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════
// KNOWLEDGE GRAPH
// ══════════════════════════════════════════════════════

var _kgZoom = null;
var _kgShowLabels = true;
var _kgSimulation = null;

var KG_COLORS = [
    '#8b5cf6','#3b82f6','#10b981','#f59e0b','#ef4444',
    '#ec4899','#06b6d4','#84cc16','#f97316','#6366f1',
    '#14b8a6','#e879f9','#facc15','#fb7185','#38bdf8'
];

function openKnowledgeGraph() {
    var section = document.getElementById('kgSection');
    if (section) section.classList.remove('hidden');
    renderKnowledgeGraph();
}

function closeKnowledgeGraph() {
    var section = document.getElementById('kgSection');
    if (section) section.classList.add('hidden');
    if (_kgSimulation) { _kgSimulation.stop(); _kgSimulation = null; }
    closeKgDetail();
}

function buildKgData() {
    var history = [];
    try { history = JSON.parse(localStorage.getItem('lectureDigest_history') || '[]'); } catch(e) {}
    if (!history.length) return null;

    var nodes = [];
    var links = [];
    var conceptIndex = {};  // normalized label -> concept node id
    var STOP = new Set(['the','a','an','and','or','of','to','in','for','is','on','with','by','from','at','as','it','that','this','be','are','was','were','been','being','have','has','had','having','do','does','did','will','would','could','should','may','might','shall','can','need','dare','ought','used','use','using','how','what','when','where','which','who','whom','whose','why','about','into','through','during','before','after','above','below','between','under','again','further','then','once','here','there','all','each','every','both','few','more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','just','also','even','still','already','always','never','often']);

    history.forEach(function(entry, vi) {
        var title = entry.title || (entry.data && entry.data.title) || 'Video ' + (vi + 1);
        var videoId = entry.video_id || 'v' + vi;
        var color = KG_COLORS[vi % KG_COLORS.length];
        var vNodeId = 'video_' + vi;

        nodes.push({
            id: vNodeId, label: title, type: 'video',
            videoId: videoId, color: color, group: vi,
            r: 22
        });

        // Extract topics from the nested data object
        var topics = (entry.data && entry.data.topics) || entry.topics || [];
        topics.forEach(function(topic) {
            var tLabel = (topic.title || '').trim();
            if (!tLabel) return;
            var norm = tLabel.toLowerCase().trim();
            if (!norm || norm.length < 2) return;

            var cNodeId;
            if (conceptIndex[norm]) {
                cNodeId = conceptIndex[norm].id;
                conceptIndex[norm].videos.push(vi);
                conceptIndex[norm].videoIds.push(videoId);
            } else {
                cNodeId = 'concept_' + Object.keys(conceptIndex).length;
                conceptIndex[norm] = {
                    id: cNodeId, label: tLabel, type: 'concept',
                    emoji: topic.emoji || '📌',
                    videos: [vi], videoIds: [videoId],
                    words: norm.split(/\s+/).filter(function(w) { return w.length > 2 && !STOP.has(w.toLowerCase()); }),
                    r: 10, color: color
                };
            }
            links.push({ source: vNodeId, target: cNodeId, type: 'direct' });
        });
    });

    // Add concept nodes
    var conceptList = Object.values(conceptIndex);
    conceptList.forEach(function(c) {
        // Color = first video's color, or blended
        if (c.videos.length > 1) c.color = '#fbbf24'; // gold for shared
        c.r = c.videos.length > 1 ? 14 : 10;
        nodes.push(c);
    });

    // Cross-video concept links: find concepts with overlapping keywords
    for (var i = 0; i < conceptList.length; i++) {
        for (var j = i + 1; j < conceptList.length; j++) {
            var a = conceptList[i], b = conceptList[j];
            // Skip if same video set
            if (a.videos.length === 1 && b.videos.length === 1 && a.videos[0] === b.videos[0]) continue;
            // Count shared words
            var shared = 0;
            for (var w = 0; w < a.words.length; w++) {
                if (b.words.indexOf(a.words[w]) >= 0) shared++;
            }
            if (shared >= 2 || (shared >= 1 && Math.min(a.words.length, b.words.length) <= 2)) {
                links.push({ source: a.id, target: b.id, type: 'cross' });
            }
        }
    }

    return { nodes: nodes, links: links, videoCount: history.length, conceptCount: conceptList.length };
}

function renderKnowledgeGraph() {
    var data = buildKgData();
    var emptyEl = document.getElementById('kgEmpty');
    var svgEl = document.getElementById('kgSvg');
    if (!data || data.nodes.length < 2) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        if (svgEl) svgEl.innerHTML = '';
        return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');

    var subtitleEl = document.getElementById('kgSubtitle');
    if (subtitleEl) subtitleEl.textContent = data.videoCount + ' video · ' + data.conceptCount + ' khai niem · ' + data.links.length + ' lien ket';

    // Build legend
    var legendEl = document.getElementById('kgLegend');
    if (legendEl) {
        var history = [];
        try { history = JSON.parse(localStorage.getItem('lectureDigest_history') || '[]'); } catch(e) {}
        var legendHtml = '';
        history.forEach(function(entry, vi) {
            var t = (entry.title || (entry.data && entry.data.title) || 'Video ' + (vi+1));
            if (t.length > 25) t = t.substring(0, 25) + '...';
            legendHtml += '<span class="kg-legend-item"><span class="kg-legend-dot" style="background:' + KG_COLORS[vi % KG_COLORS.length] + '"></span>' + t + '</span>';
        });
        legendHtml += '<span class="kg-legend-item"><span class="kg-legend-dot" style="background:#fbbf24"></span>Shared concept</span>';
        legendHtml += '<span class="kg-legend-hint">🖱 Scroll zoom · Keo di chuyen · Click xem chi tiet</span>';
        legendEl.innerHTML = legendHtml;
    }

    // D3 rendering
    var container = document.getElementById('kgCanvasWrap');
    var W = container.clientWidth || 900;
    var H = container.clientHeight || 600;

    var svg = d3.select('#kgSvg').html('')
        .attr('viewBox', [0, 0, W, H].join(' '));

    var g = svg.append('g');

    _kgZoom = d3.zoom()
        .scaleExtent([0.2, 4])
        .on('zoom', function(event) { g.attr('transform', event.transform); });
    svg.call(_kgZoom);

    // Links
    var link = g.selectAll('.kg-link')
        .data(data.links)
        .enter().append('line')
        .attr('class', function(d) { return d.type === 'cross' ? 'kg-link kg-link-cross' : 'kg-link'; });

    // Nodes
    var node = g.selectAll('.kg-node')
        .data(data.nodes)
        .enter().append('g')
        .attr('class', 'kg-node')
        .style('cursor', 'pointer')
        .on('click', function(event, d) { showKgDetail(d, data); })
        .call(d3.drag()
            .on('start', function(event, d) {
                if (!event.active) _kgSimulation.alphaTarget(0.3).restart();
                d.fx = d.x; d.fy = d.y;
            })
            .on('drag', function(event, d) { d.fx = event.x; d.fy = event.y; })
            .on('end', function(event, d) {
                if (!event.active) _kgSimulation.alphaTarget(0);
                d.fx = null; d.fy = null;
            })
        );

    // Node circles
    node.append('circle')
        .attr('r', function(d) { return d.r; })
        .attr('fill', function(d) { return d.color; })
        .attr('fill-opacity', function(d) { return d.type === 'video' ? 0.85 : 0.6; })
        .attr('stroke', function(d) { return d.color; })
        .attr('stroke-width', function(d) { return d.type === 'video' ? 3 : 1.5; })
        .attr('stroke-opacity', 0.3);

    // Emoji for video nodes
    node.filter(function(d) { return d.type === 'video'; })
        .append('text')
        .text('🎬')
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .style('font-size', '14px')
        .style('pointer-events', 'none');

    // Emoji for concept nodes
    node.filter(function(d) { return d.type === 'concept' && d.emoji; })
        .append('text')
        .text(function(d) { return d.emoji; })
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .style('font-size', '10px')
        .style('pointer-events', 'none');

    // Labels
    var labels = node.append('text')
        .attr('class', function(d) { return d.type === 'video' ? 'kg-node-label kg-node-label-video' : 'kg-node-label'; })
        .attr('dy', function(d) { return d.r + 13; })
        .text(function(d) {
            var t = d.label || '';
            return t.length > 20 ? t.substring(0, 20) + '...' : t;
        })
        .style('display', _kgShowLabels ? 'block' : 'none');

    // Hover
    node.on('mouseenter', function(event, d) {
            d3.select(this).select('circle')
                .transition().duration(200)
                .attr('r', d.r * 1.3)
                .attr('fill-opacity', 1);
        })
        .on('mouseleave', function(event, d) {
            d3.select(this).select('circle')
                .transition().duration(200)
                .attr('r', d.r)
                .attr('fill-opacity', d.type === 'video' ? 0.85 : 0.6);
        });

    // Force simulation
    _kgSimulation = d3.forceSimulation(data.nodes)
        .force('link', d3.forceLink(data.links).id(function(d) { return d.id; }).distance(function(d) {
            return d.type === 'cross' ? 120 : 70;
        }))
        .force('charge', d3.forceManyBody().strength(function(d) {
            return d.type === 'video' ? -300 : -80;
        }))
        .force('center', d3.forceCenter(W / 2, H / 2))
        .force('collision', d3.forceCollide().radius(function(d) { return d.r + 8; }))
        .on('tick', function() {
            link
                .attr('x1', function(d) { return d.source.x; })
                .attr('y1', function(d) { return d.source.y; })
                .attr('x2', function(d) { return d.target.x; })
                .attr('y2', function(d) { return d.target.y; });
            node.attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });
        });
}

function showKgDetail(d, graphData) {
    var panel = document.getElementById('kgDetailPanel');
    var content = document.getElementById('kgDetailContent');
    if (!panel || !content) return;

    var history = [];
    try { history = JSON.parse(localStorage.getItem('lectureDigest_history') || '[]'); } catch(e) {}

    var html = '';

    if (d.type === 'video') {
        html += '<div class="kg-detail-type kg-detail-type-video">Video</div>';
        html += '<div class="kg-detail-name">' + d.label + '</div>';
        // Find connected concepts
        var concepts = graphData.nodes.filter(function(n) {
            if (n.type !== 'concept') return false;
            return graphData.links.some(function(l) {
                var src = typeof l.source === 'object' ? l.source.id : l.source;
                var tgt = typeof l.target === 'object' ? l.target.id : l.target;
                return (src === d.id && tgt === n.id) || (tgt === d.id && src === n.id);
            });
        });
        html += '<div class="kg-detail-meta">' + concepts.length + ' khai niem duoc trich xuat</div>';
        if (concepts.length) {
            html += '<div class="kg-detail-section-title">Cac khai niem</div>';
            html += '<ul class="kg-detail-list">';
            concepts.forEach(function(c) {
                var shared = c.videos && c.videos.length > 1 ? ' <span style="color:#fbbf24;font-size:10px">(shared)</span>' : '';
                html += '<li>' + (c.emoji || '') + ' ' + c.label + shared + '</li>';
            });
            html += '</ul>';
        }
    } else {
        html += '<div class="kg-detail-type kg-detail-type-concept">Khai niem</div>';
        html += '<div class="kg-detail-name">' + (d.emoji || '') + ' ' + d.label + '</div>';
        // Show which videos
        if (d.videos && d.videos.length) {
            var videoNames = d.videos.map(function(vi) {
                var entry = history[vi];
                return (entry && (entry.title || (entry.data && entry.data.title))) || 'Video ' + (vi + 1);
            });
            html += '<div class="kg-detail-meta">Xuat hien trong ' + d.videos.length + ' video</div>';
            html += '<div class="kg-detail-section-title">Videos</div>';
            html += '<ul class="kg-detail-list">';
            videoNames.forEach(function(name, i) {
                html += '<li style="border-left:3px solid ' + KG_COLORS[d.videos[i] % KG_COLORS.length] + '">' + name + '</li>';
            });
            html += '</ul>';
        }
        // Show related concepts (cross links)
        var related = graphData.nodes.filter(function(n) {
            if (n.id === d.id || n.type !== 'concept') return false;
            return graphData.links.some(function(l) {
                if (l.type !== 'cross') return false;
                var src = typeof l.source === 'object' ? l.source.id : l.source;
                var tgt = typeof l.target === 'object' ? l.target.id : l.target;
                return (src === d.id && tgt === n.id) || (tgt === d.id && src === n.id);
            });
        });
        if (related.length) {
            html += '<div class="kg-detail-section-title">Khai niem lien quan</div>';
            html += '<ul class="kg-detail-list">';
            related.forEach(function(r) {
                html += '<li>' + (r.emoji || '') + ' ' + r.label + '</li>';
            });
            html += '</ul>';
        }
    }

    content.innerHTML = html;
    panel.classList.remove('hidden');
}

function closeKgDetail() {
    var panel = document.getElementById('kgDetailPanel');
    if (panel) panel.classList.add('hidden');
}

function kgResetZoom() {
    var svg = d3.select('#kgSvg');
    if (_kgZoom) svg.transition().duration(500).call(_kgZoom.transform, d3.zoomIdentity);
}

function kgToggleLabels() {
    _kgShowLabels = !_kgShowLabels;
    d3.selectAll('.kg-node-label').style('display', _kgShowLabels ? 'block' : 'none');
    var btn = document.getElementById('kgLabelBtn');
    if (btn) btn.style.opacity = _kgShowLabels ? '1' : '0.5';
}

