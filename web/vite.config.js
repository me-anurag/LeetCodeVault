import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(HERE, 'public')

// Emits sw.js with the list of built files to precache and a version hash of their contents.
function serviceWorker() {
  return {
    name: 'leetvault-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const hash = createHash('sha256')
      const files = []
      for (const name of Object.keys(bundle).sort()) {
        if (name.endsWith('.map')) continue
        const item = bundle[name]
        files.push('/' + name)
        hash.update(name).update(item.type === 'chunk' ? item.code : item.source)
      }
      for (const rel of fs.readdirSync(PUBLIC_DIR, { recursive: true }).sort()) {
        const full = path.join(PUBLIC_DIR, rel)
        if (!fs.statSync(full).isFile() || path.basename(rel).startsWith('_')) continue // skip _redirects
        const url = '/' + rel.split(path.sep).join('/')
        files.push(url)
        hash.update(url).update(fs.readFileSync(full))
      }
      const source = fs
        .readFileSync(path.join(HERE, 'sw.js'), 'utf8')
        .replace('__VERSION__', JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('__PRECACHE__', JSON.stringify(files))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  server: { port: 5173 },
})
