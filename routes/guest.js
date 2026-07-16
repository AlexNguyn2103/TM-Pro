const express = require("express");
const router = express.Router();
const pool = require("../db/pool");

// GET /guest — Dashboard showing all public projects
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.display_name AS owner_name,
        (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id=p.id AND pm.status='active') AS member_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id) AS task_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id AND t.status='approved') AS done_count
       FROM projects p
       LEFT JOIN users u ON u.id = p.owner_id
       WHERE p.is_public = TRUE AND p.status != 'archived'
       ORDER BY p.created_at DESC`
    );
    res.render("guest/dashboard", {
      title: "Dự án công khai",
      projects: result.rows,
      flash: req.query.flash || null,
      flashType: req.query.type || "success"
    });
  } catch (err) {
    console.error(err);
    res.render("error", { title: "Lỗi", message: err.message, code: 500 });
  }
});

// GET /guest/projects/:id
router.get("/projects/:id", async (req, res) => {
  const projectId = parseInt(req.params.id);

  try {
    const projR = await pool.query(
      `SELECT p.*, u.display_name AS owner_name FROM projects p LEFT JOIN users u ON u.id = p.owner_id WHERE p.id = $1`,
      [projectId],
    );
    if (!projR.rows[0])
      return res.status(404).render("error", { title: "404", message: "Dự án không tồn tại", code: 404 });
      
    const project = projR.rows[0];

    // Kiểm tra dự án có được công khai không
    if (!project.is_public) {
      return res.status(403).render("error", {
        title: "Từ chối",
        message: "Dự án này không công khai. Vui lòng đăng nhập hoặc yêu cầu admin cấp quyền.",
        code: 403,
      });
    }

    // Lấy thông tin tổng quan, roadmap, và members để hiển thị cho khách
    let tabData = {};

    const tasks = await pool.query(
      `SELECT t.*, string_agg(u.display_name, ', ') AS assignee_name
       FROM tasks t LEFT JOIN users u ON u.id = ANY(t.assigned_to)
       WHERE t.project_id = $1 
       GROUP BY t.id
       ORDER BY t.deadline ASC NULLS LAST, t.created_at DESC`,
      [projectId]
    );
    
    // Stats
    const totalTasks = tasks.rows.length;
    const doneTasks = tasks.rows.filter(t => t.status === "approved").length;
    const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
    
    const memberCount = await pool.query(
      `SELECT COUNT(*) FROM project_members WHERE project_id=$1 AND status='active'`,
      [projectId]
    );

    tabData.stats = {
      totalTasks,
      doneTasks,
      progress,
      memberCount: parseInt(memberCount.rows[0].count),
      overdueTasks: tasks.rows.filter(
        (t) => t.deadline && new Date(t.deadline) < new Date() && t.status !== "approved"
      ).length,
    };

    // Lấy roadmap
    const roadmap = await pool.query(
      `SELECT ri.*, string_agg(u.display_name, ', ') AS assignee_name FROM roadmap_items ri
       LEFT JOIN users u ON u.id = ANY(ri.assigned_to)
       WHERE ri.project_id=$1 GROUP BY ri.id ORDER BY ri.start_date ASC`,
      [projectId],
    );
    tabData.roadmapItems = roadmap.rows;

    // Lấy danh sách thành viên (thông tin cơ bản)
    const members = await pool.query(
      `SELECT pm.role, pm.custom_role_name, u.display_name, u.avatar_color
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1 AND pm.status='active'
       ORDER BY CASE pm.role WHEN 'leader' THEN 0 WHEN 'vice_leader' THEN 1 WHEN 'member' THEN 2 ELSE 3 END`,
      [projectId],
    );
    tabData.members = members.rows;

    res.render("projects/guest", {
      title: project.name + " (Guest View)",
      project,
      tab: 'overview',
      ...tabData,
      flash: req.query.flash || null,
      flashType: req.query.type || "success"
    });
  } catch (err) {
    console.error(err);
    res.render("error", { title: "Lỗi", message: err.message, code: 500 });
  }
});

module.exports = router;
