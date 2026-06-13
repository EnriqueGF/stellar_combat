// Slider widget (horizontal).
//
// API:
//   new Slider(scene, x, y, opts?)  — (x, y) is the LEFT END of the track.
//   opts: { width=220, min=0, max=1, value=min, step?, label?, format?, onChange? }
//   slider.value                    — current value.
//   slider.setValue(v, fire=false)  — programmatic set, optionally firing onChange.
//
// Works inside nested containers and zoomed cameras (drag math uses the
// inverse world transform). Click on the track jumps to that position.

import Phaser from 'phaser'
import { clamp } from '@stellar/shared'
import { COLORS } from '../theme'
import { textStyle } from './helpers'

export interface SliderOpts {
  width?: number
  min?: number
  max?: number
  value?: number
  step?: number
  label?: string
  format?: (v: number) => string
  onChange?: (v: number) => void
}

export class Slider extends Phaser.GameObjects.Container {
  private readonly trackW: number
  private readonly min: number
  private readonly max: number
  private readonly step: number | null
  private readonly format: (v: number) => string
  private readonly onChange: ((v: number) => void) | null
  private readonly fill: Phaser.GameObjects.Graphics
  private readonly handle: Phaser.GameObjects.Graphics
  private readonly valueText: Phaser.GameObjects.Text
  private currentValue: number

  constructor(scene: Phaser.Scene, x: number, y: number, opts: SliderOpts = {}) {
    super(scene, x, y)
    this.trackW = opts.width ?? 220
    this.min = opts.min ?? 0
    this.max = opts.max ?? 1
    this.step = opts.step ?? null
    this.format = opts.format ?? ((v) => `${Math.round(v * 100)}%`)
    this.onChange = opts.onChange ?? null
    this.currentValue = clamp(opts.value ?? this.min, this.min, this.max)

    if (opts.label !== undefined) {
      this.add(scene.add.text(0, -26, opts.label, textStyle('body', 14, COLORS.textDim)))
    }

    const track = scene.add.graphics()
    track.fillStyle(COLORS.spaceLight, 1)
    track.fillRoundedRect(0, -3, this.trackW, 6, 3)
    track.lineStyle(1, COLORS.panelBorder, 0.35)
    track.strokeRoundedRect(0, -3, this.trackW, 6, 3)
    this.add(track)

    this.fill = scene.add.graphics()
    this.add(this.fill)

    this.handle = scene.add.graphics()
    this.handle.fillStyle(COLORS.panel, 1)
    this.handle.fillCircle(0, 0, 10)
    this.handle.lineStyle(2, COLORS.panelBorder, 1)
    this.handle.strokeCircle(0, 0, 10)
    this.handle.setInteractive(
      new Phaser.Geom.Circle(0, 0, 12),
      Phaser.Geom.Circle.Contains,
    )
    if (this.handle.input) this.handle.input.cursor = 'pointer'
    scene.input.setDraggable(this.handle)
    this.handle.on('drag', (pointer: Phaser.Input.Pointer) => {
      this.setFromPointer(pointer)
    })
    this.add(this.handle)

    // Click anywhere on the track to jump.
    const hit = scene.add
      .zone(this.trackW / 2, 0, this.trackW + 16, 28)
      .setInteractive({ useHandCursor: true })
    hit.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.setFromPointer(pointer)
    })
    this.add(hit)

    this.valueText = scene.add
      .text(this.trackW + 14, 0, '', textStyle('body', 14))
      .setOrigin(0, 0.5)
    this.add(this.valueText)

    this.layout()
    scene.add.existing(this)
  }

  get value(): number {
    return this.currentValue
  }

  setValue(v: number, fire = false): this {
    const next = this.quantize(clamp(v, this.min, this.max))
    const changed = next !== this.currentValue
    this.currentValue = next
    this.layout()
    if (fire && changed && this.onChange) this.onChange(next)
    return this
  }

  private quantize(v: number): number {
    if (this.step === null) return v
    const snapped = this.min + Math.round((v - this.min) / this.step) * this.step
    return clamp(Number(snapped.toFixed(6)), this.min, this.max)
  }

  private setFromPointer(pointer: Phaser.Input.Pointer): void {
    const m = this.getWorldTransformMatrix()
    const local = m.applyInverse(pointer.worldX, pointer.worldY)
    const ratio = clamp(local.x / this.trackW, 0, 1)
    this.setValue(this.min + ratio * (this.max - this.min), true)
  }

  private layout(): void {
    const ratio = this.max > this.min ? (this.currentValue - this.min) / (this.max - this.min) : 0
    this.fill.clear()
    this.fill.fillStyle(COLORS.panelBorder, 0.8)
    this.fill.fillRoundedRect(0, -3, Math.max(6, ratio * this.trackW), 6, 3)
    this.handle.setPosition(ratio * this.trackW, 0)
    this.valueText.setText(this.format(this.currentValue))
  }
}
