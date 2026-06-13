// O2, fire and breach simulation per ship (GAME_SPEC §3.5).

import {
  BREACH_O2_DRAIN,
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

  // O2 refill / decay. Refill choice (documented): the powered oxygen system adds
  // O2_REFILL_PER_LEVEL × power %/s uniformly to every room; unpowered, all rooms decay.
  const oxygen = findSystem(ship, 'oxygen')
  const o2Rate = oxygen && oxygen.power > 0 ? O2_REFILL_PER_LEVEL * oxygen.power : -O2_DECAY_NO_POWER
  for (const room of ship.rooms) room.o2 += o2Rate * dt

  // Diffusion: each door moves O2 from the high room to the low one.
  for (const [r1, r2] of ship.layout.doors) {
    const a = roomById(ship, r1)
    const b = roomById(ship, r2)
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
        if (crew.roomId === room.id) crew.hp -= FIRE_CREW_DPS * dt
      }
      if (room.o2 < FIRE_MIN_O2) room.fire -= FIRE_SUFFOCATE_RATE * dt
    }

    room.o2 = clamp(room.o2, 0, 100)
    room.fire = clamp(room.fire, 0, 100)
    room.breach = clamp(room.breach, 0, 100)
  }

  // Hypoxia.
  for (const crew of ship.crew) {
    const room = roomById(ship, crew.roomId)
    if (room && room.o2 < O2_HYPOXIA_THRESHOLD) crew.hp -= O2_HYPOXIA_DPS * dt
  }

  // Fire spread, evaluated on a fixed period per ship.
  ship.fireSpreadTimer += dt
  while (ship.fireSpreadTimer >= FIRE_SPREAD_PERIOD) {
    ship.fireSpreadTimer -= FIRE_SPREAD_PERIOD
    const burning = ship.rooms.filter((r) => r.fire > 0).map((r) => r.id)
    for (const roomId of burning) {
      for (const adjId of ship.adj.get(roomId) ?? []) {
        const target = roomById(ship, adjId)
        if (!target || target.fire > 0) continue
        if (ctx.rng() < FIRE_SPREAD_CHANCE) target.fire = FIRE_INTENSITY_ON_HIT
      }
    }
  }
}
