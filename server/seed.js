// Demo data. Runs automatically on first start (empty DB) or via `npm run seed`.
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const W = require('./services/workflow');
const { audit } = require('./services/audit');

const H = 36e5;
const ago = h => new Date(Date.now() - h * H).toISOString();
const ahead = h => new Date(Date.now() + h * H).toISOString();

function seed() {
  const hash = p => bcrypt.hashSync(p, 8);
  const tx = db.transaction(() => {
    // ---- Sites
    const sites = [
      ['Site A - Sriperumbudur Plant', 'Sriperumbudur', 12.9675, 79.9419],
      ['Site B - Hosur Works', 'Hosur', 12.7409, 77.8253],
      ['Site C - Coimbatore Foundry', 'Coimbatore', 11.0168, 76.9558],
      ['Site D - Ennore Port Unit', 'Chennai', 13.2167, 80.3167]
    ];
    sites.forEach(s => db.prepare('INSERT INTO sites (name,city,lat,lng) VALUES (?,?,?,?)').run(...s));

    // ---- Users
    const user = (name, email, pw, role, site) =>
      db.prepare('INSERT INTO users (name,email,password_hash,role,site_id) VALUES (?,?,?,?,?)').run(name, email, hash(pw), role, site || null).lastInsertRowid;
    user('Ops Control', 'admin@hivemind.io', 'Admin@123', 'admin');
    user('Anita Verma (Site A)', 'customer@sitea.com', 'Cust@123', 'customer', 1);
    user('Vikram Rao (Site B)', 'customer@siteb.com', 'Cust@123', 'customer', 2);

    // ---- Technicians [name, email, skills, exp, rating, max, lat, lng, base]
    const techs = [
      ['Arjun Kumar', 'arjun@hivemind.io', ['Pneumatics', 'Electrical', 'Mechanical'], 9, 4.7, 2, 12.9249, 80.1000, 'Tambaram'],
      ['Priya Natarajan', 'priya@hivemind.io', ['PLC & Automation', 'Electrical', 'Instrumentation'], 7, 4.8, 2, 12.8342, 79.7036, 'Kanchipuram'],
      ['Karthik Raja', 'karthik@hivemind.io', ['Hydraulics', 'Mechanical', 'Welding'], 11, 4.6, 2, 12.7300, 77.8300, 'Hosur'],
      ['Meena Subramani', 'meena@hivemind.io', ['HVAC', 'Electrical'], 5, 4.4, 2, 12.5186, 78.2137, 'Krishnagiri'],
      ['Suresh Babu', 'suresh@hivemind.io', ['Welding', 'Mechanical', 'PLC & Automation'], 12, 4.9, 3, 11.0200, 76.9600, 'Coimbatore'],
      ['Divya Lakshmi', 'divya@hivemind.io', ['Instrumentation', 'Pneumatics', 'Hydraulics'], 4, 4.3, 2, 11.0050, 76.9700, 'Coimbatore'],
      ['Rahul Menon', 'rahul@hivemind.io', ['Electrical', 'Pneumatics', 'HVAC'], 6, 4.5, 2, 13.2000, 80.3200, 'Ennore'],
      ['Faizal Ahmed', 'faizal@hivemind.io', ['Mechanical', 'Hydraulics', 'Pneumatics'], 8, 4.6, 2, 12.9600, 79.9500, 'Sriperumbudur']
    ];
    techs.forEach(t => {
      const uid = user(t[0], t[1], 'Tech@123', 'technician');
      db.prepare('INSERT INTO technicians (user_id,skills,experience_years,rating,max_load,lat,lng,base_label) VALUES (?,?,?,?,?,?,?,?)')
        .run(uid, JSON.stringify(t[2]), t[3], t[4], t[5], t[6], t[7], t[8]);
    });

    // ---- Machines [code,name,type,site,hourly_loss,dependents,base_temp,base_vib,drift,start_temp,start_vib,runtime,sinceService]
    const machines = [
      ['M-101', 'CNC Mill Alpha', 'CNC Machining Center', 1, 45000, 2, 58, 2.2, 0, 58, 2.2, 5200, 220],
      ['M-102', 'Hydraulic Press HP-2', 'Hydraulic Press', 1, 60000, 3, 64, 3.0, 0, 66, 3.4, 8100, 640],
      ['M-104', 'Air Compressor Titan', 'Air Compressor', 1, 85000, 4, 62, 2.6, 0.25, 84, 6.8, 9400, 760],
      ['M-105', 'Conveyor Line C-9', 'Conveyor Line', 1, 30000, 2, 52, 1.8, 0, 52, 1.8, 3900, 150],
      ['M-201', 'Robotic Welder RW-1', 'Robotic Welder', 2, 70000, 3, 60, 2.4, 0, 61, 2.5, 6100, 410],
      ['M-202', 'CNC Mill Beta', 'CNC Machining Center', 2, 45000, 1, 57, 2.1, 0, 57, 2.1, 4300, 300],
      ['M-203', 'Chiller CH-3', 'Chiller Unit', 2, 38000, 2, 55, 2.0, 0.08, 63, 3.0, 7200, 520],
      ['M-301', 'Boiler B-7', 'Industrial Boiler', 3, 90000, 5, 70, 2.8, 0, 71, 2.9, 11000, 380],
      ['M-302', 'Hydraulic Press HP-5', 'Hydraulic Press', 3, 60000, 2, 63, 3.0, 0, 64, 3.1, 7700, 900],
      ['M-303', 'Air Compressor Atlas', 'Air Compressor', 3, 55000, 2, 61, 2.5, 0.12, 69, 3.6, 6600, 610],
      ['M-401', 'Conveyor Port-1', 'Conveyor Line', 4, 28000, 1, 51, 1.7, 0, 51, 1.8, 2800, 120],
      ['M-402', 'Chiller CH-9', 'Chiller Unit', 4, 35000, 1, 54, 1.9, 0, 54, 1.9, 3100, 200]
    ];
    machines.forEach(m => {
      const id = db.prepare(`INSERT INTO machines (code,name,type,site_id,hourly_loss,dependents,base_temp,base_vib,drift,runtime_hours,last_service_runtime,
        service_interval_hours,sla_penalty_per_hour,install_date,last_service,warranty_until,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[11], m[11] - m[12], 800, Math.round(m[4] / 8), '2021-04-12', ago(24 * 30).slice(0, 10), '2027-03-31', 'operational').lastInsertRowid;
      // 48 hours of telemetry history ending at the "start" values (drifting machines trend upward)
      for (let i = 47; i >= 0; i--) {
        const k = i / 47, noise = () => (Math.random() - 0.5);
        const temp = m[9] - (m[9] - m[6]) * k * (m[8] > 0 ? 1 : 0.1) + noise() * 1.4;
        const vib = m[10] - (m[10] - m[7]) * k * (m[8] > 0 ? 1 : 0.1) + noise() * 0.2;
        db.prepare('INSERT INTO telemetry (machine_id,ts,temperature,vibration) VALUES (?,?,?,?)').run(id, ago(i), temp, vib);
      }
    });

    // ---- Parts [sku,name,stock,lead,cost,types]
    const parts = [
      ['PN-AC-201', 'Compressor Intake Valve', 6, 24, 18500, ['Air Compressor']],
      ['PN-AC-310', 'Oil Separator Element', 3, 48, 9200, ['Air Compressor']],
      ['PN-AC-415', 'Bearing Set 6205', 10, 12, 2400, ['*']],
      ['HY-PR-120', 'Hydraulic Seal Kit', 8, 24, 6400, ['Hydraulic Press']],
      ['HY-PR-240', 'Servo Valve', 2, 72, 48000, ['Hydraulic Press']],
      ['EL-CT-050', 'Contactor 3-Phase', 15, 12, 3100, ['*']],
      ['EL-VF-100', 'VFD Drive 7.5kW', 1, 96, 61000, ['Conveyor Line', 'Air Compressor', 'Chiller Unit']],
      ['ME-BR-620', 'Heavy Bearing 6310', 12, 24, 5200, ['*']],
      ['CN-BL-010', 'Conveyor Belt 2m', 4, 48, 14500, ['Conveyor Line']],
      ['HV-CP-300', 'Chiller Compressor Coil', 0, 120, 82000, ['Chiller Unit']],
      ['IN-SN-070', 'Pressure Sensor', 20, 24, 4200, ['Industrial Boiler', 'Air Compressor', 'Hydraulic Press']],
      ['WL-TP-005', 'Welding Torch Tip', 30, 24, 650, ['Robotic Welder']]
    ];
    parts.forEach(p => db.prepare('INSERT INTO parts (sku,name,stock,lead_time_hours,unit_cost,compatible_types) VALUES (?,?,?,?,?,?)')
      .run(p[0], p[1], p[2], p[3], p[4], JSON.stringify(p[5])));
  });
  tx();

  const mid = c => db.prepare('SELECT id FROM machines WHERE code=?').get(c).id;
  const pid = s => db.prepare('SELECT id FROM parts WHERE sku=?').get(s).id;
  const tid = n => db.prepare('SELECT t.id FROM technicians t JOIN users u ON u.id=t.user_id WHERE u.name=?').get(n).id;
  const cust = { 1: db.prepare("SELECT id FROM users WHERE email='customer@sitea.com'").get().id, 2: db.prepare("SELECT id FROM users WHERE email='customer@siteb.com'").get().id };
  const admin = db.prepare("SELECT id FROM users WHERE role='admin'").get().id;

  function mk(o) {
    const m = db.prepare('SELECT * FROM machines WHERE code=?').get(o.machine);
    const by = cust[m.site_id] || admin;
    const created = ago(o.age);
    const due = o.due !== undefined ? ahead(o.due) : new Date(new Date(created).getTime() + W.SLA_HOURS[o.priority] * H).toISOString();
    const info = db.prepare(`INSERT INTO requests (code,machine_id,site_id,title,description,priority,kind,status,required_skills,required_parts,created_by,technician_id,
      approved_by,sla_due,created_at,updated_at,started_at,completed_at,completion_notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(W.nextCode(), m.id, m.site_id, o.title, o.desc, o.priority, o.kind || 'corrective', o.status, JSON.stringify(o.skills),
        JSON.stringify((o.parts || []).map(p => ({ part_id: pid(p[0]), qty: p[1] }))), cust[m.site_id] || admin, o.tech ? tid(o.tech) : null,
        ['pending_approval'].includes(o.status) ? null : admin, due, created, created, o.started ? ago(o.started) : null,
        o.completedAfter ? new Date(new Date(created).getTime() + o.completedAfter * H).toISOString() : null, o.notes || null);
    const id = info.lastInsertRowid;
    W.logEvent(id, by, 'status', 'Request created');
    if (o.status !== 'pending_approval') W.logEvent(id, admin, 'status', 'Approved by Ops Control');
    if (o.tech) W.logEvent(id, admin, 'status', `Assigned to ${o.tech}`);
    if (!['completed', 'rejected'].includes(o.status)) W.syncPartReservation(id);
    if (o.status === 'completed') { W.logEvent(id, null, 'status', 'Completed and verified'); db.prepare('UPDATE requests SET verified_by=? WHERE id=?').run(by, id); }
    return id;
  }

  // History (completed) - gives the dashboard real numbers
  [
    ['M-101', 'Spindle vibration check', 'medium', ['Mechanical'], 'Karthik Raja', 300, 6],
    ['M-105', 'Conveyor motor replaced', 'high', ['Electrical', 'Mechanical'], 'Arjun Kumar', 260, 7],
    ['M-202', 'PLC fault code E-47', 'high', ['PLC & Automation'], 'Priya Natarajan', 230, 9],
    ['M-302', 'Seal leak on press cylinder', 'critical', ['Hydraulics'], 'Divya Lakshmi', 200, 3.5],
    ['M-401', 'Belt misalignment', 'low', ['Mechanical'], 'Rahul Menon', 170, 20],
    ['M-303', 'Pressure drop in line', 'high', ['Pneumatics'], 'Divya Lakshmi', 140, 11],
    ['M-102', 'Oil temperature alarm', 'critical', ['Hydraulics', 'Mechanical'], 'Faizal Ahmed', 110, 6],
    ['M-203', 'Thermostat calibration', 'medium', ['HVAC'], 'Meena Subramani', 80, 18],
    ['M-104', 'Intake filter clogged', 'medium', ['Pneumatics'], 'Arjun Kumar', 50, 14],
    ['M-201', 'Torch tip wear', 'low', ['Welding'], 'Suresh Babu', 30, 30]
  ].forEach(h => mk({ machine: h[0], title: h[1], desc: 'Historical service record.', priority: h[2], skills: h[3], tech: h[4], status: 'completed', age: h[5], completedAfter: h[6], notes: 'Issue resolved, machine tested.' }));

  // The headline scenario from the brief: urgent maintenance on M-104 at Site A
  mk({ machine: 'M-104', title: 'Overheating and abnormal vibration', desc: 'Operators report the compressor tripping on high temperature and a grinding noise from the drive end.',
    priority: 'critical', skills: ['Pneumatics', 'Electrical'], parts: [['PN-AC-201', 1], ['PN-AC-415', 2]], status: 'pending_approval', age: 0.4 });
  mk({ machine: 'M-301', title: 'Boiler pressure sensor drifting', desc: 'Pressure reading differs from manual gauge by 8%.', priority: 'high', skills: ['Instrumentation'],
    parts: [['IN-SN-070', 1]], status: 'assigned', tech: 'Divya Lakshmi', age: 1.5 });
  mk({ machine: 'M-201', title: 'Welding torch alignment off', desc: 'Weld seams are inconsistent on station 2.', priority: 'medium', skills: ['Welding', 'PLC & Automation'],
    parts: [['WL-TP-005', 2]], status: 'in_progress', tech: 'Suresh Babu', age: 3, started: 1 });
  mk({ machine: 'M-203', title: 'Chiller coil leaking', desc: 'Coolant loss observed, discharge pressure low.', priority: 'high', skills: ['HVAC'],
    parts: [['HV-CP-300', 1]], status: 'approved', age: 2 });
  mk({ machine: 'M-401', title: 'Belt tracking issue', desc: 'Belt drifts to one side under load.', priority: 'medium', skills: ['Electrical', 'Mechanical'],
    status: 'awaiting_verification', tech: 'Rahul Menon', age: 7, started: 5, notes: 'Re-tensioned belt and realigned idlers.' });
  mk({ machine: 'M-102', title: 'Press cylinder seal leaking', desc: 'Hydraulic oil visible under the press.', priority: 'high', skills: ['Hydraulics', 'Mechanical'],
    parts: [['HY-PR-120', 1]], status: 'in_progress', tech: 'Faizal Ahmed', age: 9, started: 7, due: -1 });
  db.prepare("UPDATE technicians SET status='busy' WHERE id IN (SELECT DISTINCT technician_id FROM requests WHERE status IN ('assigned','in_progress') AND technician_id IS NOT NULL)").run();
  db.prepare("UPDATE technicians SET status='off' WHERE id=?").run(tid('Meena Subramani'));
  db.prepare("UPDATE machines SET status='down' WHERE code IN ('M-102')").run();
  db.prepare("UPDATE machines SET status='degraded' WHERE code IN ('M-104','M-203')").run();

  audit(admin, 'seed', 'system', 0, 'Demo data created');
  console.log('Demo data created.');
}

function ensureSeed() {
  const n = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (n === 0) seed();
}

if (require.main === module) {
  if (process.argv.includes('--reset')) {
    db.pragma('foreign_keys = OFF');
    ['audit','notifications','attachments','exceptions','task_logs','reservations','requests','telemetry','parts','machines','technicians','users','sites']
      .forEach(t => { db.exec(`DELETE FROM ${t}`); db.exec(`DELETE FROM sqlite_sequence WHERE name='${t}'`); });
    db.pragma('foreign_keys = ON');
  }
  ensureSeed();
}
module.exports = { ensureSeed };
