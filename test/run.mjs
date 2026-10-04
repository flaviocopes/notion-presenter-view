// Loads the extension in headless Chromium, serves the mock Notion page at
// app.notion.com and checks the presenter panel through a whole presentation.
// Usage: node test/run.mjs [extension folder, default: this repo]
import { chromium } from 'playwright'
import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import https from 'node:https'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const source = process.argv[2] ? path.resolve(process.argv[2]) : root
const shots = path.join(root, 'test', 'screenshots')
const profile = path.join(root, 'test', '.profile')
const extension = path.join(profile, 'extension')
const mockHtml = await readFile(path.join(root, 'test', 'mock-notion.html'), 'utf8')
const chartSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 140"><rect width="400" height="140" fill="#f1f1ef"/><g fill="#2383e2"><rect x="40" y="80" width="50" height="40"/><rect x="130" y="60" width="50" height="60"/><rect x="220" y="35" width="50" height="85"/><rect x="310" y="15" width="50" height="105"/></g></svg>`

await rm(profile, { recursive: true, force: true })
await mkdir(shots, { recursive: true })

// Headless there's no toolbar click to grant activeTab, so the test copy of
// the extension gets a host permission for the mock page instead.
await mkdir(extension, { recursive: true })
for (const file of ['manifest.json', 'background.js', 'presenter.js', 'icons']) {
  await cp(path.join(source, file), path.join(extension, file), { recursive: true })
}
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'))
manifest.host_permissions = ['https://app.notion.com/*']
await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest, null, 2))

// Playwright's request routing stalls requests made by the picture-in-picture
// window, so the mock is served by a real HTTPS server that app.notion.com
// resolves to.
const key = path.join(profile, 'key.pem')
const cert = path.join(profile, 'cert.pem')
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=app.notion.com', '-keyout', key, '-out', cert], { stdio: 'ignore' })

const server = https
  .createServer({ key: await readFile(key), cert: await readFile(cert) }, (req, res) => {
    if (req.url === '/images/chart.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml' })
      return res.end(chartSvg)
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(req.url.startsWith('/embed/') ? 'Roadmap embed' : mockHtml)
  })
  .listen(0, '127.0.0.1')
await new Promise((resolve) => server.once('listening', resolve))

const context = await chromium.launchPersistentContext(path.join(profile, 'chrome'), {
  channel: 'chromium',
  headless: true,
  ignoreHTTPSErrors: true,
  viewport: { width: 1512, height: 945 },
  deviceScaleFactor: 2,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    `--host-resolver-rules=MAP app.notion.com 127.0.0.1:${server.address().port}`,
    '--ignore-certificate-errors',
  ],
})

const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
const page = context.pages()[0] ?? (await context.newPage())
await page.goto('https://app.notion.com/Q4-Planning-1a2b3c4d')

const step = (name) => console.log(`- ${name}`)

// The toolbar button can't be clicked headless. Inject the script the way the
// background worker does: without a user gesture the panel can't open yet.
step('inject presenter.js without a gesture')
await worker.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ url: 'https://app.notion.com/*' })
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', files: ['presenter.js'] })
})
assert.equal(await page.evaluate(() => typeof window.__notionPresenterView?.toggle), 'function')
assert.equal(await page.evaluate(() => Boolean(documentPictureInPicture.window)), false)

// A real click in the page gives the user activation the toolbar click gives.
step('open the panel with a user gesture')
await page.evaluate(() => {
  const button = document.createElement('button')
  button.id = 'test-toggle'
  button.textContent = 'toggle'
  button.style.cssText = 'position:fixed;top:0;left:0;z-index:2000'
  button.onclick = () => window.__notionPresenterView.toggle()
  document.body.append(button)
})
const pipPagePromise = context.waitForEvent('page', { timeout: 3000 }).catch(() => null)
await page.click('#test-toggle')
await page.waitForFunction(() => Boolean(documentPictureInPicture.window))
const pipPage = await pipPagePromise
console.log(`  panel exposed as a Playwright page: ${Boolean(pipPage)}`)
await pipPage?.setViewportSize({ width: 520, height: 380 })

const panel = () =>
  page.evaluate(() => {
    const doc = documentPictureInPicture.window.document
    const visible = (selector) => {
      const el = doc.querySelector(selector)
      return Boolean(el) && !el.hidden
    }
    return {
      count: doc.querySelector('.npv-count').textContent,
      message: visible('.npv-message') ? doc.querySelector('.npv-message').innerText : null,
      slide: visible('.npv-slide') ? doc.querySelector('.npv-content').innerText : null,
      footer: visible('.npv-footer'),
    }
  })

const settle = () => page.waitForTimeout(150)

const screenshot = async (name) => {
  if (pipPage) await pipPage.screenshot({ path: path.join(shots, `${name}.png`) })
}

let state = await panel()
assert.match(state.message, /Waiting for the presentation/)
await screenshot('1-waiting')

step('start the presentation from the panel button')
await page.evaluate(() => {
  documentPictureInPicture.window.document.querySelector('[data-action="start"]').click()
})
await page.waitForSelector('[data-presentation-mode]')
await settle()
state = await panel()
assert.equal(state.count, 'Slide 1 of 5')
assert.match(state.slide, /Where we are/)
assert.match(state.slide, /2,000 users/)

step('a click in the panel cannot make Notion fullscreen, so the footer asks for F')
assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), false)
assert.equal(state.footer, true)
await screenshot('2-windowed')

step('F on the slides goes fullscreen and hides the footer')
await page.keyboard.press('f')
await page.waitForFunction(() => Boolean(document.fullscreenElement))
await settle()
state = await panel()
assert.equal(state.footer, false)
assert.equal(state.count, 'Slide 1 of 5')
await screenshot('2-title-slide')

step('arrow keys in the page update the panel')
await page.keyboard.press('ArrowRight')
await settle()
state = await panel()
assert.equal(state.count, 'Slide 2 of 5')
assert.match(state.slide, /What we learned/)

step('next slide keeps theme variables, image and callout colors')
await page.waitForFunction(() => documentPictureInPicture.window.document.querySelector('.npv-content img')?.naturalWidth > 0)
await settle()
const details = await page.evaluate(() => {
  const doc = documentPictureInPicture.window.document
  const slide = doc.querySelector('.npv-slide')
  const img = doc.querySelector('.npv-content img')
  const callout = doc.querySelector('.npv-content .notion-callout-block div')
  return {
    variable: slide.style.getPropertyValue('--c-texSec'),
    background: slide.style.backgroundColor,
    imgSrc: img?.getAttribute('src'),
    imgLoaded: img?.complete && img.naturalWidth > 0,
    imgHeight: img?.offsetHeight,
    contentHeight: doc.querySelector('.npv-content').offsetHeight,
    transform: doc.querySelector('.npv-content').style.transform,
    calloutColor: callout && documentPictureInPicture.window.getComputedStyle(callout).color,
  }
})
assert.equal(details.variable.trim(), 'rgb(115, 114, 110)')
assert.equal(details.background, 'rgb(255, 255, 255)')
assert.equal(details.imgSrc, 'https://app.notion.com/images/chart.svg')
assert.ok(details.imgHeight > 0)
assert.equal(details.calloutColor, 'rgb(115, 114, 110)')
await screenshot('3-image-slide')

step('keys pressed in the panel are forwarded to Notion')
await page.evaluate(() => {
  const doc = documentPictureInPicture.window.document
  doc.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, bubbles: true }))
})
await settle()
state = await panel()
assert.equal(state.count, 'Slide 3 of 5')
assert.match(state.slide, /Q4 goals/)
assert.match(state.slide, /Embed/)
assert.equal(await page.evaluate(() => documentPictureInPicture.window.document.querySelectorAll('iframe').length), 0)
await screenshot('4-embed-slide')

step('letters typed in the panel are not forwarded')
await page.evaluate(() => {
  const doc = documentPictureInPicture.window.document
  doc.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', code: 'KeyX', keyCode: 88, bubbles: true }))
})
await settle()
assert.equal((await panel()).count, 'Slide 3 of 5')

step('the slide before the last shows the closing slide')
await page.keyboard.press('ArrowRight')
await settle()
state = await panel()
assert.equal(state.count, 'Slide 4 of 5')
assert.match(state.slide, /Thanks! Questions\?/)
await screenshot('5-closing-slide')

step('the last slide says the presentation ends')
await page.keyboard.press('ArrowRight')
await settle()
state = await panel()
assert.equal(state.count, 'Slide 5 of 5')
assert.match(state.message, /End of presentation/)
await screenshot('6-end')

step('going back works')
await page.keyboard.press('ArrowLeft')
await settle()
assert.equal((await panel()).count, 'Slide 4 of 5')

step('R restarts from the panel')
await page.evaluate(() => {
  const doc = documentPictureInPicture.window.document
  doc.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', keyCode: 82, bubbles: true }))
})
await settle()
assert.equal((await panel()).count, 'Slide 1 of 5')

step('Escape ends the presentation and the panel waits again')
await page.evaluate(() => document.fullscreenElement && document.exitFullscreen())
await page.keyboard.press('Escape')
await settle()
state = await panel()
assert.equal(state.count, '')
assert.match(state.message, /Waiting for the presentation/)

step('the shortcut pressed in the panel starts it again')
await page.evaluate(() => {
  const doc = documentPictureInPicture.window.document
  const isApple = /Mac|iPhone|iPad/.test(navigator.platform)
  doc.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', keyCode: 80, metaKey: isApple, ctrlKey: !isApple, altKey: true, bubbles: true }),
  )
})
await page.waitForSelector('[data-presentation-mode]')
await settle()
assert.equal((await panel()).count, 'Slide 1 of 5')

step('toggling again closes the panel')
await page.click('#test-toggle', { force: true })
await page.waitForFunction(() => !documentPictureInPicture.window)

step('re-injecting the script toggles instead of redefining it')
await page.click('#test-toggle', { force: true })
await page.waitForFunction(() => Boolean(documentPictureInPicture.window))
await page.evaluate(() => documentPictureInPicture.window.close())
await page.waitForFunction(() => !documentPictureInPicture.window)

await context.close()
server.close()
await rm(profile, { recursive: true, force: true })
console.log('All checks passed')
