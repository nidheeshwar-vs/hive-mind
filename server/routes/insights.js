// Dashboard, AI endpoints, map.
const express = require('express');
const { db } = require('../db');
const { auth } = require('../auth');
const { audit } = require('../services/audit');
const W = require('../services/workflow');
const { rankTechnicians } = require('../services/matching');
const { allHealth, computeHealth } = require('../services/health');
const { allActivePredictions, predictDelay } = require('../services/sla');
const { simulateImpact } = require('../services/impact');
const { notifyAdmins } = require('../services/events');

const r = express.Router();

function scope(u) {
  if (u.role === 'customer') return { sql: 'r.site_id=?', p: [u.site_id], site: u.site_id };
  if (u.role === 'technician') return { sql: 'r.technician_id=?', p: [u.tech.id] };
  return { sql: '1=1', p: [] };
}
function conflicts() {
  const out = [];
  db.prepare('SELECT t.id,t.max_load,u.name FROM technicians t JOIN users u ON u.id=t.user_id').all().forEach(t => {
    const load = W.activeLoad(t.id);
    if (load > t.max_load) out.push({ type: 'overload', text: `${t.name} has ${load} active jobs (limit ${t.max_load})` });
    const sites = db.prepare("SELECT DISTINCT site_id FROM requests WHERE technician_id=? AND status IN ('assigned','in_progress')").all(t.id);
    if (sites.length > 1) out.push({ type: 'travel', text: `${t.name} is booked at ${sites.length} different sites at once` });
  });
  db.prepare("SELECT m.code, COUNT(*) c FROM requests r JOIN machines m ON m.id=r.machine_id WHERE r.status NOT IN ('completed','rejected') GROUP BY r.machine_id HAVING c>1").all()
    .forEach(x => out.push({ type: 'duplicate', text: `${x.code} has ${x.c} open requests - possible duplicate work` }));
  db.prepare('SELECT * FROM parts').all().forEach(p => {
    const need = db.prepare("SELECT r.required_parts FROM requests r WHERE r.status IN ('pending_approval','approved')").all()
      .reduce((a, x) => a + W.J(x.required_parts).filter(i => i.part_id === p.id).reduce((s, i) => s + i.qty, 0), 0);
    if (need > p.stock - p.reserved) out.push({ type: 'parts', text: `${p.name}: pending demand ${need}, only ${p.stock - p.reserved} free` });
  });
  return out;
}

r.get('/dashboard', auth(), (req, res) => {
  const sc = scope(req.user);
  const count = (extra = '', p = []) => db.prepare(`SELECT COUNT(*) c FROM requests r WHERE ${sc.sql} ${extra}`).get(...sc.p, ...p).c;
  const act = `AND r.status IN (${W.ACTIVE.map(s => `'${s}'`).join(',')})`;
  const preds = allActivePredictions().filter(x => req.user.role === 'admin' || (sc.site ? x.request.site_id === sc.site : x.request.technician_id === req.user.tech?.id));
  const done = db.prepare(`SELECT created_at, completed_at, sla_due FROM requests r WHERE ${sc.sql} AND status='completed' AND completed_at IS NOT NULL`).all(...sc.p);
  const avg = done.length ? done.reduce((a, d) => a + (new Date(d.completed_at) - new Date(d.created_at)) / 36e5, 0) / done.length : 0;
  const onTime = done.length ? Math.round(100 * done.filter(d => d.completed_at <= d.sla_due).length / done.length) : 100;
  const health = allHealth().filter(h => !sc.site || db.prepare('SELECT site_id FROM machines WHERE id=?').get(h.machine_id).site_id === sc.site);
  const byStatus = {}; db.prepare(`SELECT status, COUNT(*) c FROM requests r WHERE ${sc.sql} GROUP BY status`).all(...sc.p).forEach(x => byStatus[x.status] = x.c);
  const byPriority = {}; db.prepare(`SELECT priority, COUNT(*) c FROM requests r WHERE ${sc.sql} ${act} GROUP BY priority`).all(...sc.p).forEach(x => byPriority[x.priority] = x.c);
  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const d0 = new Date(Date.now() - i * 864e5); d0.setHours(0, 0, 0, 0); const d1 = new Date(d0.getTime() + 864e5);
    const f = col => db.prepare(`SELECT COUNT(*) c FROM requests r WHERE ${sc.sql} AND ${col} >= ? AND ${col} < ?`).get(...sc.p, d0.toISOString(), d1.toISOString()).c;
    trend.push({ day: d0.toLocaleDateString('en-IN', { weekday: 'short' }), created: f('created_at'), completed: f('completed_at') });
  }
  const exceptions = db.prepare(`SELECT e.*, r.code, r.title FROM exceptions e JOIN requests r ON r.id=e.request_id WHERE e.status='open' AND ${sc.sql} ORDER BY e.id DESC LIMIT 8`).all(...sc.p);
  const techs = db.prepare('SELECT status, COUNT(*) c FROM technicians GROUP BY status').all();
  const mySkills = req.user.tech ? W.J(req.user.tech.skills) : null;
  res.json({
    role: req.user.role,
    kpis: {
      open: count(act), critical: count(act + " AND r.priority='critical'"), pending_approval: count("AND r.status='pending_approval'"),
      at_risk: preds.filter(x => x.sla && x.sla.probability >= 0.5).length, breached: preds.filter(x => x.sla?.breached).length,
      open_exceptions: exceptions.length, completed: done.length, avg_resolution_hours: Math.round(avg * 10) / 10, sla_compliance: onTime,
      machines_critical: health.filter(h => h.level === 'critical').length, techs_available: techs.find(t => t.status === 'available')?.c || 0,
      techs_total: techs.reduce((a, t) => a + t.c, 0), awaiting_verification: count("AND r.status='awaiting_verification'")
    },
    by_status: byStatus, by_priority: byPriority, trend, exceptions,
    at_risk: preds.filter(x => x.sla).sort((a, b) => b.sla.probability - a.sla.probability).slice(0, 5)
      .map(x => ({ id: x.request.id, code: x.request.code, title: x.request.title, priority: x.request.priority, status: x.request.status, sla: x.sla })),
    health: health.slice(0, 5), conflicts: req.user.role === 'admin' ? conflicts() : [],
    my: req.user.tech ? { id: req.user.tech.id, status: req.user.tech.status, skills: mySkills } : null
  });
});

r.get('/ai/match/:id', auth('admin'), (req, res) => {
  const q = W.getRequest(req.params.id);
  if (!q) return res.status(404).json({ error: 'Request not found.' });
  res.json({ weights: require('../services/matching').WEIGHTS, candidates: rankTechnicians(q) });
});
r.get('/ai/health', auth(), (req, res) => {
  let list = allHealth();
  if (req.user.role === 'customer') list = list.filter(h => db.prepare('SELECT site_id FROM machines WHERE id=?').get(h.machine_id).site_id === req.user.site_id);
  res.json(list);
});
r.get('/ai/sla', auth(), (req, res) => {
  res.json(allActivePredictions().filter(x => req.user.role === 'admin' || (req.user.role === 'customer' ? x.request.site_id === req.user.site_id : x.request.technician_id === req.user.tech?.id))
    .map(x => ({ id: x.request.id, code: x.request.code, title: x.request.title, priority: x.request.priority, status: x.request.status, sla_due: x.request.sla_due, sla: x.sla })));
});
r.get('/ai/impact/:id', auth(), (req, res) => {
  const q = W.getRequest(req.params.id);
  if (!q || (req.user.role === 'customer' && q.site_id !== req.user.site_id)) return res.status(404).json({ error: 'Request not found.' });
  res.json(simulateImpact(q, Math.max(0, Math.min(168, +req.query.hours || 8))));
});
r.get('/ai/impact', auth(), (req, res) => { // portfolio view for the Impact Lab
  const rows = db.prepare(`SELECT * FROM requests WHERE status IN (${W.ACTIVE.map(s => `'${s}'`).join(',')})`).all().map(W.hydrate)
    .filter(q => req.user.role === 'admin' || (req.user.role === 'customer' && q.site_id === req.user.site_id));
  res.json(rows.map(q => ({ id: q.id, code: q.code, title: q.title, priority: q.priority, impact: simulateImpact(q, 8) })));
});
r.get('/ai/suggest-parts', auth(), (req, res) => {
  const m = db.prepare('SELECT type FROM machines WHERE id=?').get(req.query.machine_id);
  if (!m) return res.json([]);
  const rows = db.prepare('SELECT * FROM parts').all().filter(p => { const t = W.J(p.compatible_types); return t.includes('*') || t.includes(m.type); });
  const used = pid => db.prepare('SELECT COALESCE(SUM(qty),0) n FROM reservations WHERE part_id=?').get(pid).n;
  res.json(rows.map(p => ({ ...p, available: p.stock - p.reserved, popularity: used(p.id) })).sort((a, b) => b.popularity - a.popularity));
});
r.post('/ai/preventive/:machineId', auth('admin'), (req, res) => {
  const m = db.prepare('SELECT * FROM machines WHERE id=?').get(req.params.machineId);
  if (!m) return res.status(404).json({ error: 'Machine not found.' });
  const open = db.prepare("SELECT code FROM requests WHERE machine_id=? AND status NOT IN ('completed','rejected')").get(m.id);
  if (open) return res.status(409).json({ error: `${m.code} already has an open request (${open.code}).` });
  const h = computeHealth(m), now = W.now(), pr = h.risk >= 70 ? 'high' : 'medium';
  const id = db.prepare(`INSERT INTO requests (code,machine_id,site_id,title,description,priority,kind,status,required_skills,required_parts,created_by,approved_by,sla_due,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'preventive','approved',?,'[]',?,?,?,?,?)`)
    .run(W.nextCode(), m.id, m.site_id, `Preventive service: ${h.drivers.join(' + ')} trending high`, `Predictive model risk ${h.risk}/100. ${h.recommendation}.`, pr,
      JSON.stringify(W.MACHINE_TYPES[m.type] || []), req.user.id, req.user.id, new Date(Date.now() + W.SLA_HOURS[pr] * 36e5).toISOString(), now, now).lastInsertRowid;
  W.logEvent(id, req.user.id, 'status', `Created from predictive health model (risk ${h.risk}) and auto-approved`);
  audit(req.user.id, 'request.preventive', 'machine', m.code, `risk ${h.risk}`);
  W.refresh('request', id);
  res.json({ id });
});

r.get('/map', auth(), (req, res) => {
  const sites = db.prepare('SELECT * FROM sites').all().filter(s => req.user.role !== 'customer' || s.id === req.user.site_id).map(s => {
    const ms = db.prepare('SELECT * FROM machines WHERE site_id=?').all(s.id).map(computeHealth);
    return { ...s, machines: ms.length, critical_machines: ms.filter(h => h.level === 'critical').length,
      active_requests: db.prepare("SELECT COUNT(*) c FROM requests WHERE site_id=? AND status NOT IN ('completed','rejected')").get(s.id).c };
  });
  const technicians = req.user.role === 'customer' ? [] :
    db.prepare('SELECT t.id,t.lat,t.lng,t.status,u.name FROM technicians t JOIN users u ON u.id=t.user_id').all();
  res.json({ sites, technicians });
});

module.exports = r;
