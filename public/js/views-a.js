// Dashboard, requests list/board, new request, request detail.
import { api, state, fileUrl } from './api.js';
import { nav } from './nav.js';
import { esc, inr, ago, fdate, due, priTag, stTag, stLabel, machTag, lvTag, techTag, excLabel, meter, mrow, spark, barChart, areaChart, toast, modal, confirmBox, promptBox, clamp, initials } from './ui.js';

const role = () => state.user.role;
const first = n => n.split(' ')[0];

function attachMic(btn, input) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { btn.classList.add('hide'); return; }
  let rec = null;
  btn.addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'en-IN'; rec.interimResults = false;
    rec.onresult = e => { input.value = (input.value + ' ' + e.results[0][0].transcript).trim(); };
    rec.onend = () => { rec = null; btn.classList.remove('rec'); };
    rec.start(); btn.classList.add('rec');
  });
}
const act = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) toast(okMsg); nav.reload(); return r; } catch (e) { toast(e.message, true); } };
const slaCell = r => r.sla ? `<div style="display:flex;align-items:center;gap:8px;min-width:130px">${meter(r.sla.probability * 100, r.sla.probability >= .7)}<span class="sub">${Math.round(r.sla.probability * 100)}%</span></div>` : '<span class="sub">-</span>';

// ============================================================ DASHBOARD
export async function dashboard() {
  const d = await api('/dashboard'), k = d.kpis, me = state.user, r = role();
  const greet = `${first(me.name)}`;
  const tile = (n, l, s, cls = '') => `<div class="card kpi ${cls}"><div class="n">${n}</div><div class="l">${l}</div><div class="s">${s}</div></div>`;
  let html = `<div class="page-head"><div><p class="sub">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    <h1>${r === 'admin' ? 'Control room' : r === 'technician' ? 'Your jobs, ' + esc(greet) : 'Your site, ' + esc(greet)}</h1></div>
    <div class="actions">${r !== 'technician' ? '<a class="btn solid" href="#/app/requests/new">New request</a>' : ''}</div></div>`;

  if (r === 'technician') {
    const jobs = (await api('/requests?active=1'));
    html += `<div class="grid g4" style="margin-bottom:18px">${tile(k.open, 'Active jobs', `${k.awaiting_verification} waiting for sign-off`, 'inv')}${tile(k.completed, 'Jobs completed', 'All time')}${tile(k.avg_resolution_hours + 'h', 'Average resolution', 'Created to closed')}
      <div class="card kpi"><div class="l" style="margin-bottom:10px">Your status</div>${techTag(d.my.status)}<div style="margin-top:16px"><button class="btn sm" id="duty">${d.my.status === 'off' ? 'Go on duty' : 'Go off duty'}</button></div><div class="chips" style="margin-top:14px">${d.my.skills.map(s => `<span class="chip static">${esc(s)}</span>`).join('')}</div></div></div>
      <div class="card"><h3>Assigned to you <span class="count">${jobs.length}</span></h3>${jobs.length ? `<div class="rows">${jobs.map(j => `<a class="row link" href="#/app/requests/${j.id}"><div class="grow"><div class="t">${esc(j.code)} &middot; ${esc(j.title)}</div><div class="sub">${esc(j.machine_code)} at ${esc(j.site_name)} &middot; ${due(j.sla_due)}</div></div>${priTag(j.priority)}${stTag(j.status)}</a>`).join('')}</div>` : '<div class="empty"><div class="display">All clear</div><p>No jobs right now. You will get a notification when one is assigned.</p></div>'}</div>`;
    return { html, mount(root) { root.querySelector('#duty').onclick = () => act(() => api('/technicians/me/status', { method: 'PATCH', body: { status: d.my.status === 'off' ? 'on' : 'off' } }), 'Status updated'); } };
  }

  html += `<div class="grid g4" style="margin-bottom:18px">
    ${tile(k.open, 'Open requests', `${k.critical} critical &middot; ${k.pending_approval} awaiting approval`, 'inv')}
    ${tile(k.at_risk, 'At risk of missing SLA', `${k.breached} already breached`)}
    ${tile(k.open_exceptions, 'Open exceptions', 'Dropouts, parts, SLA')}
    ${r === 'admin' ? tile(`${k.techs_available}<span style="font-size:.4em">/${k.techs_total}</span>`, 'Technicians available', 'Ready to be dispatched') : tile(k.machines_critical, 'Machines at critical risk', 'Predicted by health model')}</div>
    <div class="grid g4" style="margin-bottom:26px">${tile(k.sla_compliance + '%', 'SLA compliance', `${k.completed} completed jobs`, 'small')}${tile(k.avg_resolution_hours + 'h', 'Average resolution', 'Created to closed', 'small')}${tile(k.awaiting_verification, 'Waiting for sign-off', 'Proof of work submitted', 'small')}${tile(k.machines_critical, 'Machines at critical risk', 'Act before they stop', 'small')}</div>
    <div class="grid g-main"><div class="grid">
      <div class="card hot"><h3>Needs attention now <span class="count">${d.at_risk.length}</span></h3>${d.at_risk.length ? `<div class="rows">${d.at_risk.map(x => `<a class="row link" href="#/app/requests/${x.id}"><div class="grow"><div class="t">${esc(x.code)} &middot; ${esc(x.title)}</div><div class="sub">${x.sla.breached ? 'Deadline passed' : `Predicted finish ${fdate(x.sla.predicted_end)}`}</div></div>${priTag(x.priority)}<div style="width:130px;display:flex;align-items:center;gap:8px">${meter(x.sla.probability * 100, x.sla.probability >= .7)}<b>${Math.round(x.sla.probability * 100)}%</b></div></a>`).join('')}</div>` : '<div class="empty">Nothing at risk.</div>'}</div>
      <div class="card"><h3>Open exceptions <span class="count">${d.exceptions.length}</span></h3>${d.exceptions.length ? `<div class="rows">${d.exceptions.map(e => `<a class="row link" href="#/app/requests/${e.request_id}"><span class="tag hatch">${excLabel(e.type)}</span><div class="grow"><div class="t">${esc(e.code)}</div><div class="sub">${esc(e.detail)}</div></div><span class="sub">${ago(e.created_at)}</span></a>`).join('')}</div>` : '<div class="empty">No exceptions. The hive is calm.</div>'}</div>
      <div class="card"><h3>Last 7 days</h3>${barChart(d.trend.map(t => ({ label: t.day, a: t.created, b: t.completed })))}</div></div>
    <div class="grid">
      ${r === 'admin' ? `<div class="card inv"><h3>Conflict radar <span class="count">${d.conflicts.length}</span></h3>${d.conflicts.length ? d.conflicts.map(c => `<div class="row" style="border-top:1px solid rgba(0,0,0,.18)"><span class="tag line" style="border-color:#000">${{ overload: 'Overload', travel: 'Travel', duplicate: 'Duplicate', parts: 'Parts' }[c.type]}</span><span class="grow">${esc(c.text)}</span></div>`).join('') : '<p>No scheduling or resource conflicts found.</p>'}</div>` : ''}
      <div class="card"><h3>Machine health</h3><div class="rows">${d.health.map(h => `<a class="row link" href="#/app/machines/${h.machine_id}"><div class="grow"><div class="t">${esc(h.code)} &middot; ${esc(h.name)}</div>${meter(h.risk, h.level === 'critical')}</div><div style="text-align:right"><b style="font-size:22px">${h.risk}</b><br>${lvTag(h.level)}</div></a>`).join('')}</div><div style="margin-top:14px"><a class="btn sm" href="#/app/machines">All machines</a></div></div>
      <div class="card"><h3>Requests by status</h3>${Object.entries(d.by_status).map(([s, n]) => `<div class="row" style="padding:8px 0"><span class="grow">${stLabel(s)}</span><b>${n}</b></div>`).join('')}</div></div></div>`;
  return { html };
}

// ============================================================ REQUESTS LIST / BOARD
let F = { q: '', status: '', priority: '', view: sessionStorage.getItem('hm_view') || 'list', active: false };
const BOARD = ['pending_approval', 'approved', 'assigned', 'in_progress', 'awaiting_verification'];
export async function requests() {
  const all = await api('/requests');
  const html = `<div class="page-head"><div><h1>Service requests</h1><p>${role() === 'technician' ? 'Jobs assigned to you.' : role() === 'customer' ? 'Everything raised for your site.' : 'Every request across all sites, with live SLA risk.'}</p></div>
    <div class="actions">${role() !== 'technician' ? '<a class="btn solid" href="#/app/requests/new">New request</a>' : ''}</div></div>
    <div class="filters"><input type="search" id="fq" placeholder="Search code, title or machine" value="${esc(F.q)}">
      <select id="fs"><option value="">All statuses</option>${['pending_approval', 'approved', 'assigned', 'in_progress', 'awaiting_verification', 'completed', 'rejected'].map(s => `<option value="${s}" ${F.status === s ? 'selected' : ''}>${stLabel(s)}</option>`).join('')}</select>
      <select id="fp"><option value="">All priorities</option>${['critical', 'high', 'medium', 'low'].map(s => `<option value="${s}" ${F.priority === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select>
      <button class="chip ${F.active ? 'on' : ''}" id="fa">Active only</button>
      <span class="right tabs" style="margin:0"><button class="chip ${F.view === 'list' ? 'on' : ''}" data-v="list">List</button><button class="chip ${F.view === 'board' ? 'on' : ''}" data-v="board">Board</button></span></div>
    <div id="res"></div>`;
  return {
    html,
    mount(root) {
      const out = root.querySelector('#res');
      const draw = () => {
        const rows = all.filter(r => (!F.q || (r.title + r.code + r.machine_code).toLowerCase().includes(F.q.toLowerCase())) && (!F.status || r.status === F.status) && (!F.priority || r.priority === F.priority) && (!F.active || !['completed', 'rejected'].includes(r.status)));
        if (!rows.length) { out.innerHTML = '<div class="card empty"><div class="display">No requests</div><p>Nothing matches these filters.</p></div>'; return; }
        if (F.view === 'board') {
          out.innerHTML = `<div class="board">${BOARD.map(s => { const list = rows.filter(r => r.status === s); return `<div class="col"><h4>${stLabel(s)}<span>${list.length}</span></h4>${list.map(r => `<a class="tcard ${r.priority === 'critical' ? 'crit' : ''}" href="#/app/requests/${r.id}"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(r.code)}</b>${r.open_exceptions ? '<span class="tag hatch">Exception</span>' : ''}</div><div style="margin:6px 0">${esc(r.title)}</div><div class="sub">${esc(r.machine_code)} &middot; ${r.technician_name ? esc(r.technician_name) : 'Unassigned'}</div><div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center"><span class="sub">${due(r.sla_due)}</span>${r.priority !== 'critical' ? priTag(r.priority) : ''}</div></a>`).join('') || '<p class="sub" style="padding:8px">Empty</p>'}</div>`; }).join('')}</div>`;
        } else {
          out.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Request</th><th>Machine</th><th>Priority</th><th>Status</th><th>Technician</th><th>SLA risk</th><th>Deadline</th></tr></thead><tbody>${rows.map(r => `<tr class="link" data-href="#/app/requests/${r.id}"><td><div class="t">${esc(r.code)} ${r.open_exceptions ? '<span class="tag hatch">Exception</span>' : ''}</div><div class="sub">${esc(r.title)}</div></td><td>${esc(r.machine_code)}<div class="sub">${esc(r.site_name)}</div></td><td>${priTag(r.priority)}</td><td>${stTag(r.status)}</td><td>${r.technician_name ? esc(r.technician_name) : '<span class="sub">Unassigned</span>'}</td><td>${slaCell(r)}</td><td>${['completed', 'rejected'].includes(r.status) ? fdate(r.completed_at || r.updated_at) : due(r.sla_due)}</td></tr>`).join('')}</tbody></table></div>`;
          out.querySelectorAll('tr.link').forEach(tr => tr.addEventListener('click', () => location.hash = tr.dataset.href));
        }
      };
      const bind = (id, key, ev = 'input') => root.querySelector(id).addEventListener(ev, e => { F[key] = e.target.value; draw(); });
      bind('#fq', 'q'); bind('#fs', 'status', 'change'); bind('#fp', 'priority', 'change');
      root.querySelector('#fa').onclick = e => { F.active = !F.active; e.target.classList.toggle('on', F.active); draw(); };
      root.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { F.view = b.dataset.v; sessionStorage.setItem('hm_view', F.view); root.querySelectorAll('[data-v]').forEach(x => x.classList.toggle('on', x === b)); draw(); });
      draw();
    }
  };
}

// ============================================================ NEW REQUEST (live preflight)
export async function newRequest({ query }) {
  const [machines, meta] = await Promise.all([api('/machines'), api('/meta')]);
  const f = { machine_id: +query.machine || '', title: query.title || '', description: '', priority: query.priority || 'high', skills: [], parts: {} };
  const html = `<div class="page-head"><div><h1>New request</h1><p>Checks run as you type, so problems with the machine, skills or parts show up before you submit.</p></div></div>
    <div class="grid g-main"><div class="card"><div id="ferr"></div>
      <label class="f"><span>Machine</span><select id="m"><option value="">Choose a machine</option>${machines.map(m => `<option value="${m.id}" ${m.id === f.machine_id ? 'selected' : ''}>${esc(m.code)} - ${esc(m.name)} (${esc(m.site_name)})</option>`).join('')}</select></label>
      <label class="f"><span>What is wrong?</span><input type="text" id="t" value="${esc(f.title)}" placeholder="Example: Overheating and abnormal vibration" maxlength="120"></label>
      <label class="f"><span>Details for the technician</span><textarea id="d" placeholder="Symptoms, error codes, when it started"></textarea></label>
      <div class="f"><span style="display:block;font-weight:600;font-size:14px;margin-bottom:8px">Priority</span><div class="seg" id="pri">${['critical', 'high', 'medium', 'low'].map(p => `<label><input type="radio" name="p" value="${p}" ${f.priority === p ? 'checked' : ''}><span>${p[0].toUpperCase() + p.slice(1)}<small>${meta.sla_hours[p]}h SLA</small></span></label>`).join('')}</div></div>
      <div class="f"><span style="display:block;font-weight:600;font-size:14px;margin-bottom:8px">Skills needed <span class="sub" style="font-weight:400">(pre-filled from the machine type)</span></span><div class="chips" id="sk"></div></div>
      <div class="f"><span style="display:block;font-weight:600;font-size:14px;margin-bottom:8px">Spare parts <span class="sub" style="font-weight:400">(compatible parts, most used first)</span></span><div id="pt" class="sub">Choose a machine to see compatible parts.</div></div>
      <button class="btn solid lg" id="go" disabled>Submit request <span class="arr">&rarr;</span></button></div>
    <div class="card hot" style="position:sticky;top:90px"><h3>Preflight checks</h3><div id="pf" class="sub">Choose a machine to start.</div><div id="top"></div></div></div>`;
  return {
    html,
    mount(root) {
      const $ = s => root.querySelector(s); let timer, lastOk = false;
      const drawSkills = () => $('#sk').innerHTML = meta.skills.map(s => `<button type="button" class="chip ${f.skills.includes(s) ? 'on' : ''}" data-s="${esc(s)}">${esc(s)}</button>`).join('');
      const drawParts = async () => {
        if (!f.machine_id) return;
        const list = await api('/ai/suggest-parts?machine_id=' + f.machine_id);
        $('#pt').innerHTML = list.map(p => `<div class="row" style="padding:8px 0"><div class="grow"><div class="t">${esc(p.name)}</div><div class="sub">${esc(p.sku)} &middot; ${p.available} in stock</div></div><div class="stepper" data-p="${p.id}"><button type="button" data-d="-1" aria-label="Less">-</button><b>${f.parts[p.id] || 0}</b><button type="button" data-d="1" aria-label="More">+</button></div></div>`).join('');
      };
      const pre = () => { clearTimeout(timer); timer = setTimeout(async () => {
        if (!f.machine_id) return;
        const items = Object.entries(f.parts).filter(([, q]) => q > 0).map(([id, qty]) => ({ part_id: +id, qty }));
        try {
          const r = await api('/requests/preflight', { method: 'POST', body: { machine_id: f.machine_id, priority: f.priority, required_skills: f.skills, required_parts: items } });
          if (!f.skills.length && r.default_skills.length && !f._skFilled) { f.skills = [...r.default_skills]; f._skFilled = true; drawSkills(); return pre(); }
          $('#pf').innerHTML = r.checks.map(c => `<div class="check ${c.status}"><span class="ic">${c.status === 'pass' ? '&#10003;' : c.status === 'warn' ? '!' : '&times;'}</span><div><b>${esc(c.label)}</b><p>${esc(c.detail)}</p></div></div>`).join('');
          $('#top').innerHTML = r.top_matches.length ? `<div class="sub" style="margin:16px 0 8px">Likely technicians</div>${r.top_matches.map(m => `<div class="row" style="padding:8px 0"><div class="avatar" style="width:32px;height:32px;font-size:13px">${initials(m.name)}</div><div class="grow"><div class="t">${esc(m.name)}</div><div class="sub">${m.distance_km} km &middot; ${m.eligible ? 'free' : esc(m.blockers[0])}</div></div><b>${m.score}</b></div>`).join('')}` : '';
          lastOk = r.ok && f.title.trim().length >= 4; $('#go').disabled = !lastOk;
        } catch (e) { $('#pf').textContent = e.message; }
      }, 250); };
      $('#m').onchange = async e => { f.machine_id = +e.target.value; f.skills = []; f._skFilled = false; f.parts = {}; await drawParts(); pre(); };
      $('#t').oninput = e => { f.title = e.target.value; $('#go').disabled = !(lastOk = lastOk && f.title.trim().length >= 4) ; pre(); };
      $('#d').oninput = e => f.description = e.target.value;
      $('#pri').onchange = e => { f.priority = e.target.value; pre(); };
      $('#sk').onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; const s = b.dataset.s; f.skills = f.skills.includes(s) ? f.skills.filter(x => x !== s) : [...f.skills, s]; drawSkills(); pre(); };
      $('#pt').onclick = e => { const b = e.target.closest('[data-d]'); if (!b) return; const id = b.parentElement.dataset.p; f.parts[id] = clamp((f.parts[id] || 0) + +b.dataset.d, 0, 20); b.parentElement.querySelector('b').textContent = f.parts[id]; pre(); };
      $('#go').onclick = async () => {
        $('#go').disabled = true;
        try {
          const items = Object.entries(f.parts).filter(([, q]) => q > 0).map(([id, qty]) => ({ part_id: +id, qty }));
          const r = await api('/requests', { method: 'POST', body: { machine_id: f.machine_id, title: f.title, description: f.description, priority: f.priority, required_skills: f.skills, required_parts: items } });
          toast(`${r.code} created`); location.hash = '#/app/requests/' + r.id;
        } catch (e) { $('#ferr').innerHTML = `<div class="err">${esc(e.message)}</div>`; $('#go').disabled = false; }
      };
      drawSkills(); if (f.machine_id) { drawParts(); pre(); }
    }
  };
}

// ============================================================ REQUEST DETAIL
const STEPS = ['Created', 'Approved', 'Assigned', 'In progress', 'Verification', 'Closed'];
const IDX = { pending_approval: 0, approved: 1, assigned: 2, in_progress: 3, awaiting_verification: 4, completed: 5 };
const CHECK = ['Root cause identified', 'Fault repaired or part replaced', 'Machine tested under load', 'Work area cleaned', 'Lock-out / tag-out removed'];

export async function requestDetail({ id }) {
  const d = await api('/requests/' + id), q = d.request, r = role();
  const admin = r === 'admin', mineJob = admin || (r === 'technician'), cust = r === 'customer';
  const idx = IDX[q.status], open = d.exceptions.filter(e => e.status === 'open');
  const closed = ['completed', 'rejected'].includes(q.status);
  const bar = [];
  if (admin && q.status === 'pending_approval') bar.push('<button class="btn solid" data-do="approve">Approve and reserve parts</button>', '<button class="btn" data-do="reject">Reject</button>');
  if (admin && ['approved', 'assigned'].includes(q.status)) bar.push(`<button class="btn solid" data-do="auto">${q.status === 'assigned' ? 'Reassign to best match' : 'Auto-assign best match'}</button>`);
  if (mineJob && q.status === 'assigned') bar.push('<button class="btn solid" data-do="start">Start work</button>');
  if (mineJob && ['assigned', 'in_progress'].includes(q.status)) bar.push('<button class="btn" data-do="dropout">Report dropout</button>');
  if ((cust || admin) && q.status === 'awaiting_verification') bar.push('<button class="btn solid" data-do="verify">Verify and close</button>', '<button class="btn" data-do="sendback">Send back</button>');

  const sla = q.sla, imp = d.impact;
  const banners = open.map(e => `<div class="banner"><span class="tag" style="border-color:#000">${excLabel(e.type)}</span><span class="grow">${esc(e.detail)}</span>
    ${admin && e.type === 'tech_dropout' ? '<button class="btn sm solid" data-do="auto">Reassign in one click</button>' : ''}${admin && e.type === 'part_unavailable' ? '<a class="btn sm" href="#/app/parts">Open inventory</a>' : ''}${admin ? `<button class="btn sm" data-res="${e.id}">Mark resolved</button>` : ''}</div>`).join('');

  const html = `<a class="sub" href="#/app/requests">&larr; All requests</a>
  <div class="page-head" style="margin-top:12px"><div><div class="chips" style="margin-bottom:12px">${priTag(q.priority)}${stTag(q.status)}<span class="tag thin">${esc(q.code)}</span>${q.kind === 'preventive' ? '<span class="tag dash">Preventive</span>' : ''}</div>
    <h1 style="font-size:clamp(38px,5.4vw,78px)">${esc(q.title)}</h1><p><a href="#/app/machines/${q.machine_id}" style="text-decoration:underline">${esc(q.machine_code)} ${esc(q.machine_name)}</a> at ${esc(q.site_name)}. Raised ${ago(q.created_at)}.</p></div>
    <div class="actions">${bar.join('')}</div></div>
  ${banners}
  ${q.status === 'rejected' ? '<div class="banner"><span class="grow">This request was rejected.</span></div>' : `<div class="progress">${STEPS.map((s, i) => `<div class="st ${i < idx || q.status === 'completed' ? 'done' : i === idx ? 'now' : ''}">${s}</div>`).join('')}</div>`}
  <div class="grid g-main"><div class="grid">
    <div class="card"><h3>Description</h3><p>${esc(q.description) || '<span class="muted">No details given.</span>'}</p>
      <div class="chips" style="margin-top:16px">${q.required_skills.map(s => `<span class="tag line">${esc(s)}</span>`).join('')}</div>
      <div class="sub" style="margin-top:16px">Technician: <b style="color:var(--y)">${q.technician_name ? esc(q.technician_name) : 'Not assigned yet'}</b> &middot; Deadline: <b style="color:var(--y)">${fdate(q.sla_due)}</b> ${closed ? '' : `(${due(q.sla_due)})`}</div></div>
    ${d.parts.length ? `<div class="card"><h3>Spare parts</h3><div class="rows">${d.parts.map(p => `<div class="row"><div class="grow"><div class="t">${p.qty} x ${esc(p.name)}</div><div class="sub">${esc(p.sku || '')} &middot; ${Math.max(0, p.available)} free in stock</div></div>${p.reserved || q.status === 'completed' ? `<span class="tag fill">${q.status === 'completed' ? 'Used' : 'Reserved'}</span>` : p.ok ? '<span class="tag line">In stock</span>' : `<span class="tag hatch">Short, ETA ${p.lead_time_hours}h</span>`}</div>`).join('')}</div></div>` : ''}
    ${mineJob && q.status === 'in_progress' ? `<div class="card hot"><h3>Completion report</h3>
      <label class="f"><span>What did you do?</span><textarea id="notes" placeholder="Root cause, work performed, parts replaced"></textarea></label>
      <div class="f"><span style="display:block;font-weight:600;font-size:14px;margin-bottom:8px">Checklist</span>${CHECK.map((c, i) => `<label style="display:flex;gap:10px;align-items:center;padding:5px 0"><input type="checkbox" class="ck" value="${esc(c)}"> ${c}</label>`).join('')}</div>
      <div class="f"><span style="display:block;font-weight:600;font-size:14px;margin-bottom:8px">Proof of work (photo or PDF)</span><div class="inline-form"><input type="file" id="file" accept="image/*,application/pdf" capture="environment" style="flex:1"><button class="btn" id="up">Upload</button></div></div>
      <button class="btn solid" data-do="submit">Submit for verification</button></div>` : ''}
    ${d.attachments.length ? `<div class="card"><h3>Evidence <span class="count">${d.attachments.length}</span></h3><div class="chips">${d.attachments.map(a => a.mime.startsWith('image') ? `<a href="${fileUrl(a.filename)}" target="_blank" rel="noopener"><img class="thumb" src="${fileUrl(a.filename)}" alt="${esc(a.original_name)}"></a>` : `<a class="btn sm" target="_blank" rel="noopener" href="${fileUrl(a.filename)}">${esc(a.original_name)}</a>`).join('')}</div>${q.completion_notes ? `<p style="margin-top:16px"><b>Report:</b> ${esc(q.completion_notes)}</p>` : ''}${q.checklist?.length ? `<div class="chips" style="margin-top:10px">${q.checklist.map(c => `<span class="tag thin">&#10003; ${esc(c)}</span>`).join('')}</div>` : ''}</div>` : ''}
    <div class="card"><h3>Timeline</h3>
      ${!closed ? `<div class="inline-form" style="margin-bottom:20px"><input type="text" id="note" placeholder="Add a note to the log" maxlength="500"><button class="mic" id="mic" title="Dictate a note" aria-label="Dictate a note">&#127908;</button><button class="btn" id="addnote">Add</button></div>` : ''}
      <div class="tl">${[...d.logs].reverse().map(l => `<div class="ev ${l.type}"><div class="m">${esc(l.message)}</div><div class="w">${esc(l.user_name || 'Hive Mind')} &middot; ${fdate(l.ts)}</div></div>`).join('')}</div></div></div>

  <div class="grid">
    ${sla ? `<div class="card ${sla.probability >= .7 ? 'hot' : ''}"><h3>SLA prediction</h3><div style="display:flex;gap:20px;align-items:center"><div class="ring" style="--p:${Math.round(sla.probability * 100)}"><b>${Math.round(sla.probability * 100)}%</b></div><div><b>${sla.breached ? 'Deadline passed' : sla.probability >= .7 ? 'Likely to be late' : sla.probability >= .4 ? 'Could slip' : 'On track'}</b><div class="sub">Predicted finish ${fdate(sla.predicted_end)}<br>${sla.slack_hours >= 0 ? sla.slack_hours + ' h of slack' : Math.abs(sla.slack_hours) + ' h over'}</div></div></div>
      <div style="margin-top:14px">${sla.factors.map(f => `<div class="row" style="padding:7px 0"><span class="grow">${esc(f.label)}</span><b>+${f.hours} h</b></div>`).join('')}</div></div>` : ''}
    <div class="card"><h3>Impact simulation</h3><div class="sub">If this stays unresolved for</div><div class="big-num" id="hrs">${Math.max(1, Math.ceil(sla?.remaining_hours || 4))} h</div>
      <input type="range" id="slider" min="0" max="48" value="${Math.max(1, Math.ceil(sla?.remaining_hours || 4))}" aria-label="Hours unresolved"><div class="sub" style="margin-top:6px">Estimated loss</div><div class="big-num" id="loss">-</div>
      <p class="sub" style="margin-top:10px">${esc(imp.narrative)}</p><div id="curve" style="margin-top:10px"></div></div>
    <div class="card"><h3>Machine health</h3><div style="display:flex;gap:16px;align-items:center"><div class="ring" style="--p:${d.health.risk}"><b>${d.health.risk}</b></div><div>${lvTag(d.health.level)}<div class="sub" style="margin-top:6px">${d.health.temperature}&deg;C &middot; ${d.health.vibration} mm/s<br>${esc(d.health.recommendation)}</div></div></div></div>
    ${d.candidates.length ? `<div class="card"><h3>Technician match</h3><p class="sub" style="margin-bottom:14px">Skill 35% &middot; Workload 20% &middot; Availability 15% &middot; Distance 15% &middot; Experience 15%</p>
      ${d.candidates.map((c, i) => `<div class="cand ${i === 0 && c.eligible ? 'best' : ''} ${c.eligible ? '' : 'blocked'}"><div class="head"><div class="score">${c.score}</div><div class="grow"><b>${esc(c.name)}</b> ${techTag(c.status)}<div class="sub">${c.distance_km} km (~${c.eta_minutes} min) &middot; ${c.active_jobs}/${c.max_load} jobs &middot; ${c.experience_years} yrs</div></div>${c.technician_id === q.technician_id ? '<span class="tag fill">Assigned</span>' : admin && ['approved', 'assigned'].includes(q.status) ? `<button class="btn sm ${c.eligible ? 'solid' : ''}" data-assign="${c.technician_id}">${c.eligible ? 'Assign' : 'Override'}</button>` : ''}</div>
        <div class="why">${Object.entries(c.breakdown).map(([k, v]) => mrow(k[0].toUpperCase() + k.slice(1), v)).join('')}</div>${c.blockers.length ? `<div class="blk">&#9888; ${esc(c.blockers.join('; '))}</div>` : ''}</div>`).join('')}</div>` : ''}
  </div></div>`;

  return {
    html,
    mount(root) {
      const $ = s => root.querySelector(s), id = q.id;
      const post = (path, body, ok) => act(() => api(`/requests/${id}/${path}`, { method: 'POST', body }), ok);
      const cost = h => h * imp.hourly_loss + Math.max(0, h + imp.overdue_hours) * imp.sla_penalty_per_hour;
      const upd = () => { const h = +$('#slider').value; $('#hrs').textContent = h + ' h'; $('#loss').textContent = inr(cost(h)); };
      $('#slider').oninput = upd; upd(); $('#curve').innerHTML = areaChart(imp.curve.map(c => ({ x: c.hours, y: c.cost })), 420, 180);
      const handlers = {
        approve: async () => { const r = await act(() => api(`/requests/${id}/approve`, { method: 'POST' })); if (r && !r.parts_reserved) toast('Approved. Some parts are missing, so an exception was raised.', true); else if (r) toast('Approved and parts reserved'); },
        reject: async () => { const v = await promptBox('Reject request', 'Reason', { ok: 'Reject' }); if (v) post('reject', { reason: v.v }, 'Request rejected'); },
        auto: () => post('auto-assign', {}, 'Technician assigned'),
        start: () => post('start', {}, 'Work started'),
        dropout: async () => { const v = await modal(`<h3>Report dropout</h3><label class="f"><span>Reason</span><input name="reason" type="text" placeholder="Example: vehicle breakdown"></label><label style="display:flex;gap:10px;align-items:center;margin-bottom:18px"><input type="checkbox" name="off"> Mark me off duty too</label><div class="acts"><button class="btn dim" data-close="cancel">Cancel</button><button class="btn solid" data-close="ok">Report dropout</button></div>`); if (v) { const r = await act(() => api(`/requests/${id}/dropout`, { method: 'POST', body: { reason: v.reason, off_duty: v.off } }), 'Dropout reported. Operations has been alerted.'); } },
        verify: async () => { const ok = await confirmBox('Verify and close', 'Confirm the work is complete and the machine is running. This closes the request and updates the machine history.', 'Verify and close'); if (ok) post('verify', { approve: true }, 'Verified. Request closed.'); },
        sendback: async () => { const v = await promptBox('Send back to technician', 'What still needs work?', { ok: 'Send back' }); if (v) post('verify', { approve: false, comment: v.v }, 'Sent back to technician'); },
        submit: () => post('submit', { notes: $('#notes').value, checklist: [...root.querySelectorAll('.ck:checked')].map(c => c.value) }, 'Submitted for verification')
      };
      root.querySelectorAll('[data-do]').forEach(b => b.addEventListener('click', () => handlers[b.dataset.do]()));
      root.querySelectorAll('[data-res]').forEach(b => b.addEventListener('click', () => act(() => api(`/requests/${id}/exceptions/${b.dataset.res}/resolve`, { method: 'POST' }), 'Exception resolved')));
      root.querySelectorAll('[data-assign]').forEach(b => b.addEventListener('click', async () => {
        const tid = +b.dataset.assign;
        try { await api(`/requests/${id}/assign`, { method: 'POST', body: { technician_id: tid } }); toast('Technician assigned'); nav.reload(); }
        catch (e) {
          if (e.data?.conflict) { if (await confirmBox('Resolve conflict', esc(e.message) + ' Assign anyway?', 'Assign anyway')) act(() => api(`/requests/${id}/assign`, { method: 'POST', body: { technician_id: tid, force: true } }), 'Assigned with override'); }
          else toast(e.message, true);
        }
      }));
      const note = $('#note');
      if (note) {
        const send = () => { const m = note.value.trim(); if (m) act(() => api(`/requests/${id}/log`, { method: 'POST', body: { message: m } })); };
        $('#addnote').onclick = send; note.onkeydown = e => { if (e.key === 'Enter') send(); }; attachMic($('#mic'), note);
      }
      const up = $('#up');
      if (up) up.onclick = async () => {
        const file = $('#file').files[0]; if (!file) return toast('Choose a photo or PDF first.', true);
        const form = new FormData(); form.append('file', file);
        act(() => api(`/requests/${id}/attachments`, { form, method: 'POST' }), 'Evidence uploaded');
      };
    }
  };
}
