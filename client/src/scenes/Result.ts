// Result scene: battle outcome (VICTORIA / DERROTA / HUIDA), both sides'
// stats, expedition summary on run end, contextual buttons.
//
// Buttons: expedition with the run still alive (victory, or a flee that kept
// the ship) -> CONTINUAR to the Upgrade screen (repairs are useful even after
// fleeing). Anything else (defeat, duel, run over) -> MENÚ PRINCIPAL.

import Phaser from 'phaser'
import type { BattleResult, BattleResultStats, Side } from '@stellar/shared'
import { COLORS, GAME_HEIGHT, GAME_WIDTH } from '../theme'
import type { ResultSceneData } from '../contracts'
import { Button } from '../ui/button'
import { Panel } from '../ui/panel'
import { drawScrapIcon } from '../battle/icons'
import { addText, formatDuration, menuChrome, textStyle } from '../ui/helpers'
import { getState } from '../state'
import { getNet } from '../net/socket'
import { getAudio } from '../audio/engine'
import { fadeInScene, goToScene } from '../ui/transition'

type Verdict = 'victory' | 'defeat' | 'fled'

export class ResultScene extends Phaser.Scene {
  private result: BattleResult | null = null
  private yourSide: Side = 'a'
  private mode: 'expedition' | 'duel' = 'duel'
  private continuing = false

  constructor() {
    super('Result')
  }

  init(data: Partial<ResultSceneData>): void {
    const state = getState()
    this.result = data.result ?? state.lastResult
    this.yourSide = data.yourSide ?? state.lastResultSide ?? 'a'
    // Result only distinguishes expedition vs duel; tutorial never reaches here.
    this.mode = data.mode ?? (state.mode === 'expedition' ? 'expedition' : 'duel')
  }

  create(): void {
    this.continuing = false
    menuChrome(this)
    getAudio().music('menu')
    const result = this.result
    if (!result) {
      // Defensive bail (no battle result to show): instant error recovery.
      this.scene.start('MainMenu')
      return
    }

    const youWon = result.winner === this.yourSide
    const verdict: Verdict = youWon ? 'victory' : result.reason === 'fled' ? 'fled' : 'defeat'
    getAudio().play(verdict === 'victory' ? 'victory' : verdict === 'fled' ? 'jump' : 'defeat')

    const spec =
      verdict === 'victory'
        ? { text: 'VICTORIA', color: COLORS.ok }
        : verdict === 'fled'
          ? { text: 'HUIDA', color: COLORS.warn }
          : { text: 'DERROTA', color: COLORS.danger }

    this.drawVerdictIcon(GAME_WIDTH / 2 - 220, 110, verdict, spec.color)
    const title = addText(this, GAME_WIDTH / 2 + 20, 110, spec.text, 'title', 56, spec.color)
      .setOrigin(0.5)
    title.setShadow(0, 0, `#${spec.color.toString(16).padStart(6, '0')}`, 16, true, true)
    addText(this, GAME_WIDTH / 2, 165, this.subtitle(result, youWon), 'body', 17, COLORS.textDim)
      .setOrigin(0.5)

    this.renderStats(result)
    this.renderRunSummary(verdict)
    this.renderButtons(verdict)

    fadeInScene(this)
  }

  private subtitle(result: BattleResult, youWon: boolean): string {
    switch (result.reason) {
      case 'destroyed':
        return youWon ? 'Nave enemiga destruida.' : 'Tu nave ha sido destruida.'
      case 'crew_dead':
        return youWon ? 'La tripulación enemiga ha caído.' : 'Has perdido a toda la tripulación.'
      case 'fled':
        return youWon
          ? 'El enemigo ha huido del combate.'
          : 'Has saltado a salvo… pero pierdes el botín del nodo.'
      case 'surrender':
        return youWon ? 'El rival se ha rendido.' : 'Te has rendido.'
      case 'disconnect':
        return youWon ? 'El rival se ha desconectado.' : 'Desconexión del combate.'
      case 'jumped':
        // Beacons never reach the Result screen, but keep the switch exhaustive.
        return 'Salto realizado.'
    }
  }

  private drawVerdictIcon(x: number, y: number, verdict: Verdict, color: number): void {
    const g = this.add.graphics({ x, y })
    g.lineStyle(3, color, 1)
    if (verdict === 'victory') {
      // Five-point star.
      const pts: Phaser.Math.Vector2[] = []
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 26 : 11
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        pts.push(new Phaser.Math.Vector2(Math.cos(a) * r, Math.sin(a) * r))
      }
      g.fillStyle(color, 0.25)
      g.fillPoints(pts, true)
      g.strokePoints(pts, true)
    } else if (verdict === 'fled') {
      // Double chevron (jump away).
      g.beginPath()
      g.moveTo(-18, -16)
      g.lineTo(0, 0)
      g.lineTo(-18, 16)
      g.strokePath()
      g.beginPath()
      g.moveTo(2, -16)
      g.lineTo(20, 0)
      g.lineTo(2, 16)
      g.strokePath()
    } else {
      // Cracked hull: X inside a broken ring.
      g.strokeCircle(0, 0, 24)
      g.lineStyle(4, color, 1)
      g.lineBetween(-12, -12, 12, 12)
      g.lineBetween(-12, 12, 12, -12)
    }
  }

  private renderStats(result: BattleResult): void {
    const you: BattleResultStats = result.stats[this.yourSide]
    const other: Side = this.yourSide === 'a' ? 'b' : 'a'
    const enemy: BattleResultStats = result.stats[other]

    const w = 620
    const panel = new Panel(this, (GAME_WIDTH - w) / 2, 200, w, 270, { title: 'INFORME DE COMBATE' })
    const rows: { label: string; you: string; enemy: string }[] = [
      { label: 'Daño infligido', you: `${Math.round(you.damageDealt)}`, enemy: `${Math.round(enemy.damageDealt)}` },
      { label: 'Daño recibido', you: `${Math.round(you.damageTaken)}`, enemy: `${Math.round(enemy.damageTaken)}` },
      { label: 'Precisión', you: pct(you.shotsHit, you.shotsFired), enemy: pct(enemy.shotsHit, enemy.shotsFired) },
      { label: 'Sistemas destruidos', you: `${you.systemsDestroyed}`, enemy: `${enemy.systemsDestroyed}` },
      { label: 'Bajas de tripulación', you: `${you.crewLost}`, enemy: `${enemy.crewLost}` },
      { label: 'Duración', you: formatDuration(you.durationSec), enemy: '—' },
    ]
    panel.add(this.add.text(330, panel.contentTop, 'TÚ', textStyle('title', 14, COLORS.panelBorder)).setOrigin(0.5, 0))
    panel.add(this.add.text(490, panel.contentTop, 'RIVAL', textStyle('title', 14, COLORS.danger)).setOrigin(0.5, 0))
    let y = panel.contentTop + 28
    for (const row of rows) {
      panel.add(this.add.text(24, y, row.label, textStyle('body', 15, COLORS.textDim)))
      panel.add(this.add.text(330, y, row.you, textStyle('body', 15)).setOrigin(0.5, 0))
      panel.add(this.add.text(490, y, row.enemy, textStyle('body', 15)).setOrigin(0.5, 0))
      y += 30
    }
  }

  private renderRunSummary(verdict: Verdict): void {
    if (this.mode !== 'expedition') return
    const state = getState()
    const over = state.runOver
    const run = state.run

    const column = over?.column ?? run?.column ?? 0
    const totalScrap = Math.round(over?.scrap ?? run?.scrap ?? 0)
    // Scrap looted in the fight just won (defeat/flee earn none).
    const gained =
      verdict === 'victory' && run ? Math.max(0, Math.round(run.scrap - state.scrapAtBattleStart)) : 0

    const w = 620
    const panel = new Panel(this, (GAME_WIDTH - w) / 2, 466, w, 106, {
      title:
        over?.victory === true
          ? 'EXPEDICIÓN COMPLETADA'
          : verdict === 'victory'
            ? 'BOTÍN'
            : 'RESUMEN DE LA EXPEDICIÓN',
    })

    // Headline scrap line, always with the chatarra icon.
    const top = panel.contentTop + 12
    const g = this.add.graphics()
    drawScrapIcon(g, 38, top + 11, 24, COLORS.warn)
    panel.add(g)
    if (gained > 0) {
      const plus = this.add.text(60, top, `+${gained}`, textStyle('title', 24, COLORS.ok))
      panel.add(plus)
      panel.add(
        this.add.text(64 + plus.width, top + 7, 'CHATARRA RECUPERADA', textStyle('body', 14, COLORS.textDim)),
      )
    } else {
      const tot = this.add.text(60, top, `${totalScrap}`, textStyle('title', 24, COLORS.warn))
      panel.add(tot)
      panel.add(this.add.text(64 + tot.width, top + 7, 'CHATARRA', textStyle('body', 14, COLORS.textDim)))
    }
    panel.add(
      this.add.text(
        24,
        top + 42,
        gained > 0
          ? `Columna ${column}/8 · Chatarra total: ${totalScrap}`
          : `Columna alcanzada: ${column}/8`,
        textStyle('body', 14, COLORS.textDim),
      ),
    )
  }

  private renderButtons(verdict: Verdict): void {
    const state = getState()
    const runAlive =
      this.mode === 'expedition' && state.runOver === null && state.run !== null && state.run.alive
    if (runAlive && verdict !== 'defeat') {
      // Continue → the server drops the ship at a beacon (repairs/upgrades/loot
      // live there now); battle:start routes us in. No local navigation.
      new Button(this, GAME_WIDTH / 2, GAME_HEIGHT - 70, 'CONTINUAR', () => {
        if (this.continuing) return
        this.continuing = true
        getNet().socket.emit('run:continue')
      }, { width: 280, height: 54 })
    } else {
      new Button(this, GAME_WIDTH / 2, GAME_HEIGHT - 70, 'MENÚ PRINCIPAL', () => {
        goToScene(this, 'MainMenu')
      }, { width: 280, height: 54 })
    }
  }
}

function pct(hits: number, shots: number): string {
  if (shots <= 0) return '—'
  return `${Math.round((hits / shots) * 100)}%`
}
