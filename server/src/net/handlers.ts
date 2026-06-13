// Socket.IO intent handlers: sessions, lobby, duel matchmaking and expedition flow.
//
// Duel loadout flow: the 60 s loadout screen runs entirely client-side BEFORE
// queue:join — both players arrive at the queue with their final loadout, so a
// FIFO match starts the battle immediately (no server-side loadout phase).

import {
  AMBUSH_CHANCE_ON_RECONNECT,
  DUEL_SUDDEN_DEATH_SEC,
  NPC_TEMPLATES,
  PVP_QUEUE_NPC_OFFER_SEC,
  validateLoadout,
  type BattleResult,
  type ErrorMsg,
  type Loadout,
  type Side,
} from '@stellar/shared'
import type { IBattleSim } from '../sim/api'
import { setupFromLoadout, setupFromNpc } from '../sim/setup'
import { RunManager, type NodeEntry } from '../run/runManager'
import { BattleHost } from './battleHost'
import type { GameServer, GameSocket, Player, SessionRegistry } from './sessions'

const LOBBY_ROOM = 'lobby'

export interface HandlerRegistry {
  /** Stops every live battle loop and queue timer (tests / shutdown). */
  shutdown(): void
}

export function registerHandlers(io: GameServer, sessions: SessionRegistry): HandlerRegistry {
  const duelQueue: Player[] = []
  const liveHosts = new Set<BattleHost>()

  const randomSeed = (): number => Math.floor(Math.random() * 0x7fffffff)

  const broadcastLobby = (): void => {
    io.to(LOBBY_ROOM).emit('lobby:state', {
      online: sessions.onlineCount(),
      queue: duelQueue.length,
    })
  }

  const dequeueDuel = (p: Player): void => {
    if (p.duelQueue) {
      clearInterval(p.duelQueue.waitTimer)
      p.duelQueue = null
    }
    const i = duelQueue.indexOf(p)
    if (i >= 0) duelQueue.splice(i, 1)
  }

  const takeWaitingOpponent = (p: Player): Player | null => {
    while (duelQueue.length > 0) {
      const candidate = duelQueue.shift()
      if (!candidate || candidate === p) continue
      if (candidate.duelQueue && candidate.socket) return candidate
      if (candidate.duelQueue) {
        clearInterval(candidate.duelQueue.waitTimer)
        candidate.duelQueue = null
      }
    }
    return null
  }

  const startHost = (host: BattleHost): void => {
    liveHosts.add(host)
    host.start()
  }

  const hostConfigBase = (onEnd: (result: BattleResult, sim: IBattleSim) => void) => ({
    seed: randomSeed(),
    firstBattle: false,
    onEnd,
  })

  const startDuel = (pa: Player, la: Loadout, pb: Player, lb: Loadout): void => {
    let host: BattleHost | null = null
    host = new BattleHost(
      setupFromLoadout(la, pa.name),
      setupFromLoadout(lb, pb.name),
      { a: pa, b: pb },
      {
        ...hostConfigBase((): void => {
          if (host) liveHosts.delete(host)
          broadcastLobby()
        }),
        mode: 'duel',
        pauseAllowed: false,
        suddenDeathSec: DUEL_SUDDEN_DEATH_SEC,
        backdropSeed: randomSeed(),
      },
    )
    startHost(host)
    broadcastLobby()
  }

  const startDuelVsNpc = (p: Player, loadout: Loadout): void => {
    const template = NPC_TEMPLATES[3]
    if (!template) return
    let host: BattleHost | null = null
    // Tactical pause IS allowed vs an NPC (GAME_SPEC §4.3); sudden death still applies.
    host = new BattleHost(
      setupFromLoadout(loadout, p.name),
      setupFromNpc(template),
      { a: p, b: null },
      {
        ...hostConfigBase((): void => {
          if (host) liveHosts.delete(host)
          broadcastLobby()
        }),
        mode: 'duel',
        pauseAllowed: true,
        suddenDeathSec: DUEL_SUDDEN_DEATH_SEC,
        backdropSeed: randomSeed(),
      },
    )
    startHost(host)
    broadcastLobby()
  }

  /** Persists the battle outcome into the run and routes the player to the next screen. */
  const finishExpeditionBattle = (
    p: Player,
    run: RunManager,
    side: Side,
    result: BattleResult,
    sim: IBattleSim,
    opts: { elite: boolean; boss: boolean; loot: boolean },
  ): void => {
    run.inBattle = false
    const won = result.winner === side
    const fled = result.reason === 'fled' && result.winner !== side
    if (won || fled) {
      const me = sim.shipState(side)
      run.absorbBattleState(me.hull, me.ammo, sim.crewExport(side))
    }
    if (won) {
      if (opts.boss) {
        run.markVictory()
        p.socket?.emit('run:state', run.publicState())
        p.socket?.emit('run:over', true, { column: run.column, scrap: run.scrapTotal })
        p.run = null
        return
      }
      if (opts.loot) run.applyVictoryLoot(opts.elite)
      p.socket?.emit('run:state', run.publicState())
      return
    }
    if (fled) {
      // Fleeing keeps the run alive but forfeits the node's loot (node already visited).
      p.socket?.emit('run:state', run.publicState())
      return
    }
    run.markDefeat()
    p.socket?.emit('run:over', false, { column: run.column, scrap: run.scrapTotal })
    p.run = null
  }

  const startRunBattle = (
    p: Player,
    run: RunManager,
    entry: Extract<NodeEntry, { kind: 'battle' }>,
  ): void => {
    run.inBattle = true
    let host: BattleHost | null = null
    host = new BattleHost(
      run.playerSetup(),
      setupFromNpc(entry.template),
      { a: p, b: null },
      {
        ...hostConfigBase((result, sim): void => {
          if (host) liveHosts.delete(host)
          finishExpeditionBattle(p, run, 'a', result, sim, {
            elite: entry.elite,
            boss: entry.boss,
            loot: true,
          })
        }),
        mode: 'expedition',
        pauseAllowed: true,
        suddenDeathSec: null,
        backdropSeed: run.currentNode().seed,
        firstBattle: entry.firstBattle,
      },
    )
    startHost(host)
  }

  /**
   * Reconnect ambush (GAME_SPEC §4.1 / §10.2): NPC of the current column. No loot on
   * victory so disconnect/reconnect cycles cannot be farmed for scrap.
   */
  const startAmbush = (p: Player, run: RunManager): void => {
    run.inBattle = true
    let host: BattleHost | null = null
    host = new BattleHost(
      run.playerSetup(),
      setupFromNpc(run.ambushTemplate()),
      { a: p, b: null },
      {
        ...hostConfigBase((result, sim): void => {
          if (host) liveHosts.delete(host)
          finishExpeditionBattle(p, run, 'a', result, sim, {
            elite: false,
            boss: false,
            loot: false,
          })
        }),
        mode: 'expedition',
        pauseAllowed: true,
        suddenDeathSec: null,
        backdropSeed: run.currentNode().seed,
      },
    )
    startHost(host)
    p.socket?.emit('battle:events', [
      {
        t: 'log',
        msg: '¡Emboscada! Mientras tu nave estaba a la deriva, una nave hostil te ha interceptado.',
      },
    ])
  }

  io.on('connection', (socket: GameSocket) => {
    let player: Player | null = null

    const sendError = (code: ErrorMsg['code'], msg: string): void => {
      socket.emit('error', { code, msg })
    }

    const requireBattle = (): { host: BattleHost; side: Side } | null => {
      if (player?.battle) return player.battle
      sendError('not_in_battle', 'No estás en ningún combate.')
      return null
    }

    const requireRun = (): RunManager | null => {
      if (player?.run) return player.run
      sendError('not_in_run', 'No tienes ninguna expedición activa.')
      return null
    }

    // --- Session -----------------------------------------------------------

    socket.on('session:hello', (token, cb) => {
      if (typeof cb !== 'function') return
      const p = sessions.resolve(typeof token === 'string' ? token : null)
      if (p.socket && p.socket !== socket) p.socket.disconnect(true)
      player = p
      p.socket = socket
      p.lastSeenMs = Date.now()
      cb(p.token)
      broadcastLobby()

      if (p.battle) {
        // Live battle: re-bind and replay battle:start with the current snapshot.
        if (p.run) socket.emit('run:state', p.run.publicState())
        p.battle.host.onReconnect(p.battle.side, socket)
      } else if (p.run) {
        if (p.run.isAlive && p.run.rng() < AMBUSH_CHANCE_ON_RECONNECT) {
          startAmbush(p, p.run)
        } else {
          socket.emit('run:state', p.run.publicState())
        }
      }
    })

    // --- Lobby -------------------------------------------------------------

    socket.on('lobby:subscribe', () => {
      void socket.join(LOBBY_ROOM)
      socket.emit('lobby:state', { online: sessions.onlineCount(), queue: duelQueue.length })
    })

    // --- Queue / mode entry --------------------------------------------------

    socket.on('queue:join', (mode, loadout) => {
      const p = player
      if (!p) return sendError('bad_intent', 'Identifícate primero.')
      if (p.battle) return sendError('bad_intent', 'Ya estás en combate.')
      if (p.duelQueue) return sendError('bad_intent', 'Ya estás en la cola de duelo.')

      let valid = false
      try {
        valid = validateLoadout(loadout).ok
      } catch {
        valid = false
      }
      if (!valid) return sendError('invalid_loadout', 'El equipamiento elegido no es válido.')

      if (mode === 'expedition') {
        if (p.run?.isAlive) {
          return sendError('bad_intent', 'Ya tienes una expedición en curso. Abandónala primero.')
        }
        p.run = new RunManager(setupFromLoadout(loadout, p.name), randomSeed())
        socket.emit('run:state', p.run.publicState())
        return
      }
      if (mode !== 'duel') return sendError('bad_intent', 'Modo de juego desconocido.')

      const opponent = takeWaitingOpponent(p)
      if (opponent?.duelQueue) {
        const opponentLoadout = opponent.duelQueue.loadout
        dequeueDuel(opponent)
        startDuel(opponent, opponentLoadout, p, loadout)
        return
      }
      const joinedAtMs = Date.now()
      const waitTimer = setInterval(() => {
        const secs = Math.round((Date.now() - joinedAtMs) / 1000)
        p.socket?.emit('queue:waiting', secs, secs >= PVP_QUEUE_NPC_OFFER_SEC)
      }, 1000)
      p.duelQueue = { loadout, joinedAtMs, waitTimer }
      duelQueue.push(p)
      broadcastLobby()
    })

    socket.on('queue:leave', () => {
      if (!player?.duelQueue) return
      dequeueDuel(player)
      broadcastLobby()
    })

    socket.on('queue:accept_npc', () => {
      const p = player
      if (!p?.duelQueue) return sendError('bad_intent', 'No estás en la cola de duelo.')
      if (Date.now() - p.duelQueue.joinedAtMs < PVP_QUEUE_NPC_OFFER_SEC * 1000) {
        return sendError('bad_intent', 'La oferta de combate contra IA aún no está disponible.')
      }
      const loadout = p.duelQueue.loadout
      dequeueDuel(p)
      startDuelVsNpc(p, loadout)
    })

    // --- Battle intents ------------------------------------------------------

    socket.on('battle:set_power', (system, value) => {
      const b = requireBattle()
      if (!b) return
      if (typeof system !== 'string' || typeof value !== 'number') return
      b.host.setPower(b.side, system, value)
    })

    socket.on('battle:set_target', (weaponSlot, roomId) => {
      const b = requireBattle()
      if (!b) return
      if (typeof weaponSlot !== 'number' || (roomId !== null && typeof roomId !== 'number')) return
      b.host.setTarget(b.side, weaponSlot, roomId)
    })

    socket.on('battle:toggle_autofire', (weaponSlot) => {
      const b = requireBattle()
      if (!b) return
      if (typeof weaponSlot !== 'number') return
      b.host.toggleAutofire(b.side, weaponSlot)
    })

    socket.on('battle:move_crew', (crewId, roomId) => {
      const b = requireBattle()
      if (!b) return
      if (typeof crewId !== 'string' || typeof roomId !== 'number') return
      b.host.moveCrew(b.side, crewId, roomId)
    })

    socket.on('battle:toggle_drone', (droneSlot) => {
      const b = requireBattle()
      if (!b) return
      if (typeof droneSlot !== 'number') return
      b.host.toggleDrone(b.side, droneSlot)
    })

    socket.on('battle:jump', (charging) => {
      const b = requireBattle()
      if (!b) return
      b.host.setJumpCharging(b.side, Boolean(charging))
    })

    socket.on('battle:pause', (paused) => {
      const b = requireBattle()
      if (!b) return
      if (!b.host.setPaused(Boolean(paused))) {
        sendError('pause_not_allowed', 'La pausa táctica no está permitida en este combate.')
      }
    })

    socket.on('battle:surrender', () => {
      const b = requireBattle()
      if (!b) return
      b.host.surrender(b.side)
    })

    // --- Expedition intents --------------------------------------------------

    socket.on('run:choose_node', (nodeId) => {
      const p = player
      const run = requireRun()
      if (!p || !run) return
      if (p.battle) return sendError('bad_intent', 'Estás en pleno combate.')
      const entry = run.enterNode(typeof nodeId === 'number' ? nodeId : -1)
      switch (entry.kind) {
        case 'invalid':
          return sendError('bad_intent', 'Ese nodo no es alcanzable desde tu posición.')
        case 'screen':
          return socket.emit('run:state', run.publicState())
        case 'battle':
          return startRunBattle(p, run, entry)
      }
    })

    socket.on('run:buy', (item) => {
      const run = requireRun()
      if (!run) return
      if (!item || typeof item !== 'object') return sendError('bad_intent', 'Compra no válida.')
      const out = run.buy(item)
      if (!out.ok) return sendError(out.code, out.msg)
      socket.emit('run:state', run.publicState())
    })

    socket.on('run:event_choice', (choiceIdx) => {
      const p = player
      const run = requireRun()
      if (!p || !run) return
      const res = run.resolveEventChoice(typeof choiceIdx === 'number' ? choiceIdx : -1)
      if (res === 'invalid') return sendError('bad_intent', 'Esa opción no está disponible.')
      socket.emit('run:state', run.publicState())
      if (res === 'dead') {
        socket.emit('run:over', false, { column: run.column, scrap: run.scrapTotal })
        p.run = null
      }
    })

    socket.on('run:continue', () => {
      const run = requireRun()
      if (!run) return
      run.continueRun()
      socket.emit('run:state', run.publicState())
    })

    socket.on('run:abandon', () => {
      const p = player
      const run = requireRun()
      if (!p || !run) return
      if (p.battle) return sendError('bad_intent', 'Ríndete o huye para salir del combate.')
      run.markDefeat()
      socket.emit('run:over', false, { column: run.column, scrap: run.scrapTotal })
      p.run = null
    })

    // --- Disconnect ----------------------------------------------------------

    socket.on('disconnect', () => {
      const p = player
      if (!p || p.socket !== socket) return
      p.socket = null
      p.lastSeenMs = Date.now()
      if (p.duelQueue) dequeueDuel(p)
      if (p.battle) p.battle.host.onDisconnect(p.battle.side)
      broadcastLobby()
    })
  })

  return {
    shutdown(): void {
      for (const host of liveHosts) host.dispose()
      liveHosts.clear()
      for (const p of sessions.all()) {
        if (p.duelQueue) {
          clearInterval(p.duelQueue.waitTimer)
          p.duelQueue = null
        }
      }
      duelQueue.length = 0
    },
  }
}
