// NPC battle AI. Also used as autopilot for disconnected expedition players.
// Called every ~0.5 s (10 ticks) by the battle host; recomputes power, targets,
// drones and crew triage from the live ship states. It never flees.

import { MAX_DRONES_ACTIVE, WEAPONS, type ShipState, type Side, type SystemId, type SystemState } from '@stellar/shared'
import type { IBattleSim } from '../sim/api'

const MEDBAY_GO_BELOW = 0.3
const MEDBAY_LEAVE_AT = 0.95

export class NpcController {
  private readonly foeSide: Side
  /** First-seen station per crew id, to send them back after a medbay visit. */
  private readonly homeRooms = new Map<string, number>()

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

  /** Sends badly hurt crew to the medbay and back to their station once healed. */
  private manageCrew(me: ShipState): void {
    for (const c of me.crew) {
      if (!this.homeRooms.has(c.id)) this.homeRooms.set(c.id, c.stationRoomId)
    }
    const medbay = me.systems.find((s) => s.id === 'medbay')
    if (!medbay || this.usable(medbay) === 0) return
    for (const c of me.crew) {
      if (c.hp <= 0) continue
      if (c.hp < c.hpMax * MEDBAY_GO_BELOW && c.roomId !== medbay.roomId) {
        this.sim.moveCrew(this.side, c.id, medbay.roomId)
      } else if (c.roomId === medbay.roomId && c.hp >= c.hpMax * MEDBAY_LEAVE_AT) {
        const home = this.homeRooms.get(c.id)
        if (home !== undefined && home !== medbay.roomId) this.sim.moveCrew(this.side, c.id, home)
      }
    }
  }
}
