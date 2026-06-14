import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FIRE_MIN_O2,
  LOADOUT_PRESETS,
  NPC_TEMPLATES,
  SHIELD_REGEN_DELAY_SEC,
  SHIELD_REGEN_SEC,
  SHIPS,
  STARTING_AMMO,
  TICK_RATE,
  crewHpMax,
} from '@stellar/shared'
import type { BattleResult, CrewClassId, CrewRaceId, ShipClassId, SystemId } from '@stellar/shared'
import type { BattleOptions, CrewSetup, ShipSetup } from '../src/sim/api'
import { BattleSim } from '../src/sim/battle'
import { NpcController } from '../src/ai/npc'
import { RunManager, type BattleEntry } from '../src/run/runManager'
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
function crewMember(cls: CrewClassId, race: CrewRaceId = 'human'): CrewSetup {
  const hpMax = crewHpMax(cls, race, 1)
  crewIdCounter += 1
  return { id: `tcrew_${crewIdCounter}`, name: `Tripulante ${crewIdCounter}`, cls, race, level: 1, xp: 0, hp: hpMax, hpMax }
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
  // FTL-style: a battle starts with shields DOWN (0 layers) even though the ship
  // can support some (shields lvl 2 powered -> capacity of 1 layer = 2 HP).
  assert.equal(ship.shieldLayers, 0, 'shields start uncharged')
  assert.equal(ship.shieldLayersMax, 1)

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

test('shields start down and charge up layer by layer from the very start', () => {
  // shields lvl 4 + plenty of reactor -> capacity of 2 layers, both initially down.
  const setup = customSetup({ reactor: 10, systems: { engines: 2, weapons: 3, shields: 4, oxygen: 1, cockpit: 1 } })
  const sim = new BattleSim(setup, customSetup({}), OPTS)
  const ship = sim.shipState('a') as InternalShip
  assert.equal(ship.shieldLayersMax, 2, 'ship can support two layers')
  assert.equal(ship.shieldLayers, 0, 'but starts with shields down')
  assert.equal(ship.shieldHP, 0)

  // Charging begins immediately (no initial grace stall): the first layer arrives
  // roughly one regen period in, with no manual nudging of the timers.
  runTicks(sim, Math.ceil(SHIELD_REGEN_SEC * TICK_RATE) + 3)
  assert.equal(ship.shieldLayers, 1, 'first layer is up after ~one regen period')

  // The second layer follows one-by-one a regen period later.
  runTicks(sim, Math.ceil(SHIELD_REGEN_SEC * TICK_RATE) + 3)
  assert.equal(ship.shieldLayers, 2, 'second layer follows, reaching capacity')

  // A 'shield_layer' gain event (broke=false) is emitted as layers come up so the
  // client can play its charge blip.
  const sawGain = sim
    .drainEvents()
    .some((e) => e.t === 'shield_layer' && e.side === 'a' && e.broke === false)
  assert.ok(sawGain, 'a non-breaking shield_layer event marks a regained layer')
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

test('closing a room\'s doors isolates its air: the fire suffocates and cannot spread', () => {
  // Crew on systems (pilot->cockpit, gunner->weapons) so nobody roams to fight fire.
  const sim = new BattleSim(
    customSetup({ crew: [crewMember('pilot'), crewMember('gunner')] }),
    customSetup({}),
    OPTS,
  )
  const ship = sim.shipState('a') as InternalShip
  const sealed = ship.rooms.find((r) => r.id === 6)
  const neighbor = ship.rooms.find((r) => r.id === 2)
  assert.ok(sealed && neighbor)

  // Seal room 6 (close every door touching it) and light a fire with little air left.
  for (const d of ship.doors) if (d.a === 6 || d.b === 6) d.open = false
  sealed.fire = 80
  sealed.o2 = 26
  runTicks(sim, 6 * TICK_RATE)
  assert.equal(sealed.fire, 0, 'a sealed room runs out of O2 and the fire dies')
  assert.ok(sealed.o2 < FIRE_MIN_O2, 'the sealed room is cut off from the air supply')
  assert.equal(neighbor.fire, 0, 'fire cannot spread through closed doors')

  // Control: the same fire in an OPEN room (medbay, no crew) stays oxygenated by
  // refill + diffusion, so it does NOT suffocate. Ships now start sealed, so open
  // room 1's doors explicitly to recreate the "connected to the air supply" case.
  const open = ship.rooms.find((r) => r.id === 1)
  assert.ok(open)
  for (const d of ship.doors) if (d.a === 1 || d.b === 1) d.open = true
  open.fire = 60
  open.o2 = 30
  ship.fireSpreadTimer = 0
  runTicks(sim, 4 * TICK_RATE)
  assert.ok(open.o2 > FIRE_MIN_O2, 'an open room keeps its air, so the fire survives')
})

test('ships start fully sealed (all doors closed)', () => {
  const sim = new BattleSim(customSetup({}), customSetup({}), OPTS)
  for (const side of ['a', 'b'] as const) {
    const ship = sim.shipState(side)
    assert.ok(ship.doors.length > 0)
    assert.ok(ship.doors.every((d) => !d.open), `${side} should start with every door shut`)
  }
})

test('NPC AI seals burning rooms and vents breached rooms that still have crew', () => {
  const sim = new BattleSim(
    customSetup({ crew: [crewMember('pilot'), crewMember('engineer')] }),
    customSetup({}),
    OPTS,
  )
  const ai = new NpcController(sim, 'a')
  const ship = sim.shipState('a') as InternalShip

  // Fire in the weapons room (id 2, no crew): manually prop its doors open, then let
  // the AI react — it must shut every door touching the fire to contain + suffocate it.
  const fireRoom = ship.rooms.find((r) => r.id === 2)
  assert.ok(fireRoom)
  fireRoom.fire = 70
  for (const d of ship.doors) if (d.a === 2 || d.b === 2) d.open = true
  ai.update()
  for (const d of ship.doors) {
    if (d.a === 2 || d.b === 2) assert.equal(d.open, false, 'AI seals the burning room')
  }

  // Breach in a room with a crew member on station (engines, id 0): the AI opens its
  // doors so the oxygen system can repressurise it while the crew seals the hull.
  fireRoom.fire = 0
  const breachRoom = ship.rooms.find((r) => r.id === 0)
  assert.ok(breachRoom)
  assert.ok(ship.crew.some((c) => c.roomId === 0 && c.hp > 0), 'a crew member holds engines')
  breachRoom.breach = 100
  ai.update()
  assert.ok(
    ship.doors.some((d) => (d.a === 0 || d.b === 0) && d.open),
    'AI vents the breached, crewed room to keep its air',
  )
})

test('NPC AI dispatches a firefighter to a key-system fire and keeps them there', () => {
  const sim = new BattleSim(
    customSetup({ crew: [crewMember('pilot'), crewMember('soldier'), crewMember('engineer')] }),
    customSetup({}),
    OPTS,
  )
  const ai = new NpcController(sim, 'a')
  const ship = sim.shipState('a')
  const shieldsRoom = ship.systems.find((s) => s.id === 'shields')?.roomId
  assert.ok(shieldsRoom !== undefined)
  // Light a fire in the (initially unmanned) shields room.
  const room = ship.rooms.find((r) => r.id === shieldsRoom)
  assert.ok(room)
  room.fire = 70
  assert.ok(!ship.crew.some((c) => c.roomId === shieldsRoom), 'nobody starts in shields')

  let insideTicks = 0
  for (let i = 0; i < 300 && room.fire > 0; i++) {
    if (i % 10 === 0) ai.update()
    sim.tick()
    if (ship.crew.some((c) => c.roomId === shieldsRoom && c.hp > 0)) insideTicks += 1
  }
  assert.equal(room.fire, 0, 'the fire was put out')
  // The dispatched firefighter stayed to fight it for many ticks (the bug recalled
  // them the instant they arrived, so they never extinguished anything).
  assert.ok(insideTicks > 5, `firefighter stayed (was inside ${insideTicks} ticks)`)
})

test('run tracks lifetime scrap earned separately from the spendable balance', () => {
  const preset = LOADOUT_PRESETS.sentinel[0]
  assert.ok(preset)
  const run = new RunManager(setupFromLoadout(preset.loadout, 'Cap'), 5)
  assert.equal(run.scrapEarnedThisRun, 0)
  run.applyVictoryLoot(false)
  const earned = run.scrapEarnedThisRun
  assert.ok(earned >= 25, 'victory loot counts as earned')
  assert.equal(run.scrapTotal, earned, 'balance equals earned before spending')
  const before = run.scrapTotal
  run.buy({ kind: 'reactor' })
  assert.ok(run.scrapTotal < before, 'the reactor purchase spent scrap')
  assert.equal(run.scrapEarnedThisRun, earned, 'spending does not lower lifetime scrap earned')
})

test('species traits: synthetics ignore vacuum and tanky species carry more HP', () => {
  // HP scaling: a Pétreo soldier out-bulks a human soldier of the same class.
  assert.ok(crewHpMax('soldier', 'rockfolk', 1) > crewHpMax('soldier', 'human', 1))
  // Humans are the 1.0 baseline, so they match the raw class HP table.
  assert.equal(crewHpMax('soldier', 'human', 1), 125)

  // A synthetic stands in a fully vented ship and takes no suffocation damage,
  // while a human in the same predicament bleeds out.
  const sim = new BattleSim(
    customSetup({ crew: [crewMember('engineer', 'synthetic'), crewMember('soldier', 'human')] }),
    customSetup({}),
    OPTS,
  )
  const ship = sim.shipState('a')
  sim.setPower('a', 'oxygen', 0)
  for (const room of ship.rooms) room.o2 = 0
  const synth = ship.crew.find((c) => c.race === 'synthetic')
  const human = ship.crew.find((c) => c.race === 'human')
  assert.ok(synth && human)
  const synthHp = synth.hp
  const humanHp = human.hp
  runTicks(sim, 2 * TICK_RATE)
  assert.equal(synth.hp, synthHp, 'synthetics need no oxygen')
  assert.ok(human.hp < humanHp, 'humans suffocate in vacuum')
})

test('a landed sneak attack starts the enemy damaged and on fire', () => {
  const tpl = NPC_TEMPLATES[4]
  assert.ok(tpl)
  const sim = new BattleSim(
    customSetup({}),
    setupFromNpc(tpl, { enemyHullMult: 0.5, enemyStartFire: true }),
    OPTS,
  )
  const enemy = sim.shipState('b')
  assert.ok(enemy.hull < tpl.hull, 'enemy starts below full hull')
  assert.equal(enemy.hullMax, tpl.hull, 'max hull is unchanged')
  assert.ok(enemy.rooms.some((r) => r.fire > 0), 'a fire is burning at battle start')
  const weaponsRoom = enemy.systems.find((s) => s.id === 'weapons')?.roomId
  if (weaponsRoom !== undefined) {
    assert.ok((enemy.rooms.find((r) => r.id === weaponsRoom)?.fire ?? 0) > 0, 'the fire is in weapons')
  }
})

test('pre-combat encounter: arriving at a fight opens choices, "fight" queues the battle', () => {
  const preset = LOADOUT_PRESETS.sentinel[0]
  assert.ok(preset)
  const run = new RunManager(setupFromLoadout(preset.loadout, 'Capitana'), 99)
  // White-box: drive the encounter wrapper directly (reaching a non-first combat
  // node otherwise requires winning the column-1 fight first).
  const wb = run as unknown as { openCombat(entry: BattleEntry, col: number): { kind: string } }
  const tpl = NPC_TEMPLATES[2]
  assert.ok(tpl)
  const entry: BattleEntry = {
    kind: 'battle',
    template: tpl,
    elite: false,
    boss: false,
    firstBattle: false,
  }
  const screen = wb.openCombat(entry, 3)
  assert.equal(screen.kind, 'screen', 'a non-first fight shows an encounter screen first')
  const before = run.publicState()
  assert.ok(before.event, 'an encounter event is presented before the fight')
  assert.ok((before.event?.choices.length ?? 0) >= 1)

  // The first choice is always "fight" → resolving it starts the battle and clears
  // the encounter so post-battle routing is clean.
  const res = run.resolveEventChoice(0)
  assert.equal(res.kind, 'battle')
  assert.equal(run.publicState().event, null, 'the encounter clears once the fight begins')
})

test('jump: auto-charges from the start, then needs an engineer in the engines to flee', () => {
  const sim = new BattleSim(customSetup({}), customSetup({}), OPTS)
  const ship = sim.shipState('a')
  const enginesRoom = roomWithSystem('sentinel', 'engines')
  const weaponsRoom = roomWithSystem('sentinel', 'weapons')

  // No input needed: the drive charges automatically while engines have power.
  runTicks(sim, 2 * TICK_RATE)
  assert.ok(ship.jump.progress > 0, 'the drive charges by itself')
  assert.equal(ship.jump.ready, false)

  // Cutting engine power stalls the charge.
  sim.setPower('a', 'engines', 0)
  sim.tick()
  assert.equal(ship.jump.blocked, 'no_engine_power')
  const stalled = ship.jump.progress
  runTicks(sim, TICK_RATE)
  assert.equal(ship.jump.progress, stalled, 'no charge without engine power')
  sim.setPower('a', 'engines', 2)

  // Let it finish charging (JUMP_CHARGE_SEC is deliberately long).
  runTicks(sim, 55 * TICK_RATE)
  assert.equal(ship.jump.ready, true)

  // Empty the engine room: the jump is blocked and requestJump does nothing.
  for (const c of ship.crew) if (c.roomId === enginesRoom) sim.moveCrew('a', c.id, weaponsRoom)
  runTicks(sim, 4 * TICK_RATE)
  assert.equal(ship.jump.blocked, 'no_crew')
  sim.requestJump('a')
  const endedEarly = sim.result !== null
  assert.equal(endedEarly, false, 'cannot jump without a crew member in the engines')

  // Send a crew member to the engine room, then jump away.
  const someone = ship.crew[0]
  assert.ok(someone)
  sim.moveCrew('a', someone.id, enginesRoom)
  runTicks(sim, 6 * TICK_RATE)
  assert.equal(ship.jump.blocked, null)
  sim.requestJump('a')
  const result: BattleResult | null = sim.result
  assert.ok(result, 'jump completes with the engines manned')
  assert.equal(result.reason, 'fled')
  assert.equal(result.winner, 'b')
  assert.ok(sim.drainEvents().some((e) => e.t === 'fled' && e.side === 'a'))

  // tick() is a no-op once there is a result.
  const tickAfter = sim.tickCount
  sim.tick()
  assert.equal(sim.tickCount, tickAfter)
})

test('expedition: a saved energy distribution is restored instead of the default', () => {
  // The default distribution powers the engines (oxygen first, then shields/weapons/engines).
  const dflt = new BattleSim(customSetup({}), customSetup({}), OPTS).shipState('a')
  assert.ok(
    (dflt.systems.find((s) => s.id === 'engines')?.power ?? 0) > 0,
    'the default distribution powers the engines',
  )

  // A carried-over layout (engines deliberately at 0) must be honoured verbatim.
  const saved = customSetup({ power: { weapons: 3, shields: 2, oxygen: 1, engines: 0 } })
  const ship = new BattleSim(saved, customSetup({}), OPTS).shipState('a')
  assert.equal(ship.systems.find((s) => s.id === 'engines')?.power, 0)
  assert.equal(ship.systems.find((s) => s.id === 'weapons')?.power, 3)
  assert.equal(ship.systems.find((s) => s.id === 'shields')?.power, 2)
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
