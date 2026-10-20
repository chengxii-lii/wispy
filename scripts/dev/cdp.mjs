// usage: node cdp.mjs "<js expression>"   (evaluates in the wispy renderer on :9333)
const list = await (await fetch('http://127.0.0.1:9333/json')).json();
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
if (!page) { console.log('no page', list.map((t) => t.url)); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const call = (method, params) => new Promise((resolve) => {
  const my = ++id;
  const h = (m) => { const d = JSON.parse(m.data); if (d.id === my) { ws.removeEventListener('message', h); resolve(d); } };
  ws.addEventListener('message', h);
  ws.send(JSON.stringify({ id: my, method, params }));
});
const r = await call('Runtime.evaluate', { expression: process.argv[2], awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r.result?.result?.value ?? r.result ?? r.error));
ws.close();
process.exit(0);
