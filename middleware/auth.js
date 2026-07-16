// Middleware: require login
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/login?msg=login_required');
  }
  next();
}

// Middleware: require admin role
function requireAdmin(req, res, next) {
  if (!req.session.userId || req.session.role !== 'admin') {
    return res.status(403).render('error', {
      user: req.session,
      title: 'Từ chối truy cập',
      message: 'Bạn không có quyền truy cập trang này.',
      code: 403
    });
  }
  next();
}

// Helper: is this session a Pro user (admins always have Pro access)
function isPro(req) {
  // All users get Pro features by default now
  return true;
}

// Middleware: require Pro plan (or admin)
function requirePro(req, res, next) {
  if (!req.session.userId) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/login?msg=login_required');
  }
  if (!isPro(req)) {
    return res.redirect('/pricing?flash=Tính+năng+này+chỉ+dành+cho+gói+Pro&type=error');
  }
  next();
}

// Middleware: attach user info to locals for all views
function attachUser(req, res, next) {
  res.locals.currentUser = req.session.userId ? {
    id: req.session.userId,
    username: req.session.username,
    displayName: req.session.displayName,
    role: req.session.role,
    avatarColor: req.session.avatarColor,
    plan: req.session.plan || 'free',
    theme: req.session.theme || 'dark',
    accentColor: req.session.accentColor || '#004b87',
    isPro: isPro(req)
  } : null;
  // Theme: logged-in users use their saved preference; guests use cookie
  res.locals.theme = req.session.userId
    ? (req.session.theme || 'dark')
    : (req.cookies && req.cookies.theme === 'light' ? 'light' : 'dark');
  next();
}

module.exports = { requireLogin, requireAdmin, requirePro, attachUser, isPro };
