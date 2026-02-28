import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/v1': {
        target: 'http://192.168.0.51:9080',
        changeOrigin: true,
      },
    },
  },
})
