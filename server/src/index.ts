// Server entry point: listens on SERVER_PORT; serves the built client
// (client/dist) with an index.html fallback whenever that build exists,
// so production works out of the box and dev (vite on 5173) is unaffected.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { SERVER_PORT } from '@stellar/shared'
import { createApp } from './app'

const { app, httpServer } = createApp()

const here = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(here, '../../client/dist')
if (existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

httpServer.listen(SERVER_PORT, () => {
  console.log(`[stellar-combat] server listening on http://localhost:${SERVER_PORT}`)
})
