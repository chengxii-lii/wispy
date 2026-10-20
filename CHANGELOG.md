# Changelog

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
