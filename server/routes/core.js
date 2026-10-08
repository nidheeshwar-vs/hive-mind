// Auth, meta, notifications, audit, public endpoints, IoT ingestion, SSE.
const express = require('express');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');
const { auth, sign } = require('../auth');
const { audit, verifyChain } = require('../services/audit');
const { addClient, broadcast, notifyAdmins } = require('../services/events');
const { SKILLS, PRIORITIES, SLA_HOURS, MACHINE_TYPES } = require('../services/workflow');
const { computeHealth } = require('../services/health');

const r = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in a few minutes.' } });

// ---- Auth ------------------------------------------------------------------
r.post('/auth/login', loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').toLowerCase().trim());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) return res.status(401).json({ error: 'Email or password is incorrect.' });
  audit(u.id, 'login', 'user', u.id, u.role);
  res.json({ token: sign(u), user: { id: u.id, name: u.name, email: u.email, role: u.role, site_id: u.site_id } });
});
r.post('/auth/register', loginLimiter, (req, res) => {
  const { name, email, password, site_id } = req.body || {};
  if (!name || !email || !password || password.length < 6) return res.status(400).json({ error: 'Enter your name, a valid email and a password of at least 6 characters.' });
  if (!db.prepare('SELECT id FROM sites WHERE id=?').get(site_id)) return res.status(400).json({ error: 'Choose your site.' });
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase())) return res.status(409).json({ error: 'That email is already registered.' });
  const id = db.prepare("INSERT INTO users (name,email,password_hash,role,site_id) VALUES (?,?,?,'customer',?)").run(name.trim(), email.toLowerCase().trim(), bcrypt.hashSync(password, 10), site_id).lastInsertRowid;
  audit(id, 'register', 'user', id, 'customer');
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  res.json({ token: sign(u), user: { id, name: u.name, email: u.email, role: u.role, site_id: u.site_id } });
});
r.get('/auth/me', auth(), (req, res) => {
  const { id, name, email, role, site_id, tech } = req.user;
  res.json({ user: { id, name, email, role, site_id, technician: tech || null } });
});

// ---- Meta (dropdown data) --------------------------------------------------
r.get('/meta', (req, res) => {
  res.json({ sites: db.prepare('SELECT * FROM sites').all(), skills: SKILLS, priorities: PRIORITIES, sla_hours: SLA_HOURS, machine_types: MACHINE_TYPES });
});

// ---- Public (no login): landing stats + machine passport -------------------
r.get('/public/stats', (req, res) => {
  const c = sql => db.prepare(sql).get().c;
  res.json({
    machines: c('SELECT COUNT(*) c FROM machines'), sites: c('SELECT COUNT(*) c FROM sites'), technicians: c('SELECT COUNT(*) c FROM technicians'),
    completed: c("SELECT COUNT(*) c FROM requests WHERE status='completed'"), active: c("SELECT COUNT(*) c FROM requests WHERE status NOT IN ('completed','rejected')")
  });
});
r.get('/public/passport/:code', (req, res) => {
  const m = db.prepare('SELECT m.*, s.name site_name FROM machines m JOIN sites s ON s.id=m.site_id WHERE m.code=?').get(req.params.code);
  if (!m) return res.status(404).json({ error: 'Machine not found.' });
  const h = computeHealth(m);
  const history = db.prepare("SELECT code,title,priority,completed_at FROM requests WHERE machine_id=? AND status='completed' ORDER BY completed_at DESC LIMIT 8").all(m.id);
  const open = db.prepare("SELECT COUNT(*) c FROM requests WHERE machine_id=? AND status NOT IN ('completed','rejected')").get(m.id).c;
  res.json({ code: m.code, name: m.name, type: m.type, site: m.site_name, status: m.status, install_date: m.install_date, last_service: m.last_service,
    warranty_until: m.warranty_until, health: { risk: h.risk, level: h.level, recommendation: h.recommendation }, open_requests: open, history });
});

// ---- Notifications ---------------------------------------------------------
r.get('/notifications', auth(), (req, res) => {
  const items = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30').all(req.user.id);
  res.json({ items, unread: db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read=0').get(req.user.id).c });
});
r.post('/notifications/read', auth(), (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});

// ---- Audit trail -----------------------------------------------------------
r.get('/audit', auth('admin'), (req, res) => {
  const rows = db.prepare('SELECT a.*, u.name user_name FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200').all();
  res.json({ items: rows, chain: verifyChain() });
});
r.get('/audit/verify', auth('admin'), (req, res) => res.json(verifyChain()));

// ---- IoT ingestion (devices POST sensor data here) -------------------------
r.post('/iot/telemetry', (req, res) => {
  if (req.get('x-api-key') !== (process.env.IOT_API_KEY || 'dev-iot-key')) return res.status(401).json({ error: 'Invalid API key.' });
  const { machine_code, temperature, vibration } = req.body || {};
  const m = db.prepare('SELECT * FROM machines WHERE code=?').get(machine_code);
  if (!m || !isFinite(temperature) || !isFinite(vibration)) return res.status(400).json({ error: 'Send machine_code, temperature and vibration.' });
  db.prepare('INSERT INTO telemetry (machine_id,ts,temperature,vibration) VALUES (?,?,?,?)').run(m.id, new Date().toISOString(), temperature, vibration);
  const h = computeHealth(m);
  if (h.risk >= 85) notifyAdmins(`${m.code} risk score hit ${h.risk} - schedule preventive maintenance`, `#/app/machines/${m.id}`);
  broadcast('refresh', { entity: 'telemetry', id: m.id });
  res.json({ ok: true, risk: h.risk });
});

// ---- Server-sent events ----------------------------------------------------
r.get('/events', auth(), (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('event: hello\ndata: {}\n\n');
  addClient(res, req.user);
});

// ---- QR for machine passport ----------------------------------------------
r.get('/machines/:id/qr', auth(), async (req, res) => {
  const m = db.prepare('SELECT code FROM machines WHERE id=?').get(req.params.id);
  if (!m) return res.status(404).end();
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const svg = await QRCode.toString(`${base}/#/passport/${m.code}`, { type: 'svg', margin: 1, color: { dark: '#FFD60A', light: '#000000' } });
  res.type('image/svg+xml').send(svg);
});

module.exports = r;
