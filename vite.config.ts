import { homedir } from 'node:os'
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path'
import { createReadStream, promises as fs, readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const mimeTypes: Record<string, string> = {
  '.avif': 'image/avif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.m4v': 'video/x-m4v',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
}

function defaultDataDir() {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'EcomVisualStudio')
  if (process.platform === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'EcomVisualStudio')
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'EcomVisualStudio')
}

function storageRoot() {
  const locationPath = join(dirname(defaultDataDir()), 'EcomVisualStudio-location.json')
  try {
    const location = JSON.parse(readFileSync(locationPath, 'utf8')) as { active_path?: string }
    if (location.active_path) return resolve(location.active_path, 'storage')
  } catch {
    // The default data directory is used before the desktop app has written a location file.
  }
  return join(defaultDataDir(), 'storage')
}

function devFiles(): Plugin {
  return {
    name: 'ecom-dev-files',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/files/')) return next()

        let requested: string
        try {
          requested = decodeURIComponent(req.url.slice('/files/'.length).split('?')[0])
        } catch {
          res.statusCode = 400
          res.end('Invalid file path')
          return
        }
        const root = resolve(storageRoot())
        const file = resolve(root, normalize(requested))
        const rel = relative(root, file)
        if (!requested || rel === '..' || rel.startsWith(`..${sep}`)) {
          res.statusCode = 404
          res.end('Not found')
          return
        }

        let info
        try {
          info = await fs.stat(file)
          if (!info.isFile()) throw new Error('not a file')
        } catch {
          res.statusCode = 404
          res.end('Not found')
          return
        }

        const type = mimeTypes[extname(file).toLowerCase()] || 'application/octet-stream'
        res.setHeader('Content-Type', type)
        res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Cache-Control', 'no-cache')
        const range = req.headers.range
        let start = 0
        let end = info.size - 1
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range)
          if (!match) {
            res.statusCode = 416
            res.setHeader('Content-Range', `bytes */${info.size}`)
            res.end()
            return
          }
          if (match[1]) start = Number(match[1])
          if (match[2]) end = Number(match[2])
          else end = info.size - 1
          if (!match[1] && match[2]) {
            const suffix = Number(match[2])
            start = Math.max(0, info.size - suffix)
            end = info.size - 1
          }
          if (start > end || start >= info.size || end >= info.size) {
            res.statusCode = 416
            res.setHeader('Content-Range', `bytes */${info.size}`)
            res.end()
            return
          }
          res.statusCode = 206
          res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`)
        }
        res.setHeader('Content-Length', String(end - start + 1))
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        createReadStream(file, { start, end }).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [devFiles(), react(), tailwindcss()],
})
