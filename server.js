import express from 'express'
import cors from 'cors'
import { createProxyMiddleware } from 'http-proxy-middleware'

const app = express()
const PORT = 3001

app.use(cors())

// Proxy all requests to whatever host the client sends in X-Proxy-Target
app.use('/', createProxyMiddleware({
  changeOrigin: true,
  router: (req) => req.headers['x-proxy-target'] ?? 'http://192.168.0.51:9080',
  on: {
    error: (err, req, res) => {
      console.error('Proxy error:', err.message)
      res.status(502).json({ error: err.message })
    },
  },
}))

app.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`)
})
