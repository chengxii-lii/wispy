# wispy: quality-of-life ideas

Twenty ideas, then the ten that made the cut. The filter was one question: **would someone who replaces their taskbar with wispy hit a wall without it?** Nice-to-haves lost to needs.

## The 20

| # | Idea | Need or nice? |
|---|------|---------------|
| 1 | Settings panel with saved config (the home for everything below) | **Need.** Nothing is customizable without it |
| 2 | Power menu: lock, sign out, sleep, restart, shut down | **Need.** The Start button's power menu is gone, so there is currently no way to shut down |
| 3 | Show desktop and Task View buttons | **Need.** Both live on the Windows taskbar and Win+D / Win+Tab can't be the only way |
| 4 | Appearance: theme, accent colour, glass level, icon size, magnification | **Need.** The first thing anyone customizes |
| 5 | Behaviour: edge sensitivity, open delay, always-show dock, Win key mode | **Need.** The hover zones suit one hand and one mouse; others need to tune them, or opt out of the Win key hijack |
| 6 | Monitor choice: primary, a specific display, or follow the cursor | **Need.** Multi-monitor users get a bar on the wrong screen otherwise |
| 7 | Clock and row layout: 12/24-hour, seconds, date format, hide buttons | **Need.** Locale and taste differ |
| 8 | Drag to reorder pinned apps | **Need.** Order comes from Windows today and can't be changed here |
| 9 | Do Not Disturb | **Need.** wispy mutes Windows' banners, so it has to offer its own mute |
| 10 | Window picker for apps with several windows | **Need.** Browsers and Explorer; clicking only cycles |
| 11 | Window thumbnails on hover | Nice. Heavy (DWM thumbnail API), the picker covers the need |
| 12 | Jump lists and recent files in the app menu | Nice. Windows has it; needs per-app shell plumbing |
| 13 | Now-playing media controls in the bar | Nice. Neat, but not a wall |
| 14 | Calculator, unit and currency answers in search | Nice. Search is for launching |
| 15 | Clipboard history | Nice. Windows already has Win+V (which wispy leaves alone) |
| 16 | Weather and calendar events in the clock panel | Nice. Needs accounts or network calls |
| 17 | App badges and progress on dock icons | Nice. Needs taskbar-list COM hooks |
| 18 | Per-app rules (hide in games, ignore apps) | Nice. Fullscreen detection already covers the common case |
| 19 | Auto-update and about page | Needed before a public release, but it belongs to the release work, not QoL |
| 20 | Config import / export and profiles | Nice. The config is one JSON file anyway |

## The 10 that shipped (1 to 10 above)

Settings panel · Power menu · Show desktop + Task View · Appearance · Behaviour · Monitor choice · Clock and row layout · Drag to reorder pins · Do Not Disturb · Window picker.

Search engine choice (Google, DuckDuckGo, Bing, Brave) rode along with the settings panel because it was one line.
