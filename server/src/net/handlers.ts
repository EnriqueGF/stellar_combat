// Socket.IO intent handlers: sessions, lobby, duel matchmaking and expedition flow.
//
// Duel loadout flow: the 60 s loadout screen runs entirely client-side BEFORE
// queue:join — both players arrive at the queue with their final loadout, so a
// FIFO match starts the battle immediately (no server-side loadout phase).

import {
  AMBUSH_CHANCE_ON_RECONNECT,
  DUEL_SUDDEN_DEATH_SEC,
  LOADOUT_PRESETS,
  NPC_TEMPLATES,
  PVP_QUEUE_NPC_OFFER_SEC,
  validateLoadout,
  type BattleResult,
  type ErrorMsg,
  type Loadout,
  type Side,
  type SystemId,
} from '@stellar/shared'
import type { IBattleSim } from '../sim/api'
import { setupFromLoadout, setupFromNpc } from '../sim/setup'
import { RunManager, type NodeEntry } from '../run/runManager'
import type { AccountStore } from './accounts'
import { BattleHost } from './battleHost'
import type { GameServer, GameSocket, Player, SessionRegistry } from './sessions'

const LOBBY_ROOM = 'lobby'

export interface HandlerRegistry {
  /** Stops every live battle loop and queue timer (tests / shutdown). */
  shutdown(): void
}

export function registerHandlers(
  io: GameServer,
  sessions: SessionRegistry,
  accounts: AccountStore,
): HandlerRegistry {
  const duelQueue: Player[] = []
  const liveHosts = new Set<BattleHost>()

  const randomSeed = (): number => Math.floor(Math.random() * 0x7fffffff)

  /** Records the end of a run against the player's account (no-op for guests). */
  const recordRunOver = (p: Player, run: RunManager, victory: boolean): void => {
    accounts.updateStats(p.accountId, (s) => {
      s.bestColumn = Math.max(s.bestColumn, run.column)
      s.scrapEarned += run.scrapEarnedThisRun
      if (victory) s.runsWon += 1
    })
  }

  /** Records a finished duel for one seat (win/loss). */
  const recordDuel = (p: Player | null, won: boolean, crewLost: number): void => {
    if (!p) return
    accounts.updateStats(p.accountId, (s) => {
      if (won) {
        s.duelsWon += 1
        s.battlesWon += 1
      } else {
        s.duelsLost += 1
        s.battlesLost += 1
      }
      s.crewLost += crewLost
    })
  }

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
        ...hostConfigBase((result): void => {
          if (host) liveHosts.delete(host)
          if (result.winner !== null) {
            recordDuel(pa, result.winner === 'a', result.stats.a.crewLost)
            recordDuel(pb, result.winner === 'b', result.stats.b.crewLost)
          }
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
        ...hostConfigBase((result): void => {
          if (host) liveHosts.delete(host)
          if (result.winner !== null) recordDuel(p, result.winner === 'a', result.stats.a.crewLost)
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

  /** One-off guided practice battle: fixed beginner loadout vs the intro NPC, no run. */
  const startTutorial = (p: Player): void => {
    const template = NPC_TEMPLATES[0]
    const loadout = LOADOUT_PRESETS.sentinel[0]?.loadout
    if (!template || !loadout) return
    let host: BattleHost | null = null
    host = new BattleHost(setupFromLoadout(loadout, p.name), setupFromNpc(template), { a: p, b: null }, {
      ...hostConfigBase((): void => {
        if (host) liveHosts.delete(host)
        broadcastLobby()
      }),
      mode: 'tutorial',
      pauseAllowed: true,
      suddenDeathSec: null,
      backdropSeed: randomSeed(),
    })
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
    // Crew lost this battle counts toward the lifetime profile regardless of outcome.
    accounts.updateStats(p.accountId, (s) => {
      s.crewLost += result.stats[side].crewLost
    })
    if (won || fled) {
      const me = sim.shipState(side)
      const power: Partial<Record<SystemId, number>> = {}
      for (const s of me.systems) power[s.id] = s.power
      run.absorbBattleState(me.hull, me.ammo, sim.crewExport(side), power)
    }
    if (won) {
      accounts.updateStats(p.accountId, (s) => {
        s.battlesWon += 1
        s.bestColumn = Math.max(s.bestColumn, run.column)
      })
      if (opts.boss) {
        run.markVictory()
        recordRunOver(p, run, true)
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
    accounts.updateStats(p.accountId, (s) => {
      s.battlesLost += 1
    })
    recordRunOver(p, run, false)
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
      setupFromNpc(entry.template, entry.mod),
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
        // Encounter flavour (e.g. a landed sneak attack); emitted once the battle is live.
        introLog: entry.introLog,
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
        introLog:
          '¡Emboscada! Mientras tu nave estaba a la deriva, una nave hostil te ha interceptado.',
      },
    )
    startHost(host)
  }

  /**
   * FTL-style safe stop between nodes: the player's ship alone (no enemy), running
   * real-time so the crew can heal/repair and the jump drive charges. Jumping ends
   * the beacon (reason 'jumped') and the client opens the sector map. Any healing /
   * repairs / power changes are persisted back into the run on jump.
   */
  const startBeacon = (p: Player, run: RunManager): void => {
    const dummy = NPC_TEMPLATES[0]
    if (!dummy) return
    let host: BattleHost | null = null
    host = new BattleHost(run.playerSetup(), setupFromNpc(dummy), { a: p, b: null }, {
      ...hostConfigBase((result, sim): void => {
        if (host) liveHosts.delete(host)
        if (result.reason === 'jumped') {
          // Carry the prep (hull/ammo/crew HP/power) into the run, drop any node
          // rewards left untaken, then open the map.
          const me = sim.shipState('a')
          const power: Partial<Record<SystemId, number>> = {}
          for (const s of me.systems) power[s.id] = s.power
          run.absorbBattleState(me.hull, me.ammo, sim.crewExport('a'), power)
          run.settle()
          p.socket?.emit('run:state', run.publicState())
        } else {
          // Surrender at a beacon (escape menu) = abandon the expedition.
          run.markDefeat()
          recordRunOver(p, run, false)
          p.socket?.emit('run:over', false, { column: run.column, scrap: run.scrapTotal })
          p.run = null
        }
      }),
      mode: 'beacon',
      pauseAllowed: true,
      suddenDeathSec: null,
      backdropSeed: run.currentNode().seed,
    })
    startHost(host)
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

    const asString = (v: unknown): string => (typeof v === 'string' ? v : '')

    /** Links this session to an account after a successful auth, adopting its name. */
    const bindAccount = (token: string | undefined): void => {
      if (!player || !token) return
      const id = accounts.accountIdForToken(token)
      if (!id) return
      player.accountId = id
      const name = accounts.displayName(id)
      if (name) player.name = name
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
        // Live battle: re-bind and replay battle:start FIRST so the client sets
        // state.snapshot and routes into the Battle scene. Emitting run:state before
        // it would hijack navigation to the sector map — its resume rule fires while
        // snapshot is still null — and the battle:start that follows gets swallowed by
        // the in-flight transition, stranding the player at a menu while the server
        // keeps the battle alive (then everything reads "Ya estás en combate").
        p.battle.host.onReconnect(p.battle.side, socket)
        if (p.run) socket.emit('run:state', p.run.publicState())
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

    // --- Auth (optional accounts) ------------------------------------------

    socket.on('auth:register', (username, password, cb) => {
      if (typeof cb !== 'function') return
      const res = accounts.register(asString(username), asString(password))
      if (res.ok) bindAccount(res.token)
      cb(res)
    })

    socket.on('auth:login', (username, password, cb) => {
      if (typeof cb !== 'function') return
      const res = accounts.login(asString(username), asString(password))
      if (res.ok) bindAccount(res.token)
      cb(res)
    })

    socket.on('auth:resume', (token, cb) => {
      if (typeof cb !== 'function') return
      const res = accounts.resume(asString(token))
      if (res.ok) bindAccount(res.token)
      cb(res)
    })

    socket.on('auth:logout', () => {
      if (!player) return
      player.accountId = null
      player.name = `Capitán ${player.token.slice(0, 4).toUpperCase()}`
    })

    socket.on('auth:me', (cb) => {
      if (typeof cb !== 'function') return
      cb(player?.accountId ? accounts.profile(player.accountId) : null)
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
        accounts.updateStats(p.accountId, (s) => {
          s.runsStarted += 1
        })
        // FTL-style: the expedition opens at a beacon (the ship alone). The player
        // preps, then jumps to reveal the sector map. battle:start must precede
        // run:state so the client routes into the beacon (a run:state first would
        // send it to the sector map and swallow the battle:start mid-transition).
        startBeacon(p, p.run)
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

    socket.on('tutorial:start', () => {
      const p = player
      if (!p) return sendError('bad_intent', 'Identifícate primero.')
      if (p.battle) return sendError('bad_intent', 'Ya estás en combate.')
      if (p.duelQueue) dequeueDuel(p)
      startTutorial(p)
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

    socket.on('battle:toggle_door', (doorId) => {
      const b = requireBattle()
      if (!b) return
      if (typeof doorId !== 'number') return
      b.host.toggleDoor(b.side, doorId)
    })

    socket.on('battle:jump', () => {
      const b = requireBattle()
      if (!b) return
      b.host.requestJump(b.side)
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
        case 'screen': {
          // A store node opens a beacon with its wares in the in-ship economy panel;
          // a narrative event still uses the Event scene. battle:start before run:state.
          if (run.publicState().shopOffers !== null) startBeacon(p, run)
          return socket.emit('run:state', run.publicState())
        }
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
      if (p.battle) return sendError('bad_intent', 'Estás en pleno combate.')
      const res = run.resolveEventChoice(typeof choiceIdx === 'number' ? choiceIdx : -1)
      switch (res.kind) {
        case 'invalid':
          return sendError('bad_intent', 'Esa opción no está disponible.')
        case 'battle':
          // A pre-combat encounter choice that leads into the fight.
          return startRunBattle(p, run, res.entry)
        case 'dead':
          recordRunOver(p, run, false)
          socket.emit('run:state', run.publicState())
          socket.emit('run:over', false, { column: run.column, scrap: run.scrapTotal })
          p.run = null
          return
        case 'ok':
          return socket.emit('run:state', run.publicState())
      }
    })

    socket.on('run:continue', () => {
      const p = player
      const run = requireRun()
      if (!p || !run) return
      if (p.battle) return // already at a beacon / in battle (e.g. a double-click)
      run.continueRun()
      // FTL flow: leaving a node (event/shop/upgrade) drops the player at a beacon
      // (the ship alone) rather than straight onto the map; they jump from there.
      // battle:start must precede run:state (see startBeacon / the reconnect fix).
      startBeacon(p, run)
      socket.emit('run:state', run.publicState())
    })

    socket.on('run:abandon', () => {
      const p = player
      const run = requireRun()
      if (!p || !run) return
      if (p.battle) return sendError('bad_intent', 'Ríndete o huye para salir del combate.')
      run.markDefeat()
      recordRunOver(p, run, false)
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
