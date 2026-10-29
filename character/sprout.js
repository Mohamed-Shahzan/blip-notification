// Sprout, the Blip character, drawn with Canvas 2D. No dependencies.
// Same drawing and motion as the Sprout card in playground.html, packaged for the Blip app.
//
// Usage:
//   const sprout = BlipSprout.create(canvas, { size: 32, settings });  // settings: JSON from "Copy settings"
//   size can also be 'fit': as large as the canvas allows.
//   sprout.setState('working');   // 'hidden' | 'working' | 'needs' | 'done' | 'error'
//   sprout.poke();                // the click reaction (a short press on the canvas does this). Quick clicks in a row:
//                                 // 3 say what Sprout is doing, 6 and more make it fed up
//   sprout.lookAt(x, y);          // cursor in client pixels; the page's pointermove does this by default
//   sprout.bodyBox();             // {x, y, w, h} in client pixels around the body, antenna and highest hop,
//                                 // for a host that lets clicks through everywhere else
//   sprout.press(); sprout.release(); sprout.cancel();  // pointer down / up / leave, for a host that handles
//                                 // presses itself (handlePress: false turns off Sprout's own click and hold
//                                 // handling on the canvas); holding 3 s grows the leaf
//   sprout.say(text);             // a short speech bubble next to Sprout (three quick clicks show the state line);
//                                 // opts.bubbleBeside puts it beside the body instead of above the head
//   sprout.say(text, announce, hold, detail);  // detail: a smaller grey line under it, cut with "…" when long
//   sprout.line                   // the current state's line ("All done!"...), for a host that says it on a change
//   sprout.update(settings);      // change some settings live; the rest keep their values
//   Options for testing the easter eggs: opts.luck (chance of a lucky leaf per done), opts.date (a function
//   returning the Date to use).
//   sprout.destroy();
//
// The canvas is sized by CSS; BlipSprout.canvasSize(size) gives a size with room for hops, the antenna,
// the raised hand and the glow. While hidden the loop stops, so Sprout costs nothing when not shown.
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = t => 1 - Math.pow(1 - t, 3);

  // ---------- colour ----------
  const hexToRgb = h => [0, 2, 4].map(i => parseInt(h.replace('#', '').substr(i, 2), 16));
  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }
  function hslToRgb([h, s, l]) {
    if (!s) return [l * 255, l * 255, l * 255];
    const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = t => { t = (t % 1 + 1) % 1; return t < 1/6 ? p + (q - p) * 6 * t : t < 1/2 ? q : t < 2/3 ? p + (q - p) * (2/3 - t) * 6 : p; };
    return [f(h + 1/3) * 255, f(h) * 255, f(h - 1/3) * 255];
  }
  const shade = (c, a) => a >= 0 ? c.map(v => v + (255 - v) * a) : c.map(v => v * (1 + a));
  const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const mix = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

  // ---------- settings ----------
  // The Sprout subset of the playground settings, with the defaults agreed on 29 Oct (Vivid, outline 0.9).
  const DEFAULTS = {
    round: .6, squash: .5, hue: 0, sat: 100, glow: .5, outline: .9, backing: 0,
    eyeSize: 1, eyeGap: 1, eyeStyle: 'auto', mouth: true, follow: true, lookRange: 1,
    speed: 1, bounce: 1, trans: .35, blinkEvery: 3.5,
    mBlink: true, mRead: true, mError: true, mDone: true, mContact: true, mChange: true, mGlance: true, mHand: true,
    eggs: true, // the five easter eggs (see EGGS below)
    colors: { working: '#4f8cff', needs: '#ffb13b', done: '#33c46a', error: '#ff5a5f' }
  };
  // Allowed ranges, the same as the playground sliders. Out-of-range numbers are clamped, other values ignored.
  const RANGES = {
    round: [0, 1], squash: [0, 1], hue: [-180, 180], sat: [0, 150], glow: [0, 1], outline: [0, 1], backing: [0, 1],
    eyeSize: [.5, 1.8], eyeGap: [.6, 1.6], lookRange: [.5, 3], speed: [.3, 2.5], bounce: [0, 2], trans: [.1, 1.2], blinkEvery: [1, 8]
  };
  const hexColour = v => {
    if (typeof v !== 'string') return null;
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].replace(/./g, ch => ch + ch) : m[1];
    return '#' + h.toLowerCase();
  };
  // Settings on top of `base`: unknown keys are ignored, so the playground's full "Copy settings" JSON is fine.
  function merge(base, s) {
    const out = { ...base, colors: { ...base.colors } };
    if (!s || typeof s !== 'object') return out;
    for (const key of Object.keys(DEFAULTS)) {
      if (key === 'colors' || !(key in s)) continue;
      const v = s[key];
      if (RANGES[key]) { if (typeof v === 'number' && isFinite(v)) out[key] = clamp(v, RANGES[key][0], RANGES[key][1]); }
      else if (typeof v === typeof DEFAULTS[key]) out[key] = v;
    }
    for (const st of Object.keys(DEFAULTS.colors)) { const c = s.colors && hexColour(s.colors[st]); if (c) out.colors[st] = c; }
    return out;
  }

  const STATES = ['hidden', 'working', 'needs', 'done', 'error'];
  // Lead-in before a state's main motion and effects: the done wind-up and the error jolt (seconds at speed 1).
  const LEAD = { done: .18, error: .25 };
  const INK = '#1f1d2b';
  // Easter eggs. Hold Sprout HOLD_MS to grow a leaf (stays until it hides); LUCK of done moments grow it by
  // themselves; working between midnight and 5 am turns the bulb into a crescent moon; every ROLL_EVERY done
  // in a row without an error gets circling stars; Blip's birthday (first session log, 18 Oct) gets confetti.
  const EGGS = { HOLD_MS: 3000, LUCK: 1 / 20, LUCKY_MS: 4000, ROLL_EVERY: 5, ROLL_MS: 3500, BIRTHDAY: [9, 18], PARTY_MS: 3500 };
  const LEAF = [92, 196, 104], CONFETTI = ['#ffb13b', '#4f8cff', '#33c46a', '#ff5a5f', '#b98cff'];
  const hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  // Drawing box: the character lives in a 100 x 100 unit box; 75 units of body is the "size" in pixels.
  const UNITS_PER_SIZE = 75;
  const BOX = { rx: 40, ry: 46, cy: -4 };
  const BUBBLE_TIME = 2.2;
  // Click ladder. Clicks count as one streak while each comes within STREAK_GAP ms of the last:
  // 3 clicks say what Sprout is doing; from 6 on it is fed up (tired eyes, antenna flopped over) until the
  // clicks stop for FED_HOLD ms.
  const STREAK_GAP = 700, LINE_AT = 3, FED_AT = 6, FED_HOLD = 6000;
  const LINES = { working: 'Still on it!', needs: 'Over here! Claude needs you', done: 'All done!', error: 'Something went wrong' };
  // What a fed-up Sprout tells someone who keeps clicking: where things stand, so the clicks get an answer.
  const FED_LINES = {
    working: "Easy! I'll tell you when it's done.", needs: 'Claude is waiting for you.',
    done: "It's done, all good!", error: 'Something went wrong. Check the session.'
  };

  // ---------- drawing helpers ----------
  // Superellipse: n=2 is an ellipse, higher n is squarer. gx scales x only.
  function superPath(ctx, w, h, n, gx) {
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const th = i / 80 * TAU, c = Math.cos(th), s = Math.sin(th), kx = gx ? gx(th) : 1;
      const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * w * kx;
      const y = Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * h;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  }
  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function glow(ctx, st, c, amt) { ctx.shadowColor = rgba(c, .75); ctx.shadowBlur = amt * st.k; }
  // Rim: the state colour darkened and mixed with one fixed ink, so it looks equally strong in every state
  // (plain darkened blue is near black, darkened amber is a heavy brown).
  const INK_RGB = [31, 29, 43];
  const rimColour = (c, a) => rgba(mix(shade(c, -.55), INK_RGB, .45), a);
  function outline(ctx, st, c, lw) {
    if (st.P.outline <= 0) return;
    ctx.shadowBlur = 0; ctx.lineWidth = lw; ctx.strokeStyle = rimColour(c, st.P.outline); ctx.stroke();
  }
  // "React big once, then settle": needs you hops for about 2 s, then every 8 s gives a short reminder
  // (hand up and one small hop). Returns how much of each is happening now, 0 to 1.
  function needsPhase(a) {
    const hop = a < 2 ? 1 : a < 2.4 ? 1 - (a - 2) / .4 : 0;
    const ph = a >= 2.2 ? (a - 2.2) % 8 : -1;
    const remind = ph > 6.8 ? Math.sin((ph - 6.8) / 1.2 * Math.PI) : 0;
    return { hop, remind, handUp: a < 2.2 || ph > 6.8 };
  }
  function squashAt(ctx, m, by) { ctx.translate(0, by); ctx.scale(m.sx, m.sy); ctx.translate(0, -by); }
  function twinkle(ctx, x, y, r, rot = 0) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.beginPath(); ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(0, 0, r, 0); ctx.quadraticCurveTo(0, 0, 0, r);
    ctx.quadraticCurveTo(0, 0, -r, 0); ctx.quadraticCurveTo(0, 0, 0, -r); ctx.fill(); ctx.restore();
  }
  const moodOf = s => ({ working: 'focus', needs: 'wide', done: 'happy', error: 'oops' })[s];
  // Damped spring wobble: starts at amp (or at 0 with phase PI/2) and dies away.
  const wobble = (age, amp, decay, freq, phase = 0) => amp * Math.exp(-age * decay) * Math.cos(age * freq - phase);
  function spring(o, target, dt, k, z) {
    const a = k * (target - o.x) - 2 * Math.sqrt(k) * z * o.v;
    o.v += a * dt; o.x += o.v * dt;
  }
  // Look around: a quick glance left, then right, then back to centre.
  function glanceOffset(a) {
    if (a >= 1.1) return 0;
    if (a < .12) return -3 * a / .12;
    if (a < .5) return -3;
    if (a < .62) return lerp(-3, 3, (a - .5) / .12);
    if (a < .95) return 3;
    return 3 * (1 - (a - .95) / .15);
  }

  function eyes(ctx, st, o) {
    const P = st.P, a = st.raw;
    let mood = moodOf(st.state), pop = 1;
    // Startle: wide eyes that pop during the error lead-in, before the squeeze.
    if (st.state === 'error' && P.mError && st.age < 0) { mood = 'wide'; pop = 1 + .35 * Math.sin(a / LEAD.error * Math.PI); }
    // Fed up with clicks: the tired eyes, whatever the state.
    if (st.fed > .5) mood = 'tired';
    // Eye contact: looking straight out for a second, then easing back to following the cursor.
    const contact = st.state === 'needs' && P.mContact && a < 1.4, cw = clamp((a - 1) / .4, 0, 1);
    const style = P.eyeStyle === 'auto' ? o.style : P.eyeStyle;
    const r = o.r * P.eyeSize * pop, gap = o.gap * P.eyeGap;
    ctx.save();
    ctx.fillStyle = ctx.strokeStyle = o.ink; ctx.lineCap = ctx.lineJoin = 'round';
    let lx = (o.lx || 0) + st.look.x, ly = (o.ly || 0) + st.look.y;
    if (st.state === 'working') {
      // Reading: quick jumps along a line. While the cursor moves (attend near 1) the eyes follow it instead.
      let rx = o.lx || 0, ry = o.ly || 0;
      if (P.mRead) { rx = st.read.x; ry = (o.ly || 0) + st.read.y; }
      if (P.mGlance) rx += st.glance;
      lx = lerp(rx, st.look.x, st.attend); ly = lerp(ry, st.look.y, st.attend);
    }
    if (contact) { lx = lerp(0, lx, cw); ly = lerp(.8, ly, cw); }
    for (const side of [-1, 1]) {
      ctx.save(); ctx.translate(side * gap + lx, o.y + ly);
      if (mood === 'happy') {
        ctx.lineWidth = r * .7; ctx.beginPath(); ctx.arc(0, r * .55, r * .95, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
      } else if (mood === 'tired' || (mood === 'oops' && st.age > 2)) {
        // Tired: half-closed eyes under a heavy lid line.
        ctx.beginPath(); ctx.ellipse(0, r * .3, r * .85, r * .45, 0, 0, Math.PI); ctx.fill();
        ctx.lineWidth = r * .45; ctx.beginPath(); ctx.moveTo(-r * .95, r * .25); ctx.lineTo(r * .95, r * .25); ctx.stroke();
      } else if (mood === 'oops') {
        const d = r * .85; ctx.lineWidth = r * .62; ctx.beginPath();
        ctx.moveTo(side * d * .75, -d); ctx.lineTo(-side * d * .55, 0); ctx.lineTo(side * d * .75, d); ctx.stroke();
      } else {
        // Working and needs you share the same eyes; what they do (read, look at you) tells them apart.
        const sy = 1 - st.blink * .92, rr = r;
        ctx.scale(1, sy); ctx.beginPath();
        if (style === 'dot') ctx.arc(0, 0, rr, 0, TAU);
        else if (style === 'oval') ctx.ellipse(0, 0, rr * .78, rr * 1.22, 0, 0, TAU);
        else rrect(ctx, -rr * .45, -rr * 1.15, rr * .9, rr * 2.3, rr * .45);
        ctx.fill();
        if (st.blink < .5) {
          ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.beginPath();
          ctx.arc(style === 'bar' ? 0 : rr * .25, -rr * .5, rr * .27, 0, TAU); ctx.fill();
        }
      }
      ctx.restore();
    }
    ctx.restore();
  }
  function mouth(ctx, st, o) {
    if (!st.P.mouth) return;
    const w = o.w, s = st.fed > .5 ? 'error' : st.state;
    ctx.save(); ctx.translate(0, o.y); ctx.fillStyle = ctx.strokeStyle = o.ink; ctx.lineCap = 'round';
    if (s === 'needs') { const open = .7 + .3 * Math.sin(st.t * 9); ctx.beginPath(); ctx.ellipse(0, 0, w * .28, w * .32 * open, 0, 0, TAU); ctx.fill(); }
    else if (s === 'done') { ctx.beginPath(); ctx.moveTo(-w * .5, -w * .12); ctx.quadraticCurveTo(0, w * .75, w * .5, -w * .12); ctx.closePath(); ctx.fill(); }
    else if (s === 'error') {
      ctx.lineWidth = w * .2; ctx.beginPath(); ctx.moveTo(-w * .45, w * .1);
      ctx.quadraticCurveTo(-w * .22, -w * .2, 0, w * .05); ctx.quadraticCurveTo(w * .22, w * .3, w * .45, 0); ctx.stroke();
    } else { ctx.lineWidth = w * .2; ctx.beginPath(); ctx.moveTo(-w * .16, 0); ctx.lineTo(w * .16, 0); ctx.stroke(); }
    ctx.restore();
  }

  // Body motion per state. st.age is negative during a state's lead-in; st.raw counts from the switch.
  function motion(st) {
    // With Reduce Motion on in the system, hops and shakes are a quarter as big and there is no flip.
    const b = st.P.bounce * (st.reduce ? .25 : 1), t = st.t, a = st.age, raw = st.raw;
    let x = 0, y = 0, rot = 0, sq = 0;
    if (st.state === 'working') {
      // The bob calms to about a third after the first 4 s; the antenna light keeps showing "busy".
      const e = a < 4 ? 1 : Math.max(.35, 1 - (a - 4) / 2);
      y = Math.sin(t * 2.4) * 1.6 * b * e; sq = Math.sin(t * 2.4 + 1.2) * .03 * b * e;
    } else if (st.state === 'needs') {
      const n = st.np, h = Math.sin(((t * 1.7) % 1) * Math.PI) * n.hop;
      y = -h * 13 * b - n.remind * 8 * b;
      sq = (h > 0 && h < .25 ? (.25 - h) / .25 * .2 : -h * .07) * b * n.hop;
      rot = Math.sin(t * 3.4) * .07 * b * n.hop + Math.sin(t * 1.8) * .035 * b * (1 - n.hop);
    } else if (st.state === 'done') {
      // Wind-up: a short crouch before the hop, then a damped wobble after landing.
      if (a < 0) sq = Math.sin(raw / LEAD.done * Math.PI) * .2 * b;
      else if (a < .8) { const h = Math.sin(a / .8 * Math.PI); y = -h * 18 * b; sq = -h * .1 * b; }
      else if (a < 1.05) sq = Math.sin((a - .8) / .25 * Math.PI) * .16 * b;
      else {
        rot = Math.sin(t * 2.2) * .06 * b; y = Math.sin(t * 4.4) * b;
        if (st.P.mDone && a < 1.8) rot += wobble(a - 1.05, .12, 5, 14, Math.PI / 2) * b;
      }
    } else if (st.state === 'error') {
      // Startle: a tiny jump first, then ease into the slump while the shake plays.
      if (a < 0) y = -Math.sin(raw / LEAD.error * Math.PI) * 5 * b;
      else {
        const e = st.P.mError ? Math.min(1, a / .15) : 1;
        if (a < .6) x = Math.sin(a * 55) * 5 * (1 - a / .6) * b;
        y = 2 * e; sq = .04 * e;
      }
    }
    // Fed up: the state's own motion fades out into a small slump.
    if (st.fed > .01) { const k = 1 - .8 * st.fed; x *= k; y = y * k + 2 * st.fed; rot *= k; sq = sq * k + .05 * st.fed; }
    if (st.P.mChange && st.changeAge < .6) sq += wobble(st.changeAge, .16, 8, 22);
    // Poke: squash down, then wobble back (a smaller, sadder squish in error).
    if (st.pokeAge < 1.2) sq += wobble(st.pokeAge, st.state === 'error' ? .14 : .3, 6, 16);
    if (st.phewAge < 1) sq += wobble(st.phewAge, .2, 5, 12);
    // Curious head tilt while the "Need something?" bubble shows.
    if (st.bubbleAge < BUBBLE_TIME) rot += .16 * Math.sin(Math.min(1, st.bubbleAge / .3) * Math.PI / 2) * Math.min(1, (BUBBLE_TIME - st.bubbleAge) / .3);
    sq *= .4 + st.P.squash * 1.2;
    return { x, y, rot, sx: 1 + sq, sy: 1 - sq };
  }

  function drawSprout(ctx, st, m) {
    const P = st.P, c = st.col, t = st.t, s = st.state;
    squashAt(ctx, m, 40);
    const tint = shade(c, .38), rim = rimColour(c, P.outline);
    ctx.fillStyle = rgba(shade(c, -.15));
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(side * 12, 38, 7.5, 4.2, 0, 0, TAU); ctx.fill(); }

    // Raised hand: an arm grows out from behind the right side and lifts, like a student asking.
    const h = st.hand;
    if (h > .02) {
      const a = lerp(.9, -.95, h) + Math.sin(t * 9) * .16 * h, L = 22 * h;
      const sx = 27, sy = 9, hx = sx + Math.cos(a) * L, hy = sy + Math.sin(a) * L;
      ctx.lineCap = 'round';
      ctx.strokeStyle = rim; ctx.lineWidth = 6.6; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.strokeStyle = rgba(tint); ctx.lineWidth = 4.5; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.fillStyle = rgba(tint); ctx.strokeStyle = rim; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(hx, hy, 4.6 * Math.min(1, h * 1.5), 0, TAU); ctx.fill(); ctx.stroke();
    }

    let ang;
    if (s === 'needs') { const n = st.np; ang = Math.sin(t * 11) * .42 * P.bounce * (st.reduce ? .25 : 1) * Math.max(n.hop, n.remind) + Math.sin(t * 1.7) * .12; }
    else if (s === 'error') ang = 1.75 + Math.sin(t * 1.6) * .06;
    else if (s === 'done') ang = Math.sin(t * 2.2) * .1;
    else ang = Math.sin(t * 1.7) * .2;
    // Fed up: the antenna flops over to the side as in error (the spring adds a small bounce), and springs back after.
    if (st.fed > .001) ang = lerp(ang, 1.75, st.fed);
    const L = 27, by = -14, ex = Math.sin(ang) * L, ey = by - Math.cos(ang) * L;
    const qx = Math.sin(ang * .35) * L * .55, qy = by - L * .6;
    ctx.strokeStyle = rimColour(c, 1); ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, by); ctx.quadraticCurveTo(qx, qy, ex, ey); ctx.stroke();

    // Working: a light climbs the antenna, small at the base and speeding up, with a short trail;
    // the bulb flashes and ripples when it arrives.
    let flash = 0, ripple = -1, climb = -1;
    const onStalk = u => [2 * (1 - u) * u * qx + u * u * ex, (1 - u) * (1 - u) * by + 2 * (1 - u) * u * qy + u * u * ey];
    if (s === 'working') {
      const ph = (t * .85) % 1;
      if (ph < .55) climb = Math.pow(ph / .55, 1.6);
      else { flash = Math.exp(-(ph - .55) * 7); ripple = (ph - .55) / .45; }
    }
    // Error: the bulb flickers like a faulty light every few seconds, and stays dim in between.
    let bulbAlpha = s === 'working' ? .5 + .5 * flash : 1;
    if (s === 'error' && P.mError && st.age >= 0) {
      const ph = st.age % 6;
      bulbAlpha = ph < .55 ? (Math.sin(t * 46) > -.2 ? 1 : .25) : .4;
    }
    // Fed up: the bulb dims.
    bulbAlpha *= 1 - .55 * clamp(st.fed, 0, 1);

    const n = 2 + (1 - P.round) * 3;
    ctx.save(); ctx.translate(0, 10);
    superPath(ctx, 31, 29, n, th => 1 + .13 * Math.sin(th));
    const g = ctx.createLinearGradient(0, -29, 0, 29);
    g.addColorStop(0, rgba(shade(tint, .25))); g.addColorStop(1, rgba(shade(tint, -.08)));
    glow(ctx, st, c, P.glow * 9); ctx.fillStyle = g; ctx.fill(); outline(ctx, st, c, 3.4);
    ctx.restore();

    if (climb >= 0) {
      ctx.save(); glow(ctx, st, c, 8); ctx.fillStyle = rgba(shade(c, .65));
      for (let i = 3; i >= 0; i--) {
        const ui = climb - i * .07; if (ui <= 0) continue;
        const [x, y] = onStalk(ui);
        if (y > -19) continue; // still inside the body
        ctx.globalAlpha = st.alpha * (i ? .22 * (4 - i) / 3 : 1);
        ctx.beginPath(); ctx.arc(x, y, (1.1 + 1.6 * ui) * (i ? .8 : 1), 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    drawBulb(ctx, st, ex, ey, flash, ripple, bulbAlpha, rim, st.night && s === 'working');
    if (st.leaf > .02) drawLeaf(ctx, st, ex, ey, Math.min(1.15, st.leaf));
    if (st.roll > .02) {
      // On a roll: three small stars circling the bulb.
      ctx.save(); ctx.globalAlpha = st.alpha * Math.min(1, st.roll); ctx.fillStyle = rgba(shade(c, .7)); glow(ctx, st, c, 5);
      for (let i = 0; i < 3; i++) {
        const an = (st.reduce ? 0 : t * 3) + i * TAU / 3;
        twinkle(ctx, ex + Math.cos(an) * 14, ey + Math.sin(an) * 9, 4);
      }
      ctx.restore();
    }

    eyes(ctx, st, { y: 8, gap: 10, r: 4.7, style: 'dot', ink: INK, ly: s === 'working' ? -1.6 : 0, lx: s === 'working' ? Math.sin(t * .9) * 1.5 : 0 });
    mouth(ctx, st, { y: 19, w: 8, ink: INK });
  }

  // The antenna bulb at (ex, ey): done star, working ripple, then the bulb with its rim and shine.
  function drawBulb(ctx, st, ex, ey, flash, ripple, bulbAlpha, rim, night) {
    const P = st.P, c = st.col, t = st.t, s = st.state;
    ctx.save();
    if (s === 'done') { ctx.fillStyle = rgba(shade(c, .6)); twinkle(ctx, ex, ey, 13, t * .8); }
    if (ripple >= 0 && ripple < 1) {
      ctx.strokeStyle = rgba(shade(c, .5), .6 * (1 - ripple)); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(ex, ey, 7 + ripple * 9, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = st.alpha * bulbAlpha;
    const br = s === 'needs' ? 7 + 1.3 * Math.sin(t * 10) : 6.5 + 1.2 * flash;
    glow(ctx, st, c, (6 + P.glow * 22 + flash * 10) * bulbAlpha); ctx.fillStyle = rgba(c);
    if (night) {
      // Night owl: a crescent moon, the bulb with a bite taken out of its upper right.
      ctx.save(); ctx.beginPath(); ctx.arc(ex, ey, br + 1, 0, TAU); ctx.clip();
      ctx.beginPath(); ctx.arc(ex, ey, br, 0, TAU);
      ctx.moveTo(ex + br * 1.32, ey - br * .35); ctx.arc(ex + br * .5, ey - br * .35, br * .82, 0, TAU, true); ctx.fill('evenodd');
      ctx.restore(); ctx.restore();
      return;
    }
    ctx.beginPath(); ctx.arc(ex, ey, br, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0; ctx.strokeStyle = rim; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.beginPath(); ctx.arc(ex - br * .35, ey - br * .35, br * .3, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // A small leaf growing from the top of the bulb (g: 0 to 1), tilted to the right with a gentle wiggle.
  function drawLeaf(ctx, st, ex, ey, g) {
    const len = 13 * g, a = -.5 + (st.reduce ? 0 : Math.sin(st.t * 3) * .15);
    ctx.save(); ctx.translate(ex, ey - 6); ctx.rotate(a); ctx.globalAlpha = st.alpha;
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * .55, -len * .15, len, -len * .9); ctx.quadraticCurveTo(-len * .05, -len * .75, 0, 0);
    ctx.fillStyle = rgba(LEAF); ctx.fill();
    ctx.lineWidth = 1.4; ctx.strokeStyle = rgba(mix(shade(LEAF, -.55), INK_RGB, .45)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len * .7, -len * .6); ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }

  // Canvas size in CSS pixels with room for hops (up to Bounce 2), antenna, raised hand, poke burst and glow
  // around a body of `size` px. The character is centred at 60% of the height.
  function canvasSize(size) {
    const k = size / UNITS_PER_SIZE;
    return { width: Math.ceil(150 * k), height: Math.ceil(190 * k) };
  }

  function create(canvas, opts = {}) {
    const ctx = canvas.getContext('2d');
    let P = merge(DEFAULTS, opts.settings);
    const size = opts.size || 32;
    const S = {
      state: 'hidden', shown: 'working', age: 0, t: 0, blend: 1, blinkClock: 1.2, blinkFactor: 1, double: false,
      pokeAge: 9, bubbleAge: 9, streak: 0, leafOn: false, luckyUntil: 0, leaf: { x: 0, v: 0 }, doneRun: 0, rollUntil: 0, roll: { x: 0, v: 0 }, partyAge: 9, partyDay: '', holdAt: 0, hour: 12, hourAt: -1e9, lastClick: -1e9, fedUntil: 0, fed: { x: 0, v: 0 }, phewAge: 9, changeAge: 9, attend: 0, mouseAt: -1e9,
      read: { i: 0, clock: 0, x: 0, y: 0, tx: 0, ty: 0 }, glanceAge: 9, glanceIn: 6,
      vis: { x: 0, v: 0 }, hand: { x: 0, v: 0 },
      look: { x: 0, y: 0 }, mouse: null, col: [79, 140, 255], colFrom: [79, 140, 255]
    };
    let raf = 0, last = 0, cw = 0, ch = 0, dpr = 1, rect = null, rectAt = 0;
    const reduceMq = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;

    function targetCol(s) {
      const hsl = rgbToHsl(hexToRgb(P.colors[s]));
      hsl[0] = (hsl[0] + P.hue / 360 + 1) % 1;
      hsl[1] = clamp(hsl[1] * P.sat / 100, 0, 1);
      return hslToRgb(hsl);
    }
    function resize() {
      dpr = Math.min(root.devicePixelRatio || 1, 3);
      const fallback = canvasSize(size === 'fit' ? 32 : size);
      cw = canvas.clientWidth || fallback.width; ch = canvas.clientHeight || fallback.height;
      canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      rectAt = 0;
    }
    // Body size in CSS pixels: the given size, or as large as the canvas allows with 'fit'.
    const drawPx = () => size === 'fit' ? Math.min(cw / 150, ch / 190) * UNITS_PER_SIZE : size;
    // Body plus room above for the antenna (14 units) and the needs-you hop (21 units at Bounce 1),
    // a little wider than the body for the raised hand.
    function bodyBox() {
      const r = canvas.getBoundingClientRect(), u = drawPx() / UNITS_PER_SIZE;
      const top = BOX.cy - BOX.ry - 14 - 21 * P.bounce, bottom = BOX.cy + BOX.ry, half = BOX.rx + 5;
      return { x: r.left + cw / 2 - half * u, y: r.top + ch * .6 + top * u, w: half * 2 * u, h: (bottom - top) * u };
    }
    function start() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }

    const today = () => (opts.date ? opts.date() : new Date());
    // Egg lines come just after the done hop starts, and only if Sprout is still done by then.
    let eggTimer = 0;
    function sayLater(text) {
      clearTimeout(eggTimer);
      // The egg takes over the done line but keeps its detail and stays at least as long.
      eggTimer = setTimeout(() => {
        if (S.state === 'done') say(text, true, Math.max(BUBBLE_TIME * 1000, bubbleUntil - performance.now()), bubbleOpen ? bubbleDetail : null);
      }, 400);
    }
    // A done moment: birthday confetti once a day, every ROLL_EVERY in a row stars, sometimes a lucky leaf.
    function doneEggs() {
      const now = performance.now(), d = today(), key = d.toDateString();
      S.doneRun++;
      if (d.getMonth() === EGGS.BIRTHDAY[0] && d.getDate() === EGGS.BIRTHDAY[1] && S.partyDay !== key) {
        S.partyDay = key; S.partyAge = 0; sayLater('Happy birthday, Blip!');
      } else if (S.doneRun % EGGS.ROLL_EVERY === 0) {
        S.rollUntil = now + EGGS.ROLL_MS; sayLater(S.doneRun + ' in a row!');
      }
      if (Math.random() < (opts.luck != null ? opts.luck : EGGS.LUCK)) S.luckyUntil = now + EGGS.LUCKY_MS;
    }
    function setState(s) {
      if (!STATES.includes(s)) return;
      const newDone = s === 'done' && (S.shown !== 'done' || S.state === 'hidden');
      if (s !== 'hidden' && s !== S.shown) {
        // A new state (Claude finished, needs you...) beats a sulk: drop the fed-up mood and its line.
        S.fedUntil = 0; S.streak = 0; hideBubble();
      }
      // Blip repeats events (working on every tool call, needs you twice for one request), so the same state
      // again keeps its timeline; only a real change, or coming back from hidden, restarts it.
      if (s !== 'hidden' && (s !== S.shown || S.state === 'hidden')) {
        S.changeAge = 0;
        S.colFrom = S.vis.x < .05 ? targetCol(s) : S.col.slice();
        S.blend = 0;
        S.shown = s; S.age = 0;
      }
      if (P.eggs && newDone) doneEggs();
      if (s === 'error') S.doneRun = 0;
      S.state = s;
      if (s === 'hidden') { hideBubble(); S.leafOn = false; S.luckyUntil = 0; }
      start();
    }
    // Bubble lines per state; opts.lines can replace them (for example for another language).
    const lines = { ...LINES, ...(opts.lines || {}) }, fedLines = { ...FED_LINES, ...(opts.fedLines || {}) };
    function poke() {
      if (S.vis.x < .3) return;
      const now = performance.now();
      S.streak = now - S.lastClick < STREAK_GAP ? S.streak + 1 : 1; S.lastClick = now;
      S.pokeAge = 0;
      if (S.streak >= FED_AT) {
        // Fed up while the clicks keep coming; the line is announced once, then just kept open.
        S.fedUntil = now + FED_HOLD;
        say(fedLines[S.shown], S.streak === FED_AT, FED_HOLD);
      } else if (S.streak === LINE_AT) say(lines[S.shown]);
      start();
    }
    function lookAt(x, y) { S.mouse = { x, y }; S.mouseAt = performance.now(); }

    // Speech bubble: a small HTML element next to the canvas (text at canvas scale would be too small at 32 px).
    let bubble = null, bubbleTimer = 0, bubbleOpen = false, bubbleText = '', bubbleDetail = null, bubbleUntil = 0;
    function hideBubble() {
      clearTimeout(bubbleTimer); bubbleOpen = false;
      S.bubbleAge = Math.max(S.bubbleAge, BUBBLE_TIME); // the curious tilt ends with the bubble
      if (bubble) { bubble.style.opacity = 0; bubble.style.transform = 'scale(.8)'; }
    }
    // announce: whether screen readers read it out (a new line yes, the same line kept open no).
    // hold: how long the bubble stays, in ms (the fed-up line stays as long as the fed-up face).
    // detail: a second, smaller line; left out, a bubble already showing the same line keeps its own.
    function say(text, announce = true, hold = BUBBLE_TIME * 1000, detail) {
      if (opts.bubble === false || S.state === 'hidden') return;
      // Restart the curious tilt only when the bubble was closed, so lines while it is open do not twitch.
      if (!bubbleOpen) S.bubbleAge = 0;
      const now = performance.now();
      // Same line already showing (clicks while fed up, or 3 clicks on a spoken line): keep it open,
      // never for less time than it already had.
      if (bubbleOpen && bubbleText === text && (detail === undefined || detail === bubbleDetail)) {
        hold = Math.max(hold, bubbleUntil - now);
        clearTimeout(bubbleTimer); bubbleTimer = setTimeout(hideBubble, hold); bubbleUntil = now + hold; return;
      }
      bubbleOpen = true; bubbleText = text; bubbleDetail = detail || null;
      if (!bubble) {
        bubble = document.createElement('div');
        Object.assign(bubble.style, {
          position: 'absolute', zIndex: 1, pointerEvents: 'none', whiteSpace: 'nowrap', // just above page content, under sticky bars
          font: '600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          color: '#1f1d2b', background: '#fff', padding: '6px 10px', borderRadius: '12px 12px 12px 3px',
          boxShadow: '0 2px 10px rgba(0,0,0,.25)', border: '1px solid rgba(0,0,0,.1)',
          transition: 'opacity .2s, transform .2s', opacity: 0, transform: 'scale(.8)', transformOrigin: 'left bottom'
        });
        document.body.appendChild(bubble);
      }
      bubble.setAttribute('aria-live', announce ? 'polite' : 'off');
      bubble.textContent = text;
      if (bubbleDetail) {
        const small = document.createElement('div');
        Object.assign(small.style, {
          fontSize: '11px', fontWeight: 400, lineHeight: 1.25, color: '#6b6878', marginTop: '2px',
          maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis'
        });
        small.textContent = bubbleDetail;
        bubble.appendChild(small);
      }
      // Bottom-left corner of the bubble just above and right of the head (24, -50 in drawing units),
      // or with opts.bubbleBeside beside the body at eye level (48, 6), for a window with little room above.
      const r = canvas.getBoundingClientRect(), u = drawPx() / UNITS_PER_SIZE;
      const [bx, by] = opts.bubbleBeside ? [48, 6] : [24, -50];
      // Right of the head when it fits in the window, otherwise mirrored to the left of it.
      let left = r.left + cw / 2 + bx * u;
      const flip = left + bubble.offsetWidth > root.innerWidth - 8;
      if (flip) left = Math.max(8, r.left + cw / 2 - bx * u - bubble.offsetWidth);
      bubble.style.borderRadius = flip ? '12px 12px 3px 12px' : '12px 12px 12px 3px';
      bubble.style.transformOrigin = flip ? 'right bottom' : 'left bottom';
      bubble.style.left = (left + root.scrollX) + 'px';
      bubble.style.top = (r.top + root.scrollY + ch * .6 + by * u - bubble.offsetHeight) + 'px';
      requestAnimationFrame(() => { bubble.style.opacity = 1; bubble.style.transform = 'scale(1)'; });
      clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(hideBubble, hold); bubbleUntil = now + hold;
    }
    const onMove = e => lookAt(e.clientX, e.clientY);
    // Pointer on Sprout: a press shorter than the hold time is a click (poke on release); holding long enough
    // grows the leaf instead (see frame), with no click. Public so a host can mirror one press to several Sprouts.
    function press() { S.holdAt = performance.now(); start(); }
    function release() {
      if (!S.holdAt) return;
      const held = performance.now() - S.holdAt; S.holdAt = 0;
      if (held < EGGS.HOLD_MS) poke();
    }
    function cancel() { S.holdAt = 0; }

    function frame(now) {
      raf = 0;
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      // Moving to a screen with another pixel density changes the ratio without any resize.
      if (Math.min(root.devicePixelRatio || 1, 3) !== dpr) resize();
      const sp = P.speed;
      S.t += dt * sp; S.age += dt * sp;
      S.pokeAge += dt * sp; S.bubbleAge += dt * sp; S.phewAge += dt * sp; S.changeAge += dt * sp; S.glanceAge += dt * sp;
      // Attend: 1 while the cursor has moved in the last 1.5 s, easing back to 0 so working eyes return to reading.
      S.attend += ((P.follow && now - S.mouseAt < 1500 ? 1 : 0) - S.attend) * Math.min(1, dt * 6);
      // Reading: three lines of four fixations, a longer pause at each line end.
      const R = S.read;
      if (S.shown === 'working' && (R.clock -= dt * sp) <= 0) {
        R.i = (R.i + 1) % 12;
        const col = R.i % 4, line = Math.floor(R.i / 4);
        R.tx = -2.4 + col * 1.6; R.ty = -.8 + line * .8;
        R.clock = col === 3 ? .6 : .22 + Math.random() * .3;
      }
      R.x += (R.tx - R.x) * Math.min(1, dt * 30); R.y += (R.ty - R.y) * Math.min(1, dt * 30);
      if (S.shown === 'working' && (S.glanceIn -= dt * sp) <= 0) { S.glanceAge = 0; S.glanceIn = 8 + Math.random() * 7; }

      const w = 4 / P.trans, k = w * w, hidden = S.state === 'hidden';
      spring(S.vis, hidden ? 0 : 1, dt, k, hidden ? .9 : .5);
      const np = needsPhase(S.age);
      spring(S.hand, !hidden && S.shown === 'needs' && P.mHand && np.handUp && S.fed.x < .5 ? 1 : 0, dt, k, .4);
      S.blend = Math.min(1, S.blend + dt / P.trans);
      S.col = mix(S.colFrom, targetCol(S.shown), easeOut(S.blend));

      // Blinks: random gaps around blinkEvery and an occasional double blink when natural blinks are on.
      S.blinkClock += dt;
      if (S.blinkClock > P.blinkEvery * S.blinkFactor) {
        S.blinkClock = 0;
        S.blinkFactor = P.mBlink ? .5 + Math.random() : 1;
        S.double = P.mBlink && Math.random() < .2;
      }
      const one = x => x >= 0 && x < .14 ? Math.sin(x / .14 * Math.PI) : 0;
      const blink = Math.max(one(S.blinkClock), S.double ? one(S.blinkClock - .22) : 0, one(S.phewAge - .1));

      const scale = drawPx() / UNITS_PER_SIZE, kpx = dpr * scale, cy = ch * .6;
      // Eyes follow the cursor: aim from the character towards it, eased.
      let tx = 0, ty = 0;
      if (S.mouse && (!rect || now - rectAt > 500)) { rect = canvas.getBoundingClientRect(); rectAt = now; }
      if (P.follow && S.mouse) {
        const dx = S.mouse.x - (rect.left + cw / 2), dy = S.mouse.y - (rect.top + cy), d = Math.hypot(dx, dy);
        // lookRange scales how far the eyes travel (1 = 3.2 units sideways, 2.6 up and down).
        if (d > 1) { const f = Math.min(1, d / 250) * P.lookRange; tx = dx / d * f * 3.2; ty = dy / d * f * 2.6; }
      }
      S.look.x += (tx - S.look.x) * .18; S.look.y += (ty - S.look.y) * .18;
      // Fed up: on while the clicks keep coming; when they stop the antenna springs back with a "phew".
      // Easter eggs: the leaf grows while held long enough (or by luck), the stars after a run of done moments.
      if (P.eggs && S.holdAt && now - S.holdAt > EGGS.HOLD_MS && S.state !== 'hidden') { S.leafOn = true; S.holdAt = 0; }
      spring(S.leaf, P.eggs && (S.leafOn || now < S.luckyUntil) ? 1 : 0, dt, 110, .35);
      spring(S.roll, P.eggs && now < S.rollUntil ? 1 : 0, dt, 110, .6);
      S.partyAge += dt * sp;
      if (now - S.hourAt > 60000) { S.hour = today().getHours(); S.hourAt = now; } // night owl: once a minute
      const fedUp = now < S.fedUntil;
      if (S.fed.x > .5 && !fedUp && S.phewAge > 1) S.phewAge = 0;
      spring(S.fed, fedUp ? 1 : 0, dt, 90, .45);

      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Fully hidden and at rest: stop the loop until setState or poke starts it again.
      if (hidden && S.vis.x <= .002 && Math.abs(S.vis.v) < .01) return;
      if (S.vis.x > .002) {
        const lead = (S.shown === 'done' && P.mDone) || (S.shown === 'error' && P.mError) ? LEAD[S.shown] : 0;
        const reduce = !!(reduceMq && reduceMq.matches), v = S.vis.x;
        // Appear and hide from the top edge: slide down from above and settle with the spring's small bounce
        // (a plain fade with Reduce Motion).
        const alpha = reduce ? clamp(v, 0, 1) : clamp(v * 2, 0, 1), slide = reduce ? 0 : (1 - v) * -120;
        const st = {
          state: S.shown, t: S.t, age: S.age - lead, raw: S.age, col: S.col, P, blink, k: kpx,
          read: R, glance: glanceOffset(S.glanceAge), hand: S.hand.x, look: S.look,
          changeAge: S.changeAge, pokeAge: S.pokeAge, bubbleAge: S.bubbleAge, fed: S.fed.x, phewAge: S.phewAge, leaf: S.leaf.x, roll: S.roll.x, night: P.eggs && S.shown === 'working' && S.hour < 5, attend: S.attend, reduce, alpha, np
        };
        const m = motion(st);
        ctx.setTransform(kpx, 0, 0, kpx, cw * dpr / 2, cy * dpr);
        ctx.save(); ctx.translate(m.x, m.y + slide); ctx.rotate(m.rot); ctx.globalAlpha = alpha;
        // Same size in every state; needs you starts with a short grow-and-settle pop.
        const pop = S.shown === 'needs' && S.age < .45 ? 1 + (reduce ? .04 : .12) * Math.sin(S.age / .45 * Math.PI) : 1;
        const s = (reduce ? 1 : .75 + .25 * v) * pop; ctx.scale(s, s);
        if (P.backing > 0) {
          const pad = 9;
          ctx.fillStyle = `rgba(14,15,20,${P.backing})`;
          rrect(ctx, -BOX.rx - pad, BOX.cy - BOX.ry - pad, (BOX.rx + pad) * 2, (BOX.ry + pad) * 2, Math.min(BOX.rx, BOX.ry) * .6 + pad);
          ctx.fill();
        }
        ctx.save(); drawSprout(ctx, st, m); ctx.restore();
        if (S.pokeAge < .6 && (S.shown === 'done' || S.shown === 'needs')) {
          const p = S.pokeAge / .6, c = st.col;
          ctx.fillStyle = rgba(shade(c, .6)); glow(ctx, st, c, 5);
          for (let i = 0; i < 8; i++) {
            const an = i * TAU / 8 + .2;
            twinkle(ctx, Math.cos(an) * (BOX.rx + 4 + p * 22), BOX.cy + Math.sin(an) * (BOX.ry + 4 + p * 22), 4.5 * (1 - p));
          }
        }
        ctx.restore();
        // Birthday confetti, drawn outside the character's tilt and squash: pieces fall from above the head and fade out (left out with Reduce Motion).
        if (P.eggs && S.partyAge < EGGS.PARTY_MS / 1000 && !reduce) {
          const pa = S.partyAge;
          for (let i = 0; i < 16; i++) {
            const x = (hash(i) - .5) * 90 + Math.sin(pa * 4 + i) * 4, y = -80 + pa * 55 + hash(i + 40) * 30;
            ctx.save(); ctx.translate(x, y); ctx.rotate(pa * 6 * (hash(i + 9) - .5) * 2);
            ctx.globalAlpha = alpha * Math.max(0, 1 - pa / (EGGS.PARTY_MS / 1000));
            ctx.fillStyle = CONFETTI[i % CONFETTI.length]; ctx.fillRect(-2, -1.2, 4, 2.4);
            ctx.restore();
          }
        }
      }
      raf = requestAnimationFrame(frame);
    }

    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(canvas);
    if (opts.pointer !== false) root.addEventListener('pointermove', onMove);
    // Only the main button counts: a right-click opens its menu and leaves Sprout alone.
    const POINTER = { pointerdown: e => { if (e.button === 0) press(); }, pointerup: e => { if (e.button === 0) release(); }, pointerleave: cancel, pointercancel: cancel };
    if (opts.handlePress !== false) for (const ev in POINTER) canvas.addEventListener(ev, POINTER[ev]);

    return {
      setState, poke, press, release, cancel, lookAt, say, bodyBox,
      // Changes only the settings given; the rest keep their current values.
      update(settings) { P = merge(P, settings); start(); },
      get state() { return S.state; },
      get line() { return lines[S.shown]; },
      get running() { return raf !== 0; },
      destroy() {
        if (raf) cancelAnimationFrame(raf); raf = 0;
        clearTimeout(bubbleTimer); clearTimeout(eggTimer); if (bubble) bubble.remove();
        if (ro) ro.disconnect();
        root.removeEventListener('pointermove', onMove);
        for (const ev in POINTER) canvas.removeEventListener(ev, POINTER[ev]);
      }
    };
  }

  root.BlipSprout = { create, canvasSize, DEFAULTS, STATES, withDefaults: s => merge(DEFAULTS, s) };
})(typeof window !== 'undefined' ? window : globalThis);
