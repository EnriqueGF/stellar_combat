// Button widget.
//
// API:
//   new Button(scene, x, y, label, onClick, opts?)   — (x, y) is the CENTER.
//   opts: { width=220, height=48, fontSize=18, variant='primary'|'danger'|'ghost',
//           disabled=false }
//   btn.setDisabled(disabled, reason?)  — when disabled and a reason is given,
//                                         hovering shows it as a tooltip.
//   btn.setLabel(text)
//   btn.setTooltip(fn)                  — tooltip while ENABLED (disabled reason wins).
//   btn.disabled                        — read-only state.
//
// Hover plays 'hover', click plays 'click' (procedural audio engine).

import Phaser from 'phaser'
import { COLORS } from '../theme'
import { getAudio } from '../audio/engine'
import { Tooltip } from './tooltip'
import { textStyle } from './helpers'

export interface ButtonOpts {
  width?: number
  height?: number
  fontSize?: number
  variant?: 'primary' | 'danger' | 'ghost'
  disabled?: boolean
}

export class Button extends Phaser.GameObjects.Container {
  private readonly bg: Phaser.GameObjects.Graphics
  private readonly labelText: Phaser.GameObjects.Text
  private readonly bw: number
  private readonly bh: number
  private readonly variant: 'primary' | 'danger' | 'ghost'
  private hovered = false
  private disabledFlag: boolean
  private disabledReason: string | null = null
  private tooltipFn: (() => string) | null = null
  private readonly onClick: () => void

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    opts: ButtonOpts = {},
  ) {
    super(scene, x, y)
    this.bw = opts.width ?? 220
    this.bh = opts.height ?? 48
    this.variant = opts.variant ?? 'primary'
    this.disabledFlag = opts.disabled ?? false
    this.onClick = onClick

    this.bg = scene.add.graphics()
    this.labelText = scene.add
      .text(0, 0, label, textStyle('title', opts.fontSize ?? 18))
      .setOrigin(0.5)
    this.add([this.bg, this.labelText])
    this.redraw()

    // Implicit hit area: Phaser centers it automatically for Containers.
    this.setSize(this.bw, this.bh)
    this.setInteractive({ useHandCursor: true })

    this.on('pointerover', () => {
      this.hovered = true
      if (!this.disabledFlag) getAudio().play('hover')
      this.redraw()
    })
    this.on('pointerout', () => {
      this.hovered = false
      this.redraw()
    })
    this.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) return
      if (this.disabledFlag) return
      getAudio().play('click')
      this.onClick()
    })

    Tooltip.attach(this, () => {
      if (this.disabledFlag) return this.disabledReason ?? ''
      return this.tooltipFn ? this.tooltipFn() : ''
    })

    scene.add.existing(this)
  }

  get disabled(): boolean {
    return this.disabledFlag
  }

  setDisabled(disabled: boolean, reason?: string | null): this {
    this.disabledFlag = disabled
    this.disabledReason = reason ?? null
    this.redraw()
    return this
  }

  setLabel(text: string): this {
    this.labelText.setText(text)
    this.redraw()
    return this
  }

  setTooltip(fn: (() => string) | null): this {
    this.tooltipFn = fn
    return this
  }

  private redraw(): void {
    const border =
      this.variant === 'danger'
        ? COLORS.danger
        : this.variant === 'ghost'
          ? COLORS.textDim
          : COLORS.panelBorder
    const textColor = this.variant === 'danger' ? COLORS.danger : COLORS.text
    const g = this.bg
    g.clear()
    const alpha = this.disabledFlag ? 0.4 : 1
    g.fillStyle(this.hovered && !this.disabledFlag ? 0x1a2840 : COLORS.panel, 0.95 * alpha)
    g.fillRoundedRect(-this.bw / 2, -this.bh / 2, this.bw, this.bh, 6)
    g.lineStyle(this.hovered && !this.disabledFlag ? 2.5 : 1.5, border, alpha)
    g.strokeRoundedRect(-this.bw / 2, -this.bh / 2, this.bw, this.bh, 6)
    this.labelText.setColor(`#${textColor.toString(16).padStart(6, '0')}`)
    this.labelText.setAlpha(this.disabledFlag ? 0.5 : 1)
  }
}
