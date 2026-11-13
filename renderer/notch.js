// wispy renderer: the "notch" side of the bar, kept apart from app.js.
//   - now playing: one line of small text above the bar, and a card with cover and controls when you hover it
//   - the visualiser: the bar turns into a wave / bars / dots that follow the music
//   - live activities: charging, low battery and volume changes as a short line above the bar
//   - a timer started from search ("timer 10m") that counts down above the bar
//   - scroll over the bar to change the volume
// app.js hands over what it owns (state, springs, config, a few helpers) and calls step() and draw() every frame.
(() => {
  'use strict';
  const NB = 32;                                    // bands sent by the helper
  const VC = 22;                                    // centre line of the visualiser svg (it is 44 px tall)
  const REACH = { wave: 8, bars: 14, mirror: 9, dots: 8, pulse: 0, off: 0 };   // how far the visualiser leaves the bar, in px

  window.WispyNotch = function (A) {
    const { $, clamp, lerp, smooth, esc, tb, cfg, S, sp, bar } = A;
    const npEl = $('#np'), npIco = npEl.querySelector('.np-ico'), npChip = npEl.querySelector('.np-chip'), npT = npEl.querySelector('.np-t'), npMeter = npEl.querySelector('.np-meter'), npFill = npMeter.firstElementChild;
    const cardEl = $('#npcard'), cArt = cardEl.querySelector('.nc-art img'), cTitle = cardEl.querySelector('.nc-title'), cArtist = cardEl.querySelector('.nc-artist');
    const cT0 = cardEl.querySelector('.nc-t0'), cT1 = cardEl.querySelector('.nc-t1'), cBar = cardEl.querySelector('.nc-bar'), cFill = cBar.firstElementChild;
    const cPlay = cardEl.querySelector('[data-m=toggle] use'), cPrev = cardEl.querySelector('[data-m=prev]'), cNext = cardEl.querySelector('[data-m=next]');
    const waveEl = $('.bar-wave'), wavePath = waveEl.querySelector('path');
    const pillEl = A.pillEl;

    // ------------------------------------------------------------ state
    let media = { playing: false, title: '', artist: '', art: '', pos: 0, dur: 0, at: 0, canNext: false, canPrev: false, canSeek: false };
    let fl = null;                                   // the live activity on show: { text, icon, meter, until, kind }
    let tm = null;                                   // the running timer: { end, total, label, to }
    let hovA = 0, tvA = 0, cardA = 0, vzA = 0;       // eased: pointer near the bar, text visible, card visible, room the visualiser needs
    let lvl = 0, wb = 0, pillMul = 1, W = 132, T = 5;
    const tgt = new Float32Array(NB), sm = new Float32Array(NB), res = new Float32Array(NB);
    const ph = new Float32Array(8);
    let cardHover = false, cardLeave = 0, npShown = '', npWant = null, npWantFlash = false, npSwap = 0, need = false, anyTgt = false, tvT = 0, hovT = 0;
    let vizSent = false, vizOffAt = 0;
    tb.viz(false);                                    // a reloaded page must not leave the helper capturing
    let prevVol = null, prevBatt = null;
    const shown = { chip: null, ico: null, meter: null, card: '' };

    const hasMedia = () => !!media.title;
    const mediaText = () => (media.title ? (cfg.npArtist && media.artist ? media.title + ' · ' + media.artist : media.title) : '');
    const vizStyle = () => (REACH[cfg.vizStyle] != null ? cfg.vizStyle : 'wave');
    const vizAvailable = () => vizStyle() !== 'off' && (media.playing || cfg.vizAny) && !S.fullscreen && S.mode === 'dock';
    const fmtTime = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
    const posNow = () => (media.playing ? media.pos + (Date.now() - media.at) / 1000 : media.pos);

    // ------------------------------------------------------------ feeds from the main process
    function setMedia(m) {
      media = { playing: !!m.playing, title: m.title || '', artist: m.artist || '', art: m.art || '', pos: m.pos || 0, dur: m.dur || 0, at: m.at || Date.now(), canNext: !!m.canNext, canPrev: !!m.canPrev, canSeek: !!m.canSeek, app: m.app || '' };
      A.wake();
    }
    function setSpectrum(b) {
      anyTgt = false;
      for (let i = 0; i < NB; i++) { tgt[i] = (b[i] || 0) / 100; if (tgt[i] > 0) anyTgt = true; }
      if (S.inZ1 || S.open || sp.presence.x > .02 || lvl > 0) A.wake();     // nothing to draw while the bar is out of sight
    }

    // ------------------------------------------------------------ live activities and the timer
    function flash(o) {
      if (S.fullscreen) return;
      fl = { text: o.text, icon: o.icon || '', meter: o.meter == null ? null : o.meter, kind: o.kind || '', until: performance.now() + (o.ms || cfg.actTime || 2600) };
      A.wake();
    }
    function volumeChanged(level, muted) {
      const was = prevVol; prevVol = { level, muted };
      if (!was || (was.level === level && was.muted === muted)) return;
      if (!cfg.actVolume || S.mode !== 'dock' || S.open) return;
      const off = muted || level <= 0;
      flash({ kind: 'volume', icon: off ? 'i-mute' : level < 40 ? 'i-vol-low' : 'i-vol', text: muted ? 'Muted' : 'Volume ' + Math.round(level), meter: off ? 0 : level / 100, ms: Math.min(2200, cfg.actTime || 2600) });
    }
    function battery(b) {
      const was = prevBatt; prevBatt = { level: b.level, charging: b.charging };
      if (!was) return;
      const pct = Math.round(b.level * 100);
      if (was.charging !== b.charging && cfg.actCharge) flash({ kind: 'batt', icon: 'i-bolt', text: b.charging ? 'Charging · ' + pct + '%' : 'On battery · ' + pct + '%' });
      else if (b.charging && b.level >= 1 && was.level < 1 && cfg.actCharge) flash({ kind: 'batt', icon: 'i-bolt', text: 'Fully charged' });
      if (!b.charging && cfg.actLowBatt) for (const thr of [.2, .1, .05]) if (was.level > thr && b.level <= thr) flash({ kind: 'batt', icon: 'i-battlow', text: 'Battery low · ' + pct + '%', ms: 5000 });
    }
    function chime() {
      try {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        [880, 1175, 1568].forEach((f, i) => {
          const t = ac.currentTime + i * .18, o = ac.createOscillator(), g = ac.createGain();
          o.type = 'sine'; o.frequency.value = f;
          g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.16, t + .02); g.gain.exponentialRampToValueAtTime(.001, t + .55);
          o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + .6);
        });
        setTimeout(() => { try { ac.close(); } catch (e) { /* closed */ } }, 1800);
      } catch (e) { /* no audio */ }
    }
    function timerDone() {
      const label = tm && tm.label; tm = null;
      flash({ kind: 'timer', icon: 'i-bell', text: 'Timer done', ms: 7000 });
      A.toast({ title: 'Timer done', body: label || 'Time is up', action: { label: 'OK', fn() {} } });
      chime();
    }
    function startTimer(ms, label) {
      if (!cfg.timerOn || !(ms > 0)) return;
      stopTimer(true);
      tm = { end: Date.now() + ms, total: ms, label: label || '', to: setTimeout(timerDone, ms) };
      flash({ kind: 'timer', icon: 'i-timer', text: 'Timer set · ' + fmtTime(ms / 1000), ms: 2200 });
    }
    function stopTimer(quiet) {
      if (!tm) return;
      clearTimeout(tm.to); tm = null;
      if (!quiet) flash({ kind: 'timer', icon: 'i-timer', text: 'Timer stopped', ms: 1600 });
      A.wake();
    }
    // "10", "10m", "90s", "1h30m", "1:30" (minutes:seconds), "25 min"
    function parseTimer(text) {
      const t = String(text).trim().toLowerCase();
      let m = /^(\d{1,3}):([0-5]\d)$/.exec(t);
      if (m) return (+m[1] * 60 + +m[2]) * 1000;
      m = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?)?$/.exec(t);
      if (m && (m[1] || m[2] || m[3])) return Math.round(((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000);
      m = /^(\d+(?:\.\d+)?)$/.exec(t);
      if (m) return Math.round(+m[1] * 60000);
      return null;
    }
    const timerLeft = () => (tm ? Math.max(0, (tm.end - Date.now()) / 1000) : 0);

    // ------------------------------------------------------------ card
    cardEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (b) {
        const a = b.dataset.m;
        if (b.disabled) return;
        if (a === 'toggle') { media.pos = posNow(); media.at = Date.now(); media.playing = !media.playing; }
        tb.mediaCmd(a);
        A.wake();
        return;
      }
      const pb = e.target.closest('.nc-bar');
      if (pb && media.canSeek && media.dur > 0) {
        const r = pb.getBoundingClientRect(), f = clamp((e.clientX - r.left) / r.width, 0, 1);
        media.pos = f * media.dur; media.at = Date.now();
        tb.mediaCmd('seek', media.pos);
        A.wake();
      }
    });
    const enter = () => { cardHover = true; cardLeave = 0; A.wake(); };
    const leave = () => { cardLeave = performance.now() + 260; A.wake(); };
    npEl.addEventListener('pointerenter', enter); npEl.addEventListener('pointerleave', leave);
    cardEl.addEventListener('pointerenter', enter); cardEl.addEventListener('pointerleave', leave);

    // ------------------------------------------------------------ scroll over the bar = volume
    document.addEventListener('wheel', (e) => {
      if (!cfg.scrollVol || !S.inside || S.mode !== 'dock' || bar.style.visibility === 'hidden') return;
      const r = bar.getBoundingClientRect(), pad = 10;
      if (e.clientX < r.left - pad || e.clientX > r.right + pad || e.clientY < r.top - pad || e.clientY > r.bottom + pad) return;
      e.preventDefault();
      const step = e.shiftKey ? 1 : 3, dir = e.deltaY < 0 ? 1 : -1;
      A.setVolume(clamp(Math.round(A.getVol().level) + dir * step, 0, 100));
    }, { passive: false });

    // ------------------------------------------------------------ per frame
    function setNpText(text, instant) {
      if (text === npShown) return;
      const tok = ++npSwap;
      if (instant || !npShown || !text) { npT.classList.remove('swap'); npT.textContent = npShown = text; return; }
      npT.classList.add('swap');
      setTimeout(() => { if (tok !== npSwap) return; npT.textContent = npShown = text; npT.classList.remove('swap'); }, 190);
    }

    // c: { dt, inZ1, open, o, presence }. Returns what app.js needs before it moves the springs.
    function step(c) {
      const dt = c.dt, now = performance.now();
      hovT = c.inZ1 || c.open ? 1 : 0;
      hovA += (hovT - hovA) * (1 - Math.exp(-dt * 9));
      if (fl && now > fl.until) fl = null;
      if (cardHover && cardLeave && now > cardLeave) { cardHover = false; cardLeave = 0; }
      if (!cfg.timerOn && tm) stopTimer(true);

      // spectrum -> shown bands -> loudness
      const pv = S.mode === 'settings' ? document.getElementById('viz-preview') : null;     // the little preview in Settings > Music
      const previewOn = !!pv && vizStyle() !== 'off';
      const on = (vizAvailable() && (c.presence > .02 || c.inZ1 || c.open)) || previewOn;
      const gain = (cfg.vizSens || 100) / 100 * 1.12;
      const rel = lerp(22, 3.2, clamp((cfg.vizSmooth == null ? 50 : cfg.vizSmooth) / 100, 0, 1)), att = 38;
      let sum = 0, mx = 0;
      for (let i = 0; i < NB; i++) {
        const t = on ? clamp(tgt[i] * gain, 0, 1) : 0;
        sm[i] += (t - sm[i]) * (1 - Math.exp(-dt * (t > sm[i] ? att : rel)));
        if (sm[i] < .004 && t === 0) sm[i] = 0;
        sum += sm[i]; if (sm[i] > mx) mx = sm[i];
      }
      lvl = clamp((sum / NB) * .6 + mx * .5, 0, 1);

      // ask the helper for the spectrum only while there is something to draw
      const want = on;
      if (want) vizOffAt = 0;
      else if (vizSent && !vizOffAt) vizOffAt = now + 1200;
      const send = want ? true : (vizOffAt && now > vizOffAt ? false : vizSent);
      if (send !== vizSent && send !== null) { vizSent = send; if (!send) vizOffAt = 0; tb.viz(send); }

      // where the bar rests when it is not hovered
      let rest = 0;
      if (!S.fullscreen && S.mode === 'dock') {
        if (cfg.barShow === 'always') rest = clamp(cfg.barRest / 100, 0, 1);
        else if (cfg.barShow === 'music' && media.playing) rest = clamp(cfg.barRest / 100, 0, 1);
      }
      const force = !!fl || cardHover || cardA > .05;
      need = previewOn || !!pv || !!fl || (!!tm && tvA > .02) || (on && (lvl > 0 || anyTgt)) || lvl > 0 || cardA > .01 || cardHover || (vizSent === true && !on) ||
        Math.abs(tvT - tvA) > .004 || Math.abs(hovT - hovA) > .004;
      return { rest, force, need };
    }

    // c: { dt, y, h, o, tx, presence, W, T, t }
    function draw(c) {
      const dt = c.dt;
      if (c.W !== W || c.T !== T) setBar(c.W, c.T);
      const style = vizStyle();

      // ---- the visualiser
      const line = style === 'wave' || style === 'bars' || style === 'mirror' || style === 'dots';
      wb = line ? smooth(0, .03, lvl) * (1 - smooth(0, .4, c.o)) : 0;
      pillMul = line ? 1 - wb : 1;
      waveEl.style.opacity = wb.toFixed(3);
      if (wb > .001) drawViz(style, dt, { path: wavePath, svg: waveEl, W, T });
      if (style === 'pulse') pillEl.style.setProperty('--lv', (lvl * (1 - smooth(0, .4, c.o))).toFixed(3)); else pillEl.style.removeProperty('--lv');
      const pv = S.mode === 'settings' ? document.getElementById('viz-preview') : null;
      if (pv) drawPreview(pv, style, dt);

      // ---- the text line
      const timerOn = !!tm && cfg.timerOn;
      const flashing = !!fl && S.mode === 'dock';
      const hasText = (cfg.nowPlaying && hasMedia()) || timerOn;
      const base = cfg.npShow === 'visible' ? clamp(c.presence, 0, 1) : hovA;
      let tv = flashing ? 1 : (hasText ? base : 0);
      tv *= 1 - smooth(0, .3, c.o);
      if (S.mode !== 'dock' || S.fullscreen) tv = 0;
      tvT = tv;
      tvA += (tv - tvA) * (1 - Math.exp(-dt * 11));
      if (Math.abs(tv - tvA) < .004) tvA = tv;
      const reach = vizAvailable() ? REACH[style] : 0;
      vzA += ((reach) - vzA) * (1 - Math.exp(-dt * 6));
      const gap = 9 + Math.max(0, vzA - c.T / 2);

      const want = flashing ? fl.text : (cfg.nowPlaying ? mediaText() : '');
      if (want !== npWant) { setNpText(want, flashing || npWantFlash); npWant = want; npWantFlash = flashing; }
      const ico = flashing ? fl.icon : '';
      if (shown.ico !== ico) { npIco.style.display = ico ? '' : 'none'; if (ico) npIco.firstElementChild.setAttribute('href', '#' + ico); shown.ico = ico; }
      const chip = timerOn ? fmtTime(timerLeft()) : '';
      if (shown.chip !== chip) { npChip.textContent = chip; npChip.style.display = chip ? '' : 'none'; shown.chip = chip; }
      const meter = flashing && fl.meter != null ? fl.meter : null;
      if (meter == null) { if (shown.meter !== null) { npMeter.style.display = 'none'; shown.meter = null; } }
      else { if (shown.meter === null) npMeter.style.display = ''; npFill.style.width = (clamp(meter, 0, 1) * 100).toFixed(1) + '%'; shown.meter = meter; }
      const dim = flashing || media.playing || timerOn ? 1 : .62;
      const o = tvA * (flashing ? 1 : clamp(cfg.npOpacity / 100, .1, 1)) * dim;
      npEl.style.opacity = o.toFixed(3);
      npEl.style.visibility = o > .01 ? 'visible' : 'hidden';
      const canCard = cfg.mediaCard && cfg.nowPlaying && hasMedia() && !flashing;
      npEl.style.pointerEvents = canCard && tvA > .5 && o > .3 ? 'auto' : 'none';
      let nh = npEl.offsetHeight || 16;
      if (o > .01) npEl.style.transform = `translate3d(calc(-50% + ${c.tx.toFixed(1)}px), ${(-(c.y + c.h + gap)).toFixed(1)}px, 0)`;

      // ---- the card
      const cardWant = canCard && cardHover && c.o < .3 && S.mode === 'dock' && !S.fullscreen;
      cardA += ((cardWant ? 1 : 0) - cardA) * (1 - Math.exp(-dt * 13));
      if (Math.abs((cardWant ? 1 : 0) - cardA) < .004) cardA = cardWant ? 1 : 0;
      cardEl.style.opacity = cardA.toFixed(3);
      cardEl.style.visibility = cardA > .01 ? 'visible' : 'hidden';
      cardEl.style.pointerEvents = cardA > .6 ? 'auto' : 'none';
      if (cardA > .01) {
        updateCard();
        cardEl.style.transform = `translate3d(calc(-50% + ${c.tx.toFixed(1)}px), ${(-(c.y + c.h + gap + nh + 2) + (1 - cardA) * 10).toFixed(1)}px, 0) scale(${(.96 + .04 * cardA).toFixed(3)})`;
      }
    }

    function updateCard() {
      const sig = media.title + '|' + media.artist + '|' + media.art + '|' + cfg.cardArt;
      if (shown.card !== sig) {
        shown.card = sig;
        cTitle.textContent = media.title; cArtist.textContent = media.artist || '';
        const art = cfg.cardArt && media.art;
        cardEl.classList.toggle('noart', !art);
        if (art) { if (cArt.getAttribute('src') !== media.art) cArt.setAttribute('src', media.art); } else cArt.removeAttribute('src');
      }
      const dur = media.dur, p = clamp(posNow(), 0, dur || 1e9);
      cardEl.classList.toggle('live', !(dur > 0));
      cFill.style.width = dur > 0 ? (clamp(p / dur, 0, 1) * 100).toFixed(2) + '%' : '0%';
      const t0 = dur > 0 ? fmtTime(p) : '', t1 = dur > 0 ? fmtTime(dur) : 'live';
      if (cT0.textContent !== t0) cT0.textContent = t0;
      if (cT1.textContent !== t1) cT1.textContent = t1;
      cBar.classList.toggle('seek', !!media.canSeek && dur > 0);
      const ic = media.playing ? '#i-pause' : '#i-play';
      if (cPlay.getAttribute('href') !== ic) cPlay.setAttribute('href', ic);
      cPrev.disabled = !media.canPrev; cNext.disabled = !media.canNext;
    }

    // ------------------------------------------------------------ the visualiser drawing
    function bandsFor(n) {
      for (let j = 0; j < n; j++) {
        const a = j * NB / n, b = (j + 1) * NB / n;
        let s = 0, c = 0, m = 0;
        for (let i = Math.floor(a); i < Math.ceil(b) && i < NB; i++) { const w = Math.min(i + 1, b) - Math.max(i, a); s += sm[i] * w; c += w; if (sm[i] > m) m = sm[i]; }
        res[j] = c > 0 ? clamp(s / c * .55 + m * .45, 0, 1) : 0;
      }
      return res;
    }
    function drawViz(style, dt, tg) {
      const W = tg.W, T = tg.T, waveEl = tg.svg, wavePath = tg.path;
      const inset = T / 2 + .5, span = Math.max(10, W - inset * 2);
      const f = (v) => v.toFixed(1);
      let d = '';
      if (style === 'wave') {
        // eight travelling sines, each fed by four neighbouring bands, tapered at both ends: bass makes slow swells, treble makes ripples
        const amp = new Array(8);
        for (let j = 0; j < 8; j++) { let s = 0; for (let i = 0; i < 4; i++) s += sm[j * 4 + i]; amp[j] = s / 4; ph[j] += dt * (1.2 + j * .9 + amp[j] * 5) * (j % 2 ? -1 : 1); }
        const P = Math.max(28, Math.round(W / 3.5));
        for (let i = 0; i < P; i++) {
          const u = i / (P - 1), env = Math.pow(Math.sin(Math.PI * u), .7);
          let s = 0;
          for (let j = 0; j < 8; j++) s += amp[j] * Math.sin(u * Math.PI * (1.4 + j * 1.55) + ph[j]) * (1.15 - j * .07);
          const y = VC - REACH.wave * Math.tanh(s * 1.25) * env;
          d += (i ? 'L' : 'M') + f(inset + u * span) + ' ' + y.toFixed(2);
        }
        waveEl.style.setProperty('--sw', T + 'px');
      } else {
        const n = clamp(+cfg.vizBars || 24, 8, 32);
        const v = bandsFor(n), slot = span / n;
        const sw = style === 'dots' ? Math.max(2, Math.min(T, slot * .8)) : Math.max(1.6, Math.min(T + 1, slot * .62));
        waveEl.style.setProperty('--sw', sw.toFixed(2) + 'px');
        for (let j = 0; j < n; j++) {
          const x = f(inset + slot * (j + .5) + (sw - T) * 0);
          const h = Math.pow(v[j], .85);
          if (style === 'bars') d += 'M' + x + ' ' + VC + 'L' + x + ' ' + (VC - h * REACH.bars).toFixed(2);
          else if (style === 'mirror') { const hh = h * REACH.mirror; d += 'M' + x + ' ' + (VC - hh).toFixed(2) + 'L' + x + ' ' + (VC + hh).toFixed(2); }
          else { const y = (VC - h * REACH.dots * 1.15).toFixed(2); d += 'M' + x + ' ' + y + 'L' + x + ' ' + y; }
        }
      }
      wavePath.setAttribute('d', d);
    }

    function drawPreview(svg, style, dt) {
      const tg = { path: svg.firstElementChild, svg, W: 248, T: clamp(+cfg.barThick || 5, 3, 8) };
      svg.classList.toggle('acc', cfg.vizColor === 'accent');
      if (style === 'off' || style === 'pulse') {
        const t = tg.T + (style === 'pulse' ? lvl * 5 : 0), inset = tg.T / 2 + .5;
        svg.style.setProperty('--sw', t.toFixed(1) + 'px');
        tg.path.setAttribute('d', 'M' + inset + ' ' + VC + 'L' + (248 - inset) + ' ' + VC);
        svg.style.opacity = style === 'off' ? .3 : 1;
      } else { svg.style.opacity = 1; drawViz(style, dt, tg); }
    }

    function setBar(w, t) {
      W = w; T = t;
      waveEl.setAttribute('viewBox', `0 0 ${w} 44`);
      waveEl.style.setProperty('--sw', t + 'px');
    }
    function applyConfig() {
      npEl.style.setProperty('--np-size', clamp(+cfg.npSize || 12, 9, 18) + 'px');
      waveEl.classList.toggle('acc', cfg.vizColor === 'accent');
      if (!cfg.timerOn && tm) stopTimer(true);
    }

    // ------------------------------------------------------------ hit testing (the window is click-through)
    function rects() {
      const rs = [];
      const add = (el) => { const r = el.getBoundingClientRect(); if (r.width > 1 && r.height > 1) rs.push([Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]); };
      if (npEl.style.pointerEvents === 'auto') add(npEl);
      if (cardEl.style.pointerEvents === 'auto') add(cardEl);
      if (cfg.scrollVol && S.mode === 'dock' && bar.style.visibility !== 'hidden' && !S.open) {
        const r = bar.getBoundingClientRect();
        rs.push([Math.round(r.x - 8), Math.round(r.y - 10), Math.round(r.width + 16), Math.round(r.height + 20)]);
      }
      return rs;
    }
    function hit(x, y) {
      for (const r of rects()) if (x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3]) return true;
      return false;
    }

    return {
      setMedia, setSpectrum, flash, volumeChanged, battery, startTimer, stopTimer, parseTimer, timer: () => (tm ? { left: timerLeft(), total: tm.total } : null),
      step, draw, setBar, applyConfig, rects, hit,
      pillMul: () => pillMul, level: () => lvl, active: () => need,
      pulse: () => (vizStyle() === 'pulse' ? { w: 1 + lvl * .12, h: lvl * 4 } : { w: 1, h: 0 }),
      debug: () => ({ media, fl, tm, hovA, tvA, cardA, cardHover, lvl, vizSent }),
    };
  };
})();
