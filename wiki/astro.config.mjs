// @ts-check
import { defineConfig } from 'astro/config'

// The wiki is a static site mounted under /wiki of the game server.
//
// It builds straight into the client's public/ folder so that:
//   - `vite` (dev, :5173) serves it at /wiki/, and
//   - `vite build` copies it into client/dist/wiki, which the Express server
//     serves at /wiki/ in production.
// No server changes are needed: the game's "WIKI" menu button opens /wiki/.
export default defineConfig({
  base: '/wiki',
  outDir: '../client/public/wiki',
  trailingSlash: 'always',
  build: { format: 'directory' },
  // Plain <img> tags + files in public/ — no image service / sharp needed.
  devToolbar: { enabled: false },
})
