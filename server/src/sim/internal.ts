// Internal battle state shared by the sim subsystems. Pure data + helpers, no I/O.

import {
  CREW_CLASSES,
  CREW_XP_PER_LEVEL,
  DRONES,
  MAX_AMMO,
  MAX_DRONES_ACTIVE,
  EVASION_CAP,
  EVASION_PER_ENGINE_LEVEL,
  DEFENSE_MODULES,
  SHIELD_HP_PER_LAYER,
  SHIELD_MAX_LAYERS,
  SHIELD_POWER_PER_LAYER,
  SHIPS,
  TRIANGLE_BONUS,
  TRIANGLE_MALUS,
  UNPOWERED_CHARGE_KEEP,
  WEAPONS,
  clamp,
} from '@stellar/shared'
import type {
  BattleEvent,
  BattleResultStats,
  ProjectileKind,
  RoomState,
  ShipLayout,
  ShipState,
  Side,
  SystemId,
  SystemState,
  WeaponCategory,
  WeaponId,
} from '@stellar/shared'
import type { ShipSetup } from './api'

export const EPS = 1e-9

export interface InternalShip extends ShipState {
  name: string
  layout: ShipLayout
  /** roomId -> connected room ids (via doors). */
  adj: Map<number, number[]>
  /** Fractional shield HP (layers = ceil(hp / SHIELD_HP_PER_LAYER)). */
  shieldHP: number
  /** Seconds since the shields last absorbed a hit. */
  sinceShieldHit: number
  fireSpreadTimer: number
  boss: boolean
  bossPhase2Done: boolean
  stats: BattleResultStats
}

export interface Projectile {
  projId: number
  /** Side that fired (target is the other side). */
  from: Side
  weaponId: WeaponId | null
  kind: ProjectileKind
  category: WeaponCategory
  damage: number
  piercing: number | 'all'
  fireChance: number
  breachChance: number
  accuracyMod: number
  damagesHull: boolean
  targetRoomId: number
  ticksLeft: number
}

export interface PendingBeam {
  from: Side
  weaponId: WeaponId
  targetRoomId: number
  ticksLeft: number
}

export interface BattleCtx {
  rng: () => number
  events: BattleEvent[]
  ships: Record<Side, InternalShip>
  projectiles: Projectile[]
  beams: PendingBeam[]
  nextProjId: () => number
  suddenDeath: boolean
}

export function otherSide(side: Side): Side {
  return side === 'a' ? 'b' : 'a'
}

export function categoryMult(cat: WeaponCategory, target: 'shields' | 'hull' | 'systems'): number {
  switch (cat) {
    case 'energy':
      return target === 'shields' ? TRIANGLE_BONUS : target === 'hull' ? TRIANGLE_MALUS : 1
    case 'kinetic':
      return target === 'hull' ? TRIANGLE_BONUS : target === 'systems' ? TRIANGLE_MALUS : 1
    case 'explosive':
      return target === 'systems' ? TRIANGLE_BONUS : target === 'shields' ? TRIANGLE_MALUS : 1
  }
}

export function findSystem(ship: InternalShip, id: SystemId): SystemState | undefined {
  return ship.systems.find((s) => s.id === id)
}

export function systemInRoom(ship: InternalShip, roomId: number): SystemState | undefined {
  return ship.systems.find((s) => s.roomId === roomId)
}

export function roomById(ship: InternalShip, roomId: number): RoomState | undefined {
  return ship.rooms.find((r) => r.id === roomId)
}

/** Usable level = level - ceil(damage); a system at 0 is inactive. */
export function usableLevel(sys: SystemState): number {
  return Math.max(0, sys.level - Math.ceil(sys.damage - EPS))
}

export function shieldLayersOf(ship: InternalShip): number {
  return Math.max(0, Math.ceil(ship.shieldHP / SHIELD_HP_PER_LAYER - EPS))
}

export function maxShieldLayers(ship: InternalShip): number {
  const sys = findSystem(ship, 'shields')
  if (!sys) return 0
  const byPower = Math.floor(sys.power / SHIELD_POWER_PER_LAYER)
  const cap = SHIELD_MAX_LAYERS + DEFENSE_MODULES[ship.defenseModule].maxShieldLayersMod
  return Math.max(0, Math.min(byPower, cap))
}

export function cockpitManned(ship: InternalShip): boolean {
  const sys = findSystem(ship, 'cockpit')
  if (!sys) return false
  return ship.crew.some((c) => c.roomId === sys.roomId && c.path.length === 0)
}

export function computeEvasion(ship: InternalShip): number {
  if (!cockpitManned(ship)) return 0
  const engines = findSystem(ship, 'engines')
  let ev = (engines?.power ?? 0) * EVASION_PER_ENGINE_LEVEL
  const cockpit = findSystem(ship, 'cockpit')
  if (cockpit) {
    let best = 0
    for (const c of ship.crew) {
      if (c.roomId !== cockpit.roomId || c.path.length > 0) continue
      const bonus = CREW_CLASSES[c.cls].pilotEvasion[c.level - 1] ?? 0
      if (bonus > best) best = bonus
    }
    ev += best
  }
  ev += DEFENSE_MODULES[ship.defenseModule].evasionBonus
  return clamp(ev, 0, EVASION_CAP)
}

/** BFS shortest path between rooms; returns rooms to traverse (excluding `from`). */
export function bfsPath(ship: InternalShip, from: number, to: number): number[] {
  if (from === to) return []
  const prev = new Map<number, number>()
  const queue = [from]
  const seen = new Set<number>([from])
  while (queue.length > 0) {
    const cur = queue.shift()
    if (cur === undefined) break
    for (const next of ship.adj.get(cur) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      prev.set(next, cur)
      if (next === to) {
        const path: number[] = [to]
        let node = to
        while (true) {
          const p = prev.get(node)
          if (p === undefined || p === from) break
          path.unshift(p)
          node = p
        }
        return path
      }
      queue.push(next)
    }
  }
  return []
}

/**
 * Applies system damage in a room; emits system_destroyed (credited to the attacker's
 * stats) when the system crosses to fully damaged. Returns damage actually applied.
 */
export function damageSystem(
  ctx: BattleCtx,
  victim: Side,
  roomId: number,
  amount: number,
): number {
  const ship = ctx.ships[victim]
  const sys = systemInRoom(ship, roomId)
  if (!sys || amount <= 0) return 0
  const before = sys.damage
  sys.damage = clamp(sys.damage + amount, 0, sys.level)
  if (before < sys.level - EPS && sys.damage >= sys.level - EPS) {
    ctx.events.push({ t: 'system_destroyed', side: victim, system: sys.id })
    ctx.ships[otherSide(victim)].stats.systemsDestroyed += 1
  }
  return sys.damage - before
}

/** Subtracts shield HP, resets the regen grace timer and emits layer changes. */
export function hitShields(ctx: BattleCtx, victim: Side, amount: number): number {
  const ship = ctx.ships[victim]
  const before = shieldLayersOf(ship)
  const applied = Math.min(ship.shieldHP, amount)
  ship.shieldHP = Math.max(0, ship.shieldHP - amount)
  ship.sinceShieldHit = 0
  const after = shieldLayersOf(ship)
  if (after !== before) {
    ctx.events.push({ t: 'shield_layer', side: victim, layers: after, broke: after < before })
  }
  return applied
}

export function addXp(ctx: BattleCtx, side: Side, crewId: string, amount: number): void {
  const ship = ctx.ships[side]
  const crew = ship.crew.find((c) => c.id === crewId)
  if (!crew || amount <= 0) return
  crew.xp += amount
  while (crew.level < 3) {
    const threshold = CREW_XP_PER_LEVEL[crew.level as 1 | 2]
    if (crew.xp < threshold) break
    crew.level = (crew.level + 1) as 1 | 2 | 3
    const newMax = CREW_CLASSES[crew.cls].hpMax[crew.level - 1] ?? crew.hpMax
    crew.hp += Math.max(0, newMax - crew.hpMax)
    crew.hpMax = newMax
    ctx.events.push({ t: 'crew_levelup', side, crewId: crew.id, level: crew.level })
  }
}

/**
 * Reconciles energy after damage/intent changes: clamps each system's power to its
 * usable level, recomputes spare power, weapon slot power (in slot order, halving the
 * charge once on a powered->unpowered transition), drone activation and shield caps.
 */
export function recomputeShip(ship: InternalShip): void {
  for (const sys of ship.systems) {
    const usable = usableLevel(sys)
    if (sys.power > usable) sys.power = usable
  }
  const allocated = ship.systems.reduce((a, s) => a + s.power, 0)
  ship.sparePower = Math.max(0, ship.reactor - allocated)

  const weapons = findSystem(ship, 'weapons')
  let remaining = weapons?.power ?? 0
  for (const slot of ship.weapons) {
    const def = WEAPONS[slot.weaponId]
    const nowPowered = remaining >= def.power
    if (nowPowered) remaining -= def.power
    if (slot.powered && !nowPowered) slot.charge *= UNPOWERED_CHARGE_KEEP
    slot.powered = nowPowered
  }

  const bay = findSystem(ship, 'drones')
  const totalBayPower = bay?.power ?? 0
  let bayRemaining = totalBayPower
  let active = 0
  for (const slot of ship.drones) {
    const def = DRONES[slot.droneId]
    const nowActive =
      slot.enabled &&
      def.power <= bayRemaining &&
      active < Math.min(totalBayPower, MAX_DRONES_ACTIVE)
    if (nowActive) {
      bayRemaining -= def.power
      active += 1
    }
    slot.powered = nowActive
  }

  const layersMax = maxShieldLayers(ship)
  ship.shieldLayersMax = layersMax
  ship.shieldHP = Math.min(ship.shieldHP, layersMax * SHIELD_HP_PER_LAYER)
  ship.shieldLayers = shieldLayersOf(ship)
  ship.evasion = computeEvasion(ship)
}

function emptyStats(): BattleResultStats {
  return {
    damageDealt: 0,
    damageTaken: 0,
    shotsFired: 0,
    shotsHit: 0,
    systemsDestroyed: 0,
    crewLost: 0,
    durationSec: 0,
  }
}

const SYSTEM_ORDER: SystemId[] = ['weapons', 'shields', 'engines', 'oxygen', 'medbay', 'cockpit', 'drones']

/** Initial reactor distribution: oxygen first (1), then shields/weapons/engines/medbay/drones. */
function assignInitialPower(ship: InternalShip): void {
  const give = (id: SystemId, amount: number): void => {
    const sys = findSystem(ship, id)
    if (!sys) return
    const room = Math.min(usableLevel(sys) - sys.power, ship.sparePower, amount)
    if (room <= 0) return
    sys.power += room
    ship.sparePower -= room
  }
  ship.sparePower = ship.reactor
  give('oxygen', 1)
  give('shields', 8)
  give('weapons', 8)
  give('engines', 8)
  give('medbay', 1)
  give('drones', 3)
  give('oxygen', 2)
}

/** Station preferences per crew class (first available wins; cockpit is pre-assigned). */
const STATION_PREFS: Record<string, SystemId[]> = {
  pilot: ['cockpit', 'engines', 'shields'],
  gunner: ['weapons', 'drones', 'shields'],
  engineer: ['engines', 'shields', 'drones', 'weapons'],
  medic: ['medbay', 'oxygen', 'shields'],
  soldier: ['weapons', 'shields', 'engines'],
}

export function buildInternalShip(setup: ShipSetup): InternalShip {
  const layout = SHIPS[setup.shipClass].layout
  const adj = new Map<number, number[]>()
  for (const room of layout.rooms) adj.set(room.id, [])
  for (const [r1, r2] of layout.doors) {
    adj.get(r1)?.push(r2)
    adj.get(r2)?.push(r1)
  }

  const systems: SystemState[] = []
  for (const id of SYSTEM_ORDER) {
    const level = setup.systems[id]
    if (level === undefined || level <= 0) continue
    const roomDef = layout.rooms.find((r) => r.system === id)
    if (!roomDef) continue
    systems.push({ id, roomId: roomDef.id, level, damage: 0, power: 0 })
  }

  const ship: InternalShip = {
    shipClass: setup.shipClass,
    hull: setup.hull,
    hullMax: setup.hullMax,
    reactor: setup.reactor,
    sparePower: setup.reactor,
    systems,
    rooms: layout.rooms.map((r) => ({ id: r.id, o2: 100, fire: 0, breach: 0 })),
    doors: layout.doors.map(([a, b], id) => ({ id, a, b, open: true })),
    crew: [],
    weapons: setup.weapons.map((weaponId) => ({
      weaponId,
      charge: 0,
      powered: false,
      targetRoomId: null,
      autofire: false,
    })),
    drones: setup.drones.map((droneId) => ({
      droneId,
      enabled: true,
      powered: false,
      cooldown: DRONES[droneId].kind === 'defensive' ? 0 : DRONES[droneId].period,
    })),
    defenseModule: setup.defenseModule,
    shieldLayers: 0,
    shieldLayersMax: 0,
    shieldRegen: 0,
    evasion: 0,
    jump: { charging: false, progress: 0, blocked: null },
    ammo: setup.ammo,
    ammoMax: MAX_AMMO,
    name: setup.name,
    layout,
    adj,
    shieldHP: 0,
    sinceShieldHit: 0,
    fireSpreadTimer: 0,
    boss: setup.boss === true,
    bossPhase2Done: false,
    stats: emptyStats(),
  }

  // Crew stations: guarantee a staffed cockpit, then class preferences.
  const occupied = new Map<number, number>()
  const roomOf = (id: SystemId): number | undefined => findSystem(ship, id)?.roomId
  const fallbackRoom = layout.rooms[0]?.id ?? 0
  const cockpitRoom = roomOf('cockpit')
  const pilotIdx = setup.crew.findIndex((c) => c.cls === 'pilot')
  const cockpitCrewIdx = cockpitRoom !== undefined ? (pilotIdx >= 0 ? pilotIdx : 0) : -1

  setup.crew.forEach((member, i) => {
    let station: number | undefined
    if (i === cockpitCrewIdx) {
      station = cockpitRoom
    } else {
      for (const pref of STATION_PREFS[member.cls] ?? []) {
        if (pref === 'cockpit') continue
        const room = roomOf(pref)
        if (room !== undefined && (occupied.get(room) ?? 0) === 0) {
          station = room
          break
        }
      }
      if (station === undefined) {
        for (const id of SYSTEM_ORDER) {
          const room = roomOf(id)
          if (room !== undefined && room !== cockpitRoom && (occupied.get(room) ?? 0) === 0) {
            station = room
            break
          }
        }
      }
    }
    const roomId = station ?? fallbackRoom
    occupied.set(roomId, (occupied.get(roomId) ?? 0) + 1)
    ship.crew.push({
      id: member.id,
      name: member.name,
      cls: member.cls,
      level: member.level,
      xp: member.xp,
      hp: member.hp,
      hpMax: member.hpMax,
      roomId,
      path: [],
      moveProgress: 0,
      task: 'idle',
      stationRoomId: roomId,
    })
  })

  assignInitialPower(ship)
  recomputeShip(ship)
  ship.shieldHP = ship.shieldLayersMax * SHIELD_HP_PER_LAYER
  ship.shieldLayers = shieldLayersOf(ship)
  return ship
}
