import { useEffect } from 'react'

// Installable app + automatic updates. The service worker (generated at build time, see vite.config.js)
// changes whenever a new version is deployed. The page checks for it on open, when it comes back to the
// foreground, and every 30 minutes, then switches over and reloads, but never while an edit is unsaved.

let unsaved = 0

// Mark the calling component as holding unsaved edits while `dirty` is true.
export function useUnsaved(dirty) {
  useEffect(() => {
    if (!dirty) return
    unsaved++
    return () => { unsaved-- }
  }, [dirty])
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const sw = navigator.serviceWorker
  const hadController = Boolean(sw.controller) // false on the very first visit: nothing to reload then
  let reloading = false
  sw.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true
    window.location.reload()
  })

  const activate = (worker) => {
    if (unsaved > 0) return void setTimeout(() => activate(worker), 2000)
    worker.postMessage('SKIP_WAITING')
  }

  window.addEventListener('load', async () => {
    let reg
    try {
      reg = await sw.register('/sw.js')
    } catch {
      return
    }
    if (reg.waiting && sw.controller) activate(reg.waiting)
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && sw.controller) activate(worker)
      })
    })
    const check = () => reg.update().catch(() => {})
    setInterval(check, 30 * 60 * 1000)
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check())
  })
}
