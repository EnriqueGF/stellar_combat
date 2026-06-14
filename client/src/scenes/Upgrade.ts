// Upgrade scene (after each won expedition battle): loot summary + scrap
// spending. Purchases emit run:buy and the server's run:state refreshes this
// scene in place (see net/socket.ts navigation map). CONTINUAR emits
// run:continue and navigates locally to SectorMap (the follow-up run:state
// then refreshes the map).
//
// Loot weapon install: the server puts it into a free weapon slot or, if all
// slots are full, replaces the first slot (documented MVP simplification).

import Phaser from 'phaser'
import {
  MAX_AMMO,
  REACTOR_MAX,
  SYSTEM_MAX_LEVEL,
  WEAPONS,
} from '@stellar/shared'
import type { SystemId, UpgradeItem } from '@stellar/shared'
import { COLORS, GAME_HEIGHT, GAME_WIDTH } from '../theme'
import { Button } from '../ui/button'
import { Panel } from '../ui/panel'
import { installRunEscapeMenu } from '../ui/escapeMenu'
import {
  addText,
  buildRunHeader,
  drawCategoryIcon,
  menuChrome,
  SYSTEM_NAMES_ES,
  textStyle,
} from '../ui/helpers'
import { getState } from '../state'
import { getNet, scOn } from '../net/socket'
import { getAudio } from '../audio/engine'
import { fadeInScene } from '../ui/transition'

const SYSTEM_ORDER: SystemId[] = [
  'weapons',
  'shields',
  'engines',
  'oxygen',
  'medbay',
  'cockpit',
  'drones',
]

export class UpgradeScene extends Phaser.Scene {
  private dyn: Phaser.GameObjects.Container | null = null
  private busy = false

  constructor() {
    super('Upgrade')
  }

  create(): void {
    const run = getState().run
    if (!run) {
      // Defensive bail (no live run): instant error recovery.
      this.scene.start('MainMenu')
      return
    }
    this.busy = false
    const node = run.sector.nodes.find((n) => n.id === run.currentNodeId)
    const chrome = menuChrome(this, {
      biome: node?.biome ?? 'ice',
      seed: node?.seed ?? 1,
      planet: { planetX: GAME_WIDTH * 0.88, planetY: GAME_HEIGHT * 0.25 },
    })
    installRunEscapeMenu(this, chrome.crt)
    getAudio().music('menu')

    this.render()
    scOn(this, 'run:refresh', () => {
      this.busy = false
      this.render()
    })
    // A rejected purchase replies with 'error', not run:state: clear the gate so
    // the panel never freezes (otherwise every button stays dead until you leave).
    scOn(this, 'error', () => {
      this.busy = false
    })
    fadeInScene(this)
  }

  private buy(item: UpgradeItem): void {
    if (this.busy) return
    this.busy = true
    getAudio().play('purchase')
    getNet().socket.emit('run:buy', item)
  }

  private render(): void {
    const run = getState().run
    if (!run) return
    if (this.dyn) this.dyn.destroy()
    const dyn = this.add.container(0, 0)
    this.dyn = dyn
    const state = getState()
    dyn.add(buildRunHeader(this, run))

    dyn.add(
      addText(this, GAME_WIDTH / 2, 70, 'MEJORAS Y REPARACIONES', 'title', 26, COLORS.panelBorder)
        .setOrigin(0.5),
    )

    // ----- Loot summary -------------------------------------------------
    const loot = new Panel(this, 12, 96, 396, 200, { title: 'BOTÍN DEL COMBATE' })
    dyn.add(loot)
    const scrapGain = Math.max(0, Math.round(run.scrap - state.scrapAtBattleStart))
    const ammoGain = Math.max(0, run.ammo - state.ammoAtBattleStart)
    loot.add(
      this.add.text(16, loot.contentTop + 6, `+${scrapGain} chatarra recuperada`, textStyle('body', 15, COLORS.warn)),
    )
    loot.add(
      this.add.text(16, loot.contentTop + 30, ammoGain > 0 ? `+${ammoGain} misiles` : 'Sin misiles recuperados', textStyle('body', 15, ammoGain > 0 ? COLORS.catExplosive : COLORS.textDim)),
    )
    if (run.lootWeapon !== null) {
      const def = WEAPONS[run.lootWeapon]
      loot.add(this.add.text(16, loot.contentTop + 62, 'Arma recuperada del naufragio:', textStyle('body', 13, COLORS.textDim)))
      loot.add(drawCategoryIcon(this, 26, loot.contentTop + 94, def.category, 16))
      loot.add(this.add.text(40, loot.contentTop + 86, def.name, textStyle('title', 15)))
      const install = new Button(this, 198, loot.contentTop + 134, 'INSTALAR (GRATIS)', () => {
        this.buy({ kind: 'loot_weapon' })
      }, { width: 240, height: 40, fontSize: 14 })
      install.setTooltip(() => `${def.desc}\nSi no hay soporte libre, sustituirá tu primera arma.`)
      loot.add(install)
    } else {
      loot.add(
        this.add.text(16, loot.contentTop + 70, 'Ningún arma aprovechable\nentre los restos.', textStyle('body', 13, COLORS.textDim)),
      )
    }

    // ----- Hull / ammo / reactor ----------------------------------------
    const right = new Panel(this, 12, 306, 396, 330, { title: 'NAVE' })
    dyn.add(right)
    let y = right.contentTop + 10

    right.add(this.add.text(16, y, `Reactor: ${run.reactor}/${REACTOR_MAX}`, textStyle('body', 15)))
    const reactorCost = run.upgradeCosts.reactor
    const reactorBtn = new Button(this, 320, y + 9, `+1 · ${reactorCost}`, () => {
      this.buy({ kind: 'reactor' })
    }, { width: 130, height: 32, fontSize: 13 })
    if (run.reactor >= REACTOR_MAX) reactorBtn.setDisabled(true, 'Reactor al máximo.')
    else if (run.scrap < reactorCost) reactorBtn.setDisabled(true, 'Chatarra insuficiente.')
    right.add(reactorBtn)
    y += 50

    right.add(this.add.text(16, y, `Casco: ${Math.round(run.hull)}/${run.hullMax}`, textStyle('body', 15)))
    const missing = Math.max(0, run.hullMax - Math.round(run.hull))
    const perPoint = run.upgradeCosts.repairPerPoint
    const repairOptions: { label: string; points: number }[] = [
      { label: '+1', points: 1 },
      { label: '+5', points: 5 },
      { label: 'MÁX', points: Math.min(missing, Math.floor(run.scrap / Math.max(1, perPoint))) },
    ]
    let bx = 170
    for (const opt of repairOptions) {
      const points = Math.min(opt.points, missing)
      const cost = points * perPoint
      const btn = new Button(this, bx + 45, y + 9, `${opt.label} · ${cost}`, () => {
        this.buy({ kind: 'repair', points })
      }, { width: 90, height: 32, fontSize: 12 })
      if (missing === 0) btn.setDisabled(true, 'Casco intacto.')
      else if (points <= 0 || run.scrap < cost) btn.setDisabled(true, 'Chatarra insuficiente.')
      btn.setTooltip(() => `Reparar ${points} punto(s) de casco (${perPoint}/punto).`)
      right.add(btn)
      bx += 98
    }
    y += 50

    right.add(this.add.text(16, y, `Misiles: ${run.ammo}/${MAX_AMMO}`, textStyle('body', 15)))
    const ammoCost = run.upgradeCosts.ammoPer2
    const ammoBtn = new Button(this, 320, y + 9, `+2 · ${ammoCost}`, () => {
      this.buy({ kind: 'ammo' })
    }, { width: 130, height: 32, fontSize: 13 })
    if (run.ammo >= MAX_AMMO) ammoBtn.setDisabled(true, 'Reserva de misiles llena.')
    else if (run.scrap < ammoCost) ammoBtn.setDisabled(true, 'Chatarra insuficiente.')
    right.add(ammoBtn)
    y += 56

    right.add(
      this.add.text(16, y, 'La chatarra no gastada se conserva\npara los próximos nodos.', textStyle('body', 12, COLORS.textDim)),
    )

    // ----- Systems -------------------------------------------------------
    const sys = new Panel(this, 420, 96, 848, 540, { title: 'SISTEMAS — subir nivel' })
    dyn.add(sys)
    let sy = sys.contentTop + 8
    for (const id of SYSTEM_ORDER) {
      const level = run.systems[id]
      if (level === undefined) continue
      const max = SYSTEM_MAX_LEVEL[id] ?? 8
      const cost = run.upgradeCosts.system[id]
      const row = this.add.container(436, 96 + sy)

      const bg = this.add.graphics()
      bg.fillStyle(COLORS.spaceLight, 0.5)
      bg.fillRoundedRect(0, 0, 816, 58, 5)
      bg.lineStyle(1, COLORS.textDim, 0.35)
      bg.strokeRoundedRect(0, 0, 816, 58, 5)
      row.add(bg)
      row.add(this.add.text(14, 10, SYSTEM_NAMES_ES[id], textStyle('title', 15)))
      row.add(this.add.text(14, 34, `Nivel ${level}/${max}`, textStyle('body', 12, COLORS.textDim)))

      // Level pips: filled squares up to current level.
      const pips = this.add.graphics()
      for (let i = 0; i < max; i++) {
        const px = 240 + i * 22
        if (i < level) {
          pips.fillStyle(COLORS.energy, 0.95)
          pips.fillRect(px, 21, 14, 16)
        } else {
          pips.lineStyle(1.5, COLORS.textDim, 0.7)
          pips.strokeRect(px, 21, 14, 16)
        }
      }
      row.add(pips)

      const btn = new Button(this, 740, 29, `+1 · ${cost}`, () => {
        this.buy({ kind: 'system', system: id })
      }, { width: 130, height: 36, fontSize: 13 })
      if (level >= max) btn.setDisabled(true, 'Nivel máximo alcanzado.')
      else if (run.scrap < cost) btn.setDisabled(true, 'Chatarra insuficiente.')
      btn.setTooltip(() => `Subir ${SYSTEM_NAMES_ES[id]} a nivel ${level + 1}.`)
      row.add(btn)

      dyn.add(row)
      sy += 64
    }

    // ----- Continue -------------------------------------------------------
    // Leaving drops the ship at a beacon (the server starts it on run:continue and
    // battle:start routes us there); jump from the beacon to reach the map.
    dyn.add(
      new Button(this, GAME_WIDTH / 2, GAME_HEIGHT - 46, 'CONTINUAR', () => {
        if (this.busy) return
        this.busy = true
        getNet().socket.emit('run:continue')
      }, { width: 280, height: 52 }),
    )
  }
}
