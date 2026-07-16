require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const methodOverride = require('method-override');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const path = require('path');
const pool = require('./db/pool');
const { attachUser, requireLogin } = require('./middleware/auth');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Trust Render's reverse proxy (bắt buộc để secure cookie hoạt động)
app.set('trust proxy', 1);

// ─── Auto-migrate schema on startup ───────────────────────────────────────────
async function initDB() {
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('✅ Database schema ready');
  } catch (err) {
    console.error('❌ DB init error:', err.message);
  }
}
initDB();

// ─── Session config ────────────────────────────────────────────────────────────
const sessionMiddleware = session({
  store: new pgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'neon_secret_key_change_me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true
  }
});

// ─── Middleware ────────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Gzip compression — đặt TRƯỚC static và routes để nén tất cả responses
app.use(compression());

// Static files với HTTP cache 1 giờ — browser không cần tải lại CSS/JS khi chuyển trang
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true,
  lastModified: true
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(methodOverride('_method'));
app.use(sessionMiddleware);
app.use(attachUser);

// Make io accessible in routes
app.use((req, res, next) => { req.io = io; next(); });

// ─── Health check — Render dùng để ping server, tránh cold start ──────────────
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, ts: Date.now() });
});

// ─── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use('/projects', require('./routes/projects'));
app.use('/api', require('./routes/api'));
app.use('/guest', require('./routes/guest'));

// GET / → landing or redirect to dashboard
app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('index', { title: 'MT - Quản lý nhóm hiệu quả' });
});

// GET /dashboard
app.get('/dashboard', async (req, res) => {
  if (!req.session.userId) return res.redirect('/auth/login');
  try {
    const userId = req.session.userId;
    // My projects (active member)
    const myProjects = await pool.query(
      `SELECT p.*, pm.role, pm.custom_role_name, pm.score,
       (SELECT COUNT(*) FROM project_members pm2 WHERE pm2.project_id=p.id AND pm2.status='active') AS member_count,
       (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id) AS task_count,
       (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id AND t.status='approved') AS done_count
       FROM projects p JOIN project_members pm ON pm.project_id=p.id
       WHERE pm.user_id=$1 AND pm.status='active' ORDER BY p.created_at DESC`,
      [userId]
    );
    // My notifications (unread)
    const notifications = await pool.query(
      `SELECT n.*, p.name AS project_name FROM notifications n
       LEFT JOIN projects p ON p.id=n.project_id
       WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT 20`,
      [userId]
    );
    const unreadCount = notifications.rows.filter(n => !n.is_read).length;

    // My pending tasks across all projects
    const pendingTasks = await pool.query(
      `SELECT t.*, p.name AS project_name FROM tasks t
       JOIN projects p ON p.id=t.project_id
       WHERE $1 = ANY(t.assigned_to) AND t.status NOT IN ('approved') ORDER BY t.deadline ASC NULLS LAST LIMIT 5`,
      [userId]
    );

    // Deadline warnings (tasks within alert window)
    const deadlineWarnings = await pool.query(
      `SELECT t.*, p.name AS project_name, p.deadline_alert_days
       FROM tasks t JOIN projects p ON p.id=t.project_id
       WHERE $1 = ANY(t.assigned_to) AND t.status NOT IN ('approved','rejected')
       AND t.deadline IS NOT NULL
       AND t.deadline BETWEEN NOW() AND NOW() + (p.deadline_alert_days || ' days')::INTERVAL`,
      [userId]
    );

    // Mark deadline warnings as notified
    for (const task of deadlineWarnings.rows) {
      const alreadyNotified = await pool.query(
        `SELECT id FROM notifications WHERE user_id=$1 AND type='deadline_warning' 
         AND message LIKE $2 AND created_at > NOW() - INTERVAL '1 day'`,
        [userId, `%"${task.title}"%`]
      );
      if (alreadyNotified.rows.length === 0) {
        await pool.query(
          'INSERT INTO notifications (user_id, project_id, type, title, message) VALUES ($1,$2,$3,$4,$5)',
          [userId, task.project_id, 'deadline_warning', '⚠️ Sắp đến hạn',
           `Nhiệm vụ "${task.title}" (${task.project_name}) sắp đến hạn!`]
        );
      }
    }

    res.render('dashboard', {
      title: 'Dashboard',
      myProjects: myProjects.rows,
      notifications: notifications.rows,
      unreadCount,
      pendingTasks: pendingTasks.rows,
      deadlineWarnings: deadlineWarnings.rows,
      flash: req.query.flash || null,
      flashType: req.query.type || 'success'
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Lỗi', message: err.message, code: 500 });
  }
});

// GET /notifications - view all notifications
app.get('/notifications', requireLogin, async (req, res) => {
  try {
    const notifs = await pool.query(
      `SELECT n.*, p.name AS project_name 
       FROM notifications n 
       LEFT JOIN projects p ON p.id = n.project_id 
       WHERE n.user_id = $1 
       ORDER BY n.created_at DESC`,
      [req.session.userId]
    );
    res.render('notifications/index', {
      title: 'Thông báo',
      allNotifications: notifs.rows
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Lỗi', message: err.message, code: 500 });
  }
});

// POST /notifications/read-all
app.post('/notifications/read-all', async (req, res) => {
  if (!req.session.userId) return res.redirect('/auth/login');
  await pool.query('UPDATE notifications SET is_read=TRUE WHERE user_id=$1', [req.session.userId]);
  res.redirect(req.headers.referer || '/dashboard');
});

// GET /notifications/:id – view a single notification or redirect to its project
app.get('/notifications/:id', async (req, res) => {
  if (!req.session.userId) return res.redirect('/auth/login');
  const nid = parseInt(req.params.id);
  try {
    // Fetch notification
    const notifR = await pool.query('SELECT * FROM notifications WHERE id=$1 AND user_id=$2', [nid, req.session.userId]);
    if (!notifR.rows.length) return res.redirect('/dashboard');
    const notif = notifR.rows[0];
    // Mark as read
    await pool.query('UPDATE notifications SET is_read=TRUE WHERE id=$1', [nid]);
    // If linked to a project, redirect there
    if (notif.project_id) {
      return res.redirect(`/projects/${notif.project_id}`);
    }
    // Render a simple detail page
    return res.render('notifications/detail', { title: 'Thông báo', notification: notif });
  } catch (err) {
    console.error(err);
    return res.redirect('/dashboard');
  }
});


// POST /notifications/:id/read - mark as read via AJAX
app.post('/notifications/:id/read', async (req, res) => {
  if (!req.session.userId) return res.redirect('/auth/login');
  await pool.query('UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2',
    [req.params.id, req.session.userId]);
  res.json({ ok: true });
});

// GET /profile
app.get('/profile', async (req, res) => {
  if (!req.session.userId) return res.redirect('/auth/login');
  const user = await pool.query('SELECT id,username,display_name,email,avatar_color,plan,theme,accent_color,created_at FROM users WHERE id=$1', [req.session.userId]);
  res.render('profile', { title: 'Hồ sơ cá nhân', profileUser: user.rows[0], flash: req.query.flash || null, flashType: req.query.type || 'success' });
});

// POST /profile/update
app.post('/profile/update', async (req, res) => {
  if (!req.session.userId) return res.redirect('/auth/login');
  const { display_name, email, avatar_color } = req.body;
  await pool.query('UPDATE users SET display_name=$1, email=$2, avatar_color=$3 WHERE id=$4',
    [display_name.trim(), email || null, avatar_color || '#004b87', req.session.userId]);
  req.session.displayName = display_name.trim();
  req.session.avatarColor = avatar_color;
  res.redirect('/profile?flash=Đã+cập+nhật+hồ+sơ&type=success');
});

// POST /profile/theme - toggle dark/light mode (works for guests via cookie too)
app.post('/profile/theme', async (req, res) => {
  const theme = req.body.theme === 'light' ? 'light' : 'dark';
  res.cookie('theme', theme, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false, sameSite: 'lax' });
  if (req.session.userId) {
    await pool.query('UPDATE users SET theme=$1 WHERE id=$2', [theme, req.session.userId]);
    req.session.theme = theme;
  }
  res.json({ ok: true, theme });
});

// POST /profile/accent - Pro: custom accent color
app.post('/profile/accent', async (req, res) => {
  if (!req.session.userId) return res.redirect('/auth/login');
  const { isPro } = require('./middleware/auth');
  if (!isPro(req)) return res.redirect('/pricing?flash=Tính+năng+này+chỉ+dành+cho+gói+Pro&type=error');
  const color = /^#[0-9a-fA-F]{6}$/.test(req.body.accent_color || '') ? req.body.accent_color : '#004b87';
  await pool.query('UPDATE users SET accent_color=$1 WHERE id=$2', [color, req.session.userId]);
  req.session.accentColor = color;
  res.redirect('/profile?flash=Đã+lưu+màu+chủ+đề&type=success');
});

// POST /profile/change-password - đổi mật khẩu tài khoản
app.post('/profile/change-password', async (req, res) => {
  if (!req.session.userId) return res.redirect('/auth/login');
  const { current_password, new_password, confirm_new_password } = req.body;
  if (!current_password || !new_password || !confirm_new_password) {
    return res.redirect('/profile?flash=Vui+lòng+điền+đầy+đủ+thông+tin&type=error');
  }
  if (new_password.length < 6) {
    return res.redirect('/profile?flash=Mật+khẩu+mới+phải+có+ít+nhất+6+ký+tự&type=error');
  }
  if (new_password !== confirm_new_password) {
    return res.redirect('/profile?flash=Mật+khẩu+xác+nhận+không+khớp&type=error');
  }
  try {
    const bcrypt = require('bcryptjs');
    const userR = await pool.query('SELECT password FROM users WHERE id=$1', [req.session.userId]);
    const user = userR.rows[0];
    if (!user || !(await bcrypt.compare(current_password, user.password))) {
      return res.redirect('/profile?flash=Mật+khẩu+hiện+tại+không+đúng&type=error');
    }
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hash, req.session.userId]);
    res.redirect('/profile?flash=Đã+đổi+mật+khẩu+thành+công&type=success');
  } catch (err) {
    console.error(err);
    res.redirect('/profile?flash=Lỗi+server.+Vui+lòng+thử+lại&type=error');
  }
});

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: '404', message: 'Trang không tìm thấy', code: 404 });
});

// ─── Socket.io: Real-time chat ─────────────────────────────────────────────────
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

io.on('connection', (socket) => {
  const sess = socket.request.session;
  if (!sess.userId) return;

  socket.on('join_project', (projectId) => {
    socket.join(`project_${projectId}`);
  });

  socket.on('chat_message', async (data) => {
    if (!sess.userId || !data.projectId || !data.content?.trim()) return;
    try {
      // Verify membership
      const memR = await pool.query(
        "SELECT id FROM project_members WHERE project_id=$1 AND user_id=$2 AND status='active'",
        [data.projectId, sess.userId]
      );
      if (!memR.rows.length && sess.role !== 'admin') return;

      const msgR = await pool.query(
        'INSERT INTO messages (project_id, user_id, content) VALUES ($1,$2,$3) RETURNING id, created_at',
        [data.projectId, sess.userId, data.content.trim()]
      );
      const msg = {
        id: msgR.rows[0].id,
        content: data.content.trim(),
        display_name: sess.displayName,
        avatar_color: sess.avatarColor,
        user_id: sess.userId,
        created_at: msgR.rows[0].created_at
      };
      io.to(`project_${data.projectId}`).emit('new_message', msg);
    } catch (err) { console.error(err); }
  });

  socket.on('typing', (data) => {
    socket.to(`project_${data.projectId}`).emit('user_typing', {
      name: sess.displayName, projectId: data.projectId
    });
  });
});

// ─── DB keep-alive: ping mỗi 4 phút để tránh pool timeout khi idle ───────────
setInterval(async () => {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error('⚠️ DB keep-alive ping failed:', err.message);
  }
}, 4 * 60 * 1000);

// ─── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 MT running on http://localhost:${PORT}`);
});
