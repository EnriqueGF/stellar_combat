// Global tooltip singleton.
//
// API:
//   Tooltip.init(game)            — call once (Boot scene).
//   Tooltip.attach(obj, textFn)   — show textFn() near the pointer after 300 ms
//                                   of hover over obj. Returning '' suppresses
//                                   the tooltip (useful for conditional hints).
//   Tooltip.hide()                — force-hide (e.g. before scene transitions).
//
// The target object must be interactive (Button already is); attach() tries a
// plain setInteractive() as a fallback for objects with a size. Tooltip visuals
// are created on demand inside the target's scene and destroyed on hide, so
// scene transitions can never leak them. Position is clamped to the canvas.

import Phaser from 'phaser'
import { COLORS } from '../theme'
import { GAME_HEIGHT, GAME_WIDTH } from '../theme'
import { textStyle } from './helpers'

const SHOW_DELAY_MS = 300
const DEPTH = 10001
const WRAP_WIDTH = 320

interface Shown {
  container: Phaser.GameObjects.Container
  scene: Phaser.Scene
  onShutdown: () => void
}

let initialized = false
let pendingTimer: number | null = null
let shown: Shown | null = null

function cancelPending(): void {
  if (pendingTimer !== null) {
    window.clearTimeout(pendingTimer)
    pendingTimer = null
  }
}

function hide(): void {
  cancelPending()
  if (shown) {
    shown.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, shown.onShutdown)
    shown.container.destroy()
    shown = null
  }
}

function show(obj: Phaser.GameObjects.GameObject, textFn: () => string): void {
  hide()
  if (!obj.scene || !obj.active) return
  const text = textFn()
  if (text === '') return
  const scene = obj.scene
  const label = scene.add.text(10, 8, text, {
    ...textStyle('body', 14),
    wordWrap: { width: WRAP_WIDTH },
  })
  const w = label.width + 20
  const h = label.height + 16
  const bg = scene.add.graphics()
  bg.fillStyle(COLORS.panel, 0.96)
  bg.fillRoundedRect(0, 0, w, h, 5)
  bg.lineStyle(1, COLORS.panelBorder, 0.9)
  bg.strokeRoundedRect(0, 0, w, h, 5)

  const pointer = scene.input.activePointer
  let x = pointer.worldX + 14
  let y = pointer.worldY + 20
  if (x + w > GAME_WIDTH - 8) x = GAME_WIDTH - 8 - w
  if (x < 8) x = 8
  if (y + h > GAME_HEIGHT - 8) y = pointer.worldY - h - 12
  if (y < 8) y = 8

  const container = scene.add.container(x, y, [bg, label]).setDepth(DEPTH)
  const onShutdown = (): void => {
    if (shown && shown.scene === scene) shown = null
  }
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, onShutdown)
  shown = { container, scene, onShutdown }
}

export const Tooltip = {
  init(_game: Phaser.Game): void {
    initialized = true
  },

  attach(obj: Phaser.GameObjects.GameObject, textFn: () => string): void {
    if (!obj.input) {
      try {
        obj.setInteractive()
      } catch {
        return
      }
    }
    obj.on('pointerover', () => {
      if (!initialized) return
      cancelPending()
      pendingTimer = window.setTimeout(() => {
        pendingTimer = null
        show(obj, textFn)
      }, SHOW_DELAY_MS)
    })
    const off = (): void => {
      hide()
    }
    obj.on('pointerout', off)
    obj.on('pointerdown', off)
    obj.once('destroy', off)
  },

  hide,
}
