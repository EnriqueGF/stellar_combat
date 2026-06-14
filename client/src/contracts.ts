// Contracts between client modules so they can be built in parallel:
//  - net/socket.ts + state (agent "shell") implements Net & Settings.
//  - vfx/* (agent "vfx") implements the VFX classes.
//  - audio/* (agent "audio") implements AudioEngine.
//  - scenes consume all of the above.
// Scene keys and scene-start payloads are also pinned here.

import type Phaser from 'phaser'
import type {
  BattleResult,
  BattleSnapshot,
  BattleStartMsg,
  ClientToServerEvents,
  GameMode,
  PlanetBiome,
  RunStatePublic,
  ServerToClientEvents,
  Side,
} from '@stellar/shared'
import type { Socket } from 'socket.io-client'

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

export type SceneKey =
  | 'Boot'
  | 'MainMenu'
  | 'Loadout'
  | 'SectorMap'
  | 'Battle'
  | 'Event'
  | 'Shop'
  | 'Upgrade'
  | 'Result'

export interface LoadoutSceneData {
  mode: 'expedition' | 'duel'
  /** Duel: seconds to confirm before auto-submit. */
  timeoutSec: number | null
}

export interface BattleSceneData {
  start: BattleStartMsg
}

export interface ResultSceneData {
  result: BattleResult
  yourSide: Side
  mode: 'expedition' | 'duel'
  /** Present when the run continues (victory in expedition). */
  runContinues: boolean
}

// Event/Shop/Upgrade/SectorMap scenes read the latest RunStatePublic from GameState.

// ---------------------------------------------------------------------------
// Net (implemented in net/socket.ts; singleton via getNet())
// ---------------------------------------------------------------------------

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>

export interface Net {
  readonly socket: TypedSocket
  /** Resolves once session:hello handshake stored/refreshed the token. */
  ready(): Promise<void>
}

// ---------------------------------------------------------------------------
// Client-global state (implemented in state.ts)
// ---------------------------------------------------------------------------

export interface GameSettings {
  masterVolume: number // 0..1
  musicVolume: number
  sfxVolume: number
  crtEnabled: boolean
  uiScale: number // menus only; Battle scene ignores it
  tutorialDone: boolean
}

export interface GameStateStore {
  settings: GameSettings
  saveSettings(): void
  /** Latest run state pushed by the server (null outside expeditions). */
  run: RunStatePublic | null
  /** Latest battle snapshot (Battle scene reads between socket pushes). */
  snapshot: BattleSnapshot | null
  mode: GameMode | null
}

// ---------------------------------------------------------------------------
// VFX (implemented in vfx/*)
// ---------------------------------------------------------------------------

/** Procedural pixelated space backdrop: stars (3 parallax layers), nebula, planet. */
export interface ISpaceBackdrop {
  update(dtMs: number): void
  destroy(): void
}
export type SpaceBackdropCtor = new (
  scene: Phaser.Scene,
  seed: number,
  biome: PlanetBiome,
  opts?: { planetX?: number; planetY?: number; planetScale?: number },
) => ISpaceBackdrop

/** Hexagonal shield bubble around a ship rect. */
export interface IShieldBubble {
  setLayers(current: number, max: number): void
  /** Impact ripple at the given angle (radians, from bubble center). */
  ripple(angle: number): void
  destroy(): void
}
export type ShieldBubbleCtor = new (
  scene: Phaser.Scene,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
) => IShieldBubble

export type ProjectileVisualKind = 'laser' | 'kinetic' | 'missile' | 'bomb' | 'drone_shot'

/** Fire-and-forget effects namespace (implemented in vfx/fx.ts as plain functions). */
export interface FxApi {
  projectile(
    scene: Phaser.Scene,
    kind: ProjectileVisualKind,
    from: { x: number; y: number },
    to: { x: number; y: number },
    travelMs: number,
    color: number,
  ): void
  beam(
    scene: Phaser.Scene,
    from: { x: number; y: number },
    toA: { x: number; y: number },
    toB: { x: number; y: number },
    color: number,
    durationMs: number,
  ): void
  explosion(scene: Phaser.Scene, x: number, y: number, size: 'small' | 'big'): void
  missDeflect(scene: Phaser.Scene, x: number, y: number): void
  intercept(scene: Phaser.Scene, x: number, y: number): void
  damageNumber(scene: Phaser.Scene, x: number, y: number, amount: number, color: number): void
  screenShake(scene: Phaser.Scene, intensity: number): void
}

/** CRT overlay (scanlines + vignette), toggleable. */
export interface ICrtOverlay {
  setEnabled(on: boolean): void
  destroy(): void
}
export type CrtOverlayCtor = new (scene: Phaser.Scene) => ICrtOverlay

// ---------------------------------------------------------------------------
// Audio (implemented in audio/engine.ts; singleton via getAudio())
// ---------------------------------------------------------------------------

export type SfxName =
  | 'laser'
  | 'gauss'
  | 'missile'
  | 'bomb'
  | 'explosion'
  | 'shield_hit'
  | 'shield_down'
  | 'shield_up'
  | 'intercept'
  | 'miss'
  | 'alarm'
  | 'click'
  | 'hover'
  | 'heal'
  | 'levelup'
  | 'jump'
  | 'purchase'
  | 'error'
  | 'victory'
  | 'defeat'
  | 'door'
  | 'battle_start'
  | 'repair'
  | 'whoosh'

export interface IAudioEngine {
  /** Safe to call before user gesture; queues resume. */
  play(name: SfxName, opts?: { volume?: number; detune?: number }): void
  /** Generative ambient music; switches intensity smoothly. */
  music(mood: 'menu' | 'battle' | 'off'): void
  applySettings(settings: GameSettings): void
}
