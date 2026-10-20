# Contributing

Thanks for wanting to help. wisp is small on purpose, so a few notes up front.

## Before you start

- **Bugs:** open an issue with the Windows version and what you saw. If you can, add the last lines of `%APPDATA%\wisp\wisp.log`.
- **Features:** open an issue first and describe the situation you're in. The bar is meant to stay quiet, so features have to earn their place (see [`docs/ideas.md`](docs/ideas.md) for how the current set was chosen).
- **Anything that changes how the taskbar is hidden or restored** deserves extra care: that code must always put the taskbar back.

## Running it

You need Windows, Node 22+, and nothing else (the C# compiler that builds the helper ships with Windows).

```bash
npm install
npm run helper     # builds helper/wisp-helper.exe
npm start          # runs the app; it hides your taskbar, so know how to restore it:
                   #   powershell -File scripts/restore-taskbar.ps1
npm test           # fast checks, no Windows APIs needed
```

**UI work needs no Windows features at all.** Serve the `renderer/` folder (`python -m http.server`) and open it in a browser: `renderer/mock.js` stands in for the Electron side, and `window.__wisp.advance(ms)` steps the animation without waiting.

## Code layout

| Path | What |
| :-- | :-- |
| `main.js` | The Electron main process: window, cursor polling, the dock model, search, pins, notifications, settings storage |
| `preload.js` | The `window.tb` API between the two halves |
| `renderer/` | The UI: `app.js` (springs, zones, panels), `style.css` (tokens), `index.html`, `mock.js` |
| `helper/` | The native helper, C# 5 (the compiler built into Windows): hooks, taskbar hiding, window list, icons, audio, languages, tray, Bluetooth audio |
| `scripts/` | Build, install, uninstall, rescue, and the README art |

A few things that will save you time:

- The helper is compiled with the in-box `csc`, which only speaks **C# 5**: no `$""` strings, `?.`, `nameof` or expression-bodied members.
- Adding a setting means: a default in `DEFAULTS` (`main.js`), the same in `renderer/mock.js`, a row in `SCHEMA` (`renderer/app.js`), and applying it in `applyConfig`. `npm test` will tell you if one is missing.
- Anything the renderer asks of the main process goes through `preload.js`; the tests check the three stay in step.
- Never test power actions for real. `WISP_DRYRUN=1 npm start` makes them log instead.

## Pull requests

Keep them focused, run `npm test`, and say how you tried the change. Screenshots help for anything visual. By contributing you agree your work is released under the [MIT license](LICENSE).
