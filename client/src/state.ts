// Client-global mutable state (GameStateStore contract) + client-only extras
// used to coordinate scene transitions (last battle result, run-over summary,
// loot deltas for the Upgrade screen, lobby counters).
//
// Settings persist in localStorage under 'sc_settings'.

import { clamp } from '@stellar/shared'
import type { BattleResult, BattleSnapshot, GameMode, LobbyState, RunStatePublic, Side } from '@stellar/shared'
import type { GameSettings, GameStateStore } from './contracts'

const SETTINGS_KEY = 'sc_settings'

const SETTINGS_DEFAULTS: GameSettings = {
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.8,
  crtEnabled: true,
  uiScale: 1,
  tutorialDone: false,
}

export interface RunOverSummary {
  victory: boolean
  column: number
  scrap: number
}

/** GameStateStore plus client-side coordination extras. */
export interface ClientState extends GameStateStore {
  /** Last battle:end payload (Result scene fallback when started by routing). */
  lastResult: BattleResult | null
  lastResultSide: Side | null
  lastBattleVsNpc: boolean
  /** Run resources at battle:start, to show loot deltas on the Upgrade screen. */
  scrapAtBattleStart: number
  ammoAtBattleStart: number
  /** Set by run:over; cleared when returning to the main menu. */
  runOver: RunOverSummary | null
  lobby: LobbyState | null
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback
}

function loadSettings(): GameSettings {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(SETTINGS_KEY)
  } catch {
    raw = null
  }
  if (raw === null) return { ...SETTINGS_DEFAULTS }
  try {
    const p = JSON.parse(raw) as Partial<Record<keyof GameSettings, unknown>>
    return {
      masterVolume: num(p.masterVolume, SETTINGS_DEFAULTS.masterVolume, 0, 1),
      musicVolume: num(p.musicVolume, SETTINGS_DEFAULTS.musicVolume, 0, 1),
      sfxVolume: num(p.sfxVolume, SETTINGS_DEFAULTS.sfxVolume, 0, 1),
      crtEnabled: typeof p.crtEnabled === 'boolean' ? p.crtEnabled : SETTINGS_DEFAULTS.crtEnabled,
      uiScale: num(p.uiScale, SETTINGS_DEFAULTS.uiScale, 0.85, 1.15),
      tutorialDone:
        typeof p.tutorialDone === 'boolean' ? p.tutorialDone : SETTINGS_DEFAULTS.tutorialDone,
    }
  } catch {
    return { ...SETTINGS_DEFAULTS }
  }
}

class Store implements ClientState {
  settings: GameSettings = loadSettings()
  run: RunStatePublic | null = null
  snapshot: BattleSnapshot | null = null
  mode: GameMode | null = null

  lastResult: BattleResult | null = null
  lastResultSide: Side | null = null
  lastBattleVsNpc = false
  scrapAtBattleStart = 0
  ammoAtBattleStart = 0
  runOver: RunOverSummary | null = null
  lobby: LobbyState | null = null

  saveSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings))
    } catch {
      // Storage unavailable (private mode); settings stay in memory.
    }
  }
}

let store: ClientState | null = null

export function getState(): ClientState {
  if (store === null) store = new Store()
  return store
}
