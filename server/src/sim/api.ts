// Contract between the battle simulation (sim/*) and the rest of the server
// (battle host, NPC AI, run manager). The sim is pure: no Socket.IO imports.

import type {
  BattleEvent,
  BattleResult,
  BattleSnapshot,
  CrewClassId,
  CrewRaceId,
  DefenseModuleId,
  DroneId,
  Loadout,
  NpcTemplate,
  ShipClassId,
  ShipState,
  Side,
  SystemId,
  WeaponId,
} from '@stellar/shared'

export interface CrewSetup {
  id: string
  name: string
  cls: CrewClassId
  race: CrewRaceId
  level: 1 | 2 | 3
  xp: number
  hp: number
  hpMax: number
}

/** Everything needed to instantiate one side of a battle. */
export interface ShipSetup {
  shipClass: ShipClassId
  name: string
  hull: number
  hullMax: number
  reactor: number
  /** Installed system levels (absent = not installed). */
  systems: Partial<Record<SystemId, number>>
  /** Saved energy distribution to restore (expedition carries it between battles).
   *  Absent/empty = use the default initial distribution. */
  power?: Partial<Record<SystemId, number>>
  weapons: WeaponId[]
  drones: DroneId[]
  defenseModule: DefenseModuleId
  crew: CrewSetup[]
  ammo: number
  /** Hegemon boss: enables phase-2 power surge at 50% hull. */
  boss?: boolean
  /** Pre-combat advantage: light a fire in the weapons room at battle start. */
  startFire?: boolean
}

/** Pre-combat encounter modifiers applied to the enemy ship setup (sneak attacks). */
export interface BattleMod {
  /** Scales the enemy's starting hull (a landed sneak attack leaves them damaged). */
  enemyHullMult?: number
  /** Start a fire aboard the enemy at the opening of the battle. */
  enemyStartFire?: boolean
}

export interface BattleOptions {
  seed: number
  pauseAllowed: boolean
  /** Seconds after which shield regen disables (duel anti-stalemate); null = never. */
  suddenDeathSec: number | null
  /** Beacon mode: a safe stop with no enemy. Jumping ends the sim with reason
   *  'jumped' (advance to the map) instead of fleeing a fight. */
  beacon?: boolean
}

/**
 * Implemented by sim/battle.ts as `class BattleSim implements IBattleSim`.
 * The host calls tick() at 20 tps (skipped while paused), drains events after each tick,
 * and broadcasts snapshotFor() at 10 Hz. All intents validate inputs and ignore illegal ones.
 */
export interface IBattleSim {
  readonly tickCount: number
  /** Set when the battle is over; tick() becomes a no-op afterwards. */
  readonly result: BattleResult | null
  paused: boolean

  tick(): void
  drainEvents(): BattleEvent[]
  snapshotFor(side: Side): BattleSnapshot

  setPower(side: Side, system: SystemId, value: number): void
  setTarget(side: Side, weaponSlot: number, roomId: number | null): void
  toggleAutofire(side: Side, weaponSlot: number): void
  moveCrew(side: Side, crewId: string, roomId: number): void
  toggleDrone(side: Side, droneSlot: number): void
  toggleDoor(side: Side, doorId: number): void
  requestJump(side: Side): void
  surrender(side: Side): void
  /** Marks defeat for `side` with reason 'disconnect' (duel grace period expiry). */
  forfeit(side: Side): void

  /** Live read access (NPC AI / autopilot decision-making). */
  shipState(side: Side): ShipState
  /** Crew state to persist back into an expedition run after the battle. */
  crewExport(side: Side): CrewSetup[]
}

/** sim/setup.ts must export these factory helpers. */
export interface SetupFactories {
  setupFromLoadout(loadout: Loadout, name: string): ShipSetup
  setupFromNpc(template: NpcTemplate): ShipSetup
}
