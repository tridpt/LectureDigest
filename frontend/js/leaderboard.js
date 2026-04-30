/* ════════════════════════════════════════════════
   LectureDigest — Leaderboard
   ════════════════════════════════════════════════ */

let _lbData = null;

function openLeaderboard() {
    const overlay = document.getElementById('leaderboardOverlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    overlay.querySelector('.lb-modal')?.classList.add('lb-enter');
    setTimeout(() => overlay.querySelector('.lb-modal')?.classList.remove('lb-enter'), 300);
    fetchLeaderboard();
}

function closeLeaderboard() {
    const overlay = document.getElementById('leaderboardOverlay');
    if (overlay) overlay.classList.add('hidden');
}

async function fetchLeaderboard() {
    const body = document.getElementById('lbBody');
    if (!body) return;

    body.innerHTML = '<div class="lb-loading"><span class="lb-spinner"></span> Đang tải bảng xếp hạng...</div>';

    try {
        const headers = {};
        if (_authToken) headers['Authorization'] = 'Bearer ' + _authToken;

        const res = await fetch(API_BASE + '/api/auth/leaderboard', { headers });
        if (!res.ok) throw new Error('Failed');
        _lbData = await res.json();

        renderLeaderboard(_lbData);
    } catch (e) {
        body.innerHTML = '<div class="lb-empty">❌ Không thể tải bảng xếp hạng</div>';
    }
}

function renderLeaderboard(data) {
    const body = document.getElementById('lbBody');
    if (!body) return;

    const entries = data.entries || [];
    const currentUserId = data.current_user_id;

    if (!entries.length) {
        body.innerHTML = '<div class="lb-empty"><div class="lb-empty-icon">🏆</div><p>Chưa có ai trên bảng xếp hạng!</p><p class="lb-empty-hint">Hãy phân tích video và làm quiz để lên bảng.</p></div>';
        return;
    }

    // Top 3 podium
    const top3 = entries.slice(0, 3);
    const rest = entries.slice(3);

    let html = '';

    // Podium
    if (top3.length) {
        html += '<div class="lb-podium">';
        // Order: 2nd, 1st, 3rd for visual layout
        const order = top3.length >= 3 ? [top3[1], top3[0], top3[2]] : (top3.length >= 2 ? [top3[1], top3[0]] : [top3[0]]);
        const ranks = top3.length >= 3 ? [2, 1, 3] : (top3.length >= 2 ? [2, 1] : [1]);
        const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
        const heights = { 1: '120px', 2: '90px', 3: '70px' };

        order.forEach((entry, i) => {
            const rank = ranks[i];
            const isMe = entry.user_id === currentUserId;
            const initials = _lbGetInitials(entry.display_name);
            const avatar = entry.avatar_url
                ? '<img class="lb-podium-avatar-img" src="' + entry.avatar_url + '" alt="" referrerpolicy="no-referrer">'
                : '<span class="lb-podium-avatar" style="background:' + entry.avatar_color + '">' + initials + '</span>';

            html += '<div class="lb-podium-item lb-rank-' + rank + (isMe ? ' lb-me' : '') + '">';
            html += '<div class="lb-podium-medal">' + medals[rank] + '</div>';
            html += avatar;
            html += '<div class="lb-podium-name">' + _lbEscape(entry.display_name) + '</div>';
            html += '<div class="lb-podium-score">' + entry.score + ' điểm</div>';
            html += '<div class="lb-podium-bar" style="height:' + heights[rank] + '"></div>';
            html += '</div>';
        });
        html += '</div>';
    }

    // Table for rest
    if (rest.length || top3.length) {
        html += '<div class="lb-table">';
        html += '<div class="lb-table-header"><span class="lb-th-rank">#</span><span class="lb-th-name">Người học</span><span class="lb-th-stat">📚</span><span class="lb-th-stat">🧠</span><span class="lb-th-stat">🔥</span><span class="lb-th-stat">🍅</span><span class="lb-th-score">Điểm</span></div>';

        entries.forEach((entry, idx) => {
            const rank = idx + 1;
            const isMe = entry.user_id === currentUserId;
            const initials = _lbGetInitials(entry.display_name);
            const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
            const rankLabel = medals[rank] || rank;
            const avatar = entry.avatar_url
                ? '<img class="lb-row-avatar-img" src="' + entry.avatar_url + '" alt="" referrerpolicy="no-referrer">'
                : '<span class="lb-row-avatar" style="background:' + entry.avatar_color + '">' + initials + '</span>';

            html += '<div class="lb-row' + (isMe ? ' lb-row-me' : '') + (rank <= 3 ? ' lb-row-top' : '') + '">';
            html += '<span class="lb-rank">' + rankLabel + '</span>';
            html += '<div class="lb-user">' + avatar + '<span class="lb-name">' + _lbEscape(entry.display_name) + (isMe ? ' <span class="lb-you">(bạn)</span>' : '') + '</span></div>';
            html += '<span class="lb-stat">' + entry.total_videos + '</span>';
            html += '<span class="lb-stat">' + entry.total_quizzes + '</span>';
            html += '<span class="lb-stat">' + entry.current_streak + '</span>';
            html += '<span class="lb-stat">' + entry.pomo_sessions + '</span>';
            html += '<span class="lb-score">' + entry.score + '</span>';
            html += '</div>';
        });
        html += '</div>';
    }

    // Legend
    html += '<div class="lb-legend">📚 Video &nbsp; 🧠 Quiz &nbsp; 🔥 Streak &nbsp; 🍅 Pomodoro</div>';

    body.innerHTML = html;
}

/* ── Helpers ── */
function _lbGetInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
}

function _lbEscape(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}
