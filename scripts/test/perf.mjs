// Frame-time probe: sweeps a real mouse over the search results (and the dock) in headless Chrome and reports how long
// frames take and how much of that is script, style and layout. Not a pass/fail test; run it before and after changes.
//   node scripts/test/perf.mjs            (CPU is throttled 4x by default to stand in for a modest machine; THROTTLE=1 to disable)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../art/cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const THROTTLE = Number(process.env.THROTTLE || 4);
const server = http.createServer((req, res) => {
  const n = new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html');
  fs.readFile(path.join(ROOT, 'renderer', n), (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'cache-control': 'no-store', 'content-type': n.endsWith('.js') ? 'text/javascript' : n.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(d); });
}).listen(0);
const b = await launch({ gpu: false });
const p = await b.page(`http://localhost:${server.address().port}/`, { width: 920, height: 700, scheme: 'dark' });
await p.until("window.__wispy && document.querySelectorAll('#items .item').length > 0", 15000);
await sleep(400);
if (THROTTLE > 1) await p.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
await p.send('Performance.enable');
const move = (x, y) => p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
const metrics = async () => Object.fromEntries((await p.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
await p.eval(`(() => { window.__fr = []; let last = performance.now(); const tick = (t) => { __fr.push(t - last); last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick); window.__long = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => __long.push(e.duration))).observe({ entryTypes: ['longtask'] }); } catch (e) {} return 1; })()`);

async function phase(name, run) {
  await p.eval('window.__fr.length = 0; window.__long.length = 0; 1');
  const m0 = await metrics(); const t0 = Date.now();
  await run();
  const m1 = await metrics(); const wall = (Date.now() - t0) / 1000;
  const fr = (await p.eval('window.__fr.slice()')).slice(2).sort((a, c) => a - c);
  const long = await p.eval('window.__long.slice()');
  const pct = (q) => fr.length ? fr[Math.min(fr.length - 1, Math.floor(fr.length * q))].toFixed(1) : '-';
  const per = (k) => (((m1[k] - m0[k]) / wall) * 100).toFixed(0);
  console.log(`${name.padEnd(34)} frames ${String(fr.length).padStart(4)}  p50 ${pct(0.5)}ms  p95 ${pct(0.95)}ms  max ${pct(1)}ms  long tasks ${long.length}  | per second: script ${per('ScriptDuration')}ms  layout ${per('LayoutDuration')}ms  style ${per('RecalcStyleDuration')}ms  (of 1000)`);
}

await move(460, 697); await sleep(600);
await phase('idle, dock open', async () => { await sleep(1500); });
await phase('sweep over the dock icons', async () => {
  for (let k = 0; k < 3; k++) for (let x = 330; x <= 600; x += 6) { await move(x, 640); await sleep(8); }
});
await move(460, 697); await sleep(600);
await p.eval(`window.tbMock.emit('win-key'); 1`); await sleep(500);
await p.eval(`document.querySelector('#q').focus(); 1`);
await p.send('Input.insertText', { text: 'a' }); await sleep(900);
const rows = await p.eval(`document.querySelectorAll('#p-search .res').length`);
const rowY = await p.eval(`[...document.querySelectorAll('#p-search .res')].map((e) => { const r = e.getBoundingClientRect(); return [r.x + 60, r.y + r.height / 2]; })`);
await phase(`idle, search open (${rows} rows)`, async () => { await sleep(1500); });
await phase('hover down and up the results', async () => {
  for (let k = 0; k < 4; k++) {
    const order = k % 2 ? [...rowY].reverse() : rowY;
    for (let i = 0; i < order.length - 1; i++) {
      const [x0, y0] = order[i], [, y1] = order[i + 1];
      for (let s = 0; s <= 6; s++) { await move(x0 + s, y0 + (y1 - y0) * s / 6); await sleep(8); }
      await sleep(120);
    }
  }
});
await phase('sweep across the action buttons', async () => {
  for (let k = 0; k < 4; k++) for (let y = 330; y < 600; y += 8) { await move(700, y); await sleep(8); }
});
b.close(); server.close(); process.exit(0);
