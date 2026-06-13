// ProgressBar widget.
//
// API:
//   new ProgressBar(scene, x, y, w, h, opts?)  — (x, y) is the TOP-LEFT corner.
//   opts: { color=panelBorder, bgColor=spaceLight, radius? }
//   bar.setValue(ratio)      — 0..1 (clamped).
//   bar.setColor(color)      — change the fill color (e.g. ok -> warn -> danger).
//   bar.setText(str)         — optional centered overlay text ('' hides it).

import Phaser from 'phaser'
import { clamp } from '@stellar/shared'
import { COLORS } from '../theme'
import { textStyle } from './helpers'

export interface ProgressBarOpts {
  color?: number
  bgColor?: number
  radius?: number
}

export class ProgressBar extends Phaser.GameObjects.Container {
  private readonly barW: number
  private readonly barH: number
  private readonly radius: number
  private readonly fill: Phaser.GameObjects.Graphics
  private readonly overlay: Phaser.GameObjects.Text
  private color: number
  private ratio = 0

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    w: number,
    h: number,
    opts: ProgressBarOpts = {},
  ) {
    super(scene, x, y)
    this.barW = w
    this.barH = h
    this.radius = opts.radius ?? Math.min(4, h / 2)
    this.color = opts.color ?? COLORS.panelBorder

    const bg = scene.add.graphics()
    bg.fillStyle(opts.bgColor ?? COLORS.spaceLight, 1)
    bg.fillRoundedRect(0, 0, w, h, this.radius)
    bg.lineStyle(1, COLORS.panelBorder, 0.35)
    bg.strokeRoundedRect(0, 0, w, h, this.radius)
    this.add(bg)

    this.fill = scene.add.graphics()
    this.add(this.fill)

    this.overlay = scene.add
      .text(w / 2, h / 2, '', textStyle('body', Math.max(11, h - 8)))
      .setOrigin(0.5)
    this.add(this.overlay)

    scene.add.existing(this)
  }

  setValue(ratio: number): this {
    this.ratio = clamp(ratio, 0, 1)
    this.redraw()
    return this
  }

  /** Alias of setValue (kept for kit consumers using set()). */
  set(ratio: number): void {
    this.setValue(ratio)
  }

  setColor(color: number): this {
    this.color = color
    this.redraw()
    return this
  }

  setText(str: string): this {
    this.overlay.setText(str)
    return this
  }

  private redraw(): void {
    this.fill.clear()
    if (this.ratio <= 0) return
    this.fill.fillStyle(this.color, 0.9)
    this.fill.fillRoundedRect(
      0,
      0,
      Math.max(this.radius * 2, this.ratio * this.barW),
      this.barH,
      this.radius,
    )
  }
}
