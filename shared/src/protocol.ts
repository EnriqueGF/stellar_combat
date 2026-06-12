// Socket.IO protocol: client intents and server events.
// The server validates every intent; the client never simulates.

import type {
  BattleEvent,
  BattleResult,
  BattleSnapshot,
  DroneId,
  Loadout,
  RunStatePublic,
  Side,
  SystemId,
  WeaponId,
} from './types.js'

export type GameMode = 'expedition' | 'duel'

export interface LobbyState {
  /** Connected players currently online (for menu display). */
  online: number
  /** Players waiting in the duel queue. */
  queue: number
}

export type UpgradeItem =
  | { kind: 'reactor' }
  | { kind: 'system'; system: SystemId }
  | { kind: 'repair'; points: number }
  | { kind: 'ammo' }
  | { kind: 'loot_weapon' }
  | { kind: 'shop'; index: number }

export interface ErrorMsg {
  code:
    | 'invalid_loadout'
    | 'not_in_battle'
    | 'not_in_run'
    | 'bad_intent'
    | 'cannot_afford'
    | 'pause_not_allowed'
    | 'resume_failed'
  msg: string
}

export interface BattleStartMsg {
  mode: GameMode
  /** Which side of the snapshot is you (snapshots already come per-recipient). */
  side: Side
  /** Whether the opponent is an NPC. */
  vsNpc: boolean
  /** Seed for the procedural backdrop (planet, nebula). */
  backdropSeed: number
  snapshot: BattleSnapshot
  /** True when this is the first battle of a run (enables tutorial). */
  firstBattle: boolean
}

export interface ClientToServerEvents {
  'session:hello': (token: string | null, cb: (token: string) => void) => void
  'lobby:subscribe': () => void

  'queue:join': (mode: GameMode, loadout: Loadout) => void
  'queue:leave': () => void
  /** Accept fighting an NPC instead of waiting for a human (duel queue). */
  'queue:accept_npc': () => void

  'battle:set_power': (system: SystemId, value: number) => void
  'battle:set_target': (weaponSlot: number, roomId: number | null) => void
  'battle:toggle_autofire': (weaponSlot: number) => void
  'battle:move_crew': (crewId: string, roomId: number) => void
  'battle:toggle_drone': (droneSlot: number) => void
  'battle:jump': (charging: boolean) => void
  'battle:pause': (paused: boolean) => void
  'battle:surrender': () => void

  'run:choose_node': (nodeId: number) => void
  'run:buy': (item: UpgradeItem) => void
  'run:event_choice': (choiceIdx: number) => void
  /** Leave upgrade/event screen and open node choice (or start node battle). */
  'run:continue': () => void
  'run:abandon': () => void
}

export interface ServerToClientEvents {
  'lobby:state': (state: LobbyState) => void
  'queue:waiting': (secondsWaited: number, npcOfferAvailable: boolean) => void

  'battle:start': (msg: BattleStartMsg) => void
  'battle:snapshot': (snap: BattleSnapshot) => void
  'battle:events': (events: BattleEvent[]) => void
  'battle:end': (result: BattleResult, yourSide: Side) => void

  'run:state': (run: RunStatePublic) => void
  'run:over': (victory: boolean, summary: { column: number; scrap: number }) => void

  error: (err: ErrorMsg) => void
}
