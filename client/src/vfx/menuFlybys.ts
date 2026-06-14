// Ambient menu life: the occasional shooting star streaking across the sky and,
// less often, a small ship cruising past in the distance. Purely cosmetic and
// self-scheduling; lives behind the UI and above the starfield/planet backdrop.

import Phaser from 'phaser'
import { GAME_HEIGHT, GAME_WIDTH } from '../theme'

const STREAK_DEPTH = -50
const SHIP_DEPTH = -55
const STAR_TINTS = [0xffffff, 0xcfe8ef, 0x9fb8d9, 0x8ad9e6, 0xb8a8e6]
const SHIP_TINTS = [0x6f8bb0, 0x8a93a8, 0x5a7a8c, 0x9a7fae]

export class MenuFlybys {
  private readonly scene: Phaser.Scene
  private readonly live = new Set<Phaser.GameObjects.GameObject>()
  private destroyed = false

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.scheduleStar(800)
    this.scheduleFlyby(5000)
  }

  // --- scheduling -----------------------------------------------------------

  private scheduleStar(delay: number): void {
    if (this.destroyed) return
    this.scene.time.delayedCall(delay, () => {
      if (this.destroyed) return
      this.shootingStar()
      this.scheduleStar(1600 + Math.random() * 4200)
    })
  }

  private scheduleFlyby(delay: number): void {
    if (this.destroyed) return
    this.scene.time.delayedCall(delay, () => {
      if (this.destroyed) return
      this.flyby()
      this.scheduleFlyby(11000 + Math.random() * 17000)
    })
  }

  // --- effects --------------------------------------------------------------

  private shootingStar(): void {
    const fromLeft = Math.random() < 0.5
    const startX = fromLeft ? -60 : GAME_WIDTH + 60
    const endX = fromLeft ? GAME_WIDTH + 60 : -60
    const startY = Math.random() * GAME_HEIGHT * 0.45
    const endY = startY + GAME_HEIGHT * (0.2 + Math.random() * 0.3)
    const angle = Math.atan2(endY - startY, endX - startX)
    const len = 55 + Math.random() * 45
    const tint = STAR_TINTS[Math.floor(Math.random() * STAR_TINTS.length)] ?? 0xffffff

    const g = this.scene.add.graphics().setDepth(STREAK_DEPTH)
    // Tapered tail trailing behind the head (head leads at local +x = travel dir).
    const segs = 8
    for (let i = 0; i < segs; i++) {
      const t = i / segs
      g.lineStyle(2.4 * (1 - t), tint, 0.9 * (1 - t))
      g.lineBetween(-len * t, 0, -len * (t + 1 / segs), 0)
    }
    g.fillStyle(0xffffff, 1)
    g.fillCircle(0, 0, 2)
    g.setRotation(angle).setPosition(startX, startY).setAlpha(0)
    this.track(g)

    const dur = 650 + Math.random() * 520
    this.scene.tweens.add({ targets: g, alpha: 1, duration: dur * 0.3, yoyo: true, hold: dur * 0.3 })
    this.scene.tweens.add({
      targets: g,
      x: endX,
      y: endY,
      duration: dur,
      ease: 'Sine.easeIn',
      onComplete: () => this.release(g),
    })
  }

  private flyby(): void {
    const fromLeft = Math.random() < 0.5
    const dir = fromLeft ? 1 : -1
    const y = GAME_HEIGHT * (0.12 + Math.random() * 0.5)
    const scale = 0.6 + Math.random() * 0.8
    const startX = fromLeft ? -90 : GAME_WIDTH + 90
    const endX = fromLeft ? GAME_WIDTH + 90 : -90
    const tint = SHIP_TINTS[Math.floor(Math.random() * SHIP_TINTS.length)] ?? 0x8a93a8

    const glow = this.scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD)
    glow.fillStyle(0x7ad9ff, 0.5)
    glow.fillEllipse(-15, 0, 18, 6)
    glow.fillStyle(0xffffff, 0.5)
    glow.fillEllipse(-13, 0, 8, 3)
    const hull = this.scene.add.graphics()
    drawTinyShip(hull, tint)

    const c = this.scene.add.container(startX, y, [glow, hull]).setDepth(SHIP_DEPTH)
    // Flip horizontally so the nose points the way it travels.
    c.setScale(scale * dir, scale)
    this.track(c)

    // Gentle bob + engine flicker.
    this.scene.tweens.add({
      targets: c,
      y: y + (Math.random() < 0.5 ? -1 : 1) * 7,
      duration: 1300 + Math.random() * 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
    this.scene.tweens.add({ targets: glow, alpha: 0.5, duration: 220, yoyo: true, repeat: -1 })

    const dur = 9000 + Math.random() * 9000
    this.scene.tweens.add({
      targets: c,
      x: endX,
      duration: dur,
      ease: 'Linear',
      onComplete: () => this.release(c),
    })
  }

  // --- bookkeeping ----------------------------------------------------------

  private track(obj: Phaser.GameObjects.GameObject): void {
    this.live.add(obj)
  }

  /** Destroys an object after killing every tween on it AND its children — the ship
   *  flyby's bob/glow are infinite (repeat:-1) tweens that would otherwise keep
   *  running against the destroyed object. */
  private killAndDestroy(obj: Phaser.GameObjects.GameObject): void {
    this.scene.tweens.killTweensOf(obj)
    const children = (obj as Partial<Phaser.GameObjects.Container>).list
    if (Array.isArray(children)) {
      for (const child of children) this.scene.tweens.killTweensOf(child)
    }
    obj.destroy()
  }

  private release(obj: Phaser.GameObjects.GameObject): void {
    this.live.delete(obj)
    this.killAndDestroy(obj)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    for (const obj of this.live) this.killAndDestroy(obj)
    this.live.clear()
  }
}

/** A tiny procedural ship silhouette, nose pointing local +x. */
function drawTinyShip(g: Phaser.GameObjects.Graphics, color: number): void {
  g.fillStyle(color, 1)
  g.beginPath()
  g.moveTo(15, 0)
  g.lineTo(2, -5)
  g.lineTo(-13, -4)
  g.lineTo(-13, 4)
  g.lineTo(2, 5)
  g.closePath()
  g.fillPath()
  g.lineStyle(1, 0x0a0e1a, 1)
  g.strokePath()
  // Dorsal fin.
  g.fillStyle(Phaser.Display.Color.IntegerToColor(color).darken(25).color, 1)
  g.fillTriangle(-3, -4, -9, -13, -11, -4)
  // Cockpit glint.
  g.fillStyle(0x9fd4f0, 0.9)
  g.fillCircle(6, 0, 1.8)
}
