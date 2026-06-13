// Ship readouts (HUD.readoutsRect): permanent evasion %, hull bar and shield
// layer count, plus the cause alert when evasion is 0 and the big O2/hull
// alert banners with one-shot alarms (GAME_SPEC §6.3).

import type Phaser from 'phaser'
import { clamp, type ShipState } from '@stellar/shared'
import type { IAudioEngine } from '../contracts'
import { COLORS, COLORS_CSS, HUD } from '../theme'
import { makeText, makeTitleText } from './common'
import { drawWarnTriangle } from './icons'
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
  private readonly evasionText: Phaser.GameObjects.Text
  private readonly alertGfx: Phaser.GameObjects.Graphics
  private readonly alertText: Phaser.GameObjects.Text
  private readonly hullText: Phaser.GameObjects.Text
  private readonly hullBar: Phaser.GameObjects.Graphics
  private readonly shieldText: Phaser.GameObjects.Text
  private readonly o2Banner: Banner
  private readonly hullBanner: Banner
  private lastKey = ''

  constructor(scene: Phaser.Scene, audio: IAudioEngine) {
    this.scene = scene
    this.audio = audio

    this.evasionText = makeText(scene, R.x, R.y + 2, 'EVASIÓN: 0%', 13).setDepth(DEPTH)
    this.alertGfx = scene.add.graphics().setDepth(DEPTH)
    this.alertText = makeText(scene, R.x + 18, R.y + 20, '', 11, COLORS_CSS.warn).setDepth(DEPTH)
    this.hullText = makeText(scene, R.x + 190, R.y + 2, 'CASCO: 0/0', 13).setDepth(DEPTH)
    this.hullBar = scene.add.graphics().setDepth(DEPTH)
    this.shieldText = makeText(scene, R.x + 380, R.y + 2, '◆×0', 13, COLORS_CSS.shield).setDepth(
      DEPTH,
    )

    const evasionZone = scene.add.zone(R.x + 70, R.y + 10, 150, 20).setInteractive().setDepth(DEPTH)
    Tooltip.attach(evasionZone, () =>
      'Evasión: probabilidad de esquivar proyectiles.\nMotores alimentados ×5% + bonus de piloto en cabina.',
    )
    const hullZone = scene.add.zone(R.x + 255, R.y + 10, 140, 20).setInteractive().setDepth(DEPTH)
    Tooltip.attach(hullZone, () => 'Casco: a 0 la nave es destruida.')
    const shieldZone = scene.add.zone(R.x + 410, R.y + 10, 70, 20).setInteractive().setDepth(DEPTH)
    Tooltip.attach(shieldZone, () =>
      'Capas de escudo: absorben proyectiles no perforantes.\nSe regeneran tras unos segundos sin recibir impactos.',
    )
    this.zones = [evasionZone, hullZone, shieldZone]

    this.o2Banner = this.makeBanner(scene, 0, 'OXÍGENO BAJO', COLORS.warn)
    this.hullBanner = this.makeBanner(scene, 1, 'CASCO CRÍTICO', COLORS.danger)
  }

  private readonly zones: Phaser.GameObjects.Zone[]

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

  apply(you: ShipState): void {
    const cockpit = you.systems.find((s) => s.id === 'cockpit')
    const cockpitManned =
      cockpit !== undefined &&
      you.crew.some((c) => c.hp > 0 && c.roomId === cockpit.roomId && c.path.length === 0)
    const engines = you.systems.find((s) => s.id === 'engines')
    const enginesPowered = engines !== undefined && engines.power > 0

    const evPct = Math.round(you.evasion * 100)
    const hull = Math.max(0, Math.ceil(you.hull))
    const o2Avg =
      you.rooms.length === 0
        ? 100
        : you.rooms.reduce((acc, r) => acc + r.o2, 0) / you.rooms.length

    const key = `${evPct}|${hull}|${you.shieldLayers}|${cockpitManned ? 1 : 0}|${enginesPowered ? 1 : 0}|${o2Avg < 40 ? 1 : 0}|${hull / Math.max(1, you.hullMax) < 0.3 ? 1 : 0}`
    if (key === this.lastKey) return
    this.lastKey = key

    this.evasionText.setText(`EVASIÓN: ${evPct}%`)
    this.evasionText.setColor(evPct === 0 ? COLORS_CSS.warn : COLORS_CSS.text)

    this.alertGfx.clear()
    if (evPct === 0) {
      drawWarnTriangle(this.alertGfx, R.x + 7, R.y + 27, 13, COLORS.warn)
      this.alertText.setText(!cockpitManned ? '¡Cabina sin piloto!' : '¡Motores sin energía!')
    } else if (!cockpitManned) {
      drawWarnTriangle(this.alertGfx, R.x + 7, R.y + 27, 13, COLORS.warn)
      this.alertText.setText('¡Cabina sin piloto!')
    } else {
      this.alertText.setText('')
    }

    this.hullText.setText(`CASCO: ${hull}/${you.hullMax}`)
    const pct = clamp(hull / Math.max(1, you.hullMax), 0, 1)
    this.hullBar.clear()
    this.hullBar.fillStyle(0x05080f, 1)
    this.hullBar.fillRect(R.x + 305, R.y + 5, 64, 10)
    this.hullBar.fillStyle(pct > 0.6 ? COLORS.ok : pct > 0.3 ? COLORS.warn : COLORS.danger, 1)
    this.hullBar.fillRect(R.x + 305, R.y + 5, 64 * pct, 10)
    this.hullBar.lineStyle(1, 0x35506e, 1)
    this.hullBar.strokeRect(R.x + 305, R.y + 5, 64, 10)

    this.shieldText.setText(`◆×${you.shieldLayers}`)

    this.setBanner(this.o2Banner, o2Avg < 40)
    this.setBanner(this.hullBanner, pct < 0.3)
  }

  private setBanner(banner: Banner, active: boolean): void {
    if (active === banner.active) return
    banner.active = active
    banner.bg.setVisible(active)
    banner.text.setVisible(active)
    // One alarm per activation edge.
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
    this.evasionText.destroy()
    this.alertGfx.destroy()
    this.alertText.destroy()
    this.hullText.destroy()
    this.hullBar.destroy()
    this.shieldText.destroy()
    for (const z of this.zones) z.destroy()
    this.o2Banner.bg.destroy()
    this.o2Banner.text.destroy()
    this.hullBanner.bg.destroy()
    this.hullBanner.text.destroy()
  }
}
