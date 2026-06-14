// Event scene: shows run.event (title/text/choices) or, after resolving a
// choice, run.eventResult plus a CONTINUAR button. Navigation back to the
// sector map happens via global routing once run:continue clears the event.

import Phaser from 'phaser'
import { COLORS, GAME_HEIGHT, GAME_WIDTH } from '../theme'
import { drawHullIcon, drawMissileIcon, drawScrapIcon } from '../battle/icons'
import { Button } from '../ui/button'
import { Panel } from '../ui/panel'
import { installRunEscapeMenu } from '../ui/escapeMenu'
import { buildRunHeader, menuChrome, textStyle } from '../ui/helpers'
import { getState } from '../state'
import { getNet, scOn } from '../net/socket'
import { getAudio } from '../audio/engine'
import { fadeInScene } from '../ui/transition'

export class EventScene extends Phaser.Scene {
  private dyn: Phaser.GameObjects.Container | null = null
  private busy = false

  constructor() {
    super('Event')
  }

  create(): void {
    const run = getState().run
    if (!run || (run.event === null && run.eventResult === null)) {
      // Defensive bail (stale/empty event): instant error recovery.
      this.scene.start(run ? 'SectorMap' : 'MainMenu')
      return
    }
    this.busy = false
    const node = run.sector.nodes.find((n) => n.id === run.currentNodeId)
    const chrome = menuChrome(this, {
      biome: node?.biome ?? 'rocky',
      seed: node?.seed ?? 1,
      planet: { planetX: GAME_WIDTH * 0.18, planetY: GAME_HEIGHT * 0.75 },
    })
    installRunEscapeMenu(this, chrome.crt)
    getAudio().music('menu')

    this.render()
    scOn(this, 'run:refresh', () => {
      this.busy = false
      this.render()
    })
    fadeInScene(this)
  }

  private render(): void {
    const run = getState().run
    if (!run) return
    if (this.dyn) this.dyn.destroy()
    const dyn = this.add.container(0, 0)
    this.dyn = dyn
    dyn.add(buildRunHeader(this, run))

    const w = 720
    const px = (GAME_WIDTH - w) / 2

    if (run.eventResult !== null) {
      // Resolution view: result text + clear resource-change badges.
      const delta = run.eventDelta
      const hasBadges = delta !== null && (delta.scrap !== 0 || delta.hull !== 0 || delta.ammo !== 0)
      const body = this.add.text(0, 0, run.eventResult, {
        ...textStyle('body', 17),
        wordWrap: { width: w - 48 },
      })
      const h = 36 + 14 + body.height + (hasBadges ? 46 : 0) + 24 + 56
      const py = Math.max(60, (GAME_HEIGHT - h) / 2)
      const panel = new Panel(this, px, py, w, h, { title: run.event?.title ?? 'SUCESO' })
      dyn.add(panel)
      body.setPosition(24, panel.contentTop + 14)
      panel.add(body)
      if (hasBadges && delta) {
        this.renderDeltaBadges(panel, delta, 24, panel.contentTop + 14 + body.height + 16)
      }
      dyn.add(
        new Button(this, GAME_WIDTH / 2, py + h - 44, 'CONTINUAR', () => {
          if (this.busy) return
          this.busy = true
          getNet().socket.emit('run:continue')
          // run:state without event -> global routing moves to SectorMap.
        }, { width: 240, height: 50 }),
      )
      return
    }

    const event = run.event
    if (!event) return
    // Measure the body text first so the panel fits text + contact + choices exactly.
    const body = this.add.text(0, 0, event.text, {
      ...textStyle('body', 16),
      wordWrap: { width: w - 48 },
    })
    const hasContact = event.combat === true && event.enemyName !== undefined
    const contactH = hasContact ? 56 : 0
    const choiceH = event.choices.length * 62
    const h = 36 + 14 + body.height + contactH + 26 + choiceH + 14
    const py = Math.max(60, (GAME_HEIGHT - h) / 2)
    const panel = new Panel(this, px, py, w, h, { title: event.title.toUpperCase() })
    dyn.add(panel)
    body.setPosition(24, panel.contentTop + 14)
    panel.add(body)

    // Pre-combat encounters always name who you ran into and that they are hostile.
    if (hasContact) {
      this.renderEnemyContact(panel, event, 24, panel.contentTop + 14 + body.height + 12, w - 48)
    }

    let y = py + panel.contentTop + 14 + body.height + contactH + 26 + 24
    event.choices.forEach((choice, idx) => {
      dyn.add(
        new Button(this, GAME_WIDTH / 2, y, choice.label, () => {
          if (this.busy) return
          this.busy = true
          getNet().socket.emit('run:event_choice', idx)
        }, { width: w - 80, height: 48, fontSize: 15 }),
      )
      y += 62
    })
  }

  /** Pre-combat contact card: enemy ship icon, name + class, and a HOSTIL badge. */
  private renderEnemyContact(
    panel: Panel,
    event: { enemyName?: string; enemyClass?: string },
    x: number,
    y: number,
    w: number,
  ): void {
    const h = 44
    const g = this.add.graphics()
    g.fillStyle(COLORS.danger, 0.1)
    g.fillRoundedRect(x, y, w, h, 6)
    g.lineStyle(1.2, COLORS.danger, 0.55)
    g.strokeRoundedRect(x, y, w, h, 6)
    drawHullIcon(g, x + 24, y + h / 2, 22, COLORS.danger)
    panel.add(g)
    panel.add(
      this.add.text(x + 48, y + 7, event.enemyName ?? 'Nave hostil', textStyle('title', 16, COLORS.text)),
    )
    panel.add(
      this.add.text(
        x + 48,
        y + 26,
        `Clase: ${event.enemyClass ?? 'desconocida'}`,
        textStyle('body', 12, COLORS.textDim),
      ),
    )
    const bw = 96
    const bx = x + w - bw - 10
    const bg = this.add.graphics()
    bg.fillStyle(COLORS.danger, 0.18)
    bg.fillRoundedRect(bx, y + h / 2 - 12, bw, 24, 5)
    bg.lineStyle(1.2, COLORS.danger, 0.9)
    bg.strokeRoundedRect(bx, y + h / 2 - 12, bw, 24, 5)
    panel.add(bg)
    panel.add(
      this.add.text(bx + bw / 2, y + h / 2, '⚠ HOSTIL', textStyle('title', 13, COLORS.danger)).setOrigin(0.5),
    )
  }

  /** Pill badges for the resource changes of a resolved event (green gain / red loss). */
  private renderDeltaBadges(
    panel: Panel,
    delta: { scrap: number; hull: number; ammo: number },
    x: number,
    y: number,
  ): void {
    let bx = x
    const badge = (
      value: number,
      label: string,
      drawIcon: (g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: number, color: number) => void,
    ): void => {
      if (value === 0) return
      const color = value > 0 ? COLORS.ok : COLORS.danger
      const t = this.add
        .text(bx + 32, y + 14, `${value > 0 ? '+' : '−'}${Math.abs(value)} ${label}`, textStyle('title', 15, color))
        .setOrigin(0, 0.5)
      const bw = t.width + 44
      const g = this.add.graphics()
      g.fillStyle(color, 0.16)
      g.fillRoundedRect(bx, y, bw, 28, 6)
      g.lineStyle(1.3, color, 0.85)
      g.strokeRoundedRect(bx, y, bw, 28, 6)
      drawIcon(g, bx + 16, y + 14, 16, color)
      panel.add(g)
      panel.add(t)
      bx += bw + 12
    }
    badge(delta.scrap, 'CHATARRA', drawScrapIcon)
    badge(delta.hull, 'CASCO', drawHullIcon)
    badge(delta.ammo, 'MUNICIÓN', (g, cx, cy, s, color) => drawMissileIcon(g, cx, cy, s, color, false))
  }
}
