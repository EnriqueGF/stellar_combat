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
//   'error'           (err) — a server intent was rejected (un-gates busy UI)
// Use scOn(scene, event, fn) to auto-unsubscribe on scene shutdown.

import Phaser from 'phaser'
import { io } from 'socket.io-client'
import type { AuthResult, BattleResult, Side } from '@stellar/shared'
import type { BattleSceneData, Net, ResultSceneData, SceneKey, TypedSocket } from '../contracts'
import { getState } from '../state'
import { Toast } from '../ui/toast'
import { getAudio } from '../audio/engine'
import { routeToScene } from '../ui/transition'

const TOKEN_KEY = 'sc_token'
const AUTH_KEY = 'sc_auth'

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

export function readAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_KEY)
  } catch {
    return null
  }
}

function writeAuthToken(token: string): void {
  try {
    localStorage.setItem(AUTH_KEY, token)
  } catch {
    // Private mode: the account just won't persist across reloads.
  }
}

function clearAuthToken(): void {
  try {
    localStorage.removeItem(AUTH_KEY)
  } catch {
    // Nothing to do.
  }
}

/** Stores a successful auth result and notifies the menu via the 'sc' bus. */
export function applyAuthResult(res: AuthResult): void {
  if (res.ok && res.profile) {
    getState().profile = res.profile
    if (res.token) writeAuthToken(res.token)
  }
  sc.emit('auth')
}

/** Signs out: drops the account link locally and on the server. */
export function logoutAccount(): void {
  getNet().socket.emit('auth:logout')
  clearAuthToken()
  getState().profile = null
  sc.emit('auth')
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
      // Re-link a stored account (survives server restarts: the session token does not).
      const auth = readAuthToken()
      if (auth) {
        this.socket.emit('auth:resume', auth, (res: AuthResult) => {
          if (res.ok) {
            applyAuthResult(res)
          } else {
            // Stored token no longer valid (e.g. account file reset): drop it.
            clearAuthToken()
            getState().profile = null
            sc.emit('auth')
          }
        })
      }
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

/** Stops every active scene and starts `key` fresh, fading the active scene out
 *  first (see ui/transition.routeToScene). The fade-out/stop-all/start sequence
 *  preserves the previous instant semantics — nothing ends up stacked — while
 *  adding the cross-fade. Re-entrant calls during a fade are ignored by the
 *  transition guard, so a burst of routing events can't double-start a scene. */
function startScene(game: Phaser.Game, key: SceneKey, data?: object): void {
  routeToScene(game, key, data)
}

function buildResultData(result: BattleResult, yourSide: Side): ResultSceneData {
  const state = getState()
  // The Result screen only distinguishes expedition vs duel; tutorial never gets
  // here (it routes straight back to the menu).
  const mode: 'expedition' | 'duel' = state.mode === 'expedition' ? 'expedition' : 'duel'
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
    // The Battle scene owns the post-battle transition while active. This is the
    // fallback when battle:end arrives after Battle already stopped (edge case).
    if (!isActive(game, 'Battle') && !isActive(game, 'Result')) {
      if (state.mode === 'tutorial') startScene(game, 'MainMenu')
      else startScene(game, 'Result', buildResultData(result, yourSide))
    }
  })

  socket.on('run:state', (run) => {
    state.run = run
    const active = activeSceneKey(game)
    // Resume on reconnect: a live run arriving while still booting or at the menu
    // means the player closed the tab mid-expedition. Drop them onto the sector
    // map instead of stranding them with an invisible run that makes "start
    // expedition" fail with "you already have one". startScene stops Boot/MainMenu
    // first, so nothing ends up stacked (Boot waits for this before it would
    // otherwise start MainMenu — see Boot.ts).
    if ((active === 'Boot' || active === 'MainMenu') && run.alive && !state.snapshot) {
      startScene(game, 'SectorMap')
      return
    }
    // At a beacon (a Battle scene) run state changes (e.g. after a purchase) must
    // refresh the in-ship economy panel WITHOUT navigating — the beacon owns its
    // own exit (battle:end on jump). Normal battles ignore run:refresh.
    if (active === 'Battle') {
      sc.emit('run:refresh')
      return
    }
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
    // A rejected intent (e.g. a failed run:buy) sends 'error' instead of the
    // run:state that scenes wait on. Re-broadcast so a scene that optimistically
    // gated its UI (Shop/Upgrade 'busy') can un-gate and stay responsive.
    sc.emit('error', err)
  })
}
