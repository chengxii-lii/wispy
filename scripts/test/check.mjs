// `npm test`: fast checks that need no browser and no Windows APIs, so they run anywhere and in CI.
// Every source file parses, the files the app needs are present, the version agrees everywhere, and the
// renderer's markup and script agree on the ids they share.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

for (const f of ['main.js', 'preload.js', 'settings-list.js', 'places-list.js', 'renderer/app.js', 'renderer/mock.js', 'scripts/art/render.mjs', 'scripts/art/cdp.mjs']) {
  check(`${f} parses`, () => {
    execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' });
  });
}

for (const f of ['package.json', 'renderer/index.html', 'renderer/style.css', 'helper/Helper.cs', 'helper/Extras.cs', 'helper/Extras2.cs',
  'assets/icon.ico', 'scripts/install.ps1', 'scripts/uninstall.ps1', 'scripts/restore-taskbar.ps1', 'scripts/build-helper.ps1', 'LICENSE', 'README.md', 'CHANGELOG.md']) {
  check(`${f} exists`, () => must(fs.existsSync(path.join(root, f)), 'missing'));
}

check('version matches the changelog', () => {
  const v = JSON.parse(read('package.json')).version;
  const top = /^## v(\S+)/m.exec(read('CHANGELOG.md'));
  must(top && top[1] === v, `package.json says ${v}, CHANGELOG starts at ${top && top[1]}`);
});

check('every id the renderer looks up exists in the markup', () => {
  const html = read('renderer/index.html');
  const js = read('renderer/app.js');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const made = new Set([...js.matchAll(/\.id = '([^']+)'/g)].map((m) => m[1])); // ids created in script
  const missing = [...new Set([...js.matchAll(/\$\('#([A-Za-z][\w-]*)'\)/g)].map((m) => m[1]))].filter((id) => !ids.has(id) && !made.has(id));
  must(!missing.length, 'not in index.html: ' + missing.join(', '));
});

check('every IPC channel the renderer calls is exposed by the preload', () => {
  const pre = read('preload.js');
  const exposed = new Set([...pre.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]));
  const called = new Set([...read('renderer/app.js').matchAll(/\btb\.(\w+)\(/g)].map((m) => m[1]));
  const missing = [...called].filter((n) => !exposed.has(n));
  must(!missing.length, 'tb.' + missing.join(', tb.') + ' not in preload.js');
});

check('the mock covers the whole preload API', () => {
  const exposed = [...read('preload.js').matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
  const mock = read('renderer/mock.js');
  const missing = exposed.filter((n) => !new RegExp(`\\b${n}\\s*[:(]`).test(mock));
  must(!missing.length, 'mock.js lacks: ' + missing.join(', '));
});

check('settings schema keys all have defaults', () => {
  const main = read('main.js');
  const defaults = /const DEFAULTS = \{([\s\S]*?)\};/.exec(main)[1];
  const keys = new Set([...defaults.matchAll(/(\w+):/g)].map((m) => m[1]));
  const used = [...read('renderer/app.js').matchAll(/\{ k: '(\w+)'/g)].map((m) => m[1]).filter((k) => k !== '__login');
  const missing = used.filter((k) => !keys.has(k));
  must(!missing.length, 'no default for: ' + missing.join(', '));
});

check('no personal paths in tracked sources', () => {
  for (const f of ['main.js', 'preload.js', 'renderer/app.js', 'scripts/install.ps1', 'README.md']) {
    must(!/C:\\Users\\[a-z]+\\/i.test(read(f)), `${f} mentions a user folder`);
  }
});

if (failures.length) {
  console.error(failures.map((f) => '  ✗ ' + f).join('\n'));
  console.error(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${passed} checks passed`);
