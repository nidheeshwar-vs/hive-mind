// App shell, router, realtime wiring.
import { api, state, setSession, connectEvents, disconnectEvents, live } from './api.js';
import { nav } from './nav.js';
import { esc, toast, ago, initials } from './ui.js';
import * as Land from './landing.js';
import * as A from './views-a.js';
import * as B from './views-b.js';

const root = document.getElementById('root');
const ROUTES = [
  ['/', Land.home], ['/login', Land.login], ['/passport/:code', Land.passport],
  ['/app/dashboard', A.dashboard], ['/app/requests', A.requests], ['/app/requests/new', A.newRequest], ['/app/requests/:id', A.requestDetail],
  ['/app/machines', B.machines], ['/app/machines/:id', B.machineDetail], ['/app/technicians', B.technicians], ['/app/parts', B.parts],
  ['/app/map', B.map], ['/app/impact', B.impact], ['/app/audit', B.audit]
];
const NAV = {
  admin: [['dashboard', 'Control room'], ['requests', 'Requests'], ['machines', 'Machines'], ['technicians', 'Technicians'], ['parts', 'Parts'], ['map', 'Map'], ['impact', 'Impact lab'], ['audit', 'Audit']],
  technician: [['dashboard', 'My jobs'], ['requests', 'Requests'], ['machines', 'Machines'], ['map', 'Map']],
  customer: [['dashboard', 'My site'], ['requests', 'Requests'], ['machines', 'Machines'], ['impact', 'Impact lab']]
};

function match(path) {
  for (const [pat, fn] of ROUTES) {
    const keys = [], re = new RegExp('^' + pat.replace(/:([a-z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
    const m = path.match(re);
    if (m) return { fn, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}
function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

let shellFor = null, token = 0;
async function ensureUser() {
  if (state.user || !state.token) return;
  try { state.user = (await api('/auth/me')).user; } catch { setSession(null, null); }
}
function shell() {
  const u = state.user;
  root.innerHTML = `<header class="top"><div class="top-in"><a class="brand" href="#/"><svg><use href="#hm-logo"/></svg>Hive Mind</a>
    <nav class="nav" id="nav">${NAV[u.role].map(([k, l]) => `<a href="#/app/${k}" data-k="${k}">${l}</a>`).join('')}</nav>
    <span class="right"></span><button class="bell" id="bell" aria-label="Notifications"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg><b id="bcount" class="hide">0</b></button>
    <div class="me"><div class="avatar">${initials(u.name)}</div><div><span>${esc(u.name)}</span><small>${u.role === 'admin' ? 'Operations' : u.role[0].toUpperCase() + u.role.slice(1)}</small></div></div>
    <button class="btn sm dim" id="out">Sign out</button></div></header><main class="wrap" id="view"></main><div id="drawer-host"></div>`;
  document.getElementById('out').onclick = () => { disconnectEvents(); setSession(null, null); shellFor = null; location.hash = '#/'; };
  document.getElementById('bell').onclick = toggleDrawer;
  shellFor = u.id; loadBell();
}
async function loadBell() {
  try { const n = await api('/notifications'); setBell(n.unread); window._notes = n.items; } catch {}
}
function setBell(n) { const b = document.getElementById('bcount'); if (!b) return; b.textContent = n; b.classList.toggle('hide', !n); }
async function toggleDrawer() {
  const host = document.getElementById('drawer-host');
  if (host.innerHTML) { host.innerHTML = ''; return; }
  await loadBell(); const items = window._notes || [];
  host.innerHTML = `<div class="drawer">${items.length ? items.map(n => `<a href="${n.link || '#'}" class="${n.read ? '' : 'unread'}"><div>${esc(n.message)}</div><div class="sub">${ago(n.ts)}</div></a>`).join('') : '<div class="n sub">No notifications yet.</div>'}</div>`;
  host.querySelectorAll('a').forEach(a => a.addEventListener('click', () => host.innerHTML = ''));
  api('/notifications/read', { method: 'POST' }).then(() => setBell(0));
}

async function route(soft) {
  const my = ++token, { path, query } = parseHash();
  await ensureUser();
  const hit = match(path);
  if (!hit) { location.hash = '#/'; return; }
  const isApp = path.startsWith('/app');
  if (isApp && !state.user) { location.hash = '#/login'; return; }
  document.getElementById('drawer-host') && (document.getElementById('drawer-host').innerHTML = '');
  let out;
  try { out = await hit.fn({ ...hit.params, query }); }
  catch (e) { out = { html: `<div class="card empty"><div class="display">Something broke</div><p>${esc(e.message)}</p><p style="margin-top:14px"><a class="btn" href="#/app/dashboard">Back to dashboard</a></p></div>` }; }
  if (my !== token) return; // a newer navigation won
  if (out.standalone || !isApp) { shellFor = null; root.innerHTML = out.html; document.body.classList.remove('in-app'); scrollTo(0, 0); }
  else {
    if (shellFor !== state.user.id || !document.getElementById('view')) shell();
    const y = scrollY, v = document.getElementById('view'); v.innerHTML = out.html;
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', path === '/app/' + a.dataset.k || path.startsWith('/app/' + a.dataset.k + '/')));
    soft ? scrollTo(0, y) : scrollTo(0, 0);
  }
  if (out.mount) out.mount(root);
  if (state.user && state.token && !live()) startEvents();
}
nav.reload = () => route(true);

// ---- Realtime
let rt;
function startEvents() {
  connectEvents(() => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      const el = document.activeElement, typing = el && /INPUT|TEXTAREA|SELECT/.test(el.tagName);
      if (typing || document.querySelector('.modal-bg') || location.hash.includes('/requests/new')) return;
      if (location.hash.startsWith('#/app')) route(true);
    }, 500);
  }, n => { toast(n.message); loadBell(); });
}

// ---- Cursor dot
const cur = document.getElementById('cursor');
addEventListener('pointermove', e => { cur.style.transform = `translate(${e.clientX - 7}px, ${e.clientY - 7}px)`; });
addEventListener('pointerover', e => cur.classList.toggle('big', !!e.target.closest('a,button,.chip,select,input[type=range]')));

addEventListener('hashchange', () => route(false));
(async () => { await route(false); })();
addEventListener('hivemind:intro-complete', () => document.body.classList.remove('is-intro'));
