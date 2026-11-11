/* Kept website: every motion on the home page. Vanilla JS, no dependencies; nothing here talks to the network, stores
 * anything or reads anything about the visitor. Only transform and opacity ever animate.
 *
 * 1. The loops (the hero phone and the feature stages). Each is a script of tweens ("at 2150 ms, move the tray to y 0 on
 *    the navigation spring"), the same idea as the app's DemoStage: time -> state is a pure script, the clock only drives it.
 *    `Loop.build()` compiles a script into ONE infinite Web Animation per element and property, all sharing a start time,
 *    so the browser runs them on the compositor with no per-frame JS; pause, resume and seek are exact. A feature loop is
 *    built the first time its stage comes near the viewport, never at boot, and lets go of its animations (and so of its
 *    compositor layers) when it is far from the viewport again. Big numbers roll digit by digit and short labels morph
 *    letter by letter, like the app's AnimatedAmountLabel and MorphingLabel; small secondary numbers roll as whole lines
 *    and longer captions morph word by word, so no loop pays a layer per letter where it buys nothing.
 * 2. The chip field (Kept's onboarding backdrop) behind the hero: chips lean away from the pointer, make room near it,
 *    ripple on a click or tap and drift as the page scrolls; rAF runs only on a pointer move.
 * 3. The hero headline: one word morphs letter by letter while its category disc turns, on its own loop of timers
 *    (coffee, groceries, rent, takeout, flights, gifts), with a long hold on "Your [Kept icon] spending, kept.".
 * Everything pauses off screen, in a hidden tab and from its own disc; Reduce Motion gets still frames and cross-fades.
 */
(() => {
  'use strict';

  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
  // The app's springs (Shared/DesignSystem/Motion.swift), sampled into linear() by the brief's springs.py. Browsers without
  // linear() get cubic-béziers fitted to the same spring curves (rms error about 1 %, the small overshoot kept via y2 > 1).
  const canLinear = !!(window.CSS && CSS.supports && CSS.supports('transition-timing-function', 'linear(0, 1)'));
  const E = canLinear ? {
    on: 'linear(0.000, 0.056, 0.181, 0.332, 0.480, 0.613, 0.724, 0.812, 0.878, 0.926, 0.959, 0.982, 0.995, 1.003, 1.007, 1.009, 1.009, 1.008, 1.006, 1.005, 1.004, 1.003, 1.002, 1.001, 1.000)',
    nav: 'linear(0.000, 0.088, 0.253, 0.417, 0.557, 0.669, 0.754, 0.819, 0.866, 0.902, 0.928, 0.947, 0.961, 0.972, 0.979, 0.985, 0.989, 0.992, 0.994, 0.996, 0.997, 0.998, 0.998, 0.999, 1.000)',
    swipe: 'linear(0.000, 0.054, 0.176, 0.323, 0.469, 0.599, 0.709, 0.797, 0.864, 0.913, 0.948, 0.972, 0.988, 0.998, 1.003, 1.006, 1.006, 1.006, 1.006, 1.005, 1.004, 1.003, 1.002, 1.001, 1.000)'
  } : {
    on: 'cubic-bezier(0.320, 0.639, 0.069, 1.119)',    // Motion.Spring.onScreen, 370 ms
    nav: 'cubic-bezier(0.247, 0.614, 0.066, 1.049)',   // Motion.Spring.navigation, 540 ms
    swipe: 'cubic-bezier(0.308, 0.577, 0.070, 1.121)'  // Motion.Spring.horizontalSwipe, 310 ms
  };
  // web-only, not an app spring: a softer one (400 / 26, about 7 % overshoot) for the tap ripple
  E.delight = canLinear ? 'linear(0.000, 0.030, 0.107, 0.213, 0.333, 0.457, 0.576, 0.685, 0.781, 0.862, 0.928, 0.979, 1.016, 1.042, 1.058, 1.066, 1.068, 1.066, 1.060, 1.053, 1.045, 1.036, 1.028, 1.021, 1.014, 1.009, 1.005, 1.001, 0.999, 0.997, 0.996, 0.995, 0.995, 0.996, 0.996, 0.996, 0.997, 0.998, 0.998, 0.999, 1.000)' : 'cubic-bezier(.3, 1.35, .5, 1)';
  E.lin = 'linear';
  E.out = 'cubic-bezier(.2,.7,.3,1)';
  E.io = 'cubic-bezier(.45,0,.55,1)';
  E.in = 'cubic-bezier(.5,0,.9,.4)';
  const D = { on: 370, nav: 540, swipe: 310 };

  /* ------------------------------------------------------------------ engine */

  const ID = { x: 0, xp: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 };
  const r3 = n => Math.round(n * 1000) / 1000;
  // xp: a share of the element's own width (in %), for controls whose size follows the layout.
  const T = g => `translate(${g.xp ? `calc(${r3(g.xp)}% + ${r3(g.x)}px)` : `${r3(g.x)}px`}, ${r3(g.y)}px) rotate(${r3(g.r)}deg) scale(${r3(g.s * g.sx)}, ${r3(g.s * g.sy)})`;

  class Loop {
    constructor(name, L) { this.name = name; this.L = L; this.tracks = new Map(); this.anims = []; this.playing = false; }
    tr(el) {
      let t = this.tracks.get(el);
      if (!t) { t = { g: { ...ID }, o: 1, oSet: false, gSet: false, tf: [], op: [] }; this.tracks.set(el, t); }
      return t;
    }
    /** State at t = 0 (and the static frame without animations). */
    init(el, st) {
      if (!el) return this;
      const t = this.tr(el);
      for (const k in st) { if (k === 'o') { t.o = st.o; t.oSet = true; } else if (k in ID) { t.g[k] = st[k]; t.gSet = true; } }
      return this;
    }
    /** At `at` ms, go to `st` over `dur` ms. Opacity may have its own duration (`od`), easing (`oe`) and delay (`odl`). */
    to(el, at, st, dur = D.on, ease = E.on) {
      if (!el) return this;
      const t = this.tr(el);
      const g = {}; let geo = false;
      for (const k in st) if (k in ID) { g[k] = st[k]; geo = true; }
      if (geo) t.tf.push({ at, dur, v: g, ease });
      if ('o' in st) t.op.push({ at: at + (st.odl || 0), dur: st.od ?? dur, v: st.o, ease: st.oe ?? (st.od != null ? E.lin : ease) });
      return this;
    }
    fade(el, at, o, dur = 200, ease = E.lin) { return this.to(el, at, { o, od: dur, oe: ease }, dur, ease); }
    jump(el, at, st) { return this.to(el, at, { ...st, od: 0 }, 0, E.lin); }

    build() {
      for (const [el, t] of this.tracks) {
        if (t.gSet || t.tf.length) el.style.transform = T(t.g);
        if (t.oSet || t.op.length) el.style.opacity = t.o;
        if (t.tf.length) this.anims.push(this.compile(el, 'transform', t.tf, t.g, true));
        if (t.op.length) this.anims.push(this.compile(el, 'opacity', t.op, t.o, false));
      }
      this.seek(0);
      return this;
    }
    compile(el, prop, segs, init, geo) {
      segs.sort((a, b) => a.at - b.at);
      const L = this.L, fmt = geo ? T : (v => String(r3(Math.min(1, Math.max(0, v)))));
      let cur = geo ? { ...init } : init, last = 0;
      const kf = [{ offset: 0, [prop]: fmt(cur), easing: 'linear' }];
      for (const s of segs) {
        if (s.at < last - 1 && location.hash.includes('debug')) console.warn(`[${this.name}] overlapping ${prop} tween at ${s.at} (busy until ${last})`, el);
        const at = Math.min(Math.max(s.at, last), L), end = Math.min(at + s.dur, L);
        kf.push({ offset: at / L, [prop]: fmt(cur), easing: end > at ? s.ease : 'linear' });
        cur = geo ? { ...cur, ...s.v } : s.v;
        kf.push({ offset: end / L, [prop]: fmt(cur), easing: 'linear' });
        last = end;
      }
      kf.push({ offset: 1, [prop]: fmt(cur) });
      const a = el.animate(kf, { duration: L, iterations: Infinity, fill: 'both' });
      a.pause();
      return a;
    }
    get time() { if (this.rel != null) return this.rel; const a = this.anims[0]; return a ? (a.currentTime || 0) % this.L : 0; }
    seek(ms) { this.wake(); for (const a of this.anims) { a.pause(); a.currentTime = ms; } this.playing = false; }
    /** Far off screen: cancel every animation, so their elements stop being compositor layers, and keep the time. */
    sleep() {
      if (this.rel != null || !this.anims.length) return;
      const t = this.time;
      this.pause();
      for (const a of this.anims) a.cancel();
      this.rel = t;
    }
    /** Back near the viewport: the same animations again, paused at the time they left (a cancelled one revives on a seek). */
    wake() {
      if (this.rel == null) return;
      const t = this.rel; this.rel = null;
      for (const a of this.anims) { a.currentTime = t; a.pause(); }
    }
    play() {
      if (this.playing || !this.anims.length) return;
      this.wake();
      this.playing = true;
      const now = document.timeline.currentTime;
      const start = now - this.time;
      for (const a of this.anims) a.startTime = start;
    }
    pause() {
      if (!this.playing) return;
      this.playing = false;
      const t = this.time;
      for (const a of this.anims) { a.pause(); a.currentTime = t; }
    }
  }

  /* ------------------------------------------------- rolling numbers, morphing labels */

  function measurer(el) {
    // A custom element, so no page rule aimed at spans can change its box while it measures.
    const m = document.createElement('x-m');
    m.setAttribute('aria-hidden', 'true');
    m.style.cssText = 'position:absolute!important;left:0!important;top:0!important;visibility:hidden!important;white-space:pre!important;display:inline-block!important;transform:none!important;width:auto!important;height:auto!important;margin:0!important;padding:0!important;border:0!important';
    el.appendChild(m);
    m.textContent = '0'.repeat(40);
    const k = (m.getBoundingClientRect().width / (m.offsetWidth || 1)) || 1;
    return { w: s => { m.textContent = s; return m.getBoundingClientRect().width / k; }, done: () => m.remove() };
  }

  /**
   * Draws `el`'s text as positioned glyphs and scripts its changes.
   * seq: [{ at, text, dir?, instant? }], seq[0].at = 0. mode 'roll' (digits slide, dir +1 = up) or 'morph' (letters fade
   * and shared ones glide; `side` makes entering letters arrive sideways, as after a swipe).
   */
  function textSeq(loop, el, seq, o = {}) {
    if (!el) return;
    const mode = o.mode || 'roll';
    const cs = getComputedStyle(el);
    const ta = cs.textAlign;
    const align = ta === 'center' ? 'center' : (ta === 'right' || ta === 'end') ? 'right' : 'left';
    const W = el.clientWidth, H = el.clientHeight || parseFloat(cs.lineHeight) || 20;
    const meas = measurer(el);
    const lays = seq.map(s => {
      const xs = [];
      for (let i = 0; i < s.text.length; i++) xs.push(meas.w(s.text.slice(0, i)));
      const total = meas.w(s.text);
      const off = align === 'center' ? (W - total) / 2 : align === 'right' ? W - total : 0;
      return xs.map(x => x + off);
    });
    if (o.fit) el.style.width = Math.ceil(Math.max(...seq.map(s => meas.w(s.text)))) + 'px';
    meas.done();
    while (el.firstChild) el.firstChild.remove();
    if (mode === 'roll' || mode === 'line') el.classList.add('roll');
    if (mode === 'line') {
      // A whole line rolls (the old one up and out, the new one up and in, the roll's own timing): for small secondary
      // numbers, where a layer per digit buys nothing. One span, one layer, per distinct line.
      const lines = new Map();
      const line = (text, k) => {
        let s = lines.get(text);
        if (!s) {
          s = document.createElement('span'); s.className = 'g'; s.textContent = text; el.appendChild(s);
          loop.init(s, { x: lays[k][0] || 0, y: 0, o: k ? 0 : 1 }); lines.set(text, s);
        }
        return s;
      };
      let prev = line(seq[0].text, 0);
      for (let k = 1; k < seq.length; k++) {
        const at = seq[k].at, next = line(seq[k].text, k), dir = seq[k].dir ?? 1, x = lays[k][0] || 0;
        if (next === prev) continue;
        if (seq[k].instant) loop.jump(prev, at, { o: 0 }).jump(next, at, { x, y: 0, o: 1 });
        else {
          loop.to(prev, at, { y: -dir * H * 0.8, o: 0, od: 200, oe: E.lin }, D.on, E.on);
          loop.jump(next, at - 1, { x, y: dir * H * 0.8 });
          loop.to(next, at, { y: 0, o: 1, od: 220, oe: E.lin, odl: 40 }, D.on, E.on);
        }
        prev = next;
      }
      return;
    }
    if (mode === 'words') {
      // Whole words morph: a word both lines share glides to its new place (longest common subsequence, so words never
      // cross), the others fade out, the new ones fade in one after another (`side`: arriving sideways, as after a swipe).
      // One layer per word instead of one per letter.
      const words = (text, k) => { const out = []; text.replace(/\S+/g, (w, i) => { out.push({ w, x: lays[k][i] }); return w; }); return out; };
      const pool = [];
      const mk = (w, x, op) => { const s = document.createElement('span'); s.className = 'g'; s.textContent = w; el.appendChild(s); loop.init(s, { x, o: op }); return { el: s, w, x, free: -1 }; };
      let cur = words(seq[0].text, 0).map(t => mk(t.w, t.x, 1));
      for (let k = 1; k < seq.length; k++) {
        const at = seq[k].at, inst = !!seq[k].instant, B = words(seq[k].text, k);
        const map = lcsMap(cur.map(g => g.w), B.map(t => t.w)), used = new Set(map);
        cur.forEach((g, i) => {
          if (used.has(i)) return;
          if (inst) loop.jump(g.el, at, { o: 0 }); else loop.fade(g.el, at, 0, 90);
          g.free = at + (inst ? 0 : 90); pool.push(g);
        });
        let n = 0;
        cur = B.map((t, j) => {
          const i = map[j];
          if (i >= 0) {
            const g = cur[i];
            if (Math.abs(g.x - t.x) > 0.01) inst ? loop.jump(g.el, at, { x: t.x }) : loop.to(g.el, at, { x: t.x }, D.on, E.on);
            g.x = t.x; return g;
          }
          const d = inst ? 0 : 80 + n++ * (o.stagger ?? 40), dx = inst ? 0 : (seq[k].side || 0) * H * 0.7;
          const pi = pool.findIndex(p => p.w === t.w && p.free <= at + d - 2);
          const g = pi >= 0 ? pool.splice(pi, 1)[0] : mk(t.w, t.x + dx, 0);
          if (pi >= 0 && Math.abs(g.x - (t.x + dx)) > 0.01) loop.jump(g.el, at + d - 1, { x: t.x + dx });
          if (inst) loop.jump(g.el, at, { x: t.x, o: 1 });
          else if (dx) loop.to(g.el, at + d, { x: t.x, o: 1, od: 200, oe: E.lin }, D.on, E.on);
          else loop.fade(g.el, at + d, 1, 200);
          g.x = t.x; return g;
        });
      }
      return;
    }
    if (mode === 'fade') {
      // Whole-line cross-fade with the morph's timing (out in 90 ms, in from 80 ms): for long secondary lines.
      const lines = new Map();
      const line = (text, i) => {
        if (lines.has(text)) return lines.get(text);
        const s = document.createElement('span'); s.className = 'g'; s.textContent = text; el.appendChild(s);
        loop.init(s, { x: lays[i][0] || 0, o: i ? 0 : 1 }); lines.set(text, s); return s;
      };
      let prev = line(seq[0].text, 0);
      for (let k = 1; k < seq.length; k++) {
        const next = line(seq[k].text, k);
        if (next === prev) continue;
        if (seq[k].instant) { loop.jump(prev, seq[k].at, { o: 0 }).jump(next, seq[k].at, { o: 1 }); }
        else { loop.fade(prev, seq[k].at, 0, 90).fade(next, seq[k].at + 80, 1, 200); }
        prev = next;
      }
      return;
    }
    // Glyphs that have left wait in a pool; a later state that needs the same letter at the same place reuses the span,
    // so a caption that cycles through three strings keeps three strings' worth of spans, not one per change.
    const pool = [];
    const mk = (ch, x, op) => {
      const s = document.createElement('span');
      s.className = 'g';
      s.textContent = ch;
      el.appendChild(s);
      loop.init(s, { x, y: 0, o: op });
      return { el: s, ch, x };
    };
    const reuse = (ch, x, at) => {
      const i = pool.findIndex(p => p.ch === ch && Math.abs(p.x - x) < 0.05 && p.free <= at - 2);
      return i < 0 ? null : pool.splice(i, 1)[0];
    };
    const retire = (g, until) => { g.free = until; pool.push(g); };
    let cur = [...seq[0].text].map((ch, i) => ch === ' ' ? null : mk(ch, lays[0][i], 1));
    for (let k = 1; k < seq.length; k++) {
      const A = seq[k - 1].text, B = seq[k].text, at = seq[k].at, inst = !!seq[k].instant;
      let p = 0; while (p < A.length && p < B.length && A[p] === B[p]) p++;
      let q = 0; while (q < A.length - p && q < B.length - p && A[A.length - 1 - q] === B[B.length - 1 - q]) q++;
      const next = new Array(B.length).fill(null);
      const keep = (ia, ib) => {
        const g = cur[ia]; if (!g) return;
        next[ib] = g;
        const nx = lays[k][ib];
        if (Math.abs(nx - g.x) > 0.01) inst ? loop.jump(g.el, at, { x: nx }) : loop.to(g.el, at, { x: nx }, D.on, E.on);
        g.x = nx;
      };
      for (let i = 0; i < p; i++) keep(i, i);
      for (let j = 0; j < q; j++) keep(A.length - 1 - j, B.length - 1 - j);
      const dir = seq[k].dir ?? 1;
      for (let i = p; i < A.length - q; i++) {
        const g = cur[i]; if (!g) continue;
        if (inst) { loop.jump(g.el, at, { o: 0 }); retire(g, at); }
        else if (mode === 'roll') { loop.to(g.el, at, { y: -dir * H * 0.8, o: 0, od: 200, oe: E.lin }, D.on, E.on); retire(g, at + D.on); }
        else { loop.to(g.el, at, { o: 0, od: 90, oe: E.lin }, 90, E.lin); retire(g, at + 90); }
      }
      let n = 0;
      for (let i = p; i < B.length - q; i++) {
        const ch = B[i]; if (ch === ' ') continue;
        const x = lays[k][i];
        if (inst) {
          const g = reuse(ch, x, at) || mk(ch, x, 0);
          loop.jump(g.el, at, mode === 'roll' ? { x, y: 0, o: 1 } : { x, o: 1 });
          g.x = x; next[i] = g;
        } else if (mode === 'roll') {
          const y0 = dir * H * 0.8;
          let g = reuse(ch, x, at);
          if (g) loop.jump(g.el, at - 1, { x, y: y0 }); else { g = mk(ch, x, 0); loop.init(g.el, { y: y0 }); }
          loop.to(g.el, at, { y: 0, o: 1, od: 220, oe: E.lin, odl: 40 }, D.on, E.on);
          g.x = x; next[i] = g;
        } else {
          const dx = (seq[k].side || 0) * H * 0.7;
          const d = 80 + n * (o.stagger ?? 12);
          let g = reuse(ch, x, at + d);
          if (g) { if (dx) loop.jump(g.el, at + d - 1, { x: x + dx }); } else g = mk(ch, x + dx, 0);
          if (dx) loop.to(g.el, at + d, { x, o: 1, od: 200, oe: E.lin }, D.on, E.on);
          else loop.fade(g.el, at + d, 1, 200);
          g.x = x; next[i] = g; n++;
        }
      }
      cur = next;
    }
  }

  const money = v => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* --------------------------------------------------------- scaled UI frames */

  const frames = $$('.frame[data-w]');
  const fit = f => { const w = f.clientWidth; if (w) f.style.setProperty('--s', String(w / Number(f.dataset.w))); };
  frames.forEach(fit);
  if ('ResizeObserver' in window) { const ro = new ResizeObserver(es => es.forEach(e => fit(e.target))); frames.forEach(f => ro.observe(f)); }


  /* ------------------------------------------------------------- the hero loop */

  function heroLoop() {
    const phone = $('[data-phone]'); if (!phone) return null;
    const C = 8000, R = 3 * C, L = R + 1200;
    const lp = new Loop('hero', L);
    const ui = $('[data-ui]', phone);
    const content = $('[data-content]', ui);
    const banners = $$('[data-banner]', ui);
    const scrim = $('[data-scrim]', ui);
    const tray = $('[data-tray]', ui);
    const tamt = $$('[data-tamt]', ui), tm = $$('[data-tm]', ui);
    const trHead = $('.tr-head', tray), grid = $('[data-grid]', ui);
    const cells = $$('[data-grid] .cell', ui).map(c => ({ tile: $('.tile', c), ring: $('.ring', c), spark: $('.spark', c) }));
    const done = $('[data-done]', ui), mcBase = $('[data-mcbase]', ui), mcOn = $('[data-mcon]', ui);
    const mcL = $('[data-mcl]', ui), mcM = $('[data-mcm]', ui), mcR = $('[data-mcr]', ui);
    const doneLabel = $('[data-donelabel]', ui), check = $('.mc-check', ui);
    const finger = $('[data-finger]', ui);
    const newRows = $$('[data-new]', ui).map(r => ({ row: r, tile: $('[data-newtile]', r), amt: $('[data-newamt]', r), t: $('.r-t', r), s: $('.r-s', r) }));
    const shift = $$('[data-shift]', ui);
    const caption = $('[data-caption]');

    // Geometry in points (the phone UI is a fixed 390 x 846 design).
    const trayTop = 846 - 10 - 450;
    const tileC = i => ({ x: 10 + 16 + (i % 4) * 84.5 + 42.25, y: trayTop + 184 + Math.floor(i / 4) * 96 + 4 + 28 });
    const slot0 = { iconX: 40, iconY: 302 + 40 + 12 + 20, amtR: 370, amtY: 302 + 40 + 21 + 10 };
    const doneC = { x: 195, y: 846 - 10 - 16 - 27 };
    const trayAmtC = { x: 195, y: trayTop + 64 + 25 };

    const pay = [
      { v: 5.40, cell: 0 }, { v: 23.18, cell: 1 }, { v: 12.50, cell: 2 }
    ];
    const total0 = 1329.60, day0 = 64.59, budget = 2100;

    // Rest state.
    lp.init(content, { o: 1 });
    banners.forEach(b => lp.init(b, { y: -110, o: 0 }));
    lp.init(scrim, { o: 0 }).init(tray, { y: 480 });
    tamt.forEach((a, i) => lp.init(a, { o: i ? 0 : 1 }));
    tm.forEach((a, i) => lp.init(a, { o: i ? 0 : 1 }));
    cells.forEach(c => { lp.init(c.ring, { s: 1.12, o: 0 }).init(c.spark, { o: 0 }).init(c.tile, { o: 1 }); });
    lp.init(trHead, { o: 1 }).init(grid, { o: 1 });
    lp.init(mcBase, { o: 1 }).init(mcOn, { o: 0 }).init(doneLabel, { o: 1 }).init(check, { s: 0.6, o: 0 });
    lp.init(finger, { x: 195, y: 90, s: 1.25, o: 0 });
    const amtW = newRows.map(r => r.amt.offsetWidth);
    // The payment travels from the tray into its row. The travelling copy lives in a layer ABOVE the tray (the list sits
    // under the scrim and the tray), and hands over to the real row the moment it lands, so only one is ever visible.
    newRows.forEach((r, j) => {
      const tc = tileC(pay[j].cell);
      r.dx = tc.x - slot0.iconX; r.dy = tc.y - slot0.iconY;
      r.adx = trayAmtC.x - (slot0.amtR - amtW[j] / 2); r.ady = trayAmtC.y - slot0.amtY;
      const fly = document.createElement('div');
      fly.className = 'row fly';
      fly.style.top = (302 + 40) + 'px';
      r.ftile = r.tile.cloneNode(true); r.famt = r.amt.cloneNode(true);
      [r.ftile, r.famt].forEach(n => n.removeAttribute('data-newtile'));
      fly.append(r.ftile, r.famt);
      tray.after(fly);
      lp.init(r.row, { o: 1, y: 0 });
      lp.init(r.tile, { o: 0 }).init(r.amt, { o: 0 });
      lp.init(r.ftile, { x: r.dx, y: r.dy, s: 1.4, o: 0 });
      lp.init(r.famt, { x: r.adx, y: r.ady, s: 42 / 17, o: 0 });
      lp.init(r.t, { x: 12, o: 0 }).init(r.s, { x: 12, o: 0 });
    });
    const barW = 350, bar = $('[data-bar]', ui);
    lp.init(bar, { x: (total0 / budget - 1) * barW });

    const capSeq = [{ at: 0, text: 'Pay with Apple Pay' }];
    const totals = [total0], days = [day0];

    for (let c = 0; c < 3; c++) {
      const T0 = c * C, p = pay[c], tc = tileC(p.cell), cell = cells[p.cell], row = newRows[c];
      if (c) capSeq.push({ at: T0, text: 'Pay with Apple Pay' });
      // this cycle's tray content, swapped while the tray is out of sight
      lp.jump(tamt[c], T0 + 100, { o: 1 }).jump(tm[c], T0 + 100, { o: 1 }).jump(cell.spark, T0 + 100, { o: 1 });

      // 1. Pay: the notification drops in
      const b = banners[c];
      lp.to(b, T0 + 600, { y: 0, o: 1, od: 200, oe: E.lin }, D.on, E.on);
      lp.to(finger, T0 + 1650, { x: 201, y: 96, s: 1.25 }, 0, E.lin);
      lp.to(finger, T0 + 1700, { s: 1, o: 1, od: 150 }, 220, E.out);
      lp.to(finger, T0 + 2000, { s: 0.82 }, 110, E.out).to(b, T0 + 2000, { s: 0.97 }, 110, E.out);
      lp.to(finger, T0 + 2150, { s: 1, o: 0, od: 200 }, 200, E.out);
      lp.to(b, T0 + 2150, { y: -36, s: 0.92, o: 0, od: 220 }, 280, E.io);
      lp.jump(b, T0 + 3000, { y: -110, s: 1 });

      // 2. Tap: the tray rises, a category is picked
      capSeq.push({ at: T0 + 2150, text: 'Tap a category' });
      lp.to(tray, T0 + 2150, { y: 0 }, D.nav, E.nav);
      lp.fade(scrim, T0 + 2150, 0.4, D.nav, E.nav);
      lp.to(finger, T0 + 2950, { x: tc.x + 14, y: tc.y + 22, s: 1.25 }, 0, E.lin);
      lp.to(finger, T0 + 3000, { x: tc.x, y: tc.y, s: 1, o: 1, od: 150 }, 380, E.on);
      lp.to(finger, T0 + 3500, { s: 0.82 }, 110, E.out).to(cell.tile, T0 + 3500, { s: 0.92 }, 110, E.out);
      lp.to(finger, T0 + 3610, { s: 1 }, 200, E.out).to(cell.tile, T0 + 3610, { s: 1 }, D.on, E.on);
      lp.to(cell.ring, T0 + 3610, { s: 1, o: 1, od: 150 }, D.on, E.on);
      lp.fade(mcBase, T0 + 3610, 0, 200).fade(mcOn, T0 + 3610, 1, 200);
      lp.to(finger, T0 + 4050, { x: doneC.x + 6, y: doneC.y + 4 }, 450, E.on);
      lp.to(finger, T0 + 4600, { s: 0.82 }, 110, E.out).to(done, T0 + 4600, { s: 0.97 }, 110, E.out);
      lp.to(finger, T0 + 4710, { s: 1, o: 0, od: 200 }, 200, E.out).to(done, T0 + 4710, { s: 1 }, D.on, E.on);

      // 3. Kept: Done morphs into a check, the tray sinks, the payment travels into the Log
      capSeq.push({ at: T0 + 4720, text: 'Logged. Nothing to type' });
      lp.fade(doneLabel, T0 + 4720, 0, 90);
      lp.to(mcL, T0 + 4720, { x: 142 }, D.on, E.on).to(mcR, T0 + 4720, { x: -142 }, D.on, E.on).to(mcM, T0 + 4720, { sx: 0.02 }, D.on, E.on);
      lp.to(check, T0 + 4800, { s: 1, o: 1, od: 160 }, D.on, E.on);
      // The hand-off. The tile and the amount leave the tray first and land in the free slot at the top of Today while
      // the tray still covers the rows; the tray's own lines clear out of their way; only then does the tray sink.
      // So nothing that travels ever crosses a row's text (the rows make room under the tray and the scrim).
      const H = T0 + 5250, SINK = H + 160;
      lp.to(tray, SINK, { y: 480 }, D.nav, E.nav);
      lp.fade(scrim, SINK, 0, 420, E.out);
      lp.jump(cell.tile, H, { o: 0 }).jump(cell.ring, H, { o: 0 }).jump(cell.spark, H, { o: 0 });
      lp.fade(tamt[c], H, 0, 60).fade(tm[c], H, 0, 70).fade(trHead, H, 0, 70).fade(grid, H, 0, 110);
      lp.jump(row.ftile, H, { o: 1 }).to(row.ftile, H + 20, { x: 0, y: 0, s: 1 }, D.on, E.on);
      lp.fade(row.famt, H, 1, 60).to(row.famt, H + 30, { x: 0, y: 0, s: 1 }, D.on, E.on);
      lp.jump(row.ftile, H + 410, { o: 0 }).jump(row.famt, H + 410, { o: 0 });
      lp.jump(row.tile, H + 410, { o: 1 }).jump(row.amt, H + 410, { o: 1 });
      lp.to(row.t, H + 200, { x: 0, o: 1, od: 240 }, D.on, E.on).to(row.s, H + 240, { x: 0, o: 1, od: 240 }, D.on, E.on);
      // everything already in the list moves down one row
      newRows.slice(0, c).reverse().forEach((r, i) => lp.to(r.row, H + i * 14, { y: 64 * (c - newRows.indexOf(r)) }, D.on, E.on));
      shift.forEach((el, i) => lp.to(el, H + (c + i) * 14, { y: 64 * (c + 1) }, D.on, E.on));
      // numbers roll in the direction they moved
      totals.push(r3(totals[c] + p.v)); days.push(r3(days[c] + p.v));
      lp.to(bar, H + 200, { x: (totals[c + 1] / budget - 1) * barW }, D.on, E.on);

      // tidy the tray while it is out of sight
      const Z = T0 + 6100;
      lp.jump(cell.tile, Z, { o: 1 }).jump(cell.ring, Z, { s: 1.12 });
      lp.jump(mcL, Z, { x: 0 }).jump(mcR, Z, { x: 0 }).jump(mcM, Z, { sx: 1 });
      lp.jump(check, Z, { s: 0.6, o: 0 }).jump(doneLabel, Z, { o: 1 }).jump(mcOn, Z, { o: 0 }).jump(mcBase, Z, { o: 1 });
      lp.jump(trHead, Z, { o: 1 }).jump(grid, Z, { o: 1 });
    }

    // Reset: a quiet cut back to the start of the morning.
    capSeq.push({ at: R, text: 'Pay with Apple Pay' });
    lp.fade(content, R, 0, 300, E.io);
    const Z = R + 330;
    shift.forEach(el => lp.jump(el, Z, { y: 0 }));
    newRows.forEach(r => {
      lp.jump(r.row, Z, { y: 0 });
      lp.jump(r.tile, Z, { o: 0 }).jump(r.amt, Z, { o: 0 });
      lp.jump(r.ftile, Z, { x: r.dx, y: r.dy, s: 1.4 }).jump(r.famt, Z, { x: r.adx, y: r.ady, s: 42 / 17 });
      lp.jump(r.t, Z, { x: 12, o: 0 }).jump(r.s, Z, { x: 12, o: 0 });
    });
    lp.jump(bar, Z, { x: (total0 / budget - 1) * barW });
    lp.jump(tamt[0], Z, { o: 1 }).jump(tm[0], Z, { o: 1 });
    lp.fade(content, Z + 40, 1, 420, E.io);

    const seqOf = (vals, fmt, at) => vals.map((v, i) => ({ at: i ? at(i) : 0, text: fmt(v), dir: i ? Math.sign(v - vals[i - 1]) || 1 : 1 }))
      .concat([{ at: Z, text: fmt(vals[0]), instant: true }]);
    const rollAt = i => (i - 1) * C + 5450;
    textSeq(lp, $('[data-total]', ui), seqOf(totals, money, rollAt));
    textSeq(lp, $('[data-daysum]', ui), seqOf(days, money, rollAt), { mode: 'line' });
    textSeq(lp, $('[data-count]', ui), seqOf([3, 4, 5, 6], String, rollAt));
    textSeq(lp, $('[data-left]', ui), seqOf(totals.map(t => r3(budget - t)), money, rollAt), { fit: true, mode: 'line' });
    textSeq(lp, caption, capSeq, { mode: 'words', stagger: 45 });

    lp.steps = [1500, 4300, 7000];
    lp.stepText = ['Pay with Apple Pay', 'Tap a category', 'Logged. Nothing to type'];
    lp.stepEl = ui;
    // what the visitor's own pick (the Try it) needs to know about this script
    lp.parts = { C, R, cells, newRows, tileC, slot0, finger, mcBase, mcOn, pay, ui };
    return lp.build();
  }

  /* --------------------------------------------------------- feature loops */

  function finger(lp, f, at, x, y, s0 = 1.25) {
    lp.to(f, at, { x: x + 12, y: y + 18, s: s0 }, 0, E.lin);
    lp.to(f, at + 40, { x, y, s: 1, o: 1, od: 150 }, 380, E.on);
  }
  const press = (lp, f, at, target, s = 0.92) => {
    lp.to(f, at, { s: 0.82 }, 110, E.out).to(f, at + 110, { s: 1 }, 200, E.out);
    if (target) lp.to(target, at, { s }, 110, E.out).to(target, at + 110, { s: 1 }, D.on, E.on);
  };

  function batchLoop() {
    const root = $('[data-stage="batch"]'); if (!root) return null;
    const S = 2400, L = 4 * S + 1100;
    const lp = new Loop('batch', L);
    const tray = $('.tray-stage', root);
    const cells = $$('[data-bgrid] .cell', root).map(c => ({ tile: $('.tile', c), ring: $('.ring', c), spark: $('.spark', c) }));
    const done = $('[data-bdone]', root), f = $('[data-finger]', root);
    const P = [
      { count: '2 of 5', v: 16.50, m: 'Noodle House', d: 'Apple Card · Nov 17 at 9:33 AM', cell: 0 },
      { count: '3 of 5', v: 42.18, m: 'Green Market', d: 'Apple Card · Nov 16 at 6:02 PM', cell: 2 },
      { count: '4 of 5', v: 2.90, m: 'Metro Transit', d: 'Apple Card · Nov 16 at 8:15 AM', cell: 3 },
      { count: '5 of 5', v: 64.00, m: 'Book Nook', d: 'Apple Card · Nov 15 at 1:20 PM', cell: 7 }
    ];
    const tileC = i => ({ x: 10 + 14 + (i % 4) * 78 + 39, y: 10 + 190 + Math.floor(i / 4) * 92 + 4 + 26 });
    const doneC = { x: 180, y: 10 + 450 - 16 - 26 };
    cells.forEach((c, i) => lp.init(c.ring, { s: 1.12, o: 0 }).init(c.spark, { o: i === P[0].cell ? 1 : 0 }));
    lp.init(f, { x: 200, y: 260, o: 0, s: 1.25 }).init(tray, { o: 1 });
    const seqs = { count: [], amt: [], m: [], d: [] };
    const R = 4 * S - S + 1750 + 600;
    P.forEach((p, k) => {
      const T0 = k * S, c = cells[p.cell], tc = tileC(p.cell);
      finger(lp, f, T0 + 450, tc.x, tc.y);
      press(lp, f, T0 + 850, c.tile);
      lp.to(c.ring, T0 + 960, { s: 1, o: 1, od: 150 }, D.on, E.on);
      lp.to(f, T0 + 1200, { x: doneC.x + 6, y: doneC.y + 4 }, 420, E.on);
      press(lp, f, T0 + 1650, done, 0.97);
      lp.fade(f, T0 + 1770, 0, 200);
      const N = T0 + 1750;
      if (k < 3) {
        lp.fade(c.ring, N, 0, 150).to(c.ring, N + 150, { s: 1.12 }, 0, E.lin);
        lp.fade(c.spark, N, 0, 150).fade(cells[P[k + 1].cell].spark, N + 120, 1, 180);
      }
      if (k === 0) { seqs.count.push({ at: 0, text: p.count }); seqs.amt.push({ at: 0, text: money(p.v) }); seqs.m.push({ at: 0, text: p.m }); seqs.d.push({ at: 0, text: p.d }); }
      if (k > 0) {
        const at = (k - 1) * S + 1750;
        seqs.count.push({ at, text: p.count, dir: 1 });
        seqs.amt.push({ at, text: money(p.v), dir: Math.sign(p.v - P[k - 1].v) });
        seqs.m.push({ at, text: p.m }); seqs.d.push({ at, text: p.d });
      }
    });
    // After the last one: the tray resets quietly.
    const last = cells[P[3].cell];
    lp.fade(tray, R - 600, 0, 260, E.io);
    lp.jump(last.ring, R - 300, { s: 1.12, o: 0 }).jump(last.spark, R - 300, { o: 0 }).jump(cells[P[0].cell].spark, R - 300, { o: 1 });
    lp.fade(tray, R - 250, 1, 360, E.io);
    seqs.count.push({ at: R - 300, text: P[0].count, instant: true });
    seqs.amt.push({ at: R - 300, text: money(P[0].v), instant: true });
    seqs.m.push({ at: R - 300, text: P[0].m, instant: true });
    seqs.d.push({ at: R - 300, text: P[0].d, instant: true });
    textSeq(lp, $('[data-bcount]', root), seqs.count);
    textSeq(lp, $('[data-bamt]', root), seqs.amt);
    textSeq(lp, $('[data-bm]', root), seqs.m, { mode: 'fade' });
    textSeq(lp, $('[data-bd]', root), seqs.d, { mode: 'fade' });
    lp.still = 0;
    return lp.build();
  }

  function budgetLoop() {
    const root = $('[data-stage="budget"]'); if (!root) return null;
    const L = 9000, lp = new Loop('budget', L);
    const ui = $('.ui', root), rot = $('[data-grot]', root);
    const chips = $$('[data-paychip]', root);
    const mb = [$('[data-mb0]', root), $('[data-mb1]', root)];
    const budget = 2100, mbW = 137;
    const spent = [1329.60, 1413.80, 1440.20];
    const cat = [{ lim: 800, spent: [463.80, 548.00, 548.00] }, { lim: 200, spent: [166.30, 166.30, 192.70] }];
    const deg = v => v / budget * 180;
    lp.init(rot, { r: deg(spent[0]) }).init(ui, { o: 1 });
    mb.forEach((b, i) => lp.init(b, { x: (cat[i].spent[0] / cat[i].lim - 1) * mbW }));
    chips.forEach(c => lp.init(c, { y: -26, s: 0.96, o: 0 }));
    const target = [{ x: 92.5 - 180, y: 374 + 53 - 30 }, { x: 257.5 - 180, y: 374 + 53 - 30 }];
    const step = (i, T0) => {
      const c = chips[i];
      lp.to(c, T0, { y: 0, s: 1, o: 1, od: 200 }, D.on, E.on);
      lp.to(c, T0 + 1200, { x: target[i].x, y: target[i].y, s: 0.3, o: 0, od: 380, oe: E.in }, 560, E.nav);
      lp.jump(c, T0 + 1900, { x: 0, y: -26, s: 0.96 });
      const H = T0 + 1550;
      lp.to(rot, H, { r: deg(spent[i + 1]) }, 700, E.nav);
      mb.forEach((b, j) => { if (cat[j].spent[i + 1] !== cat[j].spent[i]) lp.to(b, H, { x: (cat[j].spent[i + 1] / cat[j].lim - 1) * mbW }, D.nav, E.nav); });
    };
    step(0, 900); step(1, 4300);
    const R = 7800, Z = R + 280;
    lp.fade(ui, R, 0, 260, E.io);
    lp.jump(rot, Z, { r: deg(spent[0]) });
    mb.forEach((b, i) => lp.jump(b, Z, { x: (cat[i].spent[0] / cat[i].lim - 1) * mbW }));
    lp.fade(ui, Z + 20, 1, 400, E.io);
    const at = i => i === 1 ? 900 + 1550 : 4300 + 1550;
    const seq = (vals, fmt) => {
      const out = [{ at: 0, text: fmt(vals[0]) }];
      for (let i = 1; i < vals.length; i++) if (fmt(vals[i]) !== fmt(vals[i - 1])) out.push({ at: at(i), text: fmt(vals[i]), dir: Math.sign(vals[i] - vals[i - 1]) || 1 });
      out.push({ at: Z, text: fmt(vals[0]), instant: true });
      return out;
    };
    textSeq(lp, $('[data-gpct]', root), seq(spent.map(s => Math.round(s / budget * 100)), v => v + '%'));
    textSeq(lp, $('[data-gleft]', root), seq(spent.map(s => r3(budget - s)), money));
    textSeq(lp, $('[data-ml0]', root), seq(cat[0].spent.map(s => r3(cat[0].lim - s)), money), { mode: 'line' });
    textSeq(lp, $('[data-ml1]', root), seq(cat[1].spent.map(s => r3(cat[1].lim - s)), money), { mode: 'line' });
    lp.still = 3200;
    return lp.build();
  }

  function billsLoop() {
    const root = $('[data-stage="bills"]'); if (!root) return null;
    const L = 7200, lp = new Loop('bills', L);
    const banner = $('[data-rbanner]', root), actions = $('[data-ractions]', root), card = $('[data-rcard]', root);
    const f = $('[data-finger]', root), next = $('[data-next]', root);
    lp.init(banner, { y: -90, o: 0 }).init(actions, { s: 0.88, o: 0 }).init(card, { o: 1 }).init(f, { x: 180, y: 50, o: 0, s: 1.25 }).init(next, { o: 1 });
    lp.to(banner, 500, { y: 0, o: 1, od: 200 }, D.on, E.on);
    finger(lp, f, 1500, 176, 48);
    lp.to(f, 1950, { s: 0.82 }, 140, E.out).to(banner, 1950, { s: 0.97 }, 240, E.out);
    lp.fade(card, 2350, 0.45, 300, E.io);
    lp.to(banner, 2350, { s: 1 }, D.on, E.on);
    lp.to(actions, 2350, { s: 1, o: 1, od: 160 }, D.on, E.on);
    lp.to(f, 2400, { s: 1 }, 200, E.out);
    lp.to(f, 2800, { x: 96, y: 10 + 96 + 72 + 10 }, 420, E.on);
    press(lp, f, 3350, null);
    lp.fade(f, 3500, 0, 200);
    lp.to(actions, 3500, { s: 0.94, o: 0, od: 200 }, 260, E.io);
    lp.to(banner, 3500, { y: -30, s: 0.94, o: 0, od: 200 }, 280, E.io);
    lp.fade(card, 3500, 1, 300, E.io);
    lp.jump(banner, 4200, { y: -90, s: 1 }).jump(actions, 4200, { s: 0.88 });
    lp.fade(next, 6300, 0, 220, E.io).fade(next, 6600, 1, 300, E.io);
    textSeq(lp, next, [{ at: 0, text: 'Next: Tomorrow' }, { at: 3750, text: 'Next: Dec 18' }, { at: 6550, text: 'Next: Tomorrow', instant: true }], { mode: 'words' });
    lp.still = 1200;
    return lp.build();
  }

  function insightsLoop() {
    const root = $('[data-stage="insights"]'); if (!root) return null;
    const S = 2600, L = 4 * S, lp = new Loop('insights', L);
    const pill = $('[data-segpill]', root), stack = $('[data-stack]', root);
    const segs = $$('span', stack), gaps = $$('i', stack), W = 304, seg = 100.67;
    const states = [
      { idx: 1, label: 'November', sub: 'This month', parts: [463.80, 341.98, 166.30, 98.18, 259.34], side: 0 },
      { idx: 1, label: 'October', sub: 'Last month', parts: [712.40, 398.10, 281.75, 64.20, 647.88], side: -1 },
      { idx: 0, label: 'Nov 9 – 15', sub: 'Last week', parts: [118.20, 64.99, 52.40, 18.25, 58.61], side: 1 },
      { idx: 1, label: 'November', sub: 'This month', parts: [463.80, 341.98, 166.30, 98.18, 259.34], side: 1 }
    ];
    const geo = st => {
      const tot = st.parts.reduce((a, b) => a + b, 0);
      let acc = 0;
      return st.parts.map(p => { const g = { x: acc / tot * W, sx: p / tot }; acc += p; return g; });
    };
    const g0 = geo(states[0]);
    segs.forEach((s, i) => lp.init(s, { x: g0[i].x, sx: g0[i].sx }));
    gaps.forEach((s, i) => lp.init(s, { x: g0[i + 1].x - 1.5 }));
    lp.init(pill, { x: states[0].idx * seg });
    states.forEach((st, k) => {
      if (!k) return;
      const at = k * S, g = geo(st);
      if (st.idx !== states[k - 1].idx) lp.to(pill, at, { x: st.idx * seg }, D.on, E.on);
      segs.forEach((s, i) => lp.to(s, at + 60, { x: g[i].x, sx: g[i].sx }, D.nav, E.nav));
      gaps.forEach((s, i) => lp.to(s, at + 60, { x: g[i + 1].x - 1.5 }, D.nav, E.nav));
    });
    const tot = st => r3(st.parts.reduce((a, b) => a + b, 0));
    const seqN = (fn, fmt) => states.map((st, k) => ({ at: k * S + (k ? 80 : 0), text: fmt(fn(st)), dir: k ? Math.sign(fn(st) - fn(states[k - 1])) || 1 : 1 }));
    textSeq(lp, $('[data-itotal]', root), seqN(tot, money));
    for (let i = 0; i < 4; i++) {
      textSeq(lp, $(`[data-ia${i}]`, root), seqN(st => st.parts[i], money), { mode: 'line' });
      textSeq(lp, $(`[data-ip${i}]`, root), seqN(st => Math.round(st.parts[i] / tot(st) * 100), v => v + '%'), { mode: 'line' });
    }
    textSeq(lp, $('[data-plabel]', root), states.map((st, k) => ({ at: k * S, text: st.label, side: st.side })), { mode: 'morph', stagger: 14 });
    textSeq(lp, $('[data-psub]', root), states.map((st, k) => ({ at: k * S + 40, text: st.sub, side: st.side })), { mode: 'words', stagger: 40 });
    lp.still = 0;
    return lp.build();
  }

  function privacyLoop() {
    const root = $('[data-stage="privacy"]'); if (!root) return null;
    const L = 6400, lp = new Loop('privacy', L);
    const f = $('[data-finger]', root), ring = $('[data-tapring]', root);
    const cx = 180, cy = 10 + 62 + 31;
    lp.init(f, { x: cx, y: cy, o: 0, s: 1.25 }).init(ring, { s: 0.6, o: 0 });
    const dbl = at => {
      finger(lp, f, at, cx + 20, cy + 6);
      lp.to(f, at + 520, { s: 0.82 }, 80, E.out).to(f, at + 600, { s: 1 }, 90, E.out);
      lp.to(f, at + 700, { s: 0.82 }, 80, E.out).to(f, at + 780, { s: 1, o: 0, od: 220 }, 200, E.out);
      lp.to(ring, at + 700, { s: 0.6, o: 0.8, od: 0 }, 0, E.lin).to(ring, at + 710, { s: 1.6, o: 0, od: 520, oe: E.out }, 560, E.out);
      lp.jump(ring, at + 1400, { s: 0.6 });
    };
    dbl(500); dbl(3500);
    textSeq(lp, $('[data-ptotal]', root), [{ at: 0, text: '$1,329.60' }, { at: 1240, text: '$•••••' }, { at: 4240, text: '$1,329.60' }], { mode: 'morph', stagger: 18 });
    textSeq(lp, $('[data-pquiet]', root), [{ at: 0, text: '+$4,700.00 income' }, { at: 1280, text: 'income hidden' }, { at: 4280, text: '+$4,700.00 income' }], { mode: 'words', stagger: 40 });
    lp.still = 2000;
    return lp.build();
  }

  function widgetsLoop() {
    const root = $('[data-stage="widgets"]'); if (!root) return null;
    const L = 8400, lp = new Loop('widgets', L);
    const pill = $('[data-wpill]', root), img1 = $('[data-wimg="1"]', root), btns = $$('[data-wbtn]', root);
    lp.btns = btns;
    lp.init(pill, { xp: 0 }).init(img1, { o: 0 });
    lp.to(pill, 4000, { xp: 100 }, D.on, E.on).fade(img1, 4000, 1, 420, E.io);
    lp.to(pill, 8200, { xp: 0 }, 0, E.lin).fade(img1, 8200, 0, 0);
    // a real control too: pressing a side plays the same transition and holds there
    lp.marks = [{ from: 0, to: 3900 }, { from: 4000, to: 7900 }];
    lp.sync = () => { const t = lp.time, on = t >= 4000 && t < 8200 ? 1 : 0; btns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === on))); };
    lp.still = 0;
    lp.build();
    return lp;
  }

  /* --------------------------------------------------------- page state and review hooks
     #freeze=<ms>          every loop at that time (add &stills: feature loops on their still frames)
     #word=<key>           the headline shows that word (coffee, groceries, rent, takeout, flights, gifts, spending)
     #demo=word&from=<key>&to=<key>&t=<ms>   the headline morph, frozen t ms in
     #demo=move|tap&x=..&y=..&t=<ms>   the chip field answering a pointer move or a click at (x, y), frozen at t
     All of them only read the address; a visitor never has a hash like these. */
  const H = new URLSearchParams(location.hash.slice(1));
  const fm = H.get('freeze');
  const frozen = fm != null ? Number(fm) || 0 : null;
  const stills = H.has('stills');
  const demo = H.get('demo');
  if (frozen != null) document.documentElement.classList.add('frozen');
  let pageVisible = document.visibilityState !== 'hidden';
  let heroRun = false, heroNear = true;

  /* --------------------------------------------------------- chip fields
     Kept's onboarding backdrop (CategoryChipField) on the web. Each chip: .chip (rises, with its sideways sine baked
     into the same animation, so a chip is one layer) > .nudge (makes room for the pointer, a CSS transition) > img (the
     tap ripple). Sprites have the blur baked in.
     A chip that leaves the top comes back from the bottom with a motif that is not on screen in its layer.
     Where a chip is right now is worked out from its animations' clocks (never read back from the layout), so the
     pointer and the ripple cost no layout at all. */

  const MOTIFS = ['groceries', 'dining', 'coffee', 'transport', 'home', 'bills', 'subscriptions', 'shopping', 'health', 'fun', 'travel', 'pets', 'gifts', 'paycheck'];
  const SCROLL_DRIFT = !!(window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()'));
  const LIFT = { far: -30, mid: -110, near: -240 }; // the CSS scroll drift, mirrored here for the pointer maths
  const FIELD_STYLES = {
    // The app's hero: far 9 @36 pt .36, mid 7 @54 pt .66, near 5 @78 pt .44; a little quicker on the web so motion reads.
    hero: w => w < 600 ? [
      { depth: 'far', count: 5, box: 54, opacity: .42, speed: 9, sway: 5 },
      { depth: 'mid', count: 5, box: 58, opacity: .78, speed: 19, sway: 8 },
      { depth: 'near', count: 3, box: 118, opacity: .5, speed: 32, sway: 12 }
    ] : w < 1000 ? [
      { depth: 'far', count: 7, box: 60, opacity: .4, speed: 10, sway: 5 },
      { depth: 'mid', count: 6, box: 62, opacity: .76, speed: 20, sway: 9 },
      { depth: 'near', count: 3, box: 134, opacity: .48, speed: 36, sway: 14 }
    ] : [
      { depth: 'far', count: 8, box: 66, opacity: .4, speed: 10, sway: 5 },
      { depth: 'mid', count: 7, box: 66, opacity: .76, speed: 21, sway: 9 },
      { depth: 'near', count: 4, box: 148, opacity: .46, speed: 38, sway: 14 }
    ]
  };
  // seeded random, so a field looks the same on every load (and in review frames)
  function xorshift(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  /**
   * host: the field element (chips go into its `.field-x` child when it has one).
   * opts.allowed(W, H) -> [[x0, x1], ...] where chip centres may sit; opts.seed; opts.stillAt (ms of the still frame).
   */
  function makeField(host, kind, opts = {}) {
    const inner = $('[data-field-x]', host) || host;
    const field = { host, kind, chips: [], layers: {}, built: false, run: false, W: 0, H: 0, lean: { x: 0, y: 0 } };

    field.build = () => {
      field.asleep = false;
      inner.querySelectorAll('.field-depth').forEach(n => n.remove());
      field.chips.forEach(c => { if (c.rise) c.rise.cancel(); });
      field.chips = []; field.layers = {};
      const W = host.clientWidth, H = host.clientHeight;
      if (!W || !H) return;
      field.W = W; field.H = H;
      const r = host.getBoundingClientRect();
      field.pageX = r.left + scrollX; field.pageY = r.top + scrollY;
      const rand = xorshift((opts.seed || 5) + Math.round(W / 50));
      const spans = (opts.allowed ? opts.allowed(W, H) : [[0, W]]).filter(([a, b]) => b - a > 8);
      const total = spans.reduce((t, [a, b]) => t + b - a, 0) || W;
      const at = u => { for (const [a, b] of spans) { if (u <= b - a) return a + u; u -= b - a; } return W - 1; };
      const used = new Set();
      for (const d of FIELD_STYLES[kind](W)) {
        const layer = document.createElement('div');
        layer.className = 'field-depth';
        layer.dataset.depth = d.depth;
        layer.style.opacity = d.opacity;
        inner.append(layer);
        field.layers[d.depth] = layer;
        const inLayer = new Set();
        const n = Math.max(1, Math.round(d.count * Math.min(1, Math.max(.45, total / W * 1.25))));
        for (let i = 0; i < n; i++) {
          const c = {
            depth: d.depth, box: d.box, speed: d.speed, swayW: d.sway, rand, inLayer,
            place: () => at((i + 0.12 + rand() * 0.76) * total / n),
            el: document.createElement('div'), nudge: document.createElement('div'), img: document.createElement('img')
          };
          c.el.className = 'chip'; c.nudge.className = 'nudge';
          c.el.style.width = c.el.style.height = c.nudge.style.width = c.nudge.style.height = d.box + 'px';
          c.img.alt = ''; c.img.decoding = 'async'; c.img.draggable = false;
          c.nudge.append(c.img); c.el.append(c.nudge); layer.append(c.el);
          motif(c, pick(rand, inLayer, used));
          c.x = c.place(); c.el.style.left = (c.x - d.box / 2).toFixed(1) + 'px';
          c.duration = (H + d.box * 1.2) / d.speed * 1000;
          c.period = 7850 * (0.8 + rand() * 0.4); // the app's sin(0.4 t): a 15.7 s full swing, so 7.85 s from side to side
          c.phase = rand() * c.period * 2;
          rise(c, -rand() * c.duration);
          field.chips.push(c);
        }
      }
      field.built = true;
      field.setRun(field.run, true);
    };

    function pick(rand, inLayer, used) {
      const free = MOTIFS.filter(m => !inLayer.has(m));
      const fresh = free.filter(m => !used.has(m));
      const pool = fresh.length ? fresh : free;
      const m = pool[Math.floor(rand() * pool.length)];
      inLayer.add(m); used.add(m);
      return m;
    }
    function motif(c, m) {
      c.motif = m;
      c.img.onerror = () => { c.img.onerror = null; c.img.src = `img/chips/chip-${c.depth}-${m}.png`; };
      c.img.src = `img/chips/chip-${c.depth}-${m}.avif`;
    }
    // the sideways sine at local time t: -sway at the start of a swing, +sway 7.85 s later
    const swayX = (c, t) => -c.swayW * Math.cos(Math.PI * (t + c.phase) / c.period);
    function rise(c, delay) {
      const H = field.H, b = c.box, D = c.duration;
      c.y0 = H + b * 0.1; c.y1 = -b * 1.1;
      // one animation, one layer: the straight rise with the sway sampled 8 times per swing (linear in between is within
      // a third of a pixel of the sine)
      const n = Math.max(2, Math.ceil(D / c.period * 8)), kf = [];
      for (let i = 0; i <= n; i++) {
        const p = i / n;
        kf.push({ transform: `translate3d(${swayX(c, p * D).toFixed(2)}px, ${(c.y0 + (c.y1 - c.y0) * p).toFixed(1)}px, 0)` });
      }
      c.rise = c.el.animate(kf, { duration: D, delay, easing: 'linear', fill: 'both' });
      c.rise.onfinish = () => recycle(c);
      if (!field.run) c.rise.pause();
    }
    function recycle(c) {
      // left the top: a fresh motif that is not in this layer right now, a fresh place in its column
      c.inLayer.delete(c.motif);
      const free = MOTIFS.filter(m => !c.inLayer.has(m) && m !== c.motif);
      const m = free[Math.floor(c.rand() * free.length)];
      c.inLayer.add(m); motif(c, m);
      c.x = c.place(); c.el.style.left = (c.x - c.box / 2).toFixed(1) + 'px';
      c.nudge.style.translate = '0px 0px'; c.nudge.style.scale = '1'; c.pushed = false;
      rise(c, 0);
    }

    // Still frame (Reduce Motion, review shots): the app's t = 11 s.
    field.still = () => {
      field.chips.forEach(c => { c.rise.pause(); c.rise.currentTime = opts.stillAt ?? 11000; });
    };
    // Far off screen the chips' animations are cancelled (no layers); they come back at the same place.
    field.setNear = near => {
      if (!field.built || near === !field.asleep) return;
      if (!near) {
        field.chips.forEach(c => { c.rel = c.rise.currentTime; c.rise.cancel(); });
        field.asleep = true;
      } else {
        field.asleep = false;
        field.chips.forEach(c => { c.rise.currentTime = c.rel; c.rise.pause(); });
        field.setRun(field.run, true);
      }
    };
    field.setRun = (run, force) => {
      if (!force && run === field.run) return;
      field.run = run;
      if (!field.built || field.asleep) return;
      if (reduceMQ.matches || frozen != null) { field.still(); host.style.setProperty('--wc', 'auto'); return; }
      field.chips.forEach(({ rise: a }) => {
        if (run && a.playState !== 'running' && a.playState !== 'finished') a.play();
        else if (!run && a.playState === 'running') a.pause();
      });
      host.style.setProperty('--wc', run ? 'transform' : 'auto'); // will-change only while chips move
    };

    /** Where chip c's centre is now, in field coordinates (from its clocks, not from layout). */
    field.where = c => {
      const p = c.rise.effect.getComputedTiming().progress ?? 0;
      const drift = SCROLL_DRIFT && !reduceMQ.matches && kind === 'hero' ? LIFT[c.depth] * Math.min(1, Math.max(0, scrollY / innerHeight)) : 0;
      const lean = field.leanOf(c.depth);
      return { x: c.x + swayX(c, p * c.duration) + lean.x, y: c.y0 + (c.y1 - c.y0) * p + c.box / 2 + lean.y + drift };
    };
    field.leanOf = () => ({ x: 0, y: 0 });
    return field;
  }

  /* --------------------------------------------------------- the hero field: geometry and the pointer */

  const hero = $('[data-hero]');
  const heroHost = $('[data-field="hero"]');
  const headEl = $('.hero-head'), hlEl = $('.hl'), copyEl = $('.hero-copy'), headerEl = $('header.site');
  let heroField = null;

  // Keep the chips out of the header band (the page links) and off the text. The field starts below the band (tablets:
  // below the headline; phones: below the copy) and a static mask fades it in. Masks cut feathered holes where the text is,
  // so chips may rise beside or below it but fade before they reach it. Measured once per layout, never per frame.
  const cut = (a, b, y) => `linear-gradient(90deg, #000 ${Math.max(0, a - 44)}px, transparent ${a}px, transparent ${b}px, #000 ${b + 44}px), linear-gradient(180deg, transparent ${y}px, #000 ${y + 64}px)`;
  const textRight = el => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().right; };
  function heroGeometry() {
    const hr = hero.getBoundingClientRect(), W = hr.width;
    const hl = hlEl.getBoundingClientRect(), copy = copyEl.getBoundingClientRect(), head = headEl.getBoundingClientRect();
    const fs = parseFloat(getComputedStyle(hlEl).fontSize) || 60;
    const headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom - hr.top : 76;
    const wide = innerWidth >= 960, tablet = !wide && innerWidth >= 700;
    let top, ex = null, fx = null, fy = null, spans = null;
    if (wide) {
      // B's composition: row 1 ("Your [disc] word,") runs across most of the width, "kept." and the copy sit under its
      // left end, the phone to the right. Two holes: row 1 out to its widest word ("groceries,"), and the text column
      // down to the copy's bottom. Chips rise all the way up in the margins, and beside the phone under row 1.
      top = headerBottom + 4;
      const L = Math.round(Math.min(head.left, copy.left) - hr.left - 18);
      const line = $('.hl-wordline'), word = $('[data-word]'), wl = line.getBoundingClientRect();
      const meas = measurer(word), widest = Math.max(...WORDS.map(w => meas.w(w[1]))); meas.done();
      const r1 = Math.round(wl.left - hr.left + wl.width - word.getBoundingClientRect().width + widest + 12);
      const y1 = Math.round(wl.bottom - hr.top - top + fs * 0.14); // below the descenders of row 1
      const toggle = $('[data-hl-toggle]'), tr = toggle && !toggle.hidden ? toggle.getBoundingClientRect().right : 0;
      const rc = Math.round(Math.max(tr, textRight($('[data-kept]')), textRight($('.promise', copyEl)), $('.cta-row', copyEl).lastElementChild.getBoundingClientRect().right, textRight($('.hero-meta', copyEl))) - hr.left + 12);
      fx = cut(L, r1, y1);
      fy = cut(L, rc, Math.round(copy.bottom - hr.top - top + 16));
      // no chip rises along a cut's side edge, where it would show sliced in half; under the copy only if that strip is tall
      const m = 44, Hf = hr.height - top, yc = copy.bottom - hr.top - top + 16;
      spans = [[0, L - m], [rc + m, r1 - m], [r1 + m, W]];
      if ((Hf - yc) / Hf > 0.35) spans.push([L + m, rc - m]);
    } else if (tablet) {
      top = hl.bottom - hr.top + fs * 0.14; // below the descenders
      ex = [copy.left - hr.left - 18, copy.right - hr.left + 10];
    } else top = copy.bottom - hr.top + 16; // phones: the chips live around the phone, under the copy
    const H = hr.height - top;
    const yb = copy.bottom - hr.top - top + 16; // the copy's bottom edge, in field coordinates
    heroHost.style.setProperty('--ft', Math.round(top) + 'px');
    if (ex) fx = cut(Math.round(ex[0]), Math.round(ex[1]), Math.round(yb));
    const mx = $('[data-field-mask]', heroHost), my = $('[data-field-x]', heroHost);
    if (fx) mx.style.setProperty('--fx', fx); else mx.style.removeProperty('--fx');
    if (fy) my.style.setProperty('--fy', fy); else my.style.removeProperty('--fy');
    // chips under the copy only where that strip is tall enough to show them for a while
    return { W, H, top, ex, fx, fy, spans, under: ex && (H - yb) / H > 0.35 };
  }

  function setupHeroField() {
    if (!hero || !heroHost) return;
    let geo = heroGeometry();
    heroField = makeField(heroHost, 'hero', {
      seed: 7,
      allowed: W => geo.spans ? geo.spans.slice().sort((a, b) => a[0] - b[0]) : geo.ex && !geo.under ? [[0, geo.ex[0] - 36], [geo.ex[1] + 36, W]] : [[0, W]]
    });
    const lean = { far: [10, 7], mid: [22, 15], near: [44, 28] };
    let nx = 0, ny = 0;
    heroField.leanOf = d => ({ x: -nx * lean[d][0], y: -ny * lean[d][1] });
    heroField.build();
    heroField.setRun(heroRun, true);
    heroField.setNear(heroNear);

    // Rebuild only when the layout really changed (a phone's URL bar showing or hiding changes nothing here).
    let lastW = innerWidth, lastH = hero.offsetHeight, t = 0;
    addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const h = hero.offsetHeight;
        if (Math.abs(innerWidth - lastW) < 40 && Math.abs(h - lastH) < 80) return;
        lastW = innerWidth; lastH = h;
        geo = heroGeometry(); heroField.build();
      }, 200);
    });
    // once the fonts are in, rebuild only if the text moved enough to matter (system fonts usually change nothing)
    const moved = (a, b) => Math.abs(a.W - b.W) > 6 || Math.abs(a.H - b.H) > 24 || Math.abs(a.top - b.top) > 6 ||
      !!a.ex !== !!b.ex || (a.ex && (Math.abs(a.ex[0] - b.ex[0]) > 6 || Math.abs(a.ex[1] - b.ex[1]) > 6)) ||
      (a.spans || []).length !== (b.spans || []).length || (a.spans || []).some((s, i) => Math.abs(s[0] - b.spans[i][0]) > 6 || Math.abs(s[1] - b.spans[i][1]) > 6);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { const g = heroGeometry(); if (moved(g, geo)) { geo = g; heroField.build(); } heroField.fontsDone = true; });
    else heroField.fontsDone = true;

    if (reduceMQ.matches) return;
    // The pointer: depth layers lean away from it (near ones more), and chips close to it make room. One frame per
    // pointer move, nothing in between; the nudges ease on their own CSS transitions.
    const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
    let px = 0, py = 0, inside = false, pending = false;
    const frame = () => {
      pending = false;
      if (!heroField.run || !heroField.built) return;
      const fx0 = heroField.pageX - scrollX, fy0 = heroField.pageY - scrollY;
      const hr = { left: fx0, top: fy0, width: heroField.W, height: heroField.H };
      nx = inside ? Math.max(-.5, Math.min(.5, (px - hr.left) / hr.width - 0.5)) : 0;
      ny = inside ? Math.max(-.5, Math.min(.5, (py - hr.top) / Math.max(hr.height, 400) - 0.5)) : 0;
      for (const [k, el] of Object.entries(heroField.layers)) el.style.transform = `translate3d(${(-nx * lean[k][0]).toFixed(1)}px, ${(-ny * lean[k][1]).toFixed(1)}px, 0)`;
      const lx = px - fx0, ly = py - fy0;
      for (const c of heroField.chips) {
        if (c.depth === 'far') continue;
        const p = heroField.where(c);
        const dx = p.x - lx, dy = p.y - ly, d = Math.hypot(dx, dy) || 1, R = c.depth === 'near' ? 220 : 170;
        if (inside && d < R) {
          const f = 1 - d / R, push = f * f * (c.depth === 'near' ? 46 : 36);
          c.nudge.style.translate = `${(dx / d * push).toFixed(1)}px ${(dy / d * push).toFixed(1)}px`;
          c.nudge.style.scale = (1 + f * 0.1).toFixed(3);
          c.pushed = true;
        } else if (c.pushed) {
          c.nudge.style.translate = '0px 0px'; c.nudge.style.scale = '1'; c.pushed = false;
        }
      }
    };
    heroField.poke = (x, y, on = true) => { inside = on; px = x; py = y; if (!pending) { pending = true; requestAnimationFrame(frame); } };
    heroField.pokeNow = (x, y) => { inside = true; px = x; py = y; frame(); }; // review frames only
    if (fine) {
      hero.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || e.pointerType === 'pen') heroField.poke(e.clientX, e.clientY); }, { passive: true });
      hero.addEventListener('pointerleave', () => heroField.poke(px, py, false));
    }
    // A click or tap on the hero (not on a link or a button) sends a soft ripple through the chips around it. Phones too.
    heroField.ripple = (x, y) => {
      if (!heroField.run || !heroField.built) return;
      const lx = x - (heroField.pageX - scrollX), ly = y - (heroField.pageY - scrollY);
      for (const c of heroField.chips) {
        const p = heroField.where(c);
        const dx = p.x - lx, dy = p.y - ly, d = Math.hypot(dx, dy) || 1;
        if (d > 300) continue;
        const f = 1 - d / 300, k = (c.depth === 'near' ? 54 : c.depth === 'mid' ? 40 : 22) * f;
        c.img.animate([
          { transform: 'none' },
          { transform: `translate(${(dx / d * k).toFixed(1)}px, ${(dy / d * k).toFixed(1)}px) scale(${(1 + 0.08 * f).toFixed(3)})`, offset: 0.22, easing: E.delight },
          { transform: 'none' }
        ], { duration: 1100, delay: d * 0.6, easing: 'cubic-bezier(.2,.7,.3,1)' });
      }
    };
    hero.addEventListener('click', e => {
      if (e.target.closest('a, button')) return;
      heroField.ripple(e.clientX, e.clientY);
    });
  }

  /* --------------------------------------------------------- the headline: one word morphs, letter by letter
     Its own loop on timers (never frames), independent of the phone below: coffee, groceries, rent, takeout, flights,
     gifts, about 1.8 s each, then "Your [Kept icon] spending, kept." holds about 4.6 s, then the icon turns back into the
     coffee disc and it goes round again, forever. Shared letters glide to their new place (longest common subsequence, so
     letters never cross), leaving letters fade out within 130 ms, entering ones start at 90 ms (the app's MorphingLabel
     timing), while the disc turns out and the next one turns in. It stops off screen, in a hidden tab and from its own
     disc. Screen readers, no-JS and Reduce Motion get "Your spending, kept." */

  const charsOf = el => Array.from(el.children).filter(c => c.classList.contains('ch') && !c.classList.contains('ghost'));
  function buildChars(el, text) {
    const spans = Array.from(text, c => { const s = document.createElement('span'); s.className = 'ch'; s.textContent = c; return s; });
    el.replaceChildren(...spans);
    return spans;
  }
  function lcsMap(a, b) {
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const map = new Array(m).fill(-1);
    for (let i = 0, j = 0; i < n && j < m;) {
      if (a[i] === b[j]) { map[j] = i; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
    }
    return map;
  }
  const clearGhosts = el => el.querySelectorAll('.ghost').forEach(g => g.remove());
  function morphWord(el, next, o) {
    if (!charsOf(el).length) buildChars(el, el.textContent);
    const old = charsOf(el), prev = old.map(s => s.textContent);
    if (prev.join('') === next) return;
    if (reduceMQ.matches) {
      clearGhosts(el); buildChars(el, next);
      el.getAnimations().forEach(a => a.cancel());
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
      return;
    }
    const was = old.map(s => { const r = s.getBoundingClientRect(); return { x: r.left, y: r.top, o: +getComputedStyle(s).opacity }; });
    clearGhosts(el);
    const want = Array.from(next), map = lcsMap(prev, want), spans = buildChars(el, next);
    const box = el.getBoundingClientRect(), used = new Set(map);
    prev.forEach((c, i) => {
      if (used.has(i)) return;
      const g = document.createElement('span');
      g.className = 'ch ghost'; g.textContent = c;
      g.style.left = (was[i].x - box.left) + 'px'; g.style.top = (was[i].y - box.top) + 'px';
      el.appendChild(g);
      g.animate([{ opacity: was[i].o, transform: 'none' }, { opacity: 0, transform: 'translateY(-.12em) scale(.9)' }],
        { duration: o.leave, easing: 'ease-in', fill: 'forwards' }).onfinish = () => g.remove();
    });
    spans.forEach((s, j) => {
      const i = map[j];
      if (i >= 0) {
        const r = s.getBoundingClientRect(), dx = was[i].x - r.left, dy = was[i].y - r.top;
        if (Math.abs(dx) > .5 || Math.abs(dy) > .5 || was[i].o < .99)
          s.animate([{ transform: `translate(${dx}px, ${dy}px)`, opacity: was[i].o }, { transform: 'none', opacity: 1 }], { duration: o.duration, easing: o.easing });
      } else {
        s.animate([{ opacity: 0, transform: 'translateY(.12em) scale(.9)' }, { opacity: 1, transform: 'none' }],
          { duration: o.duration, easing: o.easing, delay: o.enterDelay, fill: 'backwards' });
      }
    });
  }
  // Set the resting value inline and animate from what is on screen now, so a replay mid-way never snaps.
  function tweenTo(el, to, opts) {
    const cs = getComputedStyle(el), from = {};
    for (const k in to) from[k] = cs[k];
    el.getAnimations().forEach(a => a.cancel());
    if (opts.from) Object.assign(from, opts.from);
    Object.assign(el.style, to);
    if (opts.duration) el.animate([from, to], { duration: opts.duration, easing: opts.easing || 'ease-out', delay: opts.delay || 0, fill: 'backwards' });
  }


  // [disc key, word]; the last one is the brand line. "groceries," is the widest row and sets the type size.
  const WORDS = [['coffee', 'coffee,'], ['groceries', 'groceries,'], ['rent', 'rent,'], ['takeout', 'takeout,'], ['flights', 'flights,'], ['gifts', 'gifts,'], ['spending', 'spending,']];
  const HOLD = { word: 1800, home: 4600, first: 2600 }; // ms on a category, on "spending" (the long hold), and at first sight

  const headline = (() => {
    const wordEl = $('[data-word]'), toggle = $('[data-hl-toggle]'), label = $('[data-hl-label]'), wrap = $('[data-hl-wrap]');
    if (!wordEl || !toggle) return null;
    const discs = new Map($$('[data-disc] > .d').map(d => [d.dataset.key, d]));
    const HOME = WORDS.length - 1;
    const st = { i: HOME, paused: false, inView: true, timer: 0, due: 0, left: null };
    const idx = k => typeof k === 'number' ? k : Math.max(0, WORDS.findIndex(w => w[0] === k));

    function showDisc(key, animate) {
      discs.forEach((el, k) => {
        el.classList.remove('on');
        const visible = +getComputedStyle(el).opacity > 0.01;
        if (k === key) {
          if (!animate) { el.getAnimations().forEach(a => a.cancel()); Object.assign(el.style, { opacity: 1, transform: 'none' }); return; }
          if (reduceMQ.matches) { el.style.transform = 'none'; tweenTo(el, { opacity: 1 }, { duration: 220 }); }
          else tweenTo(el, { opacity: 1, transform: 'none' }, { duration: 620, easing: E.on, delay: 70, from: visible ? {} : { opacity: 0, transform: 'scale(.55) rotate(40deg)' } });
        } else if (visible && animate) {
          if (reduceMQ.matches) tweenTo(el, { opacity: 0 }, { duration: 200 });
          else tweenTo(el, { opacity: 0, transform: 'scale(.55) rotate(-40deg)' }, { duration: 240, easing: 'cubic-bezier(.4, 0, 1, 1)' });
        } else {
          el.getAnimations().forEach(a => a.cancel());
          Object.assign(el.style, { opacity: 0, transform: 'scale(.55)' });
        }
      });
    }
    /** Shows word i (or the word of a disc key) now: a morph, or a plain swap. */
    function show(k, animate) {
      const i = idx(k);
      if (i === st.i) return;
      st.i = i;
      const [key, text] = WORDS[i];
      if (animate) morphWord(wordEl, text, { duration: 560, easing: E.nav, leave: 130, enterDelay: 90 });
      else { clearGhosts(wordEl); buildChars(wordEl, text); }
      showDisc(key, animate);
    }

    // The loop: one timer at a time. Stopping remembers what was left of the current hold, so a resume never cuts a word short.
    const running = () => !st.paused && st.inView && pageVisible && frozen == null && !demo && !reduceMQ.matches;
    function schedule(ms) {
      clearTimeout(st.timer);
      st.due = performance.now() + ms; st.left = null;
      st.timer = setTimeout(step, ms);
    }
    function step() {
      st.timer = 0;
      if (!running()) return;
      const i = (st.i + 1) % WORDS.length;
      show(i, true);
      schedule(i === HOME ? HOLD.home : HOLD.word);
    }
    function update() {
      const run = running();
      if (run && !st.timer) schedule(st.left == null ? HOLD.first : Math.max(700, st.left));
      else if (!run && st.timer) { clearTimeout(st.timer); st.timer = 0; st.left = Math.max(0, st.due - performance.now()); }
    }

    const LABEL = { playing: 'Pause the headline animation', paused: 'Play the headline animation' };
    const setState = s => { toggle.dataset.state = s; label.textContent = LABEL[s]; };
    // the disc sits right after "kept." whatever the font's width
    const kept = $('[data-kept]');
    const place = () => {
      const k = kept.getBoundingClientRect(), w = wrap.getBoundingClientRect(), fs = parseFloat(getComputedStyle(hlEl).fontSize) || 60;
      if (k.width) toggle.style.left = Math.round(k.right - w.left + fs * 0.3 - 4) + 'px'; // the disc's edge 0.3 em after the dot
    };
    buildChars(wordEl, WORDS[HOME][1]);
    showDisc('spending', false);
    const forced = H.get('word'); // review frames: #freeze=0&word=groceries
    if (forced) show(forced, false);
    // Reduce Motion: the headline rests on its brand line, so there is nothing to pause.
    if (!reduceMQ.matches) {
      toggle.hidden = false;
      setState('playing');
      place();
      if ('ResizeObserver' in window) new ResizeObserver(place).observe(wrap);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
      toggle.addEventListener('click', () => {
        st.paused = !st.paused;
        setState(st.paused ? 'paused' : 'playing');
        // a visitor who presses play sees the next word soon, not the rest of a long hold
        if (!st.paused) st.left = Math.min(st.left ?? 700, 700);
        update();
      });
      if ('IntersectionObserver' in window) new IntersectionObserver(es => { for (const e of es) st.inView = e.isIntersecting; update(); }).observe(hlEl);
      else update();
    }
    return { show, update, st };
  })();

  /* --------------------------------------------------------- playback control */

  const controllers = [];

  /**
   * A loop is built the first time its stage comes near the viewport (not at boot), plays only while it is on screen,
   * the tab is visible and nobody paused it, and holds a still frame under Reduce Motion.
   */
  function control(build, opts) {
    const ctl = { lp: null, inView: false, user: false, btn: opts.btn, what: opts.what };
    ctl.setBtn = paused => {
      if (!ctl.btn) return;
      ctl.btn.dataset.paused = String(paused);
      const l = ctl.btn.querySelector('.vh'); if (l) l.textContent = (paused ? 'Play ' : 'Pause ') + ctl.what;
    };
    ctl.ensure = () => {
      if (ctl.lp || ctl.failed) return ctl.lp;
      try { ctl.lp = build(); } catch (err) {
        // If anything goes wrong the stage stays a readable still.
        ctl.failed = true; console.error(err);
        document.documentElement.dataset.loopError = String(err && err.stack || err).slice(0, 400);
      }
      if (!ctl.lp) return null;
      if (frozen != null) { ctl.lp.seek(stills && opts.name !== 'hero' ? (ctl.lp.still ?? 0) : frozen % ctl.lp.L); if (ctl.lp.sync) ctl.lp.sync(); }
      else if (reduceMQ.matches) stillFrame(ctl);
      if (ctl.lp.sync) setInterval(() => { if (ctl.lp.playing) ctl.lp.sync(); }, 250);
      if (opts.onBuild) opts.onBuild(ctl.lp);
      ctl.update();
      return ctl.lp;
    };
    ctl.update = () => {
      const run = ctl.inView && pageVisible && !ctl.user && !reduceMQ.matches && frozen == null;
      if (opts.onRun) opts.onRun(run);
      const lp = ctl.lp; if (!lp || frozen != null) return;
      const go = run && !(opts.hold && opts.hold());
      if (opts.drive) opts.drive(go); else if (go) lp.play(); else lp.pause();
      // Far from the viewport a built loop drops its animations, and with them its layers; it wakes at the same time
      // when it comes near again, a screen ahead of being seen.
      if (ctl.near !== false) lp.wake(); else if (!go && (!opts.canSleep || opts.canSleep())) lp.sleep();
      if (opts.onNear) opts.onNear(ctl.near !== false);
      if (lp.sync) lp.sync();
    };
    if (ctl.btn) ctl.btn.addEventListener('click', () => { ctl.user = !ctl.user; ctl.setBtn(ctl.user); ctl.update(); });
    // build a little ahead of the viewport, run only while at least a fifth of it shows
    ctl.near = null; // not known until the first callback
    new IntersectionObserver(es => {
      for (const e of es) ctl.near = e.isIntersecting;
      if (ctl.near && !ctl.lp) ctl.ensure(); else ctl.update();
    }, { rootMargin: '360px 0px' }).observe(opts.watch);
    new IntersectionObserver(es => { for (const e of es) ctl.inView = e.isIntersecting; ctl.update(); }, { threshold: 0.2 }).observe(opts.watch);
    if (frozen != null) ctl.ensure();
    controllers.push(ctl);
    return ctl;
  }

  function stillFrame(ctl) {
    const lp = ctl.lp;
    lp.seek(lp.still ?? 0);
    if (ctl.btn && !lp.steps) ctl.btn.hidden = true;
    if (lp.sync) lp.sync();
  }

  /* --------------------------------------------------------- the hero: one clock for the phone and the picks */

  const KEYS = ['coffee', 'groceries', 'dining', 'transport', 'home', 'bills', 'subscriptions', 'shopping'];
  // Per payment (ms into its 8 s): the tray is up from 2550 until Done at 4600; a visitor's pick is cleared at 6100,
  // half a second after the payment has landed in Today.
  const BEAT = { up: 2550, done: 4600, clear: 6100 };
  const picks = $('[data-picks]'), again = $('[data-again]'), live = $('[data-step-live]');
  const pickBtns = picks ? $$('[data-pick]', picks) : [];
  // The visitor's own pick: phase 'filing' (playing it out), 'rest' (filed, Try again offered), 'back' (reversing),
  // 'wait' (tray up again, the visitor may pick again before the demo goes on).
  const V = { phase: null, c: -1, k: -1, key: null, lv: null, T0: 0, tStart: 0, timer: 0, focus: false, confetti: false, skin: null };
  let heroCtl = null, clockTimer = 0, stepper = null;

  const heroLp = () => loops.hero;
  function heroPlay() {
    const lp = heroLp(); if (!lp) return;
    lp.play();
    if (V.lv && lp.anims[0]) { const s = lp.anims[0].startTime; V.lv.anims.forEach(a => { a.playbackRate = 1; a.startTime = s; }); V.lv.playing = true; }
    clock();
  }
  function heroPause() {
    const lp = heroLp(); if (!lp) return;
    lp.pause();
    if (V.lv) { const t = lp.time; V.lv.anims.forEach(a => { a.pause(); a.currentTime = t; }); V.lv.playing = false; }
    clock();
  }
  function heroSeek(ms) {
    const lp = heroLp(); if (!lp) return;
    lp.seek(ms); if (V.lv) V.lv.seek(ms);
    clock();
  }

  /** Is the tray up (and its tiles tappable) at loop time t? */
  function trayUp(t) {
    const P = heroLp().parts, c = Math.floor(t / P.C), u = t - c * P.C;
    return c <= 2 && u >= BEAT.up && u < BEAT.done;
  }
  // Brings the picks in line with the phone's time, then waits for the next beat (timers, never frames).
  let clockMark = -1;
  function clock(fromTimer) {
    clearTimeout(clockTimer); clockTimer = 0;
    const lp = heroLp(); if (!lp || !lp.parts) return;
    const P = lp.parts, L = lp.L;
    let t = lp.time;
    // The timer fires at a mark, but the animations' clock only moves once per frame and can read a few ms short of it.
    // A mark whose timer has fired counts as reached, so the picks open and close on the beat, never one beat late.
    if (fromTimer === true && lp.playing && clockMark >= 0) {
      const short = ((clockMark - t) % L + L) % L;
      if (short > 0 && short < 250) t = clockMark % L;
    }
    if (picks) {
      const open = trayUp(t) && (!V.phase || V.phase === 'wait');
      picks.inert = !open;
      if (!open && picks.contains(document.activeElement) && !V.phase) document.activeElement.blur();
    }
    // a pick is over once the demo has moved on past it: drop its overrides, then (at the morning reset) its row's look
    if (!V.phase && V.lv && (t > V.T0 + BEAT.clear + 40 || t < V.T0)) { V.lv.anims.forEach(a => a.cancel()); V.lv = null; }
    if (!V.phase && V.skin && (t >= P.R + 340 || t < V.T0)) unskin();
    clockMark = -1;
    if (!lp.playing) return;
    const marks = [P.R + 340, L];
    for (let c = 0; c < 3; c++) marks.push(c * P.C + BEAT.up, c * P.C + BEAT.done);
    if (V.lv) marks.push(V.T0 + BEAT.clear + 60);
    let wait = Infinity;
    for (const m of marks) { const d = ((m - t) % L + L) % L; if (d > 1 && d < wait) { wait = d; clockMark = m; } }
    if (wait < Infinity) clockTimer = setTimeout(() => clock(true), Math.max(16, wait + 6));
  }

  // The payment row of cycle c takes the look of category k (while it is hidden), and gives it back later.
  function skin(c, k) {
    const P = heroLp().parts, row = P.newRows[c], cell = P.cells[k];
    const src = $('img', cell.tile).getAttribute('src'), color = cell.tile.style.getPropertyValue('--c');
    const name = cell.tile.parentElement.querySelector('i').textContent;
    V.skin = { c, color: row.tile.style.getPropertyValue('--c'), src: $('img', row.tile).getAttribute('src'), sub: row.s.textContent, name };
    [row.tile, row.ftile].forEach(t => { t.style.setProperty('--c', color); $('img', t).setAttribute('src', src); });
    row.s.textContent = row.s.textContent.replace(/^[^·]+·/, name + ' ·');
  }
  function unskin() {
    if (!V.skin) return;
    const row = heroLp().parts.newRows[V.skin.c];
    [row.tile, row.ftile].forEach(t => { t.style.setProperty('--c', V.skin.color); $('img', t).setAttribute('src', V.skin.src); });
    row.s.textContent = V.skin.sub;
    V.skin = null; V.c = -1; V.key = null;
  }

  // One small burst of pills, once per visit, only after the visitor's own pick (the app's confetti on a first filing).
  function confetti(P) {
    if (V.confetti || reduceMQ.matches) return;
    V.confetti = true;
    const box = document.createElement('div');
    box.className = 'confetti';
    P.ui.append(box);
    const colors = ['#34C759', '#FF863E', '#007AFF', '#805FF8', '#FFB800', '#DC1FFF', '#FD6F8E', '#00C8BF'];
    const rand = xorshift(41);
    for (let i = 0; i < 18; i++) {
      const p = document.createElement('i');
      p.style.background = colors[i % colors.length];
      box.append(p);
      const a = (-160 + rand() * 140) * Math.PI / 180, v = 90 + rand() * 120;
      const dx = Math.cos(a) * v, dy = Math.sin(a) * v, r = (rand() * 2 - 1) * 280;
      p.animate([
        { transform: 'translate(0, 0) rotate(0deg) scale(.4)', opacity: 1 },
        { transform: `translate(${dx * .8}px, ${dy * .8}px) rotate(${r * .6}deg) scale(1)`, opacity: 1, offset: .45, easing: 'cubic-bezier(.2,.7,.3,1)' },
        { transform: `translate(${dx}px, ${dy + 140}px) rotate(${r}deg) scale(.9)`, opacity: 0 }
      ], { duration: 1100 + rand() * 300, delay: rand() * 60, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'both' }).onfinish = () => p.remove();
    }
    setTimeout(() => box.remove(), 1700);
  }

  // focus that came from the keyboard (a mouse click focuses a button in Chrome and on Windows, just not visibly)
  const kbFocus = el => { try { return el.matches(':focus-visible'); } catch (err) { return true; } };
  function say(text) { if (live) { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 30); } }
  function showAgain(on) {
    if (!again) return;
    if (on) {
      again.hidden = false;
      if (!reduceMQ.matches) again.animate([{ opacity: 0, transform: 'scale(.6) rotate(-40deg)' }, { opacity: 1, transform: 'none' }], { duration: D.on, easing: E.on });
    } else again.hidden = true;
  }
  function settle(after) { // the demo goes on by itself after a pause
    clearTimeout(V.timer);
    V.timer = setTimeout(() => {
      V.phase = null; showAgain(false);
      if (heroCtl) heroCtl.update(); else heroPlay();
    }, after);
  }

  /** The visitor picked tile k while the tray was up: the demo files the payment there, with the same motion. */
  function pick(k) {
    const lp = heroLp(); if (!lp || !lp.parts) return;
    const P = lp.parts, t = lp.time, c = Math.floor(t / P.C), u = t - c * P.C;
    if (c > 2 || u < BEAT.up - 250 || u >= BEAT.done || (V.phase && V.phase !== 'wait')) return;
    clearTimeout(V.timer);
    if (V.lv) { V.lv.anims.forEach(a => a.cancel()); V.lv = null; }
    if (V.skin) unskin();
    const T0 = c * P.C, H = T0 + 5250, Z = T0 + 6100, cs = P.cells, row = P.newRows[c], sc = P.pay[c].cell;
    V.c = c; V.k = k; V.key = KEYS[k]; V.T0 = T0; V.phase = 'filing';
    skin(c, k);
    const name = V.skin.name, what = `$${P.pay[c].v.toFixed(2)} at ${row.t.textContent}`;

    if (reduceMQ.matches) {
      // no travel: the filed state, under a short fade
      V.phase = 'rest'; V.tStart = T0 + 4300;
      lp.seek(T0 + 7000); P.ui.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
      if (stepper) stepper.at(2);
      clock(); showAgain(true);
      say(`Filed under ${name}: ${what}. Try again is next to the caption.`);
      return;
    }

    // The overrides: a second, sparse loop on the same clock that moves the ring, the press and the travelling tile to
    // tile k, hides the demo's finger and keeps the scripted tile in place. Created after the demo's own animations, so
    // it wins while it exists; cancelling it gives every element back to the demo, unchanged.
    const lv = new Loop('visitor', lp.L);
    const tStart = Math.max(t, T0 + 4300);
    const op = el => +getComputedStyle(el).opacity;
    lv.init(P.finger, { o: op(P.finger) }).fade(P.finger, tStart, 0, 150);
    if (k !== sc) {
      lv.init(cs[sc].ring, { o: op(cs[sc].ring) }).fade(cs[sc].ring, tStart, 0, 120);
      lv.init(cs[sc].tile, { s: 1, o: 1 }).jump(cs[sc].tile, 1, { s: 1, o: 1 }); // the scripted press and hand-off never happen
    }
    lv.init(cs[k].tile, { s: 1, o: 1 }).to(cs[k].tile, tStart, { s: 0.92 }, 110, E.out).to(cs[k].tile, tStart + 110, { s: 1 }, D.on, E.on)
      .jump(cs[k].tile, H, { o: 0 }).jump(cs[k].tile, Z, { o: 1 });
    lv.init(cs[k].ring, { s: 1.12, o: 0 }).to(cs[k].ring, tStart + 110, { s: 1, o: 1, od: 150 }, D.on, E.on)
      .jump(cs[k].ring, H, { o: 0 }).jump(cs[k].ring, Z, { s: 1.12 });
    lv.init(P.mcBase, { o: op(P.mcBase) }).fade(P.mcBase, tStart + 110, 0, 200).jump(P.mcBase, Z, { o: 1 });
    lv.init(P.mcOn, { o: op(P.mcOn) }).fade(P.mcOn, tStart + 110, 1, 200).jump(P.mcOn, Z, { o: 0 });
    const tc = P.tileC(k);
    lv.init(row.ftile, { x: tc.x - P.slot0.iconX, y: tc.y - P.slot0.iconY, s: 1.4, o: 0 })
      .jump(row.ftile, H, { o: 1 }).to(row.ftile, H + 20, { x: 0, y: 0, s: 1 }, D.on, E.on).jump(row.ftile, H + 410, { o: 0 });
    lv.build();
    V.lv = lv; V.tStart = tStart;
    heroSeek(tStart);
    heroPlay();
    const REST = T0 + 6000;
    V.confettiAt = H + 410 - tStart;
    setTimeout(() => confetti(P), V.confettiAt);
    clearTimeout(V.timer);
    V.timer = setTimeout(() => {
      heroPause(); heroSeek(REST);
      V.phase = 'rest'; showAgain(true);
      say(`Filed under ${name}: ${what}.`);
      settle(6000);
    }, REST - tStart);
  }

  /** Try again: the same motion backwards, from wherever it is, back to the tray; then the demo goes on after a pause. */
  function undo(e) {
    const lp = heroLp(); if (!lp || V.phase !== 'rest') return;
    clearTimeout(V.timer);
    // Focus goes back to the tiles only after a keyboard press. A mouse or touch press leaves focus alone, so the demo
    // (which waits while a keyboard visitor is on the tiles) goes on by itself after the pause below.
    const P = lp.parts, focusBack = !!again && document.activeElement === again && ((e && e.detail === 0) || kbFocus(again));
    showAgain(false);
    const finish = () => {
      // tray up again, nothing picked: the demo's own state at 2.7 s looks exactly like the overrides at the start
      heroSeek(V.T0 + 2700);
      if (V.lv) { V.lv.anims.forEach(a => a.cancel()); V.lv = null; }
      unskin();
      V.phase = 'wait';
      if (stepper) stepper.at(1);
      clock();
      if (focusBack && pickBtns[0]) pickBtns[0].focus();
      say('Undone. Pick another category.');
      settle(reduceMQ.matches ? 60000 : 3200);
    };
    if (reduceMQ.matches) { lp.seek(V.T0 + 4300); P.ui.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' }); finish(); return; }
    V.phase = 'back';
    const from = lp.time, to = V.tStart, rate = 1.6;
    const all = lp.anims.concat(V.lv ? V.lv.anims : []);
    all.forEach(a => { a.pause(); a.currentTime = from; a.playbackRate = -rate; a.play(); });
    lp.playing = true;
    V.timer = setTimeout(() => {
      all.forEach(a => { a.pause(); a.playbackRate = 1; });
      lp.playing = false; if (V.lv) V.lv.playing = false;
      heroSeek(to);
      finish();
    }, (from - to) / rate);
  }

  if (picks) {
    pickBtns.forEach((b, i) => b.addEventListener('click', () => pick(i)));
    // a keyboard visitor gets all the time they need: the tray stays up while focus is on its tiles
    picks.addEventListener('focusin', e => { if (kbFocus(e.target)) { V.focus = true; if (heroCtl) heroCtl.update(); } });
    picks.addEventListener('focusout', e => { if (!picks.contains(e.relatedTarget)) { V.focus = false; if (heroCtl) heroCtl.update(); } });
  }
  if (again) again.addEventListener('click', undo);

  // Reduce Motion: the hero becomes a three-step stepper over the same script (the app's DemoStage does the same).
  function heroStepper(lp) {
    const bar = $('.loop-bar');
    const pp = $('[data-pp="hero"]', bar), prev = $('[data-step="-1"]', bar), next = $('[data-step="1"]', bar);
    let i = 0;
    const show = (animate) => {
      lp.seek(lp.steps[i]);
      if (animate) lp.stepEl.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
      say(`Step ${i + 1} of 3: ${lp.stepText[i]}`);
      clock();
    };
    const on = reduceMQ.matches;
    pp.hidden = on; prev.hidden = !on; next.hidden = !on;
    if (!on) return null;
    const leave = () => { if (V.phase) { clearTimeout(V.timer); V.phase = null; showAgain(false); unskin(); } };
    prev.onclick = () => { leave(); i = (i + 2) % 3; show(true); };
    next.onclick = () => { leave(); i = (i + 1) % 3; show(true); };
    lp.seek(lp.steps[0]); clock();
    return { at: n => { i = n; } };
  }

  document.addEventListener('visibilitychange', () => {
    pageVisible = document.visibilityState !== 'hidden';
    controllers.forEach(c => c.update());
    if (headline) headline.update();
  });

  /* --------------------------------------------------------- build everything */

  const loops = {};
  if (hero) {
    // the field first draws after the headline and the phone are on screen
    requestAnimationFrame(() => setupHeroField());
    heroCtl = control(() => {
      const lp = heroLp() || heroLoop();
      if (lp) { lp.still = lp.steps[0]; loops.hero = lp; }
      return lp;
    }, {
      name: 'hero', watch: hero, btn: $('[data-pp="hero"]'), what: 'the demo and the background',
      onRun: run => { heroRun = run; if (heroField) heroField.setRun(run); },
      // a pick plays itself out; at rest, or while a keyboard visitor is on the tiles, the demo waits
      hold: () => V.phase === 'rest' || V.phase === 'wait' || V.focus,
      drive: go => { if (V.phase === 'filing' || V.phase === 'back') return; if (go) heroPlay(); else heroPause(); },
      // far down the page the phone and the chips let go of their layers, unless a visitor's pick is still in play
      canSleep: () => !V.phase && !V.lv,
      onNear: near => { heroNear = near; if (heroField) heroField.setNear(near); },
      onBuild: lp => { stepper = heroStepper(lp); clock(); }
    });
    heroCtl.ensure();
  }
  const featureLoops = [
    ['batch', batchLoop, 'the Needs a category animation'], ['budget', budgetLoop, 'the Budgets animation'],
    ['bills', billsLoop, 'the Recurring animation'], ['insights', insightsLoop, 'the Insights animation'],
    ['privacy', privacyLoop, 'the privacy animation'], ['widgets', widgetsLoop, 'the Widgets animation']
  ];
  const ctls = {};
  for (const [name, fn, what] of featureLoops) {
    const stage = $(`[data-stage="${name}"]`); if (!stage) continue;
    ctls[name] = control(() => (loops[name] = fn()), { name, watch: stage, btn: $(`[data-pp="${name}"]`), what });
  }
  // The widgets switch is a real control too: pressing a side plays the same transition and holds there.
  if (ctls.widgets) $$('[data-wbtn]').forEach((b, i) => b.addEventListener('click', () => {
    const ctl = ctls.widgets, lp = ctl.ensure(); if (!lp) return;
    ctl.user = true; ctl.setBtn(true);
    const t = lp.time, inSecond = t >= 4000 && t < 8200;
    if ((i === 1) === inSecond) return;
    if (reduceMQ.matches) { lp.seek(i ? 4500 : 0); lp.sync(); return; }
    lp.seek(i ? 3990 : 8190); lp.play();
    setTimeout(() => { lp.pause(); lp.sync(); }, 520);
    lp.sync();
  }));

  reduceMQ.addEventListener && reduceMQ.addEventListener('change', () => location.reload());

  /* --------------------------------------------------------- reveals */

  const rv = $$('.rv');
  if (frozen != null || !('IntersectionObserver' in window)) rv.forEach(el => el.classList.add('in'));
  else {
    const io = new IntersectionObserver(es => {
      for (const e of es) {
        if (!e.isIntersecting) continue;
        const el = e.target;
        const sibs = [...el.parentElement.children].filter(c => c.classList.contains('rv'));
        el.style.setProperty('--d', Math.min(sibs.indexOf(el), 6) * 60 + 'ms');
        el.classList.add('in');
        io.unobserve(el);
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    rv.forEach(el => io.observe(el));
  }

  /* --------------------------------------------------------- floating section bar */

  const fbar = $('[data-fbar]');
  if (fbar && hero) {
    const links = $$('[data-spy]', fbar);
    const pill = $('.fbar-pill', fbar);
    pill.innerHTML = '<i></i><i></i><i></i>';
    const [pl, pm, pr] = pill.children;
    const movePill = a => {
      if (!a) { pill.classList.remove('on'); return; }
      const x = a.offsetLeft, w = a.offsetWidth;
      pl.style.transform = `translateX(${x}px)`;
      pm.style.transform = `translateX(${x + 19.5}px) scaleX(${w - 39})`;
      pr.style.transform = `translateX(${x + w - 20}px)`;
      pill.classList.add('on');
    };
    new IntersectionObserver(es => es.forEach(e => {
      const show = !e.isIntersecting && e.boundingClientRect.top < 0;
      fbar.classList.toggle('show', show);
    }), { threshold: 0, rootMargin: '-80px 0px 0px 0px' }).observe(hero);
    const map = [['how', '#how'], ['features', '.feat'], ['privacy', '#privacy']];
    const secs = [];
    map.forEach(([k, sel]) => $$(sel).forEach(s => { if (k === 'features' && s.id === 'privacy') return; s.dataset.spySec = k; secs.push(s); }));
    const more = $('.more'); if (more) { more.dataset.spySec = 'features'; secs.push(more); }
    let current = null;
    const spy = new IntersectionObserver(es => {
      for (const e of es) if (e.isIntersecting) current = e.target.dataset.spySec;
      links.forEach(a => { if (a.dataset.spy === current) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
      movePill(links.find(a => a.dataset.spy === current));
    }, { rootMargin: '-45% 0px -50% 0px' });
    secs.forEach(s => spy.observe(s));
  }


  /* --------------------------------------------------------- review hooks (only with a #hash; see the top)
     #demo=word&from=spending&to=coffee&t=<ms>   the headline morph, frozen t ms in
     #demo=move|tap&x=..&y=..&t=<ms>             the chip field answering a pointer move or a click at (x, y)
     #demo=pick&k=<0-7>&at=<loop ms>&t=<ms>      the visitor's pick of tile k with the tray up at `at`, frozen t ms later
     #demo=undo&k=<0-7>&t=<ms>                   the same pick filed, then Try again, frozen t ms into the reverse
     #demo=focus&sel=<css>                       keyboard focus on that control */

  if (frozen != null) {
    // everything that is not a loop (chip fields, transitions) holds still too
    requestAnimationFrame(() => document.getAnimations().forEach(a => {
      const t = a.effect && a.effect.target;
      if (!(t && t.closest && t.closest('.ui, .caption, .wid, .hl'))) a.pause();
    }));
  }
  if (demo) addEventListener('load', () => {
    const T = Number(H.get('t') || 0);
    const freezeIn = (root, also) => {
      try {
        root.getAnimations({ subtree: true }).forEach(a => {
          if (also && !also(a)) return;
          if (a.timeline && a.timeline !== document.timeline) return; // the scroll-linked drift has no clock to set
          a.pause(); a.currentTime = T;
        });
        document.documentElement.dataset.demo = 'ready';
      } catch (err) { document.documentElement.dataset.demo = 'error: ' + err; }
    };
    const stopAll = () => { // timers, not frames: a headless review run may not draw frames between steps
      clearTimeout(V.timer); clearTimeout(clockTimer);
      // pause() alone waits for the next frame, which a headless run may never draw; setting the time settles it now
      document.getAnimations().forEach(a => {
        if (a.timeline && a.timeline !== document.timeline) return;
        const el = a.effect && a.effect.target, ct = a.currentTime;
        a.pause();
        // animations that began without a drawn frame never started their clock: give them the time they should be at
        if (el && el.closest && el.closest('.hl')) a.currentTime = Math.max(ct || 0, T - (demo === 'undo' ? 30 : 0));
        else if (el && el.closest && el.closest('.confetti')) a.currentTime = Math.max(0, T - V.confettiAt);
        else a.currentTime = ct;
      });
      document.documentElement.dataset.demo = 'ready';
    };
    if (demo === 'word' && headline) {
      headline.show(H.get('from') || 'spending', false);
      void document.body.offsetHeight;
      headline.show(H.get('to') || 'coffee', true);
      freezeIn($('.hl'));
    }
    if ((demo === 'pick' || demo === 'undo') && heroLp()) {
      const k = Number(H.get('k') || 1);
      heroCtl.user = true; heroPause();
      heroSeek(Number(H.get('at') || 3000));
      pick(k);
      if (demo === 'pick') setTimeout(stopAll, T);
      else {
        clearTimeout(V.timer); heroPause(); heroSeek(V.T0 + 6000); V.phase = 'rest';
        setTimeout(() => { undo(); setTimeout(stopAll, T); }, 30);
      }
    }
    if (demo === 'focus') { // keyboard focus on a control (#sel=css), with the tray up when it is a tile
      const el = $(H.get('sel') || '[data-pick="1"]');
      if (el && el.closest('[data-picks]') && heroLp()) { heroCtl.user = true; heroPause(); heroSeek(3000); }
      setTimeout(() => { if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } stopAll(); }, 60);
    }
    if ((demo === 'move' || demo === 'tap') && heroField) {
      const wait = () => {
        if (!heroField.built || !heroField.fontsDone) return setTimeout(wait, 30);
        heroField.still(); heroField.run = true;
        const x = Number(H.get('x') || innerWidth * 0.75), y = Number(H.get('y') || innerHeight * 0.6);
        const dot = document.createElement('i'); // where the pointer is, for the review frame only
        dot.style.cssText = `position:fixed;z-index:99;left:${x - 6}px;top:${y - 6}px;width:12px;height:12px;border-radius:50%;background:#FF3596;box-shadow:0 0 0 3px #fff;pointer-events:none`;
        document.body.append(dot);
        if (demo === 'move') heroField.pokeNow(x, y); else heroField.ripple(x, y);
        setTimeout(() => freezeIn(heroHost, a => !(heroField.chips.some(c => c.rise === a))), 60);
      };
      wait();
    }
  });

  // Debug hooks for review: window.keptLoops.hero.seek(4720), window.keptFields().hero
  window.keptLoops = loops;
  window.keptFields = () => ({ hero: heroField });
})();
