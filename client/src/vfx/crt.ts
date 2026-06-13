// CRT overlay (GAME_SPEC §6.4): scanlines + ring vignette + slow flicker +
// faint edge chromatic tint. Screen-space, always on top, GPU-cheap.

import Phaser from 'phaser'
import type { ICrtOverlay } from '../contracts'
import { PixelBuffer } from './helpers'

const CRT_DEPTH = 10000
const SCANLINE_KEY = 'vfx_scanline'

function ensureScanlineTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(SCANLINE_KEY)) return
  const buf = new PixelBuffer(1, 3)
  buf.set(0, 2, { r: 0, g: 0, b: 0 }, 0.1)
  buf.toTexture(scene, SCANLINE_KEY)
}

type CrtPiece =
  | Phaser.GameObjects.TileSprite
  | Phaser.GameObjects.Graphics
  | Phaser.GameObjects.Rectangle

export class CrtOverlay implements ICrtOverlay {
  private readonly objs: CrtPiece[] = []
  private readonly flicker: Phaser.Tweens.Tween
  private destroyed = false

  constructor(scene: Phaser.Scene) {
    const W = scene.scale.width
    const H = scene.scale.height
    ensureScanlineTexture(scene)

    const scanlines = scene.add
      .tileSprite(0, 0, W, H, SCANLINE_KEY)
      .setOrigin(0)
      .setDepth(CRT_DEPTH)
      .setScrollFactor(0)

    // Radial vignette as concentric alpha rings (no gradients needed).
    const vignette = scene.add.graphics().setDepth(CRT_DEPTH).setScrollFactor(0)
    for (let k = 0; k < 12; k++) {
      const a = 0.018 + (k / 11) ** 2 * 0.13
      vignette.lineStyle(40, 0x000000, a)
      vignette.strokeEllipse(W / 2, H / 2, (520 + k * 36) * 2, (330 + k * 26) * 2)
    }

    const left = scene.add
      .rectangle(0, 0, 6, H, 0xff5c57, 0.05)
      .setOrigin(0)
      .setDepth(CRT_DEPTH)
      .setScrollFactor(0)
    const right = scene.add
      .rectangle(W - 6, 0, 6, H, 0x2de2e6, 0.05)
      .setOrigin(0)
      .setDepth(CRT_DEPTH)
      .setScrollFactor(0)

    this.objs.push(scanlines, vignette, left, right)

    this.flicker = scene.tweens.add({
      targets: [scanlines, vignette],
      alpha: 0.97,
      duration: 1900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
  }

  setEnabled(on: boolean): void {
    if (this.destroyed) return
    for (const obj of this.objs) obj.setVisible(on)
    if (on) this.flicker.resume()
    else this.flicker.pause()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.flicker.destroy()
    for (const obj of this.objs) obj.destroy()
    this.objs.length = 0
  }
}
