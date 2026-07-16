const { Pool } = require("pg");

function shouldUseSsl(connectionString) {
  if (process.env.PGSSLMODE === "disable") return false;
  if (process.env.DB_SSL === "true") return true;
  if (!connectionString) return false;

  try {
    const hostname = new URL(connectionString).hostname;
    return !["localhost", "127.0.0.1", "::1"].includes(hostname);
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
});

module.exports = pool;
