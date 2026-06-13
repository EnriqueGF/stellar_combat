// Global toast notifications (top-center of the screen).
//
// API:
//   Toast.init(game)               — call once (Boot scene).
//   Toast.show(msg, kind='info')   — kind: 'info' | 'warn' | 'error'.
//
// Toasts are rendered inside the top-most active scene, stack vertically and
// fade out after ~3.5 s. If the hosting scene shuts down mid-toast, Phaser
// destroys its objects with it (no leaks). Signals use icon + color.

import Phaser from 'phaser'
import { COLORS, GAME_WIDTH } from '../theme'
import { textStyle } from './helpers'

type ToastKind = 'info' | 'warn' | 'error'

const DEPTH = 10002
const LIFETIME_MS = 3500
const STACK_GAP = 46

let game: Phaser.Game | null = null
const active: Phaser.GameObjects.Container[] = []

function kindSpec(kind: ToastKind): { color: number; glyph: string } {
  if (kind === 'error') return { color: COLORS.danger, glyph: 'X' }
  if (kind === 'warn') return { color: COLORS.warn, glyph: '!' }
  return { color: COLORS.panelBorder, glyph: 'i' }
}

function restack(): void {
  active.forEach((c, i) => {
    if (c.active) c.setY(76 + i * STACK_GAP)
  })
}

function spawn(msg: string, kind: ToastKind, attempt: number): void {
  if (!game) return
  const scenes = game.scene.getScenes(true)
  const scene = scenes[scenes.length - 1]
  if (!scene) {
    if (attempt < 5) window.setTimeout(() => spawn(msg, kind, attempt + 1), 120)
    return
  }
  const spec = kindSpec(kind)
  const text = scene.add.text(0, 0, msg, textStyle('body', 15)).setOrigin(0, 0.5)
  const w = Math.min(text.width + 58, 720)
  const h = 38
  const bg = scene.add.graphics()
  bg.fillStyle(COLORS.panel, 0.96)
  bg.fillRoundedRect(-w / 2, -h / 2, w, h, 6)
  bg.lineStyle(1.5, spec.color, 1)
  bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 6)
  bg.lineStyle(1.5, spec.color, 1)
  bg.strokeCircle(-w / 2 + 19, 0, 9)
  const glyph = scene.add
    .text(-w / 2 + 19, 0, spec.glyph, textStyle('body', 13, spec.color))
    .setOrigin(0.5)
  text.setPosition(-w / 2 + 36, 0)

  const container = scene.add
    .container(GAME_WIDTH / 2, 76 + active.length * STACK_GAP, [bg, glyph, text])
    .setDepth(DEPTH)
    .setAlpha(0)
  active.push(container)

  scene.tweens.add({ targets: container, alpha: 1, duration: 150 })
  scene.time.delayedCall(LIFETIME_MS, () => {
    if (!container.active) return
    scene.tweens.add({
      targets: container,
      alpha: 0,
      y: container.y - 14,
      duration: 250,
      onComplete: () => {
        dismiss(container)
      },
    })
  })
  container.once('destroy', () => {
    const idx = active.indexOf(container)
    if (idx >= 0) {
      active.splice(idx, 1)
      restack()
    }
  })
}

function dismiss(container: Phaser.GameObjects.Container): void {
  if (container.active) container.destroy()
}

export const Toast = {
  init(g: Phaser.Game): void {
    game = g
  },

  show(msg: string, kind: ToastKind = 'info'): void {
    spawn(msg, kind, 0)
  },
}
