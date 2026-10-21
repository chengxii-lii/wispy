// wispy renderer: spring-driven bar, two cursor zones, dock magnification, search, quick settings.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tb = window.tb;

  // ---------------------------------------------------------------- tuning
  let BASE = 46, MAXS = 1.62;
  const GAP = 6, PAD = 9, SIGMA = 58;
  let DOCK_H = BASE + PAD * 2;
  const PILL_W = 132, PILL_H = 5, PILL_BOTTOM = 6, LIFT = 9;
  const ROW_B = 10, ROW_H = 44, DOCK_BOTTOM = ROW_B + ROW_H + 8;
  const Z1 = 150;
  let Z2 = 12;          // distance from the screen's bottom edge: peek zone, open zone
  const ZX1 = 300, ZX2 = 210;        // how far from centre each zone reaches sideways
  let DWELL = 35;
  const LEAVE = 260;

  class Spring {
    constructor(x, freq, zeta) { this.x = x; this.v = 0; this.w = 2 * Math.PI * freq; this.z = zeta; }
    step(target, dt) {
      const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
      for (let i = 0; i < n; i++) {
        const a = this.w * this.w * (target - this.x) - 2 * this.z * this.w * this.v;
        this.v += a * h; this.x += this.v * h;
      }
      this.err = Math.abs(target - this.x) + Math.abs(this.v) * 0.05;
      return this.x;
    }
  }

  // ---------------------------------------------------------------- state
  const app = $('#app'), bar = $('#bar'), pillEl = $('.bar-pill'), bodyEl = $('.bar-body'), itemsEl = $('#items');
  const row = $('#row'), q = $('#q'), toastsEl = $('#toasts');
  const S = {
    cx: -1, cy: -1, inside: false, open: false, pinned: false, mode: 'dock', leaveAt: 0, dwellAt: 0,
    openedAt: 0, suppress: false, fullscreen: false, dragging: false, interactive: false, searching: false,
  };
  const sp = {
    presence: new Spring(0, 3.4, 1), lift: new Spring(0, 3.2, .72), tx: new Spring(0, 3, .9),
    open: new Spring(0, 2.5, .8), row: new Spring(0, 3, .95),
  };
  let items = new Map(), order = [], dividerEl = null, dividerAt = -1;
  let active = false, last = 0;

  function wake() { if (!active) { active = true; last = performance.now(); requestAnimationFrame(frame); } }

  // ---------------------------------------------------------------- settings applied to the UI
  let cfg = {
    theme: 'auto', accent: 'cloud', glass: 46, iconSize: 46, magnify: 1.62,
    edgeOpen: true, edge: 'med', delay: 35, keepOpen: false, winKey: 'wispy', monitor: 'primary',
    clock24: false, seconds: false, dateFmt: 'short',
    showTray: true, showLang: true, showBattPct: true, showTaskView: true, showDesktop: false,
    dnd: false, searchEngine: 'google',
  };
  let sysAccent = '#e4ebf3';
  const lightMq = window.matchMedia('(prefers-color-scheme: light)');
  // "cloud" is the neutral default: soft white on dark, slate on light
  const cloudAccent = () => (cfg.theme === 'light' || (cfg.theme === 'auto' && lightMq.matches)) ? '#4b5a6e' : '#e4ebf3';
  const rootEl = document.documentElement;
  function inkFor(hex) {
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#14181d' : '#ffffff';
  }
  function applyConfig(c) {
    Object.assign(cfg, c);
    if (cfg.theme === 'auto') rootEl.removeAttribute('data-theme'); else rootEl.setAttribute('data-theme', cfg.theme);
    const acc = cfg.accent === 'system' ? sysAccent : cfg.accent === 'cloud' ? cloudAccent() : cfg.accent;
    rootEl.style.setProperty('--accent', acc);
    rootEl.style.setProperty('--accent-ink', inkFor(acc));
    rootEl.style.setProperty('--glass', (cfg.glass / 100).toFixed(2));
    BASE = cfg.iconSize; DOCK_H = BASE + PAD * 2; MAXS = cfg.magnify;
    Z2 = { low: 6, med: 12, high: 24 }[cfg.edge] || 12;
    DWELL = cfg.delay;
    const rc = row.classList;
    rc.toggle('no-tray', !cfg.showTray); rc.toggle('no-lang', !cfg.showLang); rc.toggle('no-pct', !cfg.showBattPct);
    rc.toggle('no-taskview', !cfg.showTaskView); rc.toggle('no-desk', !cfg.showDesktop); rc.toggle('no-date', cfg.dateFmt === 'off');
    $('#clock').classList.toggle('dnd', !!cfg.dnd);
    $('#sw-dnd').classList.toggle('on', !!cfg.dnd);
    tick();
    if (S.mode === 'settings' && !S.dragging) renderSettings();
    wake();
  }
  function setCfg(patch) { applyConfig(patch); tb.setConfig(patch); }

  // ---------------------------------------------------------------- zones
  function barHalfWidth() { return Math.max(layoutDockW(false), row.offsetWidth) / 2; }

  function zones(now) {
    const W = innerWidth, H = innerHeight;
    const d = S.inside ? H - S.cy : 1e4;
    const dx = S.inside ? Math.abs(S.cx - W / 2) : 1e4;
    S.d = d; S.dx = dx;
    // after launching something the bar stays shut only while the cursor sits still on the spot you clicked
    // (so it doesn't pop straight back over the new window); any real movement or a moment's wait brings it back
    if (S.suppress && (!S.inside || now - S.supAt > 500 || Math.hypot(S.cx - S.supX, S.cy - S.supY) > 12)) S.suppress = false;
    const inZ1 = !S.fullscreen && d < Z1 && dx < ZX1;
    const inZ2 = !S.fullscreen && !S.suppress && cfg.edgeOpen && d <= Z2 && dx < Math.max(ZX2, barHalfWidth());

    // magnet strength: grows as the cursor nears the edge, fades sideways
    const s = smooth(Z1, Z2, d) * smooth(ZX1, 150, dx);
    S.s = s; S.inZ1 = inZ1;

    if (cfg.keepOpen && !S.open && !S.fullscreen) { S.open = true; S.leaveAt = 0; }
    if (!S.open) {
      if (inZ2) {
        if (!S.dwellAt) S.dwellAt = now;
        if (now - S.dwellAt > DWELL) openBar(false);
      } else S.dwellAt = 0;
    } else {
      const hold = cfg.keepOpen || S.pinned || S.mode !== 'dock' || S.searching || S.dragging || S.ctx || q.value;
      const keepX = barHalfWidth() + 56, keepTop = DOCK_BOTTOM + DOCK_H + 64;
      const keep = hold || (S.inside && dx < keepX && d < keepTop);
      if (keep) S.leaveAt = 0;
      else {
        if (!S.leaveAt) S.leaveAt = now;
        if (now - S.leaveAt > LEAVE) closeBar();
      }
    }
  }

  function openBar(fromKey) {
    if (S.open) return;
    S.open = true; S.leaveAt = 0;
    if (fromKey) S.pinned = true;
    wake();
  }

  // after you open, close or switch an app from the dock: a dock you opened with the mouse stays put (so you can
  // see what happened and keep going); one opened with the Windows key closes as before
  function afterAction() {
    if (S.pinned) { closeBar({ launched: true }); return; }
    hideMenu();
    if (S.mode !== 'dock') setMode('dock');
    S.leaveAt = 0;
    wake();
  }

  function closeBar(opts) {
    const launched = opts && opts.launched;
    if (!S.open && S.mode === 'dock') return;
    hideMenu();
    S.open = !!cfg.keepOpen && !S.fullscreen; S.pinned = false; S.dwellAt = 0;
    if (launched) { S.suppress = true; S.supAt = performance.now(); S.supX = S.cx; S.supY = S.cy; }
    setMode('dock');
    q.value = ''; q.blur(); S.searching = false;
    results = []; fileResults = [];
    tb.release(!launched);
    wake();
  }

  // ---------------------------------------------------------------- dock
  function setDock(list) {
    if (drag && drag.moved) { pendingDock = list; return; }
    const ids = new Set(list.map((i) => i.id));
    // an app that just closed lingers for a moment, dimmed, so you can see it go (instead of vanishing)
    const prevIdx = new Map(order.map((o, i) => [o, i]));
    for (const [id, it] of items) {
      if (ids.has(id)) continue;
      if (!it.ghost) {
        it.ghost = true; it.el.classList.add('closing'); it.el.classList.remove('run', 'active');
        it.ghostTimer = setTimeout(() => dropGhost(it), CLOSE_LINGER);
      }
    }
    order = [];
    list.forEach((d) => {
      let it = items.get(d.id);
      if (!it) {
        const el = document.createElement('button');
        el.className = 'item'; el.dataset.id = d.id;
        el.innerHTML = '<span class="ph"></span><span class="tip"></span><span class="dot"></span>';
        el.addEventListener('click', (e) => {
          if (it.suppressClick) { it.suppressClick = false; return; }
          const cur = it.data || d;
          if (cur.running > 1 && cur.wins && !e.shiftKey) { openPicker(it, cur); return; }
          tb.dockClick(d.id, e.shiftKey ? 'new' : ''); afterAction();
        });
        el.addEventListener('pointerdown', (e) => beginDrag(it, e));
        el.addEventListener('auxclick', (e) => { if (e.button === 1) { tb.dockClick(d.id, 'new'); afterAction(); } });
        it = { id: d.id, el, scale: new Spring(1, 7, .82), intro: 0, icon: null, pinned: d.pinned, dx: 0 };
        it.tip = el.querySelector('.tip');
        items.set(d.id, it);
        itemsEl.appendChild(el);
      }
      if (it.ghost) { it.ghost = false; clearTimeout(it.ghostTimer); it.el.classList.remove('closing'); }   // it came back
      // a pinned app whose last window just closed dims for a moment too
      if (it.data && it.data.running > 0 && !(d.running > 0) && d.pinned) {
        it.el.classList.add('closing'); clearTimeout(it.fadeTimer);
        it.fadeTimer = setTimeout(() => { if (!it.ghost) it.el.classList.remove('closing'); }, CLOSE_LINGER);
      }
      it.pinned = d.pinned;
      it.data = d;
      it.tip.textContent = d.name;
      it.el.setAttribute('aria-label', d.name);
      it.el.classList.toggle('run', d.running > 0);
      it.el.classList.toggle('active', !!d.active);
      if (d.icon !== it.icon) {
        it.icon = d.icon;
        const cur = it.el.firstElementChild;
        if (d.icon) {
          const img = new Image(); img.draggable = false; img.alt = '';
          img.src = d.icon;
          cur.replaceWith(img);
        } else if (cur.tagName === 'IMG') {
          const ph = document.createElement('span'); ph.className = 'ph'; cur.replaceWith(ph);
        }
      }
      order.push(it);
    });
    // closing apps keep their slot until the linger ends
    for (const it of items.values()) {
      if (it.ghost) order.splice(Math.min(prevIdx.has(it) ? prevIdx.get(it) : order.length, order.length), 0, it);
    }
    // keep DOM order and the divider between pinned and running-only apps
    if (!dividerEl) { dividerEl = document.createElement('span'); dividerEl.className = 'divider'; }
    const firstExtra = order.findIndex((i) => !i.pinned);
    dividerAt = firstExtra > 0 ? firstExtra : -1;
    placeItems();
    wake();
  }

  const CLOSE_LINGER = 900;
  function dropGhost(it) {
    if (items.get(it.id) !== it || !it.ghost) return;
    it.el.remove(); items.delete(it.id);
    order = order.filter((o) => o !== it);
    placeItems(); wake();
  }

  // keep the DOM in step with `order`, with the divider between pinned and running-only apps
  function placeItems() {
    if (!dividerEl) { dividerEl = document.createElement('span'); dividerEl.className = 'divider'; }
    const firstExtra = order.findIndex((i) => !i.pinned);
    dividerAt = firstExtra > 0 ? firstExtra : -1;
    order.forEach((it, i) => {
      if (i === dividerAt) itemsEl.appendChild(dividerEl);
      itemsEl.appendChild(it.el);
    });
    dividerEl.classList.toggle('gone', dividerAt < 0);
    if (dividerAt < 0 && dividerEl.parentNode) dividerEl.remove();
  }

  // drag a pinned app sideways to reorder it; the new arrangement is saved by main
  let drag = null, pendingDock = null;
  function restCenters() {
    let x = innerWidth / 2 - layoutDockW(false) / 2 + PAD;
    const cs = [];
    order.forEach((it, i) => { cs.push(x + BASE / 2); x += BASE + GAP + (i === dividerAt - 1 ? GAP + 7 : 0); });
    return cs;
  }
  function beginDrag(it, e) {
    if (e.button !== 0 || !it.pinned || S.mode !== 'dock') return;
    drag = { it, x0: e.clientX, y0: e.clientY, moved: false, id: e.pointerId };
  }
  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 8) return;
      drag.moved = true; S.dragItem = drag.it; S.dragging = true;
      drag.it.el.classList.add('dragging'); drag.it.dsp = null;
      try { drag.it.el.setPointerCapture(drag.id); } catch (err) { /* ignore */ }
    }
    const it = drag.it, cs = restCenters();
    const pinnedN = order.filter((o) => o.pinned).length;
    let idx = 0, best = 1e9;
    for (let i = 0; i < pinnedN; i++) { const dd = Math.abs(e.clientX - cs[i]); if (dd < best) { best = dd; idx = i; } }
    const cur = order.indexOf(it);
    if (idx !== cur) { order.splice(cur, 1); order.splice(idx, 0, it); placeItems(); }
    it.dx = e.clientX - cs[order.indexOf(it)];
    wake();
  });
  function endDrag() {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved) return;
    S.dragItem = null; S.dragging = false;
    d.it.el.classList.remove('dragging');
    d.it.suppressClick = true;
    setTimeout(() => { d.it.suppressClick = false; }, 80);
    d.it.dsp = new Spring(d.it.dx || 0, 6, .85);
    tb.pinOrder(order.filter((o) => o.pinned).map((o) => o.id));
    if (pendingDock) { const l = pendingDock; pendingDock = null; setDock(l); }
    wake();
  }
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);

  // total dock width for the current item scales (magnified: true) or rest (false)
  function layoutDockW(magnified) {
    let w = PAD * 2, n = order.length;
    order.forEach((it, i) => {
      w += BASE * (magnified ? it.scale.x : 1);
      if (i < n - 1) w += GAP;
      if (i === dividerAt) w += GAP + 7;
    });
    return n ? w : PILL_W + 40;
  }

  function magnify() {
    const W = innerWidth, H = innerHeight;
    const on = !S.dragItem && sp.open.x > .85 && S.mode === 'dock' && S.inside && S.d > DOCK_BOTTOM - 8 && S.d < DOCK_BOTTOM + DOCK_H + 90;
    const wv = on ? 1 - smooth(DOCK_BOTTOM + DOCK_H + 20, DOCK_BOTTOM + DOCK_H + 90, S.d) : 0;
    const restW = layoutDockW(false);
    let x = W / 2 - restW / 2 + PAD, best = -1, bestD = 1e9;
    order.forEach((it, i) => {
      const c = x + BASE / 2;
      const dist = Math.abs(S.cx - c);
      it.target = on ? 1 + (MAXS - 1) * Math.exp(-(dist * dist) / (2 * SIGMA * SIGMA)) * wv : 1;
      if (on && dist < bestD) { bestD = dist; best = i; }
      x += BASE + GAP + (i === dividerAt - 1 ? GAP + 7 : 0);
    });
    order.forEach((it, i) => it.el.classList.toggle('tipped', on && i === best && it.target > 1.28));
  }

  // ---------------------------------------------------------------- frame
  function frame(t) {
    const dt = Math.min(.05, (t - last) / 1000 || .016);
    last = t;
    if (update(dt, t)) requestAnimationFrame(frame); else active = false;
  }

  // one simulation + render step; returns true while something is still moving
  function update(dt, t) {
    zones(t);
    magnify();
    if (S.open !== S.rep) { S.rep = S.open; tb.barOpen(S.open); }

    const open = S.open, inZ1 = S.inZ1;
    sp.presence.step(inZ1 || open ? 1 : 0, dt);
    sp.lift.step(open ? 0 : LIFT * Math.pow(S.s, .8), dt);
    sp.tx.step(inZ1 && !open ? clamp((S.cx - innerWidth / 2) * .1, -24, 24) : 0, dt);
    sp.open.step(open ? 1 : 0, dt);
    sp.row.step(open ? 1 : 0, dt);
    let err = 0;
    for (const k in sp) err = Math.max(err, sp[k].err || 0);

    order.forEach((it) => { it.scale.step(it.target, dt); err = Math.max(err, it.scale.err || 0); });

    const o = sp.open.x, e = clamp(o, 0, 1.02);
    const dockW = layoutDockW(true);
    const w = lerp(PILL_W, dockW, e), h = lerp(PILL_H, DOCK_H, e);
    const y = lerp(PILL_BOTTOM + sp.lift.x, DOCK_BOTTOM, e);
    const rad = lerp(PILL_H / 2, DOCK_H / 2, smooth(0, .5, o));
    const vis = sp.presence.x > .01 || o > .01;
    bar.style.visibility = vis ? 'visible' : 'hidden';
    bar.style.opacity = clamp(sp.presence.x, 0, 1).toFixed(3);
    bar.style.width = w.toFixed(1) + 'px';
    bar.style.height = h.toFixed(1) + 'px';
    bar.style.borderRadius = rad.toFixed(1) + 'px';
    bar.style.transform = `translate3d(${(sp.tx.x - w / 2).toFixed(1)}px, ${(-y).toFixed(1)}px, 0)`;
    pillEl.style.opacity = (1 - smooth(0, .4, o)).toFixed(3);
    bodyEl.style.opacity = smooth(.05, .55, o).toFixed(3);
    itemsEl.style.pointerEvents = o > .6 && S.mode === 'dock' ? 'auto' : 'none';

    const n = order.length;
    if (dividerEl) dividerEl.style.opacity = smooth(.55, .9, o).toFixed(3);
    order.forEach((it, i) => {
      const f = n > 1 ? i / (n - 1) : 0;
      const ip = smooth(.38 + .22 * f, .72 + .26 * f, o);
      if (it.dsp) {
        it.dx = it.dsp.step(0, dt); err = Math.max(err, it.dsp.err || 0);
        if (Math.abs(it.dx) < .3 && Math.abs(it.dsp.v) < 2) { it.dx = 0; it.dsp = null; }
      }
      const sz = BASE * it.scale.x;
      it.el.style.width = sz.toFixed(1) + 'px';
      it.el.style.height = sz.toFixed(1) + 'px';
      it.el.style.opacity = ip.toFixed(3);
      it.el.style.transform = `translateX(${(it.dx || 0).toFixed(1)}px) translateY(${((1 - ip) * 12).toFixed(1)}px) scale(${(.84 + .16 * ip).toFixed(3)})`;
    });

    const r = clamp(sp.row.x, 0, 1.01), rp = smooth(.3, 1, r);
    row.style.opacity = rp.toFixed(3);
    row.style.visibility = rp > .01 ? 'visible' : 'hidden';
    row.style.transform = `translate3d(-50%, ${((1 - rp) * 16).toFixed(1)}px, 0)`;
    if (S.wantFocus && rp > .01) { q.focus(); if (document.activeElement === q || !S.open) S.wantFocus = false; }

    toastsEl.style.transform = `translate3d(-50%, ${(-lerp(30 + sp.lift.x * .6, DOCK_BOTTOM + DOCK_H + 34, e)).toFixed(1)}px, 0)`;

    updateInteractive();
    if (err > .002 || open || inZ1 || sp.presence.x > .01) return true;
    bar.style.visibility = 'hidden';
    return false;
  }

  function updateInteractive() {
    let want = S.dragging;
    if (!want && S.inside) {
      const el = document.elementFromPoint(S.cx, S.cy);
      want = !!(el && (el.closest('.hit') || (el.closest('#items') && itemsEl.style.pointerEvents === 'auto')));
    }
    if (want !== S.interactive) { S.interactive = want; tb.interactive(want); }
  }

  // ---------------------------------------------------------------- modes + panels
  const panels = { search: $('#p-search'), quick: $('#p-quick'), cal: $('#p-cal'), menu: $('#p-menu'), tray: $('#p-tray'), lang: $('#p-lang'), settings: $('#p-settings') };
  function setMode(m) {
    if (S.mode === m) return;
    S.mode = m;
    S.openedAt = Date.now();
    app.className = 'mode-' + (m === 'dock' ? 'dock' : 'panel');
    for (const k in panels) panels[k].classList.toggle('show', k === m);
    $('#status').classList.toggle('on', m === 'quick');
    $('#clock').classList.toggle('on', m === 'cal');
    $('#tray-btn').classList.toggle('on', m === 'tray');
    $('#lang-btn').classList.toggle('on', m === 'lang');
    if (m === 'quick') openQuick();
    if (m === 'cal') openCal();
    if (m === 'settings') openSettings();
    if (m === 'tray') { renderTray(); placeAt(panels.tray, $('#tray-btn')); }
    if (m === 'lang') { renderLang(); placeAt(panels.lang, $('#lang-btn')); }
    wake();
  }
  function placePanel(p, align) {
    const rw = row.offsetWidth;
    if (align === 'right') p.style.setProperty('--panel-shift', (rw / 2 - p.offsetWidth / 2) + 'px');
  }

  // centre a panel over the button that opened it, kept inside the window
  function placeAt(p, btn) {
    const shift = btn.offsetLeft + btn.offsetWidth / 2 - row.offsetWidth / 2;
    const max = innerWidth / 2 - p.offsetWidth / 2 - 8;
    p.style.setProperty('--panel-shift', clamp(shift, -max, max) + 'px');
  }
  const toggleMode = (m) => { if (S.mode === m) setMode('dock'); else { openBar(true); setMode(m); } };
  $('#status').addEventListener('click', () => toggleMode('quick'));
  $('#clock').addEventListener('click', () => toggleMode('cal'));
  $('#tray-btn').addEventListener('click', () => toggleMode('tray'));
  $('#lang-btn').addEventListener('click', () => toggleMode('lang'));

  // ---------------------------------------------------------------- search
  let results = [], fileResults = [], sel = 0, seq = 0;
  const iconMem = new Map();
  const KIND_BONUS = { app: 8, command: 4, setting: 0, file: -6 };

  function compose() {
    const all = results.concat(fileResults).sort((a, b) => (b.s + KIND_BONUS[b.kind]) - (a.s + KIND_BONUS[a.kind])).slice(0, 8);
    return all.concat([{ kind: 'web', title: 'Search the web for “' + q.value.trim() + '”', sub: 'Google', query: q.value.trim() }]);
  }

  // the action pane on the right of search, like Windows search: what you can do with the selected result
  const ACTIONS = {
    open: ['Open', 'i-open'], admin: ['Run as administrator', 'i-shield'], location: ['Open file location', 'i-folder'],
    pin: ['Pin to taskbar', 'i-pin'], unpin: ['Unpin from taskbar', 'i-unpin'], uninstall: ['Uninstall', 'i-trash'],
    openwith: ['Open with…', 'i-open'], copypath: ['Copy full path', 'i-copy'], terminal: ['Open in Terminal', 'i-term'],
  };
  const KIND_LABEL = { app: 'App', setting: 'Settings', file: 'File', web: 'Web search', command: 'Power' };
  function actionsFor(r) {
    if (!r) return [];
    if (r.kind === 'app') return ['open', r.canAdmin && 'admin', r.canLocation && 'location', r.spec && (r.pinned ? 'unpin' : 'pin'), 'uninstall'].filter(Boolean);
    if (r.kind === 'file' && r.isDir) return ['open', 'terminal', 'copypath'];
    if (r.kind === 'file') return ['open', r.canAdmin && 'admin', 'openwith', 'location', r.spec && (r.pinned ? 'unpin' : 'pin'), 'copypath'].filter(Boolean);
    return ['open'];
  }
  let paneKey = '', paneDone = null;
  function resultIcon(r) {
    const icons = { setting: 'i-gear', file: 'i-file', web: 'i-globe', app: 'i-app', command: 'i-power' };
    const ic = r.kind === 'file' && r.isDir ? 'i-folder' : icons[r.kind];
    const cached = r.iconKey && iconMem.get(r.iconKey);
    return cached ? `<img src="${esc(cached)}" alt="">` : `<svg class="ic"><use href="#${ic}"/></svg>`;
  }
  function renderResults() {
    const list = compose();
    sel = clamp(sel, 0, list.length - 1);
    const rows = list.map((r, i) => `<div class="res${i === sel ? ' sel' : ''}" data-i="${i}"><span class="rico">${resultIcon(r)}</span>` +
      `<span class="rt"><b>${esc(r.title)}</b><i>${esc(r.sub)}</i></span></div>`).join('');
    const r = list[sel];
    const key = r.kind + ':' + r.title + ':' + (r.path || r.id || '');
    const fresh = key !== paneKey;
    paneKey = key;
    const sub = r.kind === 'file' ? r.sub : KIND_LABEL[r.kind];
    const pane = `<aside class="sr-pane"><div class="sp-hero${fresh ? ' anim' : ''}"><span class="sp-ic">${resultIcon(r)}</span><b>${esc(r.title)}</b><i>${esc(sub)}</i></div>` +
      `<div class="sp-acts${fresh ? ' anim' : ''}">${actionsFor(r).map((a, i) => {
        const done = paneDone && paneDone.key === key && paneDone.act === a;
        return `<button class="${done ? 'done' : ''}" style="--i:${i}" data-ra="${a}">${done ? '<svg class="ic"><use href="#i-check"/></svg>' : `<svg class="ic"><use href="#${ACTIONS[a][1]}"/></svg>`}` +
          `<span>${done ? esc(paneDone.text) : ACTIONS[a][0]}</span>${a === 'admin' ? '<kbd>Ctrl Shift Enter</kbd>' : a === 'open' ? '<kbd>Enter</kbd>' : ''}</button>`;
      }).join('')}</div></aside>`;
    panels.search.innerHTML = `<div class="sr"><div class="sr-list">${rows}</div>${pane}</div>`;
    // fetch missing icons for apps and files, then refresh in place
    list.forEach((x) => {
      if (!x.iconKey || iconMem.has(x.iconKey)) return;
      iconMem.set(x.iconKey, null);
      tb.icon(x.iconSrc, x.iconKey).then((u) => { if (u) { iconMem.set(x.iconKey, u); if (S.mode === 'search') renderResults(); } else iconMem.delete(x.iconKey); });
    });
    panels.search.currentList = list;
  }
  async function runAction(r, a) {
    if (!r) return;
    if (a === 'open') { activate(r); return; }
    const res = await tb.resultAction(r, a);
    const key = r.kind + ':' + r.title + ':' + (r.path || r.id || '');
    if (a === 'pin' || a === 'unpin') {
      r.pinned = !!(res && res.pinned);
      paneDone = { key, act: r.pinned ? 'unpin' : 'pin', text: r.pinned ? 'Pinned to taskbar' : 'Unpinned' };
    } else if (a === 'copypath') {
      paneDone = { key, act: a, text: 'Copied' };
    } else { closeBar({ launched: true }); return; }
    if (S.mode === 'search') renderResults();
    clearTimeout(runAction.t);
    runAction.t = setTimeout(() => { paneDone = null; if (S.mode === 'search') renderResults(); }, 1300);
  }

  async function runSearch() {
    const text = q.value.trim();
    if (!text) { results = []; fileResults = []; if (S.mode === 'search') setMode('dock'); return; }
    openBar(true);
    const my = ++seq;
    setMode('search');
    placeSearch();
    const r = await tb.search(text, my);
    if (my !== seq) return;
    results = r.items; fileResults = fileResults.filter(() => false);
    sel = 0;
    renderResults();
  }
  function placeSearch() { panels.search.style.width = row.offsetWidth + 'px'; panels.search.style.setProperty('--panel-shift', '0px'); }

  tb.on('search-files', (s, files) => { if (s !== seq) return; fileResults = files; renderResults(); });

  q.addEventListener('input', runSearch);
  $('#search').addEventListener('mousedown', async (e) => {
    if (e.target === q && S.searching) return;
    e.preventDefault();
    await focusSearch();
  });
  async function focusSearch() { await tb.focusMe(); S.searching = true; S.wantFocus = true; q.focus(); wake(); }

  panels.search.addEventListener('mousemove', (e) => {
    const r = e.target.closest('.res'); if (!r) return;
    const i = +r.dataset.i; if (i !== sel) { sel = i; renderResults(); }
  });
  panels.search.addEventListener('click', (e) => {
    const a = e.target.closest('[data-ra]');
    if (a) { runAction(panels.search.currentList[sel], a.dataset.ra); return; }
    const r = e.target.closest('.res'); if (!r) return;
    activate(panels.search.currentList[+r.dataset.i]);
  });
  function activate(r) {
    if (!r) return;
    if (r.kind === 'command') { const rr = row.getBoundingClientRect(); powerRun(r.cmd, rr.x + rr.width / 2, rr.y); return; }
    tb.open(r); closeBar({ launched: true });
  }

  document.addEventListener('keydown', (e) => {
    // typing right after the Win key should always land in search, even if focus arrives a beat late
    if (S.open && S.mode !== 'quick' && S.mode !== 'cal' && S.mode !== 'menu' && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && document.activeElement !== q) q.focus();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (S.ctx) { hideMenu(); return; }
      if (S.mode === 'quick' && quickPage !== 'main') { showQuickPage('main'); return; }
      if (q.value) { q.value = ''; runSearch(); return; }
      if (S.mode !== 'dock') { setMode('dock'); return; }
      closeBar();
      return;
    }
    if (S.mode === 'search') {
      const list = panels.search.currentList || [];
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % list.length; renderResults(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + list.length) % list.length; renderResults(); }
      else if (e.key === 'Enter' && e.ctrlKey && e.shiftKey) { e.preventDefault(); if (actionsFor(list[sel]).includes('admin')) runAction(list[sel], 'admin'); }
      else if (e.key === 'Enter') { e.preventDefault(); activate(list[sel]); }
      else if (e.key === 'Tab') { e.preventDefault(); sel = (sel + (e.shiftKey ? -1 : 1) + list.length) % list.length; renderResults(); }
    } else if (e.key === 'Enter' && document.activeElement === q) {
      e.preventDefault();
    }
  });

  // ---------------------------------------------------------------- clock + battery + status
  const clkTime = $('#clk-time'), clkDate = $('#clk-date');
  function tick() {
    const d = new Date();
    const topt = { hour: 'numeric', minute: '2-digit' };
    if (cfg.seconds) topt.second = '2-digit';
    if (cfg.clock24) { topt.hour12 = false; topt.hour = '2-digit'; }
    const t = d.toLocaleTimeString([], topt);
    const dd = cfg.dateFmt === 'long' ? d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : d.toLocaleDateString();
    if (clkTime.textContent !== t) clkTime.textContent = t;
    if (clkDate.textContent !== dd) clkDate.textContent = dd;
  }
  tick(); setInterval(tick, 1000);

  const batt = { level: 1, charging: false, remaining: Infinity, present: true };
  function battSvg(level, charging) {
    const w = Math.max(.5, 13.5 * clamp(level, 0, 1));
    const low = level <= .15 && !charging;
    return `<rect x="2" y="7" width="18" height="10" rx="2.6" fill="none"/><path d="M22.2 11v2" /><rect x="3.8" y="8.8" width="${w.toFixed(1)}" height="6.4" rx="1.2" fill="${low ? '#ff6369' : 'currentColor'}" stroke="none"/>` +
      (charging ? '<path d="M12.6 8.4 9 12.4h3l-.6 3.4 3.6-4.2h-3z" fill="var(--surface-solid, #1e1e21)" stroke="none"/>' : '');
  }
  function renderBatt() {
    const pct = Math.round(batt.level * 100);
    $('#st-pct').textContent = pct + '%';
    $('#st-batt').innerHTML = battSvg(batt.level, batt.charging);
    $('#q-batt-ic').innerHTML = battSvg(batt.level, batt.charging);
    let txt = pct + '%';
    if (batt.charging) txt += batt.level >= 1 ? ' · fully charged' : ' · charging';
    else if (isFinite(batt.remaining) && batt.remaining > 0) {
      const m = Math.round(batt.remaining / 60), h = Math.floor(m / 60);
      txt += ' · ' + (h ? h + ' h ' : '') + (m % 60) + ' min left';
    }
    $('#q-batt-text').textContent = txt;
  }
  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      const upd = () => { batt.level = b.level; batt.charging = b.charging; batt.remaining = b.dischargingTime; renderBatt(); };
      ['levelchange', 'chargingchange', 'dischargingtimechange'].forEach((ev) => b.addEventListener(ev, upd));
      upd();
    }).catch(renderBatt);
  } else renderBatt();

  let vol = { level: 50, muted: false }, volTouched = 0;
  function renderVol() {
    const id = vol.muted || vol.level === 0 ? 'i-mute' : vol.level < 35 ? 'i-vol-low' : 'i-vol';
    $('#st-vol use').setAttribute('href', '#' + id);
    ['', '2'].forEach((n) => {
      $('#s-vol' + n + '-ic use').setAttribute('href', '#' + id);
      if (performance.now() - volTouched > 450) {
        const r = $('#r-vol' + n); r.value = vol.level; setP(r); $('#v-vol' + n).textContent = vol.muted ? '–' : Math.round(vol.level);
      }
    });
  }
  function setP(r) { r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min) * 100) + '%'); }
  tb.on('volume', (level, muted) => { vol = { level, muted }; renderVol(); });

  const wifi = { present: true, connected: false, ssid: '', signal: 0 };
  async function refreshWifi() {
    try { Object.assign(wifi, await tb.wifi()); } catch (e) { /* offline helper */ }
    $('#st-wifi').style.opacity = wifi.connected ? 1 : .42;
    renderTiles();
  }

  // ---------------------------------------------------------------- quick settings
  const radio = { wifi: null, bt: null };
  let quickPage = 'main';
  const qwrap = $('#p-quick .qwrap');
  const tileState = (id, on, label) => {
    const t = $('#' + id); t.classList.toggle('on', !!on);
    const s = $('#' + id + '-sub'); if (s && label != null) s.textContent = label;
  };
  function renderTiles() {
    const wOn = radio.wifi === null ? wifi.connected : radio.wifi;
    tileState('t-wifi', wOn, wOn && wifi.connected && wifi.ssid ? wifi.ssid : 'Wi-Fi');
    const btOn = (btState.devs || []).find((d) => d.connected);
    tileState('t-bt', radio.bt, radio.bt && btOn ? btOn.name : 'Bluetooth');
    $('#sw-wifi').classList.toggle('on', !!wOn);
    $('#sw-bt').classList.toggle('on', !!radio.bt);
  }
  function applyRadios(list) {
    if (!list || !list.length) return;
    const st = (k) => { const r = list.find((x) => x.kind === k); return r ? r.state === 'On' : null; };
    radio.wifi = st('WiFi'); radio.bt = st('Bluetooth');
    renderTiles();
  }

  // grow or shrink the panel smoothly around any content change
  function morph(fn) {
    const h0 = qwrap.offsetHeight;
    fn();
    if (!panels.quick.classList.contains('show')) return;
    qwrap.style.height = 'auto';
    const h1 = qwrap.offsetHeight;
    if (Math.abs(h1 - h0) < 2) { qwrap.style.height = ''; return; }
    qwrap.style.height = h0 + 'px';
    void qwrap.offsetHeight;
    qwrap.style.height = h1 + 'px';
    clearTimeout(qwrap._t);
    qwrap._t = setTimeout(() => { qwrap.style.height = ''; }, 360);
  }

  function openQuick() {
    placePanel(panels.quick, 'right');
    quickPage = 'main';
    ['main', 'wifi', 'bt', 'sound'].forEach((k) => $('#q-' + k).classList.toggle('active', k === 'main'));
    renderTiles(); renderVol(); renderBatt();
    refreshWifi();
    tb.radios().then(applyRadios);
    tb.btDevices().then((d) => { btState.devs = d; renderTiles(); });
  }
  function showQuickPage(p) {
    const back = p === 'main';
    morph(() => {
      quickPage = p;
      ['main', 'wifi', 'bt', 'sound'].forEach((k) => {
        const el = $('#q-' + k);
        el.classList.remove('enter-fwd', 'enter-back');
        el.classList.toggle('active', k === p);
      });
      const el = $('#q-' + p);
      void el.offsetWidth;
      el.classList.add(back ? 'enter-back' : 'enter-fwd');
      if (p === 'wifi') renderNets();
      if (p === 'bt') renderBt();
      if (p === 'sound') renderSound();
    });
    if (p === 'wifi') loadNetworks();
    if (p === 'bt') loadBt();
    if (p === 'sound') loadSound();
  }
  async function toggleRadio(kind, key, tileId) {
    const t = $('#' + tileId); if (t.classList.contains('busy')) return;
    t.classList.add('busy');
    radio[key] = !radio[key]; renderTiles();
    if (quickPage === 'wifi') morph(renderNets);
    if (quickPage === 'bt') morph(renderBt);
    applyRadios(await tb.setRadio(kind, radio[key]));
    t.classList.remove('busy');
    refreshWifi();
    if (quickPage === 'wifi') loadNetworks();
    if (quickPage === 'bt') loadBt();
  }
  panels.quick.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    switch (b.dataset.act) {
      case 'wifi': toggleRadio('WiFi', 'wifi', 't-wifi'); break;
      case 'bt': toggleRadio('Bluetooth', 'bt', 't-bt'); break;
      case 'settings': tb.openSettings('ms-settings:'); closeBar({ launched: true }); break;
      case 'power': { const r = b.getBoundingClientRect(); powerMenu(r.x + r.width / 2, r.y); break; }
      case 'more': tb.openSettings(b.dataset.uri); closeBar({ launched: true }); break;
      case 'mute': tb.volume({ muted: !vol.muted }); vol.muted = !vol.muted; renderVol(); break;
      case 'page-wifi': showQuickPage('wifi'); break;
      case 'page-bt': showQuickPage('bt'); break;
      case 'page-sound': showQuickPage('sound'); break;
      case 'back': showQuickPage('main'); break;
    }
  });
  $('#sw-wifi').addEventListener('click', () => toggleRadio('WiFi', 'wifi', 't-wifi'));
  $('#sw-bt').addEventListener('click', () => toggleRadio('Bluetooth', 'bt', 't-bt'));

  const skeleton = (n) => `<div class="group">${'<div class="sk"></div>'.repeat(n)}</div>`;
  const note = (title, text) => `<div class="empty-note"><b>${esc(title)}</b>${text ? esc(text) : ''}</div>`;
  const ICON = (id) => `<svg class="ic"><use href="#${id}"/></svg>`;

  // ---------------------------------------------------------------- Wi-Fi page
  const wifiState = { nets: null, open: null, busy: null, error: {} };
  function bars(s) {
    const lv = s >= 70 ? 3 : s >= 45 ? 2 : s >= 20 ? 1 : 0;
    return `<svg class="ic wb" viewBox="0 0 24 24"><path d="M12 20h.01"/><path class="${lv >= 1 ? '' : 'dim'}" d="M8.5 16.43a5 5 0 0 1 7 0"/>` +
      `<path class="${lv >= 2 ? '' : 'dim'}" d="M5 12.86a10 10 0 0 1 14 0"/><path class="${lv >= 3 ? '' : 'dim'}" d="M2 8.82a15 15 0 0 1 20 0"/></svg>`;
  }
  function netRow(n, i) {
    const busy = wifiState.busy === n.ssid, err = wifiState.error[n.ssid];
    const open = wifiState.open === n.ssid && !n.connected && !busy;
    const sub = busy ? 'Connecting…' : err ? `<i class="err">${esc(err)}</i>` : null;
    const plain = n.connected ? 'Connected' + (n.secured ? ', secured' : '') : n.known ? 'Saved' : n.enterprise ? 'Needs sign-in' : n.secured ? 'Secured' : 'Open';
    const trail = busy ? '<span class="spin"></span>' : n.connected ? '<button class="pill-btn" data-wifi="disconnect">Disconnect</button>' : n.secured ? `<svg class="ic lk"><use href="#i-lock"/></svg>` : '';
    let h = `<div class="ri${n.connected ? ' on' : ' tap'}" style="--i:${i}" data-ssid="${esc(n.ssid)}"><span class="ico">${bars(n.signal)}</span>` +
      `<span class="tx"><b>${esc(n.ssid)}</b>${sub && sub.startsWith('<i') ? sub : `<i>${sub || plain}</i>`}</span>${trail}</div>`;
    if (open) {
      h += '<div class="ri-expand">' + (n.enterprise
        ? '<p>This network signs in with an account.</p><button class="pill-btn primary" data-wifi="signin">Sign in</button>'
        : (n.known || !n.secured)
          ? '<p>' + (n.known ? 'Saved network' : 'Open network') + '</p><button class="pill-btn primary" data-wifi="connect">Connect</button>'
          : '<input class="pw" type="password" placeholder="Network security key" spellcheck="false"><button class="pill-btn primary" data-wifi="join">Connect</button>') + '</div>';
    }
    return `<div>${h}</div>`;
  }
  function renderNets() {
    const list = $('#wifi-list');
    if (radio.wifi === false) { list.innerHTML = note('Wi-Fi is off', 'Turn it on to see networks near you.'); return; }
    if (!wifiState.nets) { list.innerHTML = skeleton(4); return; }
    if (!wifiState.nets.length) { list.innerHTML = note('No networks found'); return; }
    const cur = wifiState.nets.filter((n) => n.connected), rest = wifiState.nets.filter((n) => !n.connected);
    let h = '', i = 0;
    if (cur.length) h += `<div class="group">${cur.map((n) => netRow(n, i++)).join('')}</div>`;
    if (rest.length) h += `<div class="group-label">Available</div><div class="group">${rest.map((n) => netRow(n, i++)).join('')}</div>`;
    list.innerHTML = h;
    const pw = list.querySelector('.pw');
    if (pw) tb.focusMe().then(() => pw.focus());
  }
  async function loadNetworks() {
    if (radio.wifi === false) return;
    const nets = await tb.wifiNetworks();
    wifiState.nets = nets;
    if (quickPage === 'wifi' && !$('#wifi-list .pw:focus')) morph(renderNets);
  }
  async function wifiJoin(n, password) {
    wifiState.busy = n.ssid; delete wifiState.error[n.ssid]; wifiState.open = null;
    morph(renderNets);
    const r = await tb.wifiJoin(n.ssid, password, n.auth);
    wifiState.busy = null;
    if (!r.ok) { wifiState.error[n.ssid] = r.error || 'Couldn’t connect'; wifiState.open = password != null ? n.ssid : null; }
    await refreshWifi();
    const nets = await tb.wifiNetworks();
    wifiState.nets = nets;
    morph(renderNets);
  }
  $('#wifi-list').addEventListener('click', async (e) => {
    const rowEl = e.target.closest('[data-ssid]');
    const n = rowEl && (wifiState.nets || []).find((x) => x.ssid === rowEl.dataset.ssid)
      || (e.target.closest('.ri-expand') && (wifiState.nets || []).find((x) => x.ssid === wifiState.open));
    const act = e.target.closest('[data-wifi]');
    if (act) {
      const a = act.dataset.wifi;
      if (a === 'disconnect') {
        act.disabled = true;
        await tb.wifiDisconnect();
        await refreshWifi();
        wifiState.nets = await tb.wifiNetworks();
        morph(renderNets);
      } else if (a === 'connect' && n) wifiJoin(n, null);
      else if (a === 'join' && n) {
        const pw = $('#wifi-list .pw');
        if (!pw.value) { pw.focus(); return; }
        wifiJoin(n, pw.value);
      } else if (a === 'signin') { tb.openSettings('ms-availablenetworks:'); closeBar({ launched: true }); }
      return;
    }
    if (!rowEl || !n || n.connected || wifiState.busy) return;
    wifiState.open = wifiState.open === n.ssid ? null : n.ssid;
    morph(renderNets);
  });
  $('#wifi-list').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('pw')) { e.preventDefault(); e.stopPropagation(); $('#wifi-list [data-wifi=join]').click(); }
  });

  // ---------------------------------------------------------------- Bluetooth page
  const btState = { devs: null, busy: {}, error: {} };
  const BT_ICON = { AudioVideo: 'i-headset', Phone: 'i-phone', Peripheral: 'i-gamepad', LE: 'i-gamepad' };
  const isAudio = (d) => d.kind === 'AudioVideo';
  function btRow(d, i) {
    const busy = btState.busy[d.name], err = btState.error[d.name];
    const sub = busy ? (busy === 'connect' ? 'Connecting…' : 'Disconnecting…') : d.connected ? 'Connected' : 'Paired';
    let trail = '';
    if (busy) trail = '<span class="spin"></span>';
    else if (isAudio(d)) trail = `<button class="pill-btn${d.connected ? '' : ' primary'}" data-bt="${d.connected ? 'disconnect' : 'connect'}">${d.connected ? 'Disconnect' : 'Connect'}</button>`;
    return `<div class="ri${d.connected ? ' on' : ''}" style="--i:${i}" data-name="${esc(d.name)}"><span class="ico">${ICON(BT_ICON[d.kind] || 'i-bt')}</span>` +
      `<span class="tx"><b>${esc(d.name)}</b>${err && !busy ? `<i class="err">${esc(err)}</i>` : `<i>${sub}</i>`}</span>${trail}</div>`;
  }
  function renderBt() {
    const list = $('#bt-list');
    if (radio.bt === false) { list.innerHTML = note('Bluetooth is off', 'Turn it on to use your devices.'); return; }
    if (!btState.devs) { list.innerHTML = skeleton(3); return; }
    if (!btState.devs.length) { list.innerHTML = note('No paired devices', 'Pair one in Bluetooth settings.'); return; }
    const audio = btState.devs.filter(isAudio), other = btState.devs.filter((d) => !isAudio(d));
    let h = '', i = 0;
    if (audio.length) h += `<div class="group-label">Audio</div><div class="group">${audio.map((d) => btRow(d, i++)).join('')}</div>`;
    if (other.length) h += `<div class="group-label">Other devices</div><div class="group">${other.map((d) => btRow(d, i++)).join('')}</div>`;
    list.innerHTML = h;
  }
  async function loadBt() {
    if (radio.bt === false) return;
    btState.devs = await tb.btDevices();
    renderTiles();
    if (quickPage === 'bt') morph(renderBt);
  }
  $('#bt-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-bt]'); if (!b) return;
    const name = b.closest('[data-name]').dataset.name, action = b.dataset.bt;
    btState.busy[name] = action; delete btState.error[name];
    morph(renderBt);
    const ok = await tb.btAudio(name, action);
    // the driver answers right away; the link itself takes a few seconds, so watch for it
    const want = action === 'connect';
    let reached = false;
    for (let i = 0; ok && i < 16 && !reached; i++) {
      await new Promise((r) => setTimeout(r, 750));
      btState.devs = await tb.btDevices();
      const d = btState.devs.find((x) => x.name === name);
      reached = !!d && d.connected === want;
    }
    delete btState.busy[name];
    if (!reached) btState.error[name] = want ? 'Couldn’t connect. Is it on and nearby?' : 'Couldn’t disconnect';
    renderTiles();
    if (quickPage === 'bt') morph(renderBt);
    if (reached && want) setTimeout(() => quickPage === 'sound' && loadSound(), 500);
  });

  // ---------------------------------------------------------------- Sound page
  const soundState = { devices: null, apps: null };
  const appIcons = new Map();
  function renderSound() {
    const out = $('#out-list'), mix = $('#mix-list');
    if (!soundState.devices) { out.innerHTML = skeleton(2); mix.innerHTML = skeleton(2); return; }
    out.innerHTML = soundState.devices.length ? '<div class="group">' + soundState.devices.map((d, i) =>
      `<button class="ri tap${d.default ? ' on' : ''}" style="--i:${i}" data-dev="${i}"><span class="ico">${ICON(/head|buds|airpod|earbud|jabra/i.test(d.name) ? 'i-headset' : 'i-speaker')}</span>` +
      `<span class="tx"><b>${esc(d.name.replace(/\s*\(([^)]*)\)$/, '') || d.name)}</b><i>${esc((/\(([^)]*)\)$/.exec(d.name) || [])[1] || (d.default ? 'Playing here' : ''))}</i></span>` +
      `${d.default ? `<svg class="ic check"><use href="#i-check"/></svg>` : ''}</button>`).join('') + '</div>' : note('No output devices');
    const apps = soundState.apps;
    mix.innerHTML = apps.length ? '<div class="group">' + apps.map((a, i) =>
      `<div class="ri mixrow${a.muted ? ' muted' : ''}" style="--i:${i + soundState.devices.length}" data-app="${i}">` +
      `<button class="ico" data-mute="${i}" aria-label="Mute ${esc(a.name)}">${a.exe && appIcons.get(a.exe) ? `<img src="${esc(appIcons.get(a.exe))}" alt="">` : ICON(a.exe ? 'i-app' : 'i-vol')}</button>` +
      `<span class="tx"><b>${esc(a.name)}</b><i>${a.muted ? 'Muted' : a.vol + '%'}</i></span>` +
      `<input type="range" min="0" max="100" value="${a.vol}" aria-label="${esc(a.name)} volume"></div>`).join('') + '</div>' : note('Nothing is playing', 'Apps show up here while they make sound.');
    mix.querySelectorAll('input[type=range]').forEach(setP);
  }
  async function loadSound() {
    const a = await tb.audio();
    soundState.devices = a.devices; soundState.apps = a.apps;
    if (quickPage === 'sound') morph(renderSound);
    for (const app of a.apps) {
      if (!app.exe || appIcons.has(app.exe)) continue;
      appIcons.set(app.exe, null);
      tb.icon(app.exe, app.exe).then((u) => { if (u) { appIcons.set(app.exe, u); if (quickPage === 'sound') renderSound(); } });
    }
  }
  $('#out-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dev]'); if (!b) return;
    const d = soundState.devices[+b.dataset.dev];
    if (d.default) return;
    soundState.devices.forEach((x) => { x.default = x === d; });
    renderSound();
    tb.setAudioDevice(d.id);
    setTimeout(loadSound, 500);
  });
  $('#mix-list').addEventListener('input', (e) => {
    const r = e.target; if (r.type !== 'range') return;
    const rowEl = r.closest('[data-app]'), a = soundState.apps[+rowEl.dataset.app];
    a.vol = +r.value; a.muted = false;
    setP(r); rowEl.classList.remove('muted'); rowEl.querySelector('.tx i').textContent = r.value + '%';
    tb.setAppVolume(a.key, { vol: +r.value, muted: false });
  });
  $('#mix-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mute]'); if (!b) return;
    const a = soundState.apps[+b.dataset.mute];
    a.muted = !a.muted;
    const rowEl = b.closest('[data-app]');
    rowEl.classList.toggle('muted', a.muted); rowEl.querySelector('.tx i').textContent = a.muted ? 'Muted' : a.vol + '%';
    tb.setAppVolume(a.key, { muted: a.muted });
  });
  $('#mix-list').addEventListener('pointerdown', (e) => { if (e.target.type === 'range') S.dragging = true; });

  // the two master sliders (main page and sound page) are the same control
  ['#r-vol', '#r-vol2'].forEach((sel) => {
    const r = $(sel);
    r.addEventListener('input', () => {
      volTouched = performance.now();
      vol.level = +r.value; vol.muted = false;
      tb.volume({ level: +r.value, muted: false });
      volTouched = 0; renderVol(); volTouched = performance.now();
    });
    r.addEventListener('pointerdown', () => { S.dragging = true; });
  });
  window.addEventListener('pointerup', () => { if (S.dragging) { S.dragging = false; wake(); } });

  // ---------------------------------------------------------------- hidden icons (the tray)
  let trayList = [];
  function renderTray() {
    const g = $('#tray-grid');
    g.style.setProperty('--cols', Math.min(6, Math.max(1, trayList.length)));
    g.innerHTML = trayList.length
      ? trayList.map((t, i) => `<button class="ti-btn" data-i="${i}" title="${esc((t.tip || '').split('\n')[0])}"><img src="${esc(t.icon)}" alt=""></button>`).join('')
      : '<div class="tray-empty">No hidden icons</div>';
  }
  tb.on('tray', (l) => { trayList = l || []; if (S.mode === 'tray') { renderTray(); placeAt(panels.tray, $('#tray-btn')); } });
  const trayHit = (e, button) => {
    const b = e.target.closest('.ti-btn'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    tb.trayClick(trayList[+b.dataset.i].key, button);
    closeBar({ launched: true });
  };
  $('#tray-grid').addEventListener('click', (e) => trayHit(e, 'left'));
  $('#tray-grid').addEventListener('contextmenu', (e) => trayHit(e, 'right'));

  // ---------------------------------------------------------------- input language
  let langInfo = null;
  const LANG_GLYPH = { ZHO: '中', JPN: 'あ', KOR: '한' };
  const glyph = (s) => LANG_GLYPH[s] || s;
  function renderLangBtn() {
    const has = langInfo && langInfo.list && langInfo.list.length;
    $('#lang-btn').style.display = has ? '' : 'none';
    if (has) $('#lang-short').textContent = glyph(langInfo.cur || langInfo.list[0].short);
  }
  function renderLang() {
    const list = langInfo ? langInfo.list : [];
    $('#lang-list').innerHTML = '<div class="group">' + list.map((l, i) =>
      `<button class="ri tap${l.cur ? ' on' : ''}" style="--i:${i}" data-i="${i}"><span class="ico"><span class="code">${esc(glyph(l.short))}</span></span>` +
      `<span class="tx"><b>${esc(l.name)}</b><i>${esc(l.sub || '')}</i></span>${l.cur ? `<svg class="ic check"><use href="#i-check"/></svg>` : ''}</button>`).join('') + '</div>';
  }
  tb.on('lang', (l) => { langInfo = l; renderLangBtn(); if (S.mode === 'lang') renderLang(); });
  panels.lang.addEventListener('click', (e) => {
    const m = e.target.closest('.more');
    if (m) { tb.openSettings(m.dataset.uri); closeBar({ launched: true }); return; }
    const b = e.target.closest('[data-i]'); if (!b) return;
    const l = langInfo.list[+b.dataset.i];
    // show the choice right away; the helper confirms it with a fresh 'lang' event
    langInfo.list.forEach((x) => { x.cur = x === l; });
    langInfo.cur = l.short;
    renderLang(); renderLangBtn();
    tb.setLang(l.key);
    setTimeout(() => { if (S.mode === 'lang') closeBar(); }, 260);
  });

  // ---------------------------------------------------------------- settings panel
  const SWATCHES = ['cloud', '#4cc2ff', '#7c8cff', '#a78bfa', '#34d399', '#fb7185'];
  const SCHEMA = [
    { title: 'Appearance', rows: [
      { k: 'theme', label: 'Theme', t: 'seg', opts: [['auto', 'Auto'], ['dark', 'Dark'], ['light', 'Light']] },
      { k: 'accent', label: 'Accent colour', t: 'accent' },
      { k: 'glass', label: 'Glass', t: 'range', min: 15, max: 95, step: 1, fmt: (v) => v + '%' },
      { k: 'iconSize', label: 'Icon size', t: 'seg', opts: [[40, 'Small'], [46, 'Medium'], [54, 'Large']] },
      { k: 'magnify', label: 'Magnification', t: 'range', min: 1, max: 1.9, step: 0.02, fmt: (v) => (v <= 1.01 ? 'Off' : Math.round((v - 1) * 100) + '%') },
    ] },
    { title: 'Behaviour', rows: [
      { k: 'edgeOpen', label: 'Open when the cursor touches the edge', t: 'switch' },
      { k: 'edge', label: 'Edge sensitivity', t: 'seg', opts: [['low', 'Low'], ['med', 'Medium'], ['high', 'High']] },
      { k: 'delay', label: 'Open delay', t: 'range', min: 0, max: 400, step: 5, fmt: (v) => v + ' ms' },
      { k: 'keepOpen', label: 'Always show the dock', t: 'switch' },
      { k: 'winKey', label: 'Windows key', t: 'seg', opts: [['wispy', 'Open wispy'], ['start', 'Start menu']] },
      { k: 'monitor', label: 'Show on', t: 'monitor' },
    ] },
    { title: 'Clock and buttons', rows: [
      { k: 'clock24', label: '24-hour clock', t: 'switch' },
      { k: 'seconds', label: 'Show seconds', t: 'switch' },
      { k: 'dateFmt', label: 'Date', t: 'seg', opts: [['short', 'Short'], ['long', 'Long'], ['off', 'Hidden']] },
      { k: 'showTaskView', label: 'Task view button', t: 'switch' },
      { k: 'showDesktop', label: 'Show desktop button', t: 'switch' },
      { k: 'showTray', label: 'Hidden icons button', t: 'switch' },
      { k: 'showLang', label: 'Input language button', t: 'switch' },
      { k: 'showBattPct', label: 'Battery percentage', t: 'switch' },
    ] },
    { title: 'Search', rows: [
      { k: 'searchEngine', label: 'Web search with', t: 'seg', opts: [['google', 'Google'], ['duckduckgo', 'DuckDuckGo'], ['bing', 'Bing'], ['brave', 'Brave']] },
    ] },
    { title: 'System', rows: [
      { k: '__login', label: 'Launch at login', t: 'switch' },
    ] },
  ];
  let displays = [], loginState = { login: false, packaged: false };
  const fmtVal = (r) => (r.fmt ? r.fmt(cfg[r.k]) : cfg[r.k]);
  function rowHtml(r) {
    const v = r.k === '__login' ? loginState.login : cfg[r.k];
    const head = `<div class="srow${r.t === 'range' ? ' rng' : ''}"><span class="sl">${esc(r.label)}</span>`;
    if (r.t === 'switch') return `${head}<span class="switch${v ? ' on' : ''}" data-k="${r.k}" data-t="switch" role="switch"${r.k === '__login' && !loginState.packaged ? ' style="opacity:.4"' : ''}></span></div>`;
    if (r.t === 'seg') return `${head}<div class="seg">${r.opts.map(([val, l]) => `<button class="${String(v) === String(val) ? 'on' : ''}" data-k="${r.k}" data-v="${val}" data-t="seg">${esc(l)}</button>`).join('')}</div></div>`;
    if (r.t === 'range') return `${head}<input type="range" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}" data-k="${r.k}" data-t="range"><span class="sv">${esc(fmtVal(r))}</span></div>`;
    if (r.t === 'accent') return `${head}<div class="swatches"><button class="sys${v === 'system' ? ' on' : ''}" data-k="accent" data-v="system" data-t="seg" title="Match Windows"></button>` +
      SWATCHES.map((c) => `<button class="${v === c ? 'on' : ''}" style="background:${c}" data-k="accent" data-v="${c}" data-t="seg"></button>`).join('') + '</div></div>';
    if (r.t === 'monitor') {
      const opts = [['primary', 'Main screen'], ['follow', 'Follow cursor']].concat(displays.filter((d) => !d.primary).map((d) => [d.id, d.label]));
      return `${head}<div class="seg">${opts.map(([val, l]) => `<button class="${String(v) === String(val) ? 'on' : ''}" data-k="monitor" data-v="${esc(val)}" data-t="seg">${esc(l)}</button>`).join('')}</div></div>`;
    }
    return '';
  }
  function renderSettings() {
    const body = $('#set-body');
    const keep = body.scrollTop;
    body.innerHTML = SCHEMA.map((sec) => `<div class="group-label">${esc(sec.title)}</div><div class="group">${sec.rows.map(rowHtml).join('')}</div>`).join('') +
      '<div class="sbtns"><button class="pill-btn" data-s="reset">Restore defaults</button><button class="pill-btn warn" data-s="quit">Quit and restore taskbar</button></div>';
    body.scrollTop = keep;
    body.querySelectorAll('input[type=range]').forEach(setP);
  }
  async function openSettings() {
    placePanel(panels.settings, 'right');
    renderSettings();
    const [d, m] = await Promise.all([tb.displays(), tb.menuInfo()]);
    displays = d; loginState = m;
    if (S.mode === 'settings') renderSettings();
  }
  const castVal = (k, v) => (typeof cfg[k] === 'number' ? Number(v) : v);
  $('#set-body').addEventListener('click', (e) => {
    const sb = e.target.closest('[data-s]');
    if (sb) {
      if (sb.dataset.s === 'reset') tb.resetConfig().then((c) => applyConfig(c));
      else tb.quit();
      return;
    }
    const el = e.target.closest('[data-t]'); if (!el) return;
    const k = el.dataset.k;
    if (el.dataset.t === 'switch') {
      if (k === '__login') {
        if (!loginState.packaged) return;
        loginState.login = !loginState.login; tb.setLogin(loginState.login); renderSettings();
      } else setCfg({ [k]: !cfg[k] });
    } else if (el.dataset.t === 'seg') setCfg({ [k]: castVal(k, el.dataset.v) });
  });
  $('#set-body').addEventListener('input', (e) => {
    const r = e.target; if (r.dataset.t !== 'range') return;
    const row2 = SCHEMA.flatMap((sec) => sec.rows).find((x) => x.k === r.dataset.k);
    setP(r);
    applyConfig({ [r.dataset.k]: Number(r.value) });
    r.parentElement.querySelector('.sv').textContent = fmtVal(row2);
  });
  $('#set-body').addEventListener('change', (e) => {
    if (e.target.dataset.t === 'range') tb.setConfig({ [e.target.dataset.k]: Number(e.target.value) });
  });
  $('#set-body').addEventListener('pointerdown', (e) => { if (e.target.type === 'range') S.dragging = true; });

  // ---------------------------------------------------------------- power, task view, show desktop
  const POWER = [
    { id: 'lock', label: 'Lock', icon: 'i-lock' }, { id: 'signout', label: 'Sign out', icon: 'i-out' },
    { id: 'sleep', label: 'Sleep', icon: 'i-moon' }, { id: 'restart', label: 'Restart', icon: 'i-restart' },
    { id: 'shutdown', label: 'Shut down', icon: 'i-power' },
  ];
  function powerRun(id, x, y) {
    if (id === 'lock' || id === 'sleep') { closeBar({ launched: true }); setTimeout(() => tb.power(id), 160); return; }
    const p = POWER.find((q2) => q2.id === id);
    // a second step, so a stray click can never turn the PC off
    showMenu(x, y, [
      { label: p.label + ' now', icon: p.icon, danger: true, fn: () => { closeBar({ launched: true }); tb.power(id); } },
      { label: 'Cancel', icon: 'i-x', fn: () => {} },
    ], { title: p.label + '?' });
  }
  function powerMenu(x, y) {
    showMenu(x, y, POWER.map((p) => ({ label: p.label, icon: p.icon, fn: () => powerRun(p.id, x, y) })), { title: 'Power' });
  }
  const shellKey = (which) => { closeBar({ launched: true }); setTimeout(() => tb.shellKey(which), 160); };
  $('#taskview-btn').addEventListener('click', () => shellKey('taskview'));
  $('#desk-btn').addEventListener('click', () => shellKey('desktop'));

  // ---------------------------------------------------------------- right-click menus
  // One menu component for every right-click: dock apps get the Windows taskbar choices,
  // search results get their actions, the clock/status/language get their settings.
  const ctx = document.createElement('div');
  ctx.id = 'ctx'; ctx.className = 'hit';
  app.appendChild(ctx);
  let ctxItems = [];
  const settings = (u) => { tb.openSettings(u); closeBar({ launched: true }); };
  function showMenu(x, y, items, head) {
    S.openedAt = Date.now();
    ctxItems = items.filter(Boolean);
    ctx.innerHTML = (head ? `<div class="cm-head">${head.icon ? `<img src="${esc(head.icon)}" alt="">` : ''}<b>${esc(head.title)}</b></div>` : '') +
      ctxItems.map((it, i) => it.sep ? '<div class="cm-sep"></div>'
        : `<button class="cm${it.danger ? ' danger' : ''}" data-ci="${i}"><svg class="ic"><use href="#${it.icon || 'i-chev'}"/></svg><span class="lb">${esc(it.label)}</span>` +
          `${it.close ? `<span class="cm-x" data-cx="${i}" title="Close window"><svg class="ic"><use href="#i-x"/></svg></span>` : ''}` +
          `${it.checked != null ? `<span class="switch sm${it.checked ? ' on' : ''}"></span>` : ''}</button>`).join('');
    S.ctx = true;
    ctx.classList.add('show');
    const w = ctx.offsetWidth, h = ctx.offsetHeight;
    const left = clamp(x - 12, 8, innerWidth - w - 8);
    let top = y - h - 6;
    const up = top >= 8;
    if (!up) top = clamp(y + 6, 8, innerHeight - h - 8);
    ctx.style.left = left + 'px'; ctx.style.top = top + 'px';
    ctx.style.transformOrigin = `${clamp(x - left, 0, w)}px ${up ? h : 0}px`;
    ctx.classList.remove('pop'); void ctx.offsetWidth; ctx.classList.add('pop');
    openBar(true);
    wake();
  }
  function hideMenu() {
    if (!S.ctx) return;
    S.ctx = false;
    ctx.classList.remove('show', 'pop');
    wake();
  }
  ctx.addEventListener('click', (e) => {
    const x = e.target.closest('[data-cx]');
    if (x) { ctxItems[+x.dataset.cx].close(); hideMenu(); return; }
    const b = e.target.closest('[data-ci]'); if (!b) return;
    const it = ctxItems[+b.dataset.ci];
    if (it.keep) { it.fn(b); return; }
    hideMenu();
    it.fn();
  });
  document.addEventListener('pointerdown', (e) => { if (S.ctx && !e.target.closest('#ctx')) hideMenu(); }, true);

  // click an app that has several windows: pick the one you want (or close one from the list)
  function openPicker(it, cur) {
    const r = it.el.getBoundingClientRect();
    const rows = cur.wins.map((w) => ({
      label: w.title || '(untitled window)', icon: 'i-app',
      fn: () => { tb.windowFocus(w.hwnd); afterAction(); },
      close: () => tb.windowClose(w.hwnd),
    }));
    showMenu(r.x + r.width / 2, bar.getBoundingClientRect().top - 4,
      rows.concat([{ sep: true }, { label: 'New window', icon: 'i-plus', fn: () => { tb.dockClick(cur.id, 'new'); afterAction(); } }]),
      { title: cur.name, icon: cur.icon });
  }

  async function appMenu(id, x, y) {
    const m = await tb.appMenu(id);
    const act = (a) => () => { tb.appAction(id, a); if (a !== 'pin' && a !== 'unpin') afterAction(); };
    showMenu(x, y, [
      { label: m.running ? 'New window' : 'Open', icon: m.running ? 'i-plus' : 'i-open', fn: act('new') },
      m.canAdmin && { label: 'Run as administrator', icon: 'i-shield', fn: act('admin') },
      m.canLocation && { label: 'Open file location', icon: 'i-folder', fn: act('location') },
      { sep: true },
      { label: m.pinned ? 'Unpin from taskbar' : 'Pin to taskbar', icon: m.pinned ? 'i-unpin' : 'i-pin', fn: act(m.pinned ? 'unpin' : 'pin') },
      m.running && { sep: true },
      m.running && { label: m.running > 1 ? 'Close all windows' : 'Close window', icon: 'i-x', danger: true, fn: act(m.running > 1 ? 'closeAll' : 'close') },
      m.running && m.canEnd && { label: 'End task', icon: 'i-trash', danger: true, fn: act('end') },
    ], { title: m.name, icon: m.icon });
  }
  async function wispyMenu(x, y) {
    const i = await tb.menuInfo();
    showMenu(x, y, [
      { label: 'wispy settings', icon: 'i-gear', fn: () => toggleMode('settings') },
      { sep: true },
      i.packaged && { label: 'Launch at login', icon: 'i-power', checked: !!i.login, keep: true,
        fn: (b) => { const sw = b.querySelector('.switch'); const on = !sw.classList.contains('on'); sw.classList.toggle('on', on); tb.setLogin(on); } },
      { label: 'Notification settings', icon: 'i-bell', fn: () => settings('ms-settings:notifications') },
      { sep: true },
      { label: 'Quit wispy', icon: 'i-x', danger: true, fn: () => tb.quit() },
    ], { title: 'wispy' });
  }
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const t = e.target, x = e.clientX, y = e.clientY;
    if (t.closest('#ctx')) return;
    const item = t.closest('.item');
    if (item) { appMenu(item.dataset.id, x, Math.min(y, bar.getBoundingClientRect().top - 4)); return; }
    const res = t.closest('.res');
    if (res) {
      sel = +res.dataset.i; renderResults();
      const r = panels.search.currentList[sel];
      showMenu(x, y, actionsFor(r).map((a) => ({ label: ACTIONS[a][0], icon: ACTIONS[a][1], fn: () => runAction(r, a) })), { title: r.title });
      return;
    }
    const nci = t.closest('.nci');
    if (nci) {
      const id = +nci.dataset.id;
      showMenu(x, y, [
        { label: 'Open', icon: 'i-open', fn: () => { tb.notifyOpen(id); closeBar({ launched: true }); } },
        { label: 'Dismiss', icon: 'i-x', fn: () => dismissNci(nci, 1) },
        { sep: true },
        { label: 'Clear all', icon: 'i-trash', fn: clearAllNotifs },
        { label: 'Notification settings', icon: 'i-bell', fn: () => settings('ms-settings:notifications') },
      ]);
      return;
    }
    if (t.closest('#status, #p-quick')) {
      showMenu(x, y, [
        { label: 'Network & internet settings', icon: 'i-wifi', fn: () => settings('ms-settings:network') },
        { label: 'Bluetooth & devices', icon: 'i-bt', fn: () => settings('ms-settings:bluetooth') },
        { label: 'Sound settings', icon: 'i-vol', fn: () => settings('ms-settings:sound') },
        { label: 'Volume mixer', icon: 'i-vol-low', fn: () => settings('ms-settings:apps-volume') },
        { label: 'Power & battery', icon: 'i-bolt', fn: () => settings('ms-settings:batterysaver') },
      ]);
      return;
    }
    if (t.closest('#clock, #p-cal')) {
      showMenu(x, y, [
        { label: cfg.dnd ? 'Turn off Do not disturb' : 'Do not disturb', icon: 'i-moon', fn: () => setCfg({ dnd: !cfg.dnd }) },
        { label: 'Adjust date and time', icon: 'i-calendar', fn: () => settings('ms-settings:dateandtime') },
        { label: 'Notification settings', icon: 'i-bell', fn: () => settings('ms-settings:notifications') },
      ]);
      return;
    }
    if (t.closest('#lang-btn, #p-lang')) {
      showMenu(x, y, [
        { label: 'Language settings', icon: 'i-keyboard', fn: () => settings('ms-settings:regionlanguage') },
        { label: 'Typing settings', icon: 'i-keyboard', fn: () => settings('ms-settings:typing') },
      ]);
      return;
    }
    if (t.closest('#search')) {
      showMenu(x, y, [
        { label: 'Paste', icon: 'i-paste', fn: async () => { await focusSearch(); document.execCommand('paste'); } },
        q.value && { label: 'Select all', icon: 'i-check', fn: async () => { await focusSearch(); q.select(); } },
        q.value && { label: 'Clear', icon: 'i-x', fn: () => { q.value = ''; runSearch(); } },
      ]);
      return;
    }
    if (t.closest('#tray-btn, #p-tray')) return; // tray icons open their own app's menu
    if (t.closest('#row, #bar, #items')) wispyMenu(x, y);
  });

  // ---------------------------------------------------------------- notification center + calendar
  let historyItems = [];
  let ncBusy = false;
  function ago(t) {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'now';
    if (m < 60) return m + 'm ago';
    return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function renderHistory(animateIds) {
    $('[data-act=clear-all]').hidden = !historyItems.length;
    $('#nc-list').innerHTML = historyItems.length ? historyItems.map((n, i) => `<div class="nci${!animateIds || animateIds.has(n.id) ? ' in' : ''}" style="--i:${i}" data-id="${n.id}">` +
      `<span class="ti">${n.icon ? `<img src="${esc(n.icon)}" alt="">` : '<svg class="ic"><use href="#i-app"/></svg>'}</span>` +
      `<div class="tx"><div class="meta"><span>${esc(n.app)}</span><span>· ${ago(n.time)}</span></div><b class="t">${esc(n.title)}</b>` +
      `${n.body ? `<div class="b">${esc(n.body)}</div>` : ''}</div><button class="x" aria-label="Dismiss"><svg class="ic"><use href="#i-x"/></svg></button></div>`).join('')
      : '<div class="nc-empty"><svg class="ic"><use href="#i-check"/></svg><span>You’re all caught up</span></div>';
  }
  tb.on('history', (items) => {
    const before = new Set(historyItems.map((n) => n.id));
    const next = items || [];
    const same = next.length === historyItems.length && next.every((n) => before.has(n.id));
    historyItems = next;
    if (S.mode === 'cal' && !ncBusy && !same) renderHistory(new Set(next.filter((n) => !before.has(n.id)).map((n) => n.id)));
  });

  // slide out sideways, then fold the gap shut
  function collapse(el, dir, delay) {
    return new Promise((res) => {
      const cs = getComputedStyle(el);
      const h = el.offsetHeight;
      const from = el.style.transform || 'translateX(0px)';
      const a = el.animate([{ transform: from, opacity: el.style.opacity || 1 }, { transform: `translateX(${dir * 115}%)`, opacity: 0 }],
        { duration: 260, delay: delay || 0, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
      a.onfinish = () => {
        el.style.overflow = 'hidden';
        const b = el.animate([
          { height: h + 'px', marginBottom: cs.marginBottom, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom },
          { height: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' },
        ], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
        b.onfinish = () => { el.remove(); res(); };
      };
    });
  }
  async function dismissNci(el, dir) {
    if (!el || el.dead) return;
    el.dead = true;
    const id = +el.dataset.id;
    ncBusy = true;
    await collapse(el, dir || 1, 0);
    historyItems = historyItems.filter((n) => n.id !== id);
    ncBusy = false;
    tb.historyClear(id);
    if (!historyItems.length) renderHistory();
  }
  async function clearAllNotifs() {
    const els = [...document.querySelectorAll('#nc-list .nci')];
    if (!els.length) return;
    ncBusy = true;
    $('[data-act=clear-all]').hidden = true;
    await Promise.all(els.map((el, i) => { el.dead = true; return collapse(el, 1, i * 55); }));
    historyItems = [];
    ncBusy = false;
    tb.historyClear(null);
    renderHistory();
  }

  // swipe a notification sideways to dismiss it
  let swipe = null;
  $('#nc-list').addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.nci');
    if (!el || e.button !== 0 || e.target.closest('.x') || el.dead) return;
    swipe = { el, x0: e.clientX, dx: 0, moved: false };
    el.setPointerCapture(e.pointerId);
    S.dragging = true;
  });
  $('#nc-list').addEventListener('pointermove', (e) => {
    if (!swipe) return;
    swipe.dx = e.clientX - swipe.x0;
    if (Math.abs(swipe.dx) > 5) swipe.moved = true;
    if (!swipe.moved) return;
    swipe.el.style.transform = `translateX(${swipe.dx}px)`;
    swipe.el.style.opacity = String(1 - Math.min(.85, Math.abs(swipe.dx) / 240));
  });
  $('#nc-list').addEventListener('pointerup', () => {
    if (!swipe) return;
    const s = swipe; swipe = null;
    if (s.moved) s.el.dataset.noclick = '1';
    if (Math.abs(s.dx) > 80) { dismissNci(s.el, Math.sign(s.dx)); return; }
    if (s.moved) {
      s.el.animate([{ transform: s.el.style.transform, opacity: s.el.style.opacity }, { transform: 'translateX(0px)', opacity: 1 }],
        { duration: 320, easing: 'cubic-bezier(.2,1.25,.4,1)' });
      s.el.style.transform = ''; s.el.style.opacity = '';
    }
  });

  let calMonth = new Date(); calMonth.setDate(1);
  function renderCal() {
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    $('#cal-title').textContent = calMonth.toLocaleDateString([], { month: 'long', year: 'numeric' });
    const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate(), prev = new Date(y, m, 0).getDate();
    const today = new Date();
    let h = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<span class="dow">${d}</span>`).join('');
    for (let i = 0; i < 42; i++) {
      const dn = i - first + 1;
      const out = dn < 1 || dn > days;
      const num = dn < 1 ? prev + dn : dn > days ? dn - days : dn;
      const isToday = !out && y === today.getFullYear() && m === today.getMonth() && dn === today.getDate();
      h += `<span class="d${out ? ' out' : ''}${isToday ? ' today' : ''}">${num}</span>`;
    }
    $('#cal-grid').innerHTML = h;
  }
  function openCal() {
    calMonth = new Date(); calMonth.setDate(1);
    renderHistory(null); renderCal();
    $('#clock').classList.remove('unread');
    placePanel(panels.cal, 'right');
  }
  panels.cal.addEventListener('click', (e) => {
    const x = e.target.closest('.nci .x');
    if (x) { dismissNci(x.closest('.nci'), 1); return; }
    const n = e.target.closest('.nci');
    if (n) {
      if (n.dataset.noclick) { delete n.dataset.noclick; return; }
      tb.notifyOpen(+n.dataset.id); closeBar({ launched: true }); return;
    }
    if (e.target.closest('.dnd')) { setCfg({ dnd: !cfg.dnd }); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'clear-all') { clearAllNotifs(); return; }
    calMonth.setMonth(calMonth.getMonth() + (b.dataset.act === 'next' ? 1 : -1)); renderCal();
  });

  // ---------------------------------------------------------------- notifications
  function dismissToast(el) {
    if (el.dead) return; el.dead = true; clearTimeout(el.timer);
    el.classList.add('out'); setTimeout(() => el.remove(), 320);
  }
  function addToast(n) {
    if (n.silent) { if (S.mode !== 'cal') $('#clock').classList.add('unread'); return; }
    const el = document.createElement('div');
    el.className = 'toast hit' + (n.action ? ' has-act' : '');
    const icon = n.icon ? `<img src="${esc(n.icon)}" alt="">` : '<svg class="ic"><use href="#i-app"/></svg>';
    el.innerHTML = `<span class="ti">${icon}</span><div class="tx"><div class="meta"><span>${esc(n.app)}</span><span>· now</span></div>` +
      `<b class="t">${esc(n.title)}</b>${n.body ? `<div class="b">${esc(n.body)}</div>` : ''}${n.action ? `<button class="pill-btn act">${esc(n.action.label)}</button>` : ''}</div><button class="x" aria-label="Dismiss">×</button>`;
    const arm = (ms) => { clearTimeout(el.timer); el.timer = setTimeout(() => dismissToast(el), ms); };
    el.addEventListener('mouseenter', () => clearTimeout(el.timer));
    el.addEventListener('mouseleave', () => arm(1500));
    el.addEventListener('click', (e) => {
      if (e.target.closest('.x')) { dismissToast(el); return; }
      if (n.action) { if (e.target.closest('.act')) { n.action.fn(); dismissToast(el); } return; }
      tb.notifyOpen(n.id); dismissToast(el);
    });
    toastsEl.appendChild(el);
    if (S.mode !== 'cal') $('#clock').classList.add('unread');
    const live = [...toastsEl.children].filter((c) => !c.dead);
    if (live.length > 3) dismissToast(live[0]);
    arm(n.action ? 8000 : 3200);
    wake();
  }
  tb.on('notify', addToast);
  tb.on('close-failed', (f) => addToast({
    id: -1, app: 'wispy', icon: null, title: `${f.name} didn’t close`,
    body: 'It may be asking to save, or running in the background.',
    action: f.canEnd ? { label: 'End task', fn: () => tb.appAction(f.id, 'end') } : null,
  }));

  // ---------------------------------------------------------------- events from main
  tb.on('cursor', (x, y) => {
    S.cx = x; S.cy = y; S.inside = x >= 0;
    wake();
  });
  tb.on('dock', setDock);
  tb.on('fullscreen', (f) => { S.fullscreen = f; if (f && S.open) closeBar(); wake(); });
  tb.on('accent', (c) => { sysAccent = c; applyConfig({}); });
  lightMq.addEventListener('change', () => applyConfig({}));
  tb.on('config', (c) => applyConfig(c));
  tb.on('win-key', () => {
    if (S.open) { closeBar(); return; }
    openBar(true); setMode('dock'); focusSearch();
  });
  tb.on('blur', () => { if (S.pinned || S.searching || S.mode !== 'dock') closeBar({ launched: true }); });
  tb.on('mouse', (t) => {
    // a click somewhere: if it landed outside our UI, dismiss panels and a key-opened bar.
    // The notification can arrive late; a click that happened before the menu/panel opened
    // (it is usually the very click that opened it) must never dismiss it.
    if (!S.open) return;
    if (t && t < S.openedAt - 4) return;
    const el = S.inside ? document.elementFromPoint(S.cx, S.cy) : null;
    if (S.ctx && !(el && el.closest('#ctx'))) { hideMenu(); return; }
    if (el && (el.closest('.hit') || el.closest('#items'))) return;
    if (S.mode !== 'dock') setMode('dock');
    else if (S.pinned || S.searching) closeBar({ launched: true });
  });
  addEventListener('contextmenu', (e) => e.preventDefault());

  tb.init().then((i) => {
    if (i.accent) sysAccent = i.accent;
    if (i.config) applyConfig(i.config); else applyConfig({});
    if (i.volume) { vol = i.volume; renderVol(); }
    setDock(i.dock || []);
    if (i.lang) { langInfo = i.lang; renderLangBtn(); }
    if (i.tray) trayList = i.tray;
    if (i.history) historyItems = i.history;
    refreshWifi();
    setInterval(refreshWifi, 20000);
    try {
      if (!localStorage.getItem('tb-hint')) {
        localStorage.setItem('tb-hint', '1');
        setTimeout(() => addToast({ id: -2, app: 'wispy', icon: null, title: 'Make it yours', body: 'Right-click the bar and choose wispy settings.' }), 2500);
      }
    } catch (e) { /* storage unavailable */ }
  });
  let simT = 0;
  window.__wispy = { S, sp, openBar, closeBar, setMode, advance(ms) { for (let left = ms; left > 0.01; left -= 16) { const d = Math.min(16, left); simT += d; update(d / 1000, performance.now() + simT); } } };
})();
