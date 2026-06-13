// Shop scene: run.shopOffers as purchasable cards. Buying emits
// run:buy {kind:'shop', index}; the server answers with run:state and global
// routing refreshes this scene (shopOffers stays non-null while shopping).
// SALIR emits run:continue; routing then moves to SectorMap.

import Phaser from 'phaser'
import { CREW_CLASSES, DRONES, WEAPONS } from '@stellar/shared'
import type { CrewClassId, DroneId, ShopOffer, WeaponId } from '@stellar/shared'
import { COLORS, GAME_HEIGHT, GAME_WIDTH } from '../theme'
import { Button } from '../ui/button'
import { Panel } from '../ui/panel'
import { addText, buildRunHeader, drawCategoryIcon, menuChrome, textStyle } from '../ui/helpers'
import { getState } from '../state'
import { getNet, scOn } from '../net/socket'
import { getAudio } from '../audio/engine'

interface OfferInfo {
  name: string
  desc: string
}

function offerInfo(offer: ShopOffer): OfferInfo {
  switch (offer.kind) {
    case 'weapon': {
      const w = WEAPONS[offer.id as WeaponId]
      return w
        ? { name: w.name, desc: w.desc }
        : { name: 'Arma desconocida', desc: '' }
    }
    case 'drone': {
      const d = DRONES[offer.id as DroneId]
      return d ? { name: d.name, desc: d.desc } : { name: 'Dron desconocido', desc: '' }
    }
    case 'crew': {
      const cls = CREW_CLASSES[offer.id as CrewClassId]
      return cls
        ? { name: `Recluta: ${cls.name}`, desc: cls.desc }
        : { name: 'Recluta', desc: '' }
    }
    case 'ammo':
      return {
        name: `Misiles ×${offer.amount ?? 2}`,
        desc: 'Munición para armas explosivas.',
      }
    case 'repair':
      return {
        name: `Reparar casco +${offer.amount ?? 1}`,
        desc: 'Los técnicos de la estación parchean tu casco en el acto.',
      }
  }
}

export class ShopScene extends Phaser.Scene {
  private dyn: Phaser.GameObjects.Container | null = null
  private busy = false

  constructor() {
    super('Shop')
  }

  create(): void {
    const run = getState().run
    if (!run || run.shopOffers === null) {
      this.scene.start(run ? 'SectorMap' : 'MainMenu')
      return
    }
    this.busy = false
    const node = run.sector.nodes.find((n) => n.id === run.currentNodeId)
    menuChrome(this, {
      biome: node?.biome ?? 'desert',
      seed: node?.seed ?? 1,
      planet: { planetX: GAME_WIDTH * 0.85, planetY: GAME_HEIGHT * 0.8 },
    })
    getAudio().music('menu')

    this.render()
    scOn(this, 'run:refresh', () => {
      this.busy = false
      this.render()
    })
  }

  private render(): void {
    const run = getState().run
    if (!run || run.shopOffers === null) return
    if (this.dyn) this.dyn.destroy()
    const dyn = this.add.container(0, 0)
    this.dyn = dyn
    dyn.add(buildRunHeader(this, run))

    dyn.add(
      addText(this, GAME_WIDTH / 2, 84, 'PUESTO COMERCIAL', 'title', 28, COLORS.panelBorder)
        .setOrigin(0.5),
    )
    dyn.add(
      addText(this, GAME_WIDTH / 2, 116, 'El mercader ajusta los precios mirando tu casco…', 'body', 14, COLORS.textDim)
        .setOrigin(0.5),
    )

    const offers = run.shopOffers
    if (offers.length === 0) {
      dyn.add(
        addText(this, GAME_WIDTH / 2, GAME_HEIGHT / 2, 'No queda nada en venta.', 'body', 18, COLORS.textDim)
          .setOrigin(0.5),
      )
    }

    const cardW = 392
    const cardH = 150
    const cols = 3
    const startX = (GAME_WIDTH - cols * cardW - (cols - 1) * 16) / 2
    offers.forEach((offer, index) => {
      const col = index % cols
      const row = Math.floor(index / cols)
      const x = startX + col * (cardW + 16)
      const y = 150 + row * (cardH + 16)
      dyn.add(this.renderOffer(offer, index, x, y, cardW, cardH, run.scrap))
    })

    dyn.add(
      new Button(this, GAME_WIDTH / 2, GAME_HEIGHT - 60, 'SALIR DE LA TIENDA', () => {
        if (this.busy) return
        this.busy = true
        getNet().socket.emit('run:continue')
      }, { width: 300, height: 50 }),
    )
  }

  private renderOffer(
    offer: ShopOffer,
    index: number,
    x: number,
    y: number,
    w: number,
    h: number,
    scrap: number,
  ): Phaser.GameObjects.Container {
    const info = offerInfo(offer)
    const affordable = scrap >= offer.price
    const panel = new Panel(this, x, y, w, h)
    panel.add(this.add.text(14, 12, info.name, textStyle('title', 15)))
    if (offer.kind === 'weapon' && offer.id) {
      const def = WEAPONS[offer.id as WeaponId]
      if (def) {
        panel.add(drawCategoryIcon(this, w - 26, 22, def.category, 16))
        panel.add(
          this.add.text(
            14,
            36,
            `Daño ${def.damage}${def.shots > 1 ? `×${def.shots}` : ''} · ${def.cooldown}s · ${def.power} energía`,
            textStyle('body', 12, COLORS.textDim),
          ),
        )
      }
    }
    const desc = this.add.text(14, 56, info.desc, {
      ...textStyle('body', 13, COLORS.textDim),
      wordWrap: { width: w - 28 },
    })
    panel.add(desc)
    panel.add(
      this.add
        .text(14, h - 26, `${offer.price} chatarra`, textStyle('title', 15, affordable ? COLORS.warn : COLORS.danger))
        .setOrigin(0, 0.5),
    )
    const buy = new Button(this, w - 80, h - 26, 'COMPRAR', () => {
      if (this.busy) return
      this.busy = true
      getAudio().play('purchase')
      getNet().socket.emit('run:buy', { kind: 'shop', index })
    }, { width: 130, height: 36, fontSize: 13 })
    buy.setDisabled(!affordable, 'Chatarra insuficiente.')
    panel.add(buy)
    return panel
  }
}
