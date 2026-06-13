// Battle host: wraps one BattleSim plus 0-2 player seats and the NPC controllers.
// Runs the 20 tps loop, broadcasts drained events and 10 Hz snapshots, relays
// validated intents, and applies disconnect policy (duel grace forfeit vs
// expedition autopilot). The sudden-death warning log is emitted by the sim
// itself (BattleSim.updateSuddenDeath) and reaches clients through drainEvents.

import {
  DISCONNECT_GRACE_SEC,
  SNAPSHOT_EVERY_TICKS,
  TICK_MS,
  type BattleEvent,
  type BattleResult,
  type GameMode,
  type Side,
  type SystemId,
} from '@stellar/shared'
import { NpcController } from '../ai/npc'
import type { IBattleSim, ShipSetup } from '../sim/api'
import { BattleSim } from '../sim/battle'
import type { GameSocket, Player } from './sessions'

const SIDES: Side[] = ['a', 'b']
/** NPC decisions run every 10 ticks (~0.5 s). */
const AI_UPDATE_EVERY_TICKS = 10

export interface BattleHostConfig {
  mode: GameMode
  pauseAllowed: boolean
  suddenDeathSec: number | null
  seed: number
  backdropSeed: number
  firstBattle: boolean
  /** Called once, after battle:end has been emitted to both seats. */
  onEnd: (result: BattleResult, sim: IBattleSim) => void
}

interface Seat {
  /** null = pure NPC seat. */
  player: Player | null
  /** NPC brain: permanent for NPC seats, autopilot while a player is disconnected. */
  npc: NpcController | null
  graceTimer: NodeJS.Timeout | null
}

export class BattleHost {
  readonly sim: IBattleSim
  private readonly seats: Record<Side, Seat>
  private timer: NodeJS.Timeout | null = null
  private loopCount = 0
  private ended = false

  constructor(
    setupA: ShipSetup,
    setupB: ShipSetup,
    players: { a: Player | null; b: Player | null },
    private readonly config: BattleHostConfig,
  ) {
    const sim = new BattleSim(setupA, setupB, {
      seed: config.seed,
      pauseAllowed: config.pauseAllowed,
      suddenDeathSec: config.suddenDeathSec,
    })
    this.sim = sim
    this.seats = { a: this.makeSeat('a', players.a), b: this.makeSeat('b', players.b) }
  }

  private makeSeat(side: Side, player: Player | null): Seat {
    return { player, npc: player ? null : new NpcController(this.sim, side), graceTimer: null }
  }

  /** Binds players, emits battle:start to connected seats and starts the tick loop. */
  start(): void {
    for (const side of SIDES) {
      const seat = this.seats[side]
      if (seat.player) {
        seat.player.battle = { host: this, side }
        this.sendStart(side, seat.player.socket)
      }
    }
    this.timer = setInterval(() => this.loop(), TICK_MS)
  }

  /** Tears the loop down without emitting anything (server shutdown). */
  dispose(): void {
    this.ended = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const side of SIDES) {
      const seat = this.seats[side]
      if (seat.graceTimer) clearTimeout(seat.graceTimer)
      seat.graceTimer = null
      if (seat.player?.battle?.host === this) seat.player.battle = null
    }
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------

  private loop(): void {
    this.loopCount += 1
    if (!this.sim.paused && this.sim.result === null) {
      this.sim.tick()
      if (this.sim.tickCount % AI_UPDATE_EVERY_TICKS === 0) {
        for (const side of SIDES) this.seats[side].npc?.update()
      }
    }
    const events = this.sim.drainEvents()
    if (events.length > 0) this.broadcastEvents(events)
    if (this.sim.result !== null) {
      this.end(this.sim.result)
      return
    }
    // 10 Hz even while paused, so intents issued during tactical pause render.
    if (this.loopCount % SNAPSHOT_EVERY_TICKS === 0) {
      for (const side of SIDES) {
        const socket = this.seats[side].player?.socket
        if (socket) socket.emit('battle:snapshot', this.sim.snapshotFor(side))
      }
    }
  }

  private end(result: BattleResult): void {
    if (this.ended) return
    this.ended = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const side of SIDES) {
      const seat = this.seats[side]
      if (seat.graceTimer) clearTimeout(seat.graceTimer)
      seat.graceTimer = null
      if (seat.player) {
        seat.player.battle = null
        seat.player.socket?.emit('battle:end', result, side)
      }
    }
    this.config.onEnd(result, this.sim)
  }

  private broadcastEvents(events: BattleEvent[]): void {
    for (const side of SIDES) this.seats[side].player?.socket?.emit('battle:events', events)
  }

  private sendStart(side: Side, socket: GameSocket | null): void {
    if (!socket) return
    const other: Side = side === 'a' ? 'b' : 'a'
    socket.emit('battle:start', {
      mode: this.config.mode,
      side,
      vsNpc: this.seats[other].player === null,
      backdropSeed: this.config.backdropSeed,
      snapshot: this.sim.snapshotFor(side),
      firstBattle: this.config.firstBattle,
    })
  }

  // ---------------------------------------------------------------------------
  // Intents (side comes from the validated player.battle binding)
  // ---------------------------------------------------------------------------

  setPower(side: Side, system: SystemId, value: number): void {
    this.sim.setPower(side, system, value)
  }

  setTarget(side: Side, weaponSlot: number, roomId: number | null): void {
    this.sim.setTarget(side, weaponSlot, roomId)
  }

  toggleAutofire(side: Side, weaponSlot: number): void {
    this.sim.toggleAutofire(side, weaponSlot)
  }

  moveCrew(side: Side, crewId: string, roomId: number): void {
    this.sim.moveCrew(side, crewId, roomId)
  }

  toggleDrone(side: Side, droneSlot: number): void {
    this.sim.toggleDrone(side, droneSlot)
  }

  toggleDoor(side: Side, doorId: number): void {
    this.sim.toggleDoor(side, doorId)
  }

  setJumpCharging(side: Side, charging: boolean): void {
    this.sim.setJumpCharging(side, charging)
  }

  surrender(side: Side): void {
    this.sim.surrender(side)
  }

  setPaused(paused: boolean): boolean {
    if (!this.config.pauseAllowed) return false
    this.sim.paused = paused
    return true
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  onDisconnect(side: Side): void {
    if (this.ended) return
    const seat = this.seats[side]
    if (this.config.mode === 'expedition') {
      // The NPC brain autopilots the absent player's ship; a frozen pause would
      // void the disconnect risk the GDD asks for, so the battle resumes.
      if (!seat.npc) seat.npc = new NpcController(this.sim, side)
      if (this.sim.paused) this.sim.paused = false
    } else {
      seat.graceTimer = setTimeout(() => {
        seat.graceTimer = null
        this.sim.forfeit(side)
      }, DISCONNECT_GRACE_SEC * 1000)
    }
  }

  /** Re-binds a returning socket: cancels grace/autopilot and replays battle:start. */
  onReconnect(side: Side, socket: GameSocket): void {
    const seat = this.seats[side]
    if (seat.graceTimer) {
      clearTimeout(seat.graceTimer)
      seat.graceTimer = null
    }
    if (seat.player) seat.npc = null
    this.sendStart(side, socket)
  }
}
