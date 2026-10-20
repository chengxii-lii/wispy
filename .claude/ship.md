# Ship recipe: tinybar

- **Type:** Windows desktop app (Electron + a C# native helper), installed per user
- **Branch:** main · **Remote:** https://github.com/chengxii-lii/tinybar · **Visibility:** public
- **Version scheme:** x.y.z (patch for fixes, minor for features). Same version in all places. · **Tag:** vX.Y.Z
- **Version locations:** `package.json` → `"version"`, the top `## vX.Y.Z` in `CHANGELOG.md`, the version badge and the zip name in `README.md`, `v1.0` in `renderer/index.html` (settings header)
- **Test:** `npm test` (fast checks: syntax, ids, IPC, settings, version agreement). Then try the change in the running app.
- **Build:** `npm run helper && npm run pack`
- **Changelog:** `CHANGELOG.md`, newest first, `## vX.Y.Z` then bullets that start with a **bold phrase.** in plain user language. The last bullet is **Repo.** for dev-only changes.
- **Release assets:** `npm run zip` builds `release/tinybar-vX.Y.Z-win-x64.zip` (+ `.sha256`). Pushing the tag runs `.github/workflows/release.yml`, which builds it on GitHub and opens a **draft** release with the changelog entry as notes.
- **Release:** `git tag vX.Y.Z && git push origin vX.Y.Z`, then review and publish the draft on GitHub. (Or `gh release create vX.Y.Z release/*.zip release/*.sha256 --draft --notes-file notes.md` with `node scripts/release-notes.mjs X.Y.Z > notes.md`.)
- **Publish:** none beyond the GitHub release
- **Install on this PC:** `npm run pack` then `npm run install-app` (stops tinybar, copies, relaunches). Don't launch anything else.
- **Notes:** never test power actions without `TINYBAR_DRYRUN=1`. Re-render README art with `npm run art` when the UI changes visibly.
