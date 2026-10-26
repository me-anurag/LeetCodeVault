import { useEffect, useRef, useState } from 'react'

// The 3D world behind the war card. three.js is loaded only here (its own chunk); if WebGL is not
// available the card simply keeps its gradient background.
export default function WarScene({ seed, won }) {
  const canvas = useRef(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cleanup = null
    let cancelled = false
    import('./world')
      .then(({ createWorld }) => {
        if (cancelled) return
        try {
          cleanup = createWorld(canvas.current, { seed, won })
        } catch {
          setFailed(true)
        }
      })
      .catch(() => setFailed(true))
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [seed, won])

  if (failed) return null
  return <canvas ref={canvas} className="war-scene absolute inset-0 h-full w-full" aria-hidden />
}
