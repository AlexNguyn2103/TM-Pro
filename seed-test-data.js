equire("dotenv").config();
const pool = require("./db/pool");

(async () => {
  try {
    // Create test project
    const p = await pool.query(
      "INSERT INTO projects (name, description, invite_code, owner_id) VALUES ($1,$2,$3,$4) RETURNING id",
      ["Test Project", "Test Description", "TEST1234", 1],
    );
    const projectId = p.rows[0].id;
    console.log("✅ Created project:", projectId);

    // Add admin as member
    await pool.query(
      "INSERT INTO project_members (project_id, user_id, role, status) VALUES ($1,$2,$3,$4)",
      [projectId, 1, "leader", "active"],
    );
    console.log("✅ Added admin as leader");

    // Create test task
    const t = await pool.query(
      "INSERT INTO tasks (project_id, title, description, deadline, priority, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [projectId, "Test Task 1", "Do something", "2025-01-01", "high", 1],
    );
    console.log("✅ Created task:", t.rows[0].id);

    process.exit(0);
  } catch (e) {
    console.error("❌ Error:", e.message);
    console.error("Stack:", e.stack);
    process.exit(1);
  }
})();
