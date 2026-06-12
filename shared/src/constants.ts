// Simulation and balance constants. All times in seconds unless noted.

export const TICK_RATE = 20
export const TICK_MS = 1000 / TICK_RATE
/** Snapshots are broadcast every N ticks (10 Hz). */
export const SNAPSHOT_EVERY_TICKS = 2

export const SERVER_PORT = 3000

// --- Loadout ---
export const WEAPON_BUDGET_POINTS = 8
export const CREW_SIZE = 4
export const MAX_DRONES_EQUIPPED = 3
/** Active drones = powered drone-bay level, capped here (GDD: max 3). No duplicate drones. */
export const MAX_DRONES_ACTIVE = 3
export const STARTING_AMMO = 12
export const MAX_AMMO = 20

// --- Energy / systems ---
export const REACTOR_MAX = 25
export const SYSTEM_MAX_LEVEL: Record<string, number> = {
  weapons: 8,
  shields: 8,
  engines: 8,
  oxygen: 3,
  medbay: 3,
  cockpit: 3,
  drones: 3,
}
/** Shield layers = floor(powered shields / 2), capped. */
export const SHIELD_POWER_PER_LAYER = 2
export const SHIELD_MAX_LAYERS = 4
/** Fractional shield model: each layer = 2 shieldHP; blocked hits subtract damage×mult. */
export const SHIELD_HP_PER_LAYER = 2
/** Seconds to regenerate one shield layer. */
export const SHIELD_REGEN_SEC = 6
/** Seconds without taking shield hits before regen starts (every shield hit resets it). */
export const SHIELD_REGEN_DELAY_SEC = 2
/** ShieldHP a beam strips when blocked by shields (1 layer, before energy bonus). */
export const BEAM_SHIELD_STRIP_HP = 2

export const EVASION_PER_ENGINE_LEVEL = 0.05
export const EVASION_CAP = 0.45

/** Hit chance before evasion (1 = always hits unless evaded). */
export const BASE_ACCURACY = 1.0

// --- Damage triangle (GDD §2.4.1) ---
export const TRIANGLE_BONUS = 1.25
export const TRIANGLE_MALUS = 0.75

// --- Repair / crew ---
export const REPAIR_SEC_PER_POINT = 6
export const CREW_BASE_HP = 100
export const CREW_SPEED_ROOMS_PER_SEC = 1.6
export const CREW_XP_PER_LEVEL = [0, 60, 180] as const
export const MEDBAY_HEAL_PER_LEVEL = 6 // HP/s per medbay level

// --- Environment ---
export const O2_REFILL_PER_LEVEL = 1.2 // %/s whole-ship per oxygen system level
export const O2_DECAY_NO_POWER = 0.6 // %/s whole-ship when oxygen unpowered
export const O2_DIFFUSION_RATE = 4 // %/s equalization per open door
export const O2_HYPOXIA_THRESHOLD = 15 // below this %, crew suffocates
export const O2_HYPOXIA_DPS = 4
export const FIRE_SYSTEM_DPS = 0.5 // system damage points per second
export const FIRE_CREW_DPS = 5
export const FIRE_O2_BURN = 1.5 // %/s O2 consumed in the room
export const FIRE_MIN_O2 = 20 // below this O2 %, fire dies out
export const FIRE_SPREAD_PERIOD = 5 // seconds between spread checks
export const FIRE_SPREAD_CHANCE = 0.2
export const FIRE_FIGHT_RATE = 10 // fire % removed per second by one crew
export const FIRE_INTENSITY_ON_HIT = 60 // fire level set by weapon fireChance procs
export const BREACH_O2_DRAIN = 3 // %/s in the room
export const BREACH_SEAL_RATE = 8 // breach % removed per second by one crew

// --- Jump / flee ---
export const JUMP_CHARGE_SEC = 15
export const COCKPIT_JUMP_MULT = [1, 1.5, 2] as const // by cockpit level

// --- Weapons handling ---
/** Charge fraction kept when a weapon loses power. */
export const UNPOWERED_CHARGE_KEEP = 0.5
/** Projectile travel time in ticks (visual + interception window). */
export const PROJECTILE_TRAVEL_TICKS = 14
export const BEAM_TRAVEL_TICKS = 8

// --- Battle ---
export const PVP_LOADOUT_TIMEOUT_SEC = 60
export const PVP_QUEUE_NPC_OFFER_SEC = 15
export const DISCONNECT_GRACE_SEC = 30
/** Duel anti-stalemate: shield regen disabled for both sides after this. */
export const DUEL_SUDDEN_DEATH_SEC = 300
export const DUEL_SUDDEN_DEATH_WARN_SEC = 270
/** Defense drone: seconds between intercept attempts (volleys saturate it). */
export const DRONE_DEFENSE_COOLDOWN_SEC = 3
/** Chance of an ambush battle when reconnecting to a run left outside battle. */
export const AMBUSH_CHANCE_ON_RECONNECT = 0.25

// --- Expedition ---
export const SECTOR_COLUMNS = 8
export const NODE_TYPE_WEIGHTS = { combat: 0.6, elite: 0.15, event: 0.15, shop: 0.1 } as const
export const SCRAP_BASE = 25
export const SCRAP_RANDOM = 10 // + rand(0..10)
export const SCRAP_PER_COLUMN = 8
export const ELITE_LOOT_MULT = 1.5
export const WEAPON_DROP_CHANCE = 0.1
/** Upgrade costs: reactor flat; system = 10 + 3*currentLevel. Economy: run income ≈ 320. */
export const COST_REACTOR = 25
export const COST_SYSTEM_BASE = 10
export const COST_SYSTEM_PER_LEVEL = 3
export const COST_REPAIR_PER_POINT = 2
export const COST_AMMO_PER_2 = 4

// --- Misc ---
export const HULL_SHAKE_THRESHOLD = 2 // client: shake on hits >= this hull damage
