// Loads with every Notion page as a content script in the page's main world.
// It shows the "Open presenter view" button while you present, and toggle.js
// opens or closes the panel when you click the toolbar button or press the shortcut.
(() => {
  if (window.__notionPresenterView) return

  const isApple = /Mac|iPhone|iPad/.test(navigator.platform)
  const startShortcut = isApple ? '⌘⌥P' : 'Ctrl+Alt+P'

  // Keys Notion's presentation controls react to. When the panel has focus we
  // forward them to the page, so the arrows and presentation clickers still
  // change slides.
  const presentationKeys = new Set([
    'ArrowLeft',
    'ArrowRight',
    'PageUp',
    'PageDown',
    ' ',
    'Escape',
    'r',
    'R',
  ])

  const panelCss = `
    html, body { margin: 0; height: 100%; overflow: hidden; }
    .npv {
      box-sizing: border-box;
      height: 100%;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px 14px 14px;
      background: #191919;
      color: #e3e3e3;
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .npv-header, .npv-footer { display: flex; align-items: center; gap: 8px; }
    .npv-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #8f8f8f;
    }
    .npv-count { margin-left: auto; color: #bdbdbd; font-variant-numeric: tabular-nums; }
    .npv-stage {
      position: relative;
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .npv-slide {
      position: relative;
      overflow: hidden;
      border-radius: 6px;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12), 0 10px 30px rgba(0, 0, 0, 0.45);
    }
    .npv-content {
      position: absolute;
      top: 0;
      left: 0;
      width: 800px;
      transform-origin: top left;
      pointer-events: none;
    }
    .npv-embed {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      min-height: 120px;
      border-radius: 4px;
      background: rgba(128, 128, 128, 0.12);
      color: rgba(128, 128, 128, 0.9);
    }
    .npv-message {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      max-width: 320px;
      text-align: center;
      color: #8f8f8f;
    }
    .npv-message strong { color: #e3e3e3; font-size: 15px; font-weight: 600; }
    .npv-footer { justify-content: center; color: #8f8f8f; }
    .npv button {
      font: inherit;
      font-weight: 500;
      color: #fff;
      background: #2383e2;
      border: 0;
      border-radius: 6px;
      padding: 5px 12px;
      cursor: pointer;
    }
    .npv button:hover { background: #0077d4; }
    .npv kbd {
      font: inherit;
      padding: 1px 6px;
      border-radius: 4px;
      background: #2c2c2c;
      color: #d0d0d0;
    }
    .npv [hidden] { display: none !important; }
  `

  const messages = {
    waiting: `
      <strong>Waiting for the presentation</strong>
      <button type="button" data-action="start">Start presenting</button>
      <span>or press <kbd>${startShortcut}</kbd> in Notion</span>
      <span class="npv-hint" hidden>Notion didn't start. Click the page, then press <kbd>${startShortcut}</kbd>.</span>`,
    end: `
      <strong>End of presentation</strong>
      <span>This is the last slide.</span>`,
  }

  let pip = null
  let opening = false
  let ui = null
  let observer = null
  let resizeObserver = null
  let timer = 0
  let renderedKey = null
  let messageKind = null
  let leaveTimer = 0
  let fullscreenChangedAt = 0

  function toggle() {
    if (pip) pip.close()
    else open()
  }

  async function open() {
    if (opening) return
    if (!window.documentPictureInPicture) {
      alert('Notion Presenter View needs Chrome 116 or later.')
      return
    }

    opening = true
    updateButton()
    try {
      pip = await documentPictureInPicture.requestWindow({
        width: 520,
        height: 380,
        disallowReturnToOpener: true,
      })
    } catch (error) {
      console.warn('Notion Presenter View: could not open the panel.', error)
      return
    } finally {
      opening = false
      if (!pip) updateButton()
    }

    buildPanel()
    pip.addEventListener('pagehide', close)
    pip.addEventListener('resize', fit)
    pip.addEventListener('blur', checkStillHere)
    pip.document.addEventListener('keydown', onPanelKeydown)
    pip.document.addEventListener('click', onPanelClick)
    window.addEventListener('keydown', onPageKeydown, true)
    window.addEventListener('resize', fit)
    window.addEventListener('blur', checkStillHere)
    document.addEventListener('visibilitychange', checkStillHere)
    document.addEventListener('fullscreenchange', onFullscreenChange)

    observer = new MutationObserver(scheduleUpdate)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-hidden', 'data-slide-index', 'src'],
    })
    resizeObserver = new pip.ResizeObserver(fit)
    resizeObserver.observe(ui.content)

    update()
    updateButton()
  }

  function close() {
    observer?.disconnect()
    resizeObserver?.disconnect()
    clearTimeout(timer)
    clearTimeout(leaveTimer)
    window.removeEventListener('keydown', onPageKeydown, true)
    window.removeEventListener('resize', fit)
    window.removeEventListener('blur', checkStillHere)
    document.removeEventListener('visibilitychange', checkStillHere)
    document.removeEventListener('fullscreenchange', onFullscreenChange)
    pip = null
    ui = null
    observer = null
    resizeObserver = null
    timer = 0
    leaveTimer = 0
    renderedKey = null
    messageKind = null
    updateButton()
  }

  function onFullscreenChange() {
    fullscreenChangedAt = performance.now()
    update()
  }

  // The panel is only for the Notion tab: it closes when you switch to another
  // tab, window or app. Focus can flicker while macOS animates in and out of
  // fullscreen, so right after a fullscreen change we wait and check again.
  function checkStillHere() {
    clearTimeout(leaveTimer)
    leaveTimer = setTimeout(() => {
      if (!pip) return
      if (performance.now() - fullscreenChangedAt < 1500) return checkStillHere()
      const here = !document.hidden && (document.hasFocus() || pip.document.hasFocus())
      if (!here) pip.close()
    }, 500)
  }

  function buildPanel() {
    const doc = pip.document
    doc.title = 'Presenter view'

    const base = doc.createElement('base')
    base.href = document.baseURI
    doc.head.append(base)

    for (const sheet of document.styleSheets) copyStyleSheet(sheet, doc)

    const style = doc.createElement('style')
    style.textContent = panelCss
    doc.head.append(style)

    doc.body.innerHTML = `
      <div class="npv">
        <div class="npv-header">
          <span class="npv-label">Up next</span>
          <span class="npv-count"></span>
        </div>
        <div class="npv-stage">
          <div class="npv-slide" hidden><div class="npv-content"></div></div>
          <div class="npv-message" hidden></div>
        </div>
        <div class="npv-footer" hidden>
          <span>Click the slides and press <kbd>F</kbd> to go fullscreen</span>
        </div>
      </div>`

    ui = {
      count: doc.querySelector('.npv-count'),
      stage: doc.querySelector('.npv-stage'),
      slide: doc.querySelector('.npv-slide'),
      content: doc.querySelector('.npv-content'),
      message: doc.querySelector('.npv-message'),
      footer: doc.querySelector('.npv-footer'),
    }
  }

  function copyStyleSheet(sheet, doc) {
    if (sheet.disabled) return

    if (sheet.href) {
      const link = doc.createElement('link')
      link.rel = 'stylesheet'
      link.href = sheet.href
      if (sheet.media.mediaText) link.media = sheet.media.mediaText
      doc.head.append(link)
      return
    }

    try {
      const style = doc.createElement('style')
      if (sheet.media.mediaText) style.media = sheet.media.mediaText
      style.textContent = Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n')
      doc.head.append(style)
    } catch {}
  }

  // Notion keeps the previous, current and next slide in the DOM, each in a
  // [data-slide-index] element. Only the current one has aria-hidden="false".
  function readState() {
    const root = document.querySelector('[data-presentation-mode]')
    const active = root?.querySelector('[data-slide-index][aria-hidden="false"]')
    if (!active) return null

    const index = Number(active.dataset.slideIndex)
    return {
      root,
      index,
      next: root.querySelector(`[data-slide-index="${index + 1}"]`),
      total: readTotal(root),
    }
  }

  // The controls bar shows a localized "3 of 12" in a tabular-nums element.
  function readTotal(root) {
    const numbers = root.querySelector('[style*="tabular-nums"]')?.textContent.match(/\d+/g)
    return numbers?.length >= 2 ? Number(numbers.at(-1)) : null
  }

  function scheduleUpdate() {
    if (timer) return
    timer = setTimeout(() => {
      timer = 0
      update()
    }, 50)
  }

  function update() {
    if (!ui) return

    const state = readState()
    ui.footer.hidden = !state || Boolean(document.fullscreenElement)
    ui.count.textContent = !state
      ? ''
      : state.total
        ? `Slide ${state.index + 1} of ${state.total}`
        : `Slide ${state.index + 1}`

    if (!state) return showMessage('waiting')
    if (!state.next) return showMessage('end')

    const source = slideContent(state.next)
    const key = `${state.index}\n${source.innerHTML}`
    if (key !== renderedKey) {
      renderedKey = key
      ui.content.replaceChildren(cloneContent(source))
      copyTheme(state.root)
    }

    messageKind = null
    ui.message.hidden = true
    ui.slide.hidden = false
    fit()
  }

  function showMessage(kind) {
    ui.slide.hidden = true
    ui.message.hidden = false
    if (kind === messageKind) return
    messageKind = kind
    ui.message.innerHTML = messages[kind]
  }

  // Each slide is laid out at a fixed 800px width inside an element that
  // Notion scales with a CSS transform to fill the screen.
  function slideContent(wrapper) {
    const scaler = wrapper.querySelector('[style*="transform-origin"]')
    return scaler?.firstElementChild ?? wrapper
  }

  function cloneContent(source) {
    const clone = source.cloneNode(true)
    clone.removeAttribute('inert')
    clone.removeAttribute('aria-hidden')
    if (clone.hasAttribute('data-slide-index')) clone.removeAttribute('style')

    const images = source.querySelectorAll('img')
    clone.querySelectorAll('img').forEach((img, i) => {
      const src = images[i]?.currentSrc || img.src
      img.removeAttribute('srcset')
      img.removeAttribute('sizes')
      img.loading = 'eager'
      if (src) img.src = src
    })

    // Embeds would load a second copy of the page, video or document
    clone.querySelectorAll('iframe').forEach((frame) => {
      const placeholder = document.createElement('div')
      placeholder.className = 'npv-embed'
      placeholder.textContent = 'Embed'
      frame.replaceWith(placeholder)
    })

    clone.querySelectorAll('video, audio').forEach((media) => {
      media.removeAttribute('autoplay')
      media.preload = 'none'
    })

    clone.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'))
    return clone
  }

  // Notion's theme colors are CSS variables set on a class high up in the page,
  // so we copy their computed values onto the preview.
  function copyTheme(root) {
    const computed = getComputedStyle(root)
    for (const name of computed) {
      if (name.startsWith('--')) ui.slide.style.setProperty(name, computed.getPropertyValue(name))
    }
    ui.slide.style.backgroundColor = computed.backgroundColor
    ui.slide.style.color = computed.color
    ui.slide.style.colorScheme = computed.colorScheme
  }

  // Draws the slide the way Notion will show it on this screen, then shrinks
  // the whole screen down to fit the panel.
  function fit() {
    if (!ui || ui.slide.hidden) return

    const screenWidth = window.innerWidth
    const screenHeight = window.innerHeight
    const k = Math.min(ui.stage.clientWidth / screenWidth, ui.stage.clientHeight / screenHeight)
    ui.slide.style.width = `${screenWidth * k}px`
    ui.slide.style.height = `${screenHeight * k}px`

    const height = ui.content.offsetHeight
    const fill = height > 0 ? (screenHeight - 80) / height : Infinity
    const scale = Math.max(1, Math.min(screenWidth / 800, fill))
    const left = ((screenWidth - 800 * scale) / 2) * k
    const top = (Math.max(0, screenHeight - height * scale) / 2) * k
    ui.content.style.transform = `translate(${left}px, ${top}px) scale(${scale * k})`
  }

  function onPanelClick(event) {
    if (event.target.closest?.('[data-action="start"]')) startPresentation()
  }

  function onPanelKeydown(event) {
    const isStart = event.keyCode === 80 && event.altKey && (isApple ? event.metaKey : event.ctrlKey)
    if (isStart) {
      event.preventDefault()
      startPresentation()
      return
    }

    if (isFullscreenKey(event) && readState() && !document.fullscreenElement) {
      event.preventDefault()
      window.focus()
      return
    }

    if (!presentationKeys.has(event.key) || !readState()) return
    if (event.target.closest?.('button') && event.key === ' ') return
    event.preventDefault()
    sendKey(event)
  }

  // Opening the panel takes the tab out of fullscreen, and a click in the
  // panel doesn't count as a user gesture in the page. A keypress on the
  // slides does, so F gets fullscreen back.
  function onPageKeydown(event) {
    if (!event.isTrusted || !isFullscreenKey(event)) return
    if (!readState() || document.fullscreenElement) return
    if (event.target.closest?.('input, textarea, [contenteditable="true"]')) return
    event.preventDefault()
    event.stopPropagation()
    document.documentElement.requestFullscreen().catch(() => {})
  }

  function isFullscreenKey(event) {
    return event.key.toLowerCase() === 'f' && !event.metaKey && !event.ctrlKey && !event.altKey
  }

  // A click or keypress in the panel lets us focus the page, but Notion can't
  // go fullscreen from it, so the footer then asks for F on the slides.
  function startPresentation() {
    window.focus()
    sendKey({ key: 'p', code: 'KeyP', keyCode: 80, metaKey: isApple, ctrlKey: !isApple, altKey: true })
    setTimeout(() => {
      const hint = ui?.message.querySelector('.npv-hint')
      if (hint && !readState()) hint.hidden = false
    }, 1000)
  }

  function sendKey(init) {
    const target = document.activeElement ?? document.body
    for (const type of ['keydown', 'keyup']) {
      const event = new KeyboardEvent(type, {
        key: init.key,
        code: init.code,
        metaKey: Boolean(init.metaKey),
        ctrlKey: Boolean(init.ctrlKey),
        altKey: Boolean(init.altKey),
        shiftKey: Boolean(init.shiftKey),
        bubbles: true,
        cancelable: true,
        composed: true,
      })
      // Notion matches shortcuts on keyCode, which the constructor can't set
      Object.defineProperty(event, 'keyCode', { value: init.keyCode })
      Object.defineProperty(event, 'which', { value: init.keyCode })
      target.dispatchEvent(event)
    }
  }

  // The corner button the presenter sees while presenting without the panel.
  // Like Notion's own controls, it fades out when the mouse stops moving, so
  // it doesn't sit on the slides the audience sees.
  const buttonCss = `
    button {
      all: initial;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px 8px 10px;
      border-radius: 10px;
      background: #191919;
      color: #fff;
      font: 500 14px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif;
      -webkit-font-smoothing: antialiased;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1), 0 6px 20px rgba(0, 0, 0, 0.25);
      cursor: pointer;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }
    button.visible { opacity: 1; pointer-events: auto; }
    button:hover { background: #2a2a2a; }
    svg { width: 20px; height: 20px; flex: none; }
  `

  const buttonIcon = `
    <svg viewBox="12 20 104 86" aria-hidden="true">
      <rect x="16" y="24" width="66" height="46" rx="8" fill="#fff" fill-opacity="0.4"/>
      <rect x="42" y="50" width="70" height="52" rx="9" fill="#2383e2"/>
      <path d="M71 64 l12 12 l-12 12" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`

  let button = null
  let presenting = false
  let buttonHovered = false
  let buttonVisibleUntil = 0
  let buttonTimer = 0

  function setupButton() {
    const host = document.createElement('div')
    host.id = 'notion-presenter-view'
    host.style.cssText = 'position: fixed; right: 24px; bottom: 24px; z-index: 2147483000; display: none;'
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = `<style>${buttonCss}</style><button type="button">${buttonIcon}Open presenter view</button>`

    const element = shadow.querySelector('button')
    element.addEventListener('click', () => open())
    element.addEventListener('mouseenter', () => {
      buttonHovered = true
      updateButton()
    })
    element.addEventListener('mouseleave', () => {
      buttonHovered = false
      showButtonFor(2000)
    })

    button = { host, element }
    window.addEventListener('mousemove', () => showButtonFor(2000), { passive: true })
    setInterval(checkPresenting, 500)
    checkPresenting()
  }

  function checkPresenting() {
    const now = Boolean(document.querySelector('[data-presentation-mode]'))
    if (now && !presenting) showButtonFor(3000)
    presenting = now
    if (!button.host.isConnected) document.body.append(button.host)
    updateButton()
  }

  function showButtonFor(duration) {
    buttonVisibleUntil = performance.now() + duration
    clearTimeout(buttonTimer)
    buttonTimer = setTimeout(updateButton, duration + 20)
    updateButton()
  }

  function updateButton() {
    if (!button) return
    const shown = presenting && !pip && !opening
    const visible = shown && (buttonHovered || performance.now() < buttonVisibleUntil)
    button.host.style.display = shown ? 'block' : 'none'
    button.element.classList.toggle('visible', visible)
  }

  window.__notionPresenterView = { toggle }
  setupButton()
})()
