const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { requireLogin, requirePro, isPro } = require("../middleware/auth");
const { v4: uuidv4 } = require("uuid");
const { getTemplate, listTemplates } = require("../data/templates");
const { generatePDFReport, generateExcelReport } = require("../utils/export");

router.use(requireLogin);

// Helper: Generate short invite code
function genCode() {
  return uuidv4().replace(/-/g, "").substring(0, 8).toUpperCase();
}

// Helper: Check member role in project
async function getMemberRole(projectId, userId) {
  const r = await pool.query(
    "SELECT role, custom_role_name, status, can_view_peer_submissions, can_comment_submissions, can_approve_submissions, can_edit_tasks FROM project_members WHERE project_id=$1 AND user_id=$2",
    [projectId, userId],
  );
  return r.rows[0] || null;
}

// Helper: Is leader or vice leader
function isLeader(memberInfo, project, userId) {
  if (!memberInfo) return false;
  if (project.owner_id === userId) return true;
  return memberInfo.role === "leader" || memberInfo.role === "vice_leader";
}

function canManageProject(memberInfo, project, userId, sessionRole) {
  return isLeader(memberInfo, project, userId) || sessionRole === "admin";
}

function canEditProjectTasks(memberInfo, project, userId, sessionRole) {
  return (
    canManageProject(memberInfo, project, userId, sessionRole) ||
    !!memberInfo?.can_edit_tasks
  );
}

function canReviewProjectSubmissions(memberInfo, project, userId, sessionRole) {
  return (
    canManageProject(memberInfo, project, userId, sessionRole) ||
    !!memberInfo?.can_approve_submissions
  );
}

// Helper: Create notification
async function notify(userId, projectId, type, title, message) {
  try {
    await pool.query(
      "INSERT INTO notifications (user_id, project_id, type, title, message) VALUES ($1,$2,$3,$4,$5)",
      [userId, projectId, type, title, message],
    );
  } catch (e) {
    console.error("notify err", e);
  }
}

// Helper: Log activity
async function logActivity(projectId, userId, action, detail) {
  try {
    await pool.query(
      "INSERT INTO activity_log (project_id, user_id, action, detail) VALUES ($1,$2,$3,$4)",
      [projectId, userId, action, detail],
    );
  } catch (e) {}
}

// ============================================================
// GET /projects/new - Create project form
// ============================================================
router.get("/new", (req, res) => {
  res.render("projects/new", {
    title: "Tạo dự án mới",
    flash: null,
    flashType: null,
    templates: listTemplates(),
  });
});

// POST /projects/new
router.post("/new", async (req, res) => {
  const { name, description, deadline, template } = req.body;
  if (!name)
    return res.render("projects/new", {
      title: "Tạo dự án mới",
      flash: "Tên dự án không được để trống",
      flashType: "error",
      templates: listTemplates(),
    });
  try {
    let code = genCode();
    // ensure unique
    while (
      (await pool.query("SELECT id FROM projects WHERE invite_code=$1", [code]))
        .rows.length > 0
    ) {
      code = genCode();
    }
    // Templates are a Pro feature
    const tplId = template && isPro(req) ? template : null;
    const tpl = tplId ? getTemplate(tplId) : null;

    const proj = await pool.query(
      "INSERT INTO projects (name, description, invite_code, owner_id, deadline, template) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [
        name.trim(),
        description,
        code,
        req.session.userId,
        deadline || null,
        tplId,
      ],
    );
    const projectId = proj.rows[0].id;
    // Creator becomes leader member (active, no pending)
    await pool.query(
      "INSERT INTO project_members (project_id, user_id, role, status) VALUES ($1,$2,$3,$4)",
      [projectId, req.session.userId, "leader", "active"],
    );
    await logActivity(
      projectId,
      req.session.userId,
      "create_project",
      `Dự án "${name}" được tạo`,
    );

    // Apply template: pre-fill tasks + roadmap
    if (tpl) {
      const baseDate = new Date();
      for (const t of tpl.tasks) {
        const dl = new Date(baseDate);
        dl.setDate(dl.getDate() + (t.days || 7));
        await pool.query(
          "INSERT INTO tasks (project_id, title, deadline, priority, created_by) VALUES ($1,$2,$3,$4,$5)",
          [
            projectId,
            t.title,
            dl.toISOString().slice(0, 10),
            t.priority || "medium",
            req.session.userId,
          ],
        );
      }
      for (const r of tpl.roadmap) {
        const start = new Date(baseDate);
        start.setDate(start.getDate() + r.offsetStart);
        const end = new Date(start);
        end.setDate(end.getDate() + r.durationDays);
        await pool.query(
          "INSERT INTO roadmap_items (project_id, title, start_date, end_date, color) VALUES ($1,$2,$3,$4,$5)",
          [
            projectId,
            r.title,
            start.toISOString().slice(0, 10),
            end.toISOString().slice(0, 10),
            r.color || "#004b87",
          ],
        );
      }
      await logActivity(
        projectId,
        req.session.userId,
        "apply_template",
        `Áp dụng mẫu: "${tpl.name}"`,
      );
    }

    res.redirect(`/projects/${projectId}?tab=overview`);
  } catch (err) {
    console.error(err);
    res.render("projects/new", {
      title: "Tạo dự án mới",
      flash: "Lỗi tạo dự án",
      flashType: "error",
      templates: listTemplates(),
    });
  }
});

// ============================================================
// GET /projects/join - Join project form
// ============================================================
router.get("/join", (req, res) => {
  res.render("projects/join", {
    title: "Tham gia dự án",
    flash: null,
    flashType: null,
  });
});

// POST /projects/join
router.post("/join", async (req, res) => {
  const { invite_code } = req.body;
  if (!invite_code)
    return res.render("projects/join", {
      title: "Tham gia dự án",
      flash: "Vui lòng nhập mã mời",
      flashType: "error",
    });
  try {
    const projR = await pool.query(
      "SELECT * FROM projects WHERE invite_code=$1",
      [invite_code.trim().toUpperCase()],
    );
    if (!projR.rows[0])
      return res.render("projects/join", {
        title: "Tham gia dự án",
        flash: "Mã mời không hợp lệ",
        flashType: "error",
      });
    const project = projR.rows[0];
    // Check already member
    const existing = await pool.query(
      "SELECT status FROM project_members WHERE project_id=$1 AND user_id=$2",
      [project.id, req.session.userId],
    );
    if (existing.rows.length > 0) {
      if (existing.rows[0].status === "pending") {
        return res.render("projects/join", {
          title: "Tham gia dự án",
          flash: "Yêu cầu của bạn đang chờ duyệt",
          flashType: "error",
        });
      }
      if (existing.rows[0].status === "active") {
        return res.redirect(`/projects/${project.id}`);
      }
    }
    // Add as pending member
    await pool.query(
      "INSERT INTO project_members (project_id, user_id, role, status) VALUES ($1,$2,$3,$4) ON CONFLICT (project_id, user_id) DO UPDATE SET status=$4",
      [project.id, req.session.userId, "member", "pending"],
    );
    // Notify project leader
    const leaderR = await pool.query(
      `SELECT pm.user_id FROM project_members pm WHERE pm.project_id=$1 AND pm.role='leader' AND pm.status='active'`,
      [project.id],
    );
    const notifyName = req.session.displayName;
    for (const row of leaderR.rows) {
      await notify(
        row.user_id,
        project.id,
        "member_joined",
        "🔔 Yêu cầu tham gia mới",
        `${notifyName} đã gửi yêu cầu tham gia dự án "${project.name}"`,
      );
    }
    await logActivity(
      project.id,
      req.session.userId,
      "join_request",
      `${notifyName} gửi yêu cầu tham gia`,
    );
    res.render("projects/join", {
      title: "Tham gia dự án",
      flash: `Đã gửi yêu cầu tham gia "${project.name}". Chờ nhóm trưởng duyệt!`,
      flashType: "success",
    });
  } catch (err) {
    console.error(err);
    res.render("projects/join", {
      title: "Tham gia dự án",
      flash: "Lỗi server",
      flashType: "error",
    });
  }
});

// ============================================================
// GET /projects/:id - Project detail (multi-tab)
// ============================================================
router.get("/:id", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const tab = req.query.tab || "overview";
  const userId = req.session.userId;

  try {
    const projR = await pool.query(
      `SELECT p.*, u.display_name AS owner_name FROM projects p LEFT JOIN users u ON u.id = p.owner_id WHERE p.id = $1`,
      [projectId],
    );
    if (!projR.rows[0])
      return res
        .status(404)
        .render("error", {
          title: "404",
          message: "Dự án không tồn tại",
          code: 404,
        });
    const project = projR.rows[0];

    // Check membership
    const memberInfo = await getMemberRole(projectId, userId);
    const isAdminUser = req.session.role === "admin";

    if (!memberInfo && !isAdminUser) {
      return res
        .status(403)
        .render("error", {
          title: "Từ chối",
          message: "Bạn không phải thành viên dự án này.",
          code: 403,
        });
    }
    if (memberInfo && memberInfo.status === "pending") {
      return res.render("projects/pending", { title: "Chờ duyệt", project });
    }

    const canManage = canManageProject(
      memberInfo,
      project,
      userId,
      req.session.role,
    );
    const canEditTasks = canEditProjectTasks(
      memberInfo,
      project,
      userId,
      req.session.role,
    );
    const canReviewSubmissions = canReviewProjectSubmissions(
      memberInfo,
      project,
      userId,
      req.session.role,
    );
    const canViewPeerSubmissions =
      canReviewSubmissions || !!memberInfo?.can_view_peer_submissions;

    // Fetch data based on tab
    let tabData = {};

    if (tab === "overview" || tab === "tasks" || tab === "kanban") {
      const tasks = await pool.query(
        `SELECT t.*, string_agg(u.display_name, ', ') AS assignee_name, 
         (SELECT COUNT(*) FROM task_submissions ts WHERE ts.task_id = t.id AND ts.status='approved') AS approved_count
         FROM tasks t LEFT JOIN users u ON u.id = ANY(t.assigned_to)
         WHERE t.project_id = $1 
         GROUP BY t.id
         ORDER BY t.deadline ASC NULLS LAST, t.created_at DESC`,
        [projectId],
      );
      tabData.tasks = tasks.rows;
    }

    if (tab === "members") {
      const members = await pool.query(
        `SELECT pm.*, u.display_name, u.username, u.avatar_color, u.email,
         COUNT(t.id) AS total_tasks,
         COUNT(t.id) FILTER (WHERE t.status = 'approved') AS done_tasks,
         COUNT(t.id) FILTER (WHERE t.deadline IS NOT NULL AND t.deadline < NOW() AND t.status != 'approved') AS overdue_tasks,
         COUNT(t.id) FILTER (WHERE t.status IN ('todo','rejected')) AS todo_tasks,
         COUNT(t.id) FILTER (WHERE t.status IN ('in_progress','submitted')) AS inprogress_tasks
         FROM project_members pm
         JOIN users u ON u.id = pm.user_id
         LEFT JOIN tasks t ON pm.user_id = ANY(t.assigned_to) AND t.project_id = pm.project_id
         WHERE pm.project_id = $1
         GROUP BY pm.id, pm.project_id, pm.user_id, pm.role, pm.custom_role_name, pm.status, pm.score, pm.joined_at,
           pm.can_view_peer_submissions, pm.can_comment_submissions, pm.can_approve_submissions, pm.can_edit_tasks,
           u.display_name, u.username, u.avatar_color, u.email
         ORDER BY CASE pm.role WHEN 'leader' THEN 0 WHEN 'vice_leader' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
         pm.score DESC`,
        [projectId],
      );
      tabData.members = members.rows;
      // Pending requests
      const pending = await pool.query(
        `SELECT pm.*, u.display_name, u.username, u.avatar_color FROM project_members pm 
         JOIN users u ON u.id = pm.user_id WHERE pm.project_id=$1 AND pm.status='pending'`,
        [projectId],
      );
      tabData.pendingMembers = pending.rows;
    }

    if (tab === "roadmap") {
      const roadmap = await pool.query(
        `SELECT ri.*, string_agg(u.display_name, ', ') AS assignee_name FROM roadmap_items ri
         LEFT JOIN users u ON u.id = ANY(ri.assigned_to)
         WHERE ri.project_id=$1 GROUP BY ri.id ORDER BY ri.start_date ASC`,
        [projectId],
      );
      tabData.roadmapItems = roadmap.rows;
      const activeMembers = await pool.query(
        `SELECT pm.user_id, u.display_name FROM project_members pm JOIN users u ON u.id=pm.user_id
         WHERE pm.project_id=$1 AND pm.status='active'`,
        [projectId],
      );
      tabData.activeMembers = activeMembers.rows;
    }

    if (tab === "stats") {
      const memberStats = await pool.query(
        `SELECT
           u.id AS user_id,
           u.display_name,
           u.avatar_color,
           pm.score,
           COUNT(t.id) AS assigned_count,
           COUNT(t.id) FILTER (WHERE t.status='approved') AS done_count,
           COUNT(t.id) FILTER (WHERE t.deadline IS NOT NULL AND t.deadline < NOW() AND t.status != 'approved') AS overdue_count,
           COUNT(t.id) FILTER (
             WHERE t.status='approved' AND t.deadline IS NOT NULL AND EXISTS (
               SELECT 1 FROM task_submissions ts WHERE ts.task_id=t.id AND ts.user_id=u.id AND ts.status='approved' AND ts.submitted_at <= t.deadline
             )
           ) AS ontime_count,
           (SELECT COUNT(*) FROM activity_log al WHERE al.project_id=$1 AND al.user_id=u.id) AS activity_count
         FROM project_members pm
         JOIN users u ON u.id = pm.user_id
         LEFT JOIN tasks t ON t.project_id = pm.project_id AND u.id = ANY(t.assigned_to)
         WHERE pm.project_id=$1 AND pm.status='active'
         GROUP BY u.id, u.display_name, u.avatar_color, pm.score
         ORDER BY pm.score DESC`,
        [projectId],
      );

      const maxAssigned = Math.max(
        1,
        ...memberStats.rows.map((r) => parseInt(r.assigned_count)),
      );
      const maxActivity = Math.max(
        1,
        ...memberStats.rows.map((r) => parseInt(r.activity_count)),
      );

      tabData.memberStats = memberStats.rows.map((r) => {
        const assigned = parseInt(r.assigned_count);
        const done = parseInt(r.done_count);
        const ontime = parseInt(r.ontime_count);
        const activity = parseInt(r.activity_count);
        return {
          userId: r.user_id,
          displayName: r.display_name,
          avatarColor: r.avatar_color,
          score: r.score || 0,
          assignedCount: assigned,
          doneCount: done,
          overdueCount: parseInt(r.overdue_count),
          completionRate:
            assigned > 0 ? Math.round((done / assigned) * 100) : 0,
          ontimeRate: done > 0 ? Math.round((ontime / done) * 100) : 0,
          workloadIndex: Math.round((assigned / maxAssigned) * 100),
          activityIndex: Math.round((activity / maxActivity) * 100),
        };
      });
    }

    if (tab === "chat") {
      const msgs = await pool.query(
        `SELECT m.*, u.display_name, u.avatar_color FROM messages m
         LEFT JOIN users u ON u.id = m.user_id
         WHERE m.project_id=$1 ORDER BY m.created_at ASC LIMIT 100`,
        [projectId],
      );
      tabData.messages = msgs.rows;
    }

    if (tab === "overview") {
      // Stats
      const totalTasks = tabData.tasks.length;
      const doneTasks = tabData.tasks.filter(
        (t) => t.status === "approved",
      ).length;
      const progress =
        totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
      const memberCount = await pool.query(
        `SELECT COUNT(*) FROM project_members WHERE project_id=$1 AND status='active'`,
        [projectId],
      );
      const recentActivity = await pool.query(
        `SELECT al.*, u.display_name FROM activity_log al LEFT JOIN users u ON u.id=al.user_id
         WHERE al.project_id=$1 ORDER BY al.created_at DESC LIMIT 10`,
        [projectId],
      );
      tabData.stats = {
        totalTasks,
        doneTasks,
        progress,
        memberCount: parseInt(memberCount.rows[0].count),
        overdueTasks: tabData.tasks.filter(
          (t) =>
            t.deadline &&
            new Date(t.deadline) < new Date() &&
            t.status !== "approved",
        ).length,
      };
      tabData.recentActivity = recentActivity.rows;
    }

    // My tasks (if member)
    if (memberInfo) {
      const myTasksR = await pool.query(
        `SELECT t.*, 
         (SELECT ts.status FROM task_submissions ts WHERE ts.task_id=t.id AND ts.user_id=$1 ORDER BY ts.submitted_at DESC LIMIT 1) AS my_submission_status,
         (SELECT ts.drive_link FROM task_submissions ts WHERE ts.task_id=t.id AND ts.user_id=$1 ORDER BY ts.submitted_at DESC LIMIT 1) AS my_drive_link,
         (SELECT ts.id FROM task_submissions ts WHERE ts.task_id=t.id AND ts.user_id=$1 ORDER BY ts.submitted_at DESC LIMIT 1) AS my_submission_id
         FROM tasks t WHERE t.project_id=$2 AND ($1 = ANY(t.assigned_to) OR t.assigned_to IS NULL OR cardinality(t.assigned_to) = 0)
         AND t.status != 'approved' ORDER BY t.deadline ASC NULLS LAST`,
        [userId, projectId],
      );
      tabData.myTasks = myTasksR.rows;
    }

    // Notifications count
    const notifCount = await pool.query(
      "SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND is_read=FALSE",
      [userId],
    );

    // Active members for task assignment
    if (tab === "tasks" || tab === "members") {
      const activeMembersForTask = await pool.query(
        `SELECT pm.user_id, u.display_name FROM project_members pm JOIN users u ON u.id=pm.user_id
         WHERE pm.project_id=$1 AND pm.status='active' ORDER BY u.display_name`,
        [projectId],
      );
      tabData.activeMembers =
        tabData.activeMembers || activeMembersForTask.rows;
    }

    res.render("projects/detail", {
      title: project.name,
      project,
      memberInfo,
      canManage,
      canEditTasks,
      canReviewSubmissions,
      canViewPeerSubmissions,
      isAdminUser,
      tab,
      notifCount: parseInt(notifCount.rows[0].count),
      ...tabData,
      flash: req.query.flash || null,
      flashType: req.query.type || "success",
      escHtml: (s) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"),
    });
  } catch (err) {
    console.error(err);
    res.render("error", { title: "Lỗi", message: err.message, code: 500 });
  }
});

// ============================================================
// TASKS
// ============================================================

// POST /projects/:id/tasks/create
router.post("/:id/tasks/create", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const { title, description, assigned_to, deadline, priority, requires_submission } = req.body;
  const userId = req.session.userId;
  let assignees = [];
  if (Array.isArray(assigned_to)) {
    assignees = assigned_to.map(x => parseInt(x)).filter(x => !isNaN(x));
  } else if (assigned_to) {
    const p = parseInt(assigned_to);
    if (!isNaN(p)) assignees.push(p);
  }
  const assignedToArray = assignees.length > 0 ? assignees : null;

  try {
    const memberInfo = await getMemberRole(projectId, userId);
    const proj = await pool.query("SELECT * FROM projects WHERE id=$1", [
      projectId,
    ]);
    if (
      !canEditProjectTasks(memberInfo, proj.rows[0], userId, req.session.role)
    ) {
      return res.redirect(
        `/projects/${projectId}?tab=tasks&flash=Không+có+quyền&type=error`,
      );
    }
    const taskR = await pool.query(
      "INSERT INTO tasks (project_id, title, description, assigned_to, deadline, priority, requires_submission, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [
        projectId,
        title.trim(),
        description,
        assignedToArray,
        deadline || null,
        priority || "medium",
        requires_submission === 'false' ? false : true,
        userId,
      ],
    );
    // Notify assignee
    if (assignees.length > 0) {
      for (const uid of assignees) {
        await notify(
          uid,
          projectId,
          "task_assigned",
          "📋 Nhiệm vụ mới",
          `Bạn được giao nhiệm vụ: "${title}"${deadline ? ` (Hạn: ${new Date(deadline).toLocaleDateString("vi-VN")})` : ""}`,
        );
      }
    }
    await logActivity(
      projectId,
      userId,
      "create_task",
      `Tạo nhiệm vụ: "${title}"`,
    );
    res.redirect(
      `/projects/${projectId}?tab=tasks&flash=Đã+tạo+nhiệm+vụ&type=success`,
    );
  } catch (err) {
    console.error(err);
    res.redirect(
      `/projects/${projectId}?tab=tasks&flash=Lỗi+tạo+nhiệm+vụ&type=error`,
    );
  }
});

// POST /projects/:id/tasks/:tid/confirm — Member confirms they received/accept the task
router.post("/:id/tasks/:tid/confirm", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const taskId = parseInt(req.params.tid);
  const userId = req.session.userId;
  try {
    // Add userId to confirmed_by array if not already there
    await pool.query(
      `UPDATE tasks SET confirmed_by = array_append(
        COALESCE(confirmed_by, '{}'),
        $1
       ) WHERE id=$2 AND project_id=$3 AND NOT ($1 = ANY(COALESCE(confirmed_by, '{}')))`,
      [userId, taskId, projectId]
    );
    // Change status from todo -> in_progress if confirming
    await pool.query(
      `UPDATE tasks SET status='in_progress' WHERE id=$1 AND project_id=$2 AND status='todo'`,
      [taskId, projectId]
    );
    const taskR = await pool.query("SELECT title FROM tasks WHERE id=$1", [taskId]);
    await logActivity(projectId, userId, "confirm_task", `Xác nhận nhận nhiệm vụ: "${taskR.rows[0]?.title}"`);
    res.redirect(`/projects/${projectId}?tab=tasks&flash=Đã+xác+nhận+nhận+nhiệm+vụ&type=success`);
  } catch (err) {
    console.error(err);
    res.redirect(`/projects/${projectId}?tab=tasks&flash=Lỗi&type=error`);
  }
});

// POST /projects/:id/tasks/:tid/submit - Member submits drive link
router.post("/:id/tasks/:tid/submit", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const taskId = parseInt(req.params.tid);
  const { drive_link, note } = req.body;
  const userId = req.session.userId;
  try {
    await pool.query(
      "INSERT INTO task_submissions (task_id, user_id, drive_link, note) VALUES ($1,$2,$3,$4)",
      [taskId, userId, drive_link, note || null],
    );
    await pool.query("UPDATE tasks SET status='submitted' WHERE id=$1", [
      taskId,
    ]);
    // Notify leaders
    const leaders = await pool.query(
      `SELECT pm.user_id FROM project_members pm WHERE pm.project_id=$1 AND pm.role IN ('leader','vice_leader') AND pm.status='active'`,
      [projectId],
    );
    const taskR = await pool.query("SELECT title FROM tasks WHERE id=$1", [
      taskId,
    ]);
    const taskTitle = taskR.rows[0]?.title || "";
    for (const l of leaders.rows) {
      await notify(
        l.user_id,
        projectId,
        "submission",
        "📨 Nộp bài mới",
        `${req.session.displayName} đã nộp nhiệm vụ: "${taskTitle}"`,
      );
    }
    await logActivity(
      projectId,
      userId,
      "submit_task",
      `Nộp nhiệm vụ: "${taskTitle}"`,
    );
    res.redirect(
      `/projects/${projectId}?tab=tasks&flash=Đã+nộp+bài+thành+công&type=success`,
    );
  } catch (err) {
    console.error(err);
    res.redirect(
      `/projects/${projectId}?tab=tasks&flash=Lỗi+nộp+bài&type=error`,
    );
  }
});

// POST /projects/:id/tasks/:tid/review
router.post("/:id/tasks/:tid/review", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const taskId = parseInt(req.params.tid);
  const { submission_id, action, leader_note } = req.body;
  const userId = req.session.userId;
  try {
    const memberInfo = await getMemberRole(projectId, userId);
    const proj = await pool.query("SELECT * FROM projects WHERE id=$1", [
      projectId,
    ]);
    if (
      !canReviewProjectSubmissions(
        memberInfo,
        proj.rows[0],
        userId,
        req.session.role,
      )
    ) {
      return res.redirect(
        `/projects/${projectId}?tab=tasks&flash=Không+có+quyền&type=error`,
      );
    }
    const newStatus = action === "approve" ? "approved" : "rejected";
    const newTaskStatus = action === "approve" ? "approved" : "rejected";
    await pool.query(
      "UPDATE task_submissions SET status=$1, leader_note=$2, reviewed_at=NOW() WHERE id=$3",
      [newStatus, leader_note || null, submission_id],
    );
    await pool.query("UPDATE tasks SET status=$1 WHERE id=$2", [
      newTaskStatus,
      taskId,
    ]);
    // Notify submitter
    const subR = await pool.query(
      "SELECT user_id FROM task_submissions WHERE id=$1",
      [submission_id],
    );
    const taskR = await pool.query("SELECT title FROM tasks WHERE id=$1", [
      taskId,
    ]);
    if (subR.rows[0]) {
      const icon = action === "approve" ? "✅" : "❌";
      const word = action === "approve" ? "duyệt" : "từ chối";
      await notify(
        subR.rows[0].user_id,
        projectId,
        action === "approve" ? "approved" : "rejected",
        `${icon} Bài nộp ${word}`,
        `Nhiệm vụ "${taskR.rows[0]?.title}" đã được ${word}${leader_note ? `: ${leader_note}` : ""}`,
      );
    }
    await logActivity(
      projectId,
      userId,
      "review_task",
      `${action === "approve" ? "Duyệt" : "Từ chối"}: "${taskR.rows[0]?.title}"`,
    );
    res.redirect(
      `/projects/${projectId}?tab=tasks&flash=Đã+xử+lý+bài+nộp&type=success`,
    );
  } catch (err) {
    console.error(err);
    res.redirect(`/projects/${projectId}?tab=tasks&flash=Lỗi&type=error`);
  }
});

// POST /projects/:id/tasks/:tid/undo-approve
router.post("/:id/tasks/:tid/undo-approve", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const taskId = parseInt(req.params.tid);
  const userId = req.session.userId;
  try {
    const memberInfo = await getMemberRole(projectId, userId);
    const proj = await pool.query("SELECT * FROM projects WHERE id=$1", [projectId]);
    if (!canReviewProjectSubmissions(memberInfo, proj.rows[0], userId, req.session.role)) {
      return res.redirect(`/projects/${projectId}?tab=tasks&flash=Không+có+quyền&type=error`);
    }

    const taskR = await pool.query("SELECT title FROM tasks WHERE id=$1", [taskId]);
    if (taskR.rows.length === 0) return res.redirect(`/projects/${projectId}?tab=tasks`);

    await pool.query(
      "UPDATE task_submissions SET status='submitted', leader_note=NULL WHERE task_id=$1 AND status='approved'",
      [taskId]
    );
    await pool.query("UPDATE tasks SET status='submitted' WHERE id=$1", [taskId]);

    await logActivity(
      projectId,
      userId,
      "undo_approve",
      `Hủy duyệt: "${taskR.rows[0].title}"`
    );

    res.redirect(`/projects/${projectId}?tab=tasks&flash=Đã+hủy+duyệt&type=success`);
  } catch (err) {
    console.error(err);
    res.redirect(`/projects/${projectId}?tab=tasks&flash=Lỗi&type=error`);
  }
});

// POST /projects/:id/tasks/:tid/delete
router.post("/:id/tasks/:tid/delete", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const taskId = parseInt(req.params.tid);
  const userId = req.session.userId;
  try {
    const memberInfo = await getMemberRole(projectId, userId);
    const proj = await pool.query("SELECT * FROM projects WHERE id=$1", [
      projectId,
    ]);
    if (
      !canEditProjectTasks(memberInfo, proj.rows[0], userId, req.session.role)
    ) {
      return res.redirect(
        `/projects/${projectId}?tab=tasks&flash=Không+có+quyền&type=error`,
      );
    }
    await pool.query("DELETE FROM tasks WHERE id=$1 AND project_id=$2", [
      taskId,
      projectId,
    ]);
    res.redirect(
      `/projects/${projectId}?tab=tasks&flash=Đã+xóa+nhiệm+vụ&type=success`,
    );
  } catch (err) {
    console.error(err);
    res.redirect(`/projects/${projectId}?tab=tasks&flash=Lỗi&type=error`);
  }
});

// ============================================================
// KANBAN (Pro feature) - drag & drop status update
// ============================================================

// POST /projects/:id/tasks/:tid/status - AJAX status update for Kanban
router.post("/:id/tasks/:tid/status", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const taskId = parseInt(req.params.tid);
  const { status } = req.body;
  const userId = req.session.userId;
  const allowed = ["todo", "in_progress", "approved"];

  if (!allowed.includes(status)) {
    return res
      .status(400)
      .json({ ok: false, error: "Trạng thái không hợp lệ" });
  }
  try {
    const memberInfo = await getMemberRole(projectId, userId);
    const proj = await pool.query("SELECT * FROM projects WHERE id=$1", [
      projectId,
    ]);
    if (
      !memberInfo ||
      memberInfo.status !== "active" ||
      !canEditProjectTasks(memberInfo, proj.rows[0], userId, req.session.role)
    ) {
      return res
        .status(403)
        .json({ ok: false, error: "Bạn không có quyền sửa nhiệm vụ" });
    }
    const taskR = await pool.query(
      "UPDATE tasks SET status=$1 WHERE id=$2 AND project_id=$3 RETURNING title",
      [status, taskId, projectId],
    );
    if (!taskR.rows[0])
      return res
        .status(404)
        .json({ ok: false, error: "Không tìm thấy nhiệm vụ" });
    await logActivity(
      projectId,
      userId,
      "kanban_move",
      `Chuyển "${taskR.rows[0].title}" → ${status}`,
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Lỗi server" });
  }
});

// ============================================================
// EXPORT REPORTS (Pro feature) - PDF / Excel
// ============================================================

// Helper: gather full report data for a project
async function buildReportData(projectId) {
  const projR = await pool.query(
    `SELECT p.*, u.display_name AS owner_name FROM projects p LEFT JOIN users u ON u.id=p.owner_id WHERE p.id=$1`,
    [projectId],
  );
  const project = projR.rows[0];

  const members = await pool.query(
    `SELECT pm.role, pm.custom_role_name, pm.score, u.display_name, u.username
     FROM project_members pm JOIN users u ON u.id=pm.user_id
     WHERE pm.project_id=$1 AND pm.status='active'
     ORDER BY CASE pm.role WHEN 'leader' THEN 0 WHEN 'vice_leader' THEN 1 ELSE 2 END, pm.score DESC`,
    [projectId],
  );

  const tasks = await pool.query(
    `SELECT t.title, t.status, t.priority, t.deadline, string_agg(u.display_name, ', ') AS assignee_name
     FROM tasks t LEFT JOIN users u ON u.id=ANY(t.assigned_to)
     WHERE t.project_id=$1 
     GROUP BY t.id
     ORDER BY t.deadline ASC NULLS LAST, t.created_at ASC`,
    [projectId],
  );

  const totalTasks = tasks.rows.length;
  const doneTasks = tasks.rows.filter((t) => t.status === "approved").length;
  const progress =
    totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return {
    project,
    members: members.rows,
    tasks: tasks.rows,
    stats: { totalTasks, doneTasks, progress },
  };
}

// GET /projects/:id/export/pdf
router.get("/:id/export/pdf", async (req, res) => {
  const projectId = parseInt(req.params.id);
  try {
    const data = await buildReportData(projectId);
    if (!data.project)
      return res
        .status(404)
        .render("error", {
          title: "404",
          message: "Dự án không tồn tại",
          code: 404,
        });
    await generatePDFReport(res, data);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .render("error", {
        title: "Lỗi",
        message: "Không thể xuất PDF",
        code: 500,
      });
  }
});

// GET /projects/:id/export/excel
router.get("/:id/export/excel", async (req, res) => {
  const projectId = parseInt(req.params.id);
  try {
    const data = await buildReportData(projectId);
    if (!data.project)
      return res
        .status(404)
        .render("error", {
          title: "404",
          message: "Dự án không tồn tại",
          code: 404,
        });
    await generateExcelReport(res, data);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .render("error", {
        title: "Lỗi",
        message: "Không thể xuất Excel",
        code: 500,
      });
  }
});

// ============================================================
// MEMBERS
// ============================================================

// POST /projects/:id/members/:uid/approve
router.post("/:id/members/:uid/approve", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const targetUid = parseInt(req.params.uid);
  await pool.query(
    "UPDATE project_members SET status='active' WHERE project_id=$1 AND user_id=$2",
    [projectId, targetUid],
  );
  const projR = await pool.query("SELECT name FROM projects WHERE id=$1", [
    projectId,
  ]);
  await notify(
    targetUid,
    projectId,
    "member_joined",
    "✅ Yêu cầu được duyệt",
    `Bạn đã được thêm vào dự án "${projR.rows[0]?.name}"`,
  );
  await logActivity(
    projectId,
    req.session.userId,
    "approve_member",
    `Duyệt thành viên ID ${targetUid}`,
  );
  res.redirect(
    `/projects/${projectId}?tab=members&flash=Đã+duyệt+thành+viên&type=success`,
  );
});

// POST /projects/:id/members/:uid/reject
router.post("/:id/members/:uid/reject", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const targetUid = parseInt(req.params.uid);
  await pool.query(
    "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2 AND status=$3",
    [projectId, targetUid, "pending"],
  );
  res.redirect(
    `/projects/${projectId}?tab=members&flash=Đã+từ+chối+yêu+cầu&type=success`,
  );
});

// POST /projects/:id/members/:uid/role
router.post("/:id/members/:uid/role", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const targetUid = parseInt(req.params.uid);
  const { role, custom_role_name } = req.body;
  await pool.query(
    "UPDATE project_members SET role=$1, custom_role_name=$2 WHERE project_id=$3 AND user_id=$4",
    [role, custom_role_name || null, projectId, targetUid],
  );
  await logActivity(
    projectId,
    req.session.userId,
    "change_role",
    `Đổi vai trò thành viên ID ${targetUid} → ${role}`,
  );
  res.redirect(
    `/projects/${projectId}?tab=members&flash=Đã+cập+nhật+vai+trò&type=success`,
  );
});

// POST /projects/:id/members/:uid/score
router.post("/:id/members/:uid/score", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const targetUid = parseInt(req.params.uid);
  const { score } = req.body;
  await pool.query(
    "UPDATE project_members SET score=$1 WHERE project_id=$2 AND user_id=$3",
    [parseInt(score), projectId, targetUid],
  );
  res.redirect(
    `/projects/${projectId}?tab=members&flash=Đã+cập+nhật+điểm&type=success`,
  );
});

// POST /projects/:id/members/:uid/toggle-peer-submissions
router.post("/:id/members/:uid/toggle-peer-submissions", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const targetUid = parseInt(req.params.uid);

  try {
    const memberInfo = await getMemberRole(projectId, req.session.userId);
    const proj = await pool.query("SELECT * FROM projects WHERE id=$1", [
      projectId,
    ]);
    if (
      !isLeader(memberInfo, proj.rows[0], req.session.userId) &&
      req.session.role !== "admin"
    ) {
      return res.redirect(
        `/projects/${projectId}?tab=members&flash=Không+có+quyền&type=error`,
      );
    }

    const target = await pool.query(
      "SELECT status, can_view_peer_submissions FROM project_members WHERE project_id=$1 AND user_id=$2",
      [projectId, targetUid],
    );
    if (!target.rows[0] || target.rows[0].status !== "active") {
      return res.redirect(
        `/projects/${projectId}?tab=members&flash=Không+tìm+thấy+thành+viên&type=error`,
      );
    }

    const nextValue = !target.rows[0].can_view_peer_submissions;
    await pool.query(
      "UPDATE project_members SET can_view_peer_submissions=$1 WHERE project_id=$2 AND user_id=$3",
      [nextValue, projectId, targetUid],
    );
    await logActivity(
      projectId,
      req.session.userId,
      "toggle_peer_submission_access",
      `${nextValue ? "Cấp" : "Thu"} quyền xem bài nộp cho thành viên ID ${targetUid}`,
    );
    res.redirect(
      `/projects/${projectId}?tab=members&flash=${nextValue ? "Đã+cấp+quyền+xem+bài+nộp" : "Đã+thu+quyền+xem+bài+nộp"}&type=success`,
    );
  } catch (err) {
    console.error(err);
    res.redirect(`/projects/${projectId}?tab=members&flash=Lỗi&type=error`);
  }
});

// POST /projects/:id/members/:uid/toggle-comment-submissions
router.post(
  "/:id/members/:uid/toggle-comment-submissions",
  async (req, res) => {
    const projectId = parseInt(req.params.id);
    const targetUid = parseInt(req.params.uid);

    try {
      const memberInfo = await getMemberRole(projectId, req.session.userId);
      const proj = await pool.query("SELECT * FROM projects WHERE id=$1", [
        projectId,
      ]);
      if (
        !isLeader(memberInfo, proj.rows[0], req.session.userId) &&
        req.session.role !== "admin"
      ) {
        return res.redirect(
          `/projects/${projectId}?tab=members&flash=Không+có+quyền&type=error`,
        );
      }

      const target = await pool.query(
        "SELECT status, can_comment_submissions FROM project_members WHERE project_id=$1 AND user_id=$2",
        [projectId, targetUid],
      );
      if (!target.rows[0] || target.rows[0].status !== "active") {
        return res.redirect(
          `/projects/${projectId}?tab=members&flash=Không+tìm+thấy+thành+viên&type=error`,
        );
      }

      const nextValue = !target.rows[0].can_comment_submissions;
      await pool.query(
        "UPDATE project_members SET can_comment_submissions=$1 WHERE project_id=$2 AND user_id=$3",
        [nextValue, projectId, targetUid],
      );
      await logActivity(
        projectId,
        req.session.userId,
        "toggle_comment_access",
        `${nextValue ? "Cấp" : "Thu"} quyền bình luận cho thành viên ID ${targetUid}`,
      );
      res.redirect(
        `/projects/${projectId}?tab=members&flash=${nextValue ? "Đã+cấp+quyền+bình+luận" : "Đã+thu+quyền+bình+luận"}&type=success`,
      );
    } catch (err) {
      console.error(err);
      res.redirect(`/projects/${projectId}?tab=members&flash=Lỗi&type=error`);
    }
  },
);

// POST /projects/:id/members/:uid/toggle-approve-submissions
router.post(
  "/:id/members/:uid/toggle-approve-submissions",
  async (req, res) => {
    const projectId = parseInt(req.params.id);
    const targetUid = parseInt(req.params.uid);

    try {
      const memberInfo = await getMemberRole(projectId, req.session.userId);
      const proj = await pool.query("SELECT * FROM projects WHERE id=$1", [
        projectId,
      ]);
      if (
        !isLeader(memberInfo, proj.rows[0], req.session.userId) &&
        req.session.role !== "admin"
      ) {
        return res.redirect(
          `/projects/${projectId}?tab=members&flash=Không+có+quyền&type=error`,
        );
      }

      const target = await pool.query(
        "SELECT status, can_approve_submissions FROM project_members WHERE project_id=$1 AND user_id=$2",
        [projectId, targetUid],
      );
      if (!target.rows[0] || target.rows[0].status !== "active") {
        return res.redirect(
          `/projects/${projectId}?tab=members&flash=Không+tìm+thấy+thành+viên&type=error`,
        );
      }

      const nextValue = !target.rows[0].can_approve_submissions;
      await pool.query(
        "UPDATE project_members SET can_approve_submissions=$1 WHERE project_id=$2 AND user_id=$3",
        [nextValue, projectId, targetUid],
      );
      await logActivity(
        projectId,
        req.session.userId,
        "toggle_approve_access",
        `${nextValue ? "Cấp" : "Thu"} quyền phê duyệt cho thành viên ID ${targetUid}`,
      );
      res.redirect(
        `/projects/${projectId}?tab=members&flash=${nextValue ? "Đã+cấp+quyền+phê+duyệt" : "Đã+thu+quyền+phê+duyệt"}&type=success`,
      );
    } catch (err) {
      console.error(err);
      res.redirect(`/projects/${projectId}?tab=members&flash=Lỗi&type=error`);
    }
  },
);

// POST /projects/:id/members/:uid/toggle-edit-tasks
router.post("/:id/members/:uid/toggle-edit-tasks", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const targetUid = parseInt(req.params.uid);

  try {
    const memberInfo = await getMemberRole(projectId, req.session.userId);
    const proj = await pool.query("SELECT * FROM projects WHERE id=$1", [
      projectId,
    ]);
    if (
      !isLeader(memberInfo, proj.rows[0], req.session.userId) &&
      req.session.role !== "admin"
    ) {
      return res.redirect(
        `/projects/${projectId}?tab=members&flash=Không+có+quyền&type=error`,
      );
    }

    const target = await pool.query(
      "SELECT status, can_edit_tasks FROM project_members WHERE project_id=$1 AND user_id=$2",
      [projectId, targetUid],
    );
    if (!target.rows[0] || target.rows[0].status !== "active") {
      return res.redirect(
        `/projects/${projectId}?tab=members&flash=Không+tìm+thấy+thành+viên&type=error`,
      );
    }

    const nextValue = !target.rows[0].can_edit_tasks;
    await pool.query(
      "UPDATE project_members SET can_edit_tasks=$1 WHERE project_id=$2 AND user_id=$3",
      [nextValue, projectId, targetUid],
    );
    await logActivity(
      projectId,
      req.session.userId,
      "toggle_edit_tasks_access",
      `${nextValue ? "Cấp" : "Thu"} quyền chỉnh sửa nhiệm vụ cho thành viên ID ${targetUid}`,
    );
    res.redirect(
      `/projects/${projectId}?tab=members&flash=${nextValue ? "Đã+cấp+quyền+chỉnh+sửa+nv" : "Đã+thu+quyền+chỉnh+sửa+nv"}&type=success`,
    );
  } catch (err) {
    console.error(err);
    res.redirect(`/projects/${projectId}?tab=members&flash=Lỗi&type=error`);
  }
});

// POST /projects/:id/members/:uid/remove
router.post("/:id/members/:uid/remove", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const targetUid = parseInt(req.params.uid);
  await pool.query(
    "UPDATE project_members SET status='removed' WHERE project_id=$1 AND user_id=$2",
    [projectId, targetUid],
  );
  await logActivity(
    projectId,
    req.session.userId,
    "remove_member",
    `Xóa thành viên ID ${targetUid}`,
  );
  res.redirect(
    `/projects/${projectId}?tab=members&flash=Đã+xóa+thành+viên&type=success`,
  );
});

// ============================================================
// ROADMAP
// ============================================================

// POST /projects/:id/roadmap/create
router.post("/:id/roadmap/create", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const { title, description, start_date, end_date, color, assigned_to } =
    req.body;
  let assignees = [];
  if (Array.isArray(assigned_to)) {
    assignees = assigned_to.map(x => parseInt(x)).filter(x => !isNaN(x));
  } else if (assigned_to) {
    const p = parseInt(assigned_to);
    if (!isNaN(p)) assignees.push(p);
  }
  const assignedToArray = assignees.length > 0 ? assignees : null;

  try {
    await pool.query(
      "INSERT INTO roadmap_items (project_id, title, description, start_date, end_date, color, assigned_to) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [
        projectId,
        title,
        description || null,
        start_date,
        end_date,
        color || "#004b87",
        assignedToArray,
      ],
    );
    await logActivity(
      projectId,
      req.session.userId,
      "create_roadmap",
      `Tạo mốc lộ trình: "${title}"`,
    );
    res.redirect(
      `/projects/${projectId}?tab=roadmap&flash=Đã+thêm+mốc+lộ+trình&type=success`,
    );
  } catch (err) {
    res.redirect(`/projects/${projectId}?tab=roadmap&flash=Lỗi&type=error`);
  }
});

// POST /projects/:id/roadmap/:rid/status
router.post("/:id/roadmap/:rid/status", async (req, res) => {
  const { status } = req.body;
  await pool.query(
    "UPDATE roadmap_items SET status=$1 WHERE id=$2 AND project_id=$3",
    [status, req.params.rid, req.params.id],
  );
  res.redirect(
    `/projects/${req.params.id}?tab=roadmap&flash=Cập+nhật+lộ+trình&type=success`,
  );
});

// POST /projects/:id/roadmap/:rid/delete
router.post("/:id/roadmap/:rid/delete", async (req, res) => {
  await pool.query("DELETE FROM roadmap_items WHERE id=$1 AND project_id=$2", [
    req.params.rid,
    req.params.id,
  ]);
  res.redirect(
    `/projects/${req.params.id}?tab=roadmap&flash=Đã+xóa+mốc&type=success`,
  );
});

// ============================================================
// SETTINGS
// ============================================================

// POST /projects/:id/settings/update
router.post("/:id/settings/update", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const { name, description, deadline, deadline_alert_days, status, color, is_public } =
    req.body;
  try {
    await pool.query(
      "UPDATE projects SET name=$1, description=$2, deadline=$3, deadline_alert_days=$4, status=$5, color=$6, is_public=$7 WHERE id=$8",
      [
        name,
        description,
        deadline || null,
        parseInt(deadline_alert_days) || 2,
        status,
        color || "#004b87",
        is_public === "on" || is_public === "true",
        projectId,
      ],
    );
    await logActivity(
      projectId,
      req.session.userId,
      "update_settings",
      "Cập nhật cài đặt dự án",
    );
    res.redirect(
      `/projects/${projectId}?tab=settings&flash=Đã+lưu+cài+đặt&type=success`,
    );
  } catch (err) {
    res.redirect(
      `/projects/${projectId}?tab=settings&flash=Lỗi+lưu+cài+đặt&type=error`,
    );
  }
});

// POST /projects/:id/settings/delete
router.post("/:id/settings/delete", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const proj = await pool.query("SELECT owner_id FROM projects WHERE id=$1", [
    projectId,
  ]);
  if (!proj.rows[0]) return res.redirect("/dashboard");
  if (
    proj.rows[0].owner_id !== req.session.userId &&
    req.session.role !== "admin"
  ) {
    return res.redirect(
      `/projects/${projectId}?tab=settings&flash=Không+có+quyền&type=error`,
    );
  }
  await pool.query("DELETE FROM projects WHERE id=$1", [projectId]);
  res.redirect("/dashboard?flash=Đã+xóa+dự+án&type=success");
});

// POST /projects/:id/settings/regen-code - Regenerate invite code
router.post("/:id/settings/regen-code", async (req, res) => {
  const projectId = parseInt(req.params.id);
  let code = genCode();
  while (
    (await pool.query("SELECT id FROM projects WHERE invite_code=$1", [code]))
      .rows.length > 0
  ) {
    code = genCode();
  }
  await pool.query("UPDATE projects SET invite_code=$1 WHERE id=$2", [
    code,
    projectId,
  ]);
  res.redirect(
    `/projects/${projectId}?tab=settings&flash=Đã+tạo+mã+mới&type=success`,
  );
});

// ============================================================
// NOTIFICATIONS
// ============================================================

// POST /projects/:id/notifications/read-all
router.post("/:id/notifications/read-all", async (req, res) => {
  await pool.query("UPDATE notifications SET is_read=TRUE WHERE user_id=$1", [
    req.session.userId,
  ]);
  res.redirect(req.headers.referer || "/dashboard");
});

// POST /projects/:id/tasks/:taskId/edit - Chỉnh sửa nhiệm vụ
router.post("/:id/tasks/:taskId/edit", async (req, res) => {
  const projectId = parseInt(req.params.id);
  const taskId = parseInt(req.params.taskId);
  const userId = req.session.userId;
  const { title, description, priority, status, requires_submission } = req.body;

  try {
    const projResult = await pool.query("SELECT owner_id FROM projects WHERE id=$1", [projectId]);
    if (projResult.rows.length === 0) return res.redirect("/dashboard");
    const project = projResult.rows[0];

    const memberInfo = await getMemberRole(projectId, userId);
    
    // Check if user can edit
    if (!canEditProjectTasks(memberInfo, project, userId, req.session.role)) {
      return res.redirect(`/projects/${projectId}?flash=Bạn+không+có+quyền+sửa+nhiệm+vụ&type=error`);
    }

    const reqSub = requires_submission === 'true' || requires_submission === 'on';

    await pool.query(
      `UPDATE tasks SET title=$1, description=$2, priority=$3, status=$4, requires_submission=$5 WHERE id=$6 AND project_id=$7`,
      [title, description || null, priority || 'medium', status || 'todo', reqSub, taskId, projectId]
    );

    logActivity(projectId, userId, "edit_task", `Đã sửa nhiệm vụ: ${title}`);
    res.redirect(`/projects/${projectId}?tab=tasks&flash=Đã+lưu+thay+đổi&type=success`);
  } catch (err) {
    console.error("Edit task err", err);
    res.redirect(`/projects/${projectId}?tab=tasks&flash=Lỗi+khi+lưu+thay+đổi&type=error`);
  }
});

module.exports = router;
