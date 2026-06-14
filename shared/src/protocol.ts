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

// 'tutorial' is a one-off, self-contained practice battle vs the intro NPC, with
// the guided tutorial always shown and tactical pause enabled (see GAME_SPEC §10.7).
export type GameMode = 'expedition' | 'duel' | 'tutorial'

export interface LobbyState {
  /** Connected players currently online (for menu display). */
  online: number
  /** Players waiting in the duel queue. */
  queue: number
}

// --- Accounts (optional registration / login) ---

export interface AccountStats {
  runsStarted: number
  /** Runs finished by defeating the sector boss. */
  runsWon: number
  /** Deepest sector column ever reached. */
  bestColumn: number
  battlesWon: number
  battlesLost: number
  duelsWon: number
  duelsLost: number
  scrapEarned: number
  crewLost: number
}

export interface Profile {
  /** Captain display name. */
  username: string
  createdAt: number
  stats: AccountStats
}

export interface AuthResult {
  ok: boolean
  /** Human-readable failure reason (Spanish), when ok is false. */
  error?: string
  /** Persistent auth token to store client-side, when ok is true. */
  token?: string
  profile?: Profile
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

  /** Create an account; binds this session to it on success. */
  'auth:register': (username: string, password: string, cb: (res: AuthResult) => void) => void
  /** Log into an existing account; binds this session to it on success. */
  'auth:login': (username: string, password: string, cb: (res: AuthResult) => void) => void
  /** Re-bind a session to an account from a stored token (on reconnect). */
  'auth:resume': (token: string, cb: (res: AuthResult) => void) => void
  /** Unbind the account (return to anonymous guest play). */
  'auth:logout': () => void
  /** Fetch the current account profile/stats (null if playing as guest). */
  'auth:me': (cb: (profile: Profile | null) => void) => void

  'queue:join': (mode: GameMode, loadout: Loadout) => void
  'queue:leave': () => void
  /** Accept fighting an NPC instead of waiting for a human (duel queue). */
  'queue:accept_npc': () => void
  /** Start the guided practice battle (fixed beginner loadout vs the intro NPC). */
  'tutorial:start': () => void

  'battle:set_power': (system: SystemId, value: number) => void
  'battle:set_target': (weaponSlot: number, roomId: number | null) => void
  'battle:toggle_autofire': (weaponSlot: number) => void
  'battle:move_crew': (crewId: string, roomId: number) => void
  'battle:toggle_drone': (droneSlot: number) => void
  /** Open/close a door (by DoorState.id) to control O2 flow and fire spread. */
  'battle:toggle_door': (doorId: number) => void
  /** Jump away (flee) — only fires when the drive is charged and the engine room is manned. */
  'battle:jump': () => void
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
