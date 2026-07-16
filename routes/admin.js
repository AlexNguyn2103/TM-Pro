const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const multer = require('multer');
const ExcelJS = require('exceljs');

const upload = multer({ storage: multer.memoryStorage() });

router.use(requireAdmin);

// GET /admin
router.get('/', async (req, res) => {
  try {
    const [usersR, projectsR, tasksR, membersR] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM projects'),
      pool.query('SELECT COUNT(*) FROM tasks'),
      pool.query('SELECT COUNT(*) FROM project_members WHERE status = $1', ['active'])
    ]);
    const stats = {
      users: parseInt(usersR.rows[0].count),
      projects: parseInt(projectsR.rows[0].count),
      tasks: parseInt(tasksR.rows[0].count),
      members: parseInt(membersR.rows[0].count)
    };
    const users = await pool.query(
      'SELECT id, username, display_name, email, role, is_active, avatar_color, plan, created_at FROM users ORDER BY created_at DESC'
    );
    const projects = await pool.query(
      `SELECT p.*, u.display_name AS owner_name, 
       (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id AND pm.status = 'active') AS member_count
       FROM projects p LEFT JOIN users u ON u.id = p.owner_id ORDER BY p.created_at DESC LIMIT 20`
    );
    const uploadErrors = req.session.uploadErrors || null;
    delete req.session.uploadErrors;
    const showUploadResult = req.query.showUploadResult === 'true';

    res.render('admin/index', {
      title: 'Quản trị hệ thống',
      stats,
      users: users.rows,
      projects: projects.rows,
      flash: req.query.flash || null,
      flashType: req.query.type || 'success',
      uploadErrors,
      showUploadResult
    });
  } catch (err) {
    console.error(err);
    res.render('error', { title: 'Lỗi', message: err.message, code: 500 });
  }
});

// POST /admin/users/:id/toggle - Toggle user active status
router.post('/users/:id/toggle', async (req, res) => {
  const uid = parseInt(req.params.id);
  if (uid === req.session.userId) return res.redirect('/admin?flash=Không+thể+vô+hiệu+hóa+chính+mình&type=error');
  await pool.query('UPDATE users SET is_active = NOT is_active WHERE id = $1', [uid]);
  res.redirect('/admin?flash=Cập+nhật+trạng+thái+thành+công&type=success');
});

// POST /admin/users/:id/toggle-plan - Toggle user plan free/pro
router.post('/users/:id/toggle-plan', async (req, res) => {
  const uid = parseInt(req.params.id);
  const cur = await pool.query('SELECT plan FROM users WHERE id=$1', [uid]);
  const newPlan = cur.rows[0]?.plan === 'pro' ? 'free' : 'pro';
  await pool.query('UPDATE users SET plan=$1 WHERE id=$2', [newPlan, uid]);
  res.redirect('/admin?flash=Đã+cập+nhật+gói+người+dùng&type=success');
});

// POST /admin/users/:id/delete - Delete user
router.post('/users/:id/delete', async (req, res) => {
  const uid = parseInt(req.params.id);
  if (uid === req.session.userId) return res.redirect('/admin?flash=Không+thể+xóa+chính+mình&type=error');
  await pool.query('DELETE FROM users WHERE id = $1 AND role != $2', [uid, 'admin']);
  res.redirect('/admin?flash=Đã+xóa+người+dùng&type=success');
});

// POST /admin/users/create - Create user directly
router.post('/users/create', async (req, res) => {
  const { username, password, display_name, role } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (username, password, display_name, role) VALUES ($1, $2, $3, $4)',
      [username.trim(), hash, display_name.trim(), role || 'user']
    );
    res.redirect('/admin?flash=Tạo+tài+khoản+thành+công&type=success');
  } catch (err) {
    res.redirect('/admin?flash=Lỗi+tạo+tài+khoản&type=error');
  }
});

// POST /admin/projects/:id/delete
router.post('/projects/:id/delete', async (req, res) => {
  await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
  res.redirect('/admin?flash=Đã+xóa+dự+án&type=success');
});

// POST /admin/users/:id/change-password - Admin đổi mật khẩu cho tài khoản bất kỳ
router.post('/users/:id/change-password', async (req, res) => {
  const uid = parseInt(req.params.id);
  const { new_password, confirm_new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.redirect('/admin?flash=Mật+khẩu+phải+có+ít+nhất+6+ký+tự&type=error');
  }
  if (new_password !== confirm_new_password) {
    return res.redirect('/admin?flash=Mật+khẩu+xác+nhận+không+khớp&type=error');
  }
  try {
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hash, uid]);
    res.redirect('/admin?flash=Đã+đổi+mật+khẩu+thành+công&type=success');
  } catch (err) {
    console.error(err);
    res.redirect('/admin?flash=Lỗi+server&type=error');
  }
});

module.exports = router;

// GET /admin/users/upload-template
router.get('/users/upload-template', async (req, res) => {
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Thành viên');
    ws.columns = [
      { header: 'STT', key: 'stt', width: 5 },
      { header: 'Họ tên hiển thị', key: 'display_name', width: 25 },
      { header: 'Tên đăng nhập', key: 'username', width: 20 },
      { header: 'Mật khẩu', key: 'password', width: 15 },
      { header: 'Mã nhóm', key: 'invite_code', width: 25 },
      { header: 'Email', key: 'email', width: 25 }
    ];
    // Dummy row
    ws.addRow({ stt: 1, display_name: 'Nguyễn Văn A', username: 'nguyenvana', password: '123', invite_code: 'A1B2C3D4,E5F6G7H8', email: 'a@example.com' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="template_import_users.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.redirect('/admin?flash=Lỗi+tạo+template&type=error');
  }
});

// POST /admin/users/upload
router.post('/users/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.redirect('/admin?flash=Chưa+chọn+file&type=error');
  
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    const ws = wb.worksheets[0]; // Get the first worksheet
    
    let successCount = 0;
    let errorCount = 0;
    let errors = [];
    
    // Skip header row (row 1)
    for (let i = 2; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      // Read values, treating formulas or empty properly
      const displayName = row.getCell(2).text?.trim();
      const username = row.getCell(3).text?.trim();
      const password = row.getCell(4).text?.trim();
      const inviteCodeStr = row.getCell(5).text?.trim();
      const email = row.getCell(6).text?.trim();
      
      if (!username || !password) {
        if (!row.values.length) continue; // Empty row
        errorCount++;
        errors.push(`Dòng ${i}: Thiếu username hoặc password`);
        continue;
      }
      
      try {
        const checkUser = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        let userId;
        
        if (checkUser.rows.length > 0) {
          errorCount++;
          errors.push(`Dòng ${i}: Username '${username}' đã tồn tại`);
          continue;
        } else {
          const hash = await bcrypt.hash(password, 10);
          const color = '#004b87'; // Default
          const result = await pool.query(
            'INSERT INTO users (username, password, display_name, email, role, avatar_color) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [username, hash, displayName || username, email || null, 'user', color]
          );
          userId = result.rows[0].id;
        }
        
        if (inviteCodeStr) {
          const codes = inviteCodeStr.split(',').map(c => c.trim().toUpperCase()).filter(c => c);
          for (const code of codes) {
            const projCheck = await pool.query('SELECT id FROM projects WHERE invite_code = $1', [code]);
            if (projCheck.rows.length > 0) {
              const projectId = projCheck.rows[0].id;
              await pool.query(
                "INSERT INTO project_members (project_id, user_id, role, status) VALUES ($1, $2, $3, $4) ON CONFLICT (project_id, user_id) DO UPDATE SET status=$4",
                [projectId, userId, 'member', 'active']
              );
            } else {
              errors.push(`Dòng ${i}: TK tạo OK, nhưng mã nhóm '${code}' sai`);
            }
          }
        }
        successCount++;
      } catch (rowErr) {
        console.error(rowErr);
        errorCount++;
        errors.push(`Dòng ${i}: Lỗi db`);
      }
    }
    
    if (errors.length > 0) {
       req.session.uploadErrors = errors;
    }
    let flashMsg = `Upload: ${successCount} thành công, ${errorCount} lỗi.`;
    res.redirect(`/admin?flash=${encodeURIComponent(flashMsg)}&type=${errorCount > 0 ? 'warning' : 'success'}&showUploadResult=true`);
    
  } catch (err) {
    console.error(err);
    res.redirect('/admin?flash=Lỗi+đọc+file+Excel&type=error');
  }
});

// GET /admin/database/export
router.get('/database/export', async (req, res) => {
  try {
    const tables = ['users', 'projects', 'project_members', 'tasks', 'task_submissions', 'notifications', 'messages', 'roadmap_items', 'activity_log'];
    const dbData = {};
    for (const table of tables) {
      const result = await pool.query(`SELECT * FROM ${table}`);
      dbData[table] = result.rows;
    }
    const jsonStr = JSON.stringify(dbData, null, 2);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="database_backup_${Date.now()}.json"`);
    res.send(jsonStr);
  } catch (err) {
    console.error(err);
    res.redirect('/admin?flash=Lỗi+xuất+dữ+liệu&type=error');
  }
});

// POST /admin/database/import
router.post('/database/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.redirect('/admin?flash=Chưa+chọn+file&type=error');
  
  const client = await pool.connect();
  try {
    const dbData = JSON.parse(req.file.buffer.toString('utf8'));
    
    // Xóa theo thứ tự ngược để không dính khóa ngoại
    const deleteOrder = ['activity_log', 'roadmap_items', 'messages', 'notifications', 'task_submissions', 'tasks', 'project_members', 'projects', 'users'];
    // Chèn theo thứ tự thuận
    const insertOrder = ['users', 'projects', 'project_members', 'tasks', 'task_submissions', 'notifications', 'messages', 'roadmap_items', 'activity_log'];
    
    await client.query('BEGIN');
    
    for (const table of deleteOrder) {
      await client.query(`DELETE FROM ${table}`);
    }
    
    for (const table of insertOrder) {
      const rows = dbData[table] || [];
      if (rows.length === 0) continue;
      
      const columns = Object.keys(rows[0]);
      
      for (const row of rows) {
        const values = columns.map(col => row[col]);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        // Thêm dấu ngoặc kép cho tên cột để tránh trùng từ khóa hệ thống
        const safeColumns = columns.map(c => `"${c}"`).join(', ');
        
        await client.query(`INSERT INTO ${table} (${safeColumns}) VALUES (${placeholders})`, values);
      }
      
      if (columns.includes('id')) {
        await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), coalesce(max(id),0) + 1, false) FROM ${table}`);
      }
    }
    
    await client.query('COMMIT');
    res.redirect('/admin?flash=Import+Database+thành+công&type=success');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Database Import Error:', err);
    res.redirect('/admin?flash=Lỗi+khi+Import:+' + encodeURIComponent(err.message) + '&type=error');
  } finally {
    client.release();
  }
});

module.exports = router;
