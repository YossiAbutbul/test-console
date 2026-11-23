import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backend = 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  build: {
    // Vite's 500 kB default is meant for pages fetched over the internet;
    // this app is served from the same machine. Two chunks are over it on
    // purpose: the Reports page (~2.7 MB, the FortuneSheet spreadsheet,
    // loaded only when Reports opens) and the start-up bundle (~1.2 MB,
    // React + MUI + the shell). The limit sits just above the largest, so a
    // chunk that grows past today's sizes by accident still warns.
    chunkSizeWarningLimit: 3000,
  },
  server: {
    port: 5173,
    proxy: {
      '^/ble(/|$)': { target: backend, changeOrigin: true },
      '^/capabilities$': { target: backend, changeOrigin: true },
      '^/chat(/|$)': { target: backend, changeOrigin: true },
      '^/device(/|$)': { target: backend, changeOrigin: true },
      '^/instruments(/|$)': { target: backend, changeOrigin: true },
      '^/motor(/|$)': { target: backend, changeOrigin: true },
      '^/reports(/|$)': { target: backend, changeOrigin: true },
      '^/servo(/|$)': { target: backend, changeOrigin: true },
      '^/test(/|$)': { target: backend, changeOrigin: true },
      '^/health$': { target: backend, changeOrigin: true },
    },
  },
})
