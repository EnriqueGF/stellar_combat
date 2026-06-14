// Crew portrait cards (GAME_SPEC §6.3, HUD.portraitsRect): compact FTL-style rows
// — a small species/class icon, the name and a health bar. Everything else
// (class, level, exact HP, species traits) lives in the hover tooltip.

import type Phaser from 'phaser'
import { CREW_CLASSES, CREW_RACES, clamp, type CrewState } from '@stellar/shared'
import { COLORS, HUD } from '../theme'
import { makeText, type Rect } from './common'
import { drawRaceBody } from './crewArt'
import { drawCrossOut } from './icons'
import { Tooltip } from './uiKit'

const CARD_H = 38
const CARD_STEP = 44
const DEPTH = 12

interface Card {
  crewId: string | null
  bg: Phaser.GameObjects.Graphics
  nameText: Phaser.GameObjects.Text
  hpBar: Phaser.GameObjects.Graphics
  raceGfx: Phaser.GameObjects.Graphics
  selectGfx: Phaser.GameObjects.Graphics
  blinkGfx: Phaser.GameObjects.Graphics
  deadGfx: Phaser.GameObjects.Graphics
  zone: Phaser.GameObjects.Zone
  lastKey: string
  blinking: boolean
}

export interface PortraitCallbacks {
  onSelect(crewId: string): void
  onDeselect(): void
}

export class CrewPortraits {
  private readonly scene: Phaser.Scene
  private readonly cards: Card[] = []
  private crew: CrewState[] = []
  private selectedIds = new Set<string>()

  constructor(scene: Phaser.Scene, initial: CrewState[], cb: PortraitCallbacks) {
    this.scene = scene
    for (let i = 0; i < 4; i++) {
      const r = this.cardRect(i)
      const bg = scene.add.graphics().setDepth(DEPTH)
      const raceGfx = scene.add.graphics().setDepth(DEPTH + 1)
      const nameText = makeText(scene, r.x + 25, r.y + 5, '', 11).setDepth(DEPTH + 1)
      const hpBar = scene.add.graphics().setDepth(DEPTH + 1)
      const selectGfx = scene.add.graphics().setDepth(DEPTH + 2).setVisible(false)
      selectGfx.lineStyle(2, COLORS.ok, 1)
      selectGfx.strokeRoundedRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 5)
      const blinkGfx = scene.add.graphics().setDepth(DEPTH + 2).setVisible(false)
      blinkGfx.lineStyle(2, COLORS.danger, 1)
      blinkGfx.strokeRoundedRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 5)
      const deadGfx = scene.add.graphics().setDepth(DEPTH + 2).setVisible(false)
      deadGfx.fillStyle(0x05080f, 0.6)
      deadGfx.fillRoundedRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 5)
      drawCrossOut(deadGfx, r.x + 13, r.y + r.h / 2, 18, COLORS.danger)

      const zone = scene.add
        .zone(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h)
        .setInteractive()
        .setDepth(DEPTH + 3)
      const idx = i
      zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        const card = this.cards[idx]
        if (card === undefined) return
        if (pointer.rightButtonDown()) {
          cb.onDeselect()
          return
        }
        const member = this.memberOf(card)
        if (member !== undefined && member.hp > 0 && card.crewId !== null) {
          cb.onSelect(card.crewId)
        }
      })
      Tooltip.attach(zone, () => {
        const card = this.cards[idx]
        const member = card === undefined ? undefined : this.memberOf(card)
        if (member === undefined) return 'Sin tripulante'
        if (member.hp <= 0) return `${member.name} — muerto en combate`
        const cls = CREW_CLASSES[member.cls]
        const race = CREW_RACES[member.race]
        return `${member.name} — ${race?.name ?? ''} · ${cls.name} (nivel ${member.level})\n${cls.desc}\n${race ? `${race.name}: ${race.desc}\n` : ''}HP: ${Math.round(member.hp)}/${member.hpMax}\nClic izq.: seleccionar · arrastra para varios · clic dcho. en una sala los mueve`
      })

      this.cards.push({
        crewId: null,
        bg,
        nameText,
        hpBar,
        raceGfx,
        selectGfx,
        blinkGfx,
        deadGfx,
        zone,
        lastKey: '',
        blinking: false,
      })
    }
    this.apply(initial)
  }

  cardRect(index: number): Rect {
    return { x: HUD.portraitsRect.x + 2, y: HUD.portraitsRect.y + index * CARD_STEP, w: 82, h: CARD_H }
  }

  rect(): Rect {
    return {
      x: HUD.portraitsRect.x,
      y: HUD.portraitsRect.y,
      w: HUD.portraitsRect.w,
      h: HUD.portraitsRect.h,
    }
  }

  private memberOf(card: Card): CrewState | undefined {
    return this.crew.find((c) => c.id === card.crewId)
  }

  apply(crew: CrewState[]): void {
    this.crew = crew
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i]
      if (card === undefined) continue
      const member = crew[i]
      const r = this.cardRect(i)
      if (member === undefined) {
        if (card.lastKey !== 'empty') {
          card.lastKey = 'empty'
          card.crewId = null
          card.bg.clear()
          card.bg.fillStyle(COLORS.panel, 0.5)
          card.bg.fillRoundedRect(r.x, r.y, r.w, r.h, 5)
          card.nameText.setText('')
          card.hpBar.clear()
          card.raceGfx.clear()
          card.deadGfx.setVisible(false)
          card.blinkGfx.setVisible(false)
        }
        continue
      }
      card.crewId = member.id
      const dead = member.hp <= 0
      const key = `${member.id}:${Math.round(member.hp)}:${member.level}:${dead ? 1 : 0}`
      if (key === card.lastKey) {
        card.blinking = !dead && member.hp / Math.max(1, member.hpMax) < 0.3
        continue
      }
      card.lastKey = key

      card.bg.clear()
      card.bg.fillStyle(COLORS.panel, 0.95)
      card.bg.fillRoundedRect(r.x, r.y, r.w, r.h, 5)
      card.bg.lineStyle(1, 0x35506e, 1)
      card.bg.strokeRoundedRect(r.x, r.y, r.w, r.h, 5)

      card.nameText.setText(member.name.toUpperCase().slice(0, 8))

      // Species/class silhouette as the card's icon.
      card.raceGfx.clear()
      card.raceGfx.setPosition(r.x + 13, r.y + r.h / 2)
      if (!dead) drawRaceBody(card.raceGfx, member.race, member.cls, 12)

      const pct = clamp(member.hp / Math.max(1, member.hpMax), 0, 1)
      const hpColor = pct > 0.6 ? COLORS.ok : pct > 0.3 ? COLORS.warn : COLORS.danger
      const bw = r.w - 31
      const bx = r.x + 25
      const by = r.y + 24
      card.hpBar.clear()
      card.hpBar.fillStyle(0x05080f, 1)
      card.hpBar.fillRect(bx, by, bw, 6)
      card.hpBar.fillStyle(hpColor, 1)
      card.hpBar.fillRect(bx, by, bw * pct, 6)
      card.hpBar.lineStyle(1, 0x35506e, 1)
      card.hpBar.strokeRect(bx, by, bw, 6)

      card.deadGfx.setVisible(dead)
      card.blinking = !dead && pct < 0.3
      if (dead && this.selectedIds.has(member.id)) {
        this.selectedIds.delete(member.id)
        card.selectGfx.setVisible(false)
      }
    }
  }

  setSelected(sel: string | string[] | null): void {
    this.selectedIds = sel === null ? new Set() : new Set(Array.isArray(sel) ? sel : [sel])
    for (const card of this.cards) {
      card.selectGfx.setVisible(card.crewId !== null && this.selectedIds.has(card.crewId))
    }
  }

  flash(crewId: string, color: number): void {
    const idx = this.cards.findIndex((c) => c.crewId === crewId)
    const card = this.cards[idx]
    if (card === undefined) return
    const r = this.cardRect(idx)
    const g = this.scene.add.graphics().setDepth(DEPTH + 4)
    g.fillStyle(color, 0.5)
    g.fillRoundedRect(r.x, r.y, r.w, r.h, 5)
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      duration: 600,
      onComplete: () => g.destroy(),
    })
  }

  update(time: number): void {
    const on = Math.sin(time / 160) > 0
    for (const card of this.cards) {
      card.blinkGfx.setVisible(card.blinking && on)
    }
  }

  destroy(): void {
    for (const card of this.cards) {
      card.bg.destroy()
      card.nameText.destroy()
      card.hpBar.destroy()
      card.raceGfx.destroy()
      card.selectGfx.destroy()
      card.blinkGfx.destroy()
      card.deadGfx.destroy()
      card.zone.destroy()
    }
    this.cards.length = 0
  }
}
