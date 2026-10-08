// Machines, technicians, spare parts.
const express = require('express');
const { db } = require('../db');
const { auth } = require('../auth');
const { audit } = require('../services/audit');
const { computeHealth } = require('../services/health');
const W = require('../services/workflow');
const { broadcast } = require('../services/events');

const r = express.Router();
const machineScope = u => u.role === 'customer' ? { sql: 'WHERE m.site_id=?', p: [u.site_id] } : { sql: '', p: [] };

r.get('/machines', auth(), (req, res) => {
  const sc = machineScope(req.user);
  const rows = db.prepare(`SELECT m.*, s.name site_name FROM machines m JOIN sites s ON s.id=m.site_id ${sc.sql} ORDER BY m.code`).all(...sc.p);
  res.json(rows.map(m => { const h = computeHealth(m); return { ...m, risk: h.risk, level: h.level, temperature: h.temperature, vibration: h.vibration, series: h.series.vibration.slice(-16),
    open_requests: db.prepare("SELECT COUNT(*) c FROM requests WHERE machine_id=? AND status NOT IN ('completed','rejected')").get(m.id).c }; }));
});
r.get('/machines/:id', auth(), (req, res) => {
  const m = db.prepare('SELECT m.*, s.name site_name FROM machines m JOIN sites s ON s.id=m.site_id WHERE m.id=?').get(req.params.id);
  if (!m || (req.user.role === 'customer' && m.site_id !== req.user.site_id)) return res.status(404).json({ error: 'Machine not found.' });
  const history = db.prepare(`SELECT r.id,r.code,r.title,r.priority,r.status,r.kind,r.created_at,r.completed_at,u.name technician_name FROM requests r
    LEFT JOIN technicians t ON t.id=r.technician_id LEFT JOIN users u ON u.id=t.user_id WHERE r.machine_id=? ORDER BY r.id DESC LIMIT 20`).all(m.id);
  res.json({ ...m, health: computeHealth(m), history });
});
r.post('/machines', auth('admin'), (req, res) => {
  const b = req.body || {};
  if (!b.code || !b.name || !W.MACHINE_TYPES[b.type] || !db.prepare('SELECT id FROM sites WHERE id=?').get(b.site_id)) return res.status(400).json({ error: 'Enter a code, name, valid type and site.' });
  if (db.prepare('SELECT id FROM machines WHERE code=?').get(b.code)) return res.status(409).json({ error: 'That machine code already exists.' });
  const id = db.prepare('INSERT INTO machines (code,name,type,site_id,hourly_loss,dependents,install_date,last_service) VALUES (?,?,?,?,?,?,?,?)')
    .run(b.code.trim(), b.name.trim(), b.type, b.site_id, +b.hourly_loss || 20000, +b.dependents || 0, W.now().slice(0, 10), W.now().slice(0, 10)).lastInsertRowid;
  audit(req.user.id, 'machine.create', 'machine', id, b.code);
  broadcast('refresh', { entity: 'machine' });
  res.json({ id });
});

// ---- Technicians -----------------------------------------------------------
function techRow(t) {
  return { id: t.id, user_id: t.user_id, name: t.name, email: t.email, skills: W.J(t.skills), status: t.status, max_load: t.max_load, experience_years: t.experience_years,
    rating: t.rating, base_label: t.base_label, lat: t.lat, lng: t.lng, active_jobs: W.activeLoad(t.id),
    jobs: db.prepare("SELECT id,code,title,status,priority FROM requests WHERE technician_id=? AND status IN ('assigned','in_progress','awaiting_verification')").all(t.id) };
}
r.get('/technicians', auth('admin', 'technician'), (req, res) => {
  res.json(db.prepare('SELECT t.*, u.name, u.email FROM technicians t JOIN users u ON u.id=t.user_id ORDER BY u.name').all().map(techRow));
});
r.patch('/technicians/:id/status', auth('admin', 'technician'), (req, res) => {
  const id = req.params.id === 'me' ? req.user.tech?.id : +req.params.id;
  const t = db.prepare('SELECT * FROM technicians WHERE id=?').get(id);
  if (!t) return res.status(404).json({ error: 'Technician not found.' });
  if (req.user.role === 'technician' && t.id !== req.user.tech.id) return res.status(403).json({ error: 'You can only change your own status.' });
  const status = req.body?.status === 'off' ? 'off' : (W.activeLoad(id) > 0 ? 'busy' : 'available');
  db.prepare('UPDATE technicians SET status=? WHERE id=?').run(status, id);
  audit(req.user.id, 'technician.status', 'technician', id, status);
  broadcast('refresh', { entity: 'technician' });
  res.json({ status });
});
r.patch('/technicians/me/location', auth('technician'), (req, res) => {
  const { lat, lng } = req.body || {};
  if (!isFinite(lat) || !isFinite(lng)) return res.status(400).json({ error: 'Send lat and lng.' });
  db.prepare('UPDATE technicians SET lat=?, lng=? WHERE id=?').run(lat, lng, req.user.tech.id);
  broadcast('refresh', { entity: 'technician' });
  res.json({ ok: true });
});

// ---- Spare parts -----------------------------------------------------------
r.get('/parts', auth(), (req, res) => {
  const rows = db.prepare('SELECT * FROM parts ORDER BY name').all().map(p => ({ ...p, compatible_types: W.J(p.compatible_types), available: p.stock - p.reserved }));
  res.json(rows);
});
r.post('/parts/:id/restock', auth('admin'), (req, res) => {
  const qty = Math.floor(+req.body?.qty);
  const p = db.prepare('SELECT * FROM parts WHERE id=?').get(req.params.id);
  if (!p || !(qty > 0)) return res.status(400).json({ error: 'Enter a quantity greater than zero.' });
  db.prepare('UPDATE parts SET stock = stock + ? WHERE id=?').run(qty, p.id);
  audit(req.user.id, 'part.restock', 'part', p.id, `+${qty} ${p.name}`);
  // Auto-heal: requests blocked on missing parts get their reservation retried immediately.
  const healed = [];
  db.prepare("SELECT DISTINCT request_id FROM exceptions WHERE type='part_unavailable' AND status='open'").all().forEach(e => {
    const out = W.syncPartReservation(e.request_id);
    if (out.allReserved) healed.push(W.getRequest(e.request_id).code);
  });
  broadcast('refresh', { entity: 'part' });
  res.json({ ok: true, auto_resolved: healed });
});
r.post('/parts', auth('admin'), (req, res) => {
  const b = req.body || {};
  if (!b.sku || !b.name) return res.status(400).json({ error: 'Enter a SKU and name.' });
  if (db.prepare('SELECT id FROM parts WHERE sku=?').get(b.sku)) return res.status(409).json({ error: 'That SKU already exists.' });
  const id = db.prepare('INSERT INTO parts (sku,name,stock,lead_time_hours,unit_cost,compatible_types) VALUES (?,?,?,?,?,?)')
    .run(b.sku, b.name, +b.stock || 0, +b.lead_time_hours || 24, +b.unit_cost || 0, JSON.stringify(b.compatible_types?.length ? b.compatible_types : ['*'])).lastInsertRowid;
  audit(req.user.id, 'part.create', 'part', id, b.sku);
  res.json({ id });
});

module.exports = r;
