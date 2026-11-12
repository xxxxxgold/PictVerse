import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(__dirname),
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, '../renderer/src'),
      '@shared': resolve(__dirname, '../shared'),
      '@web': resolve(__dirname)
    }
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3000'
    }
  },
  build: {
    outDir: resolve(__dirname, '../../dist-web'),
    emptyOutDir: true
  }
})
