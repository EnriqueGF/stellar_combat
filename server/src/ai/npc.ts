// NPC battle AI. Also used as autopilot for disconnected expedition players.
// Called every ~0.5 s (10 ticks) by the battle host; recomputes power, targets,
// drones and crew triage from the live ship states. It never flees.

import { MAX_DRONES_ACTIVE, WEAPONS, type ShipState, type Side, type SystemId, type SystemState } from '@stellar/shared'
import type { IBattleSim } from '../sim/api'

const MEDBAY_GO_BELOW = 0.3
const MEDBAY_LEAVE_AT = 0.95
/** Systems worth pulling a crew member off station to save from a fire. */
const FIRE_PRIORITY_SYSTEMS: ReadonlySet<SystemId> = new Set(['weapons', 'shields', 'engines', 'oxygen'])

export class NpcController {
  private readonly foeSide: Side
  /** First-seen station per crew id, to send them back after a detour. */
  private readonly homeRooms = new Map<string, number>()
  /** Crew currently being kept in the medbay (hysteresis: enter <30%, leave >=95%). */
  private readonly healingIds = new Set<string>()

  constructor(
    private readonly sim: IBattleSim,
    private readonly side: Side,
  ) {
    this.foeSide = side === 'a' ? 'b' : 'a'
  }

  update(): void {
    if (this.sim.result) return
    const me = this.sim.shipState(this.side)
    const foe = this.sim.shipState(this.foeSide)
    this.allocatePower(me)
    this.manageWeapons(me, foe)
    this.manageDrones(me)
    this.manageDoors(me)
    this.manageCrew(me)
  }

  private usable(sys: SystemState | undefined): number {
    if (!sys) return 0
    return Math.max(0, sys.level - Math.floor(sys.damage))
  }

  /** Priority: full shields > weapons that fit > engines > O2 (if low) > medbay (if hurt) > drones. */
  private allocatePower(me: ShipState): void {
    const bySys = new Map<SystemId, SystemState>()
    for (const s of me.systems) bySys.set(s.id, s)

    let budget = me.reactor
    const want = new Map<SystemId, number>()
    const give = (id: SystemId, amount: number): void => {
      const sys = bySys.get(id)
      if (!sys) return
      const v = Math.max(0, Math.min(this.usable(sys), amount, budget))
      want.set(id, v)
      budget -= v
    }

    give('shields', Number.POSITIVE_INFINITY)
    give('weapons', this.weaponPowerNeed(me, bySys.get('weapons')))
    give('engines', Number.POSITIVE_INFINITY)
    give('oxygen', me.rooms.some((r) => r.o2 < 50) ? Number.POSITIVE_INFINITY : 0)
    give('medbay', me.crew.some((c) => c.hp > 0 && c.hp < c.hpMax) ? Number.POSITIVE_INFINITY : 0)
    give('drones', this.dronePowerNeed(me, bySys.get('drones')))
    // Cockpit consumes no energy (GAME_SPEC §2.2); anything not listed drops to 0.

    // Lower first to free reactor power, then raise in priority order.
    for (const s of me.systems) {
      const target = want.get(s.id) ?? 0
      if (target < s.power) this.sim.setPower(this.side, s.id, target)
    }
    for (const [id, target] of want) {
      const sys = bySys.get(id)
      if (sys && target > sys.power) this.sim.setPower(this.side, id, target)
    }
  }

  /** Sum of weapon power for the slots that fit in the usable weapons level, in slot order. */
  private weaponPowerNeed(me: ShipState, sys: SystemState | undefined): number {
    const cap = this.usable(sys)
    let need = 0
    for (const slot of me.weapons) {
      const def = WEAPONS[slot.weaponId]
      if (def.usesAmmo && me.ammo <= 0) continue
      if (need + def.power <= cap) need += def.power
    }
    return need
  }

  /** Drone bay model: 1 active drone per powered bay level (GAME_SPEC §2.2). */
  private dronePowerNeed(me: ShipState, sys: SystemState | undefined): number {
    if (me.drones.length === 0) return 0
    return Math.min(me.drones.length, this.usable(sys), MAX_DRONES_ACTIVE)
  }

  /**
   * Energy/kinetic guns hammer the enemy SHIELDS room until that system is down,
   * then switch to WEAPONS. Missiles hold fire until layers <= piercing, then go
   * for valuable system damage (shields room while up, weapons room otherwise).
   */
  private manageWeapons(me: ShipState, foe: ShipState): void {
    const foeShields = foe.systems.find((s) => s.id === 'shields')
    const shieldsUp = this.usable(foeShields) > 0
    const shieldsRoom = foeShields?.roomId
    const weaponsRoom = foe.systems.find((s) => s.id === 'weapons')?.roomId
    const fallback = weaponsRoom ?? shieldsRoom ?? foe.rooms[0]?.id ?? 0
    const gunTarget = shieldsUp ? (shieldsRoom ?? fallback) : (weaponsRoom ?? fallback)

    me.weapons.forEach((slot, idx) => {
      if (!slot.autofire) this.sim.toggleAutofire(this.side, idx)
      const def = WEAPONS[slot.weaponId]
      let target: number | null
      if (def.usesAmmo) {
        if (me.ammo <= 0) {
          target = null
        } else if (def.piercing === 'all') {
          target = weaponsRoom ?? fallback
        } else if (foe.shieldLayers <= def.piercing) {
          target = shieldsUp ? (shieldsRoom ?? fallback) : (weaponsRoom ?? fallback)
        } else {
          target = null
        }
      } else {
        target = gunTarget
      }
      if (slot.targetRoomId !== target) this.sim.setTarget(this.side, idx, target)
    })
  }

  private manageDrones(me: ShipState): void {
    me.drones.forEach((slot, idx) => {
      if (!slot.enabled) this.sim.toggleDrone(this.side, idx)
    })
  }

  /**
   * Door control (FTL-style). Ships start sealed; the AI keeps it that way so fires
   * suffocate and cannot spread, but it deliberately CLOSES any door touching a
   * burning room (containment) and OPENS the doors of a breached room that still has
   * crew inside, so the oxygen system can repressurise it while they seal the hull.
   */
  private manageDoors(me: ShipState): void {
    const opinion = (roomId: number): boolean | null => {
      const room = me.rooms.find((r) => r.id === roomId)
      if (!room) return null
      if (room.fire > 0) return true // seal: contain + suffocate the fire
      if (room.breach > 0 && me.crew.some((c) => c.hp > 0 && c.roomId === roomId)) return false
      return null
    }
    for (const door of me.doors) {
      const a = opinion(door.a)
      const b = opinion(door.b)
      // Sealing a fire beats venting a breach; with no opinion, stay shut (default).
      const wantOpen = a === true || b === true ? false : a === false || b === false
      if (door.open !== wantOpen) this.sim.toggleDoor(this.side, door.id)
    }
  }

  /**
   * Crew director: keeps badly hurt crew in the medbay (with hysteresis), pulls a
   * healthy crew member off station to fight fires threatening key systems, and
   * sends everyone back to their post once the emergency is over.
   */
  private manageCrew(me: ShipState): void {
    const medbay = me.systems.find((s) => s.id === 'medbay')
    const medbayRoom = medbay && this.usable(medbay) > 0 ? medbay.roomId : null

    // Record home stations and refresh medbay hysteresis FIRST, so firefighter
    // assignment below already sees this tick's healing state.
    for (const c of me.crew) {
      if (!this.homeRooms.has(c.id)) this.homeRooms.set(c.id, c.stationRoomId)
      if (c.hp <= 0) continue
      if (medbayRoom !== null && c.hp < c.hpMax * MEDBAY_GO_BELOW) this.healingIds.add(c.id)
      else if (medbayRoom === null || c.hp >= c.hpMax * MEDBAY_LEAVE_AT) this.healingIds.delete(c.id)
    }

    // Fires in priority system rooms: keep one firefighter on each.
    const fireAssignments = this.assignFirefighters(me, medbayRoom)

    for (const c of me.crew) {
      if (c.hp <= 0) continue
      let target: number | undefined
      if (this.healingIds.has(c.id) && medbayRoom !== null) target = medbayRoom
      else if (fireAssignments.has(c.id)) target = fireAssignments.get(c.id)
      else target = this.homeRooms.get(c.id)
      if (target === undefined) continue

      // Only re-issue when the crew member is neither there nor already heading there.
      const dest = c.path.length > 0 ? c.path[c.path.length - 1] : c.roomId
      if (dest !== target) this.sim.moveCrew(this.side, c.id, target)
    }
  }

  /**
   * Assigns one crew member per fire in a key system room. Prefers whoever is
   * already inside the burning room (so they stay and fight it), then whoever is
   * already heading there (stable assignment), then dispatches the nearest healthy
   * crew. Returning the inside/en-route crew is what stops the director from
   * recalling a firefighter the instant they arrive.
   */
  private assignFirefighters(me: ShipState, medbayRoom: number | null): Map<string, number> {
    const out = new Map<string, number>()
    const fires = me.rooms.filter((r) => {
      if (r.fire <= 0) return false
      const sys = me.systems.find((s) => s.roomId === r.id)
      return sys !== undefined && FIRE_PRIORITY_SYSTEMS.has(sys.id)
    })
    if (fires.length === 0) return out
    const cockpitRoom = me.systems.find((s) => s.id === 'cockpit')?.roomId
    const taken = new Set<string>()
    const headingTo = (c: ShipState['crew'][number]): number | undefined =>
      c.path.length > 0 ? c.path[c.path.length - 1] : undefined
    for (const fire of fires) {
      const claim = (c: ShipState['crew'][number]): void => {
        out.set(c.id, fire.id)
        taken.add(c.id)
      }
      const inside = me.crew.find((c) => c.hp > 0 && !taken.has(c.id) && c.roomId === fire.id)
      if (inside) {
        claim(inside)
        continue
      }
      const enRoute = me.crew.find((c) => c.hp > 0 && !taken.has(c.id) && headingTo(c) === fire.id)
      if (enRoute) {
        claim(enRoute)
        continue
      }
      let best: ShipState['crew'][number] | undefined
      for (const c of me.crew) {
        if (c.hp <= 0 || taken.has(c.id)) continue
        if (this.healingIds.has(c.id)) continue // leave the wounded healing
        if (c.hp < c.hpMax * 0.4) continue
        if (medbayRoom !== null && c.roomId === medbayRoom && c.hp < c.hpMax) continue
        if (c.roomId === cockpitRoom) continue // keep the pilot for evasion
        if (!best) best = c
      }
      if (best) claim(best)
    }
    return out
  }
}
