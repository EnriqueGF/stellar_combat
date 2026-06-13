// Drone behaviour: combat (random-room shots), repair (worst system), defense (passive
// interception handled in weaponsim; its cooldown ticks down here).

import { DRONES, PROJECTILE_TRAVEL_TICKS } from '@stellar/shared'
import type { Side } from '@stellar/shared'
import { findSystem, otherSide, roomById } from './internal'
import type { BattleCtx } from './internal'

const DRONE_SHOT_DAMAGE = 1

export function tickDrones(ctx: BattleCtx, side: Side, dt: number): void {
  const ship = ctx.ships[side]
  const enemy = ctx.ships[otherSide(side)]
  const bayRoom = findSystem(ship, 'drones')?.roomId ?? null

  for (const slot of ship.drones) {
    if (!slot.powered) continue
    const def = DRONES[slot.droneId]

    if (def.kind === 'defensive') {
      slot.cooldown = Math.max(0, slot.cooldown - dt)
      continue
    }

    slot.cooldown -= dt
    while (slot.cooldown <= 0) {
      slot.cooldown += def.period

      if (def.kind === 'offensive') {
        const idx = Math.floor(ctx.rng() * enemy.rooms.length)
        const target = enemy.rooms[idx] ?? enemy.rooms[0]
        if (!target) continue
        const projId = ctx.nextProjId()
        ship.stats.shotsFired += 1
        ctx.projectiles.push({
          projId,
          from: side,
          weaponId: null,
          kind: 'drone_shot',
          category: 'energy',
          damage: DRONE_SHOT_DAMAGE,
          piercing: 0,
          fireChance: 0,
          breachChance: 0,
          accuracyMod: 0,
          damagesHull: true,
          targetRoomId: target.id,
          ticksLeft: PROJECTILE_TRAVEL_TICKS,
        })
        ctx.events.push({
          t: 'shot',
          side,
          projId,
          kind: 'drone_shot',
          weaponId: null,
          fromRoomId: bayRoom,
          targetRoomId: target.id,
          travelTicks: PROJECTILE_TRAVEL_TICKS,
        })
      } else {
        // Repair drone: 1 point to the most damaged system (breached rooms block repair).
        let best = null
        for (const sys of ship.systems) {
          if (sys.damage <= 0) continue
          if ((roomById(ship, sys.roomId)?.breach ?? 0) > 0) continue
          if (best === null || sys.damage > best.damage) best = sys
        }
        if (best) best.damage = Math.max(0, best.damage - 1)
      }
    }
  }
}
