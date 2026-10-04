<img src="docs/banner.png" alt="Notion Presenter View, a Chrome extension that shows the next slide of a Notion presentation" />

Notion Presenter View is a Chrome extension that shows the next slide of a Notion presentation in a small floating window. The window stays on top of the fullscreen slides, so you always know what's coming.

Notion's presentation mode turns a page into slides, split at each divider. You see exactly what the audience sees, one slide at a time. There's no presenter view with the next slide, like Keynote and PowerPoint have, so this extension adds one.

![The panel showing the next slide](docs/panel.png)

## Install

Notion Presenter View isn't on the Chrome Web Store, so you load it into Chrome yourself. It takes a minute.

1. Get `Notion-Presenter-View-1.0.0.zip` from the [latest release](https://github.com/flaviocopes/notion-presenter-view/releases/latest) and unzip it.
2. Move the `Notion-Presenter-View-1.0.0` folder somewhere it can stay, like your Documents folder. Chrome runs the extension from that folder, so if you delete it, the extension is gone.
3. Open `chrome://extensions` and turn on **Developer mode** in the top right corner.
4. Click **Load unpacked** and pick that folder.
5. Click the puzzle icon in the toolbar and pin Notion Presenter View, so it's one click away.

It needs Chrome 116 or later, and Notion in the browser. Notion's desktop app isn't Chrome, so the extension can't run there.

### Updates

An extension you load this way doesn't update on its own. When there's a new release, unzip it and copy its files into your Notion Presenter View folder, replacing the old ones. Then click the reload arrow on its card in `chrome://extensions`. Since the folder is the same, Chrome keeps your shortcut and the pinned button.

To hear about new versions, click **Watch** on this repo, then **Custom** and **Releases**.

## Use it

1. Open the Notion page you want to present.
2. Press `Option+Shift+P` on a Mac (`Alt+Shift+P` on Windows and Linux), or click the extension button. The panel opens.
3. Drag the panel where only you can see it, like your laptop screen while the slides are on the projector.
4. Click the Notion page and press `⌘⌥P` (`Ctrl+Alt+P` on Windows and Linux) to start presenting.

Change slides as usual, with the arrow keys, Space or a clicker. The panel shows the slide that comes next and where you are, like "Slide 3 of 12". On the last slide it tells you the presentation is over. Press the shortcut again to close the panel, or click its close button.

> Open the panel before you start presenting. When a page opens a floating window, Chrome takes it out of fullscreen. If that happens, click the slides and press `F` to go back to fullscreen.

The panel has a **Start presenting** button too. Chrome doesn't let a click in the panel make the page fullscreen, so after it starts, click the slides and press `F`.

### The shortcut

To change the shortcut, open `chrome://extensions/shortcuts`. Go there too if the shortcut doesn't work. Chrome skips a suggested shortcut when another extension already uses it, and leaves it empty.

## Features

- The next slide looks the way Notion will draw it on your screen, with its images, callouts and colors, in light or dark mode.
- The panel shows where you are, like "Slide 3 of 12", and tells you when you reach the last slide.
- It stays on top of the fullscreen slides and of every other app.
- If you click the panel, the arrow keys, Space, Page Up, Page Down, Escape and `R` still reach Notion, so your clicker keeps working.
- Embeds show up as a gray box, so a video or a Figma file doesn't load a second time.

## Sharing your screen

The panel is a separate window, so it stays private when you share the Notion tab or the Chrome window in a video call. If you share the whole screen, people see the panel too.

With a projector, set it up as a second display, put the slides on the projector and keep the panel on your laptop. If the displays mirror each other, the audience sees the panel.

## Privacy

Notion Presenter View asks Chrome for two permissions, `activeTab` and `scripting`, and Chrome shows no warning for them when you install it. Together they let the extension run on a page only when you press the shortcut or click its button there, and it only does that on Notion pages.

It reads the slides Notion already has in the page. It never goes online, and there are no accounts or analytics.

Notion's presentation mode needs a Plus, Business or Enterprise plan. This extension isn't made by or affiliated with Notion.

## Build it from source

There's no build step. Clone the repo and load the folder itself with **Load unpacked**, as in the install steps. After you edit a file, click the reload arrow on the extension's card.

To make the release zip, run:

```sh
scripts/build-release.sh
```

It copies the extension files into `dist/Notion-Presenter-View-<version>.zip` and prints its SHA-256. The same commit always gives the same zip, so you can check that a release matches its tag.

## Development

The test loads the extension into Playwright's Chromium and goes through a whole presentation on a mock Notion page. It checks the preview, the slide count, the keys forwarded from the panel, the end of the presentation and fullscreen. You need Node.js:

```sh
npm install
npx playwright install chromium
npm test
```

The banner comes from `scripts/banner.html`. Render it again with `npm run banner`. The icons are rendered from `icons/icon.svg` with `npm run icons`.

Working with an AI coding agent? Point it at [AGENTS.md](AGENTS.md). It has the commands and the rules to follow.

## How it works

Notion's presentation mode keeps three slides in the page: the previous one, the current one and the next one. Each sits in an element with a `data-slide-index` attribute, and only the current one has `aria-hidden="false"`. So the next slide is already there, fully drawn, just hidden.

The shortcut is Chrome's `_execute_action` command, so the button and the shortcut fire the same `action.onClicked` event. The service worker in `background.js` then injects `presenter.js` into the page with `chrome.scripting.executeScript`. The click or the key press counts as a user gesture in the page, which the [Document Picture-in-Picture API](https://developer.chrome.com/docs/web-platform/document-picture-in-picture) needs to open its always-on-top window.

`presenter.js` copies Notion's stylesheets and theme colors into that window, clones the next slide into it and scales it the way Notion scales it on your screen. A `MutationObserver` updates it every time the slide changes. Notion matches its shortcuts on `keyCode`, so the keys you press in the panel are sent to the page as keyboard events with the right `keyCode`.

The fullscreen rule comes from Chrome. A page that opens a new window loses fullscreen, and a click in the panel doesn't count as a user gesture in the page. A key press on the slides does, so `F` asks for fullscreen again.

This depends on Notion's markup, so a Notion update can break it. The test's mock page copies that markup from Notion's presentation code.

## License

[MIT](LICENSE)
