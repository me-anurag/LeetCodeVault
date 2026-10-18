// Answers the popup's extraction requests on LeetCode problem pages.
;(function () {
  'use strict'
  if (window.__leetvaultContentLoaded) return
  window.__leetvaultContentLoaded = true

  const X = window.LeetVaultExtractor

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'LEETVAULT_EXTRACT') return false
    X.extractFromPage({ win: window })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) =>
        sendResponse({ ok: false, error: { code: err.code || 'extract_failed', message: err.message || String(err) } }),
      )
    return true // async response
  })
})()
