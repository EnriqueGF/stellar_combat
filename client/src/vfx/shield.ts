// Hexagonal shield bubble (GAME_SPEC §6.3): hex grid clipped to an ellipse,
// breathing alpha, layer-count brightness and angular ripple on impact.

import Phaser from 'phaser'
import { clamp } from '@stellar/shared'
import type { IShieldBubble } from '../contracts'
import { COLORS } from '../theme'

const HEX_KEY = 'vfx_hex'
const HEX_TEX_SIZE = 32
const HEX_TEX_R = 13

function ensureHexTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(HEX_KEY)) return
  const g = scene.add.graphics()
  g.lineStyle(2, 0xffffff, 1)
  const pts: Phaser.Math.Vector2[] = []
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k + Math.PI / 6
    pts.push(
      new Phaser.Math.Vector2(
        HEX_TEX_SIZE / 2 + Math.cos(a) * HEX_TEX_R,
        HEX_TEX_SIZE / 2 + Math.sin(a) * HEX_TEX_R,
      ),
    )
  }
  g.strokePoints(pts, true, true)
  g.generateTexture(HEX_KEY, HEX_TEX_SIZE, HEX_TEX_SIZE)
  g.destroy()
}

interface HexCell {
  img: Phaser.GameObjects.Image
  angle: number
  rNorm: number
  baseAlpha: number
}

export class ShieldBubble implements IShieldBubble {
  private readonly scene: Phaser.Scene
  private readonly container: Phaser.GameObjects.Container
  private readonly rim: Phaser.GameObjects.Graphics
  private readonly hexes: HexCell[] = []
  private readonly hexScale: number
  private readonly rx: number
  private readonly ry: number
  private readonly breathTween: Phaser.Tweens.Tween
  private readonly temp = new Set<Phaser.GameObjects.GameObject>()
  private layerAlpha = 0
  private breath = 1
  private cur = -1
  private maxL = -1
  private destroyed = false

  constructor(
    scene: Phaser.Scene,
    centerX: number,
    centerY: number,
    radiusX: number,
    radiusY: number,
  ) {
    this.scene = scene
    this.rx = radiusX
    this.ry = radiusY
    ensureHexTexture(scene)

    this.container = scene.add.container(centerX, centerY)
    this.rim = scene.add.graphics()
    this.container.add(this.rim)
    this.redrawRim(0.5)

    const hexR = clamp(Math.min(radiusX, radiusY) / 7.5, 11, 20)
    this.hexScale = hexR / HEX_TEX_R
    const stepX = hexR * Math.sqrt(3)
    const stepY = hexR * 1.5
    const rows = Math.ceil(radiusY / stepY)
    const cols = Math.ceil(radiusX / stepX) + 1
    for (let row = -rows; row <= rows; row++) {
      const offset = row % 2 === 0 ? 0 : stepX / 2
      for (let col = -cols; col <= cols; col++) {
        const x = col * stepX + offset
        const y = row * stepY
        const ex = x / (radiusX - hexR * 0.5)
        const ey = y / (radiusY - hexR * 0.5)
        if (ex * ex + ey * ey > 1) continue
        const rNorm = Math.sqrt((x / radiusX) ** 2 + (y / radiusY) ** 2)
        const baseAlpha = 0.2 + 0.5 * rNorm * rNorm
        const img = scene.add
          .image(x, y, HEX_KEY)
          .setScale(this.hexScale)
          .setTint(COLORS.shield)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setAlpha(baseAlpha)
        this.container.add(img)
        this.hexes.push({
          img,
          angle: Math.atan2(y / radiusY, x / radiusX),
          rNorm,
          baseAlpha,
        })
      }
    }

    this.container.alpha = 0
    // Breathing alpha, full cycle ~3 s.
    this.breathTween = scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: (tw) => {
        this.breath = 0.85 + 0.15 * (tw.getValue() ?? 0)
        if (!this.destroyed) this.container.alpha = this.layerAlpha * this.breath
      },
    })
  }

  setLayers(current: number, max: number): void {
    if (this.destroyed) return
    const n = clamp(Math.floor(current), 0, Math.max(1, max))
    if (n === this.cur && max === this.maxL) return
    const prev = this.cur
    this.cur = n
    this.maxL = max
    const strength = max > 0 ? n / max : 0
    this.scene.tweens.killTweensOf(this)

    if (n <= 0) {
      // Collapse flash only on a real drop (not on initial state).
      if (prev > 0) this.collapseFlash()
      this.scene.tweens.add({ targets: this, layerAlpha: 0, duration: 160 })
      return
    }

    this.redrawRim(strength)
    const target = 0.35 + 0.65 * strength
    if (prev <= 0) {
      this.scene.tweens.add({ targets: this, layerAlpha: target, duration: 200 })
    } else {
      this.layerAlpha = target
    }
  }

  ripple(angle: number): void {
    if (this.destroyed) return
    const ix = Math.cos(angle) * this.rx
    const iy = Math.sin(angle) * this.ry

    // Impact flash at the rim point.
    const flash = this.scene.add
      .image(ix, iy, HEX_KEY)
      .setScale(this.hexScale * 1.4)
      .setTint(0xffffff)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.95)
    this.container.add(flash)
    this.temp.add(flash)
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scale: this.hexScale * 2.4,
      duration: 220,
      onComplete: () => {
        this.temp.delete(flash)
        flash.destroy()
      },
    })

    // Ring propagation by angular distance, 250 ms total.
    const spread = 1.15
    for (const hex of this.hexes) {
      const angDist = Math.abs(Phaser.Math.Angle.Wrap(hex.angle - angle))
      if (angDist >= spread) continue
      const intensity = (1 - angDist / spread) * (0.35 + 0.65 * hex.rNorm)
      this.scene.tweens.killTweensOf(hex.img)
      hex.img.setAlpha(hex.baseAlpha).setScale(this.hexScale)
      this.scene.tweens.add({
        targets: hex.img,
        alpha: Math.min(1, hex.baseAlpha + 0.75 * intensity),
        scale: this.hexScale * (1 + 0.3 * intensity),
        duration: 125,
        delay: (angDist / spread) * 250,
        yoyo: true,
        ease: 'Quad.easeOut',
        onComplete: () => {
          hex.img.setAlpha(hex.baseAlpha).setScale(this.hexScale)
        },
      })
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.breathTween.destroy()
    this.scene.tweens.killTweensOf(this)
    for (const hex of this.hexes) this.scene.tweens.killTweensOf(hex.img)
    for (const obj of this.temp) this.scene.tweens.killTweensOf(obj)
    this.temp.clear()
    this.container.destroy(true)
  }

  private redrawRim(strength: number): void {
    this.rim.clear()
    this.rim.fillStyle(COLORS.shield, 0.04 + 0.05 * strength)
    this.rim.fillEllipse(0, 0, this.rx * 2, this.ry * 2)
    this.rim.lineStyle(5 + 3 * strength, COLORS.shield, 0.16 + 0.2 * strength)
    this.rim.strokeEllipse(0, 0, this.rx * 2, this.ry * 2)
    this.rim.lineStyle(1.5 + 2 * strength, COLORS.shield, 0.55)
    this.rim.strokeEllipse(0, 0, this.rx * 2, this.ry * 2)
  }

  private collapseFlash(): void {
    const g = this.scene.add.graphics({ x: this.container.x, y: this.container.y })
    g.lineStyle(4, 0xffffff, 0.9)
    g.strokeEllipse(0, 0, this.rx * 2, this.ry * 2)
    g.lineStyle(8, COLORS.shield, 0.4)
    g.strokeEllipse(0, 0, this.rx * 2, this.ry * 2)
    this.temp.add(g)
    this.scene.tweens.add({
      targets: g,
      scaleX: 1.18,
      scaleY: 1.18,
      alpha: 0,
      duration: 260,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.temp.delete(g)
        g.destroy()
      },
    })
  }
}
