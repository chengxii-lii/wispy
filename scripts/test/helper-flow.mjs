// Drives the real native helper (without hiding your taskbar) through open, focus, minimise, restore and close on a
// classic Win32 window (Character Map), and checks the window list follows within a fraction of a second.
//   node scripts/test/helper-flow.mjs [path\to\wispy-helper.exe]      (npm run test:helper)
// Windows only. Opens and closes Character Map; do not touch the mouse or keyboard while it runs.
import { spawn, execSync } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const helper = process.argv[2] || path.join(ROOT, 'helper', 'wispy-helper.exe');
const h = spawn(helper, ['--self', 'x:\\none.exe'], { stdio: ['pipe', 'pipe', 'inherit'] });
let last = null; const errors = [];
readline.createInterface({ input: h.stdout }).on('line', (l) => {
  try { const m = JSON.parse(l); if (m.ev === 'windows') last = m; if (m.ev === 'error') errors.push(m.msg); } catch { /* not json */ }
});
const send = (o) => h.stdin.write(JSON.stringify(o) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (re) => last && last.list.find((w) => re.test(w.exe));
const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return Date.now() - t0; await sleep(15); } return -1; };
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

await sleep(1500);
check('helper reports a window list', !!last);
execSync('powershell -NoProfile -Command "Start-Process charmap"');
let t = await waitFor(() => find(/charmap\.exe/i));
check('an opened window shows up', t >= 0, t >= 0 ? t + 'ms' : '');
const w = find(/charmap\.exe/i);
if (!w) { h.kill(); process.exit(1); }
const H = w.hwnd;

send({ cmd: 'focus', hwnd: H });
t = await waitFor(() => last.fg === H && !find(/charmap/i).min);
check('focus brings it to the front', t >= 0, t >= 0 ? t + 'ms' : 'fg=' + last.fg);

send({ cmd: 'minimize', hwnd: H });
t = await waitFor(() => find(/charmap/i) && find(/charmap/i).min);
check('minimise is reported', t >= 0 && t < 600, t + 'ms');

await sleep(80);
send({ cmd: 'focus', hwnd: H });
t = await waitFor(() => last.fg === H && find(/charmap/i) && !find(/charmap/i).min);
check('a minimised window restores and takes focus', t >= 0 && t < 1000, t + 'ms');

send({ cmd: 'minimize', hwnd: H });
await waitFor(() => find(/charmap/i).min);
await sleep(700);
send({ cmd: 'focus', hwnd: H });
t = await waitFor(() => last.fg === H && !find(/charmap/i).min);
check('and again after waiting', t >= 0, t + 'ms');

send({ cmd: 'close', hwnd: H });
t = await waitFor(() => !find(/charmap\.exe/i));
check('closing removes it from the list', t >= 0 && t < 600, t + 'ms');

check('no helper errors', errors.length === 0, errors.join('; '));
try { execSync('taskkill /F /IM charmap.exe', { stdio: 'ignore' }); } catch { /* already closed */ }
h.stdin.end(); await sleep(300); h.kill();
console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
