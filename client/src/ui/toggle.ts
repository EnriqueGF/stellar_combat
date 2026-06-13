// Toggle (checkbox) widget.
//
// API:
//   new Toggle(scene, x, y, label, value, onChange?)  — (x, y) is the center of
//                                                       the box; label sits right.
//   toggle.value / toggle.setValue(v, fire=false)
//
// The state is shown with a checkmark SHAPE (not only color).

import Phaser from 'phaser'
import { COLORS } from '../theme'
import { getAudio } from '../audio/engine'
import { textStyle } from './helpers'

export class Toggle extends Phaser.GameObjects.Container {
  private readonly box: Phaser.GameObjects.Graphics
  private readonly onChange: ((v: boolean) => void) | null
  private currentValue: boolean

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    label: string,
    value: boolean,
    onChange?: (v: boolean) => void,
  ) {
    super(scene, x, y)
    this.currentValue = value
    this.onChange = onChange ?? null

    this.box = scene.add.graphics()
    this.add(this.box)
    const text = scene.add.text(20, 0, label, textStyle('body', 15)).setOrigin(0, 0.5)
    this.add(text)

    const w = 26 + text.width + 6
    this.setSize(w * 2, 30)
    this.setInteractive({ useHandCursor: true })
    this.on('pointerover', () => getAudio().play('hover'))
    this.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) return
      getAudio().play('click')
      this.setValue(!this.currentValue, true)
    })

    this.redraw()
    scene.add.existing(this)
  }

  get value(): boolean {
    return this.currentValue
  }

  setValue(v: boolean, fire = false): this {
    const changed = v !== this.currentValue
    this.currentValue = v
    this.redraw()
    if (fire && changed && this.onChange) this.onChange(v)
    return this
  }

  private redraw(): void {
    const g = this.box
    g.clear()
    g.fillStyle(COLORS.spaceLight, 1)
    g.fillRoundedRect(-11, -11, 22, 22, 4)
    g.lineStyle(1.5, COLORS.panelBorder, 0.9)
    g.strokeRoundedRect(-11, -11, 22, 22, 4)
    if (this.currentValue) {
      g.lineStyle(3, COLORS.ok, 1)
      g.beginPath()
      g.moveTo(-6, 0)
      g.lineTo(-2, 5)
      g.lineTo(6, -5)
      g.strokePath()
    }
  }
}
