import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backend = 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '^/ble(/|$)': { target: backend, changeOrigin: true },
      '^/device(/|$)': { target: backend, changeOrigin: true },
      '^/instruments(/|$)': { target: backend, changeOrigin: true },
      '^/test(/|$)': { target: backend, changeOrigin: true },
      '^/health$': { target: backend, changeOrigin: true },
    },
  },
})
