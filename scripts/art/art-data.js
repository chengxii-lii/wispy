// Injected into every page the art script opens, before the UI starts. It gives the real renderer a believable,
// brand-free desktop to draw: stand-in app icons, a few notifications, networks and devices. Nothing here
// ships in the app; renderer/mock.js picks up `window.__artOverrides` only when it is present.
(() => {
  // A fixed clock, so every shot says the same time.
  const FIXED = new Date(2026, 9, 20, 9, 41, 0).getTime();
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(FIXED); }
    static now() { return FIXED; }
  }
  window.Date = FixedDate;
  // inside the UI frame the real frame loop is stopped; art.step() moves everything by an exact amount
  if (window !== window.top) window.requestAnimationFrame = () => 0;
  navigator.getBattery = async () => ({ level: 0.82, charging: false, chargingTime: Infinity, dischargingTime: 12600, addEventListener() {} });
  try { localStorage.setItem('tb-hint', '1'); } catch (e) { /* storage unavailable */ }

  // App icons: soft gradient squircles with one white glyph each.
  const svg = (a, b, glyph) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>` +
    `<rect x="6" y="6" width="116" height="116" rx="30" fill="url(#g)"/><rect x="6.5" y="6.5" width="115" height="115" rx="29.5" fill="none" stroke="rgba(255,255,255,.28)"/>${glyph}</svg>`);
  const W = 'fill="#fff"', S = 'fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"';
  const ICONS = {
    files: svg('#ffd45e', '#ff9d2e', `<path d="M28 44a6 6 0 0 1 6-6h20l9 11h31a6 6 0 0 1 6 6v33a6 6 0 0 1-6 6H34a6 6 0 0 1-6-6z" ${W}/>`),
    browser: svg('#58a6ff', '#2457e6', `<circle cx="64" cy="64" r="34" ${S}/><path d="M82 46 71 71 46 82 57 57z" ${W}/>`),
    mail: svg('#5fd3ff', '#2e7bff', `<rect x="28" y="40" width="72" height="50" rx="9" ${S}/><path d="m32 47 32 24 32-24" ${S}/>`),
    messages: svg('#6ee7a1', '#12b45a', `<path d="M30 42a11 11 0 0 1 11-11h46a11 11 0 0 1 11 11v32a11 11 0 0 1-11 11H62L44 100V85h-3a11 11 0 0 1-11-11z" ${W}/>`),
    music: svg('#ff7aa8', '#e5304f', `<path d="M58 88V40l38-9v46" ${S}/><circle cx="46" cy="88" r="12" ${W}/><circle cx="84" cy="78" r="12" ${W}/>`),
    notes: svg('#ffe36b', '#f5b50f', `<rect x="32" y="30" width="64" height="68" rx="10" ${W}/><path d="M44 52h40M44 66h40M44 80h24" stroke="#f0a800" stroke-width="6" stroke-linecap="round"/>`),
    terminal: svg('#4b5563', '#111827', `<path d="m40 50 22 16-22 16" ${S}/><path d="M70 86h24" ${S}/>`),
    photos: svg('#ffffff', '#dfe7ff', ['#ff5a5f', '#ffb020', '#3ddc84', '#35a7ff', '#9b6bff'].map((c, i) =>
      `<ellipse cx="64" cy="40" rx="13" ry="24" fill="${c}" opacity=".82" transform="rotate(${i * 72} 64 64)"/>`).join('')),
    editor: svg('#8b7bff', '#4435d1', `<path d="m50 46-20 18 20 18M78 46l20 18-20 18" ${S}/>`),
    calendar: svg('#ffffff', '#e9eefc', `<rect x="26" y="34" width="76" height="68" rx="12" fill="#fff"/><path d="M26 56h76V46a12 12 0 0 0-12-12H38a12 12 0 0 0-12 12z" fill="#ff5a5f"/><text x="64" y="94" font-family="Geist,Segoe UI,sans-serif" font-size="34" font-weight="600" text-anchor="middle" fill="#1a1d29">20</text>`),
  };
  const dock = [
    { id: 'pin:files', name: 'Files', pinned: true, icon: ICONS.files, running: 2, active: false },
    { id: 'pin:browser', name: 'Browser', pinned: true, icon: ICONS.browser, running: 3, active: true, wins: [{ hwnd: 1, title: 'wisp · GitHub' }, { hwnd: 2, title: 'Release notes' }, { hwnd: 3, title: 'New tab' }] },
    { id: 'pin:mail', name: 'Mail', pinned: true, icon: ICONS.mail, running: 0, active: false },
    { id: 'pin:messages', name: 'Messages', pinned: true, icon: ICONS.messages, running: 1, active: false },
    { id: 'pin:music', name: 'Music', pinned: true, icon: ICONS.music, running: 1, active: false },
    { id: 'pin:notes', name: 'Notes', pinned: true, icon: ICONS.notes, running: 0, active: false },
    { id: 'pin:photos', name: 'Photos', pinned: true, icon: ICONS.photos, running: 0, active: false },
    { id: 'pin:calendar', name: 'Calendar', pinned: true, icon: ICONS.calendar, running: 0, active: false },
    { id: 'run:editor', name: 'Editor', pinned: false, icon: ICONS.editor, running: 1, active: false },
    { id: 'run:terminal', name: 'Terminal', pinned: false, icon: ICONS.terminal, running: 1, active: false },
  ];
  const ago = (m) => FIXED - m * 60000;
  const appList = [['Music', 'music'], ['Mail', 'mail'], ['Messages', 'messages'], ['Notes', 'notes'], ['Photos', 'photos'], ['Calendar', 'calendar'], ['Files', 'files'], ['Terminal', 'terminal'], ['Editor', 'editor'], ['Browser', 'browser']];
  const lc = (s) => s.toLowerCase();

  window.__artOverrides = {
    art: true,
    init: {
      accent: '#ff8a3d', dock, volume: { level: 64, muted: false },
      lang: { cur: 'ENG', list: [{ key: 'en', short: 'ENG', name: 'English (United States)', sub: 'US keyboard', cur: true }, { key: 'ja', short: 'JPN', name: 'Japanese', sub: 'Microsoft IME', cur: false }] },
      tray: ['#34d399', '#8b7bff', '#ffb020', '#35a7ff', '#ff5a5f'].map((c, i) => ({ key: 'k' + i, tip: 'Tray app ' + (i + 1), icon: svg(c, c, `<circle cx="64" cy="64" r="26" ${W}/>`) })),
      history: [
        { id: 11, app: 'Messages', icon: ICONS.messages, title: 'Maya', body: 'Are we still on for 7? I can grab the table by the window.', time: ago(4) },
        { id: 12, app: 'Calendar', icon: ICONS.calendar, title: 'Design review in 10 minutes', body: 'Room 204', time: ago(9) },
        { id: 13, app: 'Mail', icon: ICONS.mail, title: 'Your invoice is ready', body: 'October · $48.00', time: ago(72) },
      ],
    },
    search: (q0) => {
      const q = lc(q0);
      const apps = appList.filter(([n]) => lc(n).includes(q)).map(([n, k], i) => ({
        kind: 'app', title: n, sub: 'App', id: n, s: 95 - i, iconKey: 'app:' + n, spec: { lnk: 'x', name: n }, pinned: n === 'Music', canAdmin: true, canLocation: true, __icon: ICONS[k],
      }));
      const cmds = 'shut down'.includes(q) && q.length >= 3 ? [{ kind: 'command', title: 'Shut down', sub: 'Power', cmd: 'shutdown', s: 60 }] : [];
      const sets = q.length > 1 && 'sound'.includes(q) ? [{ kind: 'setting', title: 'Sound', sub: 'Settings', uri: 'x', s: 70 }] : [];
      return { items: [...apps, ...cmds, ...sets], files: [{ kind: 'file', title: q0 + ' mix.mp3', sub: '~\\Music\\' + q0 + ' mix.mp3', path: 'x', s: 52, iconKey: 'ext:.mp3', canAdmin: false }] };
    },
    icons: Object.fromEntries(appList.map(([n, k]) => ['app:' + n, ICONS[k]])),
    audio: {
      devices: [{ id: 'a', name: 'Speakers (Studio Monitor)', default: true }, { id: 'b', name: 'Headphones (Buds Pro)', default: false }, { id: 'c', name: 'Display Audio (Odyssey)', default: false }],
      apps: [{ key: 'music.exe', exe: 'music.exe', name: 'Music', vol: 78, muted: false }, { key: 'browser.exe', exe: 'browser.exe', name: 'Browser', vol: 45, muted: false }, { key: 'system', exe: '', name: 'System sounds', vol: 100, muted: false }],
      iconFor: { 'music.exe': ICONS.music, 'browser.exe': ICONS.browser },
    },
    btDevices: [{ name: 'Buds Pro', connected: true, kind: 'AudioVideo' }, { name: 'Speak 2', connected: false, kind: 'AudioVideo' }, { name: 'Pixel', connected: false, kind: 'Phone' }, { name: 'Controller', connected: false, kind: 'LE' }],
    networks: [
      { ssid: 'Studio 5G', secured: true, auth: 'WPA3-Personal', signal: 92, known: true, connected: true },
      { ssid: 'Cafe Guest', secured: false, auth: 'Open', signal: 66, known: false, connected: false },
      { ssid: 'Loft', secured: true, auth: 'WPA2-Personal', signal: 48, known: false, connected: false },
      { ssid: 'Neighbors', secured: true, auth: 'WPA2-Personal', signal: 27, known: false, connected: false },
    ],
  };
})();
