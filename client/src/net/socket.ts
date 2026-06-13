// Socket.IO client (Net contract) + GLOBAL server-event -> scene routing.
//
// ============================ NAVIGATION MAP =================================
// Registered ONCE via installRouting(game) (called from Boot after ready()).
//
// battle:start   -> state.mode/state.snapshot updated, loot baseline recorded,
//                   ALL active scenes stopped, scene.start('Battle', {start}).
//                   Fires from ANY scene (covers ambush-on-reconnect).
// battle:end     -> stored in state (lastResult/lastResultSide) and re-emitted
//                   on the local 'sc' bus. If the Battle scene is ACTIVE it
//                   owns the transition to Result (do NOT navigate here).
//                   If Battle is NOT active (edge: event arrived after a stop),
//                   routing starts Result itself.
// battle:snapshot-> state.snapshot updated + re-emitted on 'sc' (Battle reads).
// battle:events  -> re-emitted on 'sc' (Battle scene consumes).
// run:state      -> state.run updated. Navigation ONLY when the active scene is
//                   one of {Loadout, SectorMap, Event, Shop, Upgrade}:
//                     run.event != null OR run.eventResult != null -> Event
//                     else run.shopOffers != null                  -> Shop
//                     else active scene is Upgrade                 -> stay in
//                          Upgrade (purchases refresh it; the player leaves
//                          via its CONTINUAR button, which navigates locally
//                          to SectorMap right after emitting run:continue)
//                     else                                         -> SectorMap
//                   If the target scene is already active, 'run:refresh' is
//                   emitted on the 'sc' bus instead (scenes re-render).
//                   While in Battle/Result/MainMenu only state is stored;
//                   those scenes pull from state when they need it.
// run:over       -> summary stored in state.runOver + 'run:over' on the bus.
//                   If neither Battle nor Result is active (e.g. run:abandon
//                   from SectorMap), navigate to MainMenu with a toast;
//                   otherwise Battle/Result consult state on their own.
// lobby:state    -> state.lobby + 'lobby' on the bus (MainMenu counter).
// queue:waiting  -> 'queue:waiting' on the bus (Loadout matchmaking overlay).
// error          -> global toast (+ 'error' SFX).
// =============================================================================
//
// 'sc' bus events (payloads):
//   'lobby'           (LobbyState)
//   'queue:waiting'   (secondsWaited: number, npcOfferAvailable: boolean)
//   'battle:end'      (result: BattleResult, yourSide: Side)
//   'battle:snapshot' (snap: BattleSnapshot)
//   'battle:events'   (events: BattleEvent[])
//   'run:refresh'     ()    — state.run changed; active run scene re-renders
//   'run:over'        ()    — state.runOver is set
// Use scOn(scene, event, fn) to auto-unsubscribe on scene shutdown.

import Phaser from 'phaser'
import { io } from 'socket.io-client'
import type { BattleResult, Side } from '@stellar/shared'
import type { BattleSceneData, Net, ResultSceneData, SceneKey, TypedSocket } from '../contracts'
import { getState } from '../state'
import { Toast } from '../ui/toast'
import { getAudio } from '../audio/engine'

const TOKEN_KEY = 'sc_token'

/** Local event bus connecting net routing with whichever scene is active. */
export const sc = new Phaser.Events.EventEmitter()

/** Subscribes to the 'sc' bus and unsubscribes automatically on scene shutdown. */
export function scOn(
  scene: Phaser.Scene,
  event: string,
  fn: (...args: never[]) => void,
): void {
  sc.on(event, fn)
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    sc.off(event, fn)
  })
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function writeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Private mode: session won't survive reloads, but play continues.
  }
}

class NetImpl implements Net {
  readonly socket: TypedSocket
  private readonly readyPromise: Promise<void>
  private resolveReady: (() => void) | null = null
  private everConnected = false

  constructor() {
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve
    })
    // Same origin: in dev the Vite proxy forwards /socket.io to the server.
    this.socket = io() as TypedSocket
    this.socket.on('connect', () => {
      this.hello()
    })
    this.socket.on('disconnect', () => {
      Toast.show('Conexión perdida. Reintentando…', 'warn')
    })
  }

  ready(): Promise<void> {
    return this.readyPromise
  }

  private hello(): void {
    this.socket.emit('session:hello', readToken(), (token: string) => {
      writeToken(token)
      this.socket.emit('lobby:subscribe')
      if (this.resolveReady) {
        this.resolveReady()
        this.resolveReady = null
      } else if (this.everConnected) {
        Toast.show('Reconectado.', 'info')
      }
      this.everConnected = true
    })
  }
}

let net: NetImpl | null = null

export function getNet(): Net {
  if (net === null) net = new NetImpl()
  return net
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

const RUN_ROUTED_SCENES: ReadonlySet<string> = new Set([
  'Loadout',
  'SectorMap',
  'Event',
  'Shop',
  'Upgrade',
])

function activeSceneKey(game: Phaser.Game): string | null {
  const scenes = game.scene.getScenes(true)
  const top = scenes[scenes.length - 1]
  return top ? top.scene.key : null
}

function isActive(game: Phaser.Game, key: SceneKey): boolean {
  return game.scene.getScenes(true).some((s) => s.scene.key === key)
}

/** Stops every active scene and starts `key` fresh with the given data. */
function startScene(game: Phaser.Game, key: SceneKey, data?: object): void {
  for (const s of game.scene.getScenes(true)) {
    s.scene.stop()
  }
  game.scene.start(key, data)
}

function buildResultData(result: BattleResult, yourSide: Side): ResultSceneData {
  const state = getState()
  const mode = state.mode ?? 'duel'
  let bossNode = false
  if (state.run) {
    const current = state.run.sector.nodes.find((n) => n.id === state.run?.currentNodeId)
    bossNode = current?.type === 'boss'
  }
  return {
    result,
    yourSide,
    mode,
    runContinues: mode === 'expedition' && result.winner === yourSide && !bossNode,
  }
}

let routingInstalled = false

export function installRouting(game: Phaser.Game): void {
  if (routingInstalled) return
  routingInstalled = true
  const socket = getNet().socket
  const state = getState()

  socket.on('lobby:state', (lobby) => {
    state.lobby = lobby
    sc.emit('lobby', lobby)
  })

  socket.on('queue:waiting', (secondsWaited, npcOfferAvailable) => {
    sc.emit('queue:waiting', secondsWaited, npcOfferAvailable)
  })

  socket.on('battle:start', (msg) => {
    state.mode = msg.mode
    state.snapshot = msg.snapshot
    state.lastBattleVsNpc = msg.vsNpc
    state.lastResult = null
    state.lastResultSide = null
    if (state.run) {
      state.scrapAtBattleStart = state.run.scrap
      state.ammoAtBattleStart = state.run.ammo
    }
    const data: BattleSceneData = { start: msg }
    startScene(game, 'Battle', data)
  })

  socket.on('battle:snapshot', (snap) => {
    state.snapshot = snap
    sc.emit('battle:snapshot', snap)
  })

  socket.on('battle:events', (events) => {
    sc.emit('battle:events', events)
  })

  socket.on('battle:end', (result, yourSide) => {
    state.lastResult = result
    state.lastResultSide = yourSide
    sc.emit('battle:end', result, yourSide)
    // The Battle scene owns the Battle -> Result transition while active.
    if (!isActive(game, 'Battle') && !isActive(game, 'Result')) {
      startScene(game, 'Result', buildResultData(result, yourSide))
    }
  })

  socket.on('run:state', (run) => {
    state.run = run
    const active = activeSceneKey(game)
    if (active === null || !RUN_ROUTED_SCENES.has(active)) return
    let target: SceneKey
    if (run.event !== null || run.eventResult !== null) target = 'Event'
    else if (run.shopOffers !== null) target = 'Shop'
    else if (active === 'Upgrade') target = 'Upgrade'
    else target = 'SectorMap'
    if (active === target) sc.emit('run:refresh')
    else startScene(game, target)
  })

  socket.on('run:over', (victory, summary) => {
    state.runOver = { victory, column: summary.column, scrap: summary.scrap }
    sc.emit('run:over')
    if (!isActive(game, 'Battle') && !isActive(game, 'Result')) {
      state.run = null
      state.mode = null
      startScene(game, 'MainMenu')
      Toast.show(
        victory ? '¡Expedición completada con éxito!' : 'Expedición terminada.',
        victory ? 'info' : 'warn',
      )
    }
  })

  socket.on('error', (err) => {
    getAudio().play('error')
    Toast.show(err.msg, 'error')
  })
}
