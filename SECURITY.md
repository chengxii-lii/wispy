# Security

wisp runs as you, with no admin rights, and never talks to a server. It does hook the keyboard (to notice a tap of the Windows key), read your window list and notification database, and relay tray messages, so it deserves careful review. All of that code is in this repository.

**Found a vulnerability?** Please don't open a public issue. Use GitHub's [private vulnerability reporting](https://github.com/chengxii-lii/wisp/security/advisories/new) on this repository, and give me a reasonable chance to fix it before sharing details.

Things that count: anything that lets another program use wisp to run code or read data it couldn't otherwise, or anything that could leave a user without their taskbar.
