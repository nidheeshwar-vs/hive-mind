// Machines, technicians, parts, map, impact lab, audit.
import { api, state, qrUrl } from './api.js';
import { nav } from './nav.js';
import { esc, inr, ago, fdate, priTag, stTag, machTag, lvTag, techTag, meter, mrow, spark, areaChart, toast, promptBox, initials, due } from './ui.js';

const admin = () => state.user.role === 'admin';
const act = async (fn, ok) => { try { const r = await fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok); nav.reload(); return r; } catch (e) { toast(e.message, true); } };

// ============================================================ MACHINES
export async function machines() {
  const list = await api('/machines');
  const html = `<div class="page-head"><div><h1>Machines</h1><p>Live risk score from temperature, vibration, runtime and service history. Sorted by what needs you first.</p></div></div>
    <div class="grid g3">${[...list].sort((a, b) => b.risk - a.risk).map(m => `<a class="card machine ${m.level === 'critical' ? 'hot' : ''}" href="#/app/machines/${m.id}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div><div class="code">${esc(m.code)}</div><div style="font-weight:600">${esc(m.name)}</div><div class="sub">${esc(m.site_name)}</div></div><div style="text-align:right">${machTag(m.status)}<div style="margin-top:6px">${lvTag(m.level)}</div></div></div>
      <div style="margin:18px 0 6px;display:flex;align-items:baseline;gap:10px"><span class="big-num">${m.risk}</span><span class="sub">risk score</span></div>${meter(m.risk, m.level === 'critical')}
      <div style="margin-top:12px">${spark(m.series, 44)}</div>
      <div class="sub" style="display:flex;justify-content:space-between;margin-top:6px"><span>${m.temperature}&deg;C &middot; ${m.vibration} mm/s</span><span>${m.open_requests} open</span></div></a>`).join('')}</div>`;
  return { html };
}

export async function machineDetail({ id }) {
  const m = await api('/machines/' + id), h = m.health;
  const big = (vals, label, unit) => `<div class="card"><h3>${label}</h3><div class="big-num">${vals[vals.length - 1]?.toFixed(1)}<span style="font-size:22px;font-family:var(--body)"> ${unit}</span></div>${spark(vals, 90)}</div>`;
  const html = `<a class="sub" href="#/app/machines">&larr; All machines</a>
  <div class="page-head" style="margin-top:12px"><div><div class="chips" style="margin-bottom:12px">${machTag(m.status)}${lvTag(h.level)}<span class="tag thin">${esc(m.type)}</span></div><h1>${esc(m.code)}</h1><p style="font-size:20px;font-weight:500;color:var(--y)">${esc(m.name)} &middot; ${esc(m.site_name)}</p></div>
    <div class="actions"><a class="btn" href="#/app/requests/new?machine=${m.id}">Report a problem</a>${admin() ? '<button class="btn solid" id="prev">Create preventive request</button>' : ''}</div></div>
  <div class="grid g-main"><div class="grid">
    <div class="grid g2">${big(h.series.temperature, 'Temperature', '&deg;C')}${big(h.series.vibration, 'Vibration', 'mm/s')}</div>
    <div class="card"><h3>Service history</h3>${m.history.length ? `<div class="rows">${m.history.map(r => `<a class="row link" href="#/app/requests/${r.id}"><div class="grow"><div class="t">${esc(r.code)} &middot; ${esc(r.title)}</div><div class="sub">${fdate(r.created_at)} &middot; ${r.technician_name ? esc(r.technician_name) : 'Unassigned'}</div></div>${priTag(r.priority)}${stTag(r.status)}</a>`).join('')}</div>` : '<div class="empty">No service history yet.</div>'}</div></div>
  <div class="grid">
    <div class="card ${h.level === 'critical' ? 'inv' : ''}"><h3>Predictive health</h3><div style="display:flex;align-items:center;gap:18px"><div class="big-num" style="font-size:96px">${h.risk}</div><div><b>${esc(h.recommendation)}</b><div class="sub">${h.hours_to_critical ? `Estimated ${h.hours_to_critical} h until critical at the current trend.` : 'No upward trend detected.'}</div></div></div>
      <div style="margin-top:16px">${mrow('Temperature', h.breakdown.temperature)}${mrow('Vibration', h.breakdown.vibration)}${mrow('Runtime', h.breakdown.runtime)}${mrow('History', h.breakdown.history)}</div>
      <p class="sub" style="margin-top:12px">${h.hours_since_service} runtime hours since last service. Trend ${h.trend_per_hour >= 0 ? '+' : ''}${h.trend_per_hour} risk points per hour.</p></div>
    <div class="card"><h3>Machine passport</h3><div style="display:flex;gap:18px;align-items:center"><img src="${qrUrl(m.id)}" alt="QR code for ${esc(m.code)}" width="140" height="140" style="border-radius:16px;border:1.5px solid var(--y)"><div><p class="sub">Print this and stick it on the machine. Anyone can scan it for status and service history, no login needed.</p><a class="btn sm" style="margin-top:12px" href="#/passport/${esc(m.code)}">Open public page</a></div></div></div>
    <div class="card"><h3>Details</h3>${[['Installed', m.install_date], ['Last service', m.last_service], ['Warranty until', m.warranty_until], ['Runtime', Math.round(m.runtime_hours) + ' h'], ['Downtime cost', inr(m.hourly_loss) + ' per hour'], ['Dependent lines', m.dependents]].map(([a, b]) => `<div class="row" style="padding:8px 0"><span class="grow sub">${a}</span><b>${esc(b)}</b></div>`).join('')}</div></div></div>`;
  return { html, mount(root) { const b = root.querySelector('#prev'); if (b) b.onclick = async () => { try { const r = await api('/ai/preventive/' + m.id, { method: 'POST' }); toast('Preventive request created'); location.hash = '#/app/requests/' + r.id; } catch (e) { toast(e.message, true); } }; } };
}

// ============================================================ TECHNICIANS
export async function technicians() {
  const list = await api('/technicians');
  const html = `<div class="page-head"><div><h1>Technicians</h1><p>${list.filter(t => t.status === 'available').length} of ${list.length} ready to dispatch.</p></div></div>
    <div class="grid g3">${list.map(t => `<div class="card"><div style="display:flex;gap:14px;align-items:center"><div class="avatar" style="width:54px;height:54px;font-size:20px">${initials(t.name)}</div><div class="grow"><b style="font-size:19px">${esc(t.name)}</b><div class="sub">${esc(t.base_label)} &middot; ${t.experience_years} yrs &middot; rated ${t.rating}</div></div>${techTag(t.status)}</div>
      <div class="chips" style="margin:16px 0">${t.skills.map(s => `<span class="chip static">${esc(s)}</span>`).join('')}</div>
      <div class="sub" style="display:flex;justify-content:space-between;margin-bottom:6px"><span>Workload</span><span>${t.active_jobs} / ${t.max_load}</span></div>${meter(t.active_jobs / t.max_load * 100, t.active_jobs >= t.max_load)}
      <div style="margin-top:14px">${t.jobs.length ? t.jobs.map(j => `<a class="row link" style="padding:8px 6px" href="#/app/requests/${j.id}"><span class="grow t">${esc(j.code)} &middot; ${esc(j.title)}</span>${priTag(j.priority)}</a>`).join('') : '<span class="sub">No active jobs</span>'}</div>
      ${admin() ? `<div style="margin-top:14px"><button class="btn sm" data-tech="${t.id}" data-to="${t.status === 'off' ? 'on' : 'off'}">${t.status === 'off' ? 'Mark on duty' : 'Mark off duty'}</button></div>` : ''}</div>`).join('')}</div>`;
  return { html, mount(root) { root.querySelectorAll('[data-tech]').forEach(b => b.onclick = () => act(() => api(`/technicians/${b.dataset.tech}/status`, { method: 'PATCH', body: { status: b.dataset.to } }), 'Status updated')); } };
}

// ============================================================ PARTS
export async function parts() {
  const list = await api('/parts');
  const html = `<div class="page-head"><div><h1>Spare parts</h1><p>Stock, reservations and lead times. Restocking automatically clears parts exceptions on waiting requests.</p></div></div>
    <div class="table-wrap"><table><thead><tr><th>Part</th><th>In stock</th><th>Reserved</th><th>Free</th><th>Lead time</th><th>Availability</th>${admin() ? '<th></th>' : ''}</tr></thead><tbody>${list.map(p => `<tr><td><div class="t">${esc(p.name)}</div><div class="sub">${esc(p.sku)} &middot; ${p.compatible_types.includes('*') ? 'All machines' : esc(p.compatible_types.join(', '))}</div></td><td><b>${p.stock}</b></td><td>${p.reserved}</td><td><b>${p.available}</b></td><td>${p.lead_time_hours} h</td>
      <td style="min-width:150px">${p.available <= 0 ? '<span class="tag hatch">Out of stock</span>' : p.available <= 2 ? '<span class="tag line">Low</span>' : '<span class="tag thin">Healthy</span>'}</td>${admin() ? `<td><button class="btn sm" data-restock="${p.id}" data-name="${esc(p.name)}">Restock</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
  return { html, mount(root) {
    root.querySelectorAll('[data-restock]').forEach(b => b.onclick = async () => {
      const v = await promptBox('Restock ' + b.dataset.name, 'Quantity received', { type: 'number', value: '5', ok: 'Add stock' });
      if (v) act(() => api(`/parts/${b.dataset.restock}/restock`, { method: 'POST', body: { qty: v.v } }), r => r.auto_resolved.length ? `Stock added. Cleared parts exception on ${r.auto_resolved.join(', ')}` : 'Stock added');
    });
  } };
}

// ============================================================ MAP
let leafletReady;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletReady) return leafletReady;
  leafletReady = new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; s.onload = res; s.onerror = () => { leafletReady = null; rej(new Error('Map library could not load. Check your internet connection.')); }; document.head.appendChild(s);
  });
  return leafletReady;
}
export async function map() {
  const d = await api('/map');
  const html = `<div class="page-head"><div><h1>Live map</h1><p>Hexagons are sites. Pulsing means a machine is at critical risk. Dots are technicians.</p></div></div><div class="grid g-main"><div id="map"></div>
    <div class="grid"><div class="card"><h3>Sites</h3><div class="rows">${d.sites.map(s => `<div class="row"><div class="grow"><div class="t">${esc(s.name)}</div><div class="sub">${s.machines} machines &middot; ${s.active_requests} open requests</div></div>${s.critical_machines ? `<span class="tag hatch">${s.critical_machines} critical</span>` : '<span class="tag thin">Stable</span>'}</div>`).join('')}</div></div>
    ${d.technicians.length ? `<div class="card"><h3>Technicians</h3><div class="rows">${d.technicians.map(t => `<div class="row" style="padding:8px 0"><span class="grow">${esc(t.name)}</span>${techTag(t.status)}</div>`).join('')}</div></div>` : ''}</div></div>`;
  return { html, async mount(root) {
    try { await loadLeaflet(); } catch (e) { root.querySelector('#map').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const L = window.L, m = L.map('map', { zoomControl: true, attributionControl: true }).setView([12.6, 78.6], 7);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap, &copy; CARTO', maxZoom: 14 }).addTo(m);
    const pts = [];
    d.sites.forEach(s => { pts.push([s.lat, s.lng]); L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', iconSize: [46, 46], iconAnchor: [23, 23], html: `<div class="hx ${s.critical_machines ? 'pulse' : ''}" style="width:46px;height:46px;font-size:15px">${s.active_requests}</div>` }) }).addTo(m).bindPopup(`<b>${esc(s.name)}</b><br>${s.machines} machines, ${s.active_requests} open requests`); });
    d.technicians.forEach(t => { pts.push([t.lat, t.lng]); L.marker([t.lat, t.lng], { icon: L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7], html: `<div style="width:14px;height:14px;border-radius:50%;background:${t.status === 'off' ? '#000' : '#FFD60A'};border:2px solid #FFD60A"></div>` }) }).addTo(m).bindPopup(`<b>${esc(t.name)}</b><br>${t.status}`); });
    if (pts.length) m.fitBounds(pts, { padding: [50, 50] });
  } };
}

// ============================================================ IMPACT LAB
export async function impact() {
  const list = await api('/ai/impact');
  const html = `<div class="page-head"><div><h1>Impact lab</h1><p>Drag the delay and see what every open request costs the business in downtime and SLA penalties.</p></div></div>
    <div class="card hot" style="margin-bottom:18px"><div style="display:flex;gap:30px;align-items:center;flex-wrap:wrap"><div><div class="sub">If everything open waits another</div><div class="big-num" id="h" style="font-size:96px">8 h</div></div>
      <div style="flex:1;min-width:240px"><input type="range" id="sl" min="0" max="48" value="8" aria-label="Hours of delay"></div><div><div class="sub">Total exposure</div><div class="big-num" id="tot" style="font-size:96px">-</div></div></div></div>
    <div class="table-wrap"><table><thead><tr><th>Request</th><th>Machine</th><th>Priority</th><th>Cost per hour</th><th>Projected loss</th><th style="width:25%">Share</th></tr></thead><tbody id="tb"></tbody></table></div>`;
  return { html, mount(root) {
    const cost = (x, h) => h * x.impact.hourly_loss + Math.max(0, h + x.impact.overdue_hours) * x.impact.sla_penalty_per_hour;
    const draw = () => {
      const h = +root.querySelector('#sl').value, rows = list.map(x => ({ ...x, c: cost(x, h) })).sort((a, b) => b.c - a.c), tot = rows.reduce((a, r) => a + r.c, 0) || 1;
      root.querySelector('#h').textContent = h + ' h'; root.querySelector('#tot').textContent = inr(tot === 1 ? 0 : tot);
      root.querySelector('#tb').innerHTML = rows.map(r => `<tr class="link" data-href="#/app/requests/${r.id}"><td><div class="t">${esc(r.code)}</div><div class="sub">${esc(r.title)}</div></td><td>${esc(r.impact.machine.code)}</td><td>${priTag(r.priority)}</td><td>${inr(r.impact.hourly_loss)}</td><td><b>${inr(r.c)}</b></td><td>${meter(r.c / tot * 100)}</td></tr>`).join('');
      root.querySelectorAll('tr.link').forEach(tr => tr.onclick = () => location.hash = tr.dataset.href);
    };
    root.querySelector('#sl').oninput = draw; draw();
  } };
}

// ============================================================ AUDIT
export async function audit() {
  const a = await api('/audit'), c = a.chain;
  const html = `<div class="page-head"><div><h1>Audit trail</h1><p>Every action is chained to the one before it with SHA-256. Change or delete a record and the chain breaks.</p></div><div class="actions"><button class="btn" id="vf">Verify chain now</button></div></div>
    <div class="card ${c.valid ? 'inv' : 'hot'}" style="margin-bottom:18px"><h3>${c.valid ? 'Chain intact' : 'Chain broken at entry #' + c.broken_at}</h3><p>${c.total} entries checked.</p>${c.head ? `<p class="hash" style="margin-top:8px;color:inherit;opacity:.7">Head hash: ${c.head}</p>` : ''}</div>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>When</th><th>Who</th><th>Action</th><th>Subject</th><th>Detail</th><th>Hash</th></tr></thead><tbody>${a.items.map(r => `<tr><td>${r.id}</td><td>${fdate(r.ts)}</td><td>${esc(r.user_name || 'System')}</td><td><span class="tag thin">${esc(r.action)}</span></td><td>${esc(r.entity || '')} ${esc(r.entity_id)}</td><td>${esc(r.detail)}</td><td class="hash">${r.hash.slice(0, 12)}&hellip;</td></tr>`).join('')}</tbody></table></div>`;
  return { html, mount(root) { root.querySelector('#vf').onclick = async () => { const v = await api('/audit/verify'); toast(v.valid ? `Chain intact. ${v.total} entries verified.` : `Chain broken at entry ${v.broken_at}`, !v.valid); }; } };
}
