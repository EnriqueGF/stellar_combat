// App factory: Express + http.Server + typed Socket.IO server, WITHOUT listen()
// so tests can bind to an ephemeral port. index.ts wires listen + prod statics.

import { createServer, type Server as HttpServer } from 'node:http'
import express, { type Express } from 'express'
import { Server } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@stellar/shared'
import { registerHandlers, type HandlerRegistry } from './net/handlers'
import { SessionRegistry, type GameServer } from './net/sessions'

export interface AppBundle {
  app: Express
  httpServer: HttpServer
  io: GameServer
  sessions: SessionRegistry
  handlers: HandlerRegistry
  /** Stops battle loops, queue timers, the session sweeper and the socket server. */
  close: () => void
}

export function createApp(): AppBundle {
  const app = express()
  const httpServer = createServer(app)
  const io: GameServer = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] },
  })
  const sessions = new SessionRegistry()
  const handlers = registerHandlers(io, sessions)

  const close = (): void => {
    handlers.shutdown()
    sessions.close()
    io.close()
  }

  return { app, httpServer, io, sessions, handlers, close }
}
