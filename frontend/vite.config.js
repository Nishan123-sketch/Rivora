import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Use 127.0.0.1 (IPv4) instead of "localhost". On Windows/Node 18+ "localhost"
// can resolve to ::1 (IPv6) first, while the backend may only answer on IPv4,
// which makes every /api request hang or fail even though the backend is running.
const BACKEND = 'http://127.0.0.1:5000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: BACKEND,
        changeOrigin: true,
        // Backend answers slowly while it is importing data; do not cut it off early.
        timeout: 60000,
        proxyTimeout: 60000,
        configure: (proxy) => {
          // When the backend is down Vite normally answers with an EMPTY 500, which the
          // app cannot explain. Return a clear JSON 503 instead.
          proxy.on('error', (err, req, res) => {
            console.error(`[proxy] ${req.method} ${req.url} -> ${BACKEND} failed: ${err.code || err.message}`)
            if (!res || typeof res.writeHead !== 'function' || res.headersSent) return
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              success: false,
              message: `Backend not reachable on ${BACKEND} (${err.code || err.message}). Start it with: cd backend && npm run dev`,
            }))
          })
        },
      },
    },
  },
})
