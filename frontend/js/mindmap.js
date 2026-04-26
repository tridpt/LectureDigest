/* ════════════════════════════════════════════════
   LectureDigest — Mind Map (D3.js radial tree)
   ════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════════════
// MIND MAP  (D3.js radial tree)
// ══════════════════════════════════════════════════════════

let mmZoom = null;

// ── Build D3 hierarchy data from analysisData ──
function buildMindMapData(d) {
    const truncate = (s, n) => s && s.length > n ? s.slice(0, n - 1) + '…' : (s || '');

    const root = {
        name: truncate(d.title || 'Video', 50),
        type: 'root',
        children: []
    };

    // Chapters branch
    if (d.chapters && d.chapters.length) {
        root.children.push({
            name: '📑 Chapters',
            type: 'category',
            color: '#4f46e5',
            children: d.chapters.map(c => ({
                name: truncate(c.title, 999),
                type: 'chapter',
                extra: c.timestamp_str || '',
                color: '#4f46e5'
            }))
        });
    }

    // Key Takeaways branch
    if (d.key_takeaways && d.key_takeaways.length) {
        root.children.push({
            name: '💡 Takeaways',
            type: 'category',
            color: '#0891b2',
            children: d.key_takeaways.map(t => ({
                name: truncate(t, 999),
                type: 'takeaway',
                color: '#0891b2'
            }))
        });
    }

    // Highlights branch
    if (d.highlights && d.highlights.length) {
        root.children.push({
            name: '🔥 Key Moments',
            type: 'category',
            color: '#b45309',
            children: d.highlights.map(h => ({
                name: truncate(h.title, 999),
                type: 'highlight',
                extra: h.timestamp_str || '',
                color: '#b45309'
            }))
        });
    }

    // Key Terms from key_terms or vocabulary
    const terms = d.key_terms || d.vocabulary || [];
    if (terms.length) {
        root.children.push({
            name: '📖 Terms',
            type: 'category',
            color: '#059669',
            children: terms.slice(0, 12).map(t => ({
                name: truncate(typeof t === 'string' ? t : (t.term || t.word || ''), 999),
                type: 'term',
                color: '#059669'
            }))
        });
    }

    return root;
}

function openMindMap() {
    if (!analysisData) return;

    const overlay = document.getElementById('mmModalOverlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Set title
    const titleEl = document.getElementById('mmTitle');
    const vid = analysisData.title || 'Sơ đồ tư duy';
    if (titleEl) titleEl.textContent = vid.length > 50 ? vid.slice(0, 48) + '…' : vid;

    // Render after DOM is ready
    setTimeout(() => renderMindMap(), 50);

    document.addEventListener('keydown', mmKeyHandler);
}

function closeMindMap() {
    document.getElementById('mmModalOverlay')?.classList.add('hidden');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', mmKeyHandler);
}

function mmKeyHandler(e) {
    if (e.key === 'Escape') closeMindMap();
}

// ── Word-wrap helper for mind map labels — no truncation ──
function wrapText(str, limit) {
    const words = str.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
        if (cur && (cur + ' ' + w).length > limit) {
            lines.push(cur);
            cur = w;
        } else {
            cur = cur ? cur + ' ' + w : w;
        }
    }
    if (cur) lines.push(cur);
    return lines;
}

function renderMindMap() {
    recordGamifFeature('usedMindMap');
    const svg = d3.select('#mmSvg');
    svg.selectAll('*').remove();

    const area = document.getElementById('mmCanvasArea');
    const W    = area.clientWidth  || 960;
    const H    = area.clientHeight || 580;

    // Detect light mode for color adaptation
    const isLight = document.documentElement.classList.contains('light-mode');
    const strokeBg = isLight ? '#f8f9fc' : '#08081a';

    const COLORS_DARK = {
        root:     { node: '#7c3aed', glow: '#7c3aed', text: '#f1f1f1'  },
        category: { node: '#7c3aed', glow: '#9333ea', text: '#e9d5ff'  },
        chapter:  { node: '#4338ca', glow: '#6366f1', text: '#c7d2fe'  },
        takeaway: { node: '#0e7490', glow: '#22d3ee', text: '#a5f3fc'  },
        highlight:{ node: '#92400e', glow: '#f59e0b', text: '#fde68a'  },
        term:     { node: '#065f46', glow: '#10b981', text: '#a7f3d0'  },
    };
    const COLORS_LIGHT = {
        root:     { node: '#7c3aed', glow: '#7c3aed', text: '#1e1b4b'  },
        category: { node: '#7c3aed', glow: '#9333ea', text: '#3730a3'  },
        chapter:  { node: '#4338ca', glow: '#6366f1', text: '#312e81'  },
        takeaway: { node: '#0e7490', glow: '#22d3ee', text: '#155e75'  },
        highlight:{ node: '#92400e', glow: '#f59e0b', text: '#78350f'  },
        term:     { node: '#065f46', glow: '#10b981', text: '#064e3b'  },
    };
    const COLORS = isLight ? COLORS_LIGHT : COLORS_DARK;
    const getColor = (d, prop) => (COLORS[d.data.type] || COLORS.chapter)[prop];

    // ── Build data + layout ──
    const rawData = buildMindMapData(analysisData);
    const root    = d3.hierarchy(rawData);
    const leaves  = root.leaves().length;

    // Enough radius so leaf labels don't overlap
    // base radius for depth-1 nodes, leafR for depth-2
    const innerR = Math.min(W, H) * 0.20;
    const outerR = Math.min(W, H) * 0.44;

    const treeLayout = d3.tree()
        .size([2 * Math.PI, outerR])
        .separation((a, b) => {
            if (a.depth === 0 || b.depth === 0) return 1;
            return (a.parent === b.parent ? 1.3 : 2.2) / a.depth;
        });

    treeLayout(root);

    // Push depth-1 nodes to innerR
    root.each(d => { if (d.depth === 1) d.y = innerR; });

    // ── SVG defs — glow filters ──
    const defs = svg.append('defs');
    Object.entries(COLORS).forEach(([type, col]) => {
        const f = defs.append('filter')
            .attr('id', 'glow-' + type)
            .attr('x', '-80%').attr('y', '-80%')
            .attr('width', '260%').attr('height', '260%');
        f.append('feGaussianBlur').attr('stdDeviation', '5').attr('result', 'blur');
        const fm = f.append('feMerge');
        fm.append('feMergeNode').attr('in', 'blur');
        fm.append('feMergeNode').attr('in', 'SourceGraphic');
    });

    // ── Main group + zoom ──
    const g = svg.append('g').attr('id', 'mmGroup');

    mmZoom = d3.zoom()
        .scaleExtent([0.25, 5])
        .on('zoom', ev => g.attr('transform', ev.transform));

    svg.call(mmZoom)
       .attr('width', W).attr('height', H)
       .call(mmZoom.transform, d3.zoomIdentity.translate(W/2, H/2));

    // Helper: radial → cartesian
    const pt = (angle, r) => [Math.sin(angle) * r, -Math.cos(angle) * r];

    // ── Links ──
    g.selectAll('.mm-link')
        .data(root.links())
        .join('path')
        .attr('class', 'mm-link')
        .attr('d', d3.linkRadial().angle(d => d.x).radius(d => d.y))
        .attr('fill', 'none')
        .attr('stroke', d => getColor(d.target, 'glow'))
        .attr('stroke-width', d => d.target.depth === 1 ? 2.5 : 1.5)
        .attr('stroke-opacity', d => d.target.depth === 1 ? 0.55 : 0.35)
        .attr('stroke-linecap', 'round');

    // ── Nodes ──
    const node = g.selectAll('.mm-node')
        .data(root.descendants())
        .join('g')
        .attr('class', 'mm-node')
        .attr('transform', d => {
            const [x, y] = pt(d.x, d.y);
            return 'translate(' + x + ',' + y + ')';
        });

    // Glow halo for depth 0-1
    node.filter(d => d.depth <= 1)
        .append('circle')
        .attr('r', d => d.depth === 0 ? 26 : 16)
        .attr('fill', d => getColor(d, 'node'))
        .attr('opacity', 0.18)
        .attr('filter', d => 'url(#glow-' + d.data.type + ')');

    // Main circle
    node.append('circle')
        .attr('r', d => d.depth === 0 ? 14 : d.depth === 1 ? 9 : 5)
        .attr('fill', d => getColor(d, 'node'))
        .attr('stroke', strokeBg)
        .attr('stroke-width', d => d.depth === 0 ? 3 : 2)
        .attr('filter', d => d.depth <= 1 ? 'url(#glow-' + d.data.type + ')' : null);

    // ── Labels — carefully positioned, no overlap ──
    node.each(function(d) {
        const el = d3.select(this);
        const [nx, ny] = pt(d.x, d.y);   // absolute pos (relative to g center)

        if (d.depth === 0) {
            // Root: short title BELOW the circle
            const short = (analysisData.title || 'Video').slice(0, 28);
            const label = short.length < (analysisData.title || '').length ? short + '…' : short;
            el.append('text')
              .attr('y', 24)
              .attr('text-anchor', 'middle')
              .attr('font-size', '11px')
              .attr('font-weight', '600')
              .attr('fill', isLight ? '#4c1d95' : '#c4b5fd')
              .attr('font-family', 'Inter, system-ui, sans-serif')
              .style('paint-order', 'stroke')
              .style('stroke', strokeBg)
              .style('stroke-width', '3px')
              .text(label);
            return;
        }

        // Determine left vs right based on x-coordinate of THIS node
        const isRight = nx >= 0;
        const pad = d.depth === 1 ? 15 : 10;

        const txt = el.append('text')
            .attr('dy', '0.35em')
            .attr('x', isRight ? pad : -pad)
            .attr('text-anchor', isRight ? 'start' : 'end')
            .attr('font-size', d.depth === 1 ? '11.5px' : '10px')
            .attr('font-weight', d.depth === 1 ? '700' : '400')
            .attr('fill', getColor(d, 'text'))
            .attr('font-family', 'Inter, system-ui, sans-serif')
            .style('paint-order', 'stroke')
            .style('stroke', strokeBg)
            .style('stroke-width', '4px');

        // Wrap text into ≤ 2 tspan lines of ~22 chars each
        const name  = d.data.name || '';
        const LIMIT = d.depth === 1 ? 24 : 22;
        if (name.length <= LIMIT) {
            txt.text(name);
        } else {
            // Break at space near LIMIT
            const sp = name.lastIndexOf(' ', LIMIT);
            const ln1 = name.slice(0, sp > 0 ? sp : LIMIT);
            const ln2 = name.slice(sp > 0 ? sp + 1 : LIMIT);
            const short2 = ln2.length > LIMIT ? ln2.slice(0, LIMIT - 1) + '…' : ln2;
            txt.append('tspan')
               .attr('x', isRight ? pad : -pad)
               .attr('dy', '-0.6em')
               .text(ln1);
            txt.append('tspan')
               .attr('x', isRight ? pad : -pad)
               .attr('dy', '1.2em')
               .text(short2);
        }
    });

    // ── Tooltip ──
    const tooltip = document.getElementById('mmTooltip');
    node.filter(d => d.depth > 0)
        .on('mouseover', function(event, d) {
            if (!tooltip) return;
            const txt = d.data.name + (d.data.extra ? '\n⏱ ' + d.data.extra : '');
            tooltip.textContent = txt;
            tooltip.classList.remove('hidden');
            moveTooltip(event);
        })
        .on('mousemove', moveTooltip)
        .on('mouseleave', () => tooltip?.classList.add('hidden'));

    function moveTooltip(event) {
        if (!tooltip) return;
        const rect = area.getBoundingClientRect();
        tooltip.style.left = (event.clientX - rect.left + 14) + 'px';
        tooltip.style.top  = (event.clientY - rect.top  - 10) + 'px';
    }

    g.style('opacity', 0).transition().duration(500).style('opacity', 1);
}


function mmResetZoom() {
    const area = document.getElementById('mmCanvasArea');
    const W = area?.clientWidth || 900;
    const H = area?.clientHeight || 560;
    const svg = d3.select('#mmSvg');
    if (mmZoom) svg.transition().duration(400)
        .call(mmZoom.transform, d3.zoomIdentity.translate(W / 2, H / 2));
}

function mmDownload() {
    const svgEl = document.getElementById('mmSvg');
    if (!svgEl) return;

    // Inline styles into SVG for export
    const serializer  = new XMLSerializer();
    let   svgStr      = serializer.serializeToString(svgEl);

    // Inject background (light or dark)
    const isLight = document.documentElement.classList.contains('light-mode');
    const bgColor = isLight ? '#f8f9fc' : '#0f0f1e';
    svgStr = svgStr.replace('<svg', '<svg style="background:' + bgColor + '"');

    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);

    // Convert to PNG via canvas
    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width  = svgEl.clientWidth  * 2;
        canvas.height = svgEl.clientHeight * 2;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);

        canvas.toBlob(blob2 => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob2);
            const slug = (analysisData?.title || 'mindmap').slice(0, 30).replace(/\s+/g, '_');
            a.download = slug + '_mindmap.png';
            a.click();
        }, 'image/png');
    };
    img.src = url;
    showToast('⬇ Đang tải xuống PNG...', 2000);
}

