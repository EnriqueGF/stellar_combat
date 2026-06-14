// In-beacon economy panel (FTL-style). At any beacon you can repair the hull and
// upgrade the ship (reactor + systems) with scrap, and install a salvaged weapon
// for free. Consumables (missiles) and new gear are NOT sold here — those are a
// store thing: a trading-post beacon adds a PUESTO COMERCIAL section.
//
// Built to match the project's menus: titled Panels, level pips, amber accents.
// Opened as a modal over the beacon; every purchase emits run:buy and the panel
// rebuilds from the refreshed run state.

import type Phaser from 'phaser'
import {
  REACTOR_MAX,
  SYSTEM_MAX_LEVEL,
  WEAPONS,
  type CrewClassId,
  type DroneId,
  type RunStatePublic,
  type ShopOffer,
  type SystemId,
  type UpgradeItem,
  type WeaponId,
} from '@stellar/shared'
import { CREW_CLASSES, DRONES } from '@stellar/shared'
import { BACKDROP_MARGIN_X, BACKDROP_MARGIN_Y, COLORS, GAME_HEIGHT, GAME_WIDTH } from '../theme'
import { Button } from '../ui/button'
import { Panel } from '../ui/panel'
import { addText, drawCategoryIcon, SYSTEM_NAMES_ES, textStyle } from '../ui/helpers'
import { drawScrapIcon } from './icons'

const SYSTEM_ORDER: SystemId[] = [
  'weapons',
  'shields',
  'engines',
  'oxygen',
  'medbay',
  'cockpit',
  'drones',
]

const DEPTH = 11000

export interface EconomyDeps {
  getRun(): RunStatePublic | null
  onBuy(item: UpgradeItem): void
  onClose(): void
}

export interface EconomyHandle {
  refresh(): void
  close(): void
}

type G = Phaser.GameObjects.Graphics

/** Row of level pips (filled = current level). */
function drawPips(g: G, x: number, y: number, level: number, max: number): void {
  const w = 12
  const h = 14
  const gap = 4
  for (let i = 0; i < max; i++) {
    const px = x + i * (w + gap)
    if (i < level) {
      g.fillStyle(COLORS.energy, 0.95)
      g.fillRect(px, y, w, h)
    } else {
      g.lineStyle(1.5, COLORS.textDim, 0.7)
      g.strokeRect(px, y, w, h)
    }
  }
}

function offerName(offer: ShopOffer): string {
  switch (offer.kind) {
    case 'weapon':
      return WEAPONS[offer.id as WeaponId]?.name ?? 'Arma'
    case 'drone':
      return DRONES[offer.id as DroneId]?.name ?? 'Dron'
    case 'crew':
      return `Recluta: ${CREW_CLASSES[offer.id as CrewClassId]?.name ?? '—'}`
    case 'ammo':
      return `Misiles ×${offer.amount ?? 2}`
    case 'repair':
      return `Reparar +${offer.amount ?? 1}`
  }
}

/** Opens the repair/upgrade/store modal over the current scene. */
export function openEconomyModal(scene: Phaser.Scene, deps: EconomyDeps): EconomyHandle {
  const hasShop = (deps.getRun()?.shopOffers?.length ?? 0) > 0
  const W = hasShop ? 940 : 820
  const H = hasShop ? 600 : 392
  const px = (GAME_WIDTH - W) / 2
  const py = (GAME_HEIGHT - H) / 2

  const container = scene.add.container(0, 0).setDepth(DEPTH)
  container.add(
    scene.add
      .rectangle(
        GAME_WIDTH / 2,
        GAME_HEIGHT / 2,
        GAME_WIDTH + BACKDROP_MARGIN_X * 2,
        GAME_HEIGHT + BACKDROP_MARGIN_Y * 2,
        0x000000,
        0.66,
      )
      .setInteractive(),
  )

  let dyn: Phaser.GameObjects.Container | null = null
  const build = (): void => {
    if (dyn) dyn.destroy()
    dyn = scene.add.container(0, 0)
    const root = dyn
    container.add(root)
    const run = deps.getRun()
    if (!run) return

    // Heading + scrap.
    dyn.add(
      addText(scene, px + 24, py + 16, hasShop ? 'PUESTO COMERCIAL' : 'BALIZA', 'title', 22, COLORS.panelBorder),
    )
    const scrapG = scene.add.graphics()
    drawScrapIcon(scrapG, px + W - 120, py + 27, 18, COLORS.warn)
    dyn.add(scrapG)
    dyn.add(addText(scene, px + W - 104, py + 18, `${run.scrap}`, 'title', 20, COLORS.warn))

    const colW = hasShop ? 440 : 380
    const colTop = py + 50
    const colH = hasShop ? 268 : 300

    // ---- NAVE (left): reactor + loot (hull repair is a STORE service only) ----
    // Hug the content so it isn't a half-empty box next to the systems list.
    const naveH = run.lootWeapon !== null ? 180 : 104
    const nave = new Panel(scene, px + 24, colTop, colW, naveH, { title: 'NAVE' })
    dyn.add(nave)
    const g = scene.add.graphics()
    nave.add(g)
    let y = nave.contentTop + 14

    // Reactor: label + buy + a proportional bar (25 levels don't fit as pips).
    nave.add(addText(scene, 16, y, `Reactor  ${run.reactor}/${REACTOR_MAX}`, 'body', 15))
    const reactorCost = run.upgradeCosts.reactor
    const reactorBtn = new Button(scene, colW - 64, y + 8, `+1·${reactorCost}`, () => deps.onBuy({ kind: 'reactor' }), {
      width: 96,
      height: 30,
      fontSize: 12,
      variant: 'warn',
    })
    if (run.reactor >= REACTOR_MAX) reactorBtn.setDisabled(true, 'Reactor al máximo.')
    else if (run.scrap < reactorCost) reactorBtn.setDisabled(true, 'Chatarra insuficiente.')
    nave.add(reactorBtn)
    const barW = colW - 130
    const barY = y + 30
    g.fillStyle(0x05080f, 1)
    g.fillRect(16, barY, barW, 10)
    g.fillStyle(COLORS.energy, 1)
    g.fillRect(16, barY, barW * (run.reactor / REACTOR_MAX), 10)
    g.lineStyle(1, 0x35506e, 1)
    g.strokeRect(16, barY, barW, 10)
    y += 60

    // Salvaged weapon (free install).
    if (run.lootWeapon !== null) {
      const def = WEAPONS[run.lootWeapon]
      const lg = scene.add.graphics()
      lg.fillStyle(COLORS.ok, 0.08)
      lg.fillRoundedRect(12, y, colW - 24, 54, 6)
      lg.lineStyle(1, COLORS.ok, 0.55)
      lg.strokeRoundedRect(12, y, colW - 24, 54, 6)
      nave.add(lg)
      nave.add(drawCategoryIcon(scene, 32, y + 19, def.category, 16))
      nave.add(addText(scene, 50, y + 8, `Botín: ${def.name}`, 'title', 14, COLORS.ok))
      nave.add(addText(scene, 50, y + 28, 'Recógelo gratis', 'body', 11, COLORS.textDim))
      const install = new Button(scene, colW - 70, y + 27, 'INSTALAR', () => deps.onBuy({ kind: 'loot_weapon' }), {
        width: 116,
        height: 36,
        fontSize: 13,
      })
      nave.add(install)
    }

    // ---- SISTEMAS (right) ----
    const sys = new Panel(scene, px + 24 + colW + 24, colTop, W - colW - 72, colH, { title: 'SISTEMAS' })
    dyn.add(sys)
    const sg = scene.add.graphics()
    sys.add(sg)
    let sy = sys.contentTop + 8
    for (const id of SYSTEM_ORDER) {
      const level = run.systems[id]
      if (level === undefined) continue
      const max = SYSTEM_MAX_LEVEL[id] ?? 8
      const cost = run.upgradeCosts.system[id]
      sys.add(addText(scene, 16, sy + 2, SYSTEM_NAMES_ES[id], 'body', 13))
      drawPips(sg, 130, sy, level, max)
      const btn = new Button(scene, W - colW - 72 - 64, sy + 9, `+1·${cost}`, () => deps.onBuy({ kind: 'system', system: id }), {
        width: 92,
        height: 28,
        fontSize: 12,
        variant: 'warn',
      })
      if (level >= max) btn.setDisabled(true, 'Nivel máximo.')
      else if (run.scrap < cost) btn.setDisabled(true, 'Chatarra insuficiente.')
      sys.add(btn)
      sy += 32
    }

    // ---- PUESTO COMERCIAL (store beacons only) ----
    const offers = run.shopOffers
    if (offers && offers.length > 0) {
      const store = new Panel(scene, px + 24, colTop + colH + 14, W - 48, H - colH - 110, { title: 'EN VENTA' })
      dyn.add(store)
      const cardW = Math.min(150, Math.floor((W - 72) / offers.length) - 8)
      offers.forEach((offer, index) => {
        const ox = 12 + index * (cardW + 8)
        const oy = store.contentTop + 8
        const affordable = run.scrap >= offer.price
        const cg = scene.add.graphics()
        cg.fillStyle(COLORS.spaceLight, 0.5)
        cg.fillRoundedRect(ox, oy, cardW, 96, 6)
        cg.lineStyle(1, COLORS.textDim, 0.4)
        cg.strokeRoundedRect(ox, oy, cardW, 96, 6)
        store.add(cg)
        store.add(
          scene.add.text(ox + 8, oy + 8, offerName(offer), {
            ...textStyle('body', 12),
            wordWrap: { width: cardW - 16 },
          }),
        )
        store.add(
          addText(scene, ox + 8, oy + 52, `${offer.price}`, 'title', 14, affordable ? COLORS.warn : COLORS.danger),
        )
        const btn = new Button(scene, ox + cardW / 2, oy + 80, 'COMPRAR', () => deps.onBuy({ kind: 'shop', index }), {
          width: cardW - 16,
          height: 24,
          fontSize: 12,
          variant: 'warn',
        })
        if (!affordable) btn.setDisabled(true, 'Chatarra insuficiente.')
        store.add(btn)
      })
    }

    // Close / depart.
    dyn.add(
      new Button(scene, GAME_WIDTH / 2, py + H - 24, hasShop ? 'PARTIR' : 'CERRAR', () => deps.onClose(), {
        width: 220,
        height: 40,
      }),
    )
  }

  build()
  return {
    refresh: build,
    close: () => container.destroy(),
  }
}
