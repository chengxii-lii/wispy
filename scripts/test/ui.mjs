// UI tests: the real renderer in headless Chrome, driven with real mouse and keyboard input (CDP Input.*), so clicks,
// hover and hit-testing behave as they do for a user. Uses renderer/mock.js for the Electron side.
//   node scripts/test/ui.mjs            run everything
//   node scripts/test/ui.mjs search     only groups whose name contains "search"
// Needs Chrome, Edge or Helium (set BROWSER=... if none is found). Not part of `npm test`: it opens a browser.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../art/cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const want = process.argv.slice(2).map((s) => s.toLowerCase());
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html');
  fs.readFile(path.join(ROOT, 'renderer', name), (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(name)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}).listen(0);
const URL_ = `http://localhost:${server.address().port}/`;
const b = await launch({ gpu: false });

let failed = 0, passed = 0;
const fails = [];
function check(name, ok, detail = '') {
  if (ok) passed++; else { failed++; fails.push(name); }
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
}

// ---------------------------------------------------------------- helpers
async function open() {
  const p = await b.page(URL_, { width: 920, height: 700, scheme: 'dark' });
  p.errors = [];
  await p.send('Runtime.enable');
  b.c.listeners.push((d) => {
    if (d.sessionId !== p.s) return;
    if (d.method === 'Runtime.exceptionThrown') p.errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') p.errors.push(d.params.args.map((a) => a.value || a.description).join(' '));
  });
  const ready = "window.__wispy && document.querySelectorAll('#items .item').length > 0";
  for (let attempt = 0; ; attempt++) {   // headless Chrome now and then misses the first navigation
    try { await p.until(ready, 8000); break; } catch (e) { if (attempt >= 2) throw e; await p.send('Page.navigate', { url: URL_ }); }
  }
  await p.eval(`(() => { window.__calls = []; for (const k of ['open','resultAction','dockClick','appAction','windowFocus','windowClose','setConfig','volume','mediaCmd','viz','setRadio','wifiConnect','openSettings','power','shellKey','notifyOpen']) { const f = tb[k]; tb[k] = (...a) => { __calls.push([k, ...a.map((x) => x && x.title ? x.title : x)]); return f ? f(...a) : undefined; }; } return 1; })()`);
  await p.eval(`window.__rects = []; const hr = tb.hitRects; tb.hitRects = (r) => { window.__rects = r; return hr && hr(r); }; 1`);
  await sleep(300);
  return p;
}
const move = (p, x, y) => p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
const dragTo = (p, x, y) => p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
const down = (p, x, y) => p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
const up = (p, x, y) => p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
async function click(p, x, y) { await move(p, x, y); await sleep(30); await down(p, x, y); await sleep(45); await up(p, x, y); await sleep(60); }
async function rightClick(p, x, y) { await move(p, x, y); await sleep(30); await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 }); await sleep(40); await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 }); await sleep(80); }
const centre = (p, sel, i = 0) => p.eval(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, r.x, r.y, r.width, r.height]; })()`);
const rect = (p, sel, i = 0) => p.eval(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; })()`);
const S = async (p, expr) => { for (let i = 0; i < 5; i++) { try { return await p.eval(`window.__wispy.S.${expr}`); } catch (e) { await sleep(150); } } return p.eval(`window.__wispy.S.${expr}`); };
const calls = (p) => p.eval('__calls');
const clearCalls = (p) => p.eval('(__calls.length = 0, 1)');
async function edge(p) { await move(p, 460, 697); await sleep(500); }
async function away(p) { await move(p, 460, 120); await sleep(500); }
async function key(p, k, extra = {}) { await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Tab: 9 }[k] || 0, ...extra }); await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Tab: 9 }[k] || 0, ...extra }); await sleep(120); }
async function searchFor(p, text) {
  await p.eval(`window.tbMock.emit('win-key'); 1`);
  await sleep(500);
  await p.eval(`(() => { const q = document.querySelector('#q'); q.focus(); return 1; })()`);
  await p.send('Input.insertText', { text });
  await sleep(700);
}
const group = async (name, fn) => {
  if (want.length && !want.some((w) => name.toLowerCase().includes(w))) return;
  console.log('\n' + name);
  const p = await open();
  try { await fn(p); } catch (e) { check(name + ': ran without crashing', false, e.message); }
  check(name + ': no script errors', p.errors.length === 0, p.errors.slice(0, 2).join(' | '));
  await p.closeTarget();
};

// ---------------------------------------------------------------- the dock
await group('dock: opening and closing with the real mouse', async (p) => {
  check('closed to begin with', (await S(p, 'open')) === false);
  await edge(p);
  check('touching the bottom edge opens the dock', (await S(p, 'open')) === true);
  const items = await p.eval(`document.querySelectorAll('#items .item').length`);
  check('dock shows apps', items >= 4, items + ' icons');
  const [x, y] = await centre(p, '#items .item', 2);
  await move(p, x, y); await sleep(500);
  check('hovering an icon keeps the dock open', (await S(p, 'open')) === true);
  const big = await rect(p, '#items .item', 2), small = await rect(p, '#items .item', 6);
  check('the hovered icon magnifies', big.w > small.w * 1.15, `${big.w} vs ${small.w}`);
  const tip = await p.eval(`document.querySelectorAll('#items .item')[2].classList.contains('tipped')`);
  check('the hovered icon shows its name', tip);
  const t0 = Date.now(); await move(p, 460, 150);
  await p.until(`window.__wispy.S.open === false`, 3000).catch(() => {});
  const closedIn = Date.now() - t0;
  check('moving away closes it quickly (close delay 35 ms)', (await S(p, 'open')) === false && closedIn < 900, closedIn + ' ms');
  const t1 = Date.now(); await move(p, 460, 697); await p.until('window.__wispy.S.open === true', 2500).catch(() => {});
  const openedIn = Date.now() - t1;
  check('and it reopens straight away', (await S(p, 'open')) === true && openedIn < 700, openedIn + ' ms');
});

await group('dock: opens only over the white bar', async (p) => {
  for (const x of [250, 330, 585, 700]) {
    await move(p, x, 150); await sleep(150);
    await move(p, x, 697); await sleep(700);
    check(`touching the bottom edge ${Math.abs(x - 460)} px from the bar does not open it`, (await S(p, 'open')) === false, 'x=' + x);
    await move(p, x, 150); await sleep(400);
  }
  for (const x of [400, 460, 520]) {
    await move(p, 460, 150); await sleep(500);
    await move(p, x, 697); await sleep(500);
    check(`touching it over the bar (x=${x}) opens it`, (await S(p, 'open')) === true);
  }
});

await group('dock: the main process is told where the clickable things are', async (p) => {
  const rects = () => p.eval('window.__rects');
  const has = (rs, x, y) => rs.some((r) => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3]);
  check('nothing is clickable while the bar is closed', (await rects()).length === 0, JSON.stringify(await rects()));
  await edge(p);
  const [ix, iy] = await centre(p, '#items .item', 2);
  const [bx, by] = await centre(p, '#search');
  const rs = await rects();
  check('with the dock open, the icons and the bar are clickable areas', has(rs, ix, iy) && has(rs, bx, by), JSON.stringify(rs));
  check('empty space above the dock is not', !has(rs, 460, 120));
  await searchFor(p, 'a');
  const [px, py] = await centre(p, '#p-search .res', 1);
  check('an open search panel is a clickable area', has(await rects(), px, py));
  await key(p, 'Escape'); await key(p, 'Escape'); await move(p, 460, 120); await sleep(900);
  check('and it is gone again afterwards', (await rects()).length === 0 || !has(await rects(), px, py), JSON.stringify(await rects()));
});

await group('dock: clicks are not lost', async (p) => {
  await edge(p);
  const list = await p.eval(`window.tb.init().then((i) => i.dock.map((d) => [d.id, d.running]))`);
  // press, hold while the icons magnify and shift, release with a little wobble: still a click on the pressed icon
  for (const n of [1, 2, 4]) {
    const [x, y] = await centre(p, '#items .item', n);
    await move(p, x - 30, y); await sleep(250);
    await clearCalls(p);
    await move(p, x, y); await sleep(60);
    await down(p, x, y); await sleep(160);
    await up(p, x + 4, y + 2); await sleep(120);
    const c = await calls(p);
    check(`icon ${n}: a slow press with a 4 px wobble still clicks it`, c.some((k) => k[0] === 'dockClick'), JSON.stringify(c));
    if (!(await S(p, 'open'))) await edge(p);
  }
  // a real drag of 30 px is a reorder (pinned) or nothing, never a click
  const [x, y] = await centre(p, '#items .item', 1);
  await clearCalls(p);
  await move(p, x, y); await sleep(100); await down(p, x, y); await sleep(40); await dragTo(p, x + 30, y); await sleep(40); await up(p, x + 30, y); await sleep(200);
  check('dragging an icon 30 px is not a click', !(await calls(p)).some((k) => k[0] === 'dockClick'), JSON.stringify(await calls(p)));
  // clicking right after the pointer arrives (no settling time)
  await move(p, 460, 150); await sleep(500); await clearCalls(p);
  await move(p, 460, 697); await sleep(450);
  const single = list.findIndex((d, i) => i >= 2 && !(d[1] > 1));   // an app with one window or none: a click acts at once (several windows open a picker)
  const [ix, iy] = await centre(p, '#items .item', single);
  await move(p, ix, iy); await down(p, ix, iy); await sleep(30); await up(p, ix, iy); await sleep(150);
  check('a click straight after arriving on an icon works', (await calls(p)).some((k) => k[0] === 'dockClick'), JSON.stringify(await calls(p)));
});

await group('dock: clicking apps', async (p) => {
  await edge(p);
  const list = await p.eval(`window.tb.init().then((i) => i.dock.map((d) => [d.id, d.name, d.running]))`);
  const idle = list.findIndex((d) => !(d[2] > 0)), running = list.findIndex((d) => d[2] === 1);
  const [x, y] = await centre(p, '#items .item', idle);
  await clearCalls(p); await click(p, x, y);
  const c1 = await calls(p);
  check('clicking an app tells the main process', c1.some((c) => c[0] === 'dockClick'), JSON.stringify(c1));
  check('the dock stays open after you click an app', (await S(p, 'open')) === true);
  const cls = await p.eval(`[...document.querySelectorAll('#items .item')][${idle}].className`);
  check('a not-running app shows launch feedback (hop)', /launching/.test(cls), cls);
  if (running >= 0) {
    const [rx, ry] = await centre(p, '#items .item', running);
    await clearCalls(p); await click(p, rx, ry);
    check('clicking a running app focuses/minimises it', (await calls(p)).some((c) => c[0] === 'dockClick'));
  }
  await rightClick(p, x, y);
  const ctx = await p.eval(`!!window.__wispy.S.ctx`);
  check('right-click opens the app menu', ctx);
  const [bx, by] = await centre(p, '#ctx button', 0);
  await clearCalls(p); await click(p, bx, by);
  check('choosing a menu entry runs it', (await calls(p)).some((c) => c[0] === 'appAction'), JSON.stringify(await calls(p)));
  check('the dock stays open after a menu action', (await S(p, 'open')) === true);
  await rightClick(p, x, y); await click(p, 700, 300);
  check('clicking elsewhere dismisses the menu', (await p.eval(`!window.__wispy.S.ctx`)));
});

await group('dock: recovers when the page loses its animation frames (waking from sleep)', async (p) => {
  await edge(p);
  await p.eval(`window.__raf = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; 1`);   // frames stop arriving
  await sleep(1000);
  await p.eval(`window.requestAnimationFrame = window.__raf; 1`);
  await move(p, 460, 150); await sleep(300);
  await edge(p);
  check('the dock opens again after frames were lost', (await S(p, 'open')) === true);
  const [x, y] = await centre(p, '#items .item', 2);
  await move(p, x, y); await sleep(600);
  const big = await rect(p, '#items .item', 2), small = await rect(p, '#items .item', 6);
  check('and it animates and magnifies again', big.w > small.w * 1.15, `${big.w} vs ${small.w}`);
  await p.eval(`window.tbMock.emit('resume'); 1`); await sleep(300);
  await move(p, x + 4, y); await sleep(300);
  check('a resume signal restarts the loop cleanly', (await S(p, 'open')) === true);
});

await group('dock: an app closing', async (p) => {
  await edge(p);
  const d0 = await p.eval(`window.tb.init().then((i) => i.dock)`);
  const gone = d0.filter((d) => !d.pinned).pop();
  const idx = d0.findIndex((d) => d === gone || d.id === gone.id);
  await p.eval(`window.tbMock.setDock(${JSON.stringify(d0.filter((d) => d.id !== gone.id))}); 1`);
  await move(p, 460, 120);
  await sleep(150);
  const during = await p.eval(`({ open: window.__wispy.S.open, closing: !!document.querySelector('#items .item.closing') })`);
  check('the closed app\'s icon fades out instead of vanishing', during.closing);
  check('the dock stays up while that plays', during.open);
  await sleep(1200);
  check('then the icon is gone and the dock closes', !(await p.eval(`!!document.querySelector('#items .item.closing')`)) && (await S(p, 'open')) === false);
});

// ---------------------------------------------------------------- the bar, the notch features, and their settings
// (headless Chrome reloads a page about 5 s after it opens, so every group below stays under that)
const cfgSet = (p, o) => p.eval(`window.__wispy.setCfg(${JSON.stringify(o)})`);
const hover = async (p) => { await move(p, 520, 600); await sleep(700); };     // the usual hover state: the bar peeks out, the dock stays closed
const mediaEv = (p, o) => p.eval(`window.tbMock.emit('media', ${JSON.stringify({ playing: true, title: 'Kyoto Sunrise', artist: 'Lofi Girl', art: '', pos: 30, dur: 200, at: Date.now(), canNext: true, canPrev: true, canSeek: true, ...o })})`);
const lineOf = (p) => p.eval(`(() => { const e = document.querySelector('#np'); return { o: +e.style.opacity, v: e.style.visibility, t: e.querySelector('.np-t').textContent, chip: e.querySelector('.np-chip').textContent, ev: e.style.pointerEvents }; })()`);
const barOf = (p) => p.eval(`(() => { const b = document.querySelector('#bar'); const r = b.getBoundingClientRect(); return { o: +b.style.opacity, v: b.style.visibility, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, x: r.x }; })()`);
const wave = (p) => p.eval(`(() => ({ o: +document.querySelector('.bar-wave').style.opacity, po: +document.querySelector('.bar-pill').style.opacity, d: document.querySelector('.bar-wave path').getAttribute('d') || '', acc: document.querySelector('.bar-wave').classList.contains('acc'), lv: document.querySelector('.bar-pill').style.getPropertyValue('--lv') }))()`);
const music = (t, hi) => Array.from({ length: 32 }, (_, i) => Math.round(Math.max(0, Math.min(100, (hi || 85) * Math.exp(-i / 18) * (0.55 + 0.45 * Math.sin(t * 3 + i * 0.9))))));
const feed = async (p, n = 12, hi) => { for (let i = 0; i < n; i++) { await p.eval(`window.tbMock.emit('spectrum', ${JSON.stringify(music(i * .3, hi))})`); await sleep(36); } };

await group('bar: when to show it, how it looks', async (p) => {
  await sleep(500);
  let b = await barOf(p);
  check('on hover (the default): hidden with the pointer away', b.v === 'hidden');
  await hover(p);
  b = await barOf(p);
  check('...and there on hover', b.v === 'visible' && b.o > .95 && b.w === 132 && b.h === 5, JSON.stringify(b));
  await cfgSet(p, { barWidth: 220, barThick: 9, barOpacity: 60 }); await sleep(900);
  b = await barOf(p);
  check('width, thickness and opacity apply', b.w === 220 && b.h === 9 && Math.abs(b.o - .6) < .03, JSON.stringify(b));
  await cfgSet(p, { barColor: 'accent' }); await sleep(100);
  check('colour: accent', await p.eval(`document.documentElement.style.getPropertyValue('--pill-c')`) === 'var(--accent)');
  await cfgSet(p, { barColor: 'auto' }); await sleep(100);
  check('colour: auto goes back to the theme', await p.eval(`document.documentElement.style.getPropertyValue('--pill-c')`) === '');
  await cfgSet(p, { barWidth: 132, barThick: 5, barOpacity: 100, barLean: false }); await move(p, 640, 600); await sleep(900);
  check('lean off: the bar stays centred', Math.abs((await p.eval(`window.__wispy.sp.tx.x`))) < .5);
  check('no errors', p.errors.length === 0, p.errors.join(' | '));
});
await group('bar: rest opacity (while music plays / always)', async (p) => {
  await sleep(400);
  await cfgSet(p, { barShow: 'music', barRest: 40 }); await sleep(1200);
  let b = await barOf(p);
  check('while music plays: it rests faintly in view', b.v === 'visible' && Math.abs(b.o - .4) < .04, JSON.stringify(b));
  await mediaEv(p, { playing: false }); await sleep(1300);
  b = await barOf(p);
  check('...and goes away when the music stops', b.v === 'hidden', JSON.stringify(b));
  await cfgSet(p, { barShow: 'always', barRest: 25 }); await sleep(1200);
  b = await barOf(p);
  check('always: it stays, at its own opacity', b.v === 'visible' && Math.abs(b.o - .25) < .04, JSON.stringify(b));
  check('the title does not show while it only rests', (await lineOf(p)).o < .02);
  await cfgSet(p, { barShow: 'hover' }); await sleep(1100);
  check('back to hover only', (await barOf(p)).v === 'hidden');
  check('no errors', p.errors.length === 0, p.errors.join(' | '));
});

await group('settings: four tabs, tidy, with options that appear when they matter', async (p) => {
  await p.eval(`window.__wispy.openBar(); window.__wispy.setMode('settings')`); await sleep(700);
  const tabs = await p.eval(`[...document.querySelectorAll('#set-tabs button')].map((b) => b.textContent)`);
  check('General, Bar, Music, Extras', tabs.join() === 'General,Bar,Music,Extras', tabs.join());
  const keys = () => p.eval(`[...document.querySelectorAll('#set-body [data-k]')].map((e) => e.dataset.k).filter((k, i, a) => a.indexOf(k) === i)`);
  const tab = async (t) => { await p.eval(`document.querySelector('[data-tab=${t}]').click()`); await sleep(120); return keys(); };
  let k = await keys();
  check('General has the usual ones', k.includes('theme') && k.includes('closeDelay') && !k.includes('nowPlaying'));
  k = await tab('bar');
  check('Bar: when to show, lock, look', ['barShow', 'barLean', 'keepOpen', 'barWidth', 'barThick', 'barOpacity', 'barColor'].every((x) => k.includes(x)) && !k.includes('barRest'), k.join());
  await p.eval(`document.querySelector('[data-k=barShow][data-v=always]').click()`); await sleep(150);
  check('...the resting opacity row appears for "Always"', (await keys()).includes('barRest'));
  k = await tab('music');
  check('Music: title options and the equalizer', ['nowPlaying', 'npShow', 'npArtist', 'npSize', 'npOpacity', 'mediaCard', 'cardArt', 'vizStyle', 'vizSens', 'vizSmooth', 'vizColor', 'vizAny'].every((x) => k.includes(x)) && !k.includes('vizBars'), k.join());
  await p.eval(`document.querySelector('[data-k=vizStyle][data-v=bars]').click()`); await sleep(150);
  check('...the detail row appears for bars', (await keys()).includes('vizBars'));
  await p.eval(`document.querySelector('[data-k=vizStyle][data-v=off]').click()`); await sleep(150);
  k = await keys();
  check('...and the equalizer options hide when it is off', !k.includes('vizSens') && !k.includes('vizAny') && k.includes('vizStyle'));
  await p.eval(`document.querySelector('[data-k=nowPlaying]').click()`); await sleep(150);
  k = await keys();
  check('...the title options hide when the title is off', !k.includes('npShow') && !k.includes('mediaCard'));
  k = await tab('extras');
  check('Extras: activities, timer, gestures', ['actCharge', 'actLowBatt', 'actVolume', 'actTime', 'timerOn', 'scrollVol'].every((x) => k.includes(x)), k.join());
  await clearCalls(p);
  await p.eval(`document.querySelector('[data-k=scrollVol]').click()`); await sleep(150);
  const sc = (await calls(p)).filter((c) => c[0] === 'setConfig');
  check('a change is saved', sc.length > 0 && JSON.stringify(sc[0]).includes('scrollVol'), JSON.stringify(sc));
  check('no errors', p.errors.length === 0, p.errors.join(' | '));
});

await group('equalizer: wave, bars, mirror, dots, pulse', async (p) => {
  await sleep(300); await hover(p);
  await feed(p, 8);
  let w = await wave(p);
  check('wave: the bar turns into a line', w.o > .9 && w.po < .1 && /^M/.test(w.d) && !/M.*M/.test(w.d), `${w.o} ${w.po}`);
  const shapes = new Set();
  for (let i = 0; i < 6; i++) { await feed(p, 2); shapes.add((await wave(p)).d); }
  check('...that keeps changing', shapes.size >= 5, shapes.size + ' shapes');
  const ys = (d) => [...d.matchAll(/ ([\d.]+)/g)].map((m) => +m[1]);
  const spread = (d) => Math.max(...ys(d)) - Math.min(...ys(d));
  check('...with height', spread((await wave(p)).d) > 3);
  await cfgSet(p, { vizStyle: 'bars', vizBars: 24 }); await feed(p, 6);
  w = await wave(p);
  check('bars: one stroke per bar', (w.d.match(/M/g) || []).length === 24, (w.d.match(/M/g) || []).length + ' bars');
  await cfgSet(p, { vizBars: 12 }); await feed(p, 6);
  check('...fewer with Low detail', ((await wave(p)).d.match(/M/g) || []).length === 12);
  await cfgSet(p, { vizStyle: 'mirror', vizBars: 24 }); await feed(p, 6);
  w = await wave(p);
  const ysM = ys(w.d);
  check('mirror: bars grow both ways from the line', (w.d.match(/M/g) || []).length === 24 && Math.max(...ysM) > 22.5 && Math.min(...ysM) < 21.5);
  await cfgSet(p, { vizStyle: 'dots' }); await feed(p, 6);
  w = await wave(p);
  check('dots: single points', (w.d.match(/M/g) || []).length === 24 && /M([\d.]+) ([\d.]+)L\1 \2/.test(w.d));
  await cfgSet(p, { vizStyle: 'pulse' }); await feed(p, 8);
  w = await wave(p);
  check('pulse: the bar itself glows and swells', w.o < .02 && w.po > .9 && +w.lv > .1, JSON.stringify({ o: w.o, lv: w.lv }));
  check('no errors', p.errors.length === 0, p.errors.join(' | '));
});
await group('equalizer: options', async (p) => {
  await sleep(300); await hover(p);
  await cfgSet(p, { vizStyle: 'bars', vizSens: 100 }); await feed(p, 10, 60);
  const tall = (d) => Math.min(...[...d.matchAll(/L[\d.]+ ([\d.]+)/g)].map((m) => +m[1]));
  const lowS = tall((await wave(p)).d);
  await cfgSet(p, { vizSens: 220 }); await feed(p, 10, 60);
  const hiS = tall((await wave(p)).d);
  check('sensitivity makes the bars taller', hiS < lowS - 1.5, `${lowS} -> ${hiS}`);
  await cfgSet(p, { vizColor: 'accent' }); await sleep(100);
  check('colour: accent', (await wave(p)).acc === true);
  // smoothness: a loud frame followed by silence falls slowly when Silky, quickly when Snappy
  const fall = async (sm) => { await cfgSet(p, { vizSmooth: sm }); await feed(p, 8, 90); await p.eval(`window.tbMock.emit('spectrum', ${JSON.stringify(new Array(32).fill(0))})`); await sleep(160); return p.eval(`window.__wispy.nx.level()`); };
  const snappy = await fall(0), silky = await fall(100);
  check('smoothness: silky falls slower than snappy', silky > snappy + .03, `snappy ${snappy.toFixed(2)}, silky ${silky.toFixed(2)}`);
  check('no errors', p.errors.length === 0, p.errors.join(' | '));
});
await group('equalizer: the helper is only asked while it is needed', async (p) => {
  await p.eval(`window.__vizCalls = []; const f = tb.viz; tb.viz = (on) => { __vizCalls.push(on); return f && f(on); }; 1`);
  await sleep(300);
  check('not asked while the bar is out of sight', (await p.eval('__vizCalls')).length === 0);
  await hover(p);
  check('asked on hover while music plays', (await p.eval('__vizCalls')).includes(true));
  await cfgSet(p, { vizStyle: 'off' }); await sleep(1700);
  check('and told to stop when the equalizer is off', (await p.eval('__vizCalls')).slice(-1)[0] === false, JSON.stringify(await p.eval('__vizCalls')));
  await cfgSet(p, { vizStyle: 'wave', vizAny: false }); await mediaEv(p, { playing: false }); await sleep(300);
  await p.eval('__vizCalls.length = 0');
  await move(p, 600, 610); await sleep(500);
  check('paused media: not asked', !(await p.eval('__vizCalls')).includes(true));
  await cfgSet(p, { vizAny: true }); await sleep(400);
  check('"react to any sound": asked even then', (await p.eval('__vizCalls')).includes(true));
  check('no errors', p.errors.length === 0, p.errors.join(' | '));
});

await group('title above the bar: text, options, hover only', async (p) => {
  await sleep(500);
  let n = await lineOf(p);
  check('nothing shows while the pointer is away', n.o < .02 && n.v === 'hidden', JSON.stringify(n));
  await hover(p);
  n = await lineOf(p);
  const bar = await rect(p, '#bar'), line = await rect(p, '#np');
  check('hover shows title and artist', n.v === 'visible' && n.t === 'Kyoto Sunrise · Lofi Girl' && Math.abs(n.o - .9) < .03, JSON.stringify(n));
  check('the line sits above the bar, centred', line.y + line.h <= bar.y + .5 && Math.abs((line.x + line.w / 2) - (bar.x + bar.w / 2)) < 2);
  await cfgSet(p, { npArtist: false }); await sleep(500);
  check('without the artist', (await lineOf(p)).t === 'Kyoto Sunrise', (await lineOf(p)).t);
  await cfgSet(p, { npOpacity: 50, npSize: 16 }); await sleep(500);
  n = await lineOf(p);
  check('opacity and size apply', Math.abs(n.o - .5) < .03 && (await p.eval(`getComputedStyle(document.querySelector('#np')).fontSize`)) === '16px', JSON.stringify(n));
  await mediaEv(p, { title: 'Second Song', artist: '' }); await sleep(500);
  check('a new track swaps the text', (await lineOf(p)).t === 'Second Song');
  await mediaEv(p, { playing: false }); await sleep(500);
  n = await lineOf(p);
  check('paused: still there on hover, dimmed', n.v === 'visible' && n.o > .2 && n.o < .5, JSON.stringify(n));
  await cfgSet(p, { nowPlaying: false }); await sleep(500);
  check('the setting turns it off', (await lineOf(p)).o < .02);
  check('no errors', p.errors.length === 0, p.errors.join(' | '));
});
await group('title above the bar: dock open, fullscreen, "whenever the bar shows"', async (p) => {
  await sleep(300); await hover(p);
  await edge(p);
  check('the line steps aside while the dock is open', (await lineOf(p)).o < .05);
  await away(p);
  await cfgSet(p, { barShow: 'always', barRest: 50 }); await sleep(1000);
  check('hover only: not shown while the bar merely rests', (await lineOf(p)).o < .05);
  check('no errors', p.errors.length === 0, p.errors.join(' | '));
});
await group('title above the bar: "whenever the bar shows", fullscreen', async (p) => {
  await cfgSet(p, { barShow: 'always', barRest: 50, npShow: 'visible' }); await sleep(1600);
  check('whenever the bar shows: it is', (await lineOf(p)).o > .25, JSON.stringify(await lineOf(p)));
  await p.eval(`window.tbMock.emit('fullscreen', true)`); await sleep(700);
  check('nothing over a fullscreen app', (await lineOf(p)).o < .02 && (await barOf(p)).v === 'hidden');
  check('no errors', p.errors.length === 0, p.errors.join(' | '));
});

await group('media card: cover, controls, progress', async (p) => {
  await sleep(300);
  await mediaEv(p, { art: 'icons/none.png' });
  await hover(p);
  const [x, y] = await centre(p, '#np');
  await move(p, x, y); await sleep(700);
  const card = () => p.eval(`(() => { const c = document.querySelector('#npcard'); return { o: +c.style.opacity, v: c.style.visibility, pe: c.style.pointerEvents, title: c.querySelector('.nc-title').textContent, artist: c.querySelector('.nc-artist').textContent, t0: c.querySelector('.nc-t0').textContent, t1: c.querySelector('.nc-t1').textContent, play: c.querySelector('[data-m=toggle] use').getAttribute('href'), prev: c.querySelector('[data-m=prev]').disabled, next: c.querySelector('[data-m=next]').disabled, noart: c.classList.contains('noart') }; })()`);
  let c = await card();
  check('hovering the line opens the card', c.v === 'visible' && c.o > .95 && c.pe === 'auto', JSON.stringify(c));
  check('...with title, artist and times', c.title === 'Kyoto Sunrise' && c.artist === 'Lofi Girl' && /^0:3\d$/.test(c.t0) && c.t1 === '3:20', JSON.stringify(c));
  check('...and a pause button while playing', c.play === '#i-pause');
  await clearCalls(p);
  const [bx, by] = await centre(p, '#npcard [data-m=toggle]');
  await click(p, bx, by);
  check('play/pause sends the command', (await calls(p)).some((k) => k[0] === 'mediaCmd' && k[1] === 'toggle'), JSON.stringify(await calls(p)));
  c = await card();
  check('...and the icon flips at once', c.play === '#i-play', c.play);
  const [nx_, ny] = await centre(p, '#npcard [data-m=next]');
  await click(p, nx_, ny);
  check('next', (await calls(p)).some((k) => k[0] === 'mediaCmd' && k[1] === 'next'));
  const bar = await rect(p, '#npcard .nc-bar');
  await click(p, bar.x + bar.w * .5, bar.y + bar.h / 2);
  const seek = (await calls(p)).find((k) => k[0] === 'mediaCmd' && k[1] === 'seek');
  check('clicking the progress bar seeks', seek && Math.abs(seek[2] - 100) < 6, JSON.stringify(seek));
  await move(p, 700, 100); await sleep(900);
  c = await card();
  check('moving away closes it', c.v === 'hidden', JSON.stringify(c));
  check('no errors', p.errors.length === 0, p.errors.join(' | '));
});
await group('media card: options and edge cases', async (p) => {
  await sleep(300);
  await mediaEv(p, { canNext: false, canPrev: false, canSeek: false, dur: 0 });
  await hover(p);
  const [x, y] = await centre(p, '#np');
  await move(p, x, y); await sleep(700);
  const st = await p.eval(`(() => { const c = document.querySelector('#npcard'); return { v: c.style.visibility, prev: c.querySelector('[data-m=prev]').disabled, next: c.querySelector('[data-m=next]').disabled, live: c.classList.contains('live'), t1: c.querySelector('.nc-t1').textContent }; })()`);
  check('buttons the player cannot do are disabled', st.v === 'visible' && st.prev && st.next, JSON.stringify(st));
  check('a stream without a length shows "live"', st.live && st.t1 === 'live', JSON.stringify(st));
  await cfgSet(p, { mediaCard: false }); await move(p, 700, 100); await sleep(500); await move(p, x, y); await sleep(700);
  check('the setting turns the card off', (await p.eval(`document.querySelector('#npcard').style.visibility`)) === 'hidden');
  check('...and the line no longer takes the pointer', (await lineOf(p)).ev === 'none');
  check('no errors', p.errors.length === 0, p.errors.join(' | '));
});

await group('live activities: volume, charger, low battery', async (p) => {
  const text = () => lineOf(p);
  await sleep(300);
  await p.eval(`window.tbMock.emit('volume', 50, false)`); await sleep(500);
  let n = await text();
  check('a volume change shows a line, even without hover', n.o > .9 && n.t === 'Volume 50', JSON.stringify(n));
  check('...with a meter', await p.eval(`document.querySelector('#np .np-meter').style.display !== 'none' && parseFloat(document.querySelector('#np .np-meter i').style.width) === 50`));
  check('...and the bar peeks out for it', (await barOf(p)).v === 'visible');
  await p.eval(`window.tbMock.emit('volume', 50, true)`); await sleep(400);
  check('muting says so', (await text()).t === 'Muted');
  await sleep(2300);
  check('it fades away by itself', (await text()).o < .1, JSON.stringify(await text()));
  await cfgSet(p, { actVolume: false }); await p.eval(`window.tbMock.emit('volume', 20, false)`); await sleep(500);
  check('volume line off', (await text()).o < .05);
  await p.eval(`window.__wispy.nx.battery({ level: .5, charging: false })`);
  await p.eval(`window.__wispy.nx.battery({ level: .5, charging: true })`); await sleep(450);
  n = await text();
  check('plugging in the charger', n.o > .9 && n.t === 'Charging · 50%', JSON.stringify(n));
  check('no errors', p.errors.length === 0, p.errors.join(' | '));
});
await group('live activities: options', async (p) => {
  const text = () => lineOf(p);
  await sleep(300);
  await p.eval(`window.__wispy.nx.battery({ level: .5, charging: true })`);
  await cfgSet(p, { actCharge: false }); await p.eval(`window.__wispy.nx.battery({ level: .5, charging: false })`); await sleep(450);
  check('charger line off', (await text()).o < .05);
  await p.eval(`window.__wispy.nx.battery({ level: .25, charging: false })`);
  await p.eval(`window.__wispy.nx.battery({ level: .19, charging: false })`); await sleep(450);
  let n = await text();
  check('low battery at 20%', n.o > .9 && n.t === 'Battery low · 19%', JSON.stringify(n));
  await cfgSet(p, { actLowBatt: false }); await p.eval(`window.__wispy.nx.battery({ level: .09, charging: false })`); await sleep(500);
  check('low battery off', (await text()).t !== 'Battery low · 9%');
  await cfgSet(p, { actTime: 1600 }); await p.eval(`window.__wispy.nx.flash({ text: 'Short one', icon: 'i-bolt' })`); await sleep(2200);
  check('"how long they stay" applies', (await text()).o < .1);
  check('no errors', p.errors.length === 0, p.errors.join(' | '));
});

await group('timer: from search to the bar', async (p) => {
  const parse = (s) => p.eval(`window.__wispy.nx.parseTimer(${JSON.stringify(s)})`);
  const cases = [['10', 600000], ['10m', 600000], ['90s', 90000], ['1h30m', 5400000], ['1:30', 90000], ['25 min', 1500000], ['2 hours', 7200000], ['soon', null], ['', null]];
  let bad = [];
  for (const [s, ms] of cases) { const got = await parse(s); if (got !== ms) bad.push(`${s}=>${got}`); }
  check('durations are understood', bad.length === 0, bad.join('; '));
  await searchFor(p, 'timer 10m');
  const titles = () => p.eval(`[...document.querySelectorAll('#p-search .res b')].map((e) => e.textContent)`);
  let t = await titles();
  check('"timer 10m" offers a 10 minute timer first', t[0] === 'Start a 10 minute timer', t.join(' | '));
  await key(p, 'Enter'); await sleep(500);
  await move(p, 520, 600); await sleep(700);
  const n = await lineOf(p);
  check('it counts down above the bar', /^(9:5\d|10:00)$/.test(n.chip) && n.v === 'visible', JSON.stringify(n));
  check('no errors', p.errors.length === 0, p.errors.join(' | '));
});
await group('timer: presets, stop, finish, setting', async (p) => {
  await sleep(300);
  await searchFor(p, 'timer');
  const titles = () => p.eval(`[...document.querySelectorAll('#p-search .res b')].map((e) => e.textContent)`);
  let t = await titles();
  check('"timer" alone offers presets', t[0] === 'Start a 5 minute timer' && t.includes('Start a 25 minute timer'), t.join(' | '));
  await p.eval(`window.__wispy.closeBar()`); await sleep(500);
  await p.eval(`window.__wispy.nx.startTimer(450, 'Tea')`); await sleep(1100);
  const n = await lineOf(p);
  check('a timer that runs out says so', n.t === 'Timer done' && n.o > .9, JSON.stringify(n));
  check('...and leaves a notification', (await p.eval(`document.querySelector('#toasts').textContent`)).includes('Timer done'));
  check('...and is gone afterwards', (await p.eval(`window.__wispy.nx.timer()`)) === null);
  await p.eval(`window.__wispy.nx.startTimer(60000)`);
  await p.eval(`window.__wispy.nx.stopTimer()`); await sleep(300);
  check('stopping it', (await p.eval(`window.__wispy.nx.timer()`)) === null && (await lineOf(p)).t === 'Timer stopped');
  await cfgSet(p, { timerOn: false }); await p.eval(`window.__wispy.nx.startTimer(60000)`);
  check('the setting turns it off', (await p.eval(`window.__wispy.nx.timer()`)) === null);
  check('no errors', p.errors.length === 0, p.errors.join(' | '));
});

await group('gestures: scroll over the bar for volume', async (p) => {
  await sleep(300);
  await cfgSet(p, { scrollVol: true });
  await hover(p);
  const bar = await rect(p, '#bar');
  const wheel = async (dy) => { await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: bar.x + bar.w / 2, y: bar.y + bar.h / 2, deltaX: 0, deltaY: dy }); await sleep(120); };
  await move(p, bar.x + bar.w / 2, bar.y + bar.h / 2); await sleep(300);
  await clearCalls(p);
  await wheel(-100);
  const up = (await calls(p)).filter((k) => k[0] === 'volume');
  check('scrolling up raises the volume', up.length === 1 && JSON.stringify(up[0]).includes('"level":41') , JSON.stringify(up));
  await clearCalls(p);
  await wheel(100); await wheel(100);
  check('scrolling down lowers it', (await calls(p)).filter((k) => k[0] === 'volume').length === 2);
  check('the volume line shows', (await lineOf(p)).t.startsWith('Volume'));
  await cfgSet(p, { scrollVol: false }); await clearCalls(p); await wheel(-100);
  check('the setting turns it off', (await calls(p)).filter((k) => k[0] === 'volume').length === 0);
  check('the main process is told about the pill when it is on', await (async () => { await cfgSet(p, { scrollVol: true }); await sleep(200); return (await p.eval('window.__rects')).length > 0; })());
  check('no errors', p.errors.length === 0, p.errors.join(' | '));
});

// ---------------------------------------------------------------- search
for (const term of ['mu', 'note', 'set', 'a']) {
  await group('search: ' + term, async (p) => {
    await edge(p);
    await searchFor(p, term);
    const rows = await p.eval(`document.querySelectorAll('#p-search .res').length`);
    check('results appear', rows >= 2, rows + ' rows');
    // hover every row: the panel and the buttons must not move
    const panel0 = await rect(p, '#p-search');
    let stable = true, detail = '';
    for (let i = 0; i < rows; i++) {
      const [x, y] = await centre(p, '#p-search .res', i);
      await move(p, x - 40, y); await move(p, x, y); await sleep(170);
      const pr = await rect(p, '#p-search'), b0 = await rect(p, '#p-search [data-ra]');
      if (pr.y !== panel0.y || pr.h !== panel0.h) { stable = false; detail += ` row${i}: panel ${pr.y}/${pr.h} vs ${panel0.y}/${panel0.h};`; }
      const heroTop = await rect(p, '#p-search .sp-hero');
      if (i === 0) p._hero = heroTop;
      else if (heroTop.y !== p._hero.y) { stable = false; detail += ` row${i}: pane top moved;`; }
    }
    check('hovering rows never moves or resizes the panel', stable, detail || `panel ${panel0.y}/${panel0.h}`);
    // the first action button's position is the same for every result with that action list
    const sels = await p.eval(`[...document.querySelectorAll('#p-search .res')].map((_, i) => i)`);
    // click every action of the selected result with a real click
    for (let i = 0; i < Math.min(rows, 3); i++) {
      const [rx, ry] = await centre(p, '#p-search .res', i);
      await move(p, rx, ry); await sleep(170);
      const n = await p.eval(`document.querySelectorAll('#p-search [data-ra]').length`);
      for (let a = 0; a < n; a++) {
        const act = await p.eval(`document.querySelectorAll('#p-search [data-ra]')[${a}].dataset.ra`);
        if (['open', 'uninstall', 'terminal'].includes(act) && a > 0) continue;   // these leave search; checked once below
        if (act === 'open') continue;
        const [bx, by] = await centre(p, '#p-search [data-ra]', a);
        await clearCalls(p); await click(p, bx, by);
        const c = await calls(p);
        const okCall = c.some((cc) => cc[0] === 'resultAction' && cc[2] === act) || (['pin', 'unpin', 'copypath'].includes(act) && c.length > 0);
        check(`row ${i}: clicking "${act}" works`, okCall, JSON.stringify(c));
        if (!(await S(p, 'open'))) { await edge(p); await searchFor(p, term); await move(p, rx, ry); await sleep(170); }
      }
    }
    // a click on a result row opens it
    await edge(p); if ((await p.eval(`document.querySelectorAll('#p-search .res').length`)) < 2 || !(await S(p, 'searching'))) await searchFor(p, term);
    const [rx, ry] = await centre(p, '#p-search .res', 1);
    await clearCalls(p); await click(p, rx, ry);
    check('clicking a result opens it', (await calls(p)).some((c) => c[0] === 'open'), JSON.stringify(await calls(p)));
  });
}

await group('search: hover responds at once', async (p) => {
  await edge(p); await searchFor(p, 'a');
  const [x, y] = await centre(p, '#p-search .res', 3);
  await move(p, x - 30, y); await sleep(200);
  await move(p, x, y);
  await sleep(50);
  const at50 = await p.eval(`document.querySelector('#p-search .res.sel').dataset.i`);
  check('the highlight is on the hovered row within 50 ms', at50 === '3', 'row ' + at50);
  await sleep(450);
  const pane = await p.eval(`document.querySelector('#p-search .sp-hero b').textContent`);
  const row = await p.eval(`document.querySelectorAll('#p-search .res')[3].querySelector('b').textContent`);
  check('and the pane follows once the pointer has stopped', pane === row, pane + ' / ' + row);
  // sweep down the list: the highlight must track the pointer row for row
  let tracked = 0, total = 0;
  for (let i = 0; i < 6; i++) {
    const [rx, ry] = await centre(p, '#p-search .res', i);
    await move(p, rx, ry); await sleep(40);
    total++; if ((await p.eval(`document.querySelector('#p-search .res.sel').dataset.i`)) === String(i)) tracked++;
  }
  check('the highlight tracks the pointer down the list', tracked === total, `${tracked}/${total}`);
});

await group('search: moving to an action button across other rows', async (p) => {
  await edge(p); await searchFor(p, 'mu');
  const [rx, ry] = await centre(p, '#p-search .res', 0);
  await move(p, rx, ry); await sleep(200);
  const before = await p.eval(`document.querySelector('#p-search .res.sel').dataset.i`);
  const [bx, by] = await centre(p, '#p-search [data-ra]', 0);
  // a quick diagonal sweep that crosses the rows below on its way to the pane
  const steps = 14;
  for (let i = 1; i <= steps; i++) { await move(p, rx + (bx - rx) * i / steps, ry + (by + 90 - ry) * (i / steps)); await sleep(7); }
  await move(p, bx, by); await sleep(40);
  const after = await p.eval(`document.querySelector('#p-search .res.sel').dataset.i`);
  check('the selection stays put while you aim at a button', before === after, before + ' -> ' + after);
  await clearCalls(p); await click(p, bx, by);
  check('and the click lands on the intended result\'s action', (await calls(p)).length > 0, JSON.stringify(await calls(p)));
});

await group('search: keyboard', async (p) => {
  await edge(p); await searchFor(p, 'a');
  const sel = () => p.eval(`document.querySelector('#p-search .res.sel').dataset.i`);
  const s0 = await sel(); await key(p, 'ArrowDown'); const s1 = await sel();
  check('ArrowDown moves the selection', s0 !== s1, s0 + '->' + s1);
  await key(p, 'ArrowUp'); check('ArrowUp moves it back', (await sel()) === s0);
  await key(p, 'Tab'); check('Tab moves to the next result', (await sel()) === s1);
  // a resting pointer must not snap the selection back
  const [x, y] = await centre(p, '#p-search .res', 3);
  await move(p, x, y); await sleep(200); const hov = await sel();
  await key(p, 'ArrowUp'); await sleep(300);
  check('a resting pointer does not undo keyboard selection', (await sel()) !== hov, 'sel ' + (await sel()));
  await clearCalls(p); await key(p, 'Enter');
  check('Enter opens the selected result', (await calls(p)).some((c) => c[0] === 'open'), JSON.stringify(await calls(p)));
  await edge(p); await searchFor(p, 'mu'); await key(p, 'Escape');
  check('Escape leaves search', (await p.eval(`window.__wispy.S.mode`)) === 'dock');
});

// ---------------------------------------------------------------- panels
await group('panels: every button in the bar opens something that works', async (p) => {
  await edge(p);
  const buttons = await p.eval(`[...document.querySelectorAll('#row .btn')].filter((b) => b.offsetParent && b.getBoundingClientRect().width > 0).map((b) => [b.id, b.getAttribute('aria-label') || b.id])`);
  check('the bar has its buttons', buttons.length >= 4, buttons.map((b) => b[0]).join(','));
  for (const [id] of buttons) {
    if (!id) continue;
    await edge(p);
    const c = await centre(p, '#' + id);
    if (!c) continue;
    await click(p, c[0], c[1]); await sleep(450);
    const mode = await p.eval(`window.__wispy.S.mode`);
    const panelOk = mode === 'dock' ? true : await p.eval(`(() => { const e = document.querySelector('#p-' + window.__wispy.S.mode); return !!e && e.classList.contains('show') && e.getBoundingClientRect().height > 40 && (e.textContent.trim().length > 3 || e.querySelectorAll('img, button, svg').length > 1); })()`);
    check(`#${id} opens "${mode}" and it has content`, mode !== 'dock' ? panelOk : true, 'mode=' + mode);
    // does the panel stay inside the window?
    if (mode !== 'dock') {
      const r = await p.eval(`(() => { const r = document.querySelector('#p-' + window.__wispy.S.mode).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()`);
      check(`#${id}: the "${mode}" panel fits in the window`, r[0] >= -1 && r[1] >= -1 && r[2] <= 921 && r[3] <= 701, r.map(Math.round).join(','));
    }
    await key(p, 'Escape'); await sleep(250);
    if ((await p.eval(`window.__wispy.S.mode`)) !== 'dock') await click(p, 700, 250);
    await sleep(250);
  }
});

await group('panels: quick settings', async (p) => {
  await edge(p);
  const sc = await centre(p, '#status'); await click(p, sc[0], sc[1]); await sleep(500);
  check('quick settings open', (await p.eval(`window.__wispy.S.mode`)) === 'quick');
  const tile = await centre(p, '#t-bt .qs-main');
  const before = await p.eval(`document.querySelector('#t-bt').className`);
  await clearCalls(p); await click(p, tile[0], tile[1]); await sleep(400);
  check('the Bluetooth tile toggles', (await calls(p)).some((c) => c[0] === 'setRadio') || (await p.eval(`document.querySelector('#t-bt').className`)) !== before);
  const go = await centre(p, '#t-wifi .qs-go'); await click(p, go[0], go[1]); await sleep(600);
  const networks = await p.eval(`document.querySelectorAll('#wifi-list > *').length`);
  check('the Wi-Fi page lists networks', networks >= 3, networks + '');
  const back = await centre(p, '#q-wifi .back'); await click(p, back[0], back[1]); await sleep(400);
  check('Back returns to the main page', await p.eval(`document.querySelector('#q-main').classList.contains('active')`));
  // drag the volume slider with the real mouse
  const sl = await centre(p, '#r-vol'); const v0 = await p.eval(`+document.querySelector('#r-vol').value`);
  await clearCalls(p);
  await move(p, sl[2] + 10, sl[1]); await down(p, sl[2] + 10, sl[1]); for (let i = 0; i < 8; i++) { await dragTo(p, sl[2] + 10 + (sl[4] - 20) * (i + 1) / 8, sl[1]); await sleep(15); } await up(p, sl[2] + sl[4] - 10, sl[1]); await sleep(300);
  const v1 = await p.eval(`+document.querySelector('#r-vol').value`);
  check('dragging the volume slider changes the volume', v1 !== v0 && (await calls(p)).some((c) => c[0] === 'volume'), `${v0} -> ${v1}`);
  const rects = await p.eval(`[...document.querySelectorAll('#q-main .q-btns .icon-btn')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; })`);
  check('power and settings buttons sit side by side', rects.length === 2 && rects[0][1] === rects[1][1] && rects[1][0] > rects[0][0], JSON.stringify(rects));
});

await group('panels: settings', async (p) => {
  await edge(p);
  await p.eval(`window.__wispy.setMode('settings'); 1`); await sleep(600);
  const rows = await p.eval(`[...document.querySelectorAll('#set-body .set-row, #set-body [data-k]')].length`);
  check('settings lists rows', rows > 8, rows + '');
  const labels = await p.eval(`[...document.querySelectorAll('#set-body *')].filter((e) => !e.children.length).map((e) => e.textContent.trim()).filter((t) => /delay/i.test(t))`);
  check('both close delays are there', labels.some((l) => /^Close delay$/.test(l)) && labels.some((l) => /after closing an app/i.test(l)), labels.join(' | '));
  // every range slider answers a real drag
  await p.eval(`window.__ev = []; for (const t of ['input','change','pointerdown','pointerup','mousedown','mouseup','click']) document.addEventListener(t, (e) => __ev.push(t + ':' + (e.target.dataset && e.target.dataset.k || e.target.tagName) + ':' + (e.target.value || '')), true); 1`);
  const nRange = await p.eval(`document.querySelectorAll('#set-body input[type=range]').length`);
  let moved = 0; const slow = [];
  for (let i = 0; i < nRange; i++) {
    await sleep(450);   // the panel re-renders after each saved change; let it settle before aiming
    const c = await centre(p, '#set-body input[type=range]', i);
    await p.eval(`document.querySelectorAll('#set-body input[type=range]')[${i}].scrollIntoView({ block: 'center', behavior: 'instant' }); 1`); await sleep(120);
    const c2 = await centre(p, '#set-body input[type=range]', i);
    const v0 = await p.eval(`document.querySelectorAll('#set-body input[type=range]')[${i}].value`);
    await clearCalls(p);
    await move(p, c2[2] + c2[4] * 0.25, c2[1]); await sleep(30); await down(p, c2[2] + c2[4] * 0.25, c2[1]); await sleep(40); await dragTo(p, c2[2] + c2[4] * 0.45, c2[1]); await sleep(30); await dragTo(p, c2[2] + c2[4] * 0.7, c2[1]); await sleep(40); await up(p, c2[2] + c2[4] * 0.7, c2[1]); await sleep(450);
    const v1 = await p.eval(`document.querySelectorAll('#set-body input[type=range]')[${i}].value`);
    if (v0 !== v1 && (await calls(p)).some((c) => c[0] === 'setConfig')) moved++; else slow.push(await p.eval(`(() => { const r = document.querySelectorAll('#set-body input[type=range]')[${i}]; return (r.closest('.row, .set-row, div').textContent || '').trim().slice(0, 30) + ' [' + r.min + '-' + r.max + ' v' + r.value + ']'; })()`) + ` v0=${v0} v1=${v1} mode=${await p.eval('window.__wispy.S.mode')} open=${await S(p, 'open')} slider=${JSON.stringify(c2.map(Math.round))} calls=${JSON.stringify(await calls(p))} ev=${JSON.stringify(await p.eval('__ev.slice(-8)'))} atPoint=${await p.eval(`(() => { const e = document.elementFromPoint(${c2[2] + c2[4] * 0.25}, ${c2[1]}); return e ? e.tagName + '.' + e.className + '#' + e.id + ' in ' + (e.closest('[id]') || {}).id : 'none'; })()`)}`);
  }
  check('every slider responds to the mouse and saves', moved === nRange, `${moved}/${nRange} ${slow.join(' | ')}`);
  // every switch and segmented control
  const nSw = await p.eval(`document.querySelectorAll('#set-body .switch').length`);
  let swOk = 0; const deadSw = [];
  for (let i = 0; i < nSw; i++) {
    await p.eval(`document.querySelectorAll('#set-body .switch')[${i}].scrollIntoView({ block: 'center', behavior: 'instant' }); 1`); await sleep(120);
    const sw0 = await p.eval(`document.querySelectorAll('#set-body .switch')[${i}].className`);
    const c = await centre(p, '#set-body .switch', i); await clearCalls(p); await click(p, c[0], c[1]); await sleep(200);
    const sw1 = await p.eval(`document.querySelectorAll('#set-body .switch')[${i}].className`);
    if ((await calls(p)).length || sw0 !== sw1) swOk++; else deadSw.push(await p.eval(`(document.querySelectorAll('#set-body .switch')[${i}].parentElement.textContent || '').trim().slice(0, 40)`));
  }
  check('every switch toggles and saves', swOk === nSw, `${swOk}/${nSw} ${deadSw.join(' | ')}`);
  const nSeg = await p.eval(`document.querySelectorAll('#set-body .seg button').length`);
  let segOk = 0;
  for (let i = 0; i < nSeg; i++) {
    await p.eval(`document.querySelectorAll('#set-body .seg button')[${i}].scrollIntoView({ block: 'center', behavior: 'instant' }); 1`); await sleep(100);
    const c = await centre(p, '#set-body .seg button', i); await clearCalls(p); await click(p, c[0], c[1]);
    if ((await calls(p)).some((x) => x[0] === 'setConfig')) segOk++;
  }
  check('every segmented choice saves', segOk >= nSeg - 1, `${segOk}/${nSeg}`);
});

await group('panels: calendar, hidden icons, language', async (p) => {
  for (const [id, mode] of [['#clock', 'cal'], ['#tray-btn', 'tray'], ['#lang-btn', 'lang']]) {
    await edge(p);
    const c = await centre(p, id); if (!c) { check(id + ' exists', false); continue; }
    await click(p, c[0], c[1]); await sleep(500);
    check(`${id} opens ${mode}`, (await p.eval(`window.__wispy.S.mode`)) === mode);
    const items = await p.eval(`(() => { const e = document.querySelector('#p-${mode}'); return e.querySelectorAll('button, .cal-day, [data-key], .cell').length; })()`);
    check(`${mode} panel has clickable content`, items > 0, items + '');
    await click(p, 700, 250); await sleep(300);
  }
});

// ---------------------------------------------------------------- done
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) console.log('Failed:\n - ' + fails.join('\n - '));
b.close(); server.close();
process.exit(failed ? 1 : 0);
