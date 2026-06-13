// Crew portrait cards (GAME_SPEC §6.3, HUD.portraitsRect): 4 vertical cards
// with name, class (icon + text), level stars, HP bar with number, selection
// border and a danger blink below 30% HP.

import type Phaser from 'phaser'
import { CREW_CLASSES, clamp, type CrewState } from '@stellar/shared'
import { COLORS, COLORS_CSS, HUD } from '../theme'
import { CLASS_COLORS, cssOf, makeText, type Rect } from './common'
import { drawCrossOut } from './icons'
import { Tooltip } from './uiKit'

const CARD_H = 93
const CARD_STEP = 97
const DEPTH = 12

interface Card {
  crewId: string | null
  bg: Phaser.GameObjects.Graphics
  nameText: Phaser.GameObjects.Text
  classText: Phaser.GameObjects.Text
  starsText: Phaser.GameObjects.Text
  hpText: Phaser.GameObjects.Text
  hpBar: Phaser.GameObjects.Graphics
  classDot: Phaser.GameObjects.Graphics
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
  private selectedId: string | null = null

  constructor(scene: Phaser.Scene, initial: CrewState[], cb: PortraitCallbacks) {
    this.scene = scene
    for (let i = 0; i < 4; i++) {
      const r = this.cardRect(i)
      const bg = scene.add.graphics().setDepth(DEPTH)
      const nameText = makeText(scene, r.x + 6, r.y + 5, '', 11).setDepth(DEPTH + 1)
      const classDot = scene.add.graphics().setDepth(DEPTH + 1)
      const classText = makeText(scene, r.x + 18, r.y + 22, '', 10, COLORS_CSS.textDim).setDepth(
        DEPTH + 1,
      )
      const starsText = makeText(scene, r.x + 6, r.y + 38, '', 11, COLORS_CSS.energy).setDepth(
        DEPTH + 1,
      )
      const hpText = makeText(scene, r.x + r.w - 6, r.y + 54, '', 10).setOrigin(1, 0).setDepth(
        DEPTH + 1,
      )
      const hpBar = scene.add.graphics().setDepth(DEPTH + 1)
      const selectGfx = scene.add.graphics().setDepth(DEPTH + 2).setVisible(false)
      selectGfx.lineStyle(2, COLORS.ok, 1)
      selectGfx.strokeRoundedRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 6)
      const blinkGfx = scene.add.graphics().setDepth(DEPTH + 2).setVisible(false)
      blinkGfx.lineStyle(2, COLORS.danger, 1)
      blinkGfx.strokeRoundedRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 6)
      const deadGfx = scene.add.graphics().setDepth(DEPTH + 2).setVisible(false)
      deadGfx.fillStyle(0x05080f, 0.6)
      deadGfx.fillRoundedRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 6)
      drawCrossOut(deadGfx, r.x + r.w / 2, r.y + r.h / 2, 26, COLORS.danger)

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
        return `${member.name} — ${cls.name} (nivel ${member.level})\n${cls.desc}\nHP: ${Math.round(member.hp)}/${member.hpMax}\nClick: seleccionar · luego click en una sala para moverlo`
      })

      this.cards.push({
        crewId: null,
        bg,
        nameText,
        classText,
        starsText,
        hpText,
        hpBar,
        classDot,
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
          card.bg.fillRoundedRect(r.x, r.y, r.w, r.h, 6)
          card.nameText.setText('')
          card.classText.setText('')
          card.starsText.setText('')
          card.hpText.setText('')
          card.hpBar.clear()
          card.classDot.clear()
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
      card.bg.fillRoundedRect(r.x, r.y, r.w, r.h, 6)
      card.bg.lineStyle(1, 0x35506e, 1)
      card.bg.strokeRoundedRect(r.x, r.y, r.w, r.h, 6)

      card.nameText.setText(member.name.toUpperCase().slice(0, 9))
      const cls = CREW_CLASSES[member.cls]
      card.classText.setText(cls.name)
      card.classDot.clear()
      card.classDot.fillStyle(CLASS_COLORS[member.cls], 1)
      card.classDot.fillCircle(r.x + 10, r.y + 28, 5)
      card.classDot.lineStyle(1, 0x0a0e1a, 1)
      card.classDot.strokeCircle(r.x + 10, r.y + 28, 5)
      card.starsText.setText('★'.repeat(member.level))

      const pct = clamp(member.hp / Math.max(1, member.hpMax), 0, 1)
      card.hpText.setText(`${Math.max(0, Math.round(member.hp))}`)
      card.hpText.setColor(cssOf(pct > 0.6 ? COLORS.ok : pct > 0.3 ? COLORS.warn : COLORS.danger))
      card.hpBar.clear()
      card.hpBar.fillStyle(0x05080f, 1)
      card.hpBar.fillRect(r.x + 6, r.y + r.h - 18, r.w - 12, 7)
      card.hpBar.fillStyle(pct > 0.6 ? COLORS.ok : pct > 0.3 ? COLORS.warn : COLORS.danger, 1)
      card.hpBar.fillRect(r.x + 6, r.y + r.h - 18, (r.w - 12) * pct, 7)
      card.hpBar.lineStyle(1, 0x35506e, 1)
      card.hpBar.strokeRect(r.x + 6, r.y + r.h - 18, r.w - 12, 7)

      card.deadGfx.setVisible(dead)
      card.blinking = !dead && pct < 0.3
      if (dead && this.selectedId === member.id) this.setSelected(null)
    }
  }

  setSelected(crewId: string | null): void {
    this.selectedId = crewId
    for (const card of this.cards) {
      card.selectGfx.setVisible(card.crewId !== null && card.crewId === crewId)
    }
  }

  flash(crewId: string, color: number): void {
    const idx = this.cards.findIndex((c) => c.crewId === crewId)
    const card = this.cards[idx]
    if (card === undefined) return
    const r = this.cardRect(idx)
    const g = this.scene.add.graphics().setDepth(DEPTH + 4)
    g.fillStyle(color, 0.5)
    g.fillRoundedRect(r.x, r.y, r.w, r.h, 6)
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
      card.classText.destroy()
      card.starsText.destroy()
      card.hpText.destroy()
      card.hpBar.destroy()
      card.classDot.destroy()
      card.selectGfx.destroy()
      card.blinkGfx.destroy()
      card.deadGfx.destroy()
      card.zone.destroy()
    }
    this.cards.length = 0
  }
}
