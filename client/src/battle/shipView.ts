// Cutaway ship renderer (GAME_SPEC §6.3), reusable for both sides. Draws a
// procedural hull silhouette around the room grid, rooms with system icons and
// damage pips, environmental overlays (O2 / fire / breach) and interpolated
// crew tokens. All dynamic layers redraw only when the underlying values
// change; update() only interpolates and emits particles.

import Phaser from 'phaser'
import {
  SHIPS,
  clamp,
  mulberry32,
  type CrewState,
  type DoorState,
  type RoomDef,
  type ShipClassId,
  type ShipState,
  type SystemState,
} from '@stellar/shared'
import { COLORS } from '../theme'
import {
  CLASS_COLORS,
  CLASS_INITIALS,
  chaikin,
  hashString,
  makeText,
  type Rect,
  type Vec2,
} from './common'
import {
  drawCrossOut,
  drawDropletCrossed,
  drawSystemIcon,
  drawTaskIcon,
} from './icons'
import { Tooltip } from '../ui/tooltip'

const PARTICLE_KEY = 'bv_dot'
const TOKEN_RADIUS = 8

interface HullStyle {
  /** Nose length in cells (extends towards the rival). */
  nose: number
  /** Fin height in cells. */
  fin: number
  /** Fin position along the body (0..1 from the tail). */
  finPos: number
  /** 0 = needle nose, 1 = flat nose. */
  blunt: number
  /** Chaikin smoothing iterations. */
  smooth: number
  nozzles: number
}

const HULL_STYLES: Record<ShipClassId, HullStyle> = {
  sentinel: { nose: 1.8, fin: 0.55, finPos: 0.34, blunt: 0.3, smooth: 2, nozzles: 2 },
  vanguard: { nose: 2.3, fin: 0.85, finPos: 0.2, blunt: 0.06, smooth: 2, nozzles: 3 },
  bastion: { nose: 1.15, fin: 0.34, finPos: 0.44, blunt: 0.75, smooth: 2, nozzles: 3 },
  hegemon: { nose: 1.6, fin: 0.7, finPos: 0.3, blunt: 0.5, smooth: 1, nozzles: 3 },
}

interface CrewToken {
  container: Phaser.GameObjects.Container
  base: Phaser.GameObjects.Graphics
  initial: Phaser.GameObjects.Text
  hpBar: Phaser.GameObjects.Graphics
  taskGfx: Phaser.GameObjects.Graphics
  ring: Phaser.GameObjects.Graphics
  pos: Vec2
  hasPos: boolean
  lastHpKey: string
  lastTask: string
  lastDead: boolean
  cls: string
  working: boolean
}

interface RoomEnvCache {
  o2: number
  fire: number
  breach: number
}

export interface ShipViewOpts {
  /** 1 = nose to the right (player), -1 = nose to the left (enemy). */
  facing: 1 | -1
  /** Cell size cap in px (~52 player, ~44 enemy). */
  maxCell: number
  /** When set, this ship's doors become clickable; toggling one calls this. */
  onToggleDoor?: (doorId: number) => void
}

export class ShipView {
  readonly scene: Phaser.Scene
  readonly facing: 1 | -1
  readonly rooms: RoomDef[]
  readonly roomZones = new Map<number, Phaser.GameObjects.Zone>()

  onRoomClick: ((roomId: number, rightButton: boolean) => void) | null = null
  onRoomHover: ((roomId: number | null) => void) | null = null
  onCrewClick: ((crewId: string) => void) | null = null

  private state: ShipState
  private readonly container: Phaser.GameObjects.Container
  private readonly cell: number
  private readonly originX: number
  private readonly originY: number
  private readonly bodyW: number
  private readonly bodyH: number
  private readonly noseLen: number
  private readonly tailLen: number
  private readonly minCx: number
  private readonly minCy: number
  private readonly cellsW: number

  private readonly roomBase: Phaser.GameObjects.Graphics
  private readonly envGfx: Phaser.GameObjects.Graphics
  private readonly iconGfx: Phaser.GameObjects.Graphics
  private readonly doorGfx: Phaser.GameObjects.Graphics
  private readonly doorZones: Phaser.GameObjects.Zone[] = []
  private readonly onToggleDoor?: (doorId: number) => void
  /** Cached pixel placement per door id (rooms never move). */
  private readonly doorGeo = new Map<number, { x: number; y: number; vertical: boolean; half: number }>()
  /** Animated openness per door id: 0 = shut, 1 = fully slid open. */
  private readonly doorFrac = new Map<number, number>()
  private doorsAnimating = false
  private readonly hoverGfx: Phaser.GameObjects.Graphics
  private readonly glowGfx: Phaser.GameObjects.Graphics
  private readonly fireEmitter: Phaser.GameObjects.Particles.ParticleEmitter
  private readonly breachEmitter: Phaser.GameObjects.Particles.ParticleEmitter

  private readonly tokens = new Map<string, CrewToken>()
  private readonly envCache = new Map<number, RoomEnvCache>()
  private systemsKey = ''
  private envDirty = true
  private iconDirty = true
  private fireTimer = 0
  private breachTimer = 0
  private selectedCrewId: string | null = null
  private destroyed = false

  constructor(scene: Phaser.Scene, rect: Rect, initial: ShipState, opts: ShipViewOpts) {
    this.scene = scene
    this.facing = opts.facing
    this.onToggleDoor = opts.onToggleDoor
    this.state = initial

    const def = SHIPS[initial.shipClass]
    this.rooms = def.layout.rooms

    let minCx = Infinity
    let minCy = Infinity
    let maxCx = -Infinity
    let maxCy = -Infinity
    for (const r of this.rooms) {
      minCx = Math.min(minCx, r.x)
      minCy = Math.min(minCy, r.y)
      maxCx = Math.max(maxCx, r.x + r.w)
      maxCy = Math.max(maxCy, r.y + r.h)
    }
    this.minCx = minCx
    this.minCy = minCy
    this.cellsW = maxCx - minCx
    const cellsH = maxCy - minCy

    const style = HULL_STYLES[initial.shipClass]
    const cell = clamp(
      Math.min(opts.maxCell, rect.w / (this.cellsW + style.nose + 1.3), rect.h / (cellsH + 1.4)),
      22,
      opts.maxCell,
    )
    this.cell = cell
    this.bodyW = this.cellsW * cell
    this.bodyH = cellsH * cell
    this.noseLen = style.nose * cell
    this.tailLen = 0.55 * cell

    const totalW = this.bodyW + this.noseLen + this.tailLen
    const leftPad = this.facing === 1 ? this.tailLen : this.noseLen
    this.originX = rect.x + (rect.w - totalW) / 2 + leftPad
    this.originY = rect.y + (rect.h - this.bodyH) / 2

    ensureParticleTexture(scene)
    this.container = scene.add.container(0, 0)

    // --- hull ---
    this.glowGfx = scene.add.graphics()
    const hull = scene.add.graphics()
    this.drawHull(hull, style, initial.shipClass)
    this.container.add(this.glowGfx)
    this.container.add(hull)
    scene.tweens.add({
      targets: this.glowGfx,
      alpha: { from: 0.5, to: 1 },
      duration: 420,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })

    // --- room layers ---
    this.roomBase = scene.add.graphics()
    this.envGfx = scene.add.graphics()
    this.iconGfx = scene.add.graphics()
    this.doorGfx = scene.add.graphics()
    this.hoverGfx = scene.add.graphics()
    this.container.add(this.roomBase)
    this.container.add(this.envGfx)
    this.container.add(this.iconGfx)
    this.container.add(this.doorGfx)
    this.container.add(this.hoverGfx)
    this.drawRoomBases()

    // --- particles ---
    this.fireEmitter = scene.add.particles(0, 0, PARTICLE_KEY, {
      lifespan: { min: 320, max: 620 },
      speedY: { min: -34, max: -10 },
      speedX: { min: -10, max: 10 },
      scale: { start: 1.4, end: 0.2 },
      alpha: { start: 0.95, end: 0 },
      tint: [COLORS.fire, 0xffb454, 0xffe27a],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    })
    this.breachEmitter = scene.add.particles(0, 0, PARTICLE_KEY, {
      lifespan: { min: 260, max: 480 },
      speed: { min: 24, max: 70 },
      scale: { start: 0.8, end: 0.1 },
      alpha: { start: 0.7, end: 0 },
      tint: 0xbfe6ff,
      emitting: false,
    })
    this.container.add(this.fireEmitter)
    this.container.add(this.breachEmitter)

    // --- room hit zones ---
    for (const r of this.rooms) {
      const rr = this.roomRect(r.id)
      if (rr === null) continue
      const zone = scene.add
        .zone(rr.x + rr.w / 2, rr.y + rr.h / 2, rr.w, rr.h)
        .setInteractive()
      zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        this.onRoomClick?.(r.id, pointer.rightButtonDown())
      })
      zone.on('pointerover', () => this.onRoomHover?.(r.id))
      zone.on('pointerout', () => this.onRoomHover?.(null))
      this.roomZones.set(r.id, zone)
    }

    // --- doors: cache geometry, seed openness, and (on your ship) add hit zones ---
    for (const door of initial.doors) {
      const geo = this.doorGeometry(door)
      if (geo === null) continue
      this.doorGeo.set(door.id, geo)
      this.doorFrac.set(door.id, door.open ? 1 : 0)
      if (this.onToggleDoor) {
        const id = door.id
        // Depth above room zones so a click on the wall toggles the door rather
        // than moving crew into the adjacent room.
        const zone = scene.add
          .zone(geo.x, geo.y, this.cell * 0.6, this.cell * 0.6)
          .setInteractive()
          .setDepth(40)
        zone.on('pointerdown', () => this.onToggleDoor?.(id))
        Tooltip.attach(
          zone,
          () =>
            'Compuerta — click para abrir/cerrar.\nCierra todas las puertas de una sala para aislarla: ' +
            'sin O2, un incendio se asfixia.',
        )
        this.doorZones.push(zone)
      }
    }
    this.redrawDoors()

    this.apply(initial)
  }

  // -------------------------------------------------------------------------
  // Geometry
  // -------------------------------------------------------------------------

  /** Maps a local nose-right x coordinate to the facing-adjusted one. */
  private fx(x: number): number {
    return this.facing === 1 ? x : this.bodyW - x
  }

  roomRect(roomId: number): Rect | null {
    const r = this.rooms.find((room) => room.id === roomId)
    if (r === undefined) return null
    const lx = (r.x - this.minCx) * this.cell
    const w = r.w * this.cell
    const x = this.facing === 1 ? lx : this.bodyW - lx - w
    return {
      x: this.originX + x,
      y: this.originY + (r.y - this.minCy) * this.cell,
      w,
      h: r.h * this.cell,
    }
  }

  roomCenter(roomId: number): Vec2 {
    const rr = this.roomRect(roomId)
    if (rr === null) return this.center()
    return { x: rr.x + rr.w / 2, y: rr.y + rr.h / 2 }
  }

  /** Pixel placement of a door: midpoint of the shared wall + its orientation. */
  private doorGeometry(
    door: DoorState,
  ): { x: number; y: number; vertical: boolean; half: number } | null {
    const a = this.roomRect(door.a)
    const b = this.roomRect(door.b)
    if (a === null || b === null) return null
    const T = 1.5
    const ax2 = a.x + a.w
    const ay2 = a.y + a.h
    const bx2 = b.x + b.w
    const by2 = b.y + b.h
    const wallX = Math.abs(ax2 - b.x) < T ? ax2 : Math.abs(bx2 - a.x) < T ? b.x : null
    if (wallX !== null) {
      const y0 = Math.max(a.y, b.y)
      const y1 = Math.min(ay2, by2)
      return { x: wallX, y: (y0 + y1) / 2, vertical: true, half: Math.min(this.cell * 0.26, (y1 - y0) * 0.42) }
    }
    const wallY = Math.abs(ay2 - b.y) < T ? ay2 : Math.abs(by2 - a.y) < T ? b.y : null
    if (wallY !== null) {
      const x0 = Math.max(a.x, b.x)
      const x1 = Math.min(ax2, bx2)
      return { x: (x0 + x1) / 2, y: wallY, vertical: false, half: Math.min(this.cell * 0.26, (x1 - x0) * 0.42) }
    }
    // Non-adjacent door (rare): drop it midway between the two room centers.
    const ca = this.roomCenter(door.a)
    const cb = this.roomCenter(door.b)
    return {
      x: (ca.x + cb.x) / 2,
      y: (ca.y + cb.y) / 2,
      vertical: Math.abs(ca.x - cb.x) < Math.abs(ca.y - cb.y),
      half: this.cell * 0.22,
    }
  }

  /**
   * Draws every door as a framed doorway with two sliding leaves (FTL-style):
   * the leaves meet in the middle when shut and retract into the jambs as the
   * door opens. `doorFrac` (0 shut → 1 open) drives the slide.
   */
  private redrawDoors(): void {
    const g = this.doorGfx
    g.clear()
    for (const [id, geo] of this.doorGeo) {
      const { x, y, vertical, half } = geo
      const frac = this.doorFrac.get(id) ?? 1
      const leaf = (1 - frac) * (half - 1) // length of each leaf from its jamb
      const jamb = 3
      // Door frame: a short tick at each jamb, perpendicular to the wall.
      g.lineStyle(2, COLORS.textDim, 0.85)
      if (vertical) {
        g.lineBetween(x - jamb, y - half, x + jamb, y - half)
        g.lineBetween(x - jamb, y + half, x + jamb, y + half)
      } else {
        g.lineBetween(x - half, y - jamb, x - half, y + jamb)
        g.lineBetween(x + half, y - jamb, x + half, y + jamb)
      }
      // Door leaves sliding out of each jamb towards the centre.
      if (leaf > 0.5) {
        g.lineStyle(4, COLORS.shield, 0.95)
        if (vertical) {
          g.lineBetween(x, y - half, x, y - half + leaf)
          g.lineBetween(x, y + half, x, y + half - leaf)
        } else {
          g.lineBetween(x - half, y, x - half + leaf, y)
          g.lineBetween(x + half, y, x + half - leaf, y)
        }
      }
    }
  }

  center(): Vec2 {
    return { x: this.originX + this.bodyW / 2, y: this.originY + this.bodyH / 2 }
  }

  noseTip(): Vec2 {
    return {
      x: this.originX + this.fx(this.bodyW + this.noseLen * 0.85),
      y: this.originY + this.bodyH / 2,
    }
  }

  bubbleParams(): { cx: number; cy: number; rx: number; ry: number } {
    return {
      cx: this.originX + this.bodyW / 2 + this.facing * this.noseLen * 0.2,
      cy: this.originY + this.bodyH / 2,
      rx: (this.bodyW + this.noseLen + this.tailLen) / 2 + 20,
      ry: this.bodyH / 2 + this.cell * 0.85,
    }
  }

  hullBounds(): Rect {
    const left = this.originX - (this.facing === 1 ? this.tailLen : this.noseLen)
    return {
      x: left,
      y: this.originY - this.cell * 0.6,
      w: this.bodyW + this.noseLen + this.tailLen,
      h: this.bodyH + this.cell * 1.2,
    }
  }

  randomHullPoint(rng: () => number = Math.random): Vec2 {
    const b = this.hullBounds()
    return { x: b.x + b.w * (0.15 + rng() * 0.7), y: b.y + b.h * (0.2 + rng() * 0.6) }
  }

  systemRoomId(systemId: string): number | null {
    const sys = this.state.systems.find((s) => s.id === systemId)
    return sys?.roomId ?? null
  }

  getState(): ShipState {
    return this.state
  }

  // -------------------------------------------------------------------------
  // Static drawing
  // -------------------------------------------------------------------------

  private drawHull(g: Phaser.GameObjects.Graphics, style: HullStyle, classId: ShipClassId): void {
    const rng = mulberry32(hashString(SHIPS[classId].name))
    const cell = this.cell
    const bodyW = this.bodyW
    const bodyH = this.bodyH
    const midY = bodyH / 2
    const m = cell * (0.26 + rng() * 0.14)
    const nose = this.noseLen * (0.94 + rng() * 0.12)
    const tail = this.tailLen
    const finH = cell * style.fin * (0.85 + rng() * 0.3)
    const fp = style.finPos + rng() * 0.05
    const noseHalf = bodyH * 0.5 * style.blunt * 0.55

    const top: Vec2[] = [
      { x: -tail, y: midY - bodyH * 0.3 },
      { x: -tail * 0.3, y: -m * 0.85 },
      { x: bodyW * fp, y: -m - finH * 0.25 },
      { x: bodyW * (fp + 0.1), y: -m - finH },
      { x: bodyW * (fp + 0.3), y: -m * 0.9 },
      { x: bodyW * 0.92, y: -m * 0.7 },
      { x: bodyW + nose * 0.45, y: midY - bodyH * 0.22 },
      { x: bodyW + nose, y: midY - noseHalf },
    ]
    const pts: Vec2[] = [...top]
    if (style.blunt > 0.2) pts.push({ x: bodyW + nose, y: midY + noseHalf })
    for (let i = top.length - (style.blunt > 0.2 ? 1 : 2); i >= 0; i--) {
      const p = top[i]
      if (p === undefined) continue
      pts.push({ x: p.x, y: 2 * midY - p.y })
    }

    const smooth = chaikin(pts, style.smooth).map((p) => ({
      x: this.originX + this.fx(p.x),
      y: this.originY + p.y,
    }))

    g.fillStyle(COLORS.spaceLight, 1)
    g.beginPath()
    smooth.forEach((p, i) => {
      if (i === 0) g.moveTo(p.x, p.y)
      else g.lineTo(p.x, p.y)
    })
    g.closePath()
    g.fillPath()
    g.lineStyle(2, 0x3a4f6b, 1)
    g.strokePath()
    g.lineStyle(1, COLORS.panelBorder, 0.25)
    g.strokePath()

    // Engine nozzles + additive glow on the tail side.
    const n = style.nozzles
    const nozzleH = Math.min(cell * 0.42, (bodyH * 0.6) / n)
    for (let i = 0; i < n; i++) {
      const cy = this.originY + midY + (i - (n - 1) / 2) * (nozzleH * 1.5)
      const x0 = this.originX + this.fx(-tail * 0.4)
      const x1 = this.originX + this.fx(-tail - cell * 0.32)
      g.fillStyle(0x223047, 1)
      g.beginPath()
      g.moveTo(x0, cy - nozzleH * 0.45)
      g.lineTo(x1, cy - nozzleH * 0.62)
      g.lineTo(x1, cy + nozzleH * 0.62)
      g.lineTo(x0, cy + nozzleH * 0.45)
      g.closePath()
      g.fillPath()
      g.lineStyle(1, 0x3a4f6b, 1)
      g.strokePath()

      this.glowGfx.fillStyle(0x7ad9ff, 0.55)
      this.glowGfx.fillEllipse(
        this.originX + this.fx(-tail - cell * 0.5),
        cy,
        cell * 0.5,
        nozzleH * 0.8,
      )
      this.glowGfx.fillStyle(0xffffff, 0.5)
      this.glowGfx.fillEllipse(
        this.originX + this.fx(-tail - cell * 0.42),
        cy,
        cell * 0.24,
        nozzleH * 0.4,
      )
    }
    this.glowGfx.setBlendMode(Phaser.BlendModes.ADD)
  }

  private drawRoomBases(): void {
    const g = this.roomBase
    for (const r of this.rooms) {
      const rr = this.roomRect(r.id)
      if (rr === null) continue
      g.fillStyle(COLORS.panel, 0.96)
      g.fillRoundedRect(rr.x + 2, rr.y + 2, rr.w - 4, rr.h - 4, 5)
      g.lineStyle(1, 0x35506e, 1)
      g.strokeRoundedRect(rr.x + 2, rr.y + 2, rr.w - 4, rr.h - 4, 5)
    }
  }

  // -------------------------------------------------------------------------
  // Snapshot application (10 Hz)
  // -------------------------------------------------------------------------

  apply(state: ShipState): void {
    if (this.destroyed) return
    this.state = state

    for (const room of state.rooms) {
      const prev = this.envCache.get(room.id)
      if (
        prev === undefined ||
        Math.abs(prev.o2 - room.o2) > 2 ||
        Math.abs(prev.fire - room.fire) > 3 ||
        Math.abs(prev.breach - room.breach) > 4 ||
        (prev.o2 < 15) !== (room.o2 < 15) ||
        (prev.fire > 0) !== (room.fire > 0) ||
        (prev.breach > 0) !== (room.breach > 0)
      ) {
        this.envCache.set(room.id, { o2: room.o2, fire: room.fire, breach: room.breach })
        this.envDirty = true
      }
    }

    const sysKey = state.systems
      .map((s) => `${s.id}:${damagedPips(s)}:${s.power > 0 ? 1 : 0}`)
      .join('|')
    if (sysKey !== this.systemsKey) {
      this.systemsKey = sysKey
      this.iconDirty = true
    }

    // Animate any door whose target (open?1:0) no longer matches its slide.
    for (const door of state.doors) {
      if (this.doorFrac.get(door.id) !== (door.open ? 1 : 0)) this.doorsAnimating = true
    }

    this.syncCrew(state.crew)
  }

  // -------------------------------------------------------------------------
  // Per-frame
  // -------------------------------------------------------------------------

  update(time: number, dtMs: number): void {
    if (this.destroyed) return
    if (this.envDirty) {
      this.envDirty = false
      this.redrawEnv()
    }
    if (this.iconDirty) {
      this.iconDirty = false
      this.redrawIcons()
    }
    if (this.doorsAnimating) this.animateDoors(dtMs)
    this.updateCrewPositions(time, dtMs)
    this.emitEnvParticles(dtMs)
  }

  /** Slides each door towards its target openness (~0.16 s full travel). */
  private animateDoors(dtMs: number): void {
    const step = dtMs / 1000 / 0.16
    let moving = false
    for (const door of this.state.doors) {
      const target = door.open ? 1 : 0
      const cur = this.doorFrac.get(door.id) ?? target
      if (cur === target) continue
      const next = cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step)
      this.doorFrac.set(door.id, next)
      if (next !== target) moving = true
    }
    this.redrawDoors()
    this.doorsAnimating = moving
  }

  private emitEnvParticles(dtMs: number): void {
    this.fireTimer += dtMs
    this.breachTimer += dtMs
    const doFire = this.fireTimer >= 95
    const doBreach = this.breachTimer >= 150
    if (doFire) this.fireTimer = 0
    if (doBreach) this.breachTimer = 0
    if (!doFire && !doBreach) return

    for (const room of this.state.rooms) {
      const rr = this.roomRect(room.id)
      if (rr === null) continue
      if (doFire && room.fire > 0) {
        const count = Math.ceil(room.fire / 34)
        for (let i = 0; i < count; i++) {
          this.fireEmitter.emitParticleAt(
            rr.x + 6 + Math.random() * (rr.w - 12),
            rr.y + rr.h * 0.35 + Math.random() * (rr.h * 0.5),
            1,
          )
        }
      }
      if (doBreach && room.breach > 0) {
        const p = this.breachPoint(room.id, rr)
        this.breachEmitter.emitParticleAt(p.x, p.y, 1 + Math.floor(room.breach / 50))
      }
    }
  }

  // -------------------------------------------------------------------------
  // Dynamic layers
  // -------------------------------------------------------------------------

  private breachPoint(roomId: number, rr: Rect): Vec2 {
    const rng = mulberry32(roomId * 7919 + 13)
    return {
      x: rr.x + rr.w * (0.3 + rng() * 0.4),
      y: rr.y + rr.h * (0.3 + rng() * 0.4),
    }
  }

  private redrawEnv(): void {
    const g = this.envGfx
    g.clear()
    for (const room of this.state.rooms) {
      const rr = this.roomRect(room.id)
      if (rr === null) continue

      // Low-O2 tint, proportional to the missing oxygen.
      const o2Alpha = ((100 - room.o2) / 100) * 0.42
      if (o2Alpha > 0.02) {
        g.fillStyle(COLORS.o2Low, o2Alpha)
        g.fillRoundedRect(rr.x + 3, rr.y + 3, rr.w - 6, rr.h - 6, 4)
      }
      if (room.o2 < 15) {
        drawDropletCrossed(g, rr.x + rr.w - 9, rr.y + 9, 10, COLORS.o2Low)
      }

      // Fire glow under the particle flames.
      if (room.fire > 0) {
        g.fillStyle(COLORS.fire, 0.12 + (room.fire / 100) * 0.3)
        g.fillRoundedRect(rr.x + 3, rr.y + 3, rr.w - 6, rr.h - 6, 4)
      }

      // Breach: jagged crack, seeded per room, sized by severity.
      if (room.breach > 0) {
        const c = this.breachPoint(room.id, rr)
        const rng = mulberry32(room.id * 104729 + 7)
        const rad = Math.min(rr.w, rr.h) * 0.16 * (0.6 + (room.breach / 100) * 0.5)
        g.fillStyle(0x05080f, 1)
        g.fillCircle(c.x, c.y, rad * 0.7)
        g.lineStyle(1.5, 0x9fb8cc, 0.9)
        const spikes = 6
        for (let i = 0; i < spikes; i++) {
          const a = (Math.PI * 2 * i) / spikes + rng() * 0.7
          const len = rad * (1.1 + rng() * 0.9)
          const mx = c.x + Math.cos(a + 0.3) * len * 0.5
          const my = c.y + Math.sin(a + 0.3) * len * 0.5
          g.lineBetween(c.x, c.y, mx, my)
          g.lineBetween(mx, my, c.x + Math.cos(a) * len, c.y + Math.sin(a) * len)
        }
      }
    }
  }

  private redrawIcons(): void {
    const g = this.iconGfx
    g.clear()
    for (const sys of this.state.systems) {
      const rr = this.roomRect(sys.roomId)
      if (rr === null) continue
      const destroyed = sys.level - sys.damage <= 0.0001
      const damaged = sys.damage > 0.05
      const color = destroyed ? COLORS.danger : damaged ? COLORS.warn : COLORS.textDim
      const cx = rr.x + rr.w / 2
      const cy = rr.y + rr.h / 2
      drawSystemIcon(g, sys.id, cx, cy, 16, color)
      if (destroyed) drawCrossOut(g, cx, cy, 18, COLORS.danger)

      // Damage pips (level/damage) beside the icon.
      const dmg = damagedPips(sys)
      const px = cx + 13
      const totalH = sys.level * 5 - 2
      for (let i = 0; i < sys.level; i++) {
        const py = cy + totalH / 2 - i * 5 - 3
        if (i >= sys.level - dmg) {
          g.fillStyle(COLORS.danger, 1)
          g.fillRect(px, py, 3, 3)
        } else {
          g.lineStyle(1, COLORS.textDim, 0.8)
          g.strokeRect(px, py, 3, 3)
        }
      }
    }
  }

  setRoomHover(roomId: number | null, color: number): void {
    this.hoverGfx.clear()
    if (roomId === null) return
    const rr = this.roomRect(roomId)
    if (rr === null) return
    this.hoverGfx.lineStyle(2, color, 0.95)
    this.hoverGfx.strokeRoundedRect(rr.x + 1, rr.y + 1, rr.w - 2, rr.h - 2, 5)
    this.hoverGfx.fillStyle(color, 0.08)
    this.hoverGfx.fillRoundedRect(rr.x + 1, rr.y + 1, rr.w - 2, rr.h - 2, 5)
  }

  // -------------------------------------------------------------------------
  // Crew tokens
  // -------------------------------------------------------------------------

  setCrewSelected(crewId: string | null): void {
    this.selectedCrewId = crewId
    for (const [id, token] of this.tokens) {
      token.ring.setVisible(id === crewId)
    }
  }

  flashCrew(crewId: string, color: number): void {
    const token = this.tokens.get(crewId)
    if (token === undefined) return
    const flash = this.scene.add.graphics()
    flash.lineStyle(2, color, 1)
    flash.strokeCircle(0, 0, TOKEN_RADIUS + 2)
    flash.setPosition(token.container.x, token.container.y)
    this.container.add(flash)
    this.scene.tweens.add({
      targets: flash,
      scale: 2.2,
      alpha: 0,
      duration: 520,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    })
  }

  private syncCrew(crew: CrewState[]): void {
    const seen = new Set<string>()
    for (const member of crew) {
      seen.add(member.id)
      let token = this.tokens.get(member.id)
      if (token === undefined) {
        token = this.createToken(member)
        this.tokens.set(member.id, token)
      }
      const dead = member.hp <= 0
      if (dead !== token.lastDead) {
        token.lastDead = dead
        token.container.setAlpha(dead ? 0.25 : 1)
        if (dead) {
          token.base.clear()
          token.base.fillStyle(0x55606b, 1)
          token.base.fillCircle(0, 0, TOKEN_RADIUS)
          drawCrossOut(token.base, 0, 0, 10, COLORS.danger)
        }
      }
      const hpKey = `${Math.round(member.hp)}/${member.hpMax}`
      if (hpKey !== token.lastHpKey && !dead) {
        token.lastHpKey = hpKey
        this.redrawHpBar(token, member.hp / Math.max(1, member.hpMax))
      }
      if (member.task !== token.lastTask) {
        token.lastTask = member.task
        token.working =
          member.task === 'repair' ||
          member.task === 'fight_fire' ||
          member.task === 'seal_breach' ||
          member.task === 'heal'
        token.taskGfx.clear()
        drawTaskIcon(token.taskGfx, member.task, 0, 0, 9, 0xffffff)
      }
    }
    for (const [id, token] of this.tokens) {
      if (!seen.has(id)) {
        token.container.destroy()
        this.tokens.delete(id)
      }
    }
  }

  private createToken(member: CrewState): CrewToken {
    const color = CLASS_COLORS[member.cls]
    const base = this.scene.add.graphics()
    base.fillStyle(color, 1)
    base.fillCircle(0, 0, TOKEN_RADIUS)
    base.lineStyle(1.5, 0x0a0e1a, 1)
    base.strokeCircle(0, 0, TOKEN_RADIUS)
    const initial = makeText(this.scene, 0, 0, CLASS_INITIALS[member.cls], 10, '#0a0e1a', {
      fontStyle: 'bold',
    }).setOrigin(0.5)
    const hpBar = this.scene.add.graphics()
    const taskGfx = this.scene.add.graphics()
    taskGfx.setPosition(TOKEN_RADIUS, -TOKEN_RADIUS)
    const ring = this.scene.add.graphics()
    ring.lineStyle(2, COLORS.ok, 1)
    ring.strokeCircle(0, 0, TOKEN_RADIUS + 3)
    ring.setVisible(false)

    const container = this.scene.add.container(0, 0, [base, initial, hpBar, taskGfx, ring])
    container.setSize(TOKEN_RADIUS * 2 + 4, TOKEN_RADIUS * 2 + 4)
    container.setInteractive()
    container.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.rightButtonDown()) this.onCrewClick?.(member.id)
    })
    this.container.add(container)

    const token: CrewToken = {
      container,
      base,
      initial,
      hpBar,
      taskGfx,
      ring,
      pos: { x: 0, y: 0 },
      hasPos: false,
      lastHpKey: '',
      lastTask: '',
      lastDead: false,
      cls: member.cls,
      working: false,
    }
    this.redrawHpBar(token, member.hp / Math.max(1, member.hpMax))
    token.lastHpKey = `${Math.round(member.hp)}/${member.hpMax}`
    return token
  }

  private redrawHpBar(token: CrewToken, pct: number): void {
    const g = token.hpBar
    const p = clamp(pct, 0, 1)
    g.clear()
    g.fillStyle(0x05080f, 0.9)
    g.fillRect(-7, TOKEN_RADIUS + 2, 14, 3)
    const color = p > 0.6 ? COLORS.ok : p > 0.3 ? COLORS.warn : COLORS.danger
    g.fillStyle(color, 1)
    g.fillRect(-7, TOKEN_RADIUS + 2, 14 * p, 3)
  }

  private updateCrewPositions(time: number, dtMs: number): void {
    // Stationary occupancy slots so tokens in the same room do not overlap.
    const occupancy = new Map<number, string[]>()
    for (const member of this.state.crew) {
      if (member.path.length === 0) {
        const list = occupancy.get(member.roomId) ?? []
        list.push(member.id)
        occupancy.set(member.roomId, list)
      }
    }

    for (const member of this.state.crew) {
      const token = this.tokens.get(member.id)
      if (token === undefined) continue

      let target: Vec2
      const nextRoom = member.path[0]
      if (nextRoom !== undefined) {
        const a = this.roomCenter(member.roomId)
        const b = this.roomCenter(nextRoom)
        const t = clamp(member.moveProgress, 0, 1)
        target = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      } else {
        const c = this.roomCenter(member.roomId)
        const mates = occupancy.get(member.roomId) ?? []
        const idx = mates.indexOf(member.id)
        const n = mates.length
        if (n > 1 && idx >= 0) {
          const rr = this.roomRect(member.roomId)
          const horizontal = rr !== null && rr.w >= rr.h
          const off = (idx - (n - 1) / 2) * (TOKEN_RADIUS * 2 + 4)
          target = horizontal ? { x: c.x + off, y: c.y } : { x: c.x, y: c.y + off }
        } else {
          target = c
        }
      }

      if (!token.hasPos) {
        token.hasPos = true
        token.pos.x = target.x
        token.pos.y = target.y
      } else {
        const k = Math.min(1, (dtMs / 1000) * 11)
        token.pos.x += (target.x - token.pos.x) * k
        token.pos.y += (target.y - token.pos.y) * k
        const dx = target.x - token.pos.x
        const dy = target.y - token.pos.y
        if (dx * dx + dy * dy > this.cell * this.cell * 9) {
          token.pos.x = target.x
          token.pos.y = target.y
        }
      }

      const bob = token.working && !token.lastDead ? Math.sin(time / 130) * 1.6 : 0
      token.container.setPosition(token.pos.x, token.pos.y + bob)
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    for (const zone of this.roomZones.values()) zone.destroy()
    this.roomZones.clear()
    for (const zone of this.doorZones) zone.destroy()
    this.doorZones.length = 0
    for (const token of this.tokens.values()) token.container.destroy()
    this.tokens.clear()
    this.container.destroy(true)
  }
}

function damagedPips(sys: SystemState): number {
  return clamp(Math.ceil(sys.damage - 0.001), 0, sys.level)
}

function ensureParticleTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(PARTICLE_KEY)) return
  const g = scene.add.graphics()
  g.fillStyle(0xffffff, 1)
  g.fillCircle(3, 3, 3)
  g.generateTexture(PARTICLE_KEY, 6, 6)
  g.destroy()
}
