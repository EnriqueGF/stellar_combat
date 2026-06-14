// Ship readouts (HUD.readoutsRect): FTL-style vital-stats column in the top-left —
// hull bar, evasion, shield layers and O2 stacked compactly above the crew, plus
// the centred O2/hull alert banners with one-shot alarms (GAME_SPEC §6.3).

import type Phaser from 'phaser'
import { clamp, type ShipState } from '@stellar/shared'
import type { IAudioEngine } from '../contracts'
import { COLORS, COLORS_CSS, HUD } from '../theme'
import { makeText, makeTitleText } from './common'
import {
  drawEvasionIcon,
  drawHullIcon,
  drawMissileIcon,
  drawScrapIcon,
  drawSystemIcon,
  drawWarnTriangle,
} from './icons'
import { Tooltip } from './uiKit'

const DEPTH = 12
const R = HUD.readoutsRect

interface Banner {
  bg: Phaser.GameObjects.Graphics
  text: Phaser.GameObjects.Text
  active: boolean
}

export class Readouts {
  private readonly scene: Phaser.Scene
  private readonly audio: IAudioEngine
  private readonly hullNum: Phaser.GameObjects.Text
  private readonly hullBar: Phaser.GameObjects.Graphics
  private readonly evaVal: Phaser.GameObjects.Text
  private readonly shieldBar: Phaser.GameObjects.Graphics
  private readonly o2Val: Phaser.GameObjects.Text
  private readonly ammoVal: Phaser.GameObjects.Text
  private readonly scrapGfx: Phaser.GameObjects.Graphics
  private readonly scrapLabel: Phaser.GameObjects.Text
  private readonly scrapVal: Phaser.GameObjects.Text
  private readonly iconGfx: Phaser.GameObjects.Graphics
  private readonly evaWarn: Phaser.GameObjects.Graphics
  private readonly zones: Phaser.GameObjects.Zone[]
  private readonly o2Banner: Banner
  private readonly hullBanner: Banner
  private lastKey = ''

  constructor(scene: Phaser.Scene, audio: IAudioEngine) {
    this.scene = scene
    this.audio = audio

    // Panel backing so the stats read clearly over the backdrop.
    const bg = scene.add.graphics().setDepth(DEPTH - 1)
    bg.fillStyle(COLORS.panel, 0.6)
    bg.fillRoundedRect(R.x - 5, R.y - 4, R.w + 10, R.h, 6)
    bg.lineStyle(1, COLORS.panelBorder, 0.45)
    bg.strokeRoundedRect(R.x - 5, R.y - 4, R.w + 10, R.h, 6)

    // Each row: a stat icon (left), its name and the value (right).
    const ig = scene.add.graphics().setDepth(DEPTH)
    this.iconGfx = ig
    const IX = R.x + 11
    drawHullIcon(ig, IX, R.y + 8, 14, COLORS.text)
    drawEvasionIcon(ig, IX, R.y + 40, 14, COLORS.text)
    drawSystemIcon(ig, 'shields', IX, R.y + 57, 14, COLORS.shield)
    drawSystemIcon(ig, 'oxygen', IX, R.y + 74, 13, COLORS.text)
    drawMissileIcon(ig, IX, R.y + 91, 13, COLORS.catExplosive, false)

    const label = (y: number, str: string): Phaser.GameObjects.Text =>
      makeText(scene, R.x + 27, R.y + y, str, 10, COLORS_CSS.textDim).setOrigin(0, 0.5).setDepth(DEPTH)
    const value = (y: number, color: string): Phaser.GameObjects.Text =>
      makeText(scene, R.x + R.w, R.y + y, '', 13, color).setOrigin(1, 0.5).setDepth(DEPTH)

    label(8, 'CASCO')
    label(40, 'EVASIÓN')
    label(57, 'ESCUDOS')
    label(74, 'OXÍGENO')
    label(91, 'MISILES')

    // Hull (number + segmented bar).
    this.hullNum = makeTitleText(scene, R.x + R.w, R.y + 8, '0/0', 13).setOrigin(1, 0.5).setDepth(DEPTH)
    this.hullBar = scene.add.graphics().setDepth(DEPTH)
    this.evaWarn = scene.add.graphics().setDepth(DEPTH)
    this.evaVal = value(40, COLORS_CSS.text)
    // Shields shown as blue layer-bars (one segment per layer), not a count.
    this.shieldBar = scene.add.graphics().setDepth(DEPTH)
    this.o2Val = value(74, COLORS_CSS.text)
    this.ammoVal = value(91, COLORS_CSS.catExplosive)
    // Scrap (expedition only; icon + label + value hidden until setScrap is called).
    this.scrapGfx = scene.add.graphics().setDepth(DEPTH).setVisible(false)
    drawScrapIcon(this.scrapGfx, IX, R.y + 108, 14, COLORS.warn)
    this.scrapLabel = label(108, 'CHATARRA').setVisible(false)
    this.scrapVal = value(108, COLORS_CSS.warn).setVisible(false)

    const hullZone = scene.add.zone(R.x + R.w / 2, R.y + 16, R.w, 24).setInteractive().setDepth(DEPTH)
    Tooltip.attach(hullZone, () => 'Casco: a 0 la nave es destruida.')
    const evaZone = scene.add.zone(R.x + R.w / 2, R.y + 40, R.w, 16).setInteractive().setDepth(DEPTH)
    Tooltip.attach(evaZone, () =>
      'Evasión: probabilidad de esquivar.\nMotores alimentados ×5% + bonus de piloto en cabina.\nA 0%: cabina sin piloto o motores sin energía.',
    )
    const shZone = scene.add.zone(R.x + R.w / 2, R.y + 57, R.w, 16).setInteractive().setDepth(DEPTH)
    Tooltip.attach(shZone, () =>
      'Capas de escudo: absorben proyectiles no perforantes.\nSe regeneran tras unos segundos sin recibir impactos.',
    )
    const o2Zone = scene.add.zone(R.x + R.w / 2, R.y + 74, R.w, 16).setInteractive().setDepth(DEPTH)
    Tooltip.attach(o2Zone, () => 'Oxígeno medio de la nave. Bajo de 15% la tripulación se asfixia.')
    const ammoZone = scene.add.zone(R.x + R.w / 2, R.y + 91, R.w, 16).setInteractive().setDepth(DEPTH)
    Tooltip.attach(ammoZone, () => 'Misiles (munición global). Las armas explosivas gastan 1 por andanada.')
    this.zones = [hullZone, evaZone, shZone, o2Zone, ammoZone]

    this.o2Banner = this.makeBanner(scene, 0, 'OXÍGENO BAJO', COLORS.warn)
    this.hullBanner = this.makeBanner(scene, 1, 'CASCO CRÍTICO', COLORS.danger)
  }

  private makeBanner(scene: Phaser.Scene, index: number, label: string, color: number): Banner {
    const cx = HUD.playerShipRect.x + HUD.playerShipRect.w / 2
    const y = 506 + index * 40
    const bg = scene.add.graphics().setDepth(660).setVisible(false)
    bg.fillStyle(0x05080f, 0.85)
    bg.fillRoundedRect(cx - 130, y, 260, 32, 6)
    bg.lineStyle(2, color, 1)
    bg.strokeRoundedRect(cx - 130, y, 260, 32, 6)
    drawWarnTriangle(bg, cx - 105, y + 16, 18, color)
    const text = makeTitleText(scene, cx + 12, y + 16, label, 16, `#${color.toString(16).padStart(6, '0')}`)
      .setOrigin(0.5)
      .setDepth(661)
      .setVisible(false)
    return { bg, text, active: false }
  }

  /** Expedition: show the run's scrap stash at the foot of the panel. null hides it (duels/tutorial). */
  setScrap(scrap: number | null): void {
    const show = scrap !== null
    this.scrapGfx.setVisible(show)
    this.scrapLabel.setVisible(show)
    this.scrapVal.setVisible(show)
    if (show) this.scrapVal.setText(`${Math.round(scrap)}`)
  }

  apply(you: ShipState): void {
    const evPct = Math.round(you.evasion * 100)
    const hull = Math.max(0, Math.ceil(you.hull))
    const o2Avg =
      you.rooms.length === 0
        ? 100
        : you.rooms.reduce((acc, r) => acc + r.o2, 0) / you.rooms.length
    const o2Pct = Math.round(o2Avg)

    const key = `${evPct}|${hull}/${you.hullMax}|${you.shieldLayers}/${you.shieldLayersMax}|${o2Pct}|${you.ammo}`
    if (key === this.lastKey) return
    this.lastKey = key

    // Hull bar.
    this.hullNum.setText(`${hull}/${you.hullMax}`)
    const pct = clamp(hull / Math.max(1, you.hullMax), 0, 1)
    const color = pct > 0.6 ? COLORS.ok : pct > 0.3 ? COLORS.warn : COLORS.danger
    this.hullNum.setColor(`#${color.toString(16).padStart(6, '0')}`)
    const g = this.hullBar
    const by = R.y + 18
    g.clear()
    g.fillStyle(0x05080f, 1)
    g.fillRect(R.x, by, R.w, 11)
    g.fillStyle(color, 1)
    g.fillRect(R.x, by, R.w * pct, 11)
    g.lineStyle(1, 0x35506e, 1)
    g.strokeRect(R.x, by, R.w, 11)
    const segs = clamp(Math.ceil(you.hullMax / 2), 1, 16)
    g.lineStyle(1, 0x05080f, 0.7)
    for (let i = 1; i < segs; i++) {
      const sx = R.x + (R.w * i) / segs
      g.lineBetween(sx, by, sx, by + 11)
    }

    // Evasion (red + warning triangle when zero: no pilot or no engine power).
    this.evaVal.setText(`${evPct}%`)
    this.evaVal.setColor(evPct === 0 ? COLORS_CSS.warn : COLORS_CSS.text)
    this.evaWarn.clear()
    if (evPct === 0) drawWarnTriangle(this.evaWarn, R.x + R.w - 44, R.y + 40, 8, COLORS.warn)

    this.drawShieldBar(you.shieldLayers, you.shieldLayersMax)
    this.o2Val.setText(`${o2Pct}%`)
    this.o2Val.setColor(o2Pct < 25 ? COLORS_CSS.warn : COLORS_CSS.text)
    this.ammoVal.setText(`${you.ammo}`)
    this.ammoVal.setColor(you.ammo <= 3 ? COLORS_CSS.warn : COLORS_CSS.catExplosive)

    this.setBanner(this.o2Banner, o2Avg < 40)
    this.setBanner(this.hullBanner, pct < 0.3)
  }

  /** Blue segmented layer-bar: one filled segment per active shield layer. */
  private drawShieldBar(layers: number, layersMax: number): void {
    const g = this.shieldBar
    g.clear()
    const y = R.y + 57
    const maxL = Math.max(0, layersMax)
    if (maxL === 0) {
      g.lineStyle(2, COLORS.textDim, 0.6)
      g.lineBetween(R.x + R.w - 14, y, R.x + R.w, y)
      return
    }
    const segW = 13
    const gap = 3
    const segH = 10
    const startX = R.x + R.w - (maxL * segW + (maxL - 1) * gap)
    const by = y - segH / 2
    for (let i = 0; i < maxL; i++) {
      const sx = startX + i * (segW + gap)
      g.fillStyle(0x05080f, 1)
      g.fillRect(sx, by, segW, segH)
      if (i < layers) {
        g.fillStyle(COLORS.shield, 1)
        g.fillRect(sx, by, segW, segH)
      }
      g.lineStyle(1, COLORS.shield, i < layers ? 0.95 : 0.35)
      g.strokeRect(sx, by, segW, segH)
    }
  }

  private setBanner(banner: Banner, active: boolean): void {
    if (active === banner.active) return
    banner.active = active
    banner.bg.setVisible(active)
    banner.text.setVisible(active)
    if (active) this.audio.play('alarm')
  }

  update(time: number): void {
    const pulse = 0.65 + 0.35 * Math.sin(time / 220)
    if (this.o2Banner.active) {
      this.o2Banner.bg.setAlpha(pulse)
      this.o2Banner.text.setAlpha(pulse)
    }
    if (this.hullBanner.active) {
      this.hullBanner.bg.setAlpha(pulse)
      this.hullBanner.text.setAlpha(pulse)
    }
  }

  destroy(): void {
    this.hullNum.destroy()
    this.hullBar.destroy()
    this.evaVal.destroy()
    this.shieldBar.destroy()
    this.o2Val.destroy()
    this.ammoVal.destroy()
    this.scrapGfx.destroy()
    this.scrapLabel.destroy()
    this.scrapVal.destroy()
    this.iconGfx.destroy()
    this.evaWarn.destroy()
    for (const z of this.zones) z.destroy()
    this.o2Banner.bg.destroy()
    this.o2Banner.text.destroy()
    this.hullBanner.bg.destroy()
    this.hullBanner.text.destroy()
  }
}
