// Loadout selection: ship, weapons (8-point budget), defense module, drones,
// crew classes. Live validation via shared validateLoadout. In Duel mode the
// "Equilibrado" preset is preloaded and a countdown auto-submits on expiry.
//
// Weapon list interaction: LEFT click adds one copy, RIGHT click removes one.
// Changing ship keeps the current selection but trims weapons to the new
// slot count (so ships can be compared without losing choices).

import Phaser from 'phaser'
import {
  CREW_CLASSES,
  CREW_CLASS_IDS,
  DEFENSE_MODULES,
  DEFENSE_MODULE_IDS,
  DRONES,
  DRONE_IDS,
  LOADOUT_PRESETS,
  MAX_DRONES_EQUIPPED,
  PLAYABLE_SHIP_IDS,
  SHIPS,
  WEAPON_BUDGET_POINTS,
  WEAPON_IDS,
  WEAPONS,
  validateLoadout,
} from '@stellar/shared'
import type { CrewClassId, Loadout, ShipClassId, WeaponId } from '@stellar/shared'
import { COLORS, GAME_HEIGHT, GAME_WIDTH, catColor } from '../theme'
import type { LoadoutSceneData } from '../contracts'
import { Button } from '../ui/button'
import { Panel } from '../ui/panel'
import { ProgressBar } from '../ui/progressbar'
import { Tooltip } from '../ui/tooltip'
import { Toast } from '../ui/toast'
import {
  addText,
  CATEGORY_NAMES_ES,
  drawCategoryIcon,
  drawDifficultyBadge,
  drawShipLayoutPreview,
  menuChrome,
  textStyle,
} from '../ui/helpers'
import { getNet, scOn } from '../net/socket'
import { getAudio } from '../audio/engine'

function defaultLoadout(ship: ShipClassId): Loadout {
  if (ship !== 'hegemon') {
    const preset = LOADOUT_PRESETS[ship][0]
    if (preset) return structuredClone(preset.loadout)
  }
  return {
    ship,
    weapons: ['laser_light'],
    defenseModule: 'mod_shields_std',
    drones: [],
    crew: ['pilot', 'engineer', 'gunner', 'medic'],
  }
}

export class LoadoutScene extends Phaser.Scene {
  private mode: 'expedition' | 'duel' = 'expedition'
  private timeoutSec: number | null = null
  private loadout: Loadout = defaultLoadout('sentinel')
  private dyn: Phaser.GameObjects.Container | null = null
  private budgetBar: ProgressBar | null = null
  private budgetText: Phaser.GameObjects.Text | null = null
  private countdownText: Phaser.GameObjects.Text | null = null
  private queued = false
  private queueOverlay: Phaser.GameObjects.Container | null = null
  private queueStatus: Phaser.GameObjects.Text | null = null
  private npcButton: Button | null = null
  private countdownLeft = 0

  constructor() {
    super('Loadout')
  }

  init(data: Partial<LoadoutSceneData>): void {
    this.mode = data.mode ?? 'expedition'
    this.timeoutSec = data.timeoutSec ?? null
    this.loadout = defaultLoadout('sentinel')
    this.queued = false
    this.queueOverlay = null
    this.queueStatus = null
    this.npcButton = null
    this.dyn = null
    this.budgetBar = null
    this.budgetText = null
    this.countdownText = null
  }

  create(): void {
    menuChrome(this)
    getAudio().music('menu')

    addText(
      this,
      20,
      14,
      this.mode === 'duel' ? 'LOADOUT — DUELO PVP' : 'LOADOUT — EXPEDICIÓN',
      'title',
      24,
    )

    this.budgetText = addText(this, 700, 22, '', 'body', 16).setOrigin(0, 0.5)
    this.budgetBar = new ProgressBar(this, 880, 14, 180, 16)

    if (this.timeoutSec !== null) {
      this.countdownLeft = this.timeoutSec
      this.countdownText = addText(this, 1075, 22, '', 'body', 15, COLORS.warn).setOrigin(0, 0.5)
      this.time.addEvent({
        delay: 1000,
        loop: true,
        callback: () => {
          this.tickCountdown()
        },
      })
    }

    new Button(this, 1205, 24, 'VOLVER', () => {
      getNet().socket.emit('queue:leave')
      this.scene.start('MainMenu')
    }, { width: 120, height: 36, fontSize: 14, variant: 'ghost' })

    scOn(this, 'queue:waiting', (seconds: number, npcOffer: boolean) => {
      this.onQueueWaiting(seconds, npcOffer)
    })

    this.render()
  }

  // ------------------------------------------------------------------ render

  private render(): void {
    if (this.dyn) this.dyn.destroy()
    const dyn = this.add.container(0, 0)
    this.dyn = dyn

    this.renderShips(dyn)
    this.renderWeapons(dyn)
    this.renderDrones(dyn)
    this.renderModules(dyn)
    this.renderCrew(dyn)
    this.renderFooter(dyn)
    this.refreshBudget()
  }

  private refreshBudget(): void {
    const v = validateLoadout(this.loadout)
    if (this.budgetText && this.budgetText.active) {
      this.budgetText.setText(`Presupuesto: ${v.points}/${WEAPON_BUDGET_POINTS} puntos`)
      this.budgetText.setColor(
        v.points > WEAPON_BUDGET_POINTS ? '#ff5c57' : '#cfe8ef',
      )
    }
    if (this.budgetBar) {
      this.budgetBar.setValue(v.points / WEAPON_BUDGET_POINTS)
      this.budgetBar.setColor(
        v.points > WEAPON_BUDGET_POINTS
          ? COLORS.danger
          : v.points === WEAPON_BUDGET_POINTS
            ? COLORS.warn
            : COLORS.panelBorder,
      )
    }
  }

  private renderShips(dyn: Phaser.GameObjects.Container): void {
    const panel = new Panel(this, 12, 50, 300, 396, { title: 'NAVE' })
    dyn.add(panel)
    let y = panel.contentTop + 2
    for (const id of PLAYABLE_SHIP_IDS) {
      const ship = SHIPS[id]
      const selected = this.loadout.ship === id
      const card = this.add.container(22, 50 + y)
      const bg = this.add.graphics()
      bg.fillStyle(selected ? 0x16243a : COLORS.spaceLight, selected ? 1 : 0.6)
      bg.fillRoundedRect(0, 0, 280, 112, 6)
      bg.lineStyle(selected ? 2 : 1, selected ? COLORS.panelBorder : COLORS.textDim, selected ? 1 : 0.5)
      bg.strokeRoundedRect(0, 0, 280, 112, 6)
      card.add(bg)
      card.add(this.add.text(10, 8, ship.name, textStyle('title', 16)))
      card.add(drawDifficultyBadge(this, 16, 38, ship.difficulty))
      card.add(
        this.add.text(
          10,
          52,
          `Casco ${ship.hullMax} · Reactor ${ship.reactor} · Armas ${ship.weaponSlots}`,
          textStyle('body', 12, COLORS.textDim),
        ),
      )
      const trait =
        id === 'sentinel'
          ? 'Rasgo: sin extremos, costes estándar.'
          : id === 'vanguard'
            ? 'Rasgo: mejoras de armas −25%.'
            : 'Rasgo: +3 casco, reactor −25%.'
      card.add(this.add.text(10, 72, trait, { ...textStyle('body', 12, COLORS.ok), wordWrap: { width: 180 } }))
      card.add(drawShipLayoutPreview(this, 232, 78, ship.layout, 11))

      const hit = this.add.zone(140, 56, 280, 112).setInteractive({ useHandCursor: true })
      hit.on('pointerover', () => getAudio().play('hover'))
      hit.on('pointerdown', () => {
        if (this.queued) return
        getAudio().play('click')
        this.selectShip(id)
      })
      card.add(hit)
      Tooltip.attach(hit, () => ship.desc)
      dyn.add(card)
      y += 118
    }
  }

  private selectShip(id: ShipClassId): void {
    if (this.loadout.ship === id) return
    this.loadout.ship = id
    const slots = SHIPS[id].weaponSlots
    if (this.loadout.weapons.length > slots) this.loadout.weapons.length = slots
    this.render()
  }

  private renderWeapons(dyn: Phaser.GameObjects.Container): void {
    const panel = new Panel(this, 322, 50, 360, 506, { title: 'ARMAS — clic añade · clic dcho. quita' })
    dyn.add(panel)
    const ship = SHIPS[this.loadout.ship]
    let y = panel.contentTop + 2
    for (const wid of WEAPON_IDS) {
      const w = WEAPONS[wid]
      const count = this.loadout.weapons.filter((x) => x === wid).length
      const row = this.add.container(332, 50 + y)
      const bg = this.add.graphics()
      bg.fillStyle(count > 0 ? 0x16304a : COLORS.spaceLight, count > 0 ? 0.95 : 0.45)
      bg.fillRoundedRect(0, 0, 340, 42, 4)
      bg.lineStyle(count > 0 ? 1.5 : 1, count > 0 ? catColor(w.category) : COLORS.textDim, count > 0 ? 1 : 0.4)
      bg.strokeRoundedRect(0, 0, 340, 42, 4)
      row.add(bg)
      row.add(drawCategoryIcon(this, 18, 21, w.category, 16))
      row.add(this.add.text(34, 5, w.name, textStyle('body', 14)))
      row.add(
        this.add.text(
          34,
          23,
          `${w.points} pts · ${w.power}⚡ · daño ${w.damage}${w.shots > 1 ? `×${w.shots}` : ''} · ${w.cooldown}s`,
          textStyle('body', 11, COLORS.textDim),
        ),
      )
      if (count > 0) {
        row.add(
          this.add.text(318, 21, `×${count}`, textStyle('title', 14, COLORS.panelBorder)).setOrigin(0.5),
        )
      }
      const hit = this.add.zone(170, 21, 340, 42).setInteractive({ useHandCursor: true })
      hit.on('pointerover', () => getAudio().play('hover'))
      hit.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (this.queued) return
        if (pointer.rightButtonDown()) this.removeWeapon(wid)
        else this.addWeapon(wid)
      })
      Tooltip.attach(hit, () => {
        const ammo = w.usesAmmo ? ' · usa munición' : ''
        return `${w.name} — ${CATEGORY_NAMES_ES[w.category]}${ammo}\n${w.desc}`
      })
      row.add(hit)
      dyn.add(row)
      y += 45
    }

    dyn.add(
      this.add
        .text(502, 50 + y + 4, `Soportes usados: ${this.loadout.weapons.length}/${ship.weaponSlots}`, textStyle('body', 13))
        .setOrigin(0.5, 0),
    )

    // Power warning: equipping more weapon energy than the initial weapons level.
    const v = validateLoadout(this.loadout)
    if (v.weaponPowerNeeded > v.weaponPowerAvailable) {
      const warn = this.add.container(332, 50 + y + 22)
      const g = this.add.graphics()
      g.lineStyle(2, COLORS.warn, 1)
      g.strokeTriangleShape(new Phaser.Geom.Triangle(0, 14, 16, 14, 8, 0))
      warn.add(g)
      warn.add(this.add.text(8, 4, '!', textStyle('body', 10, COLORS.warn)).setOrigin(0.5, 0))
      warn.add(
        this.add.text(
          24,
          -1,
          `No podrás alimentar todas las armas al inicio (necesitas\n${v.weaponPowerNeeded} de energía y el sistema de armas empieza a nivel ${v.weaponPowerAvailable}).`,
          textStyle('body', 12, COLORS.warn),
        ),
      )
      dyn.add(warn)
    }
  }

  private addWeapon(wid: WeaponId): void {
    const ship = SHIPS[this.loadout.ship]
    const w = WEAPONS[wid]
    const v = validateLoadout(this.loadout)
    if (this.loadout.weapons.length >= ship.weaponSlots) {
      Toast.show(`No quedan soportes de arma (máx ${ship.weaponSlots}).`, 'warn')
      return
    }
    if (v.points + w.points > WEAPON_BUDGET_POINTS) {
      Toast.show('Presupuesto de 8 puntos excedido.', 'warn')
      return
    }
    getAudio().play('click')
    this.loadout.weapons.push(wid)
    this.render()
  }

  private removeWeapon(wid: WeaponId): void {
    const idx = this.loadout.weapons.indexOf(wid)
    if (idx < 0) return
    getAudio().play('click')
    this.loadout.weapons.splice(idx, 1)
    this.render()
  }

  private renderDrones(dyn: Phaser.GameObjects.Container): void {
    const panel = new Panel(this, 322, 562, 360, 146, {
      title: `DRONES — máx ${MAX_DRONES_EQUIPPED}, sin duplicados`,
    })
    dyn.add(panel)
    let y = panel.contentTop + 2
    for (const did of DRONE_IDS) {
      const d = DRONES[did]
      const equipped = this.loadout.drones.includes(did)
      const row = this.add.container(332, 562 + y)
      const bg = this.add.graphics()
      bg.fillStyle(equipped ? 0x16304a : COLORS.spaceLight, equipped ? 0.95 : 0.45)
      bg.fillRoundedRect(0, 0, 340, 30, 4)
      bg.lineStyle(equipped ? 1.5 : 1, equipped ? COLORS.panelBorder : COLORS.textDim, equipped ? 1 : 0.4)
      bg.strokeRoundedRect(0, 0, 340, 30, 4)
      row.add(bg)
      row.add(this.add.text(10, 15, `${equipped ? '[x] ' : '[ ] '}${d.name}`, textStyle('body', 13)).setOrigin(0, 0.5))
      row.add(
        this.add
          .text(330, 15, `${d.points} pt · ${d.power}⚡`, textStyle('body', 12, COLORS.textDim))
          .setOrigin(1, 0.5),
      )
      const hit = this.add.zone(170, 15, 340, 30).setInteractive({ useHandCursor: true })
      hit.on('pointerover', () => getAudio().play('hover'))
      hit.on('pointerdown', () => {
        if (this.queued) return
        this.toggleDrone(did)
      })
      Tooltip.attach(hit, () => d.desc)
      row.add(hit)
      dyn.add(row)
      y += 34
    }
  }

  private toggleDrone(did: (typeof DRONE_IDS)[number]): void {
    const idx = this.loadout.drones.indexOf(did)
    if (idx >= 0) {
      this.loadout.drones.splice(idx, 1)
    } else {
      if (this.loadout.drones.length >= MAX_DRONES_EQUIPPED) {
        Toast.show(`Máximo ${MAX_DRONES_EQUIPPED} drones equipados.`, 'warn')
        return
      }
      const v = validateLoadout(this.loadout)
      const d = DRONES[did]
      if (v.points + d.points > WEAPON_BUDGET_POINTS) {
        Toast.show('Presupuesto de 8 puntos excedido.', 'warn')
        return
      }
      this.loadout.drones.push(did)
    }
    getAudio().play('click')
    this.render()
  }

  private renderModules(dyn: Phaser.GameObjects.Container): void {
    const panel = new Panel(this, 692, 50, 576, 250, { title: 'MÓDULO DE DEFENSA' })
    dyn.add(panel)
    let y = panel.contentTop + 2
    for (const mid of DEFENSE_MODULE_IDS) {
      const m = DEFENSE_MODULES[mid]
      const selected = this.loadout.defenseModule === mid
      const row = this.add.container(702, 50 + y)
      const bg = this.add.graphics()
      bg.fillStyle(selected ? 0x16304a : COLORS.spaceLight, selected ? 0.95 : 0.45)
      bg.fillRoundedRect(0, 0, 556, 46, 4)
      bg.lineStyle(selected ? 2 : 1, selected ? COLORS.panelBorder : COLORS.textDim, selected ? 1 : 0.4)
      bg.strokeRoundedRect(0, 0, 556, 46, 4)
      row.add(bg)
      row.add(this.add.text(10, 6, m.name, textStyle('body', 14, selected ? COLORS.panelBorder : COLORS.text)))
      row.add(this.add.text(10, 26, m.desc, textStyle('body', 11, COLORS.textDim)))
      row.add(this.add.text(546, 26, m.tradeoff, textStyle('body', 11, COLORS.warn)).setOrigin(1, 0))
      const hit = this.add.zone(278, 23, 556, 46).setInteractive({ useHandCursor: true })
      hit.on('pointerover', () => getAudio().play('hover'))
      hit.on('pointerdown', () => {
        if (this.queued) return
        getAudio().play('click')
        this.loadout.defenseModule = mid
        this.render()
      })
      Tooltip.attach(hit, () => `${m.desc}\nContrapartida: ${m.tradeoff}`)
      row.add(hit)
      dyn.add(row)
      y += 52
    }
  }

  private renderCrew(dyn: Phaser.GameObjects.Container): void {
    const panel = new Panel(this, 692, 310, 576, 246, { title: 'TRIPULACIÓN — 4 especialistas' })
    dyn.add(panel)
    const baseY = 310 + panel.contentTop + 4
    for (let i = 0; i < 4; i++) {
      const cls = this.loadout.crew[i] ?? 'pilot'
      const def = CREW_CLASSES[cls]
      const rowY = baseY + i * 50
      const row = this.add.container(702, rowY)
      const bg = this.add.graphics()
      bg.fillStyle(COLORS.spaceLight, 0.5)
      bg.fillRoundedRect(0, 0, 556, 44, 4)
      bg.lineStyle(1, COLORS.textDim, 0.4)
      bg.strokeRoundedRect(0, 0, 556, 44, 4)
      row.add(bg)
      row.add(this.add.text(10, 22, `Puesto ${i + 1}`, textStyle('body', 12, COLORS.textDim)).setOrigin(0, 0.5))

      const prev = this.add
        .text(120, 22, '<', textStyle('title', 20, COLORS.panelBorder))
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
      prev.on('pointerdown', () => {
        if (this.queued) return
        this.cycleCrew(i, -1)
      })
      const next = this.add
        .text(330, 22, '>', textStyle('title', 20, COLORS.panelBorder))
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
      next.on('pointerdown', () => {
        if (this.queued) return
        this.cycleCrew(i, 1)
      })
      const name = this.add.text(225, 22, def.name, textStyle('title', 15)).setOrigin(0.5)
      Tooltip.attach(name.setInteractive(), () => def.desc)
      row.add([prev, next, name])
      row.add(this.add.text(360, 22, def.desc, { ...textStyle('body', 11, COLORS.textDim), wordWrap: { width: 190 } }).setOrigin(0, 0.5))
      dyn.add(row)
    }
  }

  private cycleCrew(slot: number, dir: 1 | -1): void {
    const current = this.loadout.crew[slot] ?? 'pilot'
    const idx = CREW_CLASS_IDS.indexOf(current)
    const nextIdx = (idx + dir + CREW_CLASS_IDS.length) % CREW_CLASS_IDS.length
    const next: CrewClassId = CREW_CLASS_IDS[nextIdx] ?? 'pilot'
    this.loadout.crew[slot] = next
    getAudio().play('click')
    this.render()
  }

  private renderFooter(dyn: Phaser.GameObjects.Container): void {
    const panel = new Panel(this, 692, 566, 576, 142, { title: 'PRESETS Y CONFIRMACIÓN' })
    dyn.add(panel)
    const ship = this.loadout.ship
    const presets = ship !== 'hegemon' ? LOADOUT_PRESETS[ship] : []
    let px = 712
    for (const preset of presets) {
      dyn.add(
        new Button(this, px + 85, 626, preset.name.toUpperCase(), () => {
          if (this.queued) return
          this.loadout = structuredClone(preset.loadout)
          this.render()
        }, { width: 170, height: 40, fontSize: 14, variant: 'ghost' }),
      )
      px += 184
    }

    const v = validateLoadout(this.loadout)
    const statusMsg = v.ok ? 'Loadout válido. ¡Todo listo!' : (v.errors[0] ?? 'Loadout no válido.')
    dyn.add(
      this.add.text(712, 660, v.ok ? `· ${statusMsg}` : `! ${statusMsg}`, {
        ...textStyle('body', 13, v.ok ? COLORS.ok : COLORS.danger),
        wordWrap: { width: 340 },
      }),
    )

    const ready = new Button(this, 1175, 648, 'LISTO', () => {
      this.submit()
    }, { width: 160, height: 56, fontSize: 20 })
    ready.setDisabled(!v.ok, statusMsg)
    dyn.add(ready)
  }

  // --------------------------------------------------------------- countdown

  private tickCountdown(): void {
    if (this.queued || this.timeoutSec === null) return
    this.countdownLeft -= 1
    if (this.countdownText && this.countdownText.active) {
      this.countdownText.setText(`Auto-envío en ${Math.max(0, this.countdownLeft)}s`)
    }
    if (this.countdownLeft <= 0) {
      // Expiry always submits something valid: fall back to the preset.
      const v = validateLoadout(this.loadout)
      if (!v.ok) this.loadout = defaultLoadout(this.loadout.ship)
      this.submit()
    }
  }

  // ------------------------------------------------------------------ submit

  private submit(): void {
    if (this.queued) return
    const v = validateLoadout(this.loadout)
    if (!v.ok) {
      Toast.show(v.errors[0] ?? 'Loadout no válido.', 'error')
      return
    }
    this.queued = true
    getNet().socket.emit('queue:join', this.mode, this.loadout)
    this.openQueueOverlay()
    // Expedition: the server replies with run:state (global routing navigates
    // to SectorMap) or battle:start. Duel: queue:waiting updates the overlay.
  }

  private openQueueOverlay(): void {
    const c = this.add.container(0, 0).setDepth(5000)
    c.add(
      this.add
        .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.65)
        .setInteractive(),
    )
    const panel = new Panel(this, GAME_WIDTH / 2 - 230, GAME_HEIGHT / 2 - 120, 460, 240, {
      title: this.mode === 'duel' ? 'BUSCANDO RIVAL' : 'PREPARANDO EXPEDICIÓN',
    })
    c.add(panel)
    this.queueStatus = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, this.mode === 'duel' ? 'Buscando rival…' : 'Generando sector…', textStyle('body', 17))
      .setOrigin(0.5)
    c.add(this.queueStatus)
    this.tweens.add({ targets: this.queueStatus, alpha: 0.4, duration: 600, yoyo: true, repeat: -1 })

    if (this.mode === 'duel') {
      this.npcButton = new Button(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 10, 'COMBATIR CONTRA IA', () => {
        getNet().socket.emit('queue:accept_npc')
        if (this.npcButton) this.npcButton.setDisabled(true, 'Preparando combate…')
      }, { width: 280, height: 46, fontSize: 15 })
      this.npcButton.setVisible(false)
      c.add(this.npcButton)
    }

    c.add(
      new Button(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 75, 'CANCELAR', () => {
        getNet().socket.emit('queue:leave')
        this.queued = false
        c.destroy()
        this.queueOverlay = null
        this.npcButton = null
        this.queueStatus = null
        this.render()
      }, { width: 200, height: 40, fontSize: 14, variant: 'ghost' }),
    )
    this.queueOverlay = c
  }

  private onQueueWaiting(seconds: number, npcOfferAvailable: boolean): void {
    if (!this.queued || !this.queueOverlay) return
    if (this.queueStatus && this.queueStatus.active) {
      this.queueStatus.setText(`Buscando rival… (${seconds}s)`)
    }
    if (npcOfferAvailable && this.npcButton && !this.npcButton.visible) {
      this.npcButton.setVisible(true)
    }
  }
}
