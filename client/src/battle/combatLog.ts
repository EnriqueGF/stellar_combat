// Combat log (GAME_SPEC §6.3): last 3 entries inside HUD.logRect with age
// fade-out. Three pooled Text objects, restyled only when entries change.

import type Phaser from 'phaser'
import { COLORS, HUD } from '../theme'
import { cssOf, makeText } from './common'

const MAX_ENTRIES = 3
const FADE_START_MS = 4500
const FADE_END_MS = 8500

interface LogEntry {
  msg: string
  color: number
  born: number
}

export class CombatLog {
  private readonly texts: Phaser.GameObjects.Text[] = []
  private entries: LogEntry[] = []
  private readonly scene: Phaser.Scene
  private dirty = false

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    for (let i = 0; i < MAX_ENTRIES; i++) {
      const t = makeText(scene, HUD.logRect.x + 4, HUD.logRect.y + 2 + i * 17, '', 13)
      t.setDepth(20)
      this.texts.push(t)
    }
  }

  add(msg: string, color: number = COLORS.text): void {
    this.entries.push({ msg, color, born: this.scene.time.now })
    if (this.entries.length > MAX_ENTRIES) this.entries = this.entries.slice(-MAX_ENTRIES)
    this.dirty = true
  }

  update(time: number): void {
    if (this.dirty) {
      this.dirty = false
      for (let i = 0; i < MAX_ENTRIES; i++) {
        const entry = this.entries[i]
        const t = this.texts[i]
        if (t === undefined) continue
        if (entry === undefined) {
          t.setText('')
        } else {
          t.setText(entry.msg)
          t.setColor(cssOf(entry.color))
        }
      }
    }
    for (let i = 0; i < MAX_ENTRIES; i++) {
      const entry = this.entries[i]
      const t = this.texts[i]
      if (entry === undefined || t === undefined) continue
      const age = time - entry.born
      const alpha =
        age <= FADE_START_MS
          ? 1
          : Math.max(0.15, 1 - (age - FADE_START_MS) / (FADE_END_MS - FADE_START_MS))
      t.setAlpha(alpha)
    }
  }

  destroy(): void {
    for (const t of this.texts) t.destroy()
    this.texts.length = 0
    this.entries = []
  }
}
