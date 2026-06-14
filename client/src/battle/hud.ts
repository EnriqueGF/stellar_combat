// Bottom HUD bar (GAME_SPEC §6.3 pixel budget): reactor pips, 7 clickable
// system power columns, 4 weapon slots with radial cooldowns, global missile
// counter, 3 drone slots and the jump button. Power is adjusted one step at a
// time: left click on a system adds 1 energy, right click (or wheel) removes 1.

import type Phaser from 'phaser'
import {
  COCKPIT_JUMP_MULT,
  DRONES,
  MAX_DRONES_ACTIVE,
  WEAPONS,
  clamp,
  type DroneSlotState,
  type ShipState,
  type SystemId,
  type SystemState,
  type WeaponSlotState,
} from '@stellar/shared'
import type { IAudioEngine } from '../contracts'
import type { TypedSocket } from '../contracts'
import { COLORS, COLORS_CSS, GAME_HEIGHT, GAME_WIDTH, HUD, catColor } from '../theme'
import {
  CATEGORY_NAMES,
  CATEGORY_TRIANGLE_TEXT,
  SYSTEM_NAMES,
  SYSTEM_ORDER,
  WEAPON_SHORT,
  makeText,
  type Rect,
  type Vec2,
} from './common'
import {
  drawCategoryIcon,
  drawCrossOut,
  drawMissileIcon,
  drawPlugCrossed,
  drawSystemIcon,
  drawTaskIcon,
  drawTriangleBadge,
} from './icons'
import { ProgressBar, Tooltip, type IProgressBar } from './uiKit'

const BAR_Y = HUD.bottomBar.y
const DEPTH = 14

// Compact FTL-style layout: systems and weapons take less room, packed to the left.
const REACTOR_X = 8
const SYS_X = 74
const SYS_COL_W = 33
const WEAP_X = 312
const SLOT_W = 90
const SLOT_INNER_W = 84
const SLOT_H = 92
const DRONE_X = 686
const DRONE_STEP = 52
const HELP_X = 852
const JUMP_X = 930
const JUMP_W = 130

export interface HudCallbacks {
  onSelectWeapon(slot: number): void
  onSlotRightClick(slot: number): void
  onJumpClick(): void
  onAmmoDepleted(): void
}

interface SlotWidget {
  weaponId: WeaponSlotState['weaponId']
  x: number
  y: number
  radialGfx: Phaser.GameObjects.Graphics
  borderGfx: Phaser.GameObjects.Graphics
  selGfx: Phaser.GameObjects.Graphics
  statusGfx: Phaser.GameObjects.Graphics
  statusText: Phaser.GameObjects.Text
  autoBadge: Phaser.GameObjects.Container
  zone: Phaser.GameObjects.Zone
  displayCharge: number
  targetCharge: number
  ready: boolean
  lastKey: string
  /** Last drawn radial state (charge bucket + powered) so it refreshes on any
   *  visual change, not only when displayCharge is animating (e.g. powering a
   *  weapon while paused freezes the charge but must still redraw). */
  lastRadialKey: string
}

interface DroneWidget {
  gfx: Phaser.GameObjects.Graphics
  zone: Phaser.GameObjects.Zone
  lastKey: string
}

export class BottomHud {
  private readonly scene: Phaser.Scene
  private readonly socket: TypedSocket
  private readonly audio: IAudioEngine
  private readonly cb: HudCallbacks
  private state: ShipState
  private selectedSlot: number | null = null
  private ammoNotified = false

  private readonly reactorGfx: Phaser.GameObjects.Graphics
  private readonly systemsGfx: Phaser.GameObjects.Graphics
  private readonly slots: SlotWidget[] = []
  private readonly droneWidgets: DroneWidget[] = []
  private readonly jumpGfx: Phaser.GameObjects.Graphics
  private readonly jumpTitle: Phaser.GameObjects.Text
  private readonly jumpReason: Phaser.GameObjects.Text
  private readonly jumpBar: IProgressBar
  private readonly disposables: { destroy(): void }[] = []

  private reactorKey = ''
  private systemsKey = ''
  private jumpKey = ''
  private installedSystems: SystemId[] = []

  constructor(
    scene: Phaser.Scene,
    initial: ShipState,
    deps: { socket: TypedSocket; audio: IAudioEngine; fleeTooltip: string },
    cb: HudCallbacks,
  ) {
    this.scene = scene
    this.socket = deps.socket
    this.audio = deps.audio
    this.cb = cb
    this.state = initial

    // No bottom bar / dividers: the controls float "al aire" over the backdrop
    // (FTL-style, less overwhelming). A soft bottom-up gradient — no hard edge —
    // just lifts them off busy planets without boxing them in.
    const bg = scene.add.graphics().setDepth(DEPTH - 1)
    const bands = 18
    const span = GAME_HEIGHT - BAR_Y
    for (let i = 0; i < bands; i++) {
      bg.fillStyle(COLORS.spaceDeep, 0.5 * (i / (bands - 1)))
      bg.fillRect(0, BAR_Y + (i * span) / bands, GAME_WIDTH, Math.ceil(span / bands) + 1)
    }
    this.disposables.push(bg)

    // --- reactor ---
    this.reactorGfx = scene.add.graphics().setDepth(DEPTH)
    this.disposables.push(this.reactorGfx)
    const reactorLabel = makeText(scene, REACTOR_X + 32, BAR_Y + 124, 'REACTOR', 8, COLORS_CSS.textDim)
      .setOrigin(0.5, 0)
      .setDepth(DEPTH)
    this.disposables.push(reactorLabel)
    const reactorZone = scene.add
      .zone(REACTOR_X + 32, BAR_Y + 67, 64, 125)
      .setInteractive()
      .setDepth(DEPTH)
    Tooltip.attach(reactorZone, () => {
      const s = this.state
      return `Reactor: ${s.sparePower} de ${s.reactor} de energía libre.\nClick izq. en un sistema añade energía; click dcho. la quita.`
    })
    this.disposables.push(reactorZone)

    // --- system columns ---
    this.systemsGfx = scene.add.graphics().setDepth(DEPTH)
    this.disposables.push(this.systemsGfx)
    this.installedSystems = SYSTEM_ORDER.filter((id) =>
      initial.systems.some((s) => s.id === id),
    )
    this.installedSystems.forEach((sysId, idx) => {
      const cx = SYS_X + idx * SYS_COL_W + SYS_COL_W / 2
      const zone = scene.add
        .zone(cx, BAR_Y + 88, SYS_COL_W - 2, 92)
        .setInteractive()
        .setDepth(DEPTH)
      zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        const sys = this.systemOf(sysId)
        if (sys === undefined) return
        // Simple model: left click adds 1 energy, right click removes 1.
        this.adjustPower(sys, pointer.rightButtonDown() ? -1 : 1)
      })
      zone.on('wheel', (_p: Phaser.Input.Pointer, _dx: number, dy: number) => {
        const sys = this.systemOf(sysId)
        if (sys === undefined) return
        this.adjustPower(sys, dy > 0 ? -1 : 1)
      })
      Tooltip.attach(zone, () => this.systemTooltip(sysId))
      this.disposables.push(zone)
    })

    // --- weapon slots ---
    initial.weapons.forEach((w, i) => this.createSlot(w, i))

    // (Missile count now lives in the top-left vital-stats panel; see Readouts.)

    // --- drones ---
    for (let i = 0; i < 3; i++) {
      const gfx = scene.add.graphics().setDepth(DEPTH)
      const x = DRONE_X + i * DRONE_STEP
      const zone = scene.add
        .zone(x + 27, BAR_Y + 67, 54, 110)
        .setInteractive()
        .setDepth(DEPTH)
      const slotIdx = i
      zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (pointer.rightButtonDown()) return
        if (this.state.drones[slotIdx] === undefined) return
        this.socket.emit('battle:toggle_drone', slotIdx)
        this.audio.play('click')
      })
      Tooltip.attach(zone, () => {
        const d = this.state.drones[slotIdx]
        if (d === undefined) return 'Hueco de dron vacío'
        const def = DRONES[d.droneId]
        const status = !d.enabled
          ? 'Apagado (click para activar)'
          : d.powered
            ? 'Activo'
            : 'Sin energía en la bahía de drones'
        return `${def.name} (${def.power}⚡)\n${def.desc}\nEstado: ${status}`
      })
      this.droneWidgets.push({ gfx, zone, lastKey: '' })
      this.disposables.push(gfx, zone)
    }

    // --- SPACE→pause hint (the "?" AYUDA affordance was removed) ---
    // Centred in the freed column between the drones and the jump button.
    const hint = makeText(
      scene,
      HELP_X + 35,
      BAR_Y + 60,
      'ESPACIO\npausa',
      9,
      COLORS_CSS.textDim,
      { align: 'center' },
    )
      .setOrigin(0.5)
      .setDepth(DEPTH)
    this.disposables.push(hint)

    // --- jump ---
    this.jumpGfx = scene.add.graphics().setDepth(DEPTH)
    this.disposables.push(this.jumpGfx)
    this.jumpTitle = makeText(scene, JUMP_X + JUMP_W / 2, BAR_Y + 30, 'SALTO', 12)
      .setOrigin(0.5)
      .setDepth(DEPTH + 1)
    this.disposables.push(this.jumpTitle)
    this.jumpReason = makeText(scene, JUMP_X + JUMP_W / 2, BAR_Y + 52, '', 9, COLORS_CSS.warn, {
      align: 'center',
      wordWrap: { width: JUMP_W - 12 },
    })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH + 1)
    this.disposables.push(this.jumpReason)
    this.jumpBar = new ProgressBar(scene, JUMP_X + 8, BAR_Y + 96, JUMP_W - 16, 10, {
      color: COLORS.panelBorder,
    })
    this.jumpBar.setDepth(DEPTH + 1)
    const jumpZone = scene.add
      .zone(JUMP_X + JUMP_W / 2, BAR_Y + 67, JUMP_W, 120)
      .setInteractive()
      .setDepth(DEPTH)
    jumpZone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.rightButtonDown()) this.cb.onJumpClick()
    })
    Tooltip.attach(jumpZone, () => deps.fleeTooltip)
    this.disposables.push(jumpZone)

    this.apply(initial)
  }

  // -------------------------------------------------------------------------
  // Weapon slot construction
  // -------------------------------------------------------------------------

  private createSlot(w: WeaponSlotState, i: number): void {
    const scene = this.scene
    const x = WEAP_X + i * SLOT_W + 3
    const y = BAR_Y + 6
    const def = WEAPONS[w.weaponId]
    const color = catColor(def.category)

    const base = scene.add.graphics().setDepth(DEPTH)
    base.fillStyle(0x0c1320, 0.95)
    base.fillRoundedRect(x, y, SLOT_INNER_W, SLOT_H, 6)
    base.lineStyle(1, 0x35506e, 1)
    base.strokeRoundedRect(x, y, SLOT_INNER_W, SLOT_H, 6)
    drawCategoryIcon(base, def.category, x + 14, y + 30, 13, color)
    drawTriangleBadge(base, x + 30, y + 30, 10, color)
    this.disposables.push(base)

    const num = makeText(scene, x + 6, y + 2, `${i + 1}`, 18, COLORS_CSS.textDim, {
      fontStyle: 'bold',
    }).setDepth(DEPTH)
    this.disposables.push(num)
    const name = makeText(scene, x + 6, y + 46, WEAPON_SHORT[w.weaponId], 10, COLORS_CSS.text, {
      wordWrap: { width: SLOT_INNER_W - 12 },
    }).setDepth(DEPTH)
    this.disposables.push(name)

    const radialGfx = scene.add.graphics().setDepth(DEPTH + 1)
    const borderGfx = scene.add.graphics().setDepth(DEPTH + 1)
    borderGfx.lineStyle(2, COLORS.ok, 1)
    borderGfx.strokeRoundedRect(x, y, SLOT_INNER_W, SLOT_H, 6)
    borderGfx.setVisible(false)
    const selGfx = scene.add.graphics().setDepth(DEPTH + 2)
    selGfx.lineStyle(2, color, 1)
    selGfx.strokeRoundedRect(x - 1, y - 1, SLOT_INNER_W + 2, SLOT_H + 2, 6)
    selGfx.setVisible(false)
    const statusGfx = scene.add.graphics().setDepth(DEPTH + 1)
    const statusText = makeText(scene, x + SLOT_INNER_W / 2 + 8, y + 78, '', 8, COLORS_CSS.warn)
      .setOrigin(0.5)
      .setDepth(DEPTH + 1)
    this.disposables.push(radialGfx, borderGfx, selGfx, statusGfx, statusText)

    const badgeGfx = scene.add.graphics()
    badgeGfx.fillStyle(COLORS.panel, 1)
    badgeGfx.fillCircle(0, 0, 8)
    badgeGfx.lineStyle(1.5, COLORS.ok, 1)
    badgeGfx.strokeCircle(0, 0, 8)
    const badgeText = makeText(scene, 0, 0, 'A', 10, COLORS_CSS.ok, { fontStyle: 'bold' }).setOrigin(
      0.5,
    )
    const autoBadge = scene.add.container(x + SLOT_INNER_W - 12, y + 12, [badgeGfx, badgeText])
    autoBadge.setDepth(DEPTH + 2).setVisible(false)
    this.disposables.push(autoBadge)

    const zone = scene.add
      .zone(x + SLOT_INNER_W / 2, y + SLOT_H / 2, SLOT_INNER_W, SLOT_H)
      .setInteractive()
      .setDepth(DEPTH)
    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) this.cb.onSlotRightClick(i)
      else this.cb.onSelectWeapon(i)
    })
    Tooltip.attach(zone, () => this.slotTooltip(i))
    this.disposables.push(zone)

    const slot: SlotWidget = {
      weaponId: w.weaponId,
      x,
      y,
      radialGfx,
      borderGfx,
      selGfx,
      statusGfx,
      statusText,
      autoBadge,
      zone,
      displayCharge: w.charge,
      targetCharge: w.charge,
      ready: false,
      lastKey: '',
      lastRadialKey: '',
    }
    this.slots.push(slot)
    this.redrawRadial(slot, w)
  }

  // -------------------------------------------------------------------------
  // Intents
  // -------------------------------------------------------------------------

  private systemOf(id: SystemId): SystemState | undefined {
    return this.state.systems.find((s) => s.id === id)
  }

  private adjustPower(sys: SystemState, delta: number): void {
    const next = clamp(sys.power + delta, 0, sys.level)
    if (next === sys.power) return
    this.socket.emit('battle:set_power', sys.id, next)
    this.audio.play('click')
  }

  // -------------------------------------------------------------------------
  // Tooltips
  // -------------------------------------------------------------------------

  private systemTooltip(id: SystemId): string {
    const sys = this.systemOf(id)
    if (sys === undefined) return SYSTEM_NAMES[id]
    const usable = Math.max(0, Math.floor(sys.level - sys.damage + 0.0001))
    let effect: string
    switch (id) {
      case 'weapons':
        effect = `Alimenta tus armas (${sys.power}⚡ asignada).`
        break
      case 'shields':
        effect = `Capas de escudo: ${Math.floor(sys.power / 2)} (1 por cada 2⚡).`
        break
      case 'engines':
        effect = `Evasión: +${sys.power * 5}%. Necesarios para cargar el salto.`
        break
      case 'oxygen':
        effect =
          sys.power > 0
            ? `Rellena el O2 (+${(sys.power * 1.2).toFixed(1)}%/s).`
            : 'Sin energía: el O2 de la nave cae.'
        break
      case 'medbay':
        effect = `Cura ${sys.power * 6} HP/s a los tripulantes en la sala.`
        break
      case 'cockpit': {
        const mult = COCKPIT_JUMP_MULT[clamp(usable, 1, 3) - 1] ?? 1
        effect = `Tripulada aplica la evasión de motores. Carga de salto ×${mult}.`
        break
      }
      case 'drones':
        effect = `Drones activos posibles: ${Math.min(sys.power, MAX_DRONES_ACTIVE)}.`
        break
    }
    const dmg =
      sys.damage > 0.05 ? `\nDaño: ${sys.damage.toFixed(1)} (niveles útiles: ${usable})` : ''
    return `${SYSTEM_NAMES[id]} — nivel ${sys.level}, energía ${sys.power}\n${effect}${dmg}\nClick izq: +1 energía · click dcho/rueda: −1`
  }

  private slotTooltip(i: number): string {
    const w = this.state.weapons[i]
    if (w === undefined) return ''
    const def = WEAPONS[w.weaponId]
    const ammoLine = def.usesAmmo ? '\nConsume 1 misil por andanada.' : ''
    const target =
      w.targetRoomId !== null ? '\nObjetivo fijado (click dcho en el slot: limpiar).' : ''
    const auto = w.autofire ? '\nAutodisparo Ⓐ activado.' : ''
    return (
      `${def.name} — ${CATEGORY_NAMES[def.category]} (${def.power}⚡)\n` +
      `${CATEGORY_TRIANGLE_TEXT[def.category]}\n` +
      `Daño ${def.damage}${def.shots > 1 ? `×${def.shots}` : ''} · recarga ${def.cooldown}s` +
      `${ammoLine}${target}${auto}\n` +
      `Click o tecla ${i + 1}: apuntar · A: autodisparo`
    )
  }

  // -------------------------------------------------------------------------
  // Snapshot application
  // -------------------------------------------------------------------------

  apply(state: ShipState): void {
    this.state = state

    const rKey = `${state.sparePower}/${state.reactor}`
    if (rKey !== this.reactorKey) {
      this.reactorKey = rKey
      this.redrawReactor(state.sparePower, state.reactor)
    }

    const sKey = state.systems.map((s) => `${s.id}:${s.level}:${s.power}:${s.damage.toFixed(1)}`).join('|')
    if (sKey !== this.systemsKey) {
      this.systemsKey = sKey
      this.redrawSystems()
    }

    state.weapons.forEach((w, i) => this.applySlot(w, i))

    if (
      !this.ammoNotified &&
      state.ammo === 0 &&
      state.weapons.some((w) => WEAPONS[w.weaponId].usesAmmo)
    ) {
      this.ammoNotified = true
      this.cb.onAmmoDepleted()
    }

    state.drones.forEach((d, i) => this.applyDrone(d, i))
    for (let i = state.drones.length; i < 3; i++) this.applyDrone(undefined, i)

    const j = state.jump
    const jKey = `${j.ready ? 1 : 0}|${j.blocked ?? ''}|${Math.round(j.progress * 100)}`
    if (jKey !== this.jumpKey) {
      this.jumpKey = jKey
      this.redrawJump()
    }
  }

  private redrawReactor(spare: number, total: number): void {
    const g = this.reactorGfx
    g.clear()
    for (let i = 0; i < total; i++) {
      const col = Math.floor(i / 13)
      const row = i % 13
      const px = REACTOR_X + 6 + col * 28
      const py = BAR_Y + 112 - row * 8
      if (i < spare) {
        g.fillStyle(COLORS.energy, 1)
        g.fillRect(px, py, 24, 6)
      } else {
        g.lineStyle(1, COLORS.textDim, 0.7)
        g.strokeRect(px, py, 24, 6)
      }
    }
  }

  private redrawSystems(): void {
    const g = this.systemsGfx
    g.clear()
    this.installedSystems.forEach((sysId, idx) => {
      const sys = this.systemOf(sysId)
      if (sys === undefined) return
      const cx = SYS_X + idx * SYS_COL_W + SYS_COL_W / 2
      const usable = Math.max(0, Math.floor(sys.level - sys.damage + 0.0001))
      const damagedPips = sys.level - usable
      const destroyed = usable <= 0
      const iconColor = destroyed ? COLORS.danger : damagedPips > 0 ? COLORS.warn : COLORS.textDim
      drawSystemIcon(g, sysId, cx, BAR_Y + 124, 15, iconColor)
      if (destroyed) drawCrossOut(g, cx, BAR_Y + 124, 17, COLORS.danger)

      for (let i = 0; i < sys.level; i++) {
        const py = BAR_Y + 106 - i * 8
        if (i >= usable) {
          // Damaged level: red cross instead of a pip.
          g.lineStyle(1.5, COLORS.danger, 1)
          g.lineBetween(cx - 8, py, cx + 8, py + 6)
          g.lineBetween(cx + 8, py, cx - 8, py + 6)
        } else if (i < sys.power) {
          g.fillStyle(COLORS.energy, 1)
          g.fillRect(cx - 11, py, 22, 6)
        } else {
          g.lineStyle(1, COLORS.textDim, 0.8)
          g.strokeRect(cx - 11, py, 22, 6)
        }
      }
    })
  }

  private applySlot(w: WeaponSlotState, i: number): void {
    const slot = this.slots[i]
    if (slot === undefined) return
    slot.targetCharge = w.charge
    const def = WEAPONS[w.weaponId]
    const noAmmo = def.usesAmmo && this.state.ammo <= 0
    const ready = w.powered && !noAmmo && w.charge >= 1
    slot.ready = ready

    const key = `${w.powered ? 1 : 0}|${noAmmo ? 1 : 0}|${ready ? 1 : 0}|${w.autofire ? 1 : 0}|${this.selectedSlot === i ? 1 : 0}`
    if (key === slot.lastKey) return
    slot.lastKey = key

    slot.autoBadge.setVisible(w.autofire)
    slot.selGfx.setVisible(this.selectedSlot === i)
    slot.borderGfx.setVisible(ready)

    slot.statusGfx.clear()
    if (!w.powered) {
      drawPlugCrossed(slot.statusGfx, slot.x + 14, slot.y + 78, 12, COLORS.textDim)
      slot.statusText.setText('SIN ENERGÍA')
    } else if (noAmmo) {
      drawMissileIcon(slot.statusGfx, slot.x + 14, slot.y + 78, 12, COLORS.warn, true)
      slot.statusText.setText('SIN MUNICIÓN')
    } else if (ready) {
      slot.statusText.setText('LISTA')
      slot.statusText.setColor(COLORS_CSS.ok)
      return
    } else {
      slot.statusText.setText('CARGANDO…')
      slot.statusText.setColor(COLORS_CSS.textDim)
      return
    }
    slot.statusText.setColor(COLORS_CSS.warn)
  }

  private redrawRadial(slot: SlotWidget, w: { powered: boolean }): void {
    const g = slot.radialGfx
    const cx = slot.x + SLOT_INNER_W - 24
    const cy = slot.y + 30
    const r = 15
    const def = WEAPONS[slot.weaponId]
    const color = catColor(def.category)
    g.clear()
    g.fillStyle(0x05080f, 0.9)
    g.fillCircle(cx, cy, r)
    g.lineStyle(1.5, w.powered ? 0x35506e : 0x222c3d, 1)
    g.strokeCircle(cx, cy, r)
    const charge = clamp(slot.displayCharge, 0, 1)
    if (charge > 0 && w.powered) {
      if (charge >= 1) {
        g.fillStyle(COLORS.ok, 0.85)
        g.fillCircle(cx, cy, r - 3)
      } else {
        g.fillStyle(color, 0.8)
        g.slice(cx, cy, r - 3, -Math.PI / 2, -Math.PI / 2 + charge * Math.PI * 2, false)
        g.fillPath()
      }
    }
  }

  private applyDrone(d: DroneSlotState | undefined, i: number): void {
    const widget = this.droneWidgets[i]
    if (widget === undefined) return
    const key = d === undefined ? 'empty' : `${d.droneId}|${d.enabled ? 1 : 0}|${d.powered ? 1 : 0}`
    if (key === widget.lastKey) return
    widget.lastKey = key

    const g = widget.gfx
    const x = DRONE_X + i * DRONE_STEP
    const y = BAR_Y + 14
    g.clear()
    if (d === undefined) {
      g.lineStyle(1, 0x35506e, 0.6)
      g.strokeRoundedRect(x, y, 54, 106, 6)
      g.lineStyle(1.5, COLORS.textDim, 0.5)
      g.lineBetween(x + 20, y + 53, x + 34, y + 53)
      return
    }
    const active = d.enabled && d.powered
    const dim = d.enabled && !d.powered
    const borderColor = active ? COLORS.ok : dim ? COLORS.warn : 0x35506e
    g.fillStyle(0x0c1320, 0.95)
    g.fillRoundedRect(x, y, 54, 106, 6)
    g.lineStyle(1.5, borderColor, 1)
    g.strokeRoundedRect(x, y, 54, 106, 6)

    const iconColor = active ? COLORS.text : COLORS.textDim
    const alpha = d.enabled ? 1 : 0.45
    g.fillStyle(iconColor, alpha)
    g.lineStyle(1.5, iconColor, alpha)
    // Hexagonal drone chassis + role glyph.
    g.beginPath()
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k - Math.PI / 6
      const px = x + 27 + Math.cos(a) * 15
      const py = y + 26 + Math.sin(a) * 15
      if (k === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.closePath()
    g.strokePath()
    const def = DRONES[d.droneId]
    if (def.kind === 'offensive') {
      g.strokeCircle(x + 27, y + 26, 6)
      g.lineBetween(x + 27 - 9, y + 26, x + 27 + 9, y + 26)
      g.lineBetween(x + 27, y + 26 - 9, x + 27, y + 26 + 9)
    } else if (def.kind === 'defensive') {
      drawSystemIcon(g, 'shields', x + 27, y + 26, 11, iconColor)
    } else {
      drawTaskIcon(g, 'repair', x + 27, y + 26, 11, iconColor)
    }
    if (dim) drawPlugCrossed(g, x + 27, y + 56, 11, COLORS.warn)

    // On/off status as shape + color (check mark vs cross), never color alone.
    g.fillStyle(active ? COLORS.ok : COLORS.textDim, 1)
    g.fillCircle(x + 12, y + 90, 3)
    g.lineStyle(1.5, active ? COLORS.ok : COLORS.textDim, 1)
    if (d.enabled) {
      g.lineBetween(x + 22, y + 90, x + 26, y + 94)
      g.lineBetween(x + 26, y + 94, x + 36, y + 84)
    } else {
      g.lineBetween(x + 22, y + 85, x + 32, y + 95)
      g.lineBetween(x + 32, y + 85, x + 22, y + 95)
    }
  }

  private redrawJump(): void {
    const j = this.state.jump
    const g = this.jumpGfx
    g.clear()
    const border = j.ready
      ? j.blocked === 'no_crew'
        ? COLORS.warn
        : COLORS.ok
      : j.blocked === 'no_engine_power'
        ? COLORS.warn
        : COLORS.panelBorder
    g.fillStyle(0x0c1320, 0.95)
    g.fillRoundedRect(JUMP_X, BAR_Y + 8, JUMP_W, 118, 6)
    g.lineStyle(2, border, 1)
    g.strokeRoundedRect(JUMP_X, BAR_Y + 8, JUMP_W, 118, 6)

    if (j.ready && j.blocked === 'no_crew') {
      this.jumpTitle.setText('SALTO LISTO')
      this.jumpTitle.setColor(COLORS_CSS.warn)
      this.jumpReason.setText('Tripula los motores para saltar')
      this.jumpReason.setColor(COLORS_CSS.warn)
    } else if (j.ready) {
      this.jumpTitle.setText('¡SALTO LISTO!')
      this.jumpTitle.setColor(COLORS_CSS.ok)
      this.jumpReason.setText('[J] Huir del combate')
      this.jumpReason.setColor(COLORS_CSS.textDim)
    } else if (j.blocked === 'no_engine_power') {
      this.jumpTitle.setText('SALTO')
      this.jumpTitle.setColor(COLORS_CSS.textDim)
      this.jumpReason.setText('Motores sin energía')
      this.jumpReason.setColor(COLORS_CSS.warn)
    } else {
      this.jumpTitle.setText('CARGANDO SALTO')
      this.jumpTitle.setColor(COLORS_CSS.text)
      this.jumpReason.setText(`${Math.round(j.progress * 100)}%`)
      this.jumpReason.setColor(COLORS_CSS.textDim)
    }
    this.jumpBar.setValue(clamp(j.progress, 0, 1))
  }

  // -------------------------------------------------------------------------
  // Per-frame
  // -------------------------------------------------------------------------

  update(time: number, dtMs: number): void {
    const k = Math.min(1, (dtMs / 1000) * 9)
    this.state.weapons.forEach((w, i) => {
      const slot = this.slots[i]
      if (slot === undefined) return
      slot.displayCharge += (slot.targetCharge - slot.displayCharge) * k
      if (Math.abs(slot.targetCharge - slot.displayCharge) < 0.004) {
        slot.displayCharge = slot.targetCharge
      }
      // Redraw on any visual change — charge OR powered state — so a weapon
      // powered/charged during a tactical pause still shows its fill immediately.
      const radialKey = `${Math.round(clamp(slot.displayCharge, 0, 1) * 100)}|${w.powered ? 1 : 0}`
      if (radialKey !== slot.lastRadialKey) {
        slot.lastRadialKey = radialKey
        this.redrawRadial(slot, w)
      }
      if (slot.ready) slot.borderGfx.setAlpha(0.55 + 0.45 * Math.sin(time / 170))
    })
  }

  // -------------------------------------------------------------------------
  // Targeting integration / tutorial geometry
  // -------------------------------------------------------------------------

  setSelectedSlot(slot: number | null): void {
    this.selectedSlot = slot
    this.slots.forEach((s, i) => {
      s.selGfx.setVisible(slot === i)
      s.lastKey = ''
    })
  }

  slotAnchor(i: number): Vec2 {
    return { x: WEAP_X + i * SLOT_W + 3 + SLOT_INNER_W / 2, y: BAR_Y + 4 }
  }

  slotRect(i: number): Rect {
    return { x: WEAP_X + i * SLOT_W + 3, y: BAR_Y + 6, w: SLOT_INNER_W, h: SLOT_H }
  }

  slotCount(): number {
    return this.slots.length
  }

  systemColumnRect(id: SystemId): Rect | null {
    const idx = this.installedSystems.indexOf(id)
    if (idx < 0) return null
    return { x: SYS_X + idx * SYS_COL_W, y: BAR_Y + 40, w: SYS_COL_W, h: 95 }
  }

  jumpRect(): Rect {
    return { x: JUMP_X, y: BAR_Y + 8, w: JUMP_W, h: 118 }
  }

  destroy(): void {
    for (const d of this.disposables) d.destroy()
    this.disposables.length = 0
    this.jumpBar.destroy()
    for (const s of this.slots) {
      s.radialGfx.destroy()
      s.borderGfx.destroy()
      s.selGfx.destroy()
      s.statusGfx.destroy()
      s.statusText.destroy()
      s.autoBadge.destroy()
      s.zone.destroy()
    }
    this.slots.length = 0
  }
}
