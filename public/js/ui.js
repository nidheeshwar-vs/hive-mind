// Presentation helpers shared by all views.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const inr = n => 'Rs ' + Math.round(n).toLocaleString('en-IN');
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return Math.floor(s / 86400) + ' d ago';
}
export const fdate = iso => iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
export function due(iso) {
  const h = (new Date(iso).getTime() - Date.now()) / 36e5;
  if (h < 0) return `${Math.abs(h) < 1 ? Math.round(-h * 60) + ' min' : Math.round(-h * 10) / 10 + ' h'} overdue`;
  return h < 1 ? `${Math.round(h * 60)} min left` : `${Math.round(h * 10) / 10} h left`;
}

const PRI = { critical: ['Critical', 'tag fill'], high: ['High', 'tag line'], medium: ['Medium', 'tag thin'], low: ['Low', 'tag dash'] };
export const priTag = p => `<span class="${PRI[p][1]}">${p === 'critical' ? '<i class="dot"></i>' : ''}${PRI[p][0]}</span>`;
const ST = {
  pending_approval: ['Awaiting approval', 'tag line'], approved: ['Approved', 'tag thin'], assigned: ['Assigned', 'tag thin'],
  in_progress: ['In progress', 'tag fill'], awaiting_verification: ['Needs verification', 'tag line'], completed: ['Completed', 'tag dash'], rejected: ['Rejected', 'tag dash']
};
export const stTag = s => `<span class="${ST[s][1]}">${ST[s][0]}</span>`;
export const stLabel = s => ST[s][0];
const MS = { operational: ['Operational', 'tag thin'], degraded: ['Degraded', 'tag line'], down: ['Down', 'tag hatch'], maintenance: ['In maintenance', 'tag fill'] };
export const machTag = s => `<span class="${(MS[s] || MS.operational)[1]}">${(MS[s] || MS.operational)[0]}</span>`;
const LV = { healthy: ['Healthy', 'tag thin'], watch: ['Watch', 'tag line'], critical: ['Critical', 'tag hatch'] };
export const lvTag = l => `<span class="${LV[l][1]}">${LV[l][0]}</span>`;
export const techTag = s => `<span class="${s === 'available' ? 'tag fill' : s === 'busy' ? 'tag line' : 'tag dash'}">${{ available: 'Available', busy: 'On a job', off: 'Off duty' }[s]}</span>`;
export const excLabel = t => ({ tech_dropout: 'Technician dropout', part_unavailable: 'Part unavailable', sla_breach: 'SLA breached' }[t]);

export const meter = (v, hatch) => `<div class="meter ${hatch ? 'hatch' : ''}"><i style="width:${clamp(v, 0, 100)}%"></i></div>`;
export const mrow = (label, v) => `<div class="mrow"><span>${label}</span>${meter(v)}<span>${Math.round(v)}</span></div>`;
export const initials = n => n.split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();

export function spark(vals, h = 56) {
  if (!vals || vals.length < 2) return '<svg class="spark"></svg>';
  const min = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1, w = 200;
  const pts = vals.map((v, i) => [i / (vals.length - 1) * w, h - 6 - (v - min) / rng * (h - 14)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path class="a" d="${d} L${w} ${h} L0 ${h}Z"/><path class="l" d="${d}"/></svg>`;
}
export function barChart(rows) { // rows: [{label, a, b}] a=created (outline), b=completed (solid)
  const max = Math.max(1, ...rows.flatMap(r => [r.a, r.b]));
  return `<div style="display:flex;align-items:flex-end;gap:14px;height:170px">${rows.map(r => `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:8px;height:100%;justify-content:flex-end">
      <div style="display:flex;align-items:flex-end;gap:4px;height:130px;width:100%;justify-content:center">
        <div title="Created ${r.a}" style="width:38%;height:${Math.max(4, r.a / max * 100)}%;border:1.5px solid var(--y);border-radius:8px 8px 0 0"></div>
        <div title="Completed ${r.b}" style="width:38%;height:${Math.max(4, r.b / max * 100)}%;background:var(--y);border-radius:8px 8px 0 0"></div>
      </div><span class="sub">${r.label}</span></div>`).join('')}</div>
    <div class="sub" style="margin-top:10px;display:flex;gap:16px"><span>&#9633; Created</span><span>&#9632; Completed</span></div>`;
}
export function areaChart(points, w = 560, h = 220) { // [{x,y}] cost curve
  const maxY = Math.max(...points.map(p => p.y)) || 1, maxX = Math.max(...points.map(p => p.x)) || 1;
  const P = points.map(p => [40 + p.x / maxX * (w - 56), h - 28 - p.y / maxY * (h - 50)]);
  const d = P.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto"><path d="${d} L${P[P.length - 1][0]} ${h - 28} L40 ${h - 28}Z" fill="rgba(255,214,10,.14)"/>
    <path d="${d}" fill="none" stroke="#FFD60A" stroke-width="3"/><line x1="40" y1="${h - 28}" x2="${w - 16}" y2="${h - 28}" stroke="rgba(255,214,10,.4)"/>
    ${points.map((p, i) => `<text x="${P[i][0]}" y="${h - 8}" fill="#FFD60A" font-size="11" text-anchor="middle" opacity=".7">${p.x}h</text>`).join('')}</svg>`;
}

// ---- Toasts & modals ----
export function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), err ? 6000 : 3800);
}
export function modal(html) {
  return new Promise(resolve => {
    const host = document.getElementById('modal-host');
    host.innerHTML = `<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
    const close = v => { host.innerHTML = ''; document.removeEventListener('keydown', esc_); resolve(v); };
    const esc_ = e => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', esc_);
    host.querySelector('.modal-bg').addEventListener('click', e => { if (e.target.classList.contains('modal-bg')) close(null); });
    host.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => {
      const vals = {}; host.querySelectorAll('[name]').forEach(i => vals[i.name] = i.type === 'checkbox' ? i.checked : i.value);
      close(b.dataset.close === 'ok' ? vals : null);
    }));
    const first = host.querySelector('input,textarea,select'); if (first) first.focus();
  });
}
export const confirmBox = (title, text, ok = 'Confirm') =>
  modal(`<h3>${esc(title)}</h3><p class="muted" style="margin-bottom:22px">${text}</p><div class="acts"><button class="btn dim" data-close="cancel">Cancel</button><button class="btn solid" data-close="ok">${esc(ok)}</button></div>`);
export const promptBox = (title, label, { type = 'text', value = '', ok = 'Save', placeholder = '', extra = '' } = {}) =>
  modal(`<h3>${esc(title)}</h3><label class="f"><span>${esc(label)}</span><input name="v" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}"></label>${extra}<div class="acts"><button class="btn dim" data-close="cancel">Cancel</button><button class="btn solid" data-close="ok">${esc(ok)}</button></div>`);
