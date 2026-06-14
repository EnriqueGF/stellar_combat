// O2, fire and breach simulation per ship (GAME_SPEC §3.5).

import {
  BREACH_O2_DRAIN,
  CREW_RACES,
  FIRE_CREW_DPS,
  FIRE_INTENSITY_ON_HIT,
  FIRE_MIN_O2,
  FIRE_O2_BURN,
  FIRE_SPREAD_CHANCE,
  FIRE_SPREAD_PERIOD,
  FIRE_SYSTEM_DPS,
  O2_DECAY_NO_POWER,
  O2_DIFFUSION_RATE,
  O2_HYPOXIA_DPS,
  O2_HYPOXIA_THRESHOLD,
  O2_REFILL_PER_LEVEL,
  clamp,
} from '@stellar/shared'
import type { Side } from '@stellar/shared'
import { damageSystem, findSystem, roomById } from './internal'
import type { BattleCtx } from './internal'

/** Fire dies out in ~2s when the room O2 drops below FIRE_MIN_O2. */
const FIRE_SUFFOCATE_RATE = 50

export function tickEnvironment(ctx: BattleCtx, side: Side, dt: number): void {
  const ship = ctx.ships[side]

  // O2 refill / decay. The powered oxygen system feeds the ship's air: every room
  // NOT sealed off (≥1 open door) gains O2_REFILL_PER_LEVEL × power %/s. A sealed
  // room (all its doors closed) is cut off from the air — that is what lets a fire
  // suffocate it (FTL-style). With no oxygen power, the whole ship slowly decays.
  const oxygen = findSystem(ship, 'oxygen')
  const refillRate = oxygen && oxygen.power > 0 ? O2_REFILL_PER_LEVEL * oxygen.power : 0
  const sealed = (roomId: number): boolean => {
    let hasDoor = false
    for (const d of ship.doors) {
      if (d.a !== roomId && d.b !== roomId) continue
      hasDoor = true
      if (d.open) return false
    }
    return hasDoor
  }
  for (const room of ship.rooms) {
    if (refillRate <= 0) room.o2 -= O2_DECAY_NO_POWER * dt
    else if (!sealed(room.id)) room.o2 += refillRate * dt
  }

  // Diffusion: each OPEN door moves O2 from the high room to the low one.
  for (const door of ship.doors) {
    if (!door.open) continue
    const a = roomById(ship, door.a)
    const b = roomById(ship, door.b)
    if (!a || !b) continue
    const diff = a.o2 - b.o2
    const flow = O2_DIFFUSION_RATE * (Math.abs(diff) / 100) * dt
    if (diff > 0) {
      a.o2 -= flow
      b.o2 += flow
    } else if (diff < 0) {
      a.o2 += flow
      b.o2 -= flow
    }
  }

  for (const room of ship.rooms) {
    if (room.breach > 0) room.o2 -= BREACH_O2_DRAIN * dt

    if (room.fire > 0) {
      room.o2 -= FIRE_O2_BURN * dt
      damageSystem(ctx, side, room.id, FIRE_SYSTEM_DPS * dt)
      for (const crew of ship.crew) {
        if (crew.roomId === room.id) {
          crew.hp -= FIRE_CREW_DPS * dt * (CREW_RACES[crew.race]?.fireDamageMult ?? 1)
        }
      }
      if (room.o2 < FIRE_MIN_O2) room.fire -= FIRE_SUFFOCATE_RATE * dt
    }

    room.o2 = clamp(room.o2, 0, 100)
    room.fire = clamp(room.fire, 0, 100)
    room.breach = clamp(room.breach, 0, 100)
  }

  // Hypoxia (synthetics need no oxygen; some species resist the vacuum).
  for (const crew of ship.crew) {
    const room = roomById(ship, crew.roomId)
    if (room && room.o2 < O2_HYPOXIA_THRESHOLD) {
      crew.hp -= O2_HYPOXIA_DPS * dt * (CREW_RACES[crew.race]?.hypoxiaDamageMult ?? 1)
    }
  }

  // Fire spread, evaluated on a fixed period per ship. Fire only jumps through
  // OPEN doors, so closing a burning room's doors contains it (and starves it).
  ship.fireSpreadTimer += dt
  while (ship.fireSpreadTimer >= FIRE_SPREAD_PERIOD) {
    ship.fireSpreadTimer -= FIRE_SPREAD_PERIOD
    const ignite: number[] = []
    for (const door of ship.doors) {
      if (!door.open) continue
      const a = roomById(ship, door.a)
      const b = roomById(ship, door.b)
      if (!a || !b) continue
      if (a.fire > 0 && b.fire === 0 && ctx.rng() < FIRE_SPREAD_CHANCE) ignite.push(b.id)
      if (b.fire > 0 && a.fire === 0 && ctx.rng() < FIRE_SPREAD_CHANCE) ignite.push(a.id)
    }
    for (const id of ignite) {
      const target = roomById(ship, id)
      if (target) target.fire = FIRE_INTENSITY_ON_HIT
    }
  }
}
