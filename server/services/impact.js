// AI feature 5: Impact simulation - what does an unresolved problem cost the business?
const { db } = require('../db');

function simulateImpact(request, delayHours) {
  const m = db.prepare('SELECT * FROM machines WHERE id=?').get(request.machine_id);
  const cascade = 1 + 0.25 * m.dependents;               // downstream lines starve
  const hourly = m.hourly_loss * cascade;
  const overdue = Math.max(0, (Date.now() - new Date(request.sla_due).getTime()) / 36e5);
  const cost = h => Math.round(h * hourly + Math.max(0, h + overdue) * m.sla_penalty_per_hour);
  const curve = [0, 4, 8, 12, 24, 48].map(h => ({ hours: h, cost: cost(h) }));
  return {
    machine: { code: m.code, name: m.name, dependents: m.dependents },
    hourly_loss: Math.round(hourly), sla_penalty_per_hour: m.sla_penalty_per_hour, overdue_hours: Math.round(overdue * 10) / 10,
    delay_hours: delayHours, estimated_loss: cost(delayHours), curve,
    dependent_lines_affected: m.dependents,
    narrative: `${m.code} stopping costs about Rs ${Math.round(hourly).toLocaleString('en-IN')} per hour including ${m.dependents} dependent line(s), plus Rs ${m.sla_penalty_per_hour.toLocaleString('en-IN')} per hour in SLA penalties once the deadline passes.`
  };
}
module.exports = { simulateImpact };
