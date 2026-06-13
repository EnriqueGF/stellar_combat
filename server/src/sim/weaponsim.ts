// Weapon charging, volley firing, projectile travel/resolution and beam sweeps.

import {
  BEAM_SHIELD_STRIP_HP,
  BEAM_TRAVEL_TICKS,
  DEFENSE_MODULES,
  DRONES,
  DRONE_DEFENSE_COOLDOWN_SEC,
  FIRE_INTENSITY_ON_HIT,
  PROJECTILE_TRAVEL_TICKS,
  WEAPONS,
  clamp,
} from '@stellar/shared'
import type { ProjectileKind, Side, WeaponDef } from '@stellar/shared'
import { grantVolleyXp, gunneryMultFor } from './crewsim'
import {
  EPS,
  categoryMult,
  damageSystem,
  findSystem,
  hitShields,
  otherSide,
  roomById,
  shieldLayersOf,
  systemInRoom,
} from './internal'
import type { BattleCtx, Projectile } from './internal'

function projectileKind(def: WeaponDef): ProjectileKind {
  if (def.category === 'energy') return 'laser'
  if (def.category === 'kinetic') return 'kinetic'
  return def.piercing === 'all' ? 'bomb' : 'missile'
}

export function tickWeapons(ctx: BattleCtx, side: Side, dt: number): void {
  const ship = ctx.ships[side]
  const enemy = ctx.ships[otherSide(side)]
  const weaponsSys = findSystem(ship, 'weapons')
  if (!weaponsSys) return
  const gunnery = gunneryMultFor(ship)

  for (const slot of ship.weapons) {
    const def = WEAPONS[slot.weaponId]
    const hasAmmo = !def.usesAmmo || ship.ammo > 0

    if (slot.powered && hasAmmo && slot.charge < 1) {
      slot.charge = Math.min(1, slot.charge + (dt / def.cooldown) * gunnery)
    }

    if (slot.charge < 1 || slot.targetRoomId === null || !slot.powered || !hasAmmo) continue
    if (!roomById(enemy, slot.targetRoomId)) {
      slot.targetRoomId = null
      continue
    }

    // Fire the volley.
    slot.charge = 0
    if (def.usesAmmo) ship.ammo -= 1
    grantVolleyXp(ctx, side)

    if (def.beamRooms > 0) {
      ship.stats.shotsFired += 1
      ctx.beams.push({
        from: side,
        weaponId: def.id,
        targetRoomId: slot.targetRoomId,
        ticksLeft: BEAM_TRAVEL_TICKS,
      })
    } else {
      for (let i = 0; i < def.shots; i++) {
        ship.stats.shotsFired += 1
        const projId = ctx.nextProjId()
        ctx.projectiles.push({
          projId,
          from: side,
          weaponId: def.id,
          kind: projectileKind(def),
          category: def.category,
          damage: def.damage,
          piercing: def.piercing,
          fireChance: def.fireChance,
          breachChance: def.breachChance,
          accuracyMod: def.accuracyMod,
          damagesHull: def.damagesHull,
          targetRoomId: slot.targetRoomId,
          ticksLeft: PROJECTILE_TRAVEL_TICKS,
        })
        ctx.events.push({
          t: 'shot',
          side,
          projId,
          kind: projectileKind(def),
          weaponId: def.id,
          fromRoomId: weaponsSys.roomId,
          targetRoomId: slot.targetRoomId,
          travelTicks: PROJECTILE_TRAVEL_TICKS,
        })
      }
    }

    if (!slot.autofire) slot.targetRoomId = null
  }
}

function resolveProjectile(ctx: BattleCtx, proj: Projectile): void {
  const attacker = ctx.ships[proj.from]
  const victimSide = otherSide(proj.from)
  const victim = ctx.ships[victimSide]
  const impactBase = {
    t: 'impact' as const,
    side: victimSide,
    projId: proj.projId,
    targetRoomId: proj.targetRoomId,
    hullDamage: 0,
    systemDamage: 0,
    shieldDamage: 0,
    fire: false,
    breach: false,
  }

  // 1) Interception: defense drone (one attempt per projectile), then point defense.
  for (const slot of victim.drones) {
    const def = DRONES[slot.droneId]
    if (def.kind !== 'defensive' || !slot.powered || slot.cooldown > 0) continue
    slot.cooldown = DRONE_DEFENSE_COOLDOWN_SEC
    if (ctx.rng() < def.interceptChance) {
      ctx.events.push({ ...impactBase, outcome: 'intercepted' })
      return
    }
    break
  }
  const module = DEFENSE_MODULES[victim.defenseModule]
  if (
    (proj.kind === 'missile' || proj.kind === 'bomb') &&
    module.missileInterceptChance > 0 &&
    ctx.rng() < module.missileInterceptChance
  ) {
    ctx.events.push({ ...impactBase, outcome: 'intercepted' })
    return
  }

  // 2) Shields absorb unless the weapon pierces through every layer.
  const layers = shieldLayersOf(victim)
  if (proj.piercing !== 'all' && victim.shieldHP > EPS && layers > proj.piercing) {
    const dmg = proj.damage * categoryMult(proj.category, 'shields')
    const applied = hitShields(ctx, victimSide, dmg)
    attacker.stats.damageDealt += applied
    victim.stats.damageTaken += applied
    attacker.stats.shotsHit += 1
    ctx.events.push({ ...impactBase, outcome: 'shield', shieldDamage: dmg })
    return
  }

  // 3) Evasion (flak's accuracy malus widens the miss window).
  const missChance = clamp(victim.evasion - proj.accuracyMod, 0, 1)
  if (ctx.rng() < missChance) {
    ctx.events.push({ ...impactBase, outcome: 'miss' })
    return
  }

  // 4) Hull + system damage + fire/breach procs.
  const hullDmg = proj.damagesHull
    ? proj.damage * categoryMult(proj.category, 'hull') * module.hullDamageMult
    : 0
  victim.hull = Math.max(0, victim.hull - hullDmg)
  const sysDmg = proj.damage * categoryMult(proj.category, 'systems')
  const sysApplied = damageSystem(ctx, victimSide, proj.targetRoomId, sysDmg)
  attacker.stats.damageDealt += hullDmg
  victim.stats.damageTaken += hullDmg
  attacker.stats.shotsHit += 1

  const room = roomById(victim, proj.targetRoomId)
  let fire = false
  let breach = false
  if (room) {
    if (proj.fireChance > 0 && ctx.rng() < proj.fireChance) {
      room.fire = Math.max(room.fire, FIRE_INTENSITY_ON_HIT)
      fire = true
    }
    if (proj.breachChance > 0 && ctx.rng() < proj.breachChance) {
      room.breach = 100
      breach = true
    }
  }
  ctx.events.push({
    ...impactBase,
    outcome: 'hull',
    hullDamage: hullDmg,
    systemDamage: sysApplied,
    fire,
    breach,
  })
}

/** Beam sweep: target room plus the connected room whose installed system has the highest level. */
function beamSecondRoom(ctx: BattleCtx, victimSide: Side, targetRoomId: number): number | null {
  const victim = ctx.ships[victimSide]
  const neighbors = [...(victim.adj.get(targetRoomId) ?? [])].sort((a, b) => a - b)
  if (neighbors.length === 0) return null
  let best: number | null = null
  let bestLevel = -1
  for (const id of neighbors) {
    const sys = systemInRoom(victim, id)
    if (sys && sys.level > bestLevel) {
      bestLevel = sys.level
      best = id
    }
  }
  return best ?? neighbors[0] ?? null
}

function resolveBeam(ctx: BattleCtx, beam: { from: Side; weaponId: WeaponDef['id']; targetRoomId: number }): void {
  const def = WEAPONS[beam.weaponId]
  const attacker = ctx.ships[beam.from]
  const victimSide = otherSide(beam.from)
  const victim = ctx.ships[victimSide]
  const module = DEFENSE_MODULES[victim.defenseModule]

  if (victim.shieldHP > EPS) {
    const dmg = BEAM_SHIELD_STRIP_HP * categoryMult('energy', 'shields')
    const applied = hitShields(ctx, victimSide, dmg)
    attacker.stats.damageDealt += applied
    victim.stats.damageTaken += applied
    attacker.stats.shotsHit += 1
    ctx.events.push({
      t: 'beam',
      side: beam.from,
      weaponId: def.id,
      roomIds: [beam.targetRoomId],
      blocked: true,
    })
    return
  }

  const roomIds = [beam.targetRoomId]
  if (def.beamRooms > 1) {
    const second = beamSecondRoom(ctx, victimSide, beam.targetRoomId)
    if (second !== null) roomIds.push(second)
  }
  for (const roomId of roomIds) {
    const hullDmg = def.damagesHull
      ? def.damage * categoryMult(def.category, 'hull') * module.hullDamageMult
      : 0
    victim.hull = Math.max(0, victim.hull - hullDmg)
    damageSystem(ctx, victimSide, roomId, def.damage * categoryMult(def.category, 'systems'))
    attacker.stats.damageDealt += hullDmg
    victim.stats.damageTaken += hullDmg
    const room = roomById(victim, roomId)
    if (room && def.fireChance > 0 && ctx.rng() < def.fireChance) {
      room.fire = Math.max(room.fire, FIRE_INTENSITY_ON_HIT)
    }
  }
  attacker.stats.shotsHit += 1
  ctx.events.push({ t: 'beam', side: beam.from, weaponId: def.id, roomIds, blocked: false })
}

export function tickProjectiles(ctx: BattleCtx): void {
  const arrivals: Projectile[] = []
  for (const proj of ctx.projectiles) {
    proj.ticksLeft -= 1
    if (proj.ticksLeft <= 0) arrivals.push(proj)
  }
  if (arrivals.length > 0) {
    ctx.projectiles = ctx.projectiles.filter((p) => p.ticksLeft > 0)
    for (const proj of arrivals) resolveProjectile(ctx, proj)
  }

  const beamArrivals = []
  for (const beam of ctx.beams) {
    beam.ticksLeft -= 1
    if (beam.ticksLeft <= 0) beamArrivals.push(beam)
  }
  if (beamArrivals.length > 0) {
    ctx.beams = ctx.beams.filter((b) => b.ticksLeft > 0)
    for (const beam of beamArrivals) resolveBeam(ctx, beam)
  }
}
