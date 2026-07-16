const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { requireLogin } = require("../middleware/auth");

router.use(requireLogin);

// GET /api/submissions/:taskId — fetch latest submission for a task
router.get("/submissions/:taskId", async (req, res) => {
  try {
    const taskR = await pool.query(
      "SELECT t.id, t.project_id, t.assigned_to, p.owner_id FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = $1",
      [req.params.taskId],
    );
    const task = taskR.rows[0];
    if (!task) return res.json({ submission: null });

    let canView =
      req.session.role === "admin" ||
      task.owner_id === req.session.userId ||
      (task.assigned_to || []).includes(req.session.userId);
    if (!canView) {
      const memberR = await pool.query(
        "SELECT role, status, can_view_peer_submissions, can_approve_submissions FROM project_members WHERE project_id=$1 AND user_id=$2",
        [task.project_id, req.session.userId],
      );
      const member = memberR.rows[0];
      canView =
        !!member &&
        member.status === "active" &&
        (member.role === "leader" ||
          member.role === "vice_leader" ||
          member.can_view_peer_submissions ||
          member.can_approve_submissions);
    }
    if (!canView) return res.json({ submission: null });

    const r = await pool.query(
      `SELECT ts.*, u.display_name FROM task_submissions ts
       JOIN users u ON u.id = ts.user_id
       WHERE ts.task_id = $1 ORDER BY ts.submitted_at DESC LIMIT 1`,
      [req.params.taskId],
    );
    res.json({ submission: r.rows[0] || null });
  } catch (err) {
    res.json({ submission: null });
  }
});

// GET /api/projects/:id/stats
router.get("/projects/:id/stats", async (req, res) => {
  try {
    const pid = req.params.id;
    const [tasks, members] = await Promise.all([
      pool.query(
        `SELECT status, COUNT(*) FROM tasks WHERE project_id=$1 GROUP BY status`,
        [pid],
      ),
      pool.query(
        `SELECT COUNT(*) FROM project_members WHERE project_id=$1 AND status='active'`,
        [pid],
      ),
    ]);
    const statusMap = {};
    tasks.rows.forEach((r) => {
      statusMap[r.status] = parseInt(r.count);
    });
    res.json({
      total: Object.values(statusMap).reduce((a, b) => a + b, 0),
      done: statusMap.approved || 0,
      members: parseInt(members.rows[0].count),
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

module.exports = router;
