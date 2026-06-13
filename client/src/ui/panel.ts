// Panel widget: rounded rect with theme fill + border and optional title.
//
// API:
//   new Panel(scene, x, y, w, h, opts?)   — (x, y) is the TOP-LEFT corner
//                                           (layout convenience); children are
//                                           positioned relative to it.
//   opts: { title?, borderColor?, fillColor?, fillAlpha?, radius? }
//   panel.width / panel.height            — the given size.
//   panel.contentTop                      — y offset below the title (or 10).

import Phaser from 'phaser'
import { COLORS } from '../theme'
import { textStyle } from './helpers'

export interface PanelOpts {
  title?: string
  borderColor?: number
  fillColor?: number
  fillAlpha?: number
  radius?: number
}

export class Panel extends Phaser.GameObjects.Container {
  readonly contentTop: number

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, opts: PanelOpts = {}) {
    super(scene, x, y)
    const border = opts.borderColor ?? COLORS.panelBorder
    const fill = opts.fillColor ?? COLORS.panel
    const radius = opts.radius ?? 8
    const g = scene.add.graphics()
    g.fillStyle(fill, opts.fillAlpha ?? 0.92)
    g.fillRoundedRect(0, 0, w, h, radius)
    g.lineStyle(1.5, border, 0.85)
    g.strokeRoundedRect(0, 0, w, h, radius)
    this.add(g)
    if (opts.title !== undefined) {
      const t = scene.add.text(12, 8, opts.title, textStyle('title', 14, border))
      this.add(t)
      const line = scene.add.graphics()
      line.lineStyle(1, border, 0.4)
      line.lineBetween(12, 30, w - 12, 30)
      this.add(line)
      this.contentTop = 36
    } else {
      this.contentTop = 10
    }
    this.setSize(w, h)
    scene.add.existing(this)
  }
}
