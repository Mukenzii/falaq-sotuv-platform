import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev the SPA runs on 5173 and the API stays on the Next server. Cookies
// ignore the port, so falaq_session set by :4300 is sent to :5173 too, and
// proxying /api keeps everything same-origin for fetch.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,                       // reachable from the phone on the LAN
    port: 5173,
    proxy: { '/api': { target: process.env.API_ORIGIN ?? 'http://localhost:4300', changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: true },
})
