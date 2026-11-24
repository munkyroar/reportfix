import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('student','staff','admin')),
  department TEXT,
  trust_score REAL NOT NULL DEFAULT 50,
  is_new INTEGER NOT NULL DEFAULT 1,
  action_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('reset','mfa_login')),
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  building TEXT NOT NULL,
  kind TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  raw_text TEXT NOT NULL,
  clean_text TEXT NOT NULL,
  ai_json TEXT,
  location_id INTEGER REFERENCES locations(id),
  problem_type TEXT,
  status TEXT NOT NULL,
  pending_items TEXT,
  confidential INTEGER NOT NULL DEFAULT 0,
  injection_flag INTEGER NOT NULL DEFAULT 0,
  fallback_used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id INTEGER REFERENCES locations(id),
  problem_type TEXT NOT NULL,
  department TEXT NOT NULL,
  severity TEXT NOT NULL,
  base_severity INTEGER NOT NULL,
  hazard TEXT NOT NULL DEFAULT 'none',
  priority_score REAL NOT NULL,
  priority_breakdown TEXT,
  status TEXT NOT NULL,
  confidential INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  reason TEXT,
  sample_text TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER,
  reopen_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_issues_group ON issues(location_id, problem_type, status);
CREATE INDEX IF NOT EXISTS idx_issues_dept ON issues(department, confidential);

CREATE TABLE IF NOT EXISTS issue_members (
  issue_id INTEGER NOT NULL REFERENCES issues(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  report_id INTEGER REFERENCES reports(id),
  joined_at INTEGER NOT NULL,
  UNIQUE (issue_id, user_id)
);

CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL REFERENCES issues(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  round INTEGER NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('confirm','dispute')),
  weight_at_vote REAL NOT NULL,
  discounted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (issue_id, user_id, round)
);

CREATE TABLE IF NOT EXISTS trust_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  delta REAL NOT NULL,
  reason TEXT NOT NULL,
  ref_id INTEGER,
  score_after REAL NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS status_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL REFERENCES issues(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  by_user INTEGER,
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER REFERENCES reports(id),
  prompt_version TEXT NOT NULL,
  provider TEXT,
  raw_output TEXT,
  fallback_used INTEGER NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  issue_id INTEGER,
  report_id INTEGER,
  user_id INTEGER,
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

export function openDb(file) {
  const target = file || process.env.DB_PATH || path.resolve('data', 'reportfix.db');
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new Database(target);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  // migrate DB files created before accounts had credentials
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('username')) db.exec('ALTER TABLE users ADD COLUMN username TEXT');
  if (!cols.includes('password_hash')) db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  for (const [c, t] of [['mfa_secret', 'TEXT'], ['mfa_pending_secret', 'TEXT'], ['mfa_enabled', 'INTEGER NOT NULL DEFAULT 0'], ['mfa_last_step', 'INTEGER NOT NULL DEFAULT 0'], ['password_changed_at', 'INTEGER']]) {
    if (!cols.includes(c)) db.exec(`ALTER TABLE users ADD COLUMN ${c} ${t}`);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)');
  return db;
}

export function wipe(db) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM admin_flags; DELETE FROM ai_log; DELETE FROM status_log; DELETE FROM trust_events;
    DELETE FROM sessions; DELETE FROM auth_tokens; DELETE FROM votes; DELETE FROM issue_members; DELETE FROM issues; DELETE FROM reports;
    DELETE FROM users; DELETE FROM locations;
    DELETE FROM sqlite_sequence;
    PRAGMA foreign_keys = ON;
  `);
}
