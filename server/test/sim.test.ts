import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CREW_CLASSES,
  LOADOUT_PRESETS,
  NPC_TEMPLATES,
  SHIELD_REGEN_DELAY_SEC,
  SHIELD_REGEN_SEC,
  SHIPS,
  STARTING_AMMO,
  TICK_RATE,
} from '@stellar/shared'
import type { CrewClassId, ShipClassId, SystemId } from '@stellar/shared'
import type { BattleOptions, CrewSetup, ShipSetup } from '../src/sim/api'
import { BattleSim } from '../src/sim/battle'
import { categoryMult } from '../src/sim/internal'
import type { InternalShip } from '../src/sim/internal'
import { setupFromLoadout, setupFromNpc } from '../src/sim/setup'

const OPTS: BattleOptions = { seed: 42, pauseAllowed: true, suddenDeathSec: null }

function roomWithSystem(shipClass: ShipClassId, system: SystemId): number {
  const room = SHIPS[shipClass].layout.rooms.find((r) => r.system === system)
  assert.ok(room, `${shipClass} should have a ${system} room`)
  return room.id
}

let crewIdCounter = 0
function crewMember(cls: CrewClassId): CrewSetup {
  const hpMax = CREW_CLASSES[cls].hpMax[0]
  crewIdCounter += 1
  return { id: `tcrew_${crewIdCounter}`, name: `Tripulante ${crewIdCounter}`, cls, level: 1, xp: 0, hp: hpMax, hpMax }
}

function customSetup(over: Partial<ShipSetup>): ShipSetup {
  return {
    shipClass: 'sentinel',
    name: 'Nave de pruebas',
    hull: 30,
    hullMax: 30,
    reactor: 8,
    systems: { engines: 2, weapons: 3, shields: 2, oxygen: 1, cockpit: 1 },
    weapons: [],
    drones: [],
    defenseModule: 'mod_shields_std',
    crew: [crewMember('pilot'), crewMember('engineer')],
    ammo: STARTING_AMMO,
    ...over,
  }
}

function assertNoNaN(v: unknown, path = '$'): void {
  if (typeof v === 'number') {
    assert.ok(Number.isFinite(v), `non-finite number at ${path}: ${v}`)
    return
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => assertNoNaN(x, `${path}[${i}]`))
    return
  }
  if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) assertNoNaN(x, `${path}.${k}`)
  }
}

function runTicks(sim: BattleSim, ticks: number): void {
  for (let i = 0; i < ticks && sim.result === null; i++) sim.tick()
}

test('NPC col2 vs col3 with autofire reaches a result in under 10 simulated minutes', () => {
  const tplA = NPC_TEMPLATES[1]
  const tplB = NPC_TEMPLATES[2]
  assert.ok(tplA && tplB)
  const sim = new BattleSim(setupFromNpc(tplA), setupFromNpc(tplB), {
    seed: 1337,
    pauseAllowed: false,
    suddenDeathSec: 300,
  })

  const targetForA = roomWithSystem(tplB.shipClass, 'weapons')
  const targetForB = roomWithSystem(tplA.shipClass, 'weapons')
  for (let slot = 0; slot < tplA.weapons.length; slot++) {
    sim.setTarget('a', slot, targetForA)
    sim.toggleAutofire('a', slot)
  }
  for (let slot = 0; slot < tplB.weapons.length; slot++) {
    sim.setTarget('b', slot, targetForB)
    sim.toggleAutofire('b', slot)
  }

  const maxTicks = 10 * 60 * TICK_RATE
  for (let i = 0; i < maxTicks && sim.result === null; i++) {
    sim.tick()
    if (i % 200 === 0) {
      assertNoNaN(sim.snapshotFor('a'))
      assertNoNaN(sim.drainEvents())
    }
  }

  const result = sim.result
  assert.ok(result, 'battle should finish in under 10 simulated minutes')
  assert.ok(result.winner === 'a' || result.winner === 'b')
  assert.ok(result.reason === 'destroyed' || result.reason === 'crew_dead')
  assertNoNaN(result)
  assertNoNaN(sim.snapshotFor('a'))
  assertNoNaN(sim.snapshotFor('b'))

  for (const side of ['a', 'b'] as const) {
    const stats = result.stats[side]
    assert.ok(stats.shotsFired > 0, `${side} should have fired`)
    assert.ok(stats.shotsHit <= stats.shotsFired)
    assert.ok(stats.damageDealt >= 0 && stats.damageTaken >= 0)
    assert.ok(Math.abs(stats.durationSec - (sim.tickCount * 50) / 1000) < 1e-6)
  }
  assert.equal(result.stats.a.damageDealt, result.stats.b.damageTaken)
  assert.equal(result.stats.b.damageDealt, result.stats.a.damageTaken)
  if (result.reason === 'destroyed') {
    const loser = result.winner === 'a' ? 'b' : 'a'
    assert.ok(result.stats[loser].damageTaken > 0)
  }
})

test('damage triangle multipliers follow the spec exactly', () => {
  assert.equal(categoryMult('energy', 'shields'), 1.25)
  assert.equal(categoryMult('energy', 'hull'), 0.75)
  assert.equal(categoryMult('energy', 'systems'), 1)
  assert.equal(categoryMult('kinetic', 'hull'), 1.25)
  assert.equal(categoryMult('kinetic', 'systems'), 0.75)
  assert.equal(categoryMult('kinetic', 'shields'), 1)
  assert.equal(categoryMult('explosive', 'systems'), 1.25)
  assert.equal(categoryMult('explosive', 'shields'), 0.75)
  assert.equal(categoryMult('explosive', 'hull'), 1)
})

test('shield regen respects the grace delay and resets on impact', () => {
  const sim = new BattleSim(customSetup({}), customSetup({}), OPTS)
  const ship = sim.shipState('b') as InternalShip
  assert.equal(ship.shieldLayers, 1) // shields lvl 2 powered -> 1 layer = 2 HP

  ship.shieldHP = 0.5
  ship.sinceShieldHit = 0
  ship.shieldRegen = 0

  // During the grace delay no progress accumulates.
  runTicks(sim, Math.floor(SHIELD_REGEN_DELAY_SEC * TICK_RATE) - 1)
  assert.equal(ship.shieldRegen, 0)
  assert.ok(ship.shieldHP < 1)

  // After the delay, progress accrues...
  runTicks(sim, TICK_RATE) // 1s past the delay
  assert.ok(ship.shieldRegen > 0)
  const progress = ship.shieldRegen

  // ...and a new shield impact resets the grace timer, freezing progress again.
  ship.sinceShieldHit = 0
  runTicks(sim, Math.floor(SHIELD_REGEN_DELAY_SEC * TICK_RATE) - 2)
  assert.ok(Math.abs(ship.shieldRegen - progress) < 1e-9, 'progress frozen during new delay')

  // Eventually a full layer comes back.
  runTicks(sim, Math.ceil((SHIELD_REGEN_DELAY_SEC + SHIELD_REGEN_SEC) * TICK_RATE) + 5)
  assert.ok(ship.shieldHP >= 2 - 1e-9)
  assert.equal(ship.shieldLayers, 1)
})

test('sudden death disables shield regeneration', () => {
  const sim = new BattleSim(customSetup({}), customSetup({}), {
    seed: 7,
    pauseAllowed: false,
    suddenDeathSec: 1,
  })
  runTicks(sim, 2 * TICK_RATE) // get past the sudden-death threshold
  const ship = sim.shipState('a') as InternalShip
  ship.shieldHP = 0.5
  ship.sinceShieldHit = 100
  runTicks(sim, 20 * TICK_RATE)
  assert.equal(ship.shieldRegen, 0)
  assert.ok(ship.shieldHP <= 0.5 + 1e-9, 'no regen under sudden death')
})

test('O2 decays without powered oxygen, breaches drain rooms, hypoxia hurts crew', () => {
  // Crew stationed on systems (pilot->cockpit, gunner->weapons) so nobody roams to seal.
  const sim = new BattleSim(
    customSetup({ crew: [crewMember('pilot'), crewMember('gunner')] }),
    customSetup({}),
    OPTS,
  )
  sim.setPower('a', 'oxygen', 0)
  const ship = sim.shipState('a')

  runTicks(sim, 5 * TICK_RATE)
  for (const room of ship.rooms) assert.ok(room.o2 < 100, `room ${room.id} should lose O2`)

  // Breach in the empty room (id 6 on the sentinel) drains it faster than the rest.
  const breachRoom = ship.rooms.find((r) => r.id === 6)
  const referenceRoom = ship.rooms.find((r) => r.id === 0)
  assert.ok(breachRoom && referenceRoom)
  breachRoom.breach = 100
  const breachStart = breachRoom.o2
  runTicks(sim, 5 * TICK_RATE)
  assert.ok(breachRoom.breach > 0, 'no crew should be sealing the breach')
  assert.ok(breachRoom.o2 < breachStart)
  assert.ok(breachRoom.o2 < referenceRoom.o2, 'breached room drains faster')

  // Hypoxia: empty the whole ship of O2 and watch crew HP fall.
  for (const room of ship.rooms) room.o2 = 0
  const crew = ship.crew[0]
  assert.ok(crew)
  const hpBefore = crew.hp
  runTicks(sim, 2 * TICK_RATE)
  assert.ok(crew.hp < hpBefore, 'crew suffocates below the hypoxia threshold')
})

test('flee: charges, pauses when the cockpit is vacated, completes with a fled result', () => {
  const sim = new BattleSim(customSetup({}), customSetup({}), OPTS)
  const ship = sim.shipState('a')
  const cockpitRoom = roomWithSystem('sentinel', 'cockpit')
  const enginesRoom = roomWithSystem('sentinel', 'engines')
  const pilot = ship.crew.find((c) => c.roomId === cockpitRoom)
  assert.ok(pilot, 'a crew member must start in the cockpit')

  sim.setJumpCharging('a', true)
  runTicks(sim, 2 * TICK_RATE)
  assert.ok(ship.jump.charging)
  assert.ok(ship.jump.progress > 0, 'charge advances with pilot + engine power')
  assert.equal(ship.jump.blocked, null)

  // Vacate the cockpit: progress pauses (does not reset) and blocked says why.
  sim.moveCrew('a', pilot.id, enginesRoom)
  runTicks(sim, 3 * TICK_RATE)
  assert.equal(pilot.roomId, enginesRoom)
  const pausedProgress = ship.jump.progress
  assert.equal(ship.jump.blocked, 'no_pilot')
  runTicks(sim, 2 * TICK_RATE)
  assert.equal(ship.jump.progress, pausedProgress, 'progress paused while unmanned')

  // Cutting engine power blocks for the other reason.
  sim.moveCrew('a', pilot.id, cockpitRoom)
  runTicks(sim, 3 * TICK_RATE)
  sim.setPower('a', 'engines', 0)
  sim.tick()
  assert.equal(ship.jump.blocked, 'no_engine_power')
  sim.setPower('a', 'engines', 2)

  // Let it complete.
  runTicks(sim, 20 * TICK_RATE)
  const result = sim.result
  assert.ok(result, 'jump should have completed')
  assert.equal(result.reason, 'fled')
  assert.equal(result.winner, 'b')
  const events = sim.drainEvents()
  assert.ok(events.some((e) => e.t === 'jump_charged' && e.side === 'a'))
  assert.ok(events.some((e) => e.t === 'fled' && e.side === 'a'))

  // tick() is a no-op once there is a result.
  const tickAfter = sim.tickCount
  sim.tick()
  assert.equal(sim.tickCount, tickAfter)
})

test('setupFromLoadout builds a valid ShipSetup from a preset', () => {
  const preset = LOADOUT_PRESETS.sentinel[0]
  assert.ok(preset)
  const setup = setupFromLoadout(preset.loadout, 'Capitana Vega')

  assert.equal(setup.shipClass, 'sentinel')
  assert.equal(setup.name, 'Capitana Vega')
  assert.equal(setup.hull, SHIPS.sentinel.hullMax)
  assert.equal(setup.reactor, SHIPS.sentinel.reactor)
  assert.deepEqual(setup.systems, SHIPS.sentinel.systems)
  assert.equal(setup.crew.length, 4)
  assert.equal(setup.ammo, STARTING_AMMO)
  for (const member of setup.crew) {
    assert.ok(member.hp === member.hpMax && member.hp > 0)
    assert.equal(member.level, 1)
  }
  const ids = new Set(setup.crew.map((c) => c.id))
  assert.equal(ids.size, 4, 'crew ids must be unique')

  // It must boot a battle without issues.
  const sim = new BattleSim(setup, setupFromNpc(NPC_TEMPLATES[0]!), OPTS)
  const snap = sim.snapshotFor('a')
  assertNoNaN(snap)
  assert.equal(snap.you.weapons.length, preset.loadout.weapons.length)
  assert.equal(snap.you.crew.length, 4)
  assert.ok(snap.you.evasion >= 0)
  runTicks(sim, TICK_RATE)
  assertNoNaN(sim.snapshotFor('a'))
})
