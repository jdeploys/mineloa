import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [],
    build: {
      externalizeDeps: false,
      rollupOptions: { external: ['electron', 'better-sqlite3', '@napi-rs/keyring'] },
    },
  },
  preload: {
    // Sandboxed preloads cannot require arbitrary npm packages. Bundle the
    // contract validators into the preload instead of externalizing them.
    plugins: [],
    build: { externalizeDeps: false, rollupOptions: { external: ['electron'] } },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
  },
})
