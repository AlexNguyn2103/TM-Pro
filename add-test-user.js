require("dotenv").config();
const pool = require("./db/pool");
const bcrypt = require("bcryptjs");

(async () => {
  try {
    // Create test user
    const hashedPwd = await bcrypt.hash("user123", 10);
    const u = await pool.query(
      "INSERT INTO users (username, password, display_name, avatar_color) VALUES ($1,$2,$3,$4) RETURNING id",
      ["testuser", hashedPwd, "Test User", "#ff00ff"],
    );
    const userId = u.rows[0].id;
    console.log("✅ Created user:", userId);

    // Add to project as member
    await pool.query(
      "INSERT INTO project_members (project_id, user_id, role, status) VALUES ($1,$2,$3,$4)",
      [2, userId, "member", "active"],
    );
    console.log("✅ Added user to project");

    process.exit(0);
  } catch (e) {
    console.error("❌ Error:", e.message);
    process.exit(1);
  }
})();
