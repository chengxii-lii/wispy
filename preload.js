const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const send = (ch, ...a) => ipcRenderer.send(ch, ...a);

contextBridge.exposeInMainWorld('tb', {
  init: () => invoke('init'),
  on: (ch, fn) => {
    const l = (_e, ...a) => fn(...a);
    ipcRenderer.on(ch, l);
    return () => ipcRenderer.removeListener(ch, l);
  },
  interactive: (v) => send('interactive', v),
  focusMe: () => invoke('focus-me'),
  release: (restore) => send('release', restore),
  dockClick: (id, mod) => send('dock-click', id, mod),
  dockClose: (id) => send('dock-close', id),
  search: (q, seq) => invoke('search', q, seq),
  open: (r) => send('open-result', r),
  icon: (src, key) => invoke('icon', src, key),
  volume: (o) => send('volume', o),
  wifi: () => invoke('wifi'),
  wifiNetworks: () => invoke('wifi-networks'),
  wifiConnect: (ssid) => invoke('wifi-connect', ssid),
  radios: () => invoke('radios'),
  setRadio: (kind, on) => invoke('set-radio', kind, on),
  brightness: () => invoke('brightness'),
  setBrightness: (v) => send('set-brightness', v),
  openSettings: (uri) => send('open-settings', uri),
  menuInfo: () => invoke('menu-info'),
  setLogin: (v) => send('set-login', v),
  taskmgr: () => send('taskmgr'),
  quit: () => send('quit-app'),
  notifyOpen: (id) => send('notify-open', id),
  history: () => invoke('history'),
  historyClear: (id) => send('history-clear', id),
  audio: () => invoke('audio'),
  setAudioDevice: (id) => send('set-audio-device', id),
  setAppVolume: (key, o) => send('set-app-volume', key, o),
  btDevices: () => invoke('bt-devices'),
  setLang: (key) => send('set-lang', key),
  wifiJoin: (ssid, password, auth) => invoke('wifi-join', ssid, password, auth),
  wifiDisconnect: () => invoke('wifi-disconnect'),
  btAudio: (name, action) => invoke('bt-audio', name, action),
  trayClick: (key, button) => send('tray-click', key, button),
  config: () => invoke('config-get'),
  setConfig: (patch) => invoke('config-set', patch),
  resetConfig: () => invoke('config-reset'),
  displays: () => invoke('displays'),
  barOpen: (v) => send('bar-open', v),
  power: (act) => send('power', act),
  shellKey: (which) => send('shell-key', which),
  pinOrder: (ids) => send('pin-order', ids),
  windowFocus: (hwnd) => send('window-focus', hwnd),
  windowClose: (hwnd) => send('window-close', hwnd),
  appMenu: (id) => invoke('app-menu', id),
  appAction: (id, act) => send('app-action', id, act),
  resultAction: (r, act) => invoke('result-action', r, act),
});
