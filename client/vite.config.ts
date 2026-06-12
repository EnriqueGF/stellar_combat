import { defineConfig } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@stellar/shared': path.resolve(here, '../shared/src/index.ts'),
    },
  },
  optimizeDeps: {
    exclude: ['@stellar/shared'],
  },
  server: {
    port: 5173,
    fs: { allow: [path.resolve(here, '..')] },
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
})
