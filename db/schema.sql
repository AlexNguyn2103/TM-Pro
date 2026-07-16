-- ============================================================
-- NEON TEAMWORK DATABASE SCHEMA
-- ============================================================

-- Sessions table (for express-session)
CREATE TABLE IF NOT EXISTS "session" (
  "sid" VARCHAR NOT NULL COLLATE "default",
  "sess" JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'session_pkey'
  ) THEN
    ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  email VARCHAR(100) UNIQUE,
  display_name VARCHAR(100),
  role VARCHAR(20) DEFAULT 'user', -- 'admin', 'user'
  is_active BOOLEAN DEFAULT TRUE,
  avatar_color VARCHAR(20) DEFAULT '#004b87',
  plan VARCHAR(10) DEFAULT 'free', -- 'free', 'pro'
  theme VARCHAR(10) DEFAULT 'dark', -- 'dark', 'light'
  accent_color VARCHAR(20) DEFAULT '#004b87', -- Pro: custom theme accent
  created_at TIMESTAMP DEFAULT NOW()
);

-- Migrate existing installs (no-op if columns already exist)
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(10) DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(10) DEFAULT 'dark';
ALTER TABLE users ADD COLUMN IF NOT EXISTS accent_color VARCHAR(20) DEFAULT '#004b87';

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  invite_code VARCHAR(20) UNIQUE NOT NULL,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deadline DATE,
  status VARCHAR(20) DEFAULT 'active', -- 'active', 'completed', 'archived'
  color VARCHAR(20) DEFAULT '#004b87',
  deadline_alert_days INTEGER DEFAULT 2,
  template VARCHAR(50),
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS template VARCHAR(50);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE;

-- Project Members
CREATE TABLE IF NOT EXISTS project_members (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'member', -- 'leader', 'vice_leader', 'member', 'custom'
  custom_role_name VARCHAR(100),
  score INTEGER DEFAULT 0,
  can_view_peer_submissions BOOLEAN DEFAULT FALSE,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'active', 'removed'
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

ALTER TABLE project_members ADD COLUMN IF NOT EXISTS can_view_peer_submissions BOOLEAN DEFAULT FALSE;
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS can_comment_submissions BOOLEAN DEFAULT FALSE;
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS can_approve_submissions BOOLEAN DEFAULT FALSE;
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS can_edit_tasks BOOLEAN DEFAULT FALSE;

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  assigned_to INTEGER[],
  deadline TIMESTAMP,
  status VARCHAR(20) DEFAULT 'todo', -- 'todo', 'in_progress', 'submitted', 'approved', 'rejected'
  priority VARCHAR(20) DEFAULT 'medium', -- 'low', 'medium', 'high', 'urgent'
  requires_submission BOOLEAN DEFAULT TRUE, -- nhiệm vụ có cần nộp tài liệu không
  confirmed_by INTEGER[], -- danh sách user_id đã confirm nhận nhiệm vụ
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS requires_submission BOOLEAN DEFAULT TRUE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS confirmed_by INTEGER[] DEFAULT '{}';


-- Task Submissions
CREATE TABLE IF NOT EXISTS task_submissions (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  drive_link TEXT,
  note TEXT,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  leader_note TEXT,
  submitted_at TIMESTAMP DEFAULT NOW(),
  reviewed_at TIMESTAMP
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  type VARCHAR(50), -- 'task_assigned', 'submission', 'deadline_warning', 'approved', 'rejected', 'member_joined', 'chat'
  title VARCHAR(200),
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Chat Messages
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Roadmap Items
CREATE TABLE IF NOT EXISTS roadmap_items (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'in_progress', 'done'
  color VARCHAR(20) DEFAULT '#004b87',
  assigned_to INTEGER[],
  created_at TIMESTAMP DEFAULT NOW()
);

-- Activity Log
CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100),
  detail TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- SEED: Default Admin Account
-- Password: admin12 (bcrypt hashed)
-- ============================================================
INSERT INTO users (username, password, role, display_name, avatar_color)
VALUES (
  'admin',
  '$2a$10$Ol1l/V66wk4wK0mxUTCG/euz.29dQ5UhbrdfxGyTemaNoGTqdlyPG',
  'admin',
  'Administrator',
  '#ff00cc'
)
ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password;

-- ============================================================
-- MIGRATION: Convert assigned_to from INTEGER to INTEGER[]
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'assigned_to' AND data_type = 'integer') THEN
    ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_assigned_to_fkey;
    ALTER TABLE tasks ALTER COLUMN assigned_to TYPE INTEGER[] USING CASE WHEN assigned_to IS NULL THEN NULL ELSE ARRAY[assigned_to]::INTEGER[] END;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'roadmap_items' AND column_name = 'assigned_to' AND data_type = 'integer') THEN
    ALTER TABLE roadmap_items DROP CONSTRAINT IF EXISTS roadmap_items_assigned_to_fkey;
    ALTER TABLE roadmap_items ALTER COLUMN assigned_to TYPE INTEGER[] USING CASE WHEN assigned_to IS NULL THEN NULL ELSE ARRAY[assigned_to]::INTEGER[] END;
  END IF;
END $$;
