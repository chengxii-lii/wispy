// End-to-end: real mouse right-click on a dock item, then real click on a menu entry.
// usage: node closetest.mjs <dockId> "<menu label>"   (needs WISP_DEBUG_PORT=9333 dev build)
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const [id, label] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = (js) => execFileSync('node', [path.join(here, 'cdp.mjs'), js], { encoding: 'utf8' }).trim();
const click = (x, y, b = 'left', move = false) => execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'click.ps1'), '-X', String(x), '-Y', String(y), '-Button', b, ...(move ? ['-Move'] : [])]);
const J = (s) => JSON.parse(JSON.parse(s));
const q = JSON.parse(cdp("(()=>JSON.stringify({w:innerWidth,h:innerHeight}))()")); const size = JSON.parse(q);
const geo = JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', "Add-Type 'using System;using System.Runtime.InteropServices;public static class G{[DllImport(\"user32.dll\")]public static extern bool SetProcessDPIAware();[DllImport(\"user32.dll\")]public static extern int GetSystemMetrics(int i);}'; [void][G]::SetProcessDPIAware(); '{\"w\":'+[G]::GetSystemMetrics(0)+',\"h\":'+[G]::GetSystemMetrics(1)+'}'"], { encoding: 'utf8' }));
const left = Math.round((geo.w - size.w) / 2), top = geo.h - size.h;
cdp('(__wisp.openBar(true), "open")');
await sleep(1500);
const pos = J(cdp(`(()=>{const e=document.querySelector('.item[data-id="${id}"]'); if(!e) return JSON.stringify(JSON.stringify(null)); const r=e.getBoundingClientRect(); return JSON.stringify(JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),open:__wisp.S.open}))})()`));
console.log('icon', pos);
if (!pos || !pos.open) { console.log('FAIL dock not open / item missing'); process.exit(1); }
click(left + pos.x, top + pos.y, 'right');
await sleep(2200);
const menu = J(cdp(`(()=>JSON.stringify(JSON.stringify({ctx:__wisp.S.ctx, items:[...document.querySelectorAll('#ctx .cm')].map(b=>{const q=b.getBoundingClientRect(); return {t:b.textContent.trim(),x:Math.round(q.x+q.width/2),y:Math.round(q.y+q.height/2)}})})))()`));
console.log('menu still open after 2.2s:', menu.ctx, menu.items.map((i) => i.t).join(' | '));
if (!menu.ctx) { console.log('FAIL menu vanished'); process.exit(1); }
const it = menu.items.find((i) => i.t === label);
if (!it) { console.log('FAIL no such item'); process.exit(1); }
click(left + it.x, top + it.y, 'left');
console.log('clicked', label);
