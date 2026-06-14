// Crew movement, auto-tasks (fire > breach > repair > operate), healing and death.

import {
  BREACH_SEAL_RATE,
  CREW_CLASSES,
  CREW_RACES,
  CREW_SPEED_ROOMS_PER_SEC,
  FIRE_FIGHT_RATE,
  MEDBAY_HEAL_PER_LEVEL,
  REPAIR_SEC_PER_POINT,
} from '@stellar/shared'
import type { CrewState, Side } from '@stellar/shared'
import { addXp, bfsPath, findSystem, roomById, systemInRoom } from './internal'
import type { BattleCtx, InternalShip } from './internal'

const XP_PER_REPAIR_POINT = 10
const XP_PER_10_FIRE = 5
const XP_PER_10_HP_HEALED = 1

function moveAlongPath(crew: CrewState, dt: number): void {
  if (crew.path.length === 0) return
  crew.task = 'moving'
  const speed = CREW_SPEED_ROOMS_PER_SEC * (CREW_RACES[crew.race]?.moveMult ?? 1)
  crew.moveProgress += speed * dt
  while (crew.moveProgress >= 1 && crew.path.length > 0) {
    const next = crew.path.shift()
    if (next !== undefined) crew.roomId = next
    crew.moveProgress -= 1
  }
  if (crew.path.length === 0) crew.moveProgress = 0
}

/**
 * Idle search (documented): only crew whose station has no system roam to handle
 * fires/breaches/damage elsewhere; crew stationed on a system stay operating it unless
 * the problem is in their own room. Rooms already claimed by another crew are skipped.
 */
function findChore(ship: InternalShip, crew: CrewState): number | null {
  const claimed = new Set<number>()
  for (const other of ship.crew) {
    if (other.id === crew.id) continue
    const dest = other.path.length > 0 ? other.path[other.path.length - 1] : undefined
    if (dest !== undefined) claimed.add(dest)
    if (other.task === 'fight_fire' || other.task === 'seal_breach' || other.task === 'repair') {
      claimed.add(other.roomId)
    }
  }
  const pick = (pred: (roomId: number) => boolean): number | null => {
    for (const room of ship.rooms) {
      if (claimed.has(room.id)) continue
      if (pred(room.id)) return room.id
    }
    return null
  }
  const fire = pick((id) => (roomById(ship, id)?.fire ?? 0) > 0)
  if (fire !== null) return fire
  const breach = pick((id) => (roomById(ship, id)?.breach ?? 0) > 0)
  if (breach !== null) return breach
  return pick((id) => {
    const sys = systemInRoom(ship, id)
    return sys !== undefined && sys.damage > 0 && (roomById(ship, id)?.breach ?? 0) === 0
  })
}

export function tickCrew(ctx: BattleCtx, side: Side, dt: number): void {
  const ship = ctx.ships[side]

  for (const crew of ship.crew) {
    if (crew.path.length > 0) {
      moveAlongPath(crew, dt)
      if (crew.path.length > 0) continue
    }

    const room = roomById(ship, crew.roomId)
    const sys = systemInRoom(ship, crew.roomId)
    const cls = CREW_CLASSES[crew.cls]
    const race = CREW_RACES[crew.race]

    if (room && room.fire > 0) {
      crew.task = 'fight_fire'
      const rate = FIRE_FIGHT_RATE * (cls.fireMult[crew.level - 1] ?? 1) * (race?.fireFightMult ?? 1)
      const put = Math.min(room.fire, rate * dt)
      room.fire -= put
      addXp(ctx, side, crew.id, (put / 10) * XP_PER_10_FIRE)
    } else if (room && room.breach > 0) {
      crew.task = 'seal_breach'
      room.breach = Math.max(0, room.breach - BREACH_SEAL_RATE * dt)
    } else if (sys && sys.damage > 0 && (room?.breach ?? 0) === 0) {
      crew.task = 'repair'
      const rate =
        (1 / REPAIR_SEC_PER_POINT) * (cls.repairMult[crew.level - 1] ?? 1) * (race?.repairMult ?? 1)
      const repaired = Math.min(sys.damage, rate * dt)
      sys.damage -= repaired
      addXp(ctx, side, crew.id, repaired * XP_PER_REPAIR_POINT)
    } else {
      // Idle in current room: roam to chores only if not stationed on a system.
      const stationSys = systemInRoom(ship, crew.stationRoomId)
      const chore = stationSys === undefined ? findChore(ship, crew) : null
      if (chore !== null && chore !== crew.roomId) {
        crew.path = bfsPath(ship, crew.roomId, chore)
        crew.task = 'moving'
      } else if (crew.roomId !== crew.stationRoomId) {
        crew.path = bfsPath(ship, crew.roomId, crew.stationRoomId)
        crew.task = crew.path.length > 0 ? 'moving' : 'idle'
      } else {
        crew.task = sys ? 'operate' : 'idle'
      }
    }
  }

  // Medic field healing (passive, heals companions sharing the room).
  for (const medic of ship.crew) {
    const heal = CREW_CLASSES[medic.cls].fieldHeal[medic.level - 1] ?? 0
    if (heal <= 0) continue
    for (const mate of ship.crew) {
      if (mate.id === medic.id || mate.roomId !== medic.roomId || mate.hp >= mate.hpMax) continue
      const healed = Math.min(mate.hpMax - mate.hp, heal * dt)
      mate.hp += healed
      if (medic.task === 'idle' || medic.task === 'operate') medic.task = 'heal'
      addXp(ctx, side, medic.id, (healed / 10) * XP_PER_10_HP_HEALED)
    }
  }

  // Powered medbay heals everyone inside (boosted by a medic in the room).
  const medbay = findSystem(ship, 'medbay')
  if (medbay && medbay.power > 0) {
    let mult = 1
    for (const c of ship.crew) {
      if (c.roomId !== medbay.roomId || c.path.length > 0) continue
      const m = CREW_CLASSES[c.cls].medbayMult[c.level - 1] ?? 1
      if (m > mult) mult = m
    }
    const rate = MEDBAY_HEAL_PER_LEVEL * medbay.power * mult
    for (const c of ship.crew) {
      if (c.roomId !== medbay.roomId) continue
      c.hp = Math.min(c.hpMax, c.hp + rate * dt)
    }
  }
}

/** Removes dead crew (emitting events); returns true if the whole crew is gone. */
export function reapCrew(ctx: BattleCtx, side: Side): boolean {
  const ship = ctx.ships[side]
  const dead = ship.crew.filter((c) => c.hp <= 0)
  for (const c of dead) {
    ctx.events.push({ t: 'crew_died', side, crewId: c.id, name: c.name })
    ctx.events.push({ t: 'log', msg: `${c.name} ha muerto a bordo de ${ship.name}.` })
    ship.stats.crewLost += 1
  }
  if (dead.length > 0) {
    ship.crew = ship.crew.filter((c) => c.hp > 0)
  }
  return ship.crew.length === 0
}

/** XP for piloting / manning weapons when the ship fires a volley. */
export function grantVolleyXp(ctx: BattleCtx, side: Side): void {
  const ship = ctx.ships[side]
  const weapons = findSystem(ship, 'weapons')
  const cockpit = findSystem(ship, 'cockpit')
  for (const crew of ship.crew) {
    if (crew.path.length > 0) continue
    if (weapons && crew.roomId === weapons.roomId) addXp(ctx, side, crew.id, 5)
    else if (cockpit && crew.roomId === cockpit.roomId) addXp(ctx, side, crew.id, 5)
  }
}

export function gunneryMultFor(ship: InternalShip): number {
  const weapons = findSystem(ship, 'weapons')
  if (!weapons) return 1
  let best = 1
  for (const crew of ship.crew) {
    if (crew.roomId !== weapons.roomId || crew.path.length > 0) continue
    const m = CREW_CLASSES[crew.cls].gunneryMult[crew.level - 1] ?? 1
    if (m > best) best = m
  }
  return best
}
