// End-to-end API smoke test. Start the server first (npm start), then: npm test
const BASE = process.env.BASE || 'http://localhost:3000/api';
let pass = 0, failN = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { failN++; console.log('  FAIL', m); } };
async function call(path, { method = 'GET', body, token, form } = {}) {
  const headers = {}; if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const login = async (email, password) => (await call('/auth/login', { method: 'POST', body: { email, password } })).data.token;

(async () => {
  console.log('Auth');
  const bad = await call('/auth/login', { method: 'POST', body: { email: 'admin@hivemind.io', password: 'wrong' } });
  ok(bad.status === 401, 'wrong password rejected');
  const admin = await login('admin@hivemind.io', 'Admin@123'), cust = await login('customer@sitea.com', 'Cust@123');
  ok(admin && cust, 'admin and customer can sign in');
  ok((await call('/audit', { token: cust })).status === 403, 'customer cannot read audit');

  console.log('Create + preflight');
  const machines = (await call('/machines', { token: cust })).data;
  const m104 = machines.find(m => m.code === 'M-104');
  ok(machines.every(m => m.site_id === 1), 'customer only sees own site machines');
  const parts = (await call('/parts', { token: admin })).data, valve = parts.find(p => p.sku === 'PN-AC-201');
  const pf = (await call('/requests/preflight', { method: 'POST', token: cust, body: { machine_id: m104.id, priority: 'critical', required_parts: [{ part_id: valve.id, qty: 1 }] } })).data;
  ok(pf.ok && pf.checks.some(c => c.key === 'duplicate' && c.status === 'warn'), 'preflight flags duplicate work on M-104');
  const created = (await call('/requests', { method: 'POST', token: cust, body: { machine_id: m104.id, title: 'Smoke test: compressor trips', priority: 'critical', required_parts: [{ part_id: valve.id, qty: 1 }] } })).data;
  ok(created.id, 'request created ' + created.code);

  console.log('Approve + assign');
  const ap = (await call(`/requests/${created.id}/approve`, { method: 'POST', token: admin })).data;
  ok(ap.ok && ap.parts_reserved, 'approved and parts reserved');
  const as = (await call(`/requests/${created.id}/auto-assign`, { method: 'POST', token: admin })).data;
  ok(as.ok, 'auto-assigned to ' + as.technician + ' (score ' + as.score + ')');
  const techEmail = as.technician.split(' ')[0].toLowerCase() + '@hivemind.io', tech = await login(techEmail, 'Tech@123');
  ok(!!tech, 'assigned technician can sign in');

  console.log('Execute');
  ok((await call(`/requests/${created.id}/start`, { method: 'POST', token: tech })).data.ok, 'technician starts work');
  const early = await call(`/requests/${created.id}/submit`, { method: 'POST', token: tech, body: { notes: 'done it all' } });
  ok(early.status === 400, 'submit blocked without proof of work');
  const fd = new FormData(); fd.append('file', new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0))], { type: 'image/png' }), 'proof.png');
  ok((await call(`/requests/${created.id}/attachments`, { method: 'POST', token: tech, form: fd })).data.ok, 'photo uploaded');
  ok((await call(`/requests/${created.id}/submit`, { method: 'POST', token: tech, body: { notes: 'Replaced intake valve and tested', checklist: ['Machine tested under load'] } })).data.ok, 'submitted for verification');
  ok((await call(`/requests/${created.id}/verify`, { method: 'POST', token: cust, body: { approve: true } })).data.status === 'completed', 'customer verifies and closes');
  const det = (await call(`/requests/${created.id}`, { token: admin })).data;
  ok(det.request.status === 'completed' && det.parts[0].reserved === false, 'parts consumed on completion');

  console.log('Exceptions');
  const reqs = (await call('/requests?active=1', { token: admin })).data;
  const assigned = reqs.find(r => r.status === 'assigned' && r.technician_name);
  const t2 = await login(assigned.technician_name.split(' ')[0].toLowerCase() + '@hivemind.io', 'Tech@123');
  const dr = (await call(`/requests/${assigned.id}/dropout`, { method: 'POST', token: t2, body: { reason: 'smoke test' } })).data;
  ok(dr.ok, 'technician dropout accepted');
  const d2 = (await call(`/requests/${assigned.id}`, { token: admin })).data;
  ok(d2.exceptions.some(e => e.type === 'tech_dropout' && e.status === 'open'), 'dropout exception raised');
  const re = await call(`/requests/${assigned.id}/auto-assign`, { method: 'POST', token: admin });
  ok(re.data.ok && re.data.technician !== assigned.technician_name, 'instant reassignment to ' + re.data.technician);
  const d3 = (await call(`/requests/${assigned.id}`, { token: admin })).data;
  ok(!d3.exceptions.some(e => e.type === 'tech_dropout' && e.status === 'open'), 'dropout exception cleared');
  const coil = parts.find(p => p.sku === 'HV-CP-300'), chiller = reqs.find(r => r.machine_code === 'M-203');
  const rs = (await call(`/parts/${coil.id}/restock`, { method: 'POST', token: admin, body: { qty: 2 } })).data;
  ok(rs.auto_resolved.includes(chiller.code), 'restock auto-resolved parts exception on ' + chiller.code);

  console.log('AI endpoints + audit');
  ok((await call('/ai/health', { token: admin })).data.length >= 12, 'health scores for all machines');
  ok((await call('/ai/sla', { token: admin })).data.every(x => x.sla.probability >= 0 && x.sla.probability <= 1), 'SLA predictions valid');
  ok((await call(`/ai/impact/${chiller.id}?hours=8`, { token: admin })).data.estimated_loss > 0, 'impact simulation returns a loss');
  ok((await call('/audit/verify', { token: admin })).data.valid, 'audit chain valid');
  const tel = await call('/iot/telemetry', { method: 'POST', body: { machine_code: 'M-104', temperature: 80, vibration: 5 } });
  ok(tel.status === 401, 'IoT endpoint requires API key');

  console.log(`\n${pass} passed, ${failN} failed`);
  process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
