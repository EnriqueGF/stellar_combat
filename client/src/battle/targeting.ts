// Single input state machine for the battle (GAME_SPEC §6.3): weapon targeting
// (crosshair + persistent target lines with slot badges) and crew move orders.
// Selecting a weapon deselects the crew member and vice versa. ESC / right
// click cancels; right click on a targeted room (or its slot) clears it.
// Targeting also works while the tactical pause is active.

import type Phaser from 'phaser'
import { WEAPONS, type ShipState } from '@stellar/shared'
import type { IAudioEngine, TypedSocket } from '../contracts'
import { COLORS, catColor, catDash } from '../theme'
import { cssOf, drawDashedLine, makeText } from './common'
import type { BottomHud } from './hud'
import type { CrewPortraits } from './portraits'
import type { ShipView } from './shipView'

const LINE_DEPTH = 8
const CROSSHAIR_DEPTH = 650

export type Selection =
  | { kind: 'none' }
  | { kind: 'weapon'; slot: number }
  | { kind: 'crew'; crewId: string }

export interface TargetingDeps {
  scene: Phaser.Scene
  socket: TypedSocket
  audio: IAudioEngine
  playerView: ShipView
  enemyView: ShipView
  hud: BottomHud
  portraits: CrewPortraits
  getYou(): ShipState
}

interface Badge {
  container: Phaser.GameObjects.Container
}

export class TargetingController {
  private readonly d: TargetingDeps
  private selection: Selection = { kind: 'none' }
  private readonly lineGfx: Phaser.GameObjects.Graphics
  private readonly crosshair: Phaser.GameObjects.Graphics
  private readonly badges: Badge[] = []
  private linesKey = ''
  private hoverRoom: number | null = null
  private readonly onPointerMove: (pointer: Phaser.Input.Pointer) => void
  private readonly onPointerDown: (
    pointer: Phaser.Input.Pointer,
    objects: Phaser.GameObjects.GameObject[],
  ) => void

  constructor(deps: TargetingDeps) {
    this.d = deps
    const scene = deps.scene

    this.lineGfx = scene.add.graphics().setDepth(LINE_DEPTH)
    this.crosshair = scene.add.graphics().setDepth(CROSSHAIR_DEPTH).setVisible(false)

    for (let i = 0; i < deps.hud.slotCount(); i++) {
      const w = deps.getYou().weapons[i]
      const color = w !== undefined ? catColor(WEAPONS[w.weaponId].category) : COLORS.text
      const g = scene.add.graphics()
      g.fillStyle(COLORS.panel, 0.95)
      g.fillCircle(0, 0, 9)
      g.lineStyle(1.5, color, 1)
      g.strokeCircle(0, 0, 9)
      const t = makeText(scene, 0, 0, `${i + 1}`, 11, cssOf(color), { fontStyle: 'bold' }).setOrigin(
        0.5,
      )
      const container = scene.add.container(0, 0, [g, t]).setDepth(LINE_DEPTH + 1).setVisible(false)
      this.badges.push({ container })
    }

    // Ship view callbacks.
    deps.enemyView.onRoomClick = (roomId, right) => this.enemyRoomClick(roomId, right)
    deps.enemyView.onRoomHover = (roomId) => {
      this.hoverRoom = roomId
      this.refreshHover()
    }
    deps.playerView.onRoomClick = (roomId, right) => this.playerRoomClick(roomId, right)
    deps.playerView.onCrewClick = (crewId) => this.selectCrew(crewId)

    // Global pointer handlers.
    this.onPointerMove = (pointer) => {
      if (this.selection.kind === 'weapon') {
        this.crosshair.setPosition(pointer.worldX, pointer.worldY)
      }
    }
    this.onPointerDown = (pointer, objects) => {
      if (pointer.rightButtonDown() && objects.length === 0) this.clearSelection()
    }
    scene.input.on('pointermove', this.onPointerMove)
    scene.input.on('pointerdown', this.onPointerDown)

    // Keyboard shortcuts: 1-4 select weapon, ESC cancels, A toggles autofire.
    const kb = scene.input.keyboard
    if (kb !== null) {
      const keys: [string, number][] = [
        ['keydown-ONE', 0],
        ['keydown-TWO', 1],
        ['keydown-THREE', 2],
        ['keydown-FOUR', 3],
      ]
      for (const [event, slot] of keys) {
        kb.on(event, () => this.selectWeapon(slot))
      }
      kb.on('keydown-ESC', () => this.clearSelection())
      kb.on('keydown-A', () => {
        if (this.selection.kind === 'weapon') {
          this.d.socket.emit('battle:toggle_autofire', this.selection.slot)
          this.d.audio.play('click')
        }
      })
    }
  }

  // -------------------------------------------------------------------------
  // Selection state
  // -------------------------------------------------------------------------

  getSelection(): Selection {
    return this.selection
  }

  selectWeapon(slot: number): void {
    if (slot >= this.d.hud.slotCount()) return
    if (this.selection.kind === 'weapon' && this.selection.slot === slot) {
      this.clearSelection()
      return
    }
    this.selection = { kind: 'weapon', slot }
    this.d.hud.setSelectedSlot(slot)
    this.d.portraits.setSelected(null)
    this.d.playerView.setCrewSelected(null)
    this.d.audio.play('click')
    this.redrawCrosshair(slot)
    this.crosshair.setVisible(true)
    const pointer = this.d.scene.input.activePointer
    this.crosshair.setPosition(pointer.worldX, pointer.worldY)
    this.refreshHover()
  }

  selectCrew(crewId: string): void {
    const member = this.d.getYou().crew.find((c) => c.id === crewId)
    if (member === undefined || member.hp <= 0) return
    this.selection = { kind: 'crew', crewId }
    this.d.hud.setSelectedSlot(null)
    this.d.portraits.setSelected(crewId)
    this.d.playerView.setCrewSelected(crewId)
    this.crosshair.setVisible(false)
    this.d.enemyView.setRoomHover(null, 0)
    this.d.audio.play('click')
  }

  clearSelection(): void {
    if (this.selection.kind === 'none') return
    this.selection = { kind: 'none' }
    this.d.hud.setSelectedSlot(null)
    this.d.portraits.setSelected(null)
    this.d.playerView.setCrewSelected(null)
    this.crosshair.setVisible(false)
    this.d.enemyView.setRoomHover(null, 0)
  }

  /** Right click on a HUD slot: clear its target if set, else toggle autofire. */
  onSlotRightClick(slot: number): void {
    const w = this.d.getYou().weapons[slot]
    if (w === undefined) return
    if (w.targetRoomId !== null) {
      this.d.socket.emit('battle:set_target', slot, null)
    } else {
      this.d.socket.emit('battle:toggle_autofire', slot)
    }
    this.d.audio.play('click')
  }

  // -------------------------------------------------------------------------
  // Room clicks
  // -------------------------------------------------------------------------

  private enemyRoomClick(roomId: number, right: boolean): void {
    if (right) {
      const slots = this.slotsTargeting(roomId)
      if (slots.length > 0) {
        for (const s of slots) this.d.socket.emit('battle:set_target', s, null)
        this.d.audio.play('click')
      } else {
        this.clearSelection()
      }
      return
    }
    if (this.selection.kind === 'weapon') {
      this.d.socket.emit('battle:set_target', this.selection.slot, roomId)
      this.d.audio.play('click')
      this.clearSelection()
    }
  }

  private playerRoomClick(roomId: number, right: boolean): void {
    if (right) {
      this.clearSelection()
      return
    }
    if (this.selection.kind === 'crew') {
      this.d.socket.emit('battle:move_crew', this.selection.crewId, roomId)
      this.d.audio.play('click')
    } else if (this.selection.kind === 'weapon') {
      // Clicks on your own ship while targeting only cancel the selection.
      this.clearSelection()
    }
  }

  private slotsTargeting(roomId: number): number[] {
    const out: number[] = []
    this.d.getYou().weapons.forEach((w, i) => {
      if (w.targetRoomId === roomId) out.push(i)
    })
    return out
  }

  // -------------------------------------------------------------------------
  // Visuals
  // -------------------------------------------------------------------------

  private refreshHover(): void {
    if (this.selection.kind === 'weapon' && this.hoverRoom !== null) {
      const w = this.d.getYou().weapons[this.selection.slot]
      const color = w !== undefined ? catColor(WEAPONS[w.weaponId].category) : COLORS.text
      this.d.enemyView.setRoomHover(this.hoverRoom, color)
    } else {
      this.d.enemyView.setRoomHover(null, 0)
    }
  }

  private redrawCrosshair(slot: number): void {
    const w = this.d.getYou().weapons[slot]
    const color = w !== undefined ? catColor(WEAPONS[w.weaponId].category) : COLORS.text
    const g = this.crosshair
    g.clear()
    g.lineStyle(1.5, color, 0.95)
    g.strokeCircle(0, 0, 11)
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ] as const) {
      g.lineBetween(dx * 7, dy * 7, dx * 16, dy * 16)
    }
    g.fillStyle(color, 1)
    g.fillCircle(0, 0, 1.5)
  }

  /** Redraws persistent target lines when targets change (called on snapshot). */
  refresh(you: ShipState): void {
    const key = you.weapons.map((w) => `${w.targetRoomId ?? 'x'}`).join(',')
    if (key === this.linesKey) return
    this.linesKey = key

    const g = this.lineGfx
    g.clear()
    you.weapons.forEach((w, i) => {
      const badge = this.badges[i]
      if (w.targetRoomId === null) {
        badge?.container.setVisible(false)
        return
      }
      const def = WEAPONS[w.weaponId]
      const color = catColor(def.category)
      const from = this.d.hud.slotAnchor(i)
      const to = this.d.enemyView.roomCenter(w.targetRoomId)
      g.lineStyle(1.5, color, 0.7)
      drawDashedLine(g, from.x, from.y, to.x, to.y, catDash(def.category))

      // Corner brackets on the targeted room.
      const rr = this.d.enemyView.roomRect(w.targetRoomId)
      if (rr !== null) {
        g.lineStyle(2, color, 0.95)
        const s = 7
        g.lineBetween(rr.x, rr.y, rr.x + s, rr.y)
        g.lineBetween(rr.x, rr.y, rr.x, rr.y + s)
        g.lineBetween(rr.x + rr.w, rr.y, rr.x + rr.w - s, rr.y)
        g.lineBetween(rr.x + rr.w, rr.y, rr.x + rr.w, rr.y + s)
        g.lineBetween(rr.x, rr.y + rr.h, rr.x + s, rr.y + rr.h)
        g.lineBetween(rr.x, rr.y + rr.h, rr.x, rr.y + rr.h - s)
        g.lineBetween(rr.x + rr.w, rr.y + rr.h, rr.x + rr.w - s, rr.y + rr.h)
        g.lineBetween(rr.x + rr.w, rr.y + rr.h, rr.x + rr.w, rr.y + rr.h - s)
      }

      if (badge !== undefined) {
        badge.container.setPosition((from.x + to.x) / 2, (from.y + to.y) / 2)
        badge.container.setVisible(true)
      }
    })
  }

  destroy(): void {
    this.d.scene.input.off('pointermove', this.onPointerMove)
    this.d.scene.input.off('pointerdown', this.onPointerDown)
    this.lineGfx.destroy()
    this.crosshair.destroy()
    for (const b of this.badges) b.container.destroy()
    this.badges.length = 0
  }
}
