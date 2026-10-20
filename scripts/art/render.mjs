// Renders tinybar's README art into .github/assets: a ShaderGradient banner, screenshots of the real UI over
// the gradient, a social card and a demo GIF. Run with `npm run art` (installs this folder's dependencies first).
//
//   node scripts/art/render.mjs [banner] [shots] [social] [demo]   (default: all)
//
// The UI in every image is the real renderer (renderer/index.html), driven the way the harness drives it,
// fed brand-free data from art-data.js.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { PNG } from 'pngjs';
import gifenc from 'gifenc';
import { launch, sleep } from './cdp.mjs';

const { GIFEncoder, quantize, applyPalette } = gifenc;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, '.github', 'assets');
const PORT = 5178;
const WIDTH = 1800; // README images are this many pixels wide
const want = process.argv.slice(2);
const doing = (what) => !want.length || want.includes(what);
fs.mkdirSync(OUT, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(HERE, 'scene.jsx')], bundle: true, minify: true, jsx: 'automatic',
  outfile: path.join(HERE, 'www', 'scene.js'), define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning',
});
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const ui = url.pathname.startsWith('/ui/');
  const name = (ui ? url.pathname.slice(3) : url.pathname).replace(/^\/$/, '/index.html');
  fs.readFile(path.join(ui ? path.join(ROOT, 'renderer') : path.join(HERE, 'www'), name), (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(name)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT);
const scene = (query) => `http://localhost:${PORT}/?${query}`;

const b = await launch({ gpu: true, inject: fs.readFileSync(path.join(HERE, 'art-data.js'), 'utf8') });
const UI = 'art.ui';

// open a page, wait for the gradient and the UI to be ready
async function open(query, { width = 1440, height = 820, scale = WIDTH / 1440, scheme = 'dark' } = {}) {
  const p = await b.page(scene(query), { width, height, scale, scheme });
  await p.until(`${UI} && ${UI}.__tinybar && ${UI}.document.querySelectorAll('#items .item').length > 0`);
  await p.eval('document.fonts.ready.then(() => 1)');
  await sleep(4200); // the gradient needs a moment to draw
  return p;
}
const ui = (p, js) => p.eval(`(() => { const u = ${UI}; ${js} })()`);
const settle = async (p, ms = 1100) => { await ui(p, 'u.__tinybar.advance(1400); return 1'); await sleep(ms); };
async function dock(p) { await ui(p, 'u.__tinybar.openBar(true); return 1'); await settle(p, 500); }
async function overItem(p, n) {
  const [x, y] = await p.eval(`art.itemCentre(${n})`);
  await p.eval(`art.cursor(${x}, ${y}); ${UI}.__tinybar.advance(1000); 1`);
  await sleep(500);
}
const click = (p, sel) => ui(p, `u.document.querySelector(${JSON.stringify(sel)}).click(); return 1`);
async function search(p, text) {
  await ui(p, 'u.tbMock.emit("win-key"); return 1');
  await sleep(500);
  await ui(p, `const q = u.document.querySelector('#q'); q.value = ${JSON.stringify(text)}; q.dispatchEvent(new Event('input')); return 1`);
  await sleep(1500);
}

try {
  if (doing('banner') || doing('social')) {
    const p = await open('banner=1&ui=1&s=1&b=26&t=1.2', { width: 1280, height: 640, scale: WIDTH / 1280 });
    await dock(p);
    await overItem(p, 4);
    await p.eval('art.hideCursor(); 1');
    if (doing('banner')) { await p.screenshot(path.join(OUT, 'banner.jpg'), { quality: 88 }); console.log('banner.jpg'); }
    if (doing('social')) {
      await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 640, deviceScaleFactor: 1, mobile: false });
      await sleep(800);
      await p.screenshot(path.join(OUT, 'social.jpg'), { quality: 86 }); // GitHub's social preview must stay under 1 MB
      console.log('social.jpg');
    }
    await p.closeTarget();
  }

  if (doing('shots')) {
    const base = 'decor=1&cursor=1&s=1.2&b=22';
    let p = await open(base + '&t=1.2');
    await dock(p);
    await overItem(p, 4);
    await p.screenshot(path.join(OUT, 'hero.jpg')); console.log('hero.jpg');
    await p.closeTarget();

    p = await open(base + '&t=1.6');
    await dock(p);
    await search(p, 'mu');
    await ui(p, 'u.document.querySelector(".sp-acts button").dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); return 1');
    await p.eval('art.hideCursor(); 1');
    await p.screenshot(path.join(OUT, 'search.jpg')); console.log('search.jpg');
    await p.closeTarget();

    p = await open(base + '&t=1.0');
    await dock(p);
    await click(p, '#status'); await sleep(700);
    await click(p, '[data-act=page-sound]'); await sleep(1500);
    await p.eval('art.hideCursor(); 1');
    await p.screenshot(path.join(OUT, 'sound.jpg')); console.log('sound.jpg');
    await p.closeTarget();

    p = await open(base + '&t=1.4');
    await dock(p);
    await click(p, '#clock'); await sleep(1300);
    await p.eval('art.hideCursor(); 1');
    await p.screenshot(path.join(OUT, 'notifications.jpg')); console.log('notifications.jpg');
    await p.closeTarget();

    p = await open(base + '&t=1.8');
    await dock(p);
    await ui(p, 'u.__tinybar.setMode("settings"); return 1'); await sleep(1500);
    await p.eval('art.hideCursor(); 1');
    await p.screenshot(path.join(OUT, 'settings.jpg')); console.log('settings.jpg');
    await p.closeTarget();

    p = await open(base + '&t=1.2&c1=%238fb2ff&c2=%23e2f4ff&c3=%235b7cff&br=1&scheme=light', { scheme: 'light' });
    await dock(p);
    await overItem(p, 2);
    await p.eval('art.hideCursor(); 1');
    await p.screenshot(path.join(OUT, 'light.jpg')); console.log('light.jpg');
    await p.closeTarget();
  }

  if (doing('demo')) await demo();
} finally {
  b.close();
  server.close();
}

// The GIF: the real hover-and-open behaviour, then the Win-key search, then quick settings. The cursor travels
// the way a hand would; every frame is a real screenshot, delayed by how long the capture really took.
async function demo() {
  const W = 960, H = 540, S = 0.85;
  const p = await open('decor=1&cursor=1&s=0.85&b=14&t=1.2', { width: W, height: H, scale: 1 });
  const frames = [];
  let last = Date.now();
  const frame = async (minDelay = 0) => {
    const rgba = PNG.sync.read(await p.png()).data;
    const now = Date.now();
    frames.push({ rgba, delay: Math.max(minDelay, Math.min(260, Math.round((now - last) / 10) * 10)) });
    last = Date.now();
  };
  const hold = async (ms, every = 140) => { const end = Date.now() + ms; while (Date.now() < end) { await sleep(every); await frame(); } };
  const to = async (x0, y0, x1, y1, steps) => {
    for (let i = 1; i <= steps; i++) {
      const e = i / steps, k = e * e * (3 - 2 * e);
      await p.eval(`art.cursor(${x0 + (x1 - x0) * k}, ${y0 + (y1 - y0) * k}); 1`);
      await frame();
    }
  };
  await p.eval('art.cursor(470, 300); 1');
  await sleep(600); last = Date.now(); await frame(700);
  await to(470, 300, 470, 625, 9);       // the pill fades in and is pulled toward the cursor
  await hold(450);
  await to(470, 625, 470, 699, 5);       // touch the edge: the dock opens
  await hold(900);
  const [x0, y0] = await p.eval('art.itemCentre(0)');
  const [x7] = await p.eval('art.itemCentre(7)');
  await to(470, 699, x0, y0, 8);
  await to(x0, y0, x7, y0, 20);          // sweep across the icons
  await to(x7, y0, 470, 380, 7);         // leave: it tucks away
  await hold(900);
  await p.eval('art.hideCursor(); 1');
  await ui(p, 'u.tbMock.emit("win-key"); return 1');   // Win key: search is ready
  await hold(500);
  for (const text of ['m', 'mu', 'mus']) {
    await ui(p, `const q = u.document.querySelector('#q'); q.value = ${JSON.stringify(text)}; q.dispatchEvent(new Event('input')); return 1`);
    await hold(text === 'mus' ? 1800 : 280, 110);
  }
  await ui(p, 'u.document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); return 1');
  await hold(300);
  await ui(p, 'u.document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); return 1');
  await hold(500);
  await ui(p, 'u.__tinybar.openBar(true); return 1');
  await hold(600);
  await click(p, '#status'); await hold(1000);
  await click(p, '[data-act=page-sound]'); await hold(1700);
  await ui(p, 'u.document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); return 1');
  await hold(500);
  await p.closeTarget();

  // ART_DEBUG=<folder> keeps a handful of frames as PNGs, to check the sequence by eye
  if (process.env.ART_DEBUG) {
    fs.mkdirSync(process.env.ART_DEBUG, { recursive: true });
    for (const i of [0, 8, 14, 20, 30, 40, 52, 62, 72, frames.length - 4]) {
      if (!frames[i]) continue;
      const png = new PNG({ width: W, height: H });
      png.data = Buffer.from(frames[i].rgba);
      fs.writeFileSync(path.join(process.env.ART_DEBUG, `f${String(i).padStart(2, '0')}.png`), PNG.sync.write(png));
    }
  }

  // One palette for every frame (mixing palettes leaves seams), weighted toward the UI, whose soft shades need
  // the colours; the gradient's grain hides banding on its own. Index 255 means "unchanged".
  const region = { x0: Math.round((W - 920 * S) / 2), x1: Math.round((W + 920 * S) / 2), y0: 20, y1: H };
  const sample = [];
  const take = (rgba, onlyRegion, step) => {
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
      const inside = x >= region.x0 && x < region.x1 && y >= region.y0 && y < region.y1;
      if (onlyRegion && !inside) continue;
      const o = (y * W + x) * 4;
      sample.push(rgba[o], rgba[o + 1], rgba[o + 2], 255);
    }
  };
  take(frames[0].rgba, false, 3);
  for (let i = 1; i < frames.length; i += 4) take(frames[i].rgba, true, 1);
  const palette = quantize(new Uint8Array(sample), 255);
  while (palette.length < 256) palette.push([0, 0, 0]);
  const gif = GIFEncoder();
  let prev = null;
  for (const [i, f] of frames.entries()) {
    const index = applyPalette(f.rgba, palette.slice(0, 255));
    if (prev) {
      for (let px = 0, o = 0; px < index.length; px++, o += 4) {
        if (f.rgba[o] === prev[o] && f.rgba[o + 1] === prev[o + 1] && f.rgba[o + 2] === prev[o + 2]) index[px] = 255;
      }
    }
    gif.writeFrame(index, W, H, { palette: i === 0 ? palette : undefined, delay: f.delay, transparent: i > 0, transparentIndex: 255, dispose: 1 });
    prev = f.rgba;
  }
  gif.finish();
  fs.writeFileSync(path.join(OUT, 'demo.gif'), gif.bytes());
  console.log(`demo.gif (${frames.length} frames, ${Math.round(gif.bytes().length / 1024)} KB)`);
}
