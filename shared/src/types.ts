// Core domain types shared by server simulation and client rendering.

export type SystemId =
  | 'weapons'
  | 'shields'
  | 'engines'
  | 'oxygen'
  | 'medbay'
  | 'cockpit'
  | 'drones'

export type WeaponCategory = 'energy' | 'kinetic' | 'explosive'

export type WeaponId =
  | 'laser_light'
  | 'laser_burst'
  | 'beam_melter'
  | 'gauss_cannon'
  | 'flak_scatter'
  | 'mag_heavy'
  | 'missile_swift'
  | 'missile_breach'
  | 'bomb_incendiary'

export type DefenseModuleId =
  | 'mod_shields_std'
  | 'mod_reactive_armor'
  | 'mod_dispersion_field'
  | 'mod_point_defense'

export type DroneId = 'drone_combat' | 'drone_defense' | 'drone_repair'

export type CrewClassId = 'pilot' | 'engineer' | 'gunner' | 'medic' | 'soldier'

export type ShipClassId = 'sentinel' | 'vanguard' | 'bastion' | 'hegemon'

export type PlanetBiome =
  | 'gas_giant'
  | 'rocky'
  | 'ice'
  | 'volcanic'
  | 'oceanic'
  | 'desert'

export type Side = 'a' | 'b'

// ---------------------------------------------------------------------------
// Static definitions (data tables)
// ---------------------------------------------------------------------------

export interface WeaponDef {
  id: WeaponId
  name: string
  desc: string
  category: WeaponCategory
  /** Loadout budget cost (8-point budget). */
  points: number
  /** Energy required in the weapons system to charge. */
  power: number
  /** Damage per projectile. */
  damage: number
  /** Number of projectiles per volley. */
  shots: number
  /** Seconds to charge at base rate. */
  cooldown: number
  /** Shield layers ignored on impact ('all' teleports past shields). */
  piercing: number | 'all'
  /** Consumes 1 ammo per volley. */
  usesAmmo: boolean
  /** Chance [0,1] to start a fire in the target room on hull hit. */
  fireChance: number
  /** Chance [0,1] to open a breach in the target room on hull hit. */
  breachChance: number
  /** Accuracy modifier added to base hit chance (e.g. -0.10 for flak). */
  accuracyMod: number
  /** Beams sweep this many rooms (0 = normal projectile). Beams cannot miss nor pierce shields. */
  beamRooms: number
  /** Damages hull on hit (incendiary bomb does not). */
  damagesHull: boolean
}

export interface DefenseModuleDef {
  id: DefenseModuleId
  name: string
  desc: string
  tradeoff: string
  /** Multiplier applied to hull damage taken. */
  hullDamageMult: number
  /** Flat evasion bonus. */
  evasionBonus: number
  /** Multiplier on shield regeneration time (higher = slower). */
  shieldRegenTimeMult: number
  /** Chance [0,1] to shoot down incoming missiles. */
  missileInterceptChance: number
  /** Modifier to maximum shield layers. */
  maxShieldLayersMod: number
}

export interface DroneDef {
  id: DroneId
  name: string
  desc: string
  kind: 'offensive' | 'defensive' | 'internal'
  /** Energy consumed in the drones system while active. */
  power: number
  /** Loadout budget cost. */
  points: number
  /** Seconds between actions (shoot / repair). */
  period: number
  /** Chance [0,1] for defense drone to intercept a projectile. */
  interceptChance: number
}

export interface CrewClassDef {
  id: CrewClassId
  name: string
  desc: string
  /** Max HP per level (index 0 = level 1). */
  hpMax: [number, number, number]
  /** Repair speed multiplier per level. */
  repairMult: [number, number, number]
  /** Firefighting speed multiplier per level. */
  fireMult: [number, number, number]
  /** Evasion bonus when piloting, per level. */
  pilotEvasion: [number, number, number]
  /** Weapon charge speed multiplier when manning weapons, per level. */
  gunneryMult: [number, number, number]
  /** Medbay healing multiplier when inside medbay, per level. */
  medbayMult: [number, number, number]
  /** Passive HP/s healed to crewmates sharing the room, per level. */
  fieldHeal: [number, number, number]
}

export interface RoomDef {
  id: number
  /** Grid position and size in cells (cell = abstract unit; client scales). */
  x: number
  y: number
  w: number
  h: number
  system?: SystemId
}

export interface ShipLayout {
  rooms: RoomDef[]
  /** Pairs of room ids connected by a door (bidirectional). */
  doors: [number, number][]
}

export interface ShipClassDef {
  id: ShipClassId
  name: string
  desc: string
  /** Selectable by players in loadout (boss ships are not). */
  playable: boolean
  difficulty: 'facil' | 'dificil' | 'media'
  hullMax: number
  reactor: number
  weaponSlots: number
  /** Initial level per installed system (absent = system not installed). */
  systems: Partial<Record<SystemId, number>>
  layout: ShipLayout
  /** Scrap cost multiplier for specific upgrade kinds (e.g. vanguard cheap weapons). */
  upgradeDiscount?: { kind: 'weapons' | 'reactor'; mult: number }
}

// ---------------------------------------------------------------------------
// Loadout
// ---------------------------------------------------------------------------

export interface Loadout {
  ship: ShipClassId
  weapons: WeaponId[]
  defenseModule: DefenseModuleId
  drones: DroneId[]
  /** Exactly 4 entries; classes may repeat. */
  crew: CrewClassId[]
}

// ---------------------------------------------------------------------------
// Live battle state (snapshots)
// ---------------------------------------------------------------------------

export type CrewTask =
  | 'idle'
  | 'moving'
  | 'operate'
  | 'repair'
  | 'fight_fire'
  | 'seal_breach'
  | 'heal'

export interface SystemState {
  id: SystemId
  roomId: number
  /** Installed level (max power when undamaged). */
  level: number
  /** Damage points; usable level = level - damage. */
  damage: number
  /** Energy currently allocated. */
  power: number
}

export interface RoomState {
  id: number
  /** Oxygen 0..100. */
  o2: number
  /** Fire intensity 0..100 (0 = none). */
  fire: number
  /** Breach severity 0..100 (0 = none). */
  breach: number
}

export interface CrewState {
  id: string
  name: string
  cls: CrewClassId
  level: 1 | 2 | 3
  xp: number
  hp: number
  hpMax: number
  roomId: number
  /** Path the crew member is walking (room ids), empty when stationary. */
  path: number[]
  /** Progress 0..1 towards the next room in path. */
  moveProgress: number
  task: CrewTask
  /** Room the player assigned as station (returns there when idle). */
  stationRoomId: number
}

export interface WeaponSlotState {
  weaponId: WeaponId
  /** Charge 0..1; fires when 1 and a target is set. */
  charge: number
  /** Whether the slot currently receives energy. */
  powered: boolean
  targetRoomId: number | null
  autofire: boolean
}

export interface DroneSlotState {
  droneId: DroneId
  /** Player toggled it on (actually runs only if powered). */
  enabled: boolean
  /** Receiving energy from the drones system. */
  powered: boolean
  /** Seconds until next action. */
  cooldown: number
}

export interface JumpState {
  charging: boolean
  /** 0..1. */
  progress: number
  /** Why the charge is currently blocked, for UI feedback. */
  blocked: 'no_pilot' | 'no_engine_power' | null
}

export interface ShipState {
  shipClass: ShipClassId
  hull: number
  hullMax: number
  reactor: number
  /** Energy not yet allocated to any system. */
  sparePower: number
  systems: SystemState[]
  rooms: RoomState[]
  crew: CrewState[]
  weapons: WeaponSlotState[]
  drones: DroneSlotState[]
  defenseModule: DefenseModuleId
  shieldLayers: number
  shieldLayersMax: number
  /** 0..1 progress towards regenerating the next layer. */
  shieldRegen: number
  /** Computed total evasion [0,1], for UI display. */
  evasion: number
  jump: JumpState
  ammo: number
  ammoMax: number
}

export interface BattleSnapshot {
  tick: number
  paused: boolean
  /** Whether tactical pause is allowed in this battle (false in PvP). */
  pauseAllowed: boolean
  you: ShipState
  enemy: ShipState
}

// Discrete events for VFX/SFX timing.
export type ProjectileKind = 'laser' | 'kinetic' | 'missile' | 'bomb' | 'drone_shot'

export type BattleEvent =
  | {
      t: 'shot'
      /** Side that fired. */
      side: Side
      projId: number
      kind: ProjectileKind
      weaponId: WeaponId | null
      /** Room the shot originates from (weapons room / drone), in firer's ship. */
      fromRoomId: number | null
      targetRoomId: number
      /** Ticks until impact resolution. */
      travelTicks: number
    }
  | {
      t: 'impact'
      /** Side that owns the TARGET ship. */
      side: Side
      projId: number
      targetRoomId: number
      outcome: 'miss' | 'shield' | 'hull' | 'intercepted'
      hullDamage: number
      systemDamage: number
      shieldDamage: number
      fire: boolean
      breach: boolean
    }
  | {
      t: 'beam'
      side: Side
      weaponId: WeaponId
      roomIds: number[]
      /** Whether it was absorbed by shields (no room damage). */
      blocked: boolean
    }
  | { t: 'shield_layer'; side: Side; layers: number; broke: boolean }
  | { t: 'system_destroyed'; side: Side; system: SystemId }
  | { t: 'crew_died'; side: Side; crewId: string; name: string }
  | { t: 'crew_levelup'; side: Side; crewId: string; level: number }
  | { t: 'jump_charged'; side: Side }
  | { t: 'fled'; side: Side }
  | { t: 'hull_destroyed'; side: Side }
  | { t: 'log'; msg: string }

export interface BattleResultStats {
  damageDealt: number
  damageTaken: number
  shotsFired: number
  shotsHit: number
  systemsDestroyed: number
  crewLost: number
  durationSec: number
}

export interface BattleResult {
  winner: Side | null
  /** How the battle ended. */
  reason: 'destroyed' | 'crew_dead' | 'fled' | 'surrender' | 'disconnect'
  stats: Record<Side, BattleResultStats>
}

// ---------------------------------------------------------------------------
// Expedition (roguelite run)
// ---------------------------------------------------------------------------

export type NodeType = 'combat' | 'elite' | 'event' | 'shop' | 'boss' | 'start'

export interface SectorNode {
  id: number
  col: number
  row: number
  type: NodeType
  /** Node ids reachable from this node. */
  edges: number[]
  biome: PlanetBiome
  /** Seed for procedural visuals of this node's backdrop. */
  seed: number
}

export interface SectorMap {
  nodes: SectorNode[]
  startNodeId: number
}

export interface EventChoiceDef {
  label: string
  /** Shown after resolution. */
  outcomes: EventOutcomeDef[]
}

export interface EventOutcomeDef {
  /** Relative probability weight. */
  weight: number
  text: string
  scrap?: number
  hull?: number
  ammo?: number
  /** Random crew member takes this damage. */
  crewDamage?: number
  /** Grants a random weapon. */
  weaponReward?: boolean
}

export interface GameEventDef {
  id: string
  title: string
  text: string
  choices: EventChoiceDef[]
}

export interface ShopOffer {
  kind: 'weapon' | 'drone' | 'ammo' | 'repair' | 'crew'
  id?: WeaponId | DroneId | CrewClassId
  price: number
  /** Units for ammo/repair offers. */
  amount?: number
}

export interface RunUpgradeCosts {
  reactor: number
  system: Record<SystemId, number>
  repairPerPoint: number
  ammoPer2: number
}

/** Persistent state of an expedition between battles. */
export interface RunStatePublic {
  sector: SectorMap
  currentNodeId: number
  /** Columns cleared (difficulty). */
  column: number
  scrap: number
  hull: number
  hullMax: number
  reactor: number
  ammo: number
  shipClass: ShipClassId
  systems: Partial<Record<SystemId, number>>
  weapons: WeaponId[]
  drones: DroneId[]
  defenseModule: DefenseModuleId
  crew: { id: string; name: string; cls: CrewClassId; level: 1 | 2 | 3; xp: number; hp: number; hpMax: number }[]
  upgradeCosts: RunUpgradeCosts
  /** Weapon offered as loot after last battle, purchasable on upgrade screen. */
  lootWeapon: WeaponId | null
  /** Current shop offers when on a shop node. */
  shopOffers: ShopOffer[] | null
  /** Current event when on an event node. */
  event: GameEventDef | null
  /** Set after resolving an event choice. */
  eventResult: string | null
  alive: boolean
  victory: boolean
}
