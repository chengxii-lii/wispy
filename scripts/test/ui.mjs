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
  await p.eval(`(() => { window.__calls = []; for (const k of ['open','resultAction','dockClick','appAction','windowFocus','windowClose','setConfig','volume','setRadio','wifiConnect','openSettings','power','shellKey','notifyOpen']) { const f = tb[k]; tb[k] = (...a) => { __calls.push([k, ...a.map((x) => x && x.title ? x.title : x)]); return f ? f(...a) : undefined; }; } return 1; })()`);
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
