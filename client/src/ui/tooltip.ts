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
const PAD = 10
const GAP = 3

/**
 * Per-line role used to colour the body of a tooltip. Tooltips are plain strings
 * (first line = title); body lines are classified by content so the renderer can
 * give them distinctive colours without every call site needing markup:
 *  - hint:    interaction help ("Clic …", "[J] …")          → dim
 *  - warn:    danger/penalty lines ("Sin energía", "A 0 …")  → amber
 *  - kv:      "Etiqueta: valor"                              → dim label + bright value
 *  - plain:   anything else                                  → body text
 */
type LineRole =
  | { kind: 'hint' }
  | { kind: 'warn' }
  | { kind: 'kv'; label: string; value: string }
  | { kind: 'plain' }

const HINT_RE = /^(clic|click|\[|atajos|rueda|espacio|tecla|a:|j:)/i
const WARN_RE =
  /(destruid|muert|asfixi|sin energía|sin energia|sin munici|insuficiente|^a 0|⚠|peligro|crític|critic)/i
const KV_RE = /^([\wÁÉÍÓÚÜÑáéíóúüñ .]{1,18}):\s+(.+)$/

function classify(line: string): LineRole {
  const trimmed = line.trim()
  if (HINT_RE.test(trimmed)) return { kind: 'hint' }
  if (WARN_RE.test(line)) return { kind: 'warn' }
  const m = KV_RE.exec(trimmed)
  if (m && m[1] !== undefined && m[2] !== undefined) return { kind: 'kv', label: m[1], value: m[2] }
  return { kind: 'plain' }
}

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

  const fullWrap = WRAP_WIDTH - PAD * 2
  const parts: Phaser.GameObjects.Text[] = []
  let maxRight = 0
  let cy = PAD
  const put = (
    px: number,
    str: string,
    kind: 'title' | 'body',
    size: number,
    color: number,
    wrapW?: number,
  ): Phaser.GameObjects.Text => {
    const t = scene.add.text(px, cy, str, {
      ...textStyle(kind, size, color),
      ...(wrapW !== undefined ? { wordWrap: { width: wrapW } } : {}),
    })
    parts.push(t)
    maxRight = Math.max(maxRight, px + t.width)
    return t
  }

  const lines = text.split('\n')
  const title = lines[0] ?? ''
  const dash = title.indexOf(' — ')
  if (dash >= 0) {
    const name = put(PAD, title.slice(0, dash), 'title', 14, COLORS.panelBorder)
    put(PAD + name.width, title.slice(dash), 'body', 13, COLORS.textDim, fullWrap - name.width)
    cy += name.height + GAP
  } else {
    const t = put(PAD, title, 'title', 14, COLORS.panelBorder, fullWrap)
    cy += t.height + GAP
  }

  const dividerY = cy + 1
  cy += 7

  for (const line of lines.slice(1)) {
    if (line.trim() === '') {
      cy += 5
      continue
    }
    const role = classify(line)
    if (role.kind === 'kv') {
      const lbl = put(PAD, `${role.label}: `, 'body', 13, COLORS.textDim)
      const val = put(PAD + lbl.width, role.value, 'body', 13, COLORS.text, fullWrap - lbl.width)
      cy += Math.max(lbl.height, val.height) + GAP
    } else {
      const color =
        role.kind === 'hint' ? COLORS.textDim : role.kind === 'warn' ? COLORS.warn : COLORS.text
      const t = put(PAD, line, 'body', 13, color, fullWrap)
      cy += t.height + GAP
    }
  }

  const w = maxRight + PAD
  const h = cy - GAP + PAD
  const bg = scene.add.graphics()
  bg.fillStyle(COLORS.panel, 0.97)
  bg.fillRoundedRect(0, 0, w, h, 6)
  bg.lineStyle(1, COLORS.panelBorder, 0.9)
  bg.strokeRoundedRect(0, 0, w, h, 6)
  if (lines.length > 1) {
    bg.lineStyle(1, COLORS.panelBorder, 0.3)
    bg.lineBetween(PAD, dividerY, w - PAD, dividerY)
  }

  const pointer = scene.input.activePointer
  let x = pointer.worldX + 14
  let y = pointer.worldY + 20
  if (x + w > GAME_WIDTH - 8) x = GAME_WIDTH - 8 - w
  if (x < 8) x = 8
  if (y + h > GAME_HEIGHT - 8) y = pointer.worldY - h - 12
  if (y < 8) y = 8

  const container = scene.add.container(x, y, [bg, ...parts]).setDepth(DEPTH)
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
