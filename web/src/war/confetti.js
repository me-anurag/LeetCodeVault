// Small dependency-free confetti burst on a temporary full-screen canvas. Skipped when the user prefers
// reduced motion. `big` is for winning the whole war.
const COLORS = ['#fb923c', '#f472b6', '#a78bfa', '#38bdf8', '#34d399', '#facc15']

export function celebrate({ big = false } = {}) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '100' })
  document.body.appendChild(canvas)
  const dpr = window.devicePixelRatio || 1
  const w = (canvas.width = window.innerWidth * dpr)
  const h = (canvas.height = window.innerHeight * dpr)
  const ctx = canvas.getContext('2d')

  const count = big ? 220 : 90
  const pieces = Array.from({ length: count }, () => {
    // Big: rain from the top across the screen. Small: a burst from the lower middle.
    const angle = big ? Math.PI / 2 + (Math.random() - 0.5) * 0.6 : -Math.PI / 2 + (Math.random() - 0.5) * 1.6
    const speed = (big ? 3 + Math.random() * 4 : 9 + Math.random() * 8) * dpr
    return {
      x: big ? Math.random() * w : w / 2 + (Math.random() - 0.5) * 60 * dpr,
      y: big ? -20 * dpr - Math.random() * h * 0.4 : h * 0.72,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: (5 + Math.random() * 6) * dpr,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      round: Math.random() < 0.3,
    }
  })

  const duration = big ? 3800 : 2200
  const start = performance.now()
  const frame = (t) => {
    const elapsed = t - start
    ctx.clearRect(0, 0, w, h)
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, elapsed - duration * 0.65) / (duration * 0.35))
    for (const p of pieces) {
      p.vy += 0.25 * dpr // gravity
      p.vx *= 0.99
      p.x += p.vx
      p.y += p.vy
      p.rot += p.spin
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.fillStyle = p.color
      if (p.round) {
        ctx.beginPath()
        ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
      }
      ctx.restore()
    }
    if (elapsed < duration) requestAnimationFrame(frame)
    else canvas.remove()
  }
  requestAnimationFrame(frame)
}

export const ANIMALS = ['🐶', '🐱', '🐼', '🦊', '🐸', '🐧', '🐹', '🐰', '🐨', '🐯', '🦁', '🐵', '🦄', '🐻']
const RUNNERS = ['🐕', '🐈', '🐇', '🐿️', '🦔', '🐢', '🦆', '🐖', '🐑', '🦙']
const pick = (list) => list[Math.floor(Math.random() * list.length)]
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// A random animal pops up from the bottom of the screen, wiggles, and ducks back down.
export function animalPop() {
  if (reducedMotion()) return
  const el = document.createElement('div')
  el.className = 'animal-pop'
  el.setAttribute('aria-hidden', 'true')
  el.textContent = pick(ANIMALS)
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 2300)
}

// Winning the war: a parade of animals runs along the bottom of the screen.
export function animalParade() {
  if (reducedMotion()) return
  const runners = [...RUNNERS].sort(() => Math.random() - 0.5).slice(0, 6)
  runners.forEach((animal, i) => {
    const el = document.createElement('div')
    el.className = 'parade-animal'
    el.setAttribute('aria-hidden', 'true')
    el.style.animationDelay = `${i * 0.35}s`
    el.innerHTML = `<span>${animal}</span>`
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 3400 + i * 350 + 100)
  })
}

// Friendly lines shown after marking a question solved.
export const CHEERS = [
  'Nice work! 🌟',
  "You're on fire 🔥",
  'Brain gains 🧠',
  'Smooth! 😎',
  'One step closer 💪',
  'Look at you go 🚀',
  'Clean solve ✨',
  'Keep the flow 🌊',
  'That felt good, right? 😊',
  'Another one down 🎯',
]

export const randomCheer = () => CHEERS[Math.floor(Math.random() * CHEERS.length)]
