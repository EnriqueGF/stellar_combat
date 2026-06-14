// Orbiting drone craft (GAME_SPEC §3.4 visuals). Each powered drone is drawn as
// a small procedural craft that orbits a ship and reacts to its actions:
//   - offensive (combat): orbits the ENEMY hull and fires from its own position;
//   - defensive: patrols the OWNER hull and flares when it shoots a shot down;
//   - internal (repair): skims the OWNER hull and beams the system it repairs.
// One DroneSwarm instance per ship; it reads that ship's drone slots from each
// snapshot. Craft are repositioned/rotated every frame (no per-frame allocation
// in steady state); deploy/retire, glow and action pulses are interpolated.

import Phaser from 'phaser'
import { DRONES, type DroneDef, type ShipState } from '@stellar/shared'
import { COLORS } from '../theme'
import type { ShipView } from './shipView'
import type { Vec2 } from './common'

const TWO_PI = Math.PI * 2
const DEPTH = 10 // above ships/shields (0), below UI panels (12+) and combat FX (600)
const R = 8.5 // craft radius in px

type Kind = DroneDef['kind']

interface KindCfg {
  color: number
  /** Full orbit period in ms. */
  period: number
  /** Orbit direction. */
  dir: 1 | -1
  marginX: number
  marginY: number
  /** Which ship the craft orbits. */
  around: 'foe' | 'owner'
}

const CFG: Record<Kind, KindCfg> = {
  offensive: { color: COLORS.catEnergy, period: 5200, dir: 1, marginX: 22, marginY: 18, around: 'foe' },
  defensive: { color: COLORS.shield, period: 4200, dir: -1, marginX: 34, marginY: 28, around: 'owner' },
  internal: { color: COLORS.ok, period: 6400, dir: 1, marginX: 12, marginY: 10, around: 'owner' },
}

interface DroneVisual {
  slot: number
  kind: Kind
  craft: Phaser.GameObjects.Container
  glow: Phaser.GameObjects.Graphics
  phase: number
  /** Deploy progress 0→1 (scales/fades the craft in from the bay). */
  deploy: number
  /** Action pulse 0→1, decays; brightens glow and punches scale. */
  flash: number
  retiring: boolean
  pos: Vec2
  face: number
}

export class DroneSwarm {
  private readonly scene: Phaser.Scene
  private readonly owner: ShipView
  private readonly foe: ShipView
  private readonly layer: Phaser.GameObjects.Container
  private readonly visuals = new Map<number, DroneVisual>()
  /** Last seen cooldown per slot, to detect a repair drone's action (cooldown reset). */
  private readonly cooldowns = new Map<number, number>()
  /** Transient effect graphics with live tweens, killed on destroy. */
  private readonly temp = new Set<Phaser.GameObjects.GameObject>()
  private state: ShipState
  private orbitT = 0
  private destroyed = false

  constructor(scene: Phaser.Scene, owner: ShipView, foe: ShipView, initial: ShipState) {
    this.scene = scene
    this.owner = owner
    this.foe = foe
    this.state = initial
    this.layer = scene.add.container(0, 0).setDepth(DEPTH)
    initial.drones.forEach((d, i) => this.cooldowns.set(i, d.cooldown))
    this.apply(initial)
  }

  // -------------------------------------------------------------------------
  // Snapshot application (10 Hz)
  // -------------------------------------------------------------------------

  apply(state: ShipState): void {
    if (this.destroyed) return
    this.state = state
    const alive = state.hull > 0

    state.drones.forEach((d, i) => {
      const kind = DRONES[d.droneId].kind
      const active = alive && d.enabled && d.powered
      const vis = this.visuals.get(i)
      if (active) {
        if (vis === undefined) this.spawn(i, kind)
        else vis.retiring = false
      } else if (vis !== undefined) {
        vis.retiring = true
      }

      // Repair drones emit no event; detect the action from the cooldown resetting
      // upward (it counts down to 0 then jumps back to the drone period).
      if (kind === 'internal') {
        const prev = this.cooldowns.get(i)
        if (prev !== undefined && active && d.cooldown > prev + 0.05) this.repairAction(i)
      }
      this.cooldowns.set(i, d.cooldown)
    })
  }

  // -------------------------------------------------------------------------
  // Per-frame
  // -------------------------------------------------------------------------

  update(time: number, dtMs: number, paused: boolean): void {
    if (this.destroyed) return
    if (!paused) this.orbitT += dtMs

    for (const vis of this.visuals.values()) {
      const cfg = CFG[vis.kind]
      const gv = cfg.around === 'foe' ? this.foe : this.owner
      const c = gv.center()
      const b = gv.hullBounds()
      const rx = b.w / 2 + cfg.marginX
      const ry = b.h / 2 + cfg.marginY
      const ang = vis.phase + (this.orbitT / cfg.period) * TWO_PI * cfg.dir
      const x = c.x + Math.cos(ang) * rx
      const y = c.y + Math.sin(ang) * ry
      vis.pos.x = x
      vis.pos.y = y

      // Facing: offensive aims at the hull it orbits (barrel inward), defensive
      // faces the enemy (where threats come from), internal follows its path.
      let face: number
      if (vis.kind === 'offensive') {
        face = Math.atan2(c.y - y, c.x - x)
      } else if (vis.kind === 'defensive') {
        const f = this.foe.center()
        face = Math.atan2(f.y - y, f.x - x)
      } else {
        face = Math.atan2(ry * Math.cos(ang) * cfg.dir, -rx * Math.sin(ang) * cfg.dir)
      }
      vis.face = face

      if (vis.retiring) {
        vis.deploy = Math.max(0, vis.deploy - dtMs / 220)
        if (vis.deploy <= 0.01) {
          vis.craft.destroy()
          this.visuals.delete(vis.slot)
          continue
        }
      } else {
        vis.deploy = Math.min(1, vis.deploy + dtMs / 240)
      }
      vis.flash = Math.max(0, vis.flash - dtMs / 240)

      vis.craft.setPosition(x, y).setRotation(face).setScale(vis.deploy * (1 + 0.3 * vis.flash))
      vis.glow.setAlpha((0.32 + 0.16 * Math.sin(time / 300 + vis.phase)) * vis.deploy + 0.55 * vis.flash)
    }
  }

  // -------------------------------------------------------------------------
  // Action hooks (called by the battle event router)
  // -------------------------------------------------------------------------

  /** A combat drone fired: pulse it, spawn a muzzle flash and return the shot
   *  origin (the drone's barrel) so the projectile flies from the craft. */
  combatFire(): Vec2 | null {
    const vis = this.firstActive('offensive')
    if (vis === null) return null
    vis.flash = 1
    const nx = vis.pos.x + Math.cos(vis.face) * R * 1.7
    const ny = vis.pos.y + Math.sin(vis.face) * R * 1.7
    this.flashAt(nx, ny, CFG.offensive.color, 6)
    return { x: nx, y: ny }
  }

  /** A defense drone intercepted a projectile: pulse it and return its position
   *  so the intercept burst plays right at the craft. */
  defenseIntercept(): Vec2 | null {
    const vis = this.firstActive('defensive')
    if (vis === null) return null
    vis.flash = 1
    return { x: vis.pos.x, y: vis.pos.y }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private firstActive(kind: Kind): DroneVisual | null {
    for (const vis of this.visuals.values()) {
      if (vis.kind === kind && !vis.retiring) return vis
    }
    return null
  }

  private spawn(slot: number, kind: Kind): void {
    const color = CFG[kind].color
    const glow = this.scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD)
    drawGlow(glow, color)
    const body = this.scene.add.graphics()
    drawCraft(body, kind, color)
    const craft = this.scene.add.container(0, 0, [glow, body]).setScale(0.1)
    this.layer.add(craft)
    this.visuals.set(slot, {
      slot,
      kind,
      craft,
      glow,
      phase: slot * (TWO_PI / 3),
      deploy: 0,
      flash: 0,
      retiring: false,
      pos: { x: this.owner.center().x, y: this.owner.center().y },
      face: 0,
    })
  }

  private repairAction(slot: number): void {
    const vis = this.visuals.get(slot)
    if (vis === undefined) return
    const roomId = this.mostDamagedRoom()
    if (roomId === null) return
    vis.flash = 1
    this.beam(vis.pos, this.owner.roomCenter(roomId), COLORS.ok)
  }

  /** Mirrors the server's repair target: the most-damaged un-breached system. */
  private mostDamagedRoom(): number | null {
    let bestRoom: number | null = null
    let bestDmg = 0
    for (const sys of this.state.systems) {
      if (sys.damage <= 0) continue
      const room = this.state.rooms.find((r) => r.id === sys.roomId)
      if (room !== undefined && room.breach > 0) continue
      if (sys.damage > bestDmg) {
        bestDmg = sys.damage
        bestRoom = sys.roomId
      }
    }
    return bestRoom
  }

  private flashAt(x: number, y: number, color: number, r: number): void {
    if (this.destroyed) return
    const g = this.scene.add.graphics({ x, y }).setBlendMode(Phaser.BlendModes.ADD)
    g.fillStyle(0xffffff, 0.9)
    g.fillCircle(0, 0, r * 0.5)
    g.fillStyle(color, 0.7)
    g.fillCircle(0, 0, r)
    this.layer.add(g)
    this.temp.add(g)
    this.scene.tweens.add({
      targets: g,
      scale: 1.9,
      alpha: 0,
      duration: 180,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.temp.delete(g)
        g.destroy()
      },
    })
  }

  private beam(from: Vec2, to: Vec2, color: number): void {
    if (this.destroyed) return
    const g = this.scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD)
    g.lineStyle(3, color, 0.4)
    g.lineBetween(from.x, from.y, to.x, to.y)
    g.lineStyle(1.2, 0xffffff, 0.85)
    g.lineBetween(from.x, from.y, to.x, to.y)
    this.layer.add(g)
    this.temp.add(g)
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      duration: 280,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.temp.delete(g)
        g.destroy()
      },
    })
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    for (const obj of this.temp) this.scene.tweens.killTweensOf(obj)
    this.temp.clear()
    this.layer.destroy(true)
    this.visuals.clear()
  }
}

// ---------------------------------------------------------------------------
// Procedural craft art (drawn once; nose points toward +x so the container's
// rotation aligns the barrel/sensor with the facing direction).
// ---------------------------------------------------------------------------

function drawGlow(g: Phaser.GameObjects.Graphics, color: number): void {
  g.fillStyle(color, 0.5)
  g.fillCircle(0, 0, R * 1.8)
  g.fillStyle(0xffffff, 0.45)
  g.fillCircle(0, 0, R * 0.55)
  // Rear thruster bloom.
  g.fillStyle(color, 0.6)
  g.fillCircle(-R * 1.15, 0, R * 0.5)
}

function drawCraft(g: Phaser.GameObjects.Graphics, kind: Kind, color: number): void {
  g.fillStyle(COLORS.spaceLight, 0.96)
  g.lineStyle(1.6, color, 1)
  if (kind === 'offensive') {
    // Sleek dart with a forward barrel.
    g.beginPath()
    g.moveTo(R * 1.25, 0)
    g.lineTo(-R * 0.75, -R * 0.8)
    g.lineTo(-R * 0.35, 0)
    g.lineTo(-R * 0.75, R * 0.8)
    g.closePath()
    g.fillPath()
    g.strokePath()
    g.fillStyle(color, 1)
    g.fillRect(R * 0.85, -1.3, R * 0.95, 2.6)
  } else if (kind === 'defensive') {
    // Hexagonal interceptor with a forward deflector vane.
    g.beginPath()
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k
      const px = Math.cos(a) * R
      const py = Math.sin(a) * R
      if (k === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.closePath()
    g.fillPath()
    g.strokePath()
    g.fillStyle(color, 1)
    g.fillTriangle(R * 0.7, -R * 0.5, R * 0.7, R * 0.5, R * 1.5, 0)
  } else {
    // Boxy repair bot with a forward sensor eye.
    g.fillRoundedRect(-R * 0.85, -R * 0.7, R * 1.7, R * 1.4, 3)
    g.strokeRoundedRect(-R * 0.85, -R * 0.7, R * 1.7, R * 1.4, 3)
    g.fillStyle(color, 1)
    g.fillCircle(R * 0.55, 0, 2)
  }
  // Bright core.
  g.fillStyle(0xffffff, 1)
  g.fillCircle(-R * 0.05, 0, 1.6)
}
