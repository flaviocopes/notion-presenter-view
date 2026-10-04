// Renders icons/icon.svg to the PNG sizes Chrome wants.
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'icons')
const svg = await readFile(path.join(dir, 'icon.svg'), 'utf8')

const browser = await chromium.launch()
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  )
  await page.screenshot({ path: path.join(dir, `icon-${size}.png`), omitBackground: true })
  await page.close()
}
await browser.close()
