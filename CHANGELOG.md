# Changelog

## v1.0.0

First public release.

- **A home bar instead of a taskbar.** The Windows taskbar is hidden; a thin pill appears when your cursor nears the bottom edge, leans toward it, and opens into a dock when you touch the edge. Icons magnify as you sweep across them.
- **Your apps, your order.** Pinned apps appear in the same order as your Windows taskbar, with running apps after a divider, running dots, drag-to-reorder, and a window picker for apps with several windows.
- **Right-click menus like the taskbar's.** Close window, close all, end task, run as administrator, open file location, pin and unpin, new window. Right-click works on the dock, search results, notifications, the clock, status and language buttons too.
- **Search on the Windows key.** Tap Win to search apps, settings, files (from the Windows Search index) and power commands. Results have the same actions as Windows search; Ctrl+Shift+Enter runs as administrator. Pick Google, DuckDuckGo, Bing or Brave for web searches.
- **Quick settings that go all the way.** Wi-Fi (join with a password), Bluetooth (connect headphones and speakers), sound output, a per-app volume mixer, battery, and a power menu (lock, sign out, sleep, restart, shut down, with a confirm step).
- **Notifications.** Popups above the bar that leave on their own, today's list under the clock (swipe to dismiss, or clear all with a cascade), Do not disturb, and Windows' own banners muted while neon runs.
- **Everything the taskbar had.** Hidden-icons menu, input language switcher (including input methods like Pinyin), Task view, Show desktop, clock with a calendar.
- **Make it yours.** Theme, accent colour, glass level, icon size, magnification, open sensitivity and delay, always-show dock, Windows key behaviour, which screen, 12/24-hour clock, date format, and which buttons show.
- **Safe by design.** The taskbar returns whenever neon exits or its window crashes; `restore-taskbar.ps1` is the manual fallback, and `uninstall.ps1` removes everything.
- **Repo.** 27 checks (`npm test`); a ShaderGradient banner, screenshots and demo GIF rendered from the real UI (`npm run art`); CI and a tagged-release workflow that builds the zip.
