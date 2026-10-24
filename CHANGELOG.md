# Changelog

## v1.0.8

- **Search finds the Recycle Bin, and more.** System folders (Recycle Bin, This PC, Desktop, Documents, Downloads, Pictures, Music, Videos, Screenshots, Network, Control Panel, the Startup and Fonts folders) and Windows' built-in tools (Task Manager, Device Manager, Disk Management, Services, Event Viewer, Registry Editor, Command Prompt, PowerShell, System Information and a few more) now show up as results, with the same keyboard and mouse actions as apps (tools can run as administrator). Searching "trash", "bin" or "empty" finds the Recycle Bin too.

## v1.0.7

- **Search hover is instant.** The highlight now follows the pointer immediately instead of waiting for it to pause; only the action pane on the right waits a beat, and moving into the pane returns the selection to the result whose actions you are aiming at.
- **Lighter on the machine.** Icons that fail to load are no longer re-requested from the helper on every hover, and wispy checks the cursor 40 times a second (instead of 100) while it is far from the bar, with no change to how quickly it reacts as you approach.
- **Repo.** `scripts/test/perf.mjs` measures frame times while sweeping the dock and the search results; `npm run test:ui` now has 107 checks.

## v1.0.6

- **Search is steady and clickable.** The search panel used to change height as you hovered different results and its buttons slid in on every selection, so the targets moved while you aimed. The panel now keeps one size for the whole set of results, buttons only fade, a result is selected when the pointer pauses on it (not while it passes over), and your keyboard selection is never undone by a resting mouse.
- **Dock stays up after a menu action.** Choosing Open, New window or Close from an app's right-click menu no longer closes the dock the moment the menu goes away.
- **A second close delay.** Settings has "Close delay" (default 35 ms) for when the cursor leaves and "Close delay after closing an app" (default 500 ms, up to 3 s) for how long the dock stays up while a closed app's icon fades out. It also applies when one of an app's windows closes.
- **Smaller download.** The installer no longer carries the website's files.
- **Repo.** `npm run test:ui` drives the real UI in headless Chrome with real mouse and keyboard input (103 checks: dock, clicking apps, search, every panel, every setting).

## v1.0.5

- **Clicking in search works.** Clicking a result or one of its options (Open, Run as administrator, Open file location, Pin) with the mouse could fail or make the panel jump around, because the panel was rebuilt under your cursor. It is now updated in place, hovering selects a result only once the pointer rests on it, and the search box keeps focus while you click.
- **Close delay.** The dock closes 35 ms after the cursor leaves (adjustable in Settings, Behaviour), but when an app closes it stays up for the length of the icon's close animation so you can see it go.

## v1.0.4

- **Click again to bring it back.** Minimising an app from the dock and clicking it again now restores it every time. Windows kept reporting a minimised window as the active one, so wispy minimised it a second time.
- **The dock keeps up.** It follows windows opening, closing, minimising and switching within about a tenth of a second (it used to take up to 0.6 s), and bringing a window to the front works more reliably.
- **The dock stays open while you work in it.** Opening, closing or switching an app from the dock, or from its right-click menu, no longer closes it. New **Close delay** setting (default 750 ms) sets how long it waits after the cursor leaves.
- **Clear feedback.** Icons squash when pressed, hop while an app is starting, pop with a ring when it is up, and fade out when it closes.
- **Settings and other Windows apps show their running dot** (apps hosted in Windows' app frame were invisible before).
- **Always within reach.** wispy no longer stays shut after you open something, and maximised windows are not mistaken for fullscreen apps. The Windows key hook runs on its own thread and refreshes itself, and a crashed graphics process now reloads the window instead of leaving it frozen.

## v1.0.3

- **Closed apps fade out instead of vanishing.** When you close an app, its icon stays in the dock for a moment, dimmed, so you can see it go.
- **Always within reach.** After you open something from the dock, wispy used to stay shut until the cursor moved 100 pixels up. It now comes back as soon as you move, or after half a second. Maximised windows are no longer mistaken for fullscreen apps (which switched wispy off), and a window that only covers the screen for a moment while it opens is ignored.
- **A steadier Windows key.** The key and mouse hooks now run on their own thread and refresh themselves, so a busy moment can no longer make the Windows Start menu open instead of wispy.

## v1.0.2

- **No more frozen bar after a graphics crash.** If Windows resets the graphics driver, wispy now reloads its window instead of staying unclickable.
- **A cleaner entry in Settings, Apps.** It reads just "wispy", and installing over an older copy tidies up the leftover uninstall script.
- **Repo.** The launch page's sky is lighter on the GPU.

## v1.0.1

- **A proper installer.** Download `wispy-setup.exe` and run it: no unzipping, no admin rights, a Start Menu shortcut, optional launch at sign-in, and wispy shows up in Settings, Apps so you can uninstall it there (it gives your taskbar back and offers to delete your settings).
- **The dock closes when you click away.** If you opened it with the mouse and clicked into search, clicking elsewhere left it open. It now closes.
- **Quick settings footer.** The power and settings buttons sat stacked instead of side by side, and panels were see-through enough to show text behind them. Both fixed.
- **Repo.** A launch page (`site/`) published with GitHub Pages at https://chengxii-lii.github.io/wispy/, and the release workflow builds the installer instead of a zip.

## v1.0.0

First public release.

- **A home bar instead of a taskbar.** The Windows taskbar is hidden; a thin pill appears when your cursor nears the bottom edge, leans toward it, and opens into a dock when you touch the edge. Icons magnify as you sweep across them.
- **Your apps, your order.** Pinned apps appear in the same order as your Windows taskbar, with running apps after a divider, running dots, drag-to-reorder, and a window picker for apps with several windows.
- **Right-click menus like the taskbar's.** Close window, close all, end task, run as administrator, open file location, pin and unpin, new window. Right-click works on the dock, search results, notifications, the clock, status and language buttons too.
- **Search on the Windows key.** Tap Win to search apps, settings, files (from the Windows Search index) and power commands. Results have the same actions as Windows search; Ctrl+Shift+Enter runs as administrator. Pick Google, DuckDuckGo, Bing or Brave for web searches.
- **Quick settings that go all the way.** Wi-Fi (join with a password), Bluetooth (connect headphones and speakers), sound output, a per-app volume mixer, battery, and a power menu (lock, sign out, sleep, restart, shut down, with a confirm step).
- **Notifications.** Popups above the bar that leave on their own, today's list under the clock (swipe to dismiss, or clear all with a cascade), Do not disturb, and Windows' own banners muted while wispy runs.
- **Everything the taskbar had.** Hidden-icons menu, input language switcher (including input methods like Pinyin), Task view, an optional Show desktop button, clock with a calendar.
- **Make it yours.** Theme, accent colour, glass level, icon size, magnification, open sensitivity and delay, always-show dock, Windows key behaviour, which screen, 12/24-hour clock, date format, and which buttons show.
- **Safe by design.** The taskbar returns whenever wispy exits or its window crashes; `restore-taskbar.ps1` is the manual fallback, and `uninstall.ps1` removes everything.
- **Repo.** 27 checks (`npm test`); a cloud-sky banner, screenshots and demo GIF rendered from the real UI (`npm run art`); CI and a tagged-release workflow that builds the zip.
