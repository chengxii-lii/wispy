// A tiny Chrome DevTools Protocol driver for the art script: launches Helium (or any Chromium) headless in a
// throwaway profile and hands back pages to photograph. No dependencies (Node 22+ has WebSocket built in).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findBrowser() {
  const candidates = [
    process.env.BROWSER,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'imput', 'Helium', 'Application', 'chrome.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('No Chromium found. Set BROWSER=/path/to/browser.');
  return found;
}

class Connection {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    this.ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && this.pending.has(d.id)) { this.pending.get(d.id)(d); this.pending.delete(d.id); }
      else if (d.method) for (const l of this.listeners) l(d);
    };
  }
  ready() { return new Promise((r) => (this.ws.readyState === 1 ? r() : (this.ws.onopen = r))); }
  send(method, params = {}, sessionId, timeout = 30000) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: no answer in ${timeout / 1000}s`)); }, timeout);
      this.pending.set(id, (d) => { clearTimeout(timer); d.error ? reject(new Error(`${method}: ${d.error.message}`)) : resolve(d.result); });
    });
  }
}

export async function launch({ gpu = true, inject = '' } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-art-'));
  const proc = spawn(findBrowser(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', ...(gpu ? ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] : []), 'about:blank',
  ], { stdio: 'ignore' });
  const kill = () => { try { proc.kill(); } catch { /* already gone */ } };
  process.once('exit', kill);
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { kill(); process.exit(130); });

  let version;
  for (let i = 0; i < 75 && !version; i++) {
    try {
      const port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0].trim();
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch { await sleep(200); }
  }
  if (!version) throw new Error('The browser did not start.');
  const c = new Connection(version.webSocketDebuggerUrl);
  await c.ready();

  async function page(url, { width = 1280, height = 800, scale = 1, scheme = 'dark' } = {}) {
    const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: s } = await c.send('Target.attachToTarget', { targetId, flatten: true });
    await c.send('Page.enable', {}, s);
    await c.send('Emulation.setFocusEmulationEnabled', { enabled: true }, s);
    await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false }, s);
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, s);
    if (inject) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: inject }, s);
    await c.send('Page.navigate', { url }, s);
    return new Page(c, s, targetId);
  }
  return { c, page, close() { kill(); setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 1500); } };
}

export class Page {
  constructor(c, session, targetId) { Object.assign(this, { c, s: session, targetId }); }
  send(method, params) { return this.c.send(method, params, this.s); }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async until(expression, timeout = 20000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await this.eval(`(() => { try { return !!(${expression}); } catch (e) { return false; } })()`).catch(() => false)) return true;
      await sleep(120);
    }
    throw new Error('timed out waiting for: ' + expression);
  }
  async screenshot(file, { quality = 88, format = 'jpeg' } = {}) {
    const { data } = await this.send('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality } : {}) });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  }
  async png() {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(data, 'base64');
  }
  // Virtual time: after `freezeTime()`, the page's clock (rAF, CSS transitions, timers) only moves when `step(ms)`
  // grants it, so frames can be captured at an exact, even rate no matter how long each screenshot takes.
  async freezeTime() { await this.send('Emulation.setVirtualTimePolicy', { policy: 'pause' }); }
  async step(ms) {
    const done = new Promise((resolve) => {
      const l = (d) => { if (d.method === 'Emulation.virtualTimeBudgetExpired' && d.sessionId === this.s) { this.c.listeners = this.c.listeners.filter((x) => x !== l); resolve(); } };
      this.c.listeners.push(l);
    });
    await this.send('Emulation.setVirtualTimePolicy', { policy: 'pauseIfNetworkFetchesPending', budget: ms });
    await done;
  }
  closeTarget() { return this.c.send('Target.closeTarget', { targetId: this.targetId }); }
}
