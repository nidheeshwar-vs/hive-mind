// Intro animation: pieces assemble into the Hive Mind "H", the black screen splits open and reveals the site.
// Plays once per browser session; respects prefers-reduced-motion.
(function () {
  const body = document.body;
  const done = () => { body.classList.remove('is-intro'); ['pl', 'pr', 'stage'].forEach(id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; }); window.dispatchEvent(new CustomEvent('hivemind:intro-complete')); };
  if (sessionStorage.getItem('hm-intro') === '1') return done();
  sessionStorage.setItem('hm-intro', '1');

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const K = reduce ? 0.3 : 1;
  const pieces = [...document.querySelectorAll('.piece')];
  const sweep = document.getElementById('sweep'), pl = document.getElementById('pl'), pr = document.getElementById('pr');
  const CENTER = { x: 627.5, y: 547 };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ease = 'cubic-bezier(.16, 1, .3, 1)', easeBack = 'cubic-bezier(.7, 0, .84, 0)', easeSoft = 'cubic-bezier(.65, 0, .35, 1)', easeSplit = 'cubic-bezier(.77, 0, .18, 1)';
  const geo = pieces.map(p => { const b = p.getBBox(); const dx = b.x + b.width / 2 - CENTER.x, dy = b.y + b.height / 2 - CENTER.y; const len = Math.hypot(dx, dy) || 1; return { ux: dx / len, uy: dy / len }; });
  const spin = [-38, 26, 34, 0, 30, -24, -30, 44], dist = [300, 300, 320, 0, 300, 300, 330, 340], delay = [0, 140, 280, 0, 90, 230, 370, 470];
  const away = i => ({ opacity: 0, transform: `translate(${geo[i].ux * dist[i] * K}px, ${geo[i].uy * dist[i] * K}px) rotate(${spin[i] * K}deg) scale(${1 - .45 * K})` });
  const home = { opacity: 1, transform: 'translate(0px,0px) rotate(0deg) scale(1)' };
  const play = (el, frames, opts) => el.animate(frames, Object.assign({ fill: 'both' }, opts));

  async function intro() {
    pieces.forEach((p, i) => { if (i !== 3) play(p, [away(i), home], { duration: 1500, delay: delay[i] + 250, easing: ease }); });
    const coreStart = 1750;
    play(pieces[3], [{ opacity: 0, transform: 'scale(.15, .5)' }, { opacity: 1, transform: 'scale(1.06, 1.06)', offset: .7 }, { opacity: 1, transform: 'scale(1, 1)' }], { duration: 900, delay: coreStart, easing: ease });
    play(sweep, [{ opacity: 0, transform: 'skewX(-18deg) translateX(0px)' }, { opacity: .55, offset: .2 }, { opacity: .55, offset: .8 }, { opacity: 0, transform: 'skewX(-18deg) translateX(720px)' }], { duration: 600, delay: coreStart + 700, easing: easeSoft });
    await sleep(coreStart + 900 + 600);
    const outDelay = [150, 90, 30, 0, 120, 60, 0, 45];
    pieces.forEach((p, i) => {
      if (i === 3) play(p, [home, { opacity: 0, transform: 'scale(.15, .5)' }], { duration: 450, easing: easeBack });
      else play(p, [home, away(i)], { duration: 850, delay: 120 + outDelay[i], easing: easeBack });
    });
    await sleep(850 + 120 + 150 + 100);
    play(pl, [{ transform: 'translateX(0)' }, { transform: 'translateX(-101%)' }], { duration: 1100, easing: easeSplit });
    play(pr, [{ transform: 'translateX(0)' }, { transform: 'translateX(101%)' }], { duration: 1100, easing: easeSplit });
    await sleep(1100);
    done();
  }
  requestAnimationFrame(() => requestAnimationFrame(intro));
  // Let people skip it
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && body.classList.contains('is-intro')) done(); }, { once: true });
})();
