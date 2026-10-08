// AI feature 4: SLA / delay prediction + background watchdog that raises SLA exceptions.
const { db } = require('../db');
const { SLA_HOURS, WORK_HOURS, getRequest, partsReport, activeLoad, raiseException, ACTIVE } = require('./workflow');
const { haversine, rankTechnicians } = require('./matching');
const { notifyAdmins, broadcast } = require('./events');

function predictDelay(r) {
  if (!r || ['completed', 'rejected'].includes(r.status)) return null;
  const now = Date.now(), due = new Date(r.sla_due).getTime();
  const site = db.prepare('SELECT * FROM sites WHERE id=?').get(r.site_id);
  const factors = [];
  let hours = 0;

  // 1. Waiting for approval
  if (r.status === 'pending_approval') { hours += 0.75; factors.push({ label: 'Awaiting approval', hours: 0.75 }); }

  // 2. Technician travel + queue
  let tech = r.technician_id ? db.prepare('SELECT * FROM technicians WHERE id=?').get(r.technician_id) : null;
  if (!tech) {
    const best = rankTechnicians(r).find(c => c.eligible) || rankTechnicians(r)[0];
    if (best) tech = db.prepare('SELECT * FROM technicians WHERE id=?').get(best.technician_id);
    hours += 1; factors.push({ label: 'No technician assigned yet', hours: 1 });
  }
  if (tech && r.status !== 'in_progress' && r.status !== 'awaiting_verification') {
    const travel = Math.round(haversine(tech.lat, tech.lng, site.lat, site.lng) / 45 * 10) / 10;
    const queue = Math.max(0, activeLoad(tech.id) - (r.technician_id ? 1 : 0)) * 2;
    hours += travel + queue;
    factors.push({ label: 'Technician travel', hours: travel });
    if (queue) factors.push({ label: 'Technician queue', hours: queue });
  }

  // 3. Part availability
  const short = partsReport(r.required_parts).filter(p => !p.ok && !db.prepare("SELECT 1 FROM reservations WHERE request_id=? AND part_id=? AND status='reserved'").get(r.id, p.part_id));
  if (short.length) {
    const wait = Math.max(...short.map(p => p.lead_time_hours));
    hours += wait; factors.push({ label: 'Waiting for spare parts', hours: wait });
  }

  // 4. Work remaining
  const work = WORK_HOURS[r.priority];
  if (r.status === 'in_progress' && r.started_at) {
    const rem = Math.max(0.5, work - (now - new Date(r.started_at).getTime()) / 36e5);
    hours += rem; factors.push({ label: 'Work remaining', hours: Math.round(rem * 10) / 10 });
  } else if (r.status === 'awaiting_verification') {
    hours += 0.5; factors.push({ label: 'Verification', hours: 0.5 });
  } else { hours += work; factors.push({ label: 'Estimated work', hours: work }); }

  hours = Math.round(hours * 10) / 10;
  const predicted = now + hours * 36e5;
  const slack = (due - predicted) / 36e5;
  const scale = Math.max(1, SLA_HOURS[r.priority] * 0.12);
  let p = now > due ? 1 : 1 / (1 + Math.exp(slack / scale));
  p = Math.round(p * 100) / 100;
  return {
    probability: p, risk: p >= 0.7 ? 'high' : p >= 0.4 ? 'medium' : 'low',
    predicted_end: new Date(predicted).toISOString(), slack_hours: Math.round(slack * 10) / 10,
    remaining_hours: hours, factors, breached: now > due
  };
}

function allActivePredictions() {
  return db.prepare(`SELECT * FROM requests WHERE status IN (${ACTIVE.map(() => '?').join(',')})`).all(...ACTIVE)
    .map(row => { const r = getRequest(row.id); return { request: r, sla: predictDelay(r) }; });
}

// Watchdog: raises sla_breach exceptions and one-time "at risk" alerts.
function watchdog() {
  let changed = false;
  allActivePredictions().forEach(({ request: r, sla }) => {
    if (!sla) return;
    if (sla.breached) { if (raiseException(r.id, 'sla_breach', `${r.code} exceeded its SLA deadline`, {})) changed = true; }
    else if (sla.probability >= 0.7 && !r.risk_alerted) {
      db.prepare('UPDATE requests SET risk_alerted=1 WHERE id=?').run(r.id);
      notifyAdmins(`${r.code} is likely to miss its SLA (${Math.round(sla.probability * 100)}% risk)`, `#/app/requests/${r.id}`);
      changed = true;
    }
  });
  if (changed) broadcast('refresh', { entity: 'sla' });
}

module.exports = { predictDelay, allActivePredictions, watchdog };
