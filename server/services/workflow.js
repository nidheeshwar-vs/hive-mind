// Shared workflow helpers: constants, hydration, logs, exceptions, parts reservation.
const { db } = require('../db');
const { broadcast, notify, notifyAdmins } = require('./events');

const SKILLS = ['Electrical', 'Hydraulics', 'Pneumatics', 'Mechanical', 'PLC & Automation', 'Welding', 'HVAC', 'Instrumentation'];
const PRIORITIES = ['critical', 'high', 'medium', 'low'];
const SLA_HOURS = { critical: 4, high: 8, medium: 24, low: 72 };
const WORK_HOURS = { critical: 3, high: 3, medium: 4, low: 5 };
const MACHINE_TYPES = {
  'CNC Machining Center': ['Mechanical', 'PLC & Automation'],
  'Hydraulic Press': ['Hydraulics', 'Mechanical'],
  'Conveyor Line': ['Electrical', 'Mechanical'],
  'Air Compressor': ['Pneumatics', 'Electrical'],
  'Industrial Boiler': ['Instrumentation', 'Welding'],
  'Chiller Unit': ['HVAC', 'Electrical'],
  'Robotic Welder': ['Welding', 'PLC & Automation']
};
const ACTIVE = ['pending_approval', 'approved', 'assigned', 'in_progress', 'awaiting_verification'];

const now = () => new Date().toISOString();
const J = (s, d = []) => { try { return JSON.parse(s); } catch { return d; } };

function hydrate(r) {
  if (!r) return r;
  return { ...r, required_skills: J(r.required_skills), required_parts: J(r.required_parts), checklist: J(r.checklist, null) };
}
function getRequest(id) { return hydrate(db.prepare('SELECT * FROM requests WHERE id=?').get(id)); }

function logEvent(requestId, userId, type, message) {
  db.prepare('INSERT INTO task_logs (request_id,user_id,type,message,ts) VALUES (?,?,?,?,?)').run(requestId, userId ?? null, type, message, now());
}
function touch(id) { db.prepare('UPDATE requests SET updated_at=? WHERE id=?').run(now(), id); }
function refresh(entity, id) { broadcast('refresh', { entity, id }); }

function raiseException(requestId, type, detail, meta) {
  const open = db.prepare("SELECT id FROM exceptions WHERE request_id=? AND type=? AND status='open'").get(requestId, type);
  if (open) return null;
  const info = db.prepare('INSERT INTO exceptions (request_id,type,detail,meta,created_at) VALUES (?,?,?,?,?)')
    .run(requestId, type, detail, JSON.stringify(meta || {}), now());
  const r = getRequest(requestId);
  logEvent(requestId, null, 'exception', `Exception raised: ${type.replace('_', ' ')} - ${detail}`);
  notifyAdmins(`Exception on ${r.code}: ${detail}`, `#/app/requests/${requestId}`);
  if (r.technician_id) {
    const t = db.prepare('SELECT user_id FROM technicians WHERE id=?').get(r.technician_id);
    if (t) notify(t.user_id, `Exception on ${r.code}: ${detail}`, `#/app/requests/${requestId}`);
  }
  return info.lastInsertRowid;
}
function resolveExceptions(requestId, type, note) {
  const rows = db.prepare("SELECT id FROM exceptions WHERE request_id=? AND status='open' AND (? IS NULL OR type=?)").all(requestId, type || null, type || null);
  rows.forEach(e => db.prepare("UPDATE exceptions SET status='resolved', resolved_at=? WHERE id=?").run(now(), e.id));
  if (rows.length) logEvent(requestId, null, 'system', note || 'Exception resolved');
  return rows.length;
}

// ---- Spare parts -----------------------------------------------------------
function partsReport(items) {
  return items.map(i => {
    const p = db.prepare('SELECT * FROM parts WHERE id=?').get(i.part_id);
    if (!p) return { part_id: i.part_id, name: 'Unknown part', qty: i.qty, available: 0, ok: false, lead_time_hours: 0 };
    const available = p.stock - p.reserved;
    return { part_id: p.id, sku: p.sku, name: p.name, qty: i.qty, available, ok: available >= i.qty, lead_time_hours: p.lead_time_hours };
  });
}
function reservedFor(requestId) {
  return db.prepare("SELECT part_id, qty FROM reservations WHERE request_id=? AND status='reserved'").all(requestId);
}
// Reserve every required part that is not yet reserved. Returns {allReserved, missing[]}
const reserveParts = db.transaction(requestId => {
  const r = getRequest(requestId);
  const have = new Set(reservedFor(requestId).map(x => x.part_id));
  const missing = [];
  for (const item of r.required_parts) {
    if (have.has(item.part_id)) continue;
    const p = db.prepare('SELECT * FROM parts WHERE id=?').get(item.part_id);
    if (p && p.stock - p.reserved >= item.qty) {
      db.prepare('UPDATE parts SET reserved = reserved + ? WHERE id=?').run(item.qty, p.id);
      db.prepare('INSERT INTO reservations (request_id,part_id,qty) VALUES (?,?,?)').run(requestId, p.id, item.qty);
      logEvent(requestId, null, 'system', `Reserved ${item.qty} x ${p.name}`);
    } else {
      missing.push({ part_id: item.part_id, name: p ? p.name : 'Unknown', qty: item.qty, lead_time_hours: p ? p.lead_time_hours : 0 });
    }
  }
  return { allReserved: missing.length === 0, missing };
});
const releaseParts = db.transaction(requestId => {
  reservedFor(requestId).forEach(x => db.prepare('UPDATE parts SET reserved = MAX(0, reserved - ?) WHERE id=?').run(x.qty, x.part_id));
  db.prepare("UPDATE reservations SET status='released' WHERE request_id=? AND status='reserved'").run(requestId);
});
const consumeParts = db.transaction(requestId => {
  reservedFor(requestId).forEach(x => db.prepare('UPDATE parts SET stock = MAX(0, stock - ?), reserved = MAX(0, reserved - ?) WHERE id=?').run(x.qty, x.qty, x.part_id));
  db.prepare("UPDATE reservations SET status='consumed' WHERE request_id=? AND status='reserved'").run(requestId);
});

// Try to reserve; raise or resolve a part exception accordingly.
function syncPartReservation(requestId) {
  const r = getRequest(requestId);
  if (!r.required_parts.length) return { allReserved: true, missing: [] };
  const res = reserveParts(requestId);
  if (res.allReserved) resolveExceptions(requestId, 'part_unavailable', 'All required parts reserved');
  else {
    const eta = Math.max(...res.missing.map(m => m.lead_time_hours));
    raiseException(requestId, 'part_unavailable', `Missing: ${res.missing.map(m => `${m.qty} x ${m.name}`).join(', ')} (restock ETA ~${eta}h)`, { missing: res.missing });
  }
  return res;
}

function activeLoad(techId) {
  return db.prepare("SELECT COUNT(*) c FROM requests WHERE technician_id=? AND status IN ('assigned','in_progress')").get(techId).c;
}
function syncTechStatus(techId) {
  if (!techId) return;
  const t = db.prepare('SELECT status FROM technicians WHERE id=?').get(techId);
  if (!t || t.status === 'off') return;
  db.prepare('UPDATE technicians SET status=? WHERE id=?').run(activeLoad(techId) > 0 ? 'busy' : 'available', techId);
}

function nextCode() {
  const n = db.prepare('SELECT COALESCE(MAX(id),0)+1 n FROM requests').get().n;
  return 'SR-' + String(n).padStart(4, '0');
}

module.exports = {
  SKILLS, PRIORITIES, SLA_HOURS, WORK_HOURS, MACHINE_TYPES, ACTIVE,
  now, J, hydrate, getRequest, logEvent, touch, refresh, raiseException, resolveExceptions,
  partsReport, reservedFor, reserveParts, releaseParts, consumeParts, syncPartReservation,
  activeLoad, syncTechStatus, nextCode
};
