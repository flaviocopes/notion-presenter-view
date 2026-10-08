const notionUrl = /^https:\/\/([a-z0-9-]+\.)*(notion\.so|notion\.com|notion\.site)\//

// The click or shortcut that triggers this listener counts as a user gesture
// in the page, which documentPictureInPicture.requestWindow() requires. The
// injection has to start synchronously in the listener to keep it.
// presenter.js normally loaded with the page already. Injecting it again is
// harmless, and covers tabs opened before the extension was installed.
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id || !notionUrl.test(tab.url ?? '')) return

  chrome.scripting
    .executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      files: ['presenter.js', 'toggle.js'],
    })
    .catch((error) => console.warn('Slide Lookout:', error))
})
