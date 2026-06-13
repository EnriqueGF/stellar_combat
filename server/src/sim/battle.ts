// BattleSim: deterministic, pure 1v1 battle simulation (no Socket.IO). The host calls
// tick() at 20 tps, drains events after each tick and broadcasts snapshots at 10 Hz.

import {
  BOSS_PHASE2_BONUS_POWER,
  COCKPIT_JUMP_MULT,
  DEFENSE_MODULES,
  DUEL_SUDDEN_DEATH_SEC,
  DUEL_SUDDEN_DEATH_WARN_SEC,
  JUMP_CHARGE_SEC,
  SHIELD_HP_PER_LAYER,
  SHIELD_REGEN_DELAY_SEC,
  SHIELD_REGEN_SEC,
  TICK_MS,
  clamp,
  mulberry32,
} from '@stellar/shared'
import type {
  BattleEvent,
  BattleResult,
  BattleSnapshot,
  ShipState,
  Side,
  SystemId,
} from '@stellar/shared'
import type { BattleOptions, CrewSetup, IBattleSim, ShipSetup } from './api'
import { reapCrew, tickCrew } from './crewsim'
import { tickDrones } from './dronesim'
import { tickEnvironment } from './environment'
import {
  bfsPath,
  buildInternalShip,
  cockpitManned,
  findSystem,
  otherSide,
  recomputeShip,
  roomById,
  shieldLayersOf,
  usableLevel,
} from './internal'
import type { BattleCtx, InternalShip } from './internal'
import { tickProjectiles, tickWeapons } from './weaponsim'

const DT = TICK_MS / 1000
const SIDES: Side[] = ['a', 'b']

export class BattleSim implements IBattleSim {
  tickCount = 0
  result: BattleResult | null = null
  paused = false

  private readonly options: BattleOptions
  private readonly ctx: BattleCtx
  private projIdCounter = 0
  private suddenDeathWarned = false

  constructor(setupA: ShipSetup, setupB: ShipSetup, options: BattleOptions) {
    this.options = options
    this.ctx = {
      rng: mulberry32(options.seed),
      events: [],
      ships: { a: buildInternalShip(setupA), b: buildInternalShip(setupB) },
      projectiles: [],
      beams: [],
      nextProjId: () => ++this.projIdCounter,
      suddenDeath: false,
    }
    this.ctx.events.push({
      t: 'log',
      msg: `Combate iniciado: ${this.ctx.ships.a.name} contra ${this.ctx.ships.b.name}.`,
    })
  }

  // -------------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------------

  tick(): void {
    if (this.result !== null || this.paused) return
    this.tickCount += 1
    const elapsedSec = (this.tickCount * TICK_MS) / 1000
    this.updateSuddenDeath(elapsedSec)

    for (const side of SIDES) recomputeShip(this.ctx.ships[side])
    for (const side of SIDES) tickCrew(this.ctx, side, DT)
    for (const side of SIDES) tickEnvironment(this.ctx, side, DT)
    for (const side of SIDES) this.tickShields(side)
    for (const side of SIDES) tickWeapons(this.ctx, side, DT)
    for (const side of SIDES) tickDrones(this.ctx, side, DT)
    tickProjectiles(this.ctx)
    for (const side of SIDES) this.tickJump(side)
    for (const side of SIDES) this.checkBossPhase(side)
    for (const side of SIDES) recomputeShip(this.ctx.ships[side])
    this.checkEnd()
  }

  private updateSuddenDeath(elapsedSec: number): void {
    const limit = this.options.suddenDeathSec
    if (limit === null) return
    const warnLead = DUEL_SUDDEN_DEATH_SEC - DUEL_SUDDEN_DEATH_WARN_SEC
    if (!this.suddenDeathWarned && elapsedSec >= Math.max(0, limit - warnLead)) {
      this.suddenDeathWarned = true
      this.ctx.events.push({
        t: 'log',
        msg: `¡Alerta! Muerte súbita en ${Math.round(warnLead)} s: los escudos dejarán de regenerar.`,
      })
    }
    if (elapsedSec > limit && !this.ctx.suddenDeath) {
      this.ctx.suddenDeath = true
      this.ctx.events.push({
        t: 'log',
        msg: 'Muerte súbita: la regeneración de escudos queda desactivada.',
      })
    }
  }

  private tickShields(side: Side): void {
    const ship = this.ctx.ships[side]
    ship.sinceShieldHit += DT
    const maxHP = ship.shieldLayersMax * SHIELD_HP_PER_LAYER
    if (this.ctx.suddenDeath || maxHP <= 0 || ship.shieldHP >= maxHP - 1e-9) {
      ship.shieldRegen = 0
      return
    }
    if (ship.sinceShieldHit < SHIELD_REGEN_DELAY_SEC) return
    const regenTime = SHIELD_REGEN_SEC * DEFENSE_MODULES[ship.defenseModule].shieldRegenTimeMult
    ship.shieldRegen += DT / regenTime
    if (ship.shieldRegen >= 1) {
      ship.shieldRegen = 0
      const before = shieldLayersOf(ship)
      ship.shieldHP = Math.min(maxHP, ship.shieldHP + SHIELD_HP_PER_LAYER)
      const after = shieldLayersOf(ship)
      if (after !== before) {
        this.ctx.events.push({ t: 'shield_layer', side, layers: after, broke: false })
      }
    }
  }

  private tickJump(side: Side): void {
    const ship = this.ctx.ships[side]
    if (!ship.jump.charging) {
      ship.jump.blocked = null
      return
    }
    const engines = findSystem(ship, 'engines')
    if (!cockpitManned(ship)) {
      ship.jump.blocked = 'no_pilot'
      return
    }
    if ((engines?.power ?? 0) < 1) {
      ship.jump.blocked = 'no_engine_power'
      return
    }
    ship.jump.blocked = null
    const cockpit = findSystem(ship, 'cockpit')
    const level = clamp(cockpit ? usableLevel(cockpit) : 1, 1, COCKPIT_JUMP_MULT.length)
    const mult = COCKPIT_JUMP_MULT[level - 1] ?? 1
    ship.jump.progress = Math.min(1, ship.jump.progress + DT / (JUMP_CHARGE_SEC / mult))
    if (ship.jump.progress >= 1 && this.result === null) {
      this.ctx.events.push({ t: 'jump_charged', side })
      this.ctx.events.push({ t: 'fled', side })
      this.ctx.events.push({ t: 'log', msg: `${ship.name} ha saltado y huye del combate.` })
      this.finish(otherSide(side), 'fled')
    }
  }

  private checkBossPhase(side: Side): void {
    const ship = this.ctx.ships[side]
    if (!ship.boss || ship.bossPhase2Done || ship.hull > ship.hullMax / 2) return
    ship.bossPhase2Done = true
    ship.reactor += BOSS_PHASE2_BONUS_POWER
    let extra = BOSS_PHASE2_BONUS_POWER
    for (const id of ['weapons', 'engines'] as SystemId[]) {
      const sys = findSystem(ship, id)
      if (!sys) continue
      const add = Math.min(usableLevel(sys) - sys.power, extra)
      if (add > 0) {
        sys.power += add
        extra -= add
      }
    }
    this.ctx.events.push({ t: 'log', msg: '¡El Hegemón entra en frenesí!' })
  }

  private checkEnd(): void {
    if (this.result !== null) return
    const aDead = this.ctx.ships.a.hull <= 0
    const bDead = this.ctx.ships.b.hull <= 0
    if (aDead) this.ctx.events.push({ t: 'hull_destroyed', side: 'a' })
    if (bDead) this.ctx.events.push({ t: 'hull_destroyed', side: 'b' })
    if (aDead || bDead) {
      this.finish(aDead && bDead ? null : aDead ? 'b' : 'a', 'destroyed')
      return
    }
    const aCrewGone = reapCrew(this.ctx, 'a')
    const bCrewGone = reapCrew(this.ctx, 'b')
    if (aCrewGone || bCrewGone) {
      this.finish(aCrewGone && bCrewGone ? null : aCrewGone ? 'b' : 'a', 'crew_dead')
    }
  }

  private finish(winner: Side | null, reason: BattleResult['reason']): void {
    if (this.result !== null) return
    const durationSec = (this.tickCount * TICK_MS) / 1000
    this.ctx.ships.a.stats.durationSec = durationSec
    this.ctx.ships.b.stats.durationSec = durationSec
    this.result = {
      winner,
      reason,
      stats: { a: { ...this.ctx.ships.a.stats }, b: { ...this.ctx.ships.b.stats } },
    }
  }

  // -------------------------------------------------------------------------
  // Intents (all validated; illegal ones are ignored)
  // -------------------------------------------------------------------------

  setPower(side: Side, system: SystemId, value: number): void {
    if (this.result !== null || !Number.isFinite(value)) return
    const ship = this.ctx.ships[side]
    const sys = findSystem(ship, system)
    if (!sys) return
    const othersAllocated = ship.systems.reduce((a, s) => (s === sys ? a : a + s.power), 0)
    const free = Math.max(0, ship.reactor - othersAllocated)
    sys.power = clamp(Math.floor(value), 0, Math.min(usableLevel(sys), free))
    recomputeShip(ship)
  }

  setTarget(side: Side, weaponSlot: number, roomId: number | null): void {
    if (this.result !== null) return
    const ship = this.ctx.ships[side]
    const slot = ship.weapons[weaponSlot]
    if (!slot) return
    if (roomId === null) {
      slot.targetRoomId = null
      return
    }
    if (!roomById(this.ctx.ships[otherSide(side)], roomId)) return
    slot.targetRoomId = roomId
  }

  toggleAutofire(side: Side, weaponSlot: number): void {
    if (this.result !== null) return
    const slot = this.ctx.ships[side].weapons[weaponSlot]
    if (slot) slot.autofire = !slot.autofire
  }

  moveCrew(side: Side, crewId: string, roomId: number): void {
    if (this.result !== null) return
    const ship = this.ctx.ships[side]
    const crew = ship.crew.find((c) => c.id === crewId)
    if (!crew || !roomById(ship, roomId)) return
    crew.stationRoomId = roomId
    crew.path = bfsPath(ship, crew.roomId, roomId)
    crew.task = crew.path.length > 0 ? 'moving' : crew.task
  }

  toggleDrone(side: Side, droneSlot: number): void {
    if (this.result !== null) return
    const slot = this.ctx.ships[side].drones[droneSlot]
    if (!slot) return
    slot.enabled = !slot.enabled
    recomputeShip(this.ctx.ships[side])
  }

  setJumpCharging(side: Side, charging: boolean): void {
    if (this.result !== null) return
    const ship = this.ctx.ships[side]
    if (charging && !ship.jump.charging) {
      this.ctx.events.push({ t: 'log', msg: `${ship.name} está cargando el salto de huida.` })
    }
    ship.jump.charging = charging
    if (!charging) ship.jump.blocked = null
  }

  surrender(side: Side): void {
    if (this.result !== null) return
    this.ctx.events.push({ t: 'log', msg: `${this.ctx.ships[side].name} se rinde.` })
    this.finish(otherSide(side), 'surrender')
  }

  forfeit(side: Side): void {
    if (this.result !== null) return
    this.ctx.events.push({
      t: 'log',
      msg: `${this.ctx.ships[side].name} pierde el combate por desconexión.`,
    })
    this.finish(otherSide(side), 'disconnect')
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  drainEvents(): BattleEvent[] {
    const events = this.ctx.events
    this.ctx.events = []
    return events
  }

  snapshotFor(side: Side): BattleSnapshot {
    return {
      tick: this.tickCount,
      paused: this.paused,
      pauseAllowed: this.options.pauseAllowed,
      you: toPublicShipState(this.ctx.ships[side]),
      enemy: toPublicShipState(this.ctx.ships[otherSide(side)]),
    }
  }

  shipState(side: Side): ShipState {
    return this.ctx.ships[side]
  }

  crewExport(side: Side): CrewSetup[] {
    return this.ctx.ships[side].crew
      .filter((c) => c.hp > 0)
      .map((c) => ({
        id: c.id,
        name: c.name,
        cls: c.cls,
        level: c.level,
        xp: c.xp,
        hp: Math.max(1, Math.round(c.hp)),
        hpMax: c.hpMax,
      }))
  }
}

/** Deep-copied, ShipState-only view (internal fields never leave the sim). */
function toPublicShipState(ship: InternalShip): ShipState {
  return structuredClone({
    shipClass: ship.shipClass,
    hull: ship.hull,
    hullMax: ship.hullMax,
    reactor: ship.reactor,
    sparePower: ship.sparePower,
    systems: ship.systems,
    rooms: ship.rooms,
    crew: ship.crew,
    weapons: ship.weapons,
    drones: ship.drones,
    defenseModule: ship.defenseModule,
    shieldLayers: ship.shieldLayers,
    shieldLayersMax: ship.shieldLayersMax,
    shieldRegen: ship.shieldRegen,
    evasion: ship.evasion,
    jump: ship.jump,
    ammo: ship.ammo,
    ammoMax: ship.ammoMax,
  })
}
