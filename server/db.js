// SQLite database (file based, zero-config). Swap for PostgreSQL in production if you need horizontal scaling.
const { DatabaseSync } = require('node:sqlite'); // built into Node 22.13+ / 24: nothing to compile
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'hivemind.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.pragma = str => db.exec('PRAGMA ' + str);   // small compatibility helpers so the rest of the code stays simple
let depth = 0;
db.transaction = fn => (...args) => {
  const name = 'sp' + depth++;
  db.exec(depth === 1 ? 'BEGIN' : `SAVEPOINT ${name}`);
  try { const r = fn(...args); db.exec(depth === 1 ? 'COMMIT' : `RELEASE ${name}`); depth--; return r; }
  catch (e) { db.exec(depth === 1 ? 'ROLLBACK' : `ROLLBACK TO ${name}`); depth--; throw e; }
};

db.exec(`
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, city TEXT, lat REAL NOT NULL, lng REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','technician','customer')),
  site_id INTEGER REFERENCES sites(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS technicians (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE REFERENCES users(id),
  skills TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','busy','off')),
  max_load INTEGER NOT NULL DEFAULT 2,
  experience_years REAL NOT NULL DEFAULT 1,
  rating REAL NOT NULL DEFAULT 4,
  lat REAL, lng REAL, base_label TEXT
);
CREATE TABLE IF NOT EXISTS machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  status TEXT NOT NULL DEFAULT 'operational',
  install_date TEXT, last_service TEXT,
  runtime_hours REAL NOT NULL DEFAULT 0,
  last_service_runtime REAL NOT NULL DEFAULT 0,
  service_interval_hours REAL NOT NULL DEFAULT 800,
  hourly_loss REAL NOT NULL DEFAULT 20000,
  dependents INTEGER NOT NULL DEFAULT 0,
  sla_penalty_per_hour REAL NOT NULL DEFAULT 5000,
  base_temp REAL NOT NULL DEFAULT 60, base_vib REAL NOT NULL DEFAULT 2.5, drift REAL NOT NULL DEFAULT 0,
  warranty_until TEXT
);
CREATE TABLE IF NOT EXISTS telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  ts TEXT NOT NULL, temperature REAL NOT NULL, vibration REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tel ON telemetry(machine_id, id);
CREATE TABLE IF NOT EXISTS parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0, reserved INTEGER NOT NULL DEFAULT 0,
  lead_time_hours INTEGER NOT NULL DEFAULT 24, unit_cost REAL NOT NULL DEFAULT 0,
  compatible_types TEXT NOT NULL DEFAULT '["*"]'
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  site_id INTEGER NOT NULL REFERENCES sites(id),
  title TEXT NOT NULL, description TEXT,
  priority TEXT NOT NULL CHECK (priority IN ('critical','high','medium','low')),
  kind TEXT NOT NULL DEFAULT 'corrective',
  status TEXT NOT NULL DEFAULT 'pending_approval',
  required_skills TEXT NOT NULL DEFAULT '[]',
  required_parts TEXT NOT NULL DEFAULT '[]',
  created_by INTEGER REFERENCES users(id),
  technician_id INTEGER REFERENCES technicians(id),
  approved_by INTEGER REFERENCES users(id),
  verified_by INTEGER REFERENCES users(id),
  sla_due TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  started_at TEXT, submitted_at TEXT, completed_at TEXT,
  completion_notes TEXT, checklist TEXT,
  risk_alerted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_req_status ON requests(status);
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  part_id INTEGER NOT NULL REFERENCES parts(id),
  qty INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','consumed','released'))
);
CREATE TABLE IF NOT EXISTS task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  user_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL DEFAULT 'note', message TEXT NOT NULL, ts TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  type TEXT NOT NULL CHECK (type IN ('tech_dropout','part_unavailable','sla_breach')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  detail TEXT, meta TEXT, created_at TEXT NOT NULL, resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  filename TEXT NOT NULL, original_name TEXT, mime TEXT,
  uploaded_by INTEGER REFERENCES users(id), ts TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL, link TEXT, read INTEGER NOT NULL DEFAULT 0, ts TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, action TEXT NOT NULL, entity TEXT, entity_id TEXT, detail TEXT,
  ts TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
`);

module.exports = { db, DATA_DIR };
