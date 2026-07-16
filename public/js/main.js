/* ============================================================
   NEON TEAMWORK — Frontend JavaScript
   ============================================================ */

// ─── Notification Panel ──────────────────────────────────────
const notifBell = document.getElementById('notifBell');
const notifPanel = document.getElementById('notifPanel');
if (notifBell && notifPanel) {
  notifBell.addEventListener('click', (e) => {
    e.stopPropagation();
    notifPanel.classList.toggle('open');
  });
  document.addEventListener('click', () => notifPanel.classList.remove('open'));
  notifPanel.addEventListener('click', e => e.stopPropagation());
}

// ─── Modal helpers ──────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}
document.querySelectorAll('[data-modal-open]').forEach(btn => {
  btn.addEventListener('click', () => openModal(btn.dataset.modalOpen));
});
document.querySelectorAll('[data-modal-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.modalClose));
});
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

// ─── Copy to clipboard ──────────────────────────────────────
function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn ? btn.innerHTML : '';
    if (btn) {
      btn.innerHTML = '✅';
      btn.style.color = 'var(--green)';
      setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 1500);
    }
  });
}

// ─── Flash auto-hide ────────────────────────────────────────
setTimeout(() => {
  document.querySelectorAll('.flash').forEach(el => {
    el.style.transition = 'opacity 0.5s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 500);
  });
}, 4000);

// ─── Confirm delete ─────────────────────────────────────────
document.querySelectorAll('[data-confirm]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    if (!confirm(btn.dataset.confirm || 'Bạn có chắc chắn không?')) {
      e.preventDefault();
    }
  });
});

// ─── Progress bar animate ────────────────────────────────────
document.querySelectorAll('.progress-fill[data-pct]').forEach(bar => {
  const pct = bar.dataset.pct;
  setTimeout(() => { bar.style.width = pct + '%'; }, 200);
});

// ─── Priority badge colors ───────────────────────────────────
const PRIORITY_BADGE = {
  urgent: 'badge-red',
  high:   'badge-pink',
  medium: 'badge-yellow',
  low:    'badge-dim'
};
const PRIORITY_LABEL = { urgent: '🔴 Khẩn', high: '🟠 Cao', medium: '🟡 Trung', low: '⚪ Thấp' };
const STATUS_BADGE = {
  todo:        'badge-dim',
  in_progress: 'badge-cyan',
  submitted:   'badge-yellow',
  approved:    'badge-green',
  rejected:    'badge-red'
};
const STATUS_LABEL = {
  todo: 'Chưa làm', in_progress: 'Đang làm',
  submitted: 'Đã nộp', approved: '✅ Duyệt', rejected: '❌ Từ chối'
};
const ROLE_LABEL = {
  leader: '👑 Nhóm trưởng', vice_leader: '⭐ Phó nhóm',
  member: '👤 Thành viên', custom: '🎯 Tùy chỉnh'
};
const ROLE_BADGE = {
  leader: 'badge-cyan', vice_leader: 'badge-purple',
  member: 'badge-dim', custom: 'badge-pink'
};

// ─── Socket.io Chat ──────────────────────────────────────────
const chatBox = document.getElementById('chatBox');
const chatInput = document.getElementById('chatInput');
const typingDiv = document.getElementById('typingIndicator');

if (chatBox && window.PROJECT_ID && window.CURRENT_USER_ID) {
  const socket = io();
  socket.emit('join_project', window.PROJECT_ID);

  // Scroll to bottom on load
  chatBox.scrollTop = chatBox.scrollHeight;

  // Send message
  function sendMessage() {
    const content = chatInput.value.trim();
    if (!content) return;
    socket.emit('chat_message', { projectId: window.PROJECT_ID, content });
    chatInput.value = '';
  }

  document.getElementById('chatSendBtn')?.addEventListener('click', sendMessage);
  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    } else {
      socket.emit('typing', { projectId: window.PROJECT_ID });
    }
  });

  // Receive message
  socket.on('new_message', (msg) => {
    const isOwn = msg.user_id === window.CURRENT_USER_ID;
    const time = new Date(msg.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const initial = (msg.display_name || '?')[0].toUpperCase();
    const div = document.createElement('div');
    div.className = `chat-msg fade-in${isOwn ? ' own' : ''}`;
    div.innerHTML = `
      <div class="avatar" style="background:${msg.avatar_color || '#004b87'};min-width:30px">${initial}</div>
      <div>
        ${!isOwn ? `<div class="chat-name">${escHtml(msg.display_name)}</div>` : ''}
        <div class="chat-bubble">${escHtml(msg.content)}</div>
        <div class="chat-time">${time}</div>
      </div>`;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
  });

  // Typing indicator
  let typingTimer;
  socket.on('user_typing', (data) => {
    if (typingDiv) {
      typingDiv.textContent = `${data.name} đang nhập...`;
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => { typingDiv.textContent = ''; }, 2000);
    }
  });
}

// ─── Escape HTML helper ──────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Gantt chart render ──────────────────────────────────────
function renderGantt() {
  const ganttRows = document.querySelectorAll('.gantt-bar[data-start][data-end]');
  if (!ganttRows.length) return;
  // Find min/max dates across all bars
  let minD = Infinity, maxD = -Infinity;
  ganttRows.forEach(bar => {
    const s = new Date(bar.dataset.start).getTime();
    const e = new Date(bar.dataset.end).getTime();
    if (s < minD) minD = s;
    if (e > maxD) maxD = e;
  });
  const totalMs = maxD - minD || 1;
  ganttRows.forEach(bar => {
    const s = new Date(bar.dataset.start).getTime();
    const e = new Date(bar.dataset.end).getTime();
    const left = ((s - minD) / totalMs * 100).toFixed(1);
    const width = Math.max(((e - s) / totalMs * 100), 2).toFixed(1);
    bar.style.left = left + '%';
    bar.style.width = width + '%';
    bar.style.background = bar.dataset.color || 'var(--cyan)';
    bar.style.boxShadow = `0 0 8px ${bar.dataset.color || 'var(--cyan)'}`;
  });
}
renderGantt();

// ─── Read notification on click ──────────────────────────────
document.querySelectorAll('.notif-item[data-id]').forEach(item => {
  item.addEventListener('click', () => {
    if (item.classList.contains('unread')) {
      fetch(`/notifications/${item.dataset.id}/read`, { method: 'POST' });
      item.classList.remove('unread');
      const badge = document.querySelector('.notif-badge');
      if (badge) {
        const n = parseInt(badge.textContent) - 1;
        if (n <= 0) badge.remove(); else badge.textContent = n;
      }
    }
  });
});

// ─── Deadline countdown ──────────────────────────────────────
document.querySelectorAll('[data-deadline]').forEach(el => {
  const deadline = new Date(el.dataset.deadline);
  if (isNaN(deadline)) return;
  const now = new Date();
  const diff = deadline - now;
  if (diff < 0) {
    el.innerHTML = '<span class="task-overdue">⚠️ Trễ hạn</span>';
  } else {
    const days = Math.floor(diff / 86400000);
    const hrs = Math.floor((diff % 86400000) / 3600000);
    if (days === 0) {
      el.innerHTML = `<span style="color:var(--red)">⏰ Còn ${hrs}h</span>`;
    } else if (days <= 2) {
      el.innerHTML = `<span style="color:var(--orange)">⏳ Còn ${days}d ${hrs}h</span>`;
    } else {
      el.innerHTML = `<span style="color:var(--text-dim)">📅 ${days} ngày</span>`;
    }
  }
});

// ─── Role label helper (used in inline scripts) ───────────────
function getRoleLabel(role, customName) {
  if (role === 'custom' && customName) return `🎯 ${customName}`;
  return ROLE_LABEL[role] || role;
}

// ─── Custom role input toggle ─────────────────────────────────
document.querySelectorAll('select[name="role"]').forEach(sel => {
  const customInput = sel.closest('form')?.querySelector('.custom-role-input');
  if (!customInput) return;
  const toggle = () => { customInput.style.display = sel.value === 'custom' ? 'block' : 'none'; };
  sel.addEventListener('change', toggle);
  toggle();
});
