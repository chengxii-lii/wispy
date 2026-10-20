// Browser-only stand-in for the Electron preload, so the UI can be developed and tested in a plain tab.
(() => {
  const handlers = {};
  const emit = (ch, ...a) => (handlers[ch] || []).forEach((f) => f(...a));
  const icon = (c, l) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="15" fill="${c}"/><text x="32" y="43" font-family="Segoe UI,sans-serif" font-size="30" font-weight="600" text-anchor="middle" fill="#fff">${l}</text></svg>`);
  let dock = [
    { id: 'pin:a', name: 'Comet', pinned: true, icon: icon('#6d5dfc', 'C'), running: 1, active: false },
    { id: 'pin:b', name: 'Discord', pinned: true, icon: icon('#5865f2', 'D'), running: 0, active: false },
    { id: 'pin:c', name: 'File Explorer', pinned: true, icon: icon('#f5b324', 'F'), running: 2, active: true },
    { id: 'pin:d', name: 'Helium', pinned: true, icon: icon('#3450d1', 'H'), running: 3, active: false, wins: [{ hwnd: 1, title: 'New Tab - Helium' }, { hwnd: 2, title: 'Release notes - Helium' }, { hwnd: 3, title: 'Docs - Helium' }] },
    { id: 'pin:e', name: 'Notion', pinned: true, icon: icon('#2b2b2b', 'N'), running: 0, active: false },
    { id: 'pin:f', name: 'Spotify', pinned: true, icon: icon('#1db954', 'S'), running: 1, active: false },
    { id: 'run:code', name: 'Code', pinned: false, icon: icon('#0a84d6', 'V'), running: 1, active: false },
  ];
  let radios = [{ kind: 'WiFi', state: 'On' }, { kind: 'Bluetooth', state: 'On' }];
  let cfgStore = { theme: 'auto', accent: 'cloud', glass: 46, iconSize: 46, magnify: 1.62, edgeOpen: true, edge: 'med', delay: 35, keepOpen: false, winKey: 'wispy', monitor: 'primary', clock24: false, seconds: false, dateFmt: 'short', showTray: true, showLang: true, showBattPct: true, showTaskView: true, showDesktop: false, dnd: false, searchEngine: 'google' };
  const DEFAULT_CFG = { ...cfgStore };
  window.tb = {
    config: async () => cfgStore,
    setConfig: async (p) => { Object.assign(cfgStore, p); return cfgStore; },
    resetConfig: async () => { Object.assign(cfgStore, DEFAULT_CFG); return cfgStore; },
    displays: async () => [{ id: '1', primary: true, label: 'Display 1 · 2560×1440' }, { id: '2', primary: false, label: 'Dell U3219Q · 3840×2160' }],
    barOpen: () => {}, power: (a) => console.log('power', a), shellKey: (k) => console.log('key', k),
    pinOrder: (ids) => console.log('pinOrder', ids.join(',')), windowFocus: (h) => console.log('focus', h), windowClose: (h) => console.log('close', h),
    init: async () => ({
      accent: '#4cc2ff', dock, volume: { level: 38, muted: false }, config: cfgStore,
      lang: { cur: 'ENG', list: [{ key: 'en', short: 'ENG', name: 'English (United States)', sub: 'US keyboard', cur: true }, { key: 'zh', short: 'ZHO', name: 'Chinese (Simplified, PRC)', sub: 'Microsoft Pinyin', cur: false }] },
      tray: ['#7c5cff', '#2db55d', '#e8a33d', '#3b82f6', '#ef4444', '#14b8a6', '#a855f7'].map((c, i) => ({ key: 'k' + i, tip: 'Tray app ' + (i + 1), icon: icon(c, String.fromCharCode(65 + i)) })),
      history: [
        { id: 11, app: 'Claude', icon: null, title: 'dayworks', body: 'colloquialism library 1.10 shipped', time: Date.now() - 4 * 60000 },
        { id: 12, app: 'Snipping Tool', icon: null, title: 'Screenshot copied to clipboard', body: 'Automatically saved to screenshots folder', time: Date.now() - 52 * 60000 },
      ],
    }),
    on: (ch, fn) => { (handlers[ch] = handlers[ch] || []).push(fn); },
    interactive: () => {},
    focusMe: async () => true,
    release: () => {},
    dockClick: (id, mod) => console.log('dockClick', id, mod),
    dockClose: () => {},
    search: async (q, seq) => {
      const apps = ['Calculator', 'Calendar', 'Camera', 'Chrome', 'Settings', 'Spotify', 'Steam', 'Notepad', 'Notion']
        .filter((n) => n.toLowerCase().includes(q.toLowerCase())).map((n, i) => ({ kind: 'app', title: n, sub: 'App', id: n, s: 90 - i, iconKey: 'app:' + n, spec: { lnk: 'C:/x/' + n + '.lnk', name: n }, pinned: n === 'Notion', canAdmin: true, canLocation: true }));
      const sets = q.length > 1 ? [{ kind: 'setting', title: 'Bluetooth & devices', sub: 'Settings', uri: 'x', s: 50 }] : [];
      setTimeout(() => emit('search-files', seq, [{ kind: 'file', title: q + ' notes.md', sub: '~\\Documents\\' + q + ' notes.md', path: 'x', s: 55, iconKey: 'ext:.md' }]), 120);
      return { seq, items: apps.concat(sets) };
    },
    open: (r) => console.log('open', r),
    icon: async () => null,
    volume: (o) => console.log('volume', o),
    wifi: async () => ({ present: true, connected: true, ssid: 'eduroam', signal: 80 }),
    wifiNetworks: async () => [
      { ssid: 'eduroam', secured: true, enterprise: true, auth: 'WPA2-Enterprise', signal: 88, known: true, connected: true },
      { ssid: 'RIT-Guest', secured: false, auth: 'Open', signal: 71, known: false, connected: false },
      { ssid: 'Dorm 4B', secured: true, auth: 'WPA2-Personal', signal: 52, known: false, connected: false },
      { ssid: 'xfinitywifi', secured: false, auth: 'Open', signal: 31, known: false, connected: false },
    ],
    wifiConnect: async () => true,
    radios: async () => radios,
    setRadio: async (kind, on) => {
      radios = radios.map((r) => (kind === 'wifibt' || r.kind === kind ? { ...r, state: on ? 'On' : 'Off' } : r));
      await new Promise((r) => setTimeout(r, 600)); return radios;
    },
    brightness: async () => 50,
    setBrightness: () => {},
    openSettings: (u) => console.log('settings', u),
    menuInfo: async () => ({ login: true, packaged: true }),
    notifyOpen: (id) => console.log('notify open', id),
    history: async () => [],
    historyClear: (id) => console.log('history clear', id),
    audio: async () => ({ devices: [{ id: 'a', name: 'Speakers (Realtek(R) Audio)', default: true }, { id: 'b', name: 'CMF Buds Pro 2', default: false }],
      apps: [{ key: 'system', exe: '', name: 'System sounds', vol: 100, muted: false }, { key: 'spotify.exe', exe: 'spotify.exe', name: 'Spotify', vol: 72, muted: false }, { key: 'chrome.exe', exe: 'chrome.exe', name: 'Helium', vol: 100, muted: true }] }),
    setAudioDevice: (id) => console.log('device', id),
    setAppVolume: (k, o) => console.log('appvol', k, o),
    btDevices: async () => [{ name: 'CMF Buds Pro 2', connected: true, kind: 'AudioVideo' }, { name: 'Jabra Speak2 55 MS', connected: false, kind: 'AudioVideo' }, { name: 'Pixel 10 Pro', connected: false, kind: 'Phone' }, { name: 'Xbox Wireless Controller', connected: false, kind: 'LE' }],
    setLang: (h) => console.log('lang', h),
    wifiJoin: async (ssid, pw) => { await new Promise((r) => setTimeout(r, 1500)); return pw === 'wrong' ? { ok: false, error: 'Couldn’t connect. Check the security key.' } : { ok: true }; },
    wifiDisconnect: async () => true,
    btAudio: async () => true,
    trayClick: (k, b) => console.log('tray', k, b),
    appMenu: async (id) => { const d = dock.find((x) => x.id === id) || {}; return { name: d.name, icon: d.icon, pinned: d.pinned, running: d.running, canAdmin: true, canLocation: true }; },
    appAction: (id, a) => console.log('appAction', id, a),
    resultAction: async (r, a) => { console.log('resultAction', r.title, a); return { ok: true, pinned: a === 'pin' }; },
    setLogin: () => {}, taskmgr: () => {}, quit: () => console.log('quit'),
  };
  // drive the cursor from the real mouse, like main does in the app (viewport == window)
  document.addEventListener('mousemove', (e) => emit('cursor', e.clientX, e.clientY));
  document.addEventListener('mouseleave', () => emit('cursor', -1, -1));
  window.tbMock = { cursor: (x, y) => emit('cursor', x, y), emit, setDock: (d) => { dock = d; emit('dock', d); } };
  const A = window.__artOverrides;
  if (A) {
    // README art: scripts/art injects brand-free data and renders this UI over a ShaderGradient
    const b = window.tb;
    b.init = async () => ({ ...A.init, config: cfgStore });
    b.search = async (q, seq) => { const r = A.search(q); setTimeout(() => emit('search-files', seq, r.files), 120); return { seq, items: r.items }; };
    b.icon = async (src, key) => A.icons[key] || (A.audio.iconFor || {})[src] || null;
    b.audio = async () => ({ devices: A.audio.devices, apps: A.audio.apps });
    b.btDevices = async () => A.btDevices;
    b.wifiNetworks = async () => A.networks;
    b.wifi = async () => ({ present: true, connected: true, ssid: 'Studio 5G', signal: 92 });
  } else {
    document.documentElement.style.background = '#6b7a99';
    document.body.style.background = 'linear-gradient(160deg,#7a8fb8,#3d4a6b)';
  }
})();
