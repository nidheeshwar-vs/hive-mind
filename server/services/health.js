// AI feature 2: Predictive machine health. Combines live IoT telemetry, runtime since last
// service and failure history into a 0-100 risk score + an estimated time to critical failure.
const { db } = require('../db');

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
function slope(ys) { // least-squares slope per reading
  const n = ys.length; if (n < 3) return 0;
  const mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  ys.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) ** 2; });
  return den ? num / den : 0;
}
const tempScore = t => clamp((t - 55) / (95 - 55));
const vibScore = v => clamp((v - 2) / (9 - 2));

function computeHealth(machine) {
  const rows = db.prepare('SELECT * FROM telemetry WHERE machine_id=? ORDER BY id DESC LIMIT 24').all(machine.id).reverse();
  const last = rows[rows.length - 1] || { temperature: machine.base_temp, vibration: machine.base_vib };
  const sinceService = machine.runtime_hours - machine.last_service_runtime;
  const rtScore = clamp(sinceService / machine.service_interval_hours);
  const since = new Date(Date.now() - 90 * 864e5).toISOString();
  const fails = db.prepare("SELECT COUNT(*) c FROM requests WHERE machine_id=? AND kind='corrective' AND created_at>?").get(machine.id, since).c;
  const histScore = clamp(fails / 4);
  const parts = { temperature: tempScore(last.temperature), vibration: vibScore(last.vibration), runtime: rtScore, history: histScore };
  const risk = Math.round(100 * (0.30 * parts.temperature + 0.30 * parts.vibration + 0.25 * parts.runtime + 0.15 * parts.history));

  const series = rows.map(r => 100 * (0.5 * tempScore(r.temperature) + 0.5 * vibScore(r.vibration)));
  const sl = slope(series.slice(-12)); // risk points per reading (1 reading ~ 1 hour of sim time)
  const hoursToCritical = sl > 0.2 && risk < 85 ? Math.round((85 - risk) / sl) : null;
  const level = risk >= 70 ? 'critical' : risk >= 40 ? 'watch' : 'healthy';
  const drivers = Object.entries(parts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
  return {
    machine_id: machine.id, code: machine.code, name: machine.name, risk, level,
    temperature: Math.round(last.temperature * 10) / 10, vibration: Math.round(last.vibration * 100) / 100,
    breakdown: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 100)])),
    hours_since_service: Math.round(sinceService), trend_per_hour: Math.round(sl * 100) / 100,
    hours_to_critical: hoursToCritical, drivers,
    series: { temperature: rows.map(r => r.temperature), vibration: rows.map(r => r.vibration) },
    recommendation: level === 'critical' ? 'Schedule preventive maintenance now' : level === 'watch' ? 'Inspect within 72 hours' : 'No action needed'
  };
}

function allHealth() {
  return db.prepare('SELECT * FROM machines').all().map(computeHealth).sort((a, b) => b.risk - a.risk);
}

// IoT simulator: drifting sensor values so the demo is alive. Real devices POST to /api/iot/telemetry instead.
function simulateTick() {
  const ins = db.prepare('INSERT INTO telemetry (machine_id,ts,temperature,vibration) VALUES (?,?,?,?)');
  db.prepare('SELECT * FROM machines').all().forEach(m => {
    const last = db.prepare('SELECT temperature,vibration FROM telemetry WHERE machine_id=? ORDER BY id DESC LIMIT 1').get(m.id)
      || { temperature: m.base_temp, vibration: m.base_vib };
    const noise = () => (Math.random() - 0.5);
    const temp = clamp(last.temperature + (m.base_temp - last.temperature) * 0.08 + m.drift * 1.6 + noise() * 1.6, 30, 110);
    const vib = clamp(last.vibration + (m.base_vib - last.vibration) * 0.08 + m.drift * 0.22 + noise() * 0.25, 0.5, 14);
    ins.run(m.id, new Date().toISOString(), temp, vib);
    db.prepare('UPDATE machines SET runtime_hours = runtime_hours + 0.05 WHERE id=?').run(m.id);
  });
  db.prepare('DELETE FROM telemetry WHERE id < (SELECT MAX(id) FROM telemetry) - 4000').run();
}

module.exports = { computeHealth, allHealth, simulateTick };
