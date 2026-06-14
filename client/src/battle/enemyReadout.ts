// Enemy "target" panel (FTL-style): a framed readout over the enemy ship showing
// its name + class, a HOSTILE badge, the hull bar, shield layers, evasion and a
// status row of its installed systems (power / damage). Updates on each snapshot.

import type Phaser from 'phaser'
import { SHIPS, clamp, type ShipState, type SystemId } from '@stellar/shared'
import { COLORS, COLORS_CSS, HUD } from '../theme'
import { SYSTEM_NAMES, makeText, makeTitleText } from './common'
import { drawCrossOut, drawSystemIcon } from './icons'
import { Tooltip } from './uiKit'

const DEPTH = 13
const R = HUD.enemyShipRect
/** Order systems appear in the status strip. */
const SYS_ORDER: SystemId[] = ['shields', 'weapons', 'engines', 'oxygen', 'medbay', 'cockpit', 'drones']

const HEADER = { x: R.x - 6, y: 56, w: R.w + 12, h: 84 }
// Targeting reticle around the ship body; the systems strip lives just inside its
// lower edge (the ship body is vertically centred in R, so it ends well above this).
const RETICLE_TOP = HEADER.y + HEADER.h + 2
const RETICLE_H = R.h - 24
const RETICLE_BOTTOM = RETICLE_TOP + RETICLE_H
const STRIP_Y = RETICLE_BOTTOM - 50 // status row, kept inside the reticle
const SYS_X0 = R.x + 50 // first system icon
const SYS_STEP = 38 // gap between system icons (kept compact)

/** Centre x of the system at index `idx` in the status strip. */
function sysCx(idx: number): number {
  return SYS_X0 + idx * SYS_STEP
}

export class EnemyReadout {
  private readonly scene: Phaser.Scene
  private readonly nameText: Phaser.GameObjects.Text
  private readonly classText: Phaser.GameObjects.Text
  private readonly evasionText: Phaser.GameObjects.Text
  private readonly hullText: Phaser.GameObjects.Text
  private readonly hullBar: Phaser.GameObjects.Graphics
  private readonly shieldText: Phaser.GameObjects.Text
  private readonly shieldGfx: Phaser.GameObjects.Graphics
  private readonly sysGfx: Phaser.GameObjects.Graphics
  private readonly sysZones: Phaser.GameObjects.Zone[] = []
  private state: ShipState
  private lastKey = ''

  constructor(scene: Phaser.Scene, initial: ShipState) {
    this.scene = scene
    this.state = initial

    // --- header frame + a subtle reticle around the ship ---
    const frame = scene.add.graphics().setDepth(DEPTH - 1)
    frame.fillStyle(COLORS.panel, 0.9)
    frame.fillRoundedRect(HEADER.x, HEADER.y, HEADER.w, HEADER.h, 8)
    frame.lineStyle(1.5, COLORS.shield, 0.9)
    frame.strokeRoundedRect(HEADER.x, HEADER.y, HEADER.w, HEADER.h, 8)
    // Targeting reticle around the ship body (corner brackets, FTL "TARGET" look).
    frame.lineStyle(1.5, COLORS.shield, 0.45)
    frame.strokeRoundedRect(R.x - 6, RETICLE_TOP, R.w + 12, RETICLE_H, 10)
    this.frame = frame

    makeText(scene, HEADER.x + 14, HEADER.y + 8, 'OBJETIVO', 10, COLORS_CSS.shield, {
      fontStyle: 'bold',
    }).setDepth(DEPTH)
    this.nameText = makeTitleText(scene, HEADER.x + 14, HEADER.y + 22, '', 17).setDepth(DEPTH)
    this.classText = makeText(scene, HEADER.x + 14, HEADER.y + 46, '', 12, COLORS_CSS.textDim).setDepth(DEPTH)

    // HOSTILE badge (top-right of the header).
    const badge = scene.add.graphics().setDepth(DEPTH)
    badge.fillStyle(COLORS.danger, 0.18)
    badge.fillRoundedRect(HEADER.x + HEADER.w - 82, HEADER.y + 8, 72, 18, 4)
    badge.lineStyle(1.2, COLORS.danger, 0.95)
    badge.strokeRoundedRect(HEADER.x + HEADER.w - 82, HEADER.y + 8, 72, 18, 4)
    makeTitleText(scene, HEADER.x + HEADER.w - 46, HEADER.y + 17, 'HOSTIL', 12, COLORS_CSS.danger)
      .setOrigin(0.5)
      .setDepth(DEPTH + 1)
    this.badge = badge

    this.evasionText = makeText(scene, HEADER.x + HEADER.w - 14, HEADER.y + 32, '', 12)
      .setOrigin(1, 0)
      .setDepth(DEPTH)

    // Hull bar (bottom-left of the header).
    this.hullText = makeText(scene, HEADER.x + 14, HEADER.y + 64, '', 12).setDepth(DEPTH)
    this.hullBar = scene.add.graphics().setDepth(DEPTH)

    // Shields (bottom-right of the header).
    this.shieldGfx = scene.add.graphics().setDepth(DEPTH)
    this.shieldText = makeText(scene, HEADER.x + HEADER.w - 14, HEADER.y + 64, '', 12, COLORS_CSS.shield)
      .setOrigin(1, 0)
      .setDepth(DEPTH)

    // --- systems status strip (below the ship) ---
    makeText(this.scene, R.x + 4, STRIP_Y - 2, 'SISTEMAS', 10, COLORS_CSS.textDim, {
      fontStyle: 'bold',
    }).setDepth(DEPTH)
    this.sysGfx = scene.add.graphics().setDepth(DEPTH)

    const hullZone = scene.add.zone(HEADER.x + 70, HEADER.y + 70, 140, 16).setInteractive().setDepth(DEPTH)
    Tooltip.attach(hullZone, () => 'Casco del enemigo: a 0 la nave es destruida.')
    const shieldZone = scene.add.zone(HEADER.x + HEADER.w - 60, HEADER.y + 70, 110, 16).setInteractive().setDepth(DEPTH)
    Tooltip.attach(shieldZone, () => 'Capas de escudo enemigas: bloquean tus proyectiles no perforantes.')
    this.sysZones.push(hullZone, shieldZone)
    this.buildSystemZones(initial)

    this.apply(initial)
  }

  private readonly frame: Phaser.GameObjects.Graphics
  private readonly badge: Phaser.GameObjects.Graphics

  apply(enemy: ShipState): void {
    this.state = enemy
    const installed = SYS_ORDER.filter((id) => enemy.systems.some((s) => s.id === id))
    const sysKey = installed
      .map((id) => {
        const s = enemy.systems.find((x) => x.id === id)
        return s ? `${id}:${s.level}:${s.power}:${s.damage.toFixed(1)}` : id
      })
      .join('|')
    const hull = Math.max(0, Math.ceil(enemy.hull))
    const key = `${enemy.name}|${enemy.shipClass}|${hull}/${enemy.hullMax}|${enemy.shieldLayers}/${enemy.shieldLayersMax}|${Math.round(enemy.evasion * 100)}|${sysKey}`
    if (key === this.lastKey) return
    this.lastKey = key

    this.nameText.setText(enemy.name)
    this.classText.setText(`Clase: ${SHIPS[enemy.shipClass]?.name ?? enemy.shipClass}`)
    this.evasionText.setText(`EVASIÓN ${Math.round(enemy.evasion * 100)}%`)

    // Hull bar.
    this.hullText.setText(`CASCO ${hull}/${enemy.hullMax}`)
    const pct = clamp(hull / Math.max(1, enemy.hullMax), 0, 1)
    const bx = HEADER.x + 96
    const by = HEADER.y + 67
    const g = this.hullBar
    g.clear()
    g.fillStyle(0x05080f, 1)
    g.fillRect(bx, by, 96, 9)
    g.fillStyle(pct > 0.6 ? COLORS.ok : pct > 0.3 ? COLORS.warn : COLORS.danger, 1)
    g.fillRect(bx, by, 96 * pct, 9)
    g.lineStyle(1, 0x35506e, 1)
    g.strokeRect(bx, by, 96, 9)

    // Shield layers as blue segmented bars (matching the player's vital panel).
    this.shieldText.setText(`ESCUDOS ${enemy.shieldLayers}/${enemy.shieldLayersMax}`)
    const sg = this.shieldGfx
    sg.clear()
    const barRight = HEADER.x + HEADER.w - 93
    const segW = 10
    const segH = 9
    const step = 12
    for (let i = 0; i < enemy.shieldLayersMax; i++) {
      const x = barRight - segW - i * step
      const y = HEADER.y + 67
      sg.fillStyle(0x05080f, 1)
      sg.fillRect(x, y, segW, segH)
      if (i < enemy.shieldLayers) {
        sg.fillStyle(COLORS.shield, 1)
        sg.fillRect(x, y, segW, segH)
      }
      // Same square-bar style as the player's vital panel (readouts.drawShieldBar):
      // bright border on active layers, dim on empty slots.
      sg.lineStyle(1, COLORS.shield, i < enemy.shieldLayers ? 0.95 : 0.35)
      sg.strokeRect(x, y, segW, segH)
    }

    // Systems status strip.
    const sys = this.sysGfx
    sys.clear()
    installed.forEach((id, idx) => {
      const s = enemy.systems.find((x) => x.id === id)
      if (!s) return
      const cx = sysCx(idx)
      const usable = Math.max(0, Math.floor(s.level - s.damage + 0.0001))
      const damaged = s.level - usable
      const destroyed = usable <= 0
      const color = destroyed ? COLORS.danger : damaged > 0 ? COLORS.warn : COLORS.textDim
      drawSystemIcon(sys, id, cx, STRIP_Y + 18, 15, color)
      if (destroyed) drawCrossOut(sys, cx, STRIP_Y + 18, 17, COLORS.danger)
      // Power / damage pips beneath the icon.
      for (let i = 0; i < s.level; i++) {
        const px = cx - (s.level * 4) / 2 + i * 4
        const py = STRIP_Y + 32
        if (i >= usable) {
          sys.fillStyle(COLORS.danger, 1)
          sys.fillRect(px, py, 3, 4)
        } else if (i < s.power) {
          sys.fillStyle(COLORS.energy, 1)
          sys.fillRect(px, py, 3, 4)
        } else {
          sys.lineStyle(1, COLORS.textDim, 0.8)
          sys.strokeRect(px, py, 3, 4)
        }
      }
    })
  }

  /** One tooltip zone per installed system in the status strip (positions are fixed). */
  private buildSystemZones(initial: ShipState): void {
    const installed = SYS_ORDER.filter((id) => initial.systems.some((s) => s.id === id))
    installed.forEach((id, idx) => {
      const cx = sysCx(idx)
      const zone = this.scene.add.zone(cx, STRIP_Y + 20, SYS_STEP - 4, 44).setInteractive().setDepth(DEPTH)
      Tooltip.attach(zone, () => {
        const cur = this.state.systems.find((x) => x.id === id)
        if (!cur) return SYSTEM_NAMES[id]
        const u = Math.max(0, Math.floor(cur.level - cur.damage + 0.0001))
        return `${SYSTEM_NAMES[id]} (enemigo) — nivel ${cur.level}, energía ${cur.power}, útiles ${u}`
      })
      this.sysZones.push(zone)
    })
  }

  destroy(): void {
    this.frame.destroy()
    this.badge.destroy()
    this.nameText.destroy()
    this.classText.destroy()
    this.evasionText.destroy()
    this.hullText.destroy()
    this.hullBar.destroy()
    this.shieldText.destroy()
    this.shieldGfx.destroy()
    this.sysGfx.destroy()
    for (const z of this.sysZones) z.destroy()
    this.sysZones.length = 0
  }
}
