// Copyright (c) 2026 Mohamed. All rights reserved. See LICENSE.
// The Blip website: every Sprout here is the real sprout.js (loaded before this file) with the app's own options.
'use strict';
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = s => document.querySelector(s);
const MAC = /mac|iphone|ipad/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');
const wait = ms => new Promise(r => setTimeout(r, ms));
// A group of delayed steps that can all be cancelled at once.
function timers() {
  const s = new Set();
  return { later(fn, ms) { const t = setTimeout(() => { s.delete(t); fn(); }, ms); s.add(t); }, cancel() { s.forEach(clearTimeout); s.clear(); } };
}
// One line in a Claude chat.
function addLine(chat, cls, html) { const el = document.createElement('div'); el.className = cls; el.innerHTML = html; chat.appendChild(el); return el; }
// Allow and Deny greyed out once answered.
const lockOpts = root => root.querySelectorAll('.opt').forEach(b => { b.disabled = true; b.classList.remove('pulse'); });
// Same Sprout options as the app (app/src/main.js): bubble beside the body, the peek at 32.
const APP = { bubbleBeside: true, handlePress: false, peekSize: 32, settings: { lookRange: 1.75 } };
// A Sprout centred on its slot: the canvas is sized to Sprout and `centre` (the canvas, or its slot) shifted left by half its width.
// Extra settings are added to the app's, not put in their place.
function makeSprout(canvas, size, extra = {}, centre = canvas) {
  const box = BlipSprout.canvasSize(size);
  Object.assign(canvas.style, { width: box.width + 'px', height: box.height + 'px' });
  centre.style.marginLeft = -box.width / 2 + 'px';
  return BlipSprout.create(canvas, Object.assign({ size }, APP, extra, { settings: Object.assign({}, APP.settings, extra.settings) }));
}
// Call on() when el is at least `t` in view, and off() when it leaves.
function inView(el, on, off, t = .35) { new IntersectionObserver(e => e[0].isIntersecting ? on() : off && off(), { threshold: t }).observe(el); }

// ---------- Logo: a tiny live Sprout. Its layout box is cut to the head (no antenna), so it lines up with the nav ----------
(function () {
  const c = $('#logo-sprout'), size = 30, box = BlipSprout.canvasSize(size);
  Object.assign(c.style, { width: box.width + 'px', height: box.height + 'px' });
  const s = BlipSprout.create(c, { size, bubble: false, settings: { ...APP.settings, bounce: .4 } });
  s.setState('working');
  // Head geometry from sprout.js: 75 units per size, head ry 46 and rx 40 around cy -4, drawn at 60% of the canvas height.
  const u = size / 75, cy = box.height * .6 - 4 * u, ry = 46 * u, rx = 40 * u;
  c.style.margin = `${-(cy - ry)}px ${-(box.width / 2 - rx)}px ${-(box.height - cy - ry)}px`;
})();

// ---------- Sticky nav: frosted once the page moves under it ----------
(function () {
  const bar = $('#nav-bar'), set = () => bar.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', set, { passive: true }); set();
})();

// ---------- "Get Blip" and the floating pill: dim the page, lift the install card, and draw an arrow from the button to it ----------
(function () {
  const target = $('#install'), card = target.querySelector('.install'), spot = $('#spot'), flow = $('#flow'), bar = $('#nav-bar');
  const T = timers();
  let active = false; // true from the click until it closes, so a scroll does nothing the rest of the time
  function clear() { if (!active) return; active = false; T.cancel(); spot.classList.remove('on'); card.classList.remove('front'); bar.classList.remove('lit'); flow.textContent = ''; }
  // One path: the line, then the arrowhead, drawn as a single stroke so nothing comes apart.
  function draw(from) {
    const a = from.getBoundingClientRect(), b = card.getBoundingClientRect(), copy = card.querySelector('[data-copy]').getBoundingClientRect();
    const x1 = a.left + a.width / 2, y1 = a.bottom + 10;
    let d;
    if (b.right + 44 < innerWidth && x1 > b.right) {
      // Down the card's right side, then left into the Copy button.
      const x2 = b.right + 14, y2 = copy.top + copy.height / 2;
      d = `M${x1} ${y1} C ${x1} ${y2}, ${x1} ${y2}, ${x2} ${y2} M${x2 + 11} ${y2 - 9} L${x2} ${y2} L${x2 + 11} ${y2 + 9}`;
    } else {
      // No room on the right (phones): down into the card's top edge, or up into its bottom edge.
      const up = b.top < y1, x2 = Math.min(b.right - 40, Math.max(b.left + 40, x1)), y2 = up ? b.bottom + 14 : b.top - 14, k = up ? -1 : 1;
      const sy = up ? a.top - 10 : y1;
      d = `M${x1} ${sy} C ${x1} ${(sy + y2) / 2}, ${x2} ${(sy + y2) / 2}, ${x2} ${y2} M${x2 - 9} ${y2 - 11 * k} L${x2} ${y2} L${x2 + 9} ${y2 - 11 * k}`;
    }
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d); flow.textContent = ''; flow.append(p);
    if (!REDUCE) {
      const L = p.getTotalLength();
      // Lengths with units: unitless dash values are rejected in CSS, which hid the line.
      p.style.strokeDasharray = `${L}px ${L}px`; p.style.strokeDashoffset = `${L}px`;
      getComputedStyle(p).strokeDashoffset; // apply the hidden start before the transition
      p.style.transition = 'stroke-dashoffset .75s cubic-bezier(.4,0,.2,1)';
      p.style.strokeDashoffset = '0px';
    }
  }
  function show(from) {
    spot.classList.add('on'); card.classList.add('front'); bar.classList.add('lit');
    // Draw once the card has finished growing, so the arrow ends where the card really is.
    T.later(() => draw(from), REDUCE ? 0 : 420);
    T.later(clear, 5000);
  }
  document.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', e => {
    e.preventDefault(); clear(); active = true;
    const r = card.getBoundingClientRect(), inSight = r.top >= bar.offsetHeight + 4 && r.bottom <= innerHeight;
    if (!inSight) target.scrollIntoView({ behavior: REDUCE ? 'auto' : 'smooth', block: 'center' });
    // The pill hides once the card is in view, so the arrow starts from the nav button then.
    const from = el.id === 'float-cta' ? $('.nav [data-go]') : el;
    T.later(() => show(from), inSight || REDUCE ? 0 : 650);
  }));
  spot.addEventListener('click', clear);
  addEventListener('keydown', e => { if (e.key === 'Escape') clear(); });
  addEventListener('wheel', clear, { passive: true });
  // The pill shows once the hero is gone, and hides while an install box or the ending is on screen.
  const pill = $('#float-cta'), seen = new Set();
  let heroIn = true;
  const set = () => pill.classList.toggle('on', !heroIn && seen.size === 0);
  new IntersectionObserver(e => { heroIn = e[0].isIntersecting; set(); }, { threshold: .05 }).observe($('.hero'));
  const io = new IntersectionObserver(es => { es.forEach(x => x.isIntersecting ? seen.add(x.target) : seen.delete(x.target)); set(); });
  document.querySelectorAll('.install, #end').forEach(el => io.observe(el));
})();

// ---------- Copy buttons ----------
document.querySelectorAll('[data-copy]').forEach(btn => { const T = timers(); btn.addEventListener('click', async () => {
  const code = btn.parentElement.querySelector('code');
  try { await navigator.clipboard.writeText(code.textContent); btn.textContent = 'Copied'; }
  catch { const r = document.createRange(); r.selectNodeContents(code); getSelection().removeAllRanges(); getSelection().addRange(r); btn.textContent = MAC ? 'Press Cmd+C' : 'Press Ctrl+C'; }
  T.cancel(); T.later(() => { btn.textContent = 'Copy'; }, 1800);
}); });

// ---------- Hero playground: the real Sprout over a Claude window ----------
// The desktop is designed at 1280 x 760 and scaled to fit as one picture.
// Phones: the sidebar goes, the Claude window narrows, and only the middle of the desktop is shown,
// wide enough for Sprout's bubble on either side (x 160 to 1120, top 700 px). Everything stays in view.
(function () {
  const fit = $('#hero-fit'), scene = $('#hero-scene'), W = 1280, H = 760, X0 = 160, X1 = 1120, Y1 = 700;
  let fw = -1; // only a new width matters (setting the height below would call this again)
  new ResizeObserver(() => {
    const w = fit.clientWidth; if (w === fw) return; fw = w;
    const narrow = w < 700, k = narrow ? w / (X1 - X0) : w / W;
    scene.classList.toggle('narrow', narrow);
    fit.style.height = Math.round((narrow ? Y1 : H) * k) + 'px';
    scene.style.transform = narrow ? `translate(${-X0 * k}px, 0) scale(${k})` : `scale(${k})`;
  }).observe(fit);
  // The Allow pulse and the Wi-Fi hint stop repainting while the desktop is off screen.
  inView(fit, () => scene.classList.remove('off'), () => scene.classList.add('off'), 0);
})();
(function () {
  const canvas = $('#hero-sprout'), slot = $('#hero-poke'), chat = $('#hero-chat'), wifi = $('#wifi');
  const sprout = makeSprout(canvas, 64, { compactTop: 30 }, slot); // the slot carries the centring shift
  let run = 0, phase = 'idle', peeking = false;
  const add = (cls, html) => addLine(chat, cls, html);
  const alive = id => id === run;
  // The Done and error bubbles: the x sends Sprout up to the peek, a click opens the session.
  const bubbleActs = id => ({
    onClose: () => { if (!alive(id)) return; peeking = true; sprout.setPeek(true); },
    onClick: () => { if (alive(id)) opened(); }
  });
  // The switch under the desktop and the menu bar icon are one control.
  const wifi2 = $('#wifi2');
  const setWifi = on => { wifi.setAttribute('aria-checked', String(on)); wifi2.setAttribute('aria-checked', String(on)); };

  function doneBubble(id, recall) {
    sprout.say(recall ? 'All done, just now. Click me to open your session' : 'All done. Click me to open your session', true, Infinity, ['billing-app'], bubbleActs(id));
  }
  function opened() {
    phase = 'end'; peeking = false; sprout.setPeek(false); sprout.setState('hidden');
    add('tool ok', 'In the app, this click opens your session. Sprout is done.');
  }
  function errorBubble(id) {
    sprout.say('Something went wrong', true, Infinity, ['Connection lost'], bubbleActs(id));
  }
  function fail() {
    const id = ++run; phase = 'end';
    lockOpts(chat);
    add('err', 'Connection lost. Couldn’t reach the server.');
    sprout.setState('error'); errorBubble(id);
  }

  async function play() {
    const id = ++run; phase = 'working'; peeking = false;
    chat.textContent = ''; setWifi(true);
    sprout.setPeek(false); sprout.setState('hidden');
    await wait(400); if (!alive(id)) return;
    add('you', 'Fix the failing date test in invoice.js');
    sprout.setState('working'); sprout.say('Still on it!', false, 2200);
    await wait(1300); if (!alive(id)) return; add('tool', 'Read 2 files');
    await wait(1100); if (!alive(id)) return; add('tool', 'Searched for formatDate');
    await wait(1100); if (!alive(id)) return;
    phase = 'needs';
    const ask = add('ask', '<b>Claude wants to edit <code>invoice.js</code></b><div class="diff"><div class="h">invoice.js · line 4</div><div class="del">-  return date.toLocaleDateString(\'en-GB\');</div><div class="add">+  return date.toISOString().slice(0, 10);</div></div><div class="btns"><button class="opt" type="button">Deny</button><button class="opt main pulse" type="button">Allow</button></div>');
    sprout.setState('needs'); sprout.say('Over here! Claude needs you', true, Infinity, ['Wants to use Edit']);
    const [deny, allow] = ask.querySelectorAll('.opt');
    allow.onclick = () => answer(id, true, ask);
    deny.onclick = () => answer(id, false, ask);
  }
  async function answer(id, ok, ask) {
    if (!alive(id)) return;
    lockOpts(ask);
    if (ok && wifi.getAttribute('aria-checked') === 'false') { fail(); return; }
    if (!ok) {
      phase = 'end'; add('tool', 'Denied');
      sprout.say('Okay, skipping it.', true, 2400);
      await wait(900); if (!alive(id)) return;
      add('', 'Okay, I left invoice.js as it is. Tell me if you want a different fix.');
      await wait(2000); if (!alive(id)) return;
      sprout.setState('hidden');
      return;
    }
    phase = 'working';
    sprout.setState('working'); sprout.say('Still on it!', false, 1800);
    add('tool ok', 'Edited invoice.js');
    await wait(1300); if (!alive(id)) return; add('tool ok', 'Ran npm test: 32 passed');
    await wait(1000); if (!alive(id)) return;
    phase = 'done';
    add('', 'Fixed. The test expected an ISO date, so <code>formatDate</code> now returns one. All 32 tests pass.');
    sprout.setState('done'); doneBubble(id, false);
  }

  slot.addEventListener('click', () => {
    if (peeking) { peeking = false; sprout.setPeek(false); if (sprout.state === 'error') errorBubble(run); else doneBubble(run, true); return; }
    if (phase === 'done' || (phase === 'end' && sprout.state === 'error')) { opened(); return; }
    sprout.poke();
  });
  wifi2.addEventListener('click', () => wifi.click());
  wifi.addEventListener('click', () => {
    wifi.classList.remove('hint');
    const on = wifi.getAttribute('aria-checked') !== 'true';
    setWifi(on);
    if (!on && phase === 'working') fail();
    else if (on && phase === 'end' && sprout.state === 'error') play();
  });
  $('#replay').addEventListener('click', play);
  let started = false;
  inView($('#hero-fit'), () => { if (!started) { started = true; play(); } }, null, .3);
})();

// ---------- The states: one open card plays its moment, then the next card opens ----------
(function () {
  const MINI = `
    <div class="mbar"><b>Claude</b><span>File</span><span>Edit</span><span class="r">10:04</span></div><div class="notch"></div>
    <canvas></canvas>
    <div class="cw"><div class="tb"><span class="dots"><i></i><i></i><i></i></span><span class="tt">Fix the failing date test</span></div><div class="cols"><div class="main"><div class="chat"></div><div class="comp"><span>+</span><span>Type / for commands</span></div></div></div></div>`;
  const cards = [...document.querySelectorAll('.st')].map(card => {
    const mini = card.querySelector('.mini');
    mini.innerHTML = MINI;
    const sprout = makeSprout(mini.querySelector('canvas'), 48, { compactTop: 24, pointer: true });
    return { card, mini, cap: card.querySelector('.cap'), bar: card.querySelector('.prog b'), chat: mini.querySelector('.chat'), sprout, state: card.dataset.state, run: 0 };
  });
  // Up to 1000 px the cards stack: each scene shrinks to the card's width, and the open card is the scene plus its caption.
  const stacked = matchMedia('(max-width: 1000px)');
  function sizeCards() {
    if (!stacked.matches) { cards.forEach(({ card, mini }) => { mini.style.transform = ''; card.style.removeProperty('--oh'); }); return; }
    const m = cards.map(({ card, cap }) => [card.clientWidth / 760, cap.offsetHeight]); // all reads first, then all writes
    cards.forEach(({ card, mini }, i) => { const [k, h] = m[i]; mini.style.transform = `scale(${k})`; card.style.setProperty('--oh', Math.ceil(420 * k + h) + 'px'); });
  }
  // Only a new width matters: the open card growing changes the height, and would call this every frame.
  let cardsW = -1;
  new ResizeObserver(e => { const w = e[0].contentRect.width; if (w === cardsW) return; cardsW = w; sizeCards(); }).observe($('#state-cards'));
  document.fonts.ready.then(sizeCards);
  const add = (c, cls, html) => addLine(c.chat, cls, html);
  // Needs you and error play the same steps with their own words: chat line class and text, bubble, bubble detail.
  const ALERT = {
    needs: ['ask', '<b>Claude wants to edit <code>invoice.js</code></b><div class="btns"><span class="opt">Deny</span><span class="opt main">Allow</span></div>', 'Over here! Claude needs you', 'Wants to use Edit'],
    error: ['err', 'API Error: Connection error.', 'Something went wrong', 'API Error: Connection error.']
  };
  const LENGTH = { working: 9900, needs: 8500, done: 9400, error: 8500 };  // ms, for the filling line
  async function loop(c, delay = 0) {
    const id = ++c.run, alive = () => id === c.run, s = c.sprout;
    if (delay) { await wait(delay); if (!alive()) return; }
    c.bar.style.transition = 'none'; c.bar.style.transform = 'scaleX(0)'; void c.bar.offsetWidth;
    c.bar.style.transition = REDUCE ? 'none' : `transform ${LENGTH[c.state]}ms linear`; c.bar.style.transform = 'scaleX(1)';
    c.chat.textContent = ''; s.setPeek(false); s.setState('hidden');
    add(c, 'you', 'Fix the failing date test in invoice.js');
    await wait(700); if (!alive()) return;
    if (c.state === 'working') {
      s.setState('working'); s.say('Still on it!', false, 2400);
      for (const t of ['Read 2 files', 'Searched for formatDate', 'Edited invoice.js', 'Running npm test']) { await wait(1100); if (!alive()) return; add(c, 'tool', t); }
      await wait(1200); if (!alive()) return;
      s.setCompact(true);
      await wait(3600); if (!alive()) return;
      s.setCompact(false);
    } else if (c.state === 'done') {
      s.setState('working');
      await wait(800); if (!alive()) return; add(c, 'tool ok', 'Edited invoice.js');
      await wait(800); if (!alive()) return; add(c, 'tool ok', 'Ran npm test: 32 passed');
      await wait(700); if (!alive()) return;
      add(c, '', 'Fixed. All 32 tests pass.');
      s.setState('done'); s.say('All done. Click me to open your session', true, Infinity, ['billing-app'], { onClose: () => s.setPeek(true) });
      await wait(3800); if (!alive()) return;
      s.setPeek(true);
      await wait(2600); if (!alive()) return;
    } else {
      const [cls, html, line, detail] = ALERT[c.state];
      s.setState('working');
      await wait(900); if (!alive()) return; add(c, 'tool', 'Read 2 files');
      await wait(900); if (!alive()) return;
      add(c, cls, html);
      s.setState(c.state); s.say(line, true, 5200, [detail]);
      await wait(6000); if (!alive()) return;
    }
    if (visible && !REDUCE) open(cards[(cards.indexOf(c) + 1) % cards.length]);
  }
  function stop(c) { c.run++; c.sprout.setPeek(false); c.sprout.setState('hidden'); }
  // Closed: the card still shows its Sprout in its state, quiet (no bubble), so the row reads as a legend.
  function rest(c) { stop(c); c.sprout.setCompact(false); c.sprout.setState(c.state); }
  let visible = false;
  function open(c) {
    cards.forEach(o => { const on = o === c; o.card.classList.toggle('open', on); o.card.setAttribute('aria-expanded', String(on)); if (!on) { if (visible) rest(o); else stop(o); } });
    if (visible) loop(c, 350);
  }
  cards.forEach(c => {
    // The cards are role="button" (a <button> may not hold the scene's boxes), so Enter and Space open them too.
    c.card.addEventListener('click', () => { if (!c.card.classList.contains('open')) open(c); });
    c.card.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !c.card.classList.contains('open')) { e.preventDefault(); open(c); } });
    c.card.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse' && !c.card.classList.contains('open')) open(c); });
  });
  inView($('#state-cards'), () => {
    visible = true;
    cards.forEach(o => { if (!o.card.classList.contains('open')) rest(o); });
    const c = cards.find(o => o.card.classList.contains('open')); if (c) loop(c);
  }, () => { visible = false; cards.forEach(stop); }, .3);
})();

// ---------- The loop video: never starts on its own (Safari blocks autoplay in Low Power Mode); a big play button starts it ----------
(function () {
  const v = $('#loop-video'), box = v.parentElement;
  v.poster = matchMedia('(max-width: 600px)').matches ? v.dataset.phonePoster : v.dataset.poster; // set here, so phones fetch only theirs
  const sync = () => box.classList.toggle('playing', !v.paused);
  for (const ev of ['play', 'playing', 'pause']) v.addEventListener(ev, sync);
  sync();
  $('#loop-play').addEventListener('click', () => v.play());
  $('#loop-pp').addEventListener('click', () => v.pause());
  inView(v, () => {}, () => v.pause(), .15);
})();

// ---------- Works with: a small real Sprout over each app ----------
(function () {
  const ss = [...document.querySelectorAll('.app .thumb canvas')].map(c => makeSprout(c, 30, { bubble: false, settings: { bounce: .6 } }));
  const ST = ['needs', 'working', 'done'];
  const T = timers();
  inView($('#where'), () => ss.forEach((s, i) => T.later(() => s.setState(ST[i]), i * 220)),
    () => { T.cancel(); ss.forEach(s => s.setState('hidden')); }, .25);
})();

// ---------- Questions: answers slide open and closed (height and fade); instant with Reduce Motion ----------
(function () {
  document.querySelectorAll('.q').forEach(d => {
    const sum = d.querySelector('summary'), ans = d.querySelector('.ans');
    let anim = null, closing = false;
    sum.addEventListener('click', e => {
      if (REDUCE) return;
      e.preventDefault();
      const from = ans.offsetHeight; // where it is now, also mid-animation (0 when closed)
      if (anim) anim.cancel();
      if (!d.open || closing) {
        // d.open stays true while closing, so "closing" decides: a click then opens it again.
        closing = false; d.open = true;
        const h = ans.scrollHeight;
        anim = ans.animate([{ height: from + 'px', opacity: from / h }, { height: h + 'px', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.23, 1, .32, 1)' });
        anim.onfinish = () => { anim = null; };
      } else {
        closing = true;
        anim = ans.animate([{ height: from + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 240, easing: 'cubic-bezier(.4, 0, .2, 1)' });
        anim.onfinish = () => { d.open = false; closing = false; anim = null; };
      }
    });
  });
})();

// ---------- The end: the photo edge to edge, "Blip" behind the hill, Sprout the dot on the i, and it's Done ----------
(function () {
  const end = $('#end'), bg = $('.ph-bg'), fg = $('.ph-fg'), word = $('.word');
  const canvas = $('#dot-sprout'), span = canvas.parentElement, base = span.querySelector('.bl');
  const PHOTO = { src: 'photos/sunset-hills.jpg', thr: .05, fy: .6 };
  let sprout = null, said = false, inSight = false;

  // The hill's edge is found in the photo itself: from the bottom of each column up to the first run of sky-bright pixels.
  function ridgeOf(img) {
    const w = 600, h = Math.round(w * img.naturalHeight / img.naturalWidth), c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data, lum = (x, y) => { const i = (y * w + x) * 4; return (.2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]) / 255; };
    const r = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      let y = h - 1, run = 0;
      for (; y >= 0; y--) { if (lum(x, y) >= PHOTO.thr) { if (++run >= 3) break; } else run = 0; }
      r[x] = Math.max(0, y + run) / h;
    }
    const m = new Float32Array(w);  // a median of 9 smooths out single bright pixels
    for (let x = 0; x < w; x++) { const a = []; for (let k = -4; k <= 4; k++) a.push(r[Math.min(w - 1, Math.max(0, x + k))]); a.sort((p, q) => p - q); m[x] = a[4]; }
    return m;
  }
  // If the photo fails to load, there is no photo, but "Blip" and its Sprout dot still appear.
  const photo = new Promise(res => {
    const img = new Image();
    img.onload = () => res({ img, ridge: ridgeOf(img) }); img.onerror = () => res(null);
    img.src = PHOTO.src;
  });

  // The photo is drawn twice: behind "Blip", and in front of it cut along the hill's edge. Then "Blip" is lowered so the hill covers its foot.
  async function drawPhoto() {
    const got = await photo;
    if (!got) return;
    const { img, ridge } = got;
    const W = end.clientWidth, H = end.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
    // Phones: zoom in a little and crop mostly from the bottom, so less of the dark foreground shows.
    const phone = W < 720;
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight) * (phone ? 1.3 : 1), dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    const dx = (W - dw) / 2, dy = (H - dh) * (phone ? .2 : PHOTO.fy), L = ridge.length;
    const ry = X => dy + ridge[Math.min(L - 1, Math.max(0, Math.round((X - dx) / dw * L)))] * dh;
    for (const c of [bg, fg]) {
      c.width = W * dpr; c.height = H * dpr;
      const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.drawImage(img, dx, dy, dw, dh);
      if (c === fg) {
        g.globalCompositeOperation = 'destination-in'; g.beginPath(); g.moveTo(0, H);
        for (let X = 0; X <= W; X += 2) g.lineTo(X, ry(X));
        g.lineTo(W, H); g.closePath(); g.fill(); g.globalCompositeOperation = 'source-over';
      }
    }
    // The middle of the hill's height under the word, plus a fifth of the font size: the hill covers the bottom of the letters (Mohamed's call).
    word.style.top = '0px';
    const fs = parseFloat(getComputedStyle(word).fontSize), tw = fs * 1.9, x0 = W / 2 - tw / 2, ys = [];
    for (let k = 0; k <= 20; k++) ys.push(ry(x0 + tw * k / 20));
    ys.sort((a, b) => a - b);
    const baseNow = base.getBoundingClientRect().top - end.getBoundingClientRect().top;
    word.style.top = (ys[10] + fs * .2 - baseNow) + 'px';
  }

  // Sprout as the dot of the i. Measured, not guessed: the font's real dot (drawn offscreen in the font on screen)
  // and Sprout's real body (bodyBox) are lined up, then corrected once with the settled drawing.
  function dotBottom(fs) {
    // Draw a dotted i, find the first ink run from the top (the dot); return its bottom above the baseline.
    const c = document.createElement('canvas'), H = Math.ceil(fs * 1.4), W = Math.ceil(fs * .6);
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.font = `800 ${fs}px ${getComputedStyle(word).fontFamily}`; g.textBaseline = 'alphabetic'; g.fillText('i', fs * .1, fs * 1.1);
    const d = g.getImageData(0, 0, W, H).data, ink = y => { for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 128) return true; return false; };
    let y = 0; while (y < H && !ink(y)) y++;
    while (y < H && ink(y)) y++;
    return fs * 1.1 - y; // px above the baseline
  }
  let want = 0, settleTimer = 0, made = 0;
  function placeDot() {
    const fs = parseFloat(getComputedStyle(word).fontSize), size = Math.round(fs * .13);
    // A Sprout keeps the size it was made with, so a new size means a new Sprout.
    if (made !== size) { if (sprout) sprout.destroy(); sprout = makeSprout(canvas, size, { handlePress: true }); made = size; }
    canvas.style.top = '0px';
    const sr = span.getBoundingClientRect(), cr = canvas.getBoundingClientRect(), b = sprout.bodyBox();
    want = base.getBoundingClientRect().top - sr.top - dotBottom(fs);
    canvas.style.top = (want - (b.y + b.h - cr.top)) + 'px';
    settle();
  }
  // Correct with the real drawing: once Sprout has settled, find its lowest solid row and put it on the dot's bottom.
  function settle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height, d = g.getImageData(0, 0, W, H).data;
      let row = -1;
      for (let y = H - 1; y >= 0 && row < 0; y--) for (let x = Math.floor(W * .3); x < W * .7; x++) if (d[(y * W + x) * 4 + 3] > 200) { row = y; break; }
      if (row < 0) return;
      canvas.style.top = (want - row / (H / canvas.getBoundingClientRect().height)) + 'px';
    }, 1600);
  }
  function wake() {
    if (!sprout || !inSight) return;
    sprout.setState('done'); settle();
    if (!said) { said = true; setTimeout(() => sprout.say('All done!', true, 3000), 900); }
  }

  // Redraw only when the ending really changes size, at most once a frame. (iPhone Safari reports a resize
  // whenever its toolbar shows or hides while scrolling; the ending's size does not change then.)
  let lastW = 0, lastH = 0, frame = 0;
  const layout = async () => {
    await document.fonts.ready;
    await drawPhoto();
    placeDot(); wake();
  };
  new ResizeObserver(() => {
    if (end.clientWidth === lastW && end.clientHeight === lastH) return;
    lastW = end.clientWidth; lastH = end.clientHeight;
    cancelAnimationFrame(frame); frame = requestAnimationFrame(layout);
  }).observe(end);

  inView(end, () => { inSight = true; wake(); }, () => { inSight = false; if (sprout) sprout.setState('hidden'); }, .4);})();
