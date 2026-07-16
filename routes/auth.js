const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

const AVATAR_COLORS = ['#004b87','#ff00cc','#9600ff','#00ff88','#ffcc00','#ff6600','#00aaff','#ff3366'];

// GET /auth/login
router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  const msg = req.query.msg;
  const messages = {
    login_required: 'Vui lòng đăng nhập để tiếp tục.',
    invalid: 'Tên đăng nhập hoặc mật khẩu không đúng.',
    registered: 'Đăng ký thành công! Hãy đăng nhập.',
    logout: 'Đã đăng xuất thành công.'
  };
  res.render('auth/login', {
    title: 'Đăng nhập',
    user: null,
    flash: messages[msg] || null,
    flashType: msg === 'registered' ? 'success' : 'error'
  });
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.render('auth/login', {
      title: 'Đăng nhập',
      user: null,
      flash: 'Vui lòng điền đầy đủ thông tin.',
      flashType: 'error'
    });
  }
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND is_active = TRUE',
      [username.trim()]
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.render('auth/login', {
        title: 'Đăng nhập',
        user: null,
        flash: 'Tên đăng nhập hoặc mật khẩu không đúng.',
        flashType: 'error'
      });
    }
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.displayName = user.display_name || user.username;
    req.session.role = user.role;
    req.session.avatarColor = user.avatar_color;
    req.session.plan = user.plan || 'free';
    req.session.theme = user.theme || 'dark';
    req.session.accentColor = user.accent_color || '#004b87';

    const returnTo = req.session.returnTo || '/dashboard';
    delete req.session.returnTo;
    res.redirect(returnTo);
  } catch (err) {
    console.error(err);
    res.render('auth/login', {
      title: 'Đăng nhập',
      user: null,
      flash: 'Lỗi server. Vui lòng thử lại.',
      flashType: 'error'
    });
  }
});

// GET /auth/register
router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('auth/register', { title: 'Đăng ký', user: null, flash: null, flashType: null });
});

// POST /auth/register
router.post('/register', async (req, res) => {
  const { username, password, confirm_password, email, display_name } = req.body;
  if (!username || !password || !display_name) {
    return res.render('auth/register', {
      title: 'Đăng ký', user: null,
      flash: 'Vui lòng điền đầy đủ thông tin bắt buộc.',
      flashType: 'error'
    });
  }
  if (password !== confirm_password) {
    return res.render('auth/register', {
      title: 'Đăng ký', user: null,
      flash: 'Mật khẩu xác nhận không khớp.',
      flashType: 'error'
    });
  }
  if (password.length < 6) {
    return res.render('auth/register', {
      title: 'Đăng ký', user: null,
      flash: 'Mật khẩu phải có ít nhất 6 ký tự.',
      flashType: 'error'
    });
  }
  if (username === 'admin') {
    return res.render('auth/register', {
      title: 'Đăng ký', user: null,
      flash: 'Tên đăng nhập này không khả dụng.',
      flashType: 'error'
    });
  }
  try {
    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username.trim()]);
    if (existing.rows.length > 0) {
      return res.render('auth/register', {
        title: 'Đăng ký', user: null,
        flash: 'Tên đăng nhập đã tồn tại.',
        flashType: 'error'
      });
    }
    const hash = await bcrypt.hash(password, 10);
    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    // Tài khoản mới mặc định gói FREE — chỉ Admin mới cấp Pro
    await pool.query(
      'INSERT INTO users (username, password, email, display_name, avatar_color, plan) VALUES ($1, $2, $3, $4, $5, $6)',
      [username.trim(), hash, email || null, display_name.trim(), color, 'free']
    );
    res.redirect('/auth/login?msg=registered');
  } catch (err) {
    console.error(err);
    res.render('auth/register', {
      title: 'Đăng ký', user: null,
      flash: 'Lỗi server. Vui lòng thử lại.',
      flashType: 'error'
    });
  }
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/auth/login?msg=logout'));
});

module.exports = router;
