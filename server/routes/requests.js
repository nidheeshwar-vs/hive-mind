// Service request lifecycle: create -> approve -> assign -> start -> submit -> verify (+ exceptions).
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db, DATA_DIR } = require('../db');
const { auth } = require('../auth');
const { audit } = require('../services/audit');
const { notify, notifyAdmins } = require('../services/events');
const W = require('../services/workflow');
const { rankTechnicians } = require('../services/matching');
const { predictDelay } = require('../services/sla');
const { simulateImpact } = require('../services/impact');
const { computeHealth } = require('../services/health');

const r = express.Router();
const uploadDir = path.join(DATA_DIR, 'uploads');
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, f, cb) => cb(null, crypto.randomBytes(12).toString('hex') + path.extname(f.originalname).toLowerCase().slice(0, 6))
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, f, cb) => cb(f.mimetype.startsWith('image/') || f.mimetype === 'application/pdf' ? null : new Error('Only images or PDF files are allowed.'), true)
});

const BASE = `SELECT r.*, m.code machine_code, m.name machine_name, m.type machine_type, s.name site_name, u.name technician_name,
  (SELECT COUNT(*) FROM exceptions e WHERE e.request_id=r.id AND e.status='open') open_exceptions
  FROM requests r JOIN machines m ON m.id=r.machine_id JOIN sites s ON s.id=r.site_id
  LEFT JOIN technicians t ON t.id=r.technician_id LEFT JOIN users u ON u.id=t.user_id`;

const canSee = (u, req) => u.role === 'admin' || (u.role === 'customer' && req.site_id === u.site_id) || (u.role === 'technician' && req.technician_id === u.tech?.id);
const decorate = row => { const q = W.hydrate(row); return { ...q, sla: W.ACTIVE.includes(q.status) ? predictDelay(q) : null }; };
const fail = (res, code, error, extra) => res.status(code).json({ error, ...extra });

function load(req, res) {
  const row = db.prepare(BASE + ' WHERE r.id=?').get(req.params.id);
  if (!row || !canSee(req.user, row)) { fail(res, 404, 'Request not found.'); return null; }
  return row;
}
const changed = (id, msg) => { W.touch(id); W.refresh('request', id); };

// ---- List ------------------------------------------------------------------
r.get('/requests', auth(), (req, res) => {
  const where = [], p = [];
  if (req.user.role === 'customer') { where.push('r.site_id=?'); p.push(req.user.site_id); }
  if (req.user.role === 'technician') { where.push('r.technician_id=?'); p.push(req.user.tech.id); }
  const { status, priority, machine_id, q, active } = req.query;
  if (status) { where.push('r.status=?'); p.push(status); }
  if (active === '1') where.push(`r.status IN (${W.ACTIVE.map(s => `'${s}'`).join(',')})`);
  if (priority) { where.push('r.priority=?'); p.push(priority); }
  if (machine_id) { where.push('r.machine_id=?'); p.push(machine_id); }
  if (q) { where.push('(r.title LIKE ? OR r.code LIKE ? OR m.code LIKE ?)'); p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const rows = db.prepare(`${BASE} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.id DESC LIMIT 300`).all(...p);
  res.json(rows.map(decorate));
});

// ---- Preflight validation (runs live in the "new request" form) -------------
function preflight(body, user) {
  const checks = [];
  const add = (key, label, status, detail) => checks.push({ key, label, status, detail });
  const m = db.prepare('SELECT m.*, s.name site_name FROM machines m JOIN sites s ON s.id=m.site_id WHERE m.id=?').get(body.machine_id);
  if (!m) { add('machine', 'Machine eligibility', 'fail', 'Choose a machine.'); return { ok: false, checks }; }
  if (user.role === 'customer' && m.site_id !== user.site_id) add('machine', 'Machine eligibility', 'fail', 'This machine is not at your site.');
  else if (m.status === 'decommissioned') add('machine', 'Machine eligibility', 'fail', 'This machine is decommissioned.');
  else add('machine', 'Machine eligibility', 'pass', `${m.code} - ${m.name} is registered at ${m.site_name}.`);

  const priority = body.priority;
  if (!W.PRIORITIES.includes(priority)) add('priority', 'Priority', 'fail', 'Choose a priority.');
  else add('priority', 'Priority', 'pass', `SLA target is ${W.SLA_HOURS[priority]} hours.`);

  add('site', 'Site location', 'pass', `Work will be routed to ${m.site_name}.`);

  const skills = (body.required_skills && body.required_skills.length) ? body.required_skills : (W.MACHINE_TYPES[m.type] || []);
  const probe = { site_id: m.site_id, required_skills: skills };
  const ranked = rankTechnicians(probe);
  const ready = ranked.filter(t => t.eligible);
  if (ready.length) add('skills', 'Required skills', 'pass', `${ready.length} qualified technician(s) available. Best match: ${ready[0].name} (${ready[0].distance_km} km away).`);
  else if (ranked.some(t => !t.missing_skills.length)) add('skills', 'Required skills', 'warn', 'Qualified technicians exist but all are busy or off duty. The request will queue.');
  else add('skills', 'Required skills', 'fail', 'No technician has this combination of skills. Remove a skill or contact operations.');

  const items = (body.required_parts || []).filter(i => i.part_id && i.qty > 0);
  if (!items.length) add('parts', 'Spare parts', 'pass', 'No parts required.');
  else {
    const rep = W.partsReport(items), bad = rep.filter(x => !x.ok);
    if (!bad.length) add('parts', 'Spare parts', 'pass', 'All required parts are in stock and can be reserved on approval.');
    else add('parts', 'Spare parts', 'warn', `Short on ${bad.map(b => `${b.name} (need ${b.qty}, have ${Math.max(0, b.available)})`).join('; ')}. Restock ETA ~${Math.max(...bad.map(b => b.lead_time_hours))}h.`);
  }
  const dup = db.prepare("SELECT code,title FROM requests WHERE machine_id=? AND status NOT IN ('completed','rejected')").all(m.id);
  if (dup.length) add('duplicate', 'Duplicate work check', 'warn', `This machine already has open work: ${dup.map(d => d.code).join(', ')}. Check it is not the same issue.`);
  else add('duplicate', 'Duplicate work check', 'pass', 'No open requests on this machine.');

  return { ok: !checks.some(c => c.status === 'fail'), checks, machine: m, skills, ranked: ranked.slice(0, 3) };
}
r.post('/requests/preflight', auth('admin', 'customer'), (req, res) => {
  const out = preflight(req.body || {}, req.user);
  res.json({ ok: out.ok, checks: out.checks, default_skills: out.skills || [], top_matches: out.ranked || [] });
});

// ---- Create ----------------------------------------------------------------
r.post('/requests', auth('admin', 'customer'), (req, res) => {
  const b = req.body || {};
  const pf = preflight(b, req.user);
  if (!b.title || b.title.trim().length < 4) return fail(res, 400, 'Describe the problem in a short title.', { checks: pf.checks });
  if (!pf.ok) return fail(res, 400, 'Fix the failed checks before submitting.', { checks: pf.checks });
  const m = pf.machine, now = W.now();
  const due = new Date(Date.now() + W.SLA_HOURS[b.priority] * 36e5).toISOString();
  const parts = (b.required_parts || []).filter(i => i.part_id && i.qty > 0).map(i => ({ part_id: +i.part_id, qty: Math.floor(i.qty) }));
  const id = db.prepare(`INSERT INTO requests (code,machine_id,site_id,title,description,priority,kind,required_skills,required_parts,created_by,sla_due,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(W.nextCode(), m.id, m.site_id, b.title.trim(), (b.description || '').trim(), b.priority, 'corrective',
      JSON.stringify(pf.skills), JSON.stringify(parts), req.user.id, due, now, now).lastInsertRowid;
  const q = W.getRequest(id);
  W.logEvent(id, req.user.id, 'status', 'Request created');
  audit(req.user.id, 'request.create', 'request', q.code, `${m.code} ${b.priority}: ${q.title}`);
  notifyAdmins(`New ${b.priority} request ${q.code} on ${m.code} awaiting approval`, `#/app/requests/${id}`);
  W.refresh('request', id);
  res.json({ id, code: q.code });
});

// ---- Detail ----------------------------------------------------------------
r.get('/requests/:id', auth(), (req, res) => {
  const row = load(req, res); if (!row) return;
  const q = decorate(row);
  const logs = db.prepare('SELECT l.*, u.name user_name FROM task_logs l LEFT JOIN users u ON u.id=l.user_id WHERE l.request_id=? ORDER BY l.id').all(q.id);
  const exceptions = db.prepare('SELECT * FROM exceptions WHERE request_id=? ORDER BY id DESC').all(q.id).map(e => ({ ...e, meta: W.J(e.meta, {}) }));
  const attachments = db.prepare('SELECT id,filename,original_name,mime,ts FROM attachments WHERE request_id=?').all(q.id);
  const reserved = new Set(W.reservedFor(q.id).map(x => x.part_id));
  const parts = W.partsReport(q.required_parts).map(p => ({ ...p, reserved: reserved.has(p.part_id) }));
  const machine = db.prepare('SELECT * FROM machines WHERE id=?').get(q.machine_id);
  const dropped = exceptions.filter(e => e.type === 'tech_dropout').map(e => e.meta.technician_id);
  const showCandidates = req.user.role === 'admin' && ['pending_approval', 'approved', 'assigned'].includes(q.status);
  res.json({
    request: q, logs, exceptions, attachments, parts,
    impact: simulateImpact(q, Math.max(4, Math.ceil(q.sla?.remaining_hours || 4))),
    health: computeHealth(machine),
    candidates: showCandidates ? rankTechnicians(q, { excludeIds: dropped }).slice(0, 5) : []
  });
});

// ---- Approve / reject ------------------------------------------------------
r.post('/requests/:id/approve', auth('admin'), (req, res) => {
  const row = load(req, res); if (!row) return;
  if (row.status !== 'pending_approval') return fail(res, 409, 'Only requests waiting for approval can be approved.');
  db.prepare("UPDATE requests SET status='approved', approved_by=? WHERE id=?").run(req.user.id, row.id);
  W.logEvent(row.id, req.user.id, 'status', 'Approved by ' + req.user.name);
  const parts = W.syncPartReservation(row.id);
  audit(req.user.id, 'request.approve', 'request', row.code, parts.allReserved ? 'parts reserved' : 'parts missing');
  notify(row.created_by, `${row.code} was approved`, `#/app/requests/${row.id}`);
  changed(row.id);
  res.json({ ok: true, parts_reserved: parts.allReserved, missing: parts.missing, candidates: rankTechnicians(W.getRequest(row.id)).filter(c => c.eligible).slice(0, 3) });
});
r.post('/requests/:id/reject', auth('admin'), (req, res) => {
  const row = load(req, res); if (!row) return;
  if (!['pending_approval', 'approved'].includes(row.status)) return fail(res, 409, 'This request can no longer be rejected.');
  const reason = (req.body?.reason || 'No reason given').slice(0, 300);
  db.prepare("UPDATE requests SET status='rejected' WHERE id=?").run(row.id);
  W.releaseParts(row.id); W.resolveExceptions(row.id, null, 'Closed - request rejected');
  W.logEvent(row.id, req.user.id, 'status', `Rejected: ${reason}`);
  audit(req.user.id, 'request.reject', 'request', row.code, reason);
  notify(row.created_by, `${row.code} was rejected: ${reason}`, `#/app/requests/${row.id}`);
  changed(row.id); res.json({ ok: true });
});

// ---- Assign / auto-assign (also used for instant reassignment) ---------------
function assign(row, techId, user, force) {
  const q = W.hydrate(row);
  const t = db.prepare('SELECT t.*, u.name FROM technicians t JOIN users u ON u.id=t.user_id WHERE t.id=?').get(techId);
  if (!t) return { code: 404, error: 'Technician not found.' };
  const cand = rankTechnicians(q).find(c => c.technician_id === techId);
  if (cand.status === 'off') return { code: 409, error: `${t.name} is off duty.`, blockers: cand.blockers };
  if (cand.blockers.length && !force) return { code: 409, conflict: true, error: `Conflict: ${cand.blockers.join('; ')}.`, blockers: cand.blockers };
  const old = q.technician_id;
  db.prepare("UPDATE requests SET technician_id=?, status='assigned', started_at=NULL WHERE id=?").run(techId, q.id);
  W.syncTechStatus(techId); W.syncTechStatus(old);
  W.resolveExceptions(q.id, 'tech_dropout', `${t.name} took over the job`);
  W.logEvent(q.id, user.id, 'status', `Assigned to ${t.name}${cand.blockers.length ? ' (override: ' + cand.blockers.join('; ') + ')' : ''} - match score ${cand.score}`);
  W.syncPartReservation(q.id);
  audit(user.id, 'request.assign', 'request', q.code, `${t.name} score=${cand.score}${force ? ' forced' : ''}`);
  notify(t.user_id, `New job ${q.code}: ${q.title}`, `#/app/requests/${q.id}`);
  notify(q.created_by, `${t.name} is assigned to ${q.code} (ETA ~${cand.eta_minutes} min)`, `#/app/requests/${q.id}`);
  changed(q.id);
  return { ok: true, technician: t.name, score: cand.score, eta_minutes: cand.eta_minutes };
}
r.post('/requests/:id/assign', auth('admin'), (req, res) => {
  const row = load(req, res); if (!row) return;
  if (!['approved', 'assigned'].includes(row.status)) return fail(res, 409, 'Approve the request before assigning a technician.');
  const out = assign(row, +req.body?.technician_id, req.user, !!req.body?.force);
  if (out.error) return res.status(out.code).json(out);
  res.json(out);
});
r.post('/requests/:id/auto-assign', auth('admin'), (req, res) => {
  const row = load(req, res); if (!row) return;
  if (!['approved', 'assigned'].includes(row.status)) return fail(res, 409, 'Approve the request before assigning a technician.');
  const dropped = db.prepare("SELECT meta FROM exceptions WHERE request_id=? AND type='tech_dropout'").all(row.id).map(e => W.J(e.meta, {}).technician_id);
  const best = rankTechnicians(W.hydrate(row), { excludeIds: dropped }).find(c => c.eligible);
  if (!best) return fail(res, 409, 'No eligible technician is free right now. Check the ranking and assign manually.');
  const out = assign(row, best.technician_id, req.user, false);
  if (out.error) return res.status(out.code).json(out);
  res.json(out);
});

// ---- Technician actions ----------------------------------------------------
const mine = (u, row) => u.role === 'admin' || row.technician_id === u.tech?.id;
r.post('/requests/:id/start', auth('admin', 'technician'), (req, res) => {
  const row = load(req, res); if (!row) return;
  if (!mine(req.user, row)) return fail(res, 403, 'This job is not assigned to you.');
  if (row.status !== 'assigned') return fail(res, 409, 'Only assigned jobs can be started.');
  const p = W.syncPartReservation(row.id);
  if (!p.allReserved) return fail(res, 409, `Parts are not reserved yet: ${p.missing.map(m => m.name).join(', ')}.`);
  db.prepare("UPDATE requests SET status='in_progress', started_at=? WHERE id=?").run(W.now(), row.id);
  db.prepare("UPDATE machines SET status='maintenance' WHERE id=?").run(row.machine_id);
  W.syncTechStatus(row.technician_id);
  W.logEvent(row.id, req.user.id, 'status', 'Work started on site');
  audit(req.user.id, 'request.start', 'request', row.code, '');
  notify(row.created_by, `Work has started on ${row.code}`, `#/app/requests/${row.id}`);
  changed(row.id); res.json({ ok: true });
});
r.post('/requests/:id/log', auth(), (req, res) => {
  const row = load(req, res); if (!row) return;
  const msg = String(req.body?.message || '').trim().slice(0, 500);
  if (!msg) return fail(res, 400, 'Write a note first.');
  W.logEvent(row.id, req.user.id, 'note', msg);
  audit(req.user.id, 'request.log', 'request', row.code, msg.slice(0, 80));
  changed(row.id); res.json({ ok: true });
});
r.post('/requests/:id/attachments', auth('admin', 'technician'), (req, res) => {
  const row = load(req, res); if (!row) return;
  if (!mine(req.user, row)) return fail(res, 403, 'This job is not assigned to you.');
  upload.single('file')(req, res, err => {
    if (err) return fail(res, 400, err.message);
    if (!req.file) return fail(res, 400, 'Choose a file to upload.');
    db.prepare('INSERT INTO attachments (request_id,filename,original_name,mime,uploaded_by,ts) VALUES (?,?,?,?,?,?)')
      .run(row.id, req.file.filename, req.file.originalname, req.file.mimetype, req.user.id, W.now());
    W.logEvent(row.id, req.user.id, 'note', `Uploaded evidence: ${req.file.originalname}`);
    audit(req.user.id, 'request.attachment', 'request', row.code, req.file.originalname);
    changed(row.id); res.json({ ok: true });
  });
});
r.get('/files/:filename', auth(), (req, res) => {
  const a = db.prepare('SELECT a.*, r.site_id, r.technician_id FROM attachments a JOIN requests r ON r.id=a.request_id WHERE a.filename=?').get(path.basename(req.params.filename));
  if (!a || !canSee(req.user, a)) return res.status(404).end();
  res.type(a.mime).sendFile(path.join(uploadDir, a.filename));
});
r.post('/requests/:id/submit', auth('admin', 'technician'), (req, res) => {
  const row = load(req, res); if (!row) return;
  if (!mine(req.user, row)) return fail(res, 403, 'This job is not assigned to you.');
  if (row.status !== 'in_progress') return fail(res, 409, 'Start the job before submitting it for verification.');
  const notes = String(req.body?.notes || '').trim();
  if (notes.length < 5) return fail(res, 400, 'Describe what you did in the completion report.');
  if (!db.prepare('SELECT 1 FROM attachments WHERE request_id=?').get(row.id)) return fail(res, 400, 'Upload at least one photo or document as proof of work.');
  const checklist = Array.isArray(req.body?.checklist) ? req.body.checklist.slice(0, 12) : [];
  db.prepare("UPDATE requests SET status='awaiting_verification', completion_notes=?, checklist=?, submitted_at=? WHERE id=?").run(notes, JSON.stringify(checklist), W.now(), row.id);
  W.syncTechStatus(row.technician_id);
  W.logEvent(row.id, req.user.id, 'status', 'Completion report submitted for verification');
  audit(req.user.id, 'request.submit', 'request', row.code, notes.slice(0, 80));
  notify(row.created_by, `${row.code} is ready for your verification`, `#/app/requests/${row.id}`);
  notifyAdmins(`${row.code} submitted for verification`, `#/app/requests/${row.id}`);
  changed(row.id); res.json({ ok: true });
});

// ---- Verification (customer or admin) --------------------------------------
r.post('/requests/:id/verify', auth('admin', 'customer'), (req, res) => {
  const row = load(req, res); if (!row) return;
  if (row.status !== 'awaiting_verification') return fail(res, 409, 'There is nothing to verify on this request.');
  const t = row.technician_id && db.prepare('SELECT user_id FROM technicians WHERE id=?').get(row.technician_id);
  if (req.body?.approve === false) {
    const why = String(req.body?.comment || 'Not accepted').slice(0, 300);
    db.prepare("UPDATE requests SET status='in_progress' WHERE id=?").run(row.id);
    W.syncTechStatus(row.technician_id);
    W.logEvent(row.id, req.user.id, 'status', `Verification rejected: ${why}`);
    audit(req.user.id, 'request.verify.reject', 'request', row.code, why);
    if (t) notify(t.user_id, `${row.code} was sent back: ${why}`, `#/app/requests/${row.id}`);
    changed(row.id); return res.json({ ok: true, status: 'in_progress' });
  }
  db.prepare("UPDATE requests SET status='completed', completed_at=?, verified_by=? WHERE id=?").run(W.now(), req.user.id, row.id);
  W.consumeParts(row.id);
  const m = db.prepare('SELECT * FROM machines WHERE id=?').get(row.machine_id);
  db.prepare("UPDATE machines SET status='operational', last_service=?, last_service_runtime=runtime_hours, drift=0 WHERE id=?").run(W.now().slice(0, 10), m.id);
  W.resolveExceptions(row.id, null, 'Closed - work verified');
  W.syncTechStatus(row.technician_id);
  W.logEvent(row.id, req.user.id, 'status', `Verified and closed by ${req.user.name}`);
  audit(req.user.id, 'request.verify', 'request', row.code, 'completed');
  if (t) notify(t.user_id, `${row.code} verified. Great work.`, `#/app/requests/${row.id}`);
  changed(row.id); res.json({ ok: true, status: 'completed' });
});

// ---- Exceptions: technician dropout, resolve --------------------------------
r.post('/requests/:id/dropout', auth('admin', 'technician'), (req, res) => {
  const row = load(req, res); if (!row) return;
  if (!mine(req.user, row)) return fail(res, 403, 'This job is not assigned to you.');
  if (!['assigned', 'in_progress'].includes(row.status) || !row.technician_id) return fail(res, 409, 'Only assigned jobs can be dropped.');
  const reason = String(req.body?.reason || 'Technician unavailable').slice(0, 200);
  const tech = db.prepare('SELECT t.*, u.name FROM technicians t JOIN users u ON u.id=t.user_id WHERE t.id=?').get(row.technician_id);
  db.prepare("UPDATE requests SET technician_id=NULL, status='approved', started_at=NULL WHERE id=?").run(row.id);
  if (req.body?.off_duty) db.prepare("UPDATE technicians SET status='off' WHERE id=?").run(tech.id); else W.syncTechStatus(tech.id);
  W.raiseException(row.id, 'tech_dropout', `${tech.name} dropped out (${reason})`, { technician_id: tech.id, reason });
  audit(req.user.id, 'request.dropout', 'request', row.code, `${tech.name}: ${reason}`);
  const candidates = rankTechnicians(W.getRequest(row.id), { excludeIds: [tech.id] }).filter(c => c.eligible).slice(0, 3);
  if (candidates[0]) notifyAdmins(`${row.code}: ${candidates[0].name} can take over in ~${candidates[0].eta_minutes} min - one click to reassign`, `#/app/requests/${row.id}`);
  changed(row.id); res.json({ ok: true, candidates });
});
r.post('/requests/:id/exceptions/:eid/resolve', auth('admin'), (req, res) => {
  const row = load(req, res); if (!row) return;
  const e = db.prepare("SELECT * FROM exceptions WHERE id=? AND request_id=? AND status='open'").get(req.params.eid, row.id);
  if (!e) return fail(res, 404, 'Exception not found or already resolved.');
  db.prepare("UPDATE exceptions SET status='resolved', resolved_at=? WHERE id=?").run(W.now(), e.id);
  W.logEvent(row.id, req.user.id, 'system', `Exception manually resolved: ${e.type.replace('_', ' ')}`);
  audit(req.user.id, 'exception.resolve', 'request', row.code, e.type);
  changed(row.id); res.json({ ok: true });
});

module.exports = r;
