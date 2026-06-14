// Player session registry: token -> Player. Tokens persist in the client's
// localStorage, so a reconnecting socket re-binds to its existing Player.

import { randomUUID } from 'node:crypto'
import type { Server, Socket } from 'socket.io'
import type { ClientToServerEvents, Loadout, ServerToClientEvents, Side } from '@stellar/shared'
import type { BattleHost } from './battleHost'
import type { RunManager } from '../run/runManager'

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents>
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>

export interface DuelQueueEntry {
  loadout: Loadout
  joinedAtMs: number
  waitTimer: NodeJS.Timeout
}

export interface Player {
  token: string
  /** Player-visible captain name (Spanish). */
  name: string
  /** Linked account id when signed in; null for guests. */
  accountId: string | null
  socket: GameSocket | null
  lastSeenMs: number
  duelQueue: DuelQueueEntry | null
  battle: { host: BattleHost; side: Side } | null
  run: RunManager | null
}

const SWEEP_PERIOD_MS = 10 * 60 * 1000
const INACTIVE_MAX_MS = 60 * 60 * 1000

export class SessionRegistry {
  private readonly players = new Map<string, Player>()
  private readonly sweepTimer: NodeJS.Timeout

  constructor() {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_PERIOD_MS)
    this.sweepTimer.unref()
  }

  /** Returns the existing player for a known token or creates one with a fresh token. */
  resolve(token: string | null): Player {
    if (token) {
      const existing = this.players.get(token)
      if (existing) return existing
    }
    const freshToken = randomUUID()
    const player: Player = {
      token: freshToken,
      name: `Capitán ${freshToken.slice(0, 4).toUpperCase()}`,
      accountId: null,
      socket: null,
      lastSeenMs: Date.now(),
      duelQueue: null,
      battle: null,
      run: null,
    }
    this.players.set(freshToken, player)
    return player
  }

  onlineCount(): number {
    let n = 0
    for (const p of this.players.values()) if (p.socket) n += 1
    return n
  }

  all(): IterableIterator<Player> {
    return this.players.values()
  }

  /** Drops players idle for over an hour that hold no run nor battle. */
  private sweep(): void {
    const now = Date.now()
    for (const [token, p] of this.players) {
      if (!p.socket && !p.run && !p.battle && now - p.lastSeenMs > INACTIVE_MAX_MS) {
        this.players.delete(token)
      }
    }
  }

  close(): void {
    clearInterval(this.sweepTimer)
  }
}
