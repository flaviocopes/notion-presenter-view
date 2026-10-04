# Notion Presenter View

A Chrome extension that shows the next slide of a Notion presentation in an always-on-top Document Picture-in-Picture window. It's plain JavaScript with no build step.

## Files

- `manifest.json`: Manifest V3. The permissions are `activeTab` and `scripting`, with no host permissions. The shortcut is the `_execute_action` command, so it fires the same `action.onClicked` event as the toolbar button.
- `background.js`: the service worker. On a Notion URL it injects `presenter.js` into the page's main world. The injection has to start synchronously in the listener, so the click or shortcut still counts as a user gesture in the page.
- `presenter.js`: everything else. The first injection defines `window.__notionPresenterView` and opens the panel, later ones toggle it. It reads Notion's `[data-presentation-mode]` root and its `[data-slide-index]` slides, clones the next slide into the panel, copies the stylesheets and theme variables, scales the slide like Notion, forwards presentation keys from the panel, and turns `F` on the slides into a fullscreen request.
- `icons/`: `icon.svg` is the source, and `scripts/icons.mjs` renders the PNGs.
- `test/mock-notion.html`: a stand-in for a Notion page in presentation mode, copied from the markup of Notion's `PagePresentationMode` chunk.
- `test/run.mjs`: loads the extension into Playwright's Chromium, serves the mock at `app.notion.com` and checks a whole presentation.
- `scripts/build-release.sh`: zips the extension into `dist/Notion-Presenter-View-<version>.zip`.
- `scripts/banner.html` and `scripts/render-banner.mjs`: the README banner, rendered to `docs/banner.png`.

## Build and run

```sh
npm install                          # Playwright, for the test, the banner and the icons
npx playwright install chromium      # the browser they run in
npm test                             # a whole presentation on the mock page, screenshots in test/screenshots
node test/run.mjs <folder>           # the same test on another copy, like an unzipped release
scripts/build-release.sh             # dist/Notion-Presenter-View-<version>.zip and its SHA-256
npm run banner                       # docs/banner.png at 2x
npm run icons                        # icons/icon-*.png from icons/icon.svg
```

To try a change in your own Chrome, open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick this folder. After editing, click the reload arrow on the extension's card, then reload the Notion tab, because the page keeps the old `presenter.js` until it reloads.

## Rules

- Run `npm test` after every change to `presenter.js`, `background.js` or `manifest.json`, and add a check to `test/run.mjs` for any new behavior.
- When Notion changes its presentation markup, update `test/mock-notion.html` to match it first, then fix `presenter.js`. The selectors that matter are `[data-presentation-mode]`, `[data-slide-index]` with `aria-hidden`, the element with `transform-origin` that scales the 800px slide, and the `tabular-nums` counter.
- Notion matches shortcuts on `keyCode`, which `new KeyboardEvent()` can't set. `sendKey` defines it on the event, which only works because `presenter.js` runs in the page's main world.
- Chrome drops a tab's fullscreen when the page opens a Picture-in-Picture window, and a click in that window isn't a user gesture in the page. Don't add buttons in the panel that call `requestFullscreen()` on the page: they fail with "Permissions check failed".
- Playwright's request routing stalls requests made by the Picture-in-Picture window, so the test serves the mock from a real HTTPS server that `app.notion.com` resolves to. Don't switch it to `page.route`.
- Don't add host permissions. `activeTab` keeps the install free of permission warnings.
- The version in `manifest.json` and `package.json` must equal the release tag without the `v`. Releases attach the zip from `scripts/build-release.sh`, built from the tagged commit.
- The showreel video lives on flaviocopes.com, not in this repo. A local copy at `/notion-presenter-view-showreel.mp4` is ignored by git.
