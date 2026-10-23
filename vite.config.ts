import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  root: resolve('src/renderer'),
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  plugins: [react(), tailwindcss()],
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    watch: {
      ignored: ['**/src-tauri/**']
    }
  },
  build: {
    outDir: resolve('dist'),
    emptyOutDir: true,
    target: 'es2022'
  }
})
