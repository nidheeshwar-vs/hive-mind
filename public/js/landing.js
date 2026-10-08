// Public pages: landing, login/register, machine passport.
import { api, setSession, state } from './api.js';
import { esc, meter, mrow, lvTag, machTag, fdate } from './ui.js';

const FLOW = ['Detect', 'Prioritize', 'Assign', 'Equip', 'Execute', 'Predict', 'Prevent'];

export async function home() {
  let st = { machines: 0, sites: 0, technicians: 0, completed: 0 };
  try { st = await api('/public/stats'); } catch {}
  const loggedIn = !!state.token;
  const marquee = FLOW.map(f => `<span>${f}</span><span class="sep">&#9679;</span>`).join('');
  const card = (n, title, copy, viz) => `<article class="stack-card"><div class="big">${n}</div><div><h3>${title}</h3><p>${copy}</p></div><div class="viz"><div class="viz-box">${viz}</div></div></article>`;
  const html = `<div class="land">
  <nav class="l-nav"><a class="brand" href="#/"><svg><use href="#hm-logo"/></svg>Hive Mind</a>
    <div class="links"><a class="hd" href="#how" data-scroll="how">How it works</a><a class="hd" href="#beyond" data-scroll="beyond">Features</a><a class="btn sm solid" href="${loggedIn ? '#/app/dashboard' : '#/login'}">${loggedIn ? 'Open control room' : 'Sign in'}</a></div></nav>

  <header class="hero" id="hero"><canvas id="swarm" aria-hidden="true"></canvas>
    <div class="hint" id="hint">Move your cursor and the swarm follows.<br>Click to dispatch four to M-104.</div>
    <h1><span>Hive</span><span>Mind</span></h1>
    <div class="hero-meta"><p>One platform for every machine, technician and spare part across all your sites.</p>
      <div class="cta"><a class="btn solid lg" href="${loggedIn ? '#/app/dashboard' : '#/login'}">Enter the hive <span class="arr">&rarr;</span></a><a class="btn lg" href="#how" data-scroll="how">See how it works</a></div></div>
  </header>

  <div class="marquee" aria-hidden="true"><div>${marquee}${marquee}${marquee}${marquee}</div></div>

  <section class="sec" id="how"><p class="statement reveal">Machines don't wait for <em>spreadsheets.</em> Hive Mind turns chats, sheets and phone calls into one swarm that moves together.</p></section>

  <section class="sec" style="padding-top:0"><div class="stack">
    ${card('1', 'The right technician, first time', 'Skill, availability, workload, distance and experience are scored for every technician. You see exactly why one ranks above another.',
      `<div class="mrow"><span>Match</span><span></span><span></span></div>${mrow('Skill', 100)}${mrow('Workload', 78)}${mrow('Distance', 91)}${mrow('Experience', 84)}<div class="big-num" style="margin-top:10px">94</div>`)}
    ${card('2', 'Fix it before it stops', 'Temperature, vibration, runtime and service history become a risk score and a countdown to failure for every machine.',
      `${mrow('Temperature', 72)}${mrow('Vibration', 69)}${mrow('Runtime', 95)}${mrow('History', 50)}<div class="big-num" style="margin-top:10px">74 <span style="font-size:22px;font-family:var(--body)">risk, ~9 h to critical</span></div>`)}
    ${card('3', 'Parts reserved before the van leaves', 'Every request checks stock. Approval reserves the parts. If something is missing, an exception is raised and clears itself the moment stock arrives.',
      `<div class="row"><span class="grow">Intake valve</span><span class="tag fill">Reserved</span></div><div class="row"><span class="grow">Bearing set x2</span><span class="tag fill">Reserved</span></div><div class="row"><span class="grow">Chiller coil</span><span class="tag hatch">Short, ETA 120 h</span></div>`)}
    ${card('4', 'Know it will be late before it is', 'Travel time, queue, parts waiting and work remaining roll into a probability that each request misses its deadline.',
      `<div style="display:flex;align-items:center;gap:20px"><div class="ring" style="--p:82"><b>82%</b></div><div><b>SR-0016</b><div style="font-weight:400">Likely to miss SLA by 1.2 h</div></div></div>`)}
    ${card('5', 'See the cost of waiting', 'Slide the delay and watch downtime, dependent lines and SLA penalties turn into a rupee figure your manager understands.',
      `<div class="big-num">Rs 3.4L</div><div style="font-weight:400;margin:6px 0 14px">after 4 hours without M-104</div>${meter(55)}`)}
  </div></section>

  <section class="sec" id="beyond"><h2 class="statement reveal" style="margin-bottom:60px">Built for the messy <em>real world</em></h2>
    <div class="beyond reveal">
      <div><h4>Dropout recovery</h4><p>A technician cancels. The next best match is one click away, with ETA.</p></div>
      <div><h4>Conflict radar</h4><p>Overbooked technicians, double bookings across sites, duplicate requests and parts shortages, flagged before they bite.</p></div>
      <div><h4>Preflight checks</h4><p>Machine, skills, parts and duplicates are validated while a request is being written.</p></div>
      <div><h4>Proof of work</h4><p>Photos, a checklist and customer sign-off before anything closes.</p></div>
      <div><h4>Tamper-evident audit</h4><p>Every action is chained with SHA-256 hashes. Edit history and the chain breaks.</p></div>
      <div><h4>Machine passport</h4><p>Scan a QR on the machine for its status, service history and health. No login needed.</p></div>
    </div></section>

  <section class="band"><div class="band-in">
    <div><div class="n">${st.machines}</div><div class="l">Machines watched</div></div><div><div class="n">${st.sites}</div><div class="l">Sites connected</div></div>
    <div><div class="n">${st.technicians}</div><div class="l">Field technicians</div></div><div><div class="n">${st.completed}</div><div class="l">Jobs verified and closed</div></div></div></section>

  <section class="sec"><p class="statement reveal" style="font-size:clamp(28px,4vw,60px)">One loop, from first alarm to prevention.</p>
    <div class="flow reveal">${FLOW.map(f => `<span>${f}</span>`).join('')}</div></section>

  <section class="cta-final"><h2 class="reveal">Ready when<br>the next alarm is.</h2>
    <a class="btn solid lg" href="${loggedIn ? '#/app/dashboard' : '#/login'}">Enter the hive <span class="arr">&rarr;</span></a></section>
  <footer class="foot"><span>Hive Mind</span><span>Built for DataQuest 3.0</span><span class="right">Equipment service, coordinated.</span></footer></div>`;
  return { html, mount: mountLanding, standalone: true };
}

function mountLanding(root) {
  root.querySelectorAll('[data-scroll]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); document.getElementById(a.dataset.scroll).scrollIntoView({ behavior: 'smooth' }); }));
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .15 });
  root.querySelectorAll('.reveal').forEach(el => io.observe(el));
  swarm(root.querySelector('#swarm'), root.querySelector('#hero'));
}

// Hero moment: a swarm of hexagons that follows the cursor; click dispatches four to "M-104".
function swarm(cv, hero) {
  const ctx = cv.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W, H, dpr = Math.min(devicePixelRatio || 1, 2), mouse = { x: -999, y: -999, on: false }, raf, dispatchUntil = 0, picked = [];
  const N = innerWidth < 700 ? 38 : 80;
  const bees = Array.from({ length: N }, () => ({ x: Math.random() * 1000, y: Math.random() * 800, vx: 0, vy: 0, r: 4 + Math.random() * 6, a: Math.random() * 6 }));
  const size = () => { const b = hero.getBoundingClientRect(); W = b.width; H = b.height; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  size(); bees.forEach(b => { b.x = Math.random() * W; b.y = Math.random() * H; });
  const target = () => ({ x: W * .8, y: H * .28 });
  const hex = (x, y, r, rot) => { ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = rot + i * Math.PI / 3; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); };
  hero.addEventListener('pointermove', e => { const b = hero.getBoundingClientRect(); mouse = { x: e.clientX - b.left, y: e.clientY - b.top, on: true }; });
  hero.addEventListener('pointerleave', () => mouse.on = false);
  hero.addEventListener('click', e => {
    if (e.target.closest('a,button')) return;
    const t = target();
    picked = [...bees].sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y)).slice(0, 4);
    dispatchUntil = performance.now() + 2600;
    const h = document.getElementById('hint'); if (h) h.innerHTML = 'Four technicians dispatched.<br>ETA 38 minutes.';
  });
  addEventListener('resize', size);
  function frame(t) {
    ctx.clearRect(0, 0, W, H);
    const tg = target(), dis = t < dispatchUntil;
    // target machine
    ctx.strokeStyle = 'rgba(255,214,10,.55)'; ctx.lineWidth = 1.5; hex(tg.x, tg.y, 34 + Math.sin(t / 300) * (dis ? 5 : 2), 0); ctx.stroke();
    ctx.fillStyle = 'rgba(255,214,10,.9)'; ctx.font = '600 13px "Space Grotesk", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('M-104', tg.x, tg.y + 5);
    bees.forEach(b => {
      b.a += .03;
      let tx, ty, k = .0009;
      if (dis && picked.includes(b)) { tx = tg.x + Math.cos(b.a * 2) * 46; ty = tg.y + Math.sin(b.a * 2) * 46; k = .004; }
      else if (mouse.on) { tx = mouse.x + Math.cos(b.a + b.r) * (60 + b.r * 9); ty = mouse.y + Math.sin(b.a * 1.3 + b.r) * (60 + b.r * 9); k = .0016; }
      else { tx = b.x + Math.cos(b.a) * 30; ty = b.y + Math.sin(b.a * 1.1) * 30; k = .0003; }
      b.vx += (tx - b.x) * k * 16; b.vy += (ty - b.y) * k * 16; b.vx *= .9; b.vy *= .9;
      if (reduce) { b.vx *= .2; b.vy *= .2; }
      b.x += b.vx; b.y += b.vy;
      ctx.fillStyle = picked.includes(b) && dis ? '#FFD60A' : 'rgba(255,214,10,' + (.25 + b.r / 14) + ')';
      hex(b.x, b.y, b.r, b.a * .4); ctx.fill();
    });
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  // stop when the landing page is replaced
  const mo = new MutationObserver(() => { if (!document.body.contains(cv)) { cancelAnimationFrame(raf); removeEventListener('resize', size); mo.disconnect(); } });
  mo.observe(document.getElementById('root'), { childList: true });
}

// ---------------------------------------------------------------- Login / register
export async function login() {
  if (state.token) { location.hash = '#/app/dashboard'; return { html: '' }; }
  const meta = await api('/meta');
  const demos = [['Operations admin', 'admin@hivemind.io', 'Admin@123'], ['Customer at Site A', 'customer@sitea.com', 'Cust@123'], ['Technician: Arjun', 'arjun@hivemind.io', 'Tech@123'], ['Technician: Faizal', 'faizal@hivemind.io', 'Tech@123']];
  const html = `<div class="auth">
    <div class="auth-art"><a class="brand" href="#/"><svg><use href="#hm-logo"/></svg>Hive Mind</a><svg class="big"><use href="#hm-logo"/></svg>
      <div><div class="display">Back<br>to the<br>hive.</div><p style="max-width:34ch;font-weight:500;margin-top:20px">Your machines, technicians and spare parts are waiting.</p></div></div>
    <div class="auth-form"><div class="tabs"><button class="chip on" data-tab="in">Sign in</button><button class="chip" data-tab="up">Create customer account</button></div>
      <h2 id="auth-title">Sign in</h2><div id="auth-err"></div>
      <form id="f-in"><label class="f"><span>Email</span><input type="email" name="email" autocomplete="username" required></label>
        <label class="f"><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>
        <button class="btn solid lg" type="submit" style="width:100%">Sign in <span class="arr">&rarr;</span></button></form>
      <form id="f-up" class="hide"><label class="f"><span>Your name</span><input type="text" name="name" required></label>
        <label class="f"><span>Email</span><input type="email" name="email" required></label>
        <label class="f"><span>Password (6+ characters)</span><input type="password" name="password" minlength="6" required></label>
        <label class="f"><span>Your site</span><select name="site_id">${meta.sites.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
        <button class="btn solid lg" type="submit" style="width:100%">Create account <span class="arr">&rarr;</span></button></form>
      <div class="demo"><div class="sub" style="margin-bottom:6px">Demo accounts. Tap one to fill the form.</div>
        ${demos.map(d => `<button type="button" data-email="${d[1]}" data-pw="${d[2]}"><b>${d[0]}</b><span class="sub">${d[1]}</span></button>`).join('')}</div>
    </div></div>`;
  return {
    html, standalone: true,
    mount(root) {
      const err = m => root.querySelector('#auth-err').innerHTML = m ? `<div class="err">${esc(m)}</div>` : '';
      root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
        const up = b.dataset.tab === 'up'; err('');
        root.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b));
        root.querySelector('#f-in').classList.toggle('hide', up); root.querySelector('#f-up').classList.toggle('hide', !up);
        root.querySelector('#auth-title').textContent = up ? 'Join your site' : 'Sign in';
      }));
      root.querySelectorAll('.demo button').forEach(b => b.addEventListener('click', () => {
        const f = root.querySelector('#f-in'); f.email.value = b.dataset.email; f.password.value = b.dataset.pw; f.querySelector('button').focus();
      }));
      const submit = (id, path) => root.querySelector(id).addEventListener('submit', async e => {
        e.preventDefault(); err('');
        const fd = Object.fromEntries(new FormData(e.target)); if (fd.site_id) fd.site_id = +fd.site_id;
        const btn = e.target.querySelector('button'); btn.disabled = true;
        try { const r = await api(path, { method: 'POST', body: fd }); setSession(r.token, r.user); location.hash = '#/app/dashboard'; }
        catch (ex) { err(ex.message); btn.disabled = false; }
      });
      submit('#f-in', '/auth/login'); submit('#f-up', '/auth/register');
    }
  };
}

// ---------------------------------------------------------------- Public machine passport (QR target)
export async function passport({ code }) {
  let m;
  try { m = await api('/public/passport/' + encodeURIComponent(code)); }
  catch { return { standalone: true, html: `<div class="pass"><a class="brand" href="#/"><svg><use href="#hm-logo"/></svg>Hive Mind</a><div class="empty" style="margin-top:60px"><div class="display">Machine not found</div><p>Check the code on the QR label.</p></div></div>` }; }
  const html = `<div class="pass"><a class="brand" href="#/"><svg><use href="#hm-logo"/></svg>Hive Mind</a>
    <p class="sub" style="margin-top:36px">Machine passport</p>
    <h1 class="display" style="font-size:clamp(80px,16vw,200px)">${esc(m.code)}</h1>
    <p style="font-size:24px;font-weight:500;margin:6px 0 20px">${esc(m.name)}</p>
    <div class="chips" style="margin-bottom:26px">${machTag(m.status)}${lvTag(m.health.level)}<span class="tag thin">${esc(m.type)}</span><span class="tag thin">${esc(m.site)}</span></div>
    <div class="grid g3" style="margin-bottom:18px">
      <div class="card kpi"><div class="n">${m.health.risk}</div><div class="l">Risk score</div><div class="s">${esc(m.health.recommendation)}</div></div>
      <div class="card kpi"><div class="n">${m.open_requests}</div><div class="l">Open service requests</div></div>
      <div class="card kpi"><div class="n" style="font-size:44px;padding-top:14px">${esc(m.last_service || '-')}</div><div class="l">Last serviced</div><div class="s">Warranty until ${esc(m.warranty_until || '-')}</div></div></div>
    <div class="card"><h3>Service history</h3>${m.history.length ? `<div class="rows">${m.history.map(h => `<div class="row"><span class="tag thin">${esc(h.code)}</span><span class="grow t">${esc(h.title)}</span><span class="sub">${fdate(h.completed_at)}</span></div>`).join('')}</div>` : '<p class="muted">No completed services yet.</p>'}</div>
    <div style="margin-top:30px"><a class="btn solid" href="#/login">Sign in to report a problem</a></div></div>`;
  return { html, standalone: true };
}
