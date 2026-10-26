// 3D low-poly world at the top of the war page: hills, trees, clouds, a sun, a pond and a few blocky animals
// wandering around. Everything is built from primitives (no model files). The layout and the animals are
// seeded by the day, so each day has its own little world. Returns a cleanup function.
import * as THREE from 'three'

// --- helpers ---------------------------------------------------------------------------------------------------

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash(text) {
  let h = 2166136261
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra })

function part(geometry, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}
const box = (w, h, d, material, x, y, z) => part(new THREE.BoxGeometry(w, h, d), material, x, y, z)

function gradientTexture(stops, width = 2, height = 256) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const grad = ctx.createLinearGradient(0, 0, 0, height)
  stops.forEach(([at, color]) => grad.addColorStop(at, color))
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, width, height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function glowTexture(color) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, color)
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// Ground height: a flat meadow in the middle where the animals play, rolling hills around it, rising
// further back.
function groundHeight(x, z) {
  const hills = Math.sin(x * 0.18) * 1.2 + Math.cos(z * 0.22 + x * 0.05) * 0.9 + Math.sin((x + z) * 0.11) * 1.4
  const away = Math.min(1, Math.max(0, (Math.hypot(x * 0.8, z) - 7) / 8))
  return hills * away * 1.3 + (z < -10 ? (-10 - z) * 0.35 : 0)
}

const POND = { x: 5.2, z: 1.2, r: 1.7 }

// --- scenery -----------------------------------------------------------------------------------------------------

function makeGround(random) {
  const geometry = new THREE.PlaneGeometry(90, 60, 70, 46)
  geometry.rotateX(-Math.PI / 2)
  const pos = geometry.attributes.position
  const colors = []
  const greens = [new THREE.Color('#8fd16a'), new THREE.Color('#7cc45a'), new THREE.Color('#9edb76'), new THREE.Color('#86c963')]
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    pos.setY(i, groundHeight(x, z))
    const c = greens[Math.floor(random() * greens.length)]
    colors.push(c.r, c.g, c.b)
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  const ground = new THREE.Mesh(geometry, mat('#ffffff', { vertexColors: true }))
  ground.receiveShadow = true
  return ground
}

function makeTree(random) {
  const tree = new THREE.Group()
  const trunk = part(new THREE.CylinderGeometry(0.16, 0.22, 1, 6), mat('#8b5a3c'), 0, 0.5, 0)
  tree.add(trunk)
  const leaf = mat(['#3f9b4f', '#4caf50', '#2e8b57', '#5cb85c'][Math.floor(random() * 4)])
  if (random() < 0.5) {
    // pine
    tree.add(part(new THREE.ConeGeometry(0.95, 1.4, 7), leaf, 0, 1.4, 0))
    tree.add(part(new THREE.ConeGeometry(0.72, 1.15, 7), leaf, 0, 2.05, 0))
    tree.add(part(new THREE.ConeGeometry(0.48, 0.9, 7), leaf, 0, 2.6, 0))
  } else {
    // round
    tree.add(part(new THREE.IcosahedronGeometry(0.95, 0), leaf, 0, 1.65, 0))
    tree.add(part(new THREE.IcosahedronGeometry(0.6, 0), leaf, 0.45, 1.3, 0.25))
  }
  tree.scale.setScalar(0.8 + random() * 0.6)
  return tree
}

function makeCloud(random) {
  const cloud = new THREE.Group()
  // Mostly self-lit so clouds stay bright white whichever side faces the camera.
  const white = mat('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.8 })
  const puffs = 3 + Math.floor(random() * 3)
  for (let i = 0; i < puffs; i++) {
    const r = 0.7 + random() * 0.7
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), white)
    puff.position.set(i * 0.9 - puffs * 0.45, random() * 0.4, random() * 0.6)
    cloud.add(puff)
  }
  return cloud
}

function makeFlower(random) {
  const flower = new THREE.Group()
  flower.add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), mat('#3f8f3f'), 0, 0.15, 0))
  const petal = mat(['#ff7eb6', '#ffd166', '#a78bfa', '#ff9f68', '#ffffff'][Math.floor(random() * 5)])
  flower.add(part(new THREE.IcosahedronGeometry(0.09, 0), petal, 0, 0.33, 0))
  return flower
}

// --- animals (blocky, facing +z) -------------------------------------------------------------------------------

function legs(material, positions, height) {
  return positions.map(([x, z]) => {
    const pivot = new THREE.Group()
    pivot.position.set(x, height, z)
    pivot.add(box(0.13, height, 0.13, material, 0, -height / 2, 0))
    return pivot
  })
}

const eyes = (y, z, spread) => [-spread, spread].map((x) => box(0.07, 0.08, 0.04, mat('#1f1f1f'), x, y, z))

function chicken() {
  const g = new THREE.Group()
  const white = mat('#fffaf0')
  g.add(box(0.62, 0.55, 0.75, white, 0, 0.6, 0))
  g.add(box(0.12, 0.4, 0.5, white, 0.36, 0.62, -0.02), box(0.12, 0.4, 0.5, white, -0.36, 0.62, -0.02))
  g.add(box(0.42, 0.42, 0.42, white, 0, 1.02, 0.3))
  g.add(box(0.1, 0.16, 0.24, mat('#e5484d'), 0, 1.31, 0.3))
  g.add(box(0.14, 0.1, 0.16, mat('#f5a623'), 0, 1.0, 0.58))
  g.add(box(0.08, 0.12, 0.06, mat('#e5484d'), 0, 0.86, 0.52))
  g.add(...eyes(1.08, 0.52, 0.12))
  const l = legs(mat('#f5a623'), [[0.14, 0], [-0.14, 0]], 0.33)
  g.add(...l)
  return { group: g, legs: l, speed: 1.3, hop: 0.22 }
}

function sheep() {
  const g = new THREE.Group()
  const wool = mat('#fbfbf6')
  g.add(box(0.95, 0.72, 1.2, wool, 0, 0.78, 0))
  g.add(box(0.8, 0.2, 1.0, wool, 0, 1.2, 0))
  const face = mat('#3a3a3a')
  g.add(box(0.46, 0.5, 0.42, face, 0, 0.98, 0.72))
  g.add(box(0.5, 0.18, 0.3, wool, 0, 1.24, 0.66))
  g.add(box(0.2, 0.08, 0.12, face, 0.33, 1.05, 0.66), box(0.2, 0.08, 0.12, face, -0.33, 1.05, 0.66))
  g.add(...eyes(1.04, 0.94, 0.12).map((e) => { e.material = mat('#ffffff'); return e }))
  const l = legs(face, [[0.3, 0.4], [-0.3, 0.4], [0.3, -0.4], [-0.3, -0.4]], 0.45)
  g.add(...l)
  return { group: g, legs: l, speed: 0.8, hop: 0.1 }
}

function pig() {
  const g = new THREE.Group()
  const pink = mat('#f6a9bd')
  g.add(box(0.9, 0.7, 1.15, pink, 0, 0.72, 0))
  g.add(box(0.62, 0.58, 0.48, pink, 0, 0.8, 0.72))
  g.add(box(0.3, 0.2, 0.1, mat('#ec8aa3'), 0, 0.74, 0.99))
  g.add(box(0.06, 0.06, 0.02, mat('#a8546a'), 0.07, 0.75, 1.05), box(0.06, 0.06, 0.02, mat('#a8546a'), -0.07, 0.75, 1.05))
  g.add(box(0.16, 0.16, 0.08, pink, 0.22, 1.13, 0.66), box(0.16, 0.16, 0.08, pink, -0.22, 1.13, 0.66))
  g.add(...eyes(0.92, 0.97, 0.16))
  g.add(box(0.08, 0.08, 0.2, pink, 0, 0.92, -0.62))
  const l = legs(pink, [[0.28, 0.38], [-0.28, 0.38], [0.28, -0.38], [-0.28, -0.38]], 0.38)
  g.add(...l)
  return { group: g, legs: l, speed: 0.9, hop: 0.12 }
}

function fox() {
  const g = new THREE.Group()
  const orange = mat('#f08a3c')
  const white = mat('#fff7ee')
  const dark = mat('#3b2a22')
  g.add(box(0.58, 0.52, 1.1, orange, 0, 0.62, 0))
  g.add(box(0.4, 0.3, 0.5, white, 0, 0.52, 0.3))
  g.add(box(0.56, 0.5, 0.5, orange, 0, 0.95, 0.66))
  g.add(box(0.34, 0.24, 0.3, white, 0, 0.84, 0.95))
  g.add(box(0.1, 0.08, 0.06, dark, 0, 0.9, 1.11))
  g.add(part(new THREE.ConeGeometry(0.13, 0.32, 4), orange, 0.17, 1.33, 0.62), part(new THREE.ConeGeometry(0.13, 0.32, 4), orange, -0.17, 1.33, 0.62))
  g.add(...eyes(1.02, 0.92, 0.14))
  const tail = new THREE.Group()
  tail.position.set(0, 0.75, -0.55)
  tail.rotation.x = 0.7
  tail.add(box(0.32, 0.32, 0.75, orange, 0, 0, -0.35), box(0.3, 0.3, 0.2, white, 0, 0, -0.8))
  g.add(tail)
  const l = legs(dark, [[0.18, 0.38], [-0.18, 0.38], [0.18, -0.38], [-0.18, -0.38]], 0.38)
  g.add(...l)
  return { group: g, legs: l, speed: 1.6, hop: 0.14, tail }
}

function bunny() {
  const g = new THREE.Group()
  const fur = mat('#f1efe9')
  g.add(box(0.55, 0.5, 0.7, fur, 0, 0.45, 0))
  g.add(box(0.46, 0.44, 0.42, fur, 0, 0.82, 0.3))
  g.add(box(0.12, 0.5, 0.08, fur, 0.12, 1.25, 0.25), box(0.12, 0.5, 0.08, fur, -0.12, 1.25, 0.25))
  g.add(box(0.06, 0.36, 0.02, mat('#f7b6c8'), 0.12, 1.25, 0.3), box(0.06, 0.36, 0.02, mat('#f7b6c8'), -0.12, 1.25, 0.3))
  g.add(box(0.08, 0.06, 0.04, mat('#f28aa5'), 0, 0.78, 0.52))
  g.add(box(0.2, 0.2, 0.16, mat('#ffffff'), 0, 0.5, -0.4))
  g.add(...eyes(0.88, 0.5, 0.13))
  const l = legs(fur, [[0.16, 0.22], [-0.16, 0.22], [0.16, -0.2], [-0.16, -0.2]], 0.22)
  g.add(...l)
  return { group: g, legs: l, speed: 1.4, hop: 0.32 }
}

const ANIMALS = [chicken, sheep, pig, fox, bunny]

// --- world ---------------------------------------------------------------------------------------------------------

export function createWorld(canvas, { seed = 'dailywars', won = false } = {}) {
  const random = rng(hash(seed))
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  const horizon = won ? '#d8fbe8' : '#ffe2cc'
  scene.background = gradientTexture(won
    ? [[0, '#7fd8f5'], [0.6, '#bff3e2'], [1, horizon]]
    : [[0, '#86c5ff'], [0.55, '#c9e3ff'], [0.85, '#ffd9c2'], [1, horizon]])
  scene.fog = new THREE.Fog(horizon, 30, 70)

  // Low, near-horizon view: sky (behind the title) above, meadow and animals below.
  const CAMERA = { y: 3.6, z: 12.5, lookY: 2.2, lookZ: -4 }
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120)
  camera.position.set(0, CAMERA.y, CAMERA.z)
  camera.lookAt(0, CAMERA.lookY, CAMERA.lookZ)

  scene.add(new THREE.HemisphereLight('#dff1ff', '#7fbf5f', 1.25))
  const sun = new THREE.DirectionalLight('#fff1d6', 2.2)
  sun.position.set(8, 13, -2) // light from the sun's side, so shadows fall toward the viewer
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 12, bottom: -10, near: 1, far: 50 })
  sun.shadow.bias = -0.0008
  scene.add(sun)

  // Sun in the sky with a soft glow.
  const sunBall = new THREE.Mesh(new THREE.IcosahedronGeometry(2.1, 1), new THREE.MeshBasicMaterial({ color: '#ffd166', fog: false }))
  sunBall.position.set(10, 8.5, -34)
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,214,120,0.85)'), fog: false, depthWrite: false }))
  glow.scale.set(13, 13, 1)
  glow.position.copy(sunBall.position)
  scene.add(glow, sunBall)

  scene.add(makeGround(random))

  // Pond.
  const pond = new THREE.Mesh(new THREE.CylinderGeometry(POND.r, POND.r * 1.05, 0.1, 18), mat('#6ec6f0', { roughness: 0.25, metalness: 0.1 }))
  pond.position.set(POND.x, 0.02, POND.z)
  pond.receiveShadow = true
  scene.add(pond)

  // Trees around the meadow (not in the middle where the animals play).
  const trees = []
  for (let i = 0; i < 70 && trees.length < 26; i++) {
    const x = (random() - 0.5) * 46
    const z = -24 + random() * 30
    if (Math.hypot(x * 0.8, z + 1) < 7.5 || Math.hypot(x - POND.x, z - POND.z) < POND.r + 1) continue
    const tree = makeTree(random)
    tree.position.set(x, groundHeight(x, z) - 0.05, z)
    tree.userData.phase = random() * Math.PI * 2
    scene.add(tree)
    trees.push(tree)
  }

  // Rocks and flowers.
  for (let i = 0; i < 8; i++) {
    const x = (random() - 0.5) * 22
    const z = -8 + random() * 14
    const rock = part(new THREE.DodecahedronGeometry(0.2 + random() * 0.25, 0), mat('#b9b4ad'), x, groundHeight(x, z) + 0.08, z)
    rock.rotation.set(random(), random(), random())
    scene.add(rock)
  }
  for (let i = 0; i < 40; i++) {
    const x = (random() - 0.5) * 20
    const z = -7 + random() * 13
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 0.2) continue
    const flower = makeFlower(random)
    flower.position.set(x, groundHeight(x, z), z)
    scene.add(flower)
  }

  // Clouds drifting across the sky.
  const clouds = []
  for (let i = 0; i < 6; i++) {
    const cloud = makeCloud(random)
    cloud.position.set(-26 + random() * 52, 8 + random() * 3, -16 - random() * 10)
    cloud.userData.speed = 0.25 + random() * 0.35
    scene.add(cloud)
    clouds.push(cloud)
  }

  // Animals: three or four of the five kinds, seeded by the day.
  const kinds = [...ANIMALS].sort(() => random() - 0.5).slice(0, 3 + Math.floor(random() * 2))
  const meadow = () => {
    for (;;) {
      const x = (random() - 0.5) * 15
      const z = -5 + random() * 9
      if (Math.hypot(x - POND.x, z - POND.z) > POND.r + 0.9) return { x, z }
    }
  }
  const animals = kinds.map((make, i) => {
    const a = make()
    const start = meadow()
    a.x = start.x
    a.z = start.z
    a.target = meadow()
    a.idle = random() * 2
    a.phase = random() * 10
    a.heading = random() * Math.PI * 2
    a.jumpOffset = i * 0.35
    a.group.position.set(a.x, groundHeight(a.x, a.z), a.z)
    scene.add(a.group)
    return a
  })

  // --- animation -------------------------------------------------------------------------------------------------

  const clock = new THREE.Clock()
  let frame = 0
  let visible = true

  const step = () => {
    const dt = Math.min(clock.getDelta(), 0.05)
    const t = clock.elapsedTime

    for (const tree of trees) tree.rotation.z = Math.sin(t * 0.9 + tree.userData.phase) * 0.03
    for (const cloud of clouds) {
      cloud.position.x += cloud.userData.speed * dt
      if (cloud.position.x > 28) cloud.position.x = -28
    }
    camera.position.x = Math.sin(t * 0.07) * 1.4
    camera.lookAt(0, CAMERA.lookY, CAMERA.lookZ)

    for (const a of animals) {
      let lift = 0
      let walking = false
      if (won) {
        // Victory: everyone faces the camera and jumps for joy.
        a.heading += (0 - a.heading) * Math.min(1, dt * 3)
        lift = Math.max(0, Math.sin((t + a.jumpOffset) * 5)) * 0.7
      } else if (a.idle > 0) {
        a.idle -= dt
      } else {
        const dx = a.target.x - a.x
        const dz = a.target.z - a.z
        const dist = Math.hypot(dx, dz)
        if (dist < 0.15) {
          a.idle = 1 + random() * 3
          a.target = meadow()
        } else {
          const stepLen = Math.min(dist, a.speed * dt)
          a.x += (dx / dist) * stepLen
          a.z += (dz / dist) * stepLen
          const want = Math.atan2(dx, dz)
          let turn = want - a.heading
          turn = Math.atan2(Math.sin(turn), Math.cos(turn))
          a.heading += turn * Math.min(1, dt * 6)
          a.phase += dt * a.speed * 7
          lift = Math.abs(Math.sin(a.phase)) * a.hop
          walking = true
        }
      }
      a.group.position.set(a.x, groundHeight(a.x, a.z) + lift, a.z)
      a.group.rotation.y = a.heading
      const swing = walking ? Math.sin(a.phase * 2) * 0.6 : 0
      a.legs.forEach((leg, i) => { leg.rotation.x = i % 2 ? swing : -swing })
      if (a.tail) a.tail.rotation.y = Math.sin(t * 4) * 0.3
      // Gentle breathing while resting.
      a.group.scale.y = walking ? 1 : 1 + Math.sin(t * 2.5 + a.jumpOffset) * 0.02
    }

    renderer.render(scene, camera)
  }

  const loop = () => {
    step()
    frame = visible && !document.hidden ? requestAnimationFrame(loop) : 0
  }
  const resume = () => {
    if (!frame && visible && !document.hidden && !reduceMotion) {
      clock.getDelta()
      frame = requestAnimationFrame(loop)
    }
  }

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    // Keep the meadow in view on narrow (portrait) cards.
    camera.fov = w / h < 1.6 ? 44 : 36
    camera.updateProjectionMatrix()
    if (reduceMotion || !frame) step()
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvas)
  const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; resume() })
  intersection.observe(canvas)
  const onVisibility = () => resume()
  document.addEventListener('visibilitychange', onVisibility)

  resize()
  if (reduceMotion) step()
  else resume()

  return () => {
    cancelAnimationFrame(frame)
    frame = -1
    resizeObserver.disconnect()
    intersection.disconnect()
    document.removeEventListener('visibilitychange', onVisibility)
    scene.traverse((obj) => {
      obj.geometry?.dispose()
      const materials = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : []
      materials.forEach((m) => { m.map?.dispose(); m.dispose() })
    })
    scene.background?.dispose?.()
    renderer.dispose()
  }
}
