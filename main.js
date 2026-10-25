// wispy main process: one transparent click-through window at the bottom of the
// primary display, a native helper for the OS-level bits, and the data the UI shows.
const { app, BrowserWindow, screen, ipcMain, shell, Tray, Menu, nativeImage, systemPreferences, clipboard } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');
const SETTINGS = require('./settings-list');
const PLACES = require('./places-list');

// wispy was called tinybar, neon, then wisp before its public release: carry the old settings over, once
(() => {
  const dir = app.getPath('userData');
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['wisp', 'neon', 'tinybar']) {
      const old = path.join(app.getPath('appData'), name);
      for (const f of ['config.json', 'pins.json', 'notifications.json']) {
        if (!fs.existsSync(path.join(dir, f)) && fs.existsSync(path.join(old, f))) fs.copyFileSync(path.join(old, f), path.join(dir, f));
      }
    }
  } catch (e) { /* nothing to carry over */ }
})();

const W = 920;
const H = 700;
const DEBUG_PORT = process.env.WISPY_DEBUG_PORT;
if (DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', DEBUG_PORT);
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

if (!app.requestSingleInstanceLock()) { app.exit(0); }
app.setAppUserModelId('com.thinktrout.wispy');

let win = null, tray = null, helper = null, helperBuf = '';
let quitting = false, helperReady = false;
let nextId = 1;
const pending = new Map();
let runWin = [], fgHwnd = 0, fullscreen = false;
let pinned = [];
let appsIndex = [];
let prevFg = 0;
let hasFocus = false;
let interactive = false;
let lastCursor = '';
let lastVolume = null;
let lastLang = null;
let lastTray = [];

const logFile = path.join(app.getPath('userData'), 'wispy.log');
function log(s) {
  try {
    const line = new Date().toISOString() + ' ' + s + '\n';
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 512 * 1024) fs.writeFileSync(logFile, '');
    fs.appendFileSync(logFile, line);
  } catch (e) { /* ignore */ }
}
let searchSeq = 0;

// ---------------------------------------------------------------- settings
const DEFAULTS = {
  theme: 'auto', accent: 'cloud', glass: 46, iconSize: 46, magnify: 1.62,
  edgeOpen: true, edge: 'med', delay: 35, closeDelay: 35, closeAppDelay: 500, keepOpen: false, winKey: 'wispy', monitor: 'primary',
  clock24: false, seconds: false, dateFmt: 'short',
  showTray: true, showLang: true, showBattPct: true, showTaskView: true, showDesktop: false, showSettingsBtn: true,
  dnd: false, searchEngine: 'google', v: 3,
};
const ENGINES = {
  google: 'https://www.google.com/search?q=', duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q=', brave: 'https://search.brave.com/search?q=',
};
const cfgFile = path.join(app.getPath('userData'), 'config.json');
let cfg = { ...DEFAULTS };
let migrated = false;
try {
  const j = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  for (const k in DEFAULTS) if (typeof j[k] === typeof DEFAULTS[k] || (k === 'monitor' && j[k] != null)) cfg[k] = j[k];
  // v2: Show desktop used to be a thin sliver that was on by default; it is now an icon button that is off
  const was = j.v || 1;
  if (was < 2) cfg.showDesktop = DEFAULTS.showDesktop;
  // v3: the default accent became the neutral "cloud" instead of following Windows
  if (was < 3) cfg.accent = DEFAULTS.accent;
  if (was !== DEFAULTS.v) { migrated = true; cfg.v = DEFAULTS.v; }
  // the Windows key option was stored under the app's name, which has changed twice
  if (cfg.winKey !== 'start') cfg.winKey = 'wispy';
} catch (e) { /* first run */ }
function saveCfg() { try { fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 1)); } catch (e) { /* ignore */ } }
if (migrated) saveCfg();   // stamp migrated settings with the new version
function applyCfg(prev) {
  if (!prev || prev.monitor !== cfg.monitor) placeSoon();
  if (!prev || prev.winKey !== cfg.winKey) send({ cmd: 'winHijack', on: cfg.winKey === 'wispy' });
}
function setConfig(patch) {
  const prev = { ...cfg };
  for (const k in patch) if (k in DEFAULTS) cfg[k] = patch[k];
  saveCfg();
  applyCfg(prev);
  toRenderer('config', cfg);
  return cfg;
}
ipcMain.handle('config-get', () => cfg);
ipcMain.handle('config-set', (_e, patch) => setConfig(patch || {}));
ipcMain.handle('config-reset', () => setConfig({ ...DEFAULTS }));
ipcMain.handle('displays', () => screen.getAllDisplays().map((d, i) => ({
  id: String(d.id), primary: d.id === screen.getPrimaryDisplay().id,
  label: (d.label || 'Display ' + (i + 1)) + ' \u00b7 ' + d.size.width + '\u00d7' + d.size.height,
})));

const iconDir = path.join(app.getPath('userData'), 'icons');
const iconCache = new Map();       // key -> file url
const iconInflight = new Map();    // key -> Promise
fs.mkdirSync(iconDir, { recursive: true });

// ---------------------------------------------------------------- helper
function helperPath() { return path.join(__dirname, 'helper', 'wispy-helper.exe'); }

function startHelper() {
  helperReady = false;
  helper = spawn(helperPath(), ['--self', process.execPath, ...(process.env.WISPY_TEST ? ['--test-injected'] : [])], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  helper.stdout.setEncoding('utf8');
  helper.stdout.on('data', (chunk) => {
    helperBuf += chunk;
    let i;
    while ((i = helperBuf.indexOf('\n')) >= 0) {
      const line = helperBuf.slice(0, i).trim();
      helperBuf = helperBuf.slice(i + 1);
      if (!line) continue;
      try { onHelper(JSON.parse(line)); } catch (e) { /* ignore a bad line */ }
    }
  });
  helper.stdin.on('error', () => {});
  helper.on('exit', (code) => {
    log('helper exited ' + code);
    helper = null;
    if (!quitting) setTimeout(startHelper, 1000);
  });
}

function send(o) { try { if (helper) helper.stdin.write(JSON.stringify(o) + '\n'); } catch (e) { /* helper gone */ } }
function request(o) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    send({ ...o, id });
    setTimeout(() => { if (pending.delete(id)) resolve(null); }, 6000);
  });
}
function toRenderer(ch, ...args) { if (win && !win.isDestroyed()) win.webContents.send(ch, ...args); }

function onHelper(m) {
  switch (m.ev) {
    case 'ready':
      helperReady = true;
      send({ cmd: 'hideTaskbar' });
      send({ cmd: 'bannersOff' });
      send({ cmd: 'winHijack', on: cfg.winKey === 'wispy' });
      break;
    case 'lang': lastLang = m; toRenderer('lang', m); break;
    case 'tray':
      lastTray = (m.list || []).map((t) => ({ key: t.key, tip: t.tip, icon: 'file:///' + t.icon.replace(/\\/g, '/') }));
      toRenderer('tray', lastTray);
      break;
    case 'error': log('helper: ' + m.msg); break;
    case 'win': {
      const mine = Number(win.getNativeWindowHandle().readBigUInt64LE(0));
      if (m.fg && m.fg !== mine) prevFg = m.fg;
      openFromKey();
      break;
    }
    case 'mouse': {
      const lag = Date.now() - (m.t || Date.now());
      if (lag > 250) log('mouse event lag ' + lag + 'ms');
      toRenderer('mouse', m.t || 0);
      break;
    }
    case 'volume': lastVolume = { level: m.level, muted: m.muted }; toRenderer('volume', m.level, m.muted); break;
    case 'windows':
      runWin = (m.list || []).map((w) => (/[\u200b-\u200f\u2060\ufeff]/.test(w.title) ? { ...w, title: w.title.replace(/[\u200b-\u200f\u2060\ufeff]/g, '') } : w));   // some games pad their title with zero-width spaces
      fgHwnd = m.fg || 0;
      if (fullscreen !== !!m.full) { fullscreen = !!m.full; toRenderer('fullscreen', fullscreen); }
      pushDock();
      break;
    case 'icon': case 'fg': case 'search': case 'audio': case 'btAudio': {
      const r = pending.get(m.id);
      if (r) { pending.delete(m.id); r(m); }
      break;
    }
  }
}

// ---------------------------------------------------------------- window
// Keep the window glued to the bottom centre of the primary display. Moving between screens with
// different scaling (laptop panel vs monitor) makes Windows rescale the window after we place it,
// which lifts its bottom edge off the screen edge, so place, verify, and keep re-checking.
let followId = null;
let barOpen = false;
function targetDisplay() {
  const all = screen.getAllDisplays();
  if (cfg.monitor === 'follow') return all.find((d) => d.id === followId) || screen.getPrimaryDisplay();
  if (cfg.monitor !== 'primary') { const d = all.find((x) => String(x.id) === String(cfg.monitor)); if (d) return d; }
  return screen.getPrimaryDisplay();
}
ipcMain.on('bar-open', (_e, v) => { barOpen = !!v; });
function wantedBounds() {
  const d = targetDisplay().bounds;
  return { x: Math.round(d.x + (d.width - W) / 2), y: d.y + d.height - H, width: W, height: H };
}
function boundsOff(b, w) { return b.x !== w.x || b.y !== w.y || b.width !== w.width || b.height !== w.height; }
function placeWindow() {
  if (!win || win.isDestroyed()) return;
  const want = wantedBounds();
  win.setBounds(want);
  // a second pass lands correctly once the window already sits on the target display's DPI
  if (boundsOff(win.getBounds(), want)) win.setBounds(want);
}
function placeSoon() { placeWindow(); setTimeout(placeWindow, 250); setTimeout(placeWindow, 1000); }

function createWindow() {
  win = new BrowserWindow({
    width: W, height: H, frame: false, transparent: true, resizable: false, movable: false,
    skipTaskbar: true, alwaysOnTop: true, focusable: false, hasShadow: false, show: false,
    thickFrame: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  placeWindow();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());
  win.on('blur', () => { if (hasFocus) { hasFocus = false; toRenderer('blur'); } });
  screen.on('display-metrics-changed', placeSoon);
  screen.on('display-added', placeSoon);
  screen.on('display-removed', placeSoon);
  win.on('moved', () => { if (boundsOff(win.getBounds(), wantedBounds())) placeWindow(); });
  win.on('resized', () => { if (boundsOff(win.getBounds(), wantedBounds())) placeWindow(); });
  // belt and braces: lid closed, monitor hot-plugged while asleep, resolution changed elsewhere
  setInterval(() => { if (win && !win.isDestroyed() && boundsOff(win.getBounds(), wantedBounds())) placeWindow(); }, 2000);
  // 100 Hz while the cursor is anywhere near the bar (or it is open), 40 Hz while it is far away: idle wispy then costs a
  // quarter of the wakeups, and the first tick inside the near band still comes with plenty of distance left to react
  const pollLoop = () => { let fast = true; try { fast = pollCursor(); } catch (e) { /* keep polling */ } setTimeout(pollLoop, fast ? 10 : 25); };
  pollLoop();
}

function pollCursor() {
  if (!win || win.isDestroyed()) return false;
  const p = screen.getCursorScreenPoint();
  if (cfg.monitor === 'follow' && !barOpen) {
    // hop to another screen only when the cursor touches its bottom edge, never mid-use
    const d = screen.getDisplayNearestPoint(p);
    if (d.id !== targetDisplay().id && p.y >= d.bounds.y + d.bounds.height - 4) { followId = d.id; placeSoon(); }
  }
  const b = win.getBounds();
  let x = p.x - b.x, y = p.y - b.y;
  const inside = x >= 0 && x < b.width && y >= 0 && y < b.height;
  if (!inside) { x = -1; y = -1; }
  const key = x + ',' + y;
  const near = barOpen || fullscreen === false && inside && y > b.height - 380;
  if (key === lastCursor) return near;
  lastCursor = key;
  toRenderer('cursor', x, y);
  return near;
}

async function takeFocus() {
  win.setFocusable(true);
  const hwnd = Number(win.getNativeWindowHandle().readBigUInt64LE(0));
  send({ cmd: 'focus', hwnd });
  win.focus();
  win.webContents.focus();
  hasFocus = true;
}

async function openFromKey() {
  if (fullscreen) return;
  await takeFocus();
  toRenderer('win-key');
}

ipcMain.on('interactive', (_e, v) => {
  if (v === interactive || !win) return;
  interactive = v;
  win.setIgnoreMouseEvents(!v);
});

ipcMain.handle('focus-me', async () => {
  if (!hasFocus) {
    const r = await request({ cmd: 'fg' });
    const fg = r && r.hwnd;
    const mine = Number(win.getNativeWindowHandle().readBigUInt64LE(0));
    if (fg && fg !== mine) prevFg = fg;
    await takeFocus();
  }
  return true;
});

ipcMain.on('release', (_e, restore) => {
  if (!win) return;
  const had = hasFocus;
  hasFocus = false;
  win.setFocusable(false);
  if (had && restore !== false && prevFg) send({ cmd: 'focus', hwnd: prevFg });
});

// ---------------------------------------------------------------- pinned + dock
function pinnedDir() { return path.join(app.getPath('appData'), 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned'); }

// The taskbar's real pin order lives in a registry blob (Taskband\Favorites). Read it as bytes.
function readFavorites() {
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Taskband', '/v', 'Favorites'],
      { windowsHide: true, maxBuffer: 4e6 }, (err, so) => {
        const m = /REG_BINARY\s+([0-9A-Fa-f]+)/.exec(String(so || ''));
        resolve(m ? Buffer.from(m[1], 'hex') : null);
      });
  });
}

function lnkFiles(dir, depth) {
  let out = [];
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isFile() && /\.lnk$/i.test(e.name)) out.push(p);
    else if (e.isDirectory() && depth > 0) out = out.concat(lnkFiles(p, depth - 1));
  }
  return out;
}

async function readPinned() {
  const base = pinnedDir();
  const blob = await readFavorites();
  const ascii = blob ? blob.toString('latin1').toLowerCase() : '';
  // UTF-16 strings in the blob sit at odd and even byte offsets, so decode both alignments
  const wides = blob ? [blob.toString('utf16le').toLowerCase(), blob.subarray(1).toString('utf16le').toLowerCase()] : [];
  const find = (needle) => {
    const n = needle.toLowerCase();
    const cands = [];
    const a = ascii.indexOf(n);
    if (a >= 0) cands.push(a);
    wides.forEach((w, k) => { const i = w.indexOf(n); if (i >= 0) cands.push(i * 2 + k); });
    return cands.length ? Math.min(...cands) : -1;
  };

  const list = [];
  const seen = new Set();
  const files = lnkFiles(path.join(base, 'TaskBar'), 0).map((f) => ({ f, implicit: false }))
    .concat(lnkFiles(path.join(base, 'ImplicitAppShortcuts'), 2).map((f) => ({ f, implicit: true })));
  for (const { f, implicit } of files) {
    const file = path.basename(f);
    const nm = file.replace(/\.lnk$/i, '');
    const short = nm.replace(/[\s.]/g, '').slice(0, 6).toUpperCase() + '~1.lnk';
    let order = find(file);
    if (order < 0) order = find(short);
    if (implicit && order < 0) continue; // implicit shortcuts only count when the taskbar really pins them
    let d = {};
    try { d = shell.readShortcutLink(f); } catch (e) { /* keep empty */ }
    if (d.target && !fs.existsSync(d.target)) continue; // stale pin, nothing to launch
    const key = nm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const names = new Set();
    const add = (p) => { if (p) names.add(path.basename(String(p)).toLowerCase()); };
    add(d.target);
    if (d.icon && /\.exe$/i.test(d.icon)) add(d.icon);
    const m = /--processStart\s+"?([^"\s]+\.exe)/i.exec(d.args || '');
    if (m) add(m[1]);
    let mtime = 0;
    try { mtime = fs.statSync(f).mtimeMs; } catch (e) { /* ignore */ }
    list.push({ id: 'pin:' + key, name: nm, lnk: f, iconSrc: f, names: [...names], order: order >= 0 ? order : 1e9 + mtime });
  }

  // Store apps (Settings, Claude, WhatsApp, ...) are pinned by app id and have no .lnk file at all
  const re = /([a-z0-9][a-z0-9.\-]*)_([a-z0-9]{13})!([a-z0-9.\-_]+)/g;
  wides.forEach((w, k) => {
    let m;
    while ((m = re.exec(w))) {
      const aumid = m[0];
      const id = 'pin:' + aumid;
      const at = m.index * 2 + k;
      const prev = list.find((x) => x.id === id);
      if (prev) { prev.order = Math.min(prev.order, at); continue; }
      const known = appsIndex.find((a) => a.id.toLowerCase() === aumid);
      const nice = known ? known.name : m[3].split('.').pop().replace(/^./, (c) => c.toUpperCase());
      list.push({
        id, name: nice, aumid: known ? known.id : aumid, iconSrc: 'shell:AppsFolder\\' + (known ? known.id : aumid),
        names: [], pkg: { name: m[1], pub: m[2] }, order: at,
      });
    }
  });
  windowsPins = list.sort((a, b) => a.order - b.order);
  pinned = applyUserPins(windowsPins);
}

// ---------------------------------------------------------------- wispy's own pins
// Windows has no API for other apps to pin to its taskbar, so pins added or removed in wispy
// live in pins.json and are layered over the pins Windows already has.
let windowsPins = [];
const pinsFile = path.join(app.getPath('userData'), 'pins.json');
let userPins = { add: [], hide: [], order: [] };
try { const j = JSON.parse(fs.readFileSync(pinsFile, 'utf8')); userPins = { add: j.add || [], hide: j.hide || [], order: j.order || [] }; } catch (e) { /* none yet */ }
function savePins() { try { fs.writeFileSync(pinsFile, JSON.stringify(userPins, null, 1)); } catch (e) { /* ignore */ } }

const linkInfo = new Map();
function lnkNames(lnk) {
  if (linkInfo.has(lnk)) return linkInfo.get(lnk);
  const names = new Set();
  let d = {};
  try { d = shell.readShortcutLink(lnk); } catch (e) { /* not a shortcut */ }
  const add = (p) => { if (p) names.add(path.basename(String(p)).toLowerCase()); };
  add(d.target);
  if (d.icon && /\.exe$/i.test(d.icon)) add(d.icon);
  const m = /--processStart\s+"?([^"\s]+\.exe)/i.exec(d.args || '');
  if (m) add(m[1]);
  const r = { names: [...names], target: d.target || '' };
  linkInfo.set(lnk, r);
  return r;
}

function pinFromSpec(a) {
  if (!a) return null;
  if (a.lnk) return { id: 'pin+:' + a.lnk.toLowerCase(), name: a.name, lnk: a.lnk, iconSrc: a.lnk, names: lnkNames(a.lnk).names, user: true };
  if (a.aumid) {
    const m = /^([^_!]+)_([a-z0-9]{13})!/i.exec(a.aumid);
    return { id: 'pin+:' + a.aumid.toLowerCase(), name: a.name, aumid: a.aumid, iconSrc: 'shell:AppsFolder\\' + a.aumid, names: [], pkg: m ? { name: m[1].toLowerCase(), pub: m[2].toLowerCase() } : null, user: true };
  }
  if (a.exe) return { id: 'pin+:' + a.exe.toLowerCase(), name: a.name, exe: a.exe, iconSrc: a.exe, names: [path.basename(a.exe).toLowerCase()], user: true };
  return null;
}
function samePin(p, q) {
  if (p.aumid && q.aumid) return p.aumid.toLowerCase() === q.aumid.toLowerCase();
  return p.names.some((n) => q.names.includes(n));
}
function applyUserPins(list) {
  const out = list.filter((p) => !userPins.hide.includes(p.id));
  for (const a of userPins.add) {
    const p = pinFromSpec(a);
    if (p && !out.some((x) => samePin(x, p))) out.push(p);
  }
  // the user's own arrangement wins; anything not in it keeps Windows' order after it
  const ord = userPins.order || [];
  const idx = (p) => { const i = ord.indexOf(p.id); return i < 0 ? 1e6 : i; };
  return out.map((p, i) => ({ p, i })).sort((a, b) => (idx(a.p) - idx(b.p)) || (a.i - b.i)).map((x) => x.p);
}
ipcMain.on('pin-order', async (_e, ids) => {
  userPins.order = (ids || []).filter((x) => typeof x === 'string');
  savePins();
  await readPinned(); pushDock();
});
function isPinnedSpec(spec) { const p = pinFromSpec(spec); return !!p && pinned.some((x) => samePin(x, p)); }
async function pinSpec(spec) {
  const p = pinFromSpec(spec);
  if (!p || pinned.some((x) => samePin(x, p))) return;
  const hidden = windowsPins.find((w) => userPins.hide.includes(w.id) && samePin(w, p));
  if (hidden) userPins.hide = userPins.hide.filter((h) => h !== hidden.id);
  else userPins.add.push(spec);
  savePins();
  await readPinned(); pushDock();
}
async function unpinId(id) {
  if (id.startsWith('pin+:')) userPins.add = userPins.add.filter((a) => { const p = pinFromSpec(a); return !p || p.id !== id; });
  else if (!userPins.hide.includes(id)) userPins.hide.push(id);
  savePins();
  await readPinned(); pushDock();
}
async function unpinSpec(spec) {
  const p = pinFromSpec(spec);
  const hit = p && pinned.find((x) => samePin(x, p));
  if (hit) await unpinId(hit.id);
}

function pinMatches(p, exe) {
  const low = String(exe).toLowerCase();
  if (p.names.includes(path.basename(low))) return true;
  if (p.pkg) return new RegExp('\\\\windowsapps\\\\' + p.pkg.name.replace(/[.\-]/g, '\\$&') + '_[^\\\\]*__' + p.pkg.pub + '\\\\').test(low);
  return false;
}

function launchPin(p) {
  if (p.lnk) shell.openPath(p.lnk);
  else if (p.exe) shell.openPath(p.exe);
  else spawn('explorer.exe', ['shell:AppsFolder\\' + p.aumid], { detached: true, stdio: 'ignore' }).unref();
}

function iconKey(src) { return crypto.createHash('sha1').update('v3|' + src).digest('hex').slice(0, 16); }

function iconUrl(src, key, hwnd) {
  const k = key || src;
  if (iconCache.has(k)) return iconCache.get(k);
  if (!iconInflight.has(k)) {
    const out = path.join(iconDir, iconKey(k) + '.png');
    const p = (async () => {
      if (!fs.existsSync(out)) {
        const r = await request({ cmd: 'icon', path: src, size: 128, out, hwnd: hwnd || 0 });
        if (!r || !r.ok) return null;
      }
      const url = 'file:///' + out.replace(/\\/g, '/') + '?v=1';
      iconCache.set(k, url);
      return url;
    })().finally(() => iconInflight.delete(k));
    iconInflight.set(k, p);
    p.then((u) => { if (u) pushDock(); });
  }
  return null;
}

function prettyExe(exe) {
  const b = path.basename(exe).replace(/\.exe$/i, '');
  return b.charAt(0).toUpperCase() + b.slice(1);
}

function shortTitle(t) { const s = String(t || '').split(/ [-–—|] /).pop().trim(); return s.length > 24 ? '' : s; }

let dockModel = [];
const winBrief = (wins) => (wins.length > 1 ? wins.map((w) => ({ hwnd: w.hwnd, title: w.title, min: !!w.min })) : undefined);
// a window belongs to a pin by exe, by package, or (UWP apps inside Windows' app frame, like Settings) by AUMID
function pinWins(p) { return runWin.filter((w) => (w.aumid && p.aumid && w.aumid === p.aumid.toLowerCase()) || pinMatches(p, w.exe) || (w.home && pinMatches(p, w.home))); }

function buildDock() {
  const claimed = new Set();
  const items = pinned.map((p) => {
    const wins = pinWins(p);
    wins.forEach((w) => claimed.add(w.hwnd));
    return {
      id: p.id, name: p.name, pinned: true, icon: iconUrl(p.iconSrc),
      running: wins.length, active: wins.some((w) => w.hwnd === fgHwnd && !w.min), wins: winBrief(wins),
    };
  });
  const byExe = new Map();
  for (const w of runWin) {
    if (claimed.has(w.hwnd)) continue;
    const b = path.basename(w.home || w.exe).toLowerCase();   // a window belongs to its home program (steamwebhelper.exe -> steam.exe)
    if (!byExe.has(b)) byExe.set(b, []);
    byExe.get(b).push(w);
  }
  const extra = [];
  for (const [b, wins] of byExe) {
    extra.push({
      id: 'run:' + b, name: (wins[0].name && !/^\w+\.\w+$/.test(wins[0].name) ? wins[0].name : '') || shortTitle(wins[0].title) || prettyExe(wins[0].exe), pinned: false,
      icon: iconUrl(wins[0].home || wins[0].exe, null, wins[0].home ? 0 : wins[0].hwnd),
      running: wins.length, active: wins.some((w) => w.hwnd === fgHwnd && !w.min), wins: winBrief(wins),
    });
  }
  dockModel = items.concat(extra);
  return dockModel;
}

let lastDock = '';
function pushDock() {
  const m = buildDock();
  const s = JSON.stringify(m);
  if (s === lastDock) return;
  lastDock = s;
  toRenderer('dock', m);
}

function winsFor(id) {
  if (id.startsWith('run:')) {
    const b = id.slice(4);
    return runWin.filter((w) => path.basename(w.home || w.exe).toLowerCase() === b);
  }
  const p = pinned.find((x) => x.id === id);
  if (!p) return [];
  return pinWins(p);
}

ipcMain.on('dock-click', (_e, id, mod) => {
  const wins = winsFor(id);
  const p = pinned.find((x) => x.id === id);
  if (mod === 'new' && p) { launchPin(p); return; }
  if (wins.length) {
    // Windows keeps reporting a minimised window as the foreground one, so only a window that is not minimised is "active"
    const activeIdx = wins.findIndex((w) => w.hwnd === fgHwnd && !w.min);
    if (activeIdx >= 0) {
      if (wins.length > 1) focusWin(wins[(activeIdx + 1) % wins.length]);
      else minimizeWin(wins[0]);
    } else {
      focusWin(wins.find((w) => !w.min) || wins[0]);
    }
  } else if (p) {
    launchPin(p);
  }
});

// do it, and update what we believe straight away: the helper's next report can be a few tens of ms away, and a second
// click in that gap must see the new state, not the old one
function focusWin(w) { send({ cmd: 'focus', hwnd: w.hwnd }); w.min = false; fgHwnd = w.hwnd; pushDock(); }
function minimizeWin(w) { send({ cmd: 'minimize', hwnd: w.hwnd }); w.min = true; pushDock(); }
ipcMain.on('window-focus', (_e, hwnd) => { const w = runWin.find((x) => x.hwnd === hwnd); if (w) focusWin(w); else send({ cmd: 'focus', hwnd }); });
ipcMain.on('window-close', (_e, hwnd) => { const w = runWin.find((x) => x.hwnd === hwnd); if (w) closeWindows([w], w.name || prettyExe(w.exe), null); });
ipcMain.on('dock-close', (_e, id) => { for (const w of winsFor(id)) send({ cmd: 'close', hwnd: w.hwnd }); });

// right-click on a dock app: the same choices the Windows taskbar gives
function dockTarget(id) {
  const wins = winsFor(id);
  const p = pinned.find((x) => x.id === id);
  const exe = p ? (p.exe || (p.lnk && lnkNames(p.lnk).target) || (wins[0] && wins[0].exe) || '') : (wins[0] && wins[0].exe) || '';
  return { wins, p, exe };
}
ipcMain.handle('app-menu', (_e, id) => {
  const { wins, p, exe } = dockTarget(id);
  const item = dockModel.find((d) => d.id === id) || {};
  return {
    name: item.name || (p && p.name) || prettyExe(exe), icon: item.icon || null, pinned: !!p, running: wins.length,
    canAdmin: !!(exe || (p && p.lnk)) && !(p && p.aumid), canLocation: !!(exe || (p && p.lnk)), canEnd: canEnd(wins),
  };
});
// Close the way a taskbar does (WM_CLOSE), fall back to the system close command if the window
// ignores it, and tell the user when an app still didn't go (waiting on a "save?" prompt, say).
const stillOpen = (hwnds) => runWin.some((w) => hwnds.includes(w.hwnd));
function closeWindows(wins, name, id) {
  const hwnds = wins.map((w) => w.hwnd);
  if (!hwnds.length) return;
  hwnds.forEach((h) => send({ cmd: 'close', hwnd: h }));
  setTimeout(() => { if (stillOpen(hwnds)) hwnds.forEach((h) => send({ cmd: 'sysclose', hwnd: h })); }, 900);
  setTimeout(() => {
    if (!stillOpen(hwnds)) return;
    const left = runWin.filter((w) => hwnds.includes(w.hwnd));
    toRenderer('close-failed', { id, name, canEnd: canEnd(left) });
  }, 2600);
}
const canEnd = (wins) => wins.length > 0 && wins.every((w) => path.basename(w.exe).toLowerCase() !== 'explorer.exe');
function endTask(wins) {
  if (!canEnd(wins)) return;
  const pids = [...new Set(wins.map((w) => w.pid).filter((p) => p && p !== process.pid))];
  pids.forEach((pid) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {}));
}

ipcMain.on('app-action', async (_e, id, act) => {
  const { wins, p, exe } = dockTarget(id);
  const item = dockModel.find((d) => d.id === id) || {};
  const name = item.name || (p && p.name) || prettyExe(exe);
  switch (act) {
    case 'new': if (p) launchPin(p); else if (exe) shell.openPath(exe); break;
    case 'admin': send({ cmd: 'shellExec', path: (p && (p.lnk || p.exe)) || exe, verb: 'runas' }); break;
    case 'location': shell.showItemInFolder(exe || (p && p.lnk)); break;
    case 'pin': if (exe) pinSpec({ exe, name }); break;
    case 'unpin': if (p) unpinId(p.id); break;
    case 'close': { const w = wins.find((x) => x.hwnd === fgHwnd) || wins[0]; if (w) closeWindows([w], name, id); break; }
    case 'closeAll': closeWindows(wins, name, id); break;
    case 'end': endTask(wins); break;
  }
});

// ---------------------------------------------------------------- search
function loadApps() {
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-StartApps | ConvertTo-Json -Compress'],
    { windowsHide: true, maxBuffer: 8e6 }, (err, so) => {
      if (err) return;
      try {
        let a = JSON.parse(so);
        if (!Array.isArray(a)) a = [a];
        const seen = new Set();
        appsIndex = a.filter((x) => x && x.Name && x.AppID).filter((x) => {
          const k = x.Name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true;
        }).map((x) => ({ name: x.Name, id: x.AppID }));
      } catch (e) { /* keep old index */ }
      indexStartMenu();
      readPinned().then(pushDock);
    });
}

// Start Menu shortcuts by name: what "Run as administrator" and "Open file location" act on
let startLinks = new Map();
function indexStartMenu() {
  const dirs = [
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ];
  const map = new Map();
  for (const d of dirs) for (const f of lnkFiles(d, 4)) {
    const k = path.basename(f, '.lnk').toLowerCase();
    if (!map.has(k)) map.set(k, f);
  }
  startLinks = map;
}
// Get-StartApps writes some desktop apps as {KNOWNFOLDER}\path\app.exe
const KNOWN_FOLDERS = {
  '{6D809377-6AF0-444B-8957-A3773F02200E}': process.env.ProgramFiles,
  '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}': process.env['ProgramFiles(x86)'],
  '{F38BF404-1D43-42F2-9305-67DE0B28FC23}': process.env.windir,
  '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}': process.env.windir && path.join(process.env.windir, 'System32'),
  '{D65231B0-B2F1-4857-A4CE-A8E7C6EA7D27}': process.env.windir && path.join(process.env.windir, 'SysWOW64'),
};
function appSpec(a) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(a.id)) return null; // web links in the Start list aren't apps
  const lnk = startLinks.get(a.name.toLowerCase());
  if (lnk) return { lnk, name: a.name };
  if (/![\w.-]+$/.test(a.id) && /_[a-z0-9]{13}!/i.test(a.id)) return { aumid: a.id, name: a.name };
  const m = /^(\{[0-9A-F-]+\})\\(.+\.exe)$/i.exec(a.id);
  if (m && KNOWN_FOLDERS[m[1].toUpperCase()]) return { exe: path.join(KNOWN_FOLDERS[m[1].toUpperCase()], m[2]), name: a.name };
  if (/^[a-z]:\\.+\.exe$/i.test(a.id)) return { exe: a.id, name: a.name };
  return { aumid: a.id, name: a.name };
}
const RUNNABLE = /\.(exe|bat|cmd|msi|lnk)$/i;

function score(q, name) {
  const n = name.toLowerCase();
  if (n === q) return 100;
  if (n.startsWith(q)) return 90 - Math.min(n.length, 40) * 0.1;
  if (n.includes(' ' + q) || n.includes('-' + q)) return 74;
  if (n.includes(q)) return 55;
  let i = 0;
  for (const c of n) if (c === q[i]) i++;
  return i === q.length && q.length >= 3 && n.length <= q.length * 2 + 4 ? 28 : 0;
}

const POWER_CMDS = [
  ['Lock', 'lock', 'lock screen'], ['Sign out', 'signout', 'log off logout'], ['Sleep', 'sleep', 'suspend'],
  ['Restart', 'restart', 'reboot'], ['Shut down', 'shutdown', 'power off turn off'],
];
ipcMain.handle('search', async (_e, rawQ, seq) => {
  const q = String(rawQ || '').trim().toLowerCase();
  searchSeq = seq;
  if (!q) return { seq, items: [] };
  const apps = appsIndex.map((a) => ({ s: score(q, a.name), a })).filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s).slice(0, 5)
    .map(({ s, a }) => {
      const spec = appSpec(a);
      const desktop = !!(spec && (spec.lnk || spec.exe));
      return {
        kind: 'app', title: a.name, sub: 'App', id: a.id, s, iconSrc: 'shell:AppsFolder\\' + a.id, iconKey: 'app:' + a.id,
        spec, pinned: spec ? isPinnedSpec(spec) : false, canAdmin: desktop, canLocation: desktop,
      };
    });
  const cmds = POWER_CMDS.map(([title, cmd, kw]) => ({ s: Math.max(score(q, title), score(q, kw) * 0.85), title, cmd }))
    .filter((x) => x.s >= 55 && q.length >= 3).sort((x, y) => y.s - x.s).slice(0, 2)
    .map(({ s, title, cmd }) => ({ kind: 'command', title, sub: 'Power', cmd, s }));
  const sets = SETTINGS.map(([title, uri, kw]) => ({ s: Math.max(score(q, title), score(q, kw || '') * 0.8), title, uri }))
    .filter((x) => x.s > 0).sort((x, y) => y.s - x.s).slice(0, 3)
    .map(({ s, title, uri }) => ({ kind: 'setting', title, sub: 'Settings', uri, s }));
  // system folders (Recycle Bin, This PC, Downloads...) and built-in tools (Task Manager, Device Manager...)
  const have = new Set(apps.map((a) => a.title.toLowerCase()));
  const sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const extra = [
    ...PLACES.places.map(([title, target, kw]) => ({ s: Math.max(score(q, title), score(q, kw || '') * 0.8), title, kind: 'place', target })),
    ...PLACES.tools.map(([title, exe, kw]) => ({ s: Math.max(score(q, title), score(q, kw || '') * 0.8), title, kind: 'tool', exe })),
  ].filter((x) => x.s > 0 && !have.has(x.title.toLowerCase())).sort((x, y) => y.s - x.s).slice(0, 3)
    .map((x) => x.kind === 'place'
      ? { kind: 'place', title: x.title, sub: 'Folder', target: x.target, s: x.s }
      : { kind: 'tool', title: x.title, sub: 'Windows tool', exe: x.exe, path: x.exe, s: x.s, canAdmin: true, iconSrc: path.join(sys32, /\.msc$/i.test(x.exe) ? 'mmc.exe' : x.exe), iconKey: 'tool:' + x.exe });
  // ask the Windows index for files in parallel; results come back as an event
  if (q.length >= 2) {
    request({ cmd: 'search', q }).then((r) => {
      if (!r || seq !== searchSeq) return;
      const files = (r.items || []).map((f) => {
        const isDir = f.type === 'Directory' || f.type === 'File folder' || !/\.[^.\\]+$/.test(f.path);
        const ext = isDir ? 'folder' : path.extname(f.path).toLowerCase();
        const runnable = !isDir && RUNNABLE.test(f.path);
        const spec = runnable ? (/\.lnk$/i.test(f.path) ? { lnk: f.path, name: f.name.replace(/\.lnk$/i, '') } : /\.exe$/i.test(f.path) ? { exe: f.path, name: f.name.replace(/\.exe$/i, '') } : null) : null;
        return {
          kind: 'file', title: f.name, sub: f.path.replace(/^C:\\Users\\[^\\]+/i, '~'), path: f.path, isDir,
          s: score(q, f.name), iconSrc: f.path, iconKey: /\.(exe|lnk)$/i.test(f.path) ? f.path : 'ext:' + ext,
          canAdmin: runnable, spec, pinned: spec ? isPinnedSpec(spec) : false,
        };
      }).filter((f) => f.s > 0).sort((x, y) => y.s - x.s)
        .filter((f, i, a) => a.findIndex((g) => g.title.toLowerCase() === f.title.toLowerCase()) === i).slice(0, 5);
      toRenderer('search-files', seq, files);
    });
  }
  return { seq, items: [...apps, ...extra, ...cmds, ...sets] };
});

function openResult(r) {
  try {
    if (r.kind === 'app') spawn('explorer.exe', ['shell:AppsFolder\\' + r.id], { detached: true, stdio: 'ignore' }).unref();
    else if (r.kind === 'setting') shell.openExternal(r.uri);
    else if (r.kind === 'file') shell.openPath(r.path);
    else if (r.kind === 'place') spawn('explorer.exe', [r.target], { detached: true, stdio: 'ignore' }).unref();
    else if (r.kind === 'tool') spawn('cmd.exe', ['/c', 'start', '', r.exe], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else if (r.kind === 'web') shell.openExternal((ENGINES[cfg.searchEngine] || ENGINES.google) + encodeURIComponent(r.query));
  } catch (e) { /* ignore */ }
}
ipcMain.on('open-result', (_e, r) => openResult(r));

// the right-hand actions in search, same set Windows search offers
ipcMain.handle('result-action', async (_e, r, act) => {
  const spec = r.spec || null;
  const target = (spec && (spec.lnk || spec.exe)) || r.path;
  switch (act) {
    case 'open': openResult(r); break;
    case 'admin': if (target) send({ cmd: 'shellExec', path: target, verb: 'runas' }); break;
    case 'location': if (target) shell.showItemInFolder(target); break;
    case 'pin': await pinSpec(spec); return { pinned: isPinnedSpec(spec) };
    case 'unpin': await unpinSpec(spec); return { pinned: isPinnedSpec(spec) };
    case 'uninstall': shell.openExternal('ms-settings:appsfeatures'); break;
    case 'openwith': send({ cmd: 'shellExec', path: r.path, verb: 'openas' }); break;
    case 'copypath': clipboard.writeText(r.path); break;
    case 'terminal': {
      const t = spawn('wt.exe', ['-d', r.path], { detached: true, stdio: 'ignore' });
      t.on('error', () => spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', 'cd', '/d', r.path], { detached: true, stdio: 'ignore' }).unref());
      t.unref();
      break;
    }
  }
  return { ok: true };
});

ipcMain.handle('icon', async (_e, src, key) => {
  const k = key || src;
  if (iconCache.has(k)) return iconCache.get(k);
  const out = path.join(iconDir, iconKey(k) + '.png');
  if (!fs.existsSync(out)) {
    const r = await request({ cmd: 'icon', path: src, size: 128, out });
    if (!r || !r.ok) return null;
  }
  const url = 'file:///' + out.replace(/\\/g, '/') + '?v=1';
  iconCache.set(k, url);
  return url;
});


// ---------------------------------------------------------------- notifications
// Windows keeps every toast it shows in wpndatabase.db. Watch it and mirror new ones as wispy banners.
const wpnDir = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Notifications');
const notifs = new Map();
let lastNotifId = -1, wpnSig = '';

const decodeXml = (t) => String(t).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
  .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(+n))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();

async function iconFile(src, key) {
  const k = key || src;
  if (iconCache.has(k)) return iconCache.get(k);
  const out = path.join(iconDir, iconKey(k) + '.png');
  if (!fs.existsSync(out)) {
    const r = await request({ cmd: 'icon', path: src, size: 128, out });
    if (!r || !r.ok) return null;
  }
  const url = 'file:///' + out.replace(/\\/g, '/') + '?v=1';
  iconCache.set(k, url);
  return url;
}

function parseToast(xml) {
  const texts = [...xml.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)].map((m) => decodeXml(m[1])).filter(Boolean);
  if (!texts.length) return null;
  const attr = (n) => { const m = new RegExp('<toast\\b[^>]*?\\b' + n + '="([^"]*)"', 'i').exec(xml); return m ? decodeXml(m[1]) : ''; };
  return { title: texts[0], body: texts.slice(1, 3).join('\n'), launch: attr('launch'), activation: attr('activationType') };
}

function pollNotifs() {
  let sig = '';
  try { sig = ['wpndatabase.db', 'wpndatabase.db-wal'].map((f) => fs.statSync(path.join(wpnDir, f)).mtimeMs).join('|'); } catch (e) { return; }
  if (sig === wpnSig) return;
  const tmp = path.join(os.tmpdir(), 'wispy-wpn');
  let db;
  try {
    fs.mkdirSync(tmp, { recursive: true });
    for (const f of ['wpndatabase.db', 'wpndatabase.db-wal', 'wpndatabase.db-shm']) {
      const to = path.join(tmp, f);
      try { fs.copyFileSync(path.join(wpnDir, f), to); } catch (e) { fs.rmSync(to, { force: true }); }
    }
    db = new DatabaseSync(path.join(tmp, 'wpndatabase.db'), { readOnly: true });
    if (lastNotifId < 0) {
      lastNotifId = (db.prepare('select max(Id) m from Notification').get().m) || 0; // only what arrives from now on
      wpnSig = sig;
      return;
    }
    const rows = db.prepare("select n.Id id, cast(n.ExpiryTime as text) ex, n.Payload p, h.PrimaryId app from Notification n left join NotificationHandler h on h.RecordId = n.HandlerId where n.Type = 'toast' and n.Id > ? order by n.Id").all(lastNotifId);
    wpnSig = sig;
    for (const r of rows) {
      lastNotifId = Math.max(lastNotifId, r.id);
      let xml = '';
      try { xml = Buffer.from(r.p).toString('utf8'); } catch (e) { continue; }
      const t = parseToast(xml);
      if (!t || fullscreen) continue;
      try { if (r.ex && Number(BigInt(r.ex) / 10000n) - 11644473600000 < Date.now()) continue; } catch (e) { /* no expiry */ }
      emitNotif(r.id, r.app || '', t);
    }
  } catch (e) {
    wpnSig = ''; // a torn copy; try again next tick
  } finally {
    try { if (db) db.close(); } catch (e) { /* ignore */ }
  }
}

// today's notifications, kept on disk so they survive a restart; a new day starts empty
const histFile = path.join(app.getPath('userData'), 'notifications.json');
const today = () => new Date().toLocaleDateString('en-CA');
let history = { day: today(), items: [] };
try { const h = JSON.parse(fs.readFileSync(histFile, 'utf8')); if (h && h.day === today() && Array.isArray(h.items)) history = h; } catch (e) { /* first run */ }
function saveHistory() { try { fs.writeFileSync(histFile, JSON.stringify(history)); } catch (e) { /* ignore */ } }
function currentHistory() {
  if (history.day !== today()) { history = { day: today(), items: [] }; saveHistory(); toRenderer('history', []); }
  return history.items;
}

async function emitNotif(id, appId, t) {
  const known = appsIndex.find((a) => a.id.toLowerCase() === appId.toLowerCase());
  const name = known ? known.name : (appId.split('!')[0].split('_')[0].split('.').pop() || 'Notification');
  const icon = known ? await iconFile('shell:AppsFolder\\' + known.id, 'app:' + known.id) : null;
  const rec = { id, app: name, icon, title: t.title, body: t.body, time: Date.now(), appId: known ? known.id : appId, launch: t.launch, activation: t.activation };
  notifs.set(id, rec);
  if (notifs.size > 40) notifs.delete(notifs.keys().next().value);
  const items = currentHistory();
  items.unshift(rec);
  if (items.length > 60) items.length = 60;
  saveHistory();
  toRenderer('notify', { id, app: name, icon, title: t.title, body: t.body, silent: !!cfg.dnd });
  toRenderer('history', items);
  send({ cmd: 'bannersOff' }); // a brand-new app gets its Windows banner turned off from now on
}

ipcMain.handle('history', () => currentHistory());
ipcMain.on('history-clear', (_e, id) => {
  history.items = id == null ? [] : currentHistory().filter((x) => x.id !== id);
  saveHistory();
  toRenderer('history', history.items);
});

ipcMain.on('notify-open', (_e, id) => {
  const n = notifs.get(id) || currentHistory().find((x) => x.id === id);
  if (!n) return;
  if (n.activation === 'protocol' && /^[a-z][a-z0-9+.-]*:/i.test(n.launch) && !/^(file|javascript|data|vbscript):/i.test(n.launch)) { shell.openExternal(n.launch); return; }
  // bring the app forward if it is running, otherwise start it
  const wins = pinned.filter((p) => p.aumid && p.aumid.toLowerCase() === String(n.appId).toLowerCase()).flatMap(pinWins);
  if (wins.length) send({ cmd: 'focus', hwnd: wins[0].hwnd });
  else if (n.appId) spawn('explorer.exe', ['shell:AppsFolder\\' + n.appId], { detached: true, stdio: 'ignore' }).unref();
});

// ---------------------------------------------------------------- quick settings
function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 20000, maxBuffer: 4e6 }, (e, so) => resolve({ e, out: String(so || '') }));
  });
}
const ps = (script, ...a) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'scripts', script), ...a]);

function field(text, name) {
  const m = new RegExp('^\\s*' + name + '\\s*:\\s*(.*)$', 'mi').exec(text);
  return m ? m[1].trim() : '';
}

ipcMain.handle('wifi', async () => {
  const { out } = await run('netsh', ['wlan', 'show', 'interfaces']);
  const state = field(out, 'State').toLowerCase();
  return { connected: state === 'connected', ssid: field(out, 'SSID'), signal: parseInt(field(out, 'Signal'), 10) || 0, present: /Name\s*:/i.test(out) };
});

ipcMain.handle('wifi-networks', async () => {
  const [net, prof, cur] = await Promise.all([
    run('netsh', ['wlan', 'show', 'networks', 'mode=bssid']),
    run('netsh', ['wlan', 'show', 'profiles']),
    run('netsh', ['wlan', 'show', 'interfaces']),
  ]);
  const known = new Set(prof.out.split(/\r?\n/).map((l) => /All User Profile\s*:\s*(.+)$/i.exec(l)).filter(Boolean).map((m) => m[1].trim()));
  const connected = field(cur.out, 'SSID');
  const map = new Map();
  let curNet = null;
  for (const line of net.out.split(/\r?\n/)) {
    let m = /^SSID\s+\d+\s*:\s*(.*)$/.exec(line.trim());
    if (m) { curNet = { ssid: m[1].trim(), secured: true, signal: 0 }; if (curNet.ssid) map.set(curNet.ssid, curNet); else curNet = null; continue; }
    if (!curNet) continue;
    m = /^Authentication\s*:\s*(.*)$/.exec(line.trim());
    if (m) { curNet.auth = m[1].trim(); curNet.secured = !/open/i.test(m[1]); curNet.enterprise = /enterprise|802\.1x/i.test(m[1]); continue; }
    m = /^Signal\s*:\s*(\d+)%/.exec(line.trim());
    if (m) curNet.signal = Math.max(curNet.signal, parseInt(m[1], 10));
  }
  return [...map.values()].map((n) => ({ ...n, known: known.has(n.ssid), connected: n.ssid === connected }))
    .sort((a, b) => (b.connected - a.connected) || (b.signal - a.signal)).slice(0, 12);
});

ipcMain.handle('wifi-connect', async (_e, ssid) => {
  const r = await run('netsh', ['wlan', 'connect', 'name=' + ssid, 'ssid=' + ssid]);
  return !r.e;
});

const xmlEsc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
async function currentSsid() {
  const { out } = await run('netsh', ['wlan', 'show', 'interfaces']);
  return field(out, 'State').toLowerCase() === 'connected' ? field(out, 'SSID') : '';
}

// Join a network the way the flyout does: saved/open networks connect directly; new secured
// networks get a profile built from the key, which is removed again if the key turns out wrong.
ipcMain.handle('wifi-join', async (_e, ssid, password, auth) => {
  let created = false;
  if (password != null) {
    const sae = /wpa3/i.test(auth || '');
    const open = !password;
    const xml = `<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>${xmlEsc(ssid)}</name>
  <SSIDConfig><SSID><name>${xmlEsc(ssid)}</name></SSID></SSIDConfig>
  <connectionType>ESS</connectionType>
  <connectionMode>auto</connectionMode>
  <MSM><security>
    <authEncryption><authentication>${open ? 'open' : sae ? 'WPA3SAE' : /wpa2|wpa3/i.test(auth || 'wpa2') ? 'WPA2PSK' : 'WPAPSK'}</authentication><encryption>${open ? 'none' : 'AES'}</encryption><useOneX>false</useOneX></authEncryption>
    ${open ? '' : `<sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>${xmlEsc(password)}</keyMaterial></sharedKey>`}
  </security></MSM>
</WLANProfile>`;
    const file = path.join(os.tmpdir(), 'wispy-wlan-' + crypto.randomBytes(6).toString('hex') + '.xml');
    try {
      fs.writeFileSync(file, xml);
      const r = await run('netsh', ['wlan', 'add', 'profile', 'filename=' + file, 'user=current']);
      created = !r.e;
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (e) { /* ignore */ }
    }
    if (!created) return { ok: false, error: 'Couldn’t save this network' };
  }
  await run('netsh', ['wlan', 'connect', 'name=' + ssid, 'ssid=' + ssid]);
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if ((await currentSsid()) === ssid) return { ok: true };
  }
  if (created) await run('netsh', ['wlan', 'delete', 'profile', 'name=' + ssid]);
  return { ok: false, error: password ? 'Couldn’t connect. Check the security key.' : 'Couldn’t connect' };
});

ipcMain.handle('wifi-disconnect', async () => { await run('netsh', ['wlan', 'disconnect']); return true; });

ipcMain.handle('bt-audio', async (_e, name, action) => {
  const r = await request({ cmd: 'btAudio', name, action });
  return !!(r && r.ok);
});

ipcMain.handle('radios', async () => {
  const { out } = await ps('radios.ps1', '-Action', 'get');
  try { const j = JSON.parse(out); return Array.isArray(j) ? j : [j]; } catch (e) { return []; }
});

ipcMain.handle('set-radio', async (_e, kind, on) => {
  const { out } = await ps('radios.ps1', '-Action', 'set', '-Kind', kind, '-State', on ? 'on' : 'off');
  try { const j = JSON.parse(out); return Array.isArray(j) ? j : [j]; } catch (e) { return []; }
});

ipcMain.handle('brightness', async () => {
  const { out } = await ps('brightness.ps1', '-Action', 'get');
  const n = parseInt(out.trim(), 10);
  return Number.isFinite(n) ? n : null;
});

let brightBusy = false, brightNext = null;
async function pumpBrightness() {
  if (brightBusy || brightNext === null) return;
  brightBusy = true;
  const v = brightNext; brightNext = null;
  await ps('brightness.ps1', '-Action', 'set', '-Value', String(v));
  brightBusy = false;
  pumpBrightness();
}
ipcMain.on('set-brightness', (_e, v) => { brightNext = Math.round(v); pumpBrightness(); });
ipcMain.on('volume', (_e, o) => send({ cmd: 'volume', ...o }));
ipcMain.on('open-settings', (_e, uri) => shell.openExternal(uri));

// power menu. WISPY_DRYRUN=1 only logs, so this can be tested without turning the PC off
ipcMain.on('power', (_e, act) => {
  const cmds = {
    lock: ['rundll32.exe', ['user32.dll,LockWorkStation']],
    signout: ['shutdown.exe', ['/l']],
    restart: ['shutdown.exe', ['/r', '/t', '0']],
    shutdown: ['shutdown.exe', ['/s', '/t', '0']],
  };
  if (process.env.WISPY_DRYRUN) { log('power (dry run): ' + act); return; }
  if (act === 'sleep') { send({ cmd: 'sleep' }); return; }
  const c = cmds[act];
  if (c) execFile(c[0], c[1], { windowsHide: true }, () => {});
});
ipcMain.on('shell-key', (_e, which) => send({ cmd: 'keys', combo: which }));
ipcMain.handle('menu-info', () => ({ login: app.getLoginItemSettings().openAtLogin, packaged: app.isPackaged }));
ipcMain.on('set-login', (_e, v) => { if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!v, path: process.execPath }); });
ipcMain.on('taskmgr', () => { spawn('taskmgr.exe', [], { detached: true, stdio: 'ignore' }).unref(); });
ipcMain.on('quit-app', () => app.quit());

// sound output + per-app volume, Bluetooth devices, input language, tray icons
ipcMain.handle('audio', async () => {
  const r = await request({ cmd: 'audio' });
  return r ? { devices: r.devices || [], apps: (r.apps || []).map((a) => ({ ...a })) } : { devices: [], apps: [] };
});
ipcMain.on('set-audio-device', (_e, devId) => send({ cmd: 'setAudioDevice', devId }));
ipcMain.on('set-app-volume', (_e, key, o) => send({ cmd: 'setAppVolume', key, ...o }));
ipcMain.handle('bt-devices', async () => {
  const { out } = await ps('bt.ps1');
  try { const j = JSON.parse(out); return Array.isArray(j) ? j : [j]; } catch (e) { return []; }
});
ipcMain.on('set-lang', (_e, key) => send({ cmd: 'setLangKey', key }));
ipcMain.on('tray-click', (_e, key, button) => send({ cmd: 'trayClick', key, button }));

ipcMain.handle('init', () => ({
  accent: accent(), dock: buildDock(), volume: lastVolume, packaged: app.isPackaged,
  lang: lastLang, tray: lastTray, history: currentHistory(), config: cfg,
}));

function accent() {
  try { return '#' + systemPreferences.getAccentColor().slice(0, 6); } catch (e) { return '#e4ebf3'; }
}
systemPreferences.on && systemPreferences.on('accent-color-changed', () => toRenderer('accent', accent()));

// ---------------------------------------------------------------- tray + lifecycle
function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(img);
  tray.setToolTip('wispy');
  const build = () => Menu.buildFromTemplate([
    { label: 'Open wispy', click: () => openFromKey() },
    { type: 'separator' },
    {
      label: 'Launch at login', type: 'checkbox', enabled: app.isPackaged,
      checked: app.getLoginItemSettings().openAtLogin,
      click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked, path: process.execPath }),
    },
    { type: 'separator' },
    { label: 'Restore Windows taskbar and quit', click: () => app.quit() },
  ]);
  tray.on('click', () => openFromKey());
  tray.on('right-click', () => tray.popUpContextMenu(build()));
}

app.on('before-quit', (e) => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();
  send({ cmd: 'quit' });
  const done = () => app.exit(0);
  if (helper) { helper.once('exit', done); setTimeout(done, 1500); } else done();
});

process.on('uncaughtException', (e) => { log('uncaught: ' + (e && e.stack || e)); });
process.on('unhandledRejection', (e) => { log('unhandled rejection: ' + (e && e.stack || e)); });
app.on('render-process-gone', (_e, _wc, d) => { log('renderer gone: ' + d.reason); if (win && !win.isDestroyed()) win.reload(); });
app.on('child-process-gone', (_e, d) => {
  log('child gone: ' + d.type + ' ' + d.reason);
  // a crashed GPU process leaves the transparent window frozen (nothing clickable): reload it
  if (d.type === 'GPU') setTimeout(() => { if (win && !win.isDestroyed()) win.reload(); }, 400);
});

app.whenReady().then(() => {
  log('start ' + app.getVersion());
  readPinned();
  startHelper();
  createWindow();
  setInterval(currentHistory, 60 * 1000);
  loadApps();
  setInterval(loadApps, 10 * 60 * 1000);
  setInterval(pollNotifs, 700);
  setInterval(() => readPinned().then(pushDock), 30 * 1000);
});

app.on('window-all-closed', () => { /* stay alive in the tray */ });
app.on('second-instance', () => openFromKey());
