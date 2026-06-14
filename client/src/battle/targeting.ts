// Single input state machine for the battle (GAME_SPEC §6.3): weapon targeting
// (crosshair + persistent target lines with slot badges) and crew move orders.
// Selecting a weapon deselects the crew member and vice versa. Right click
// cancels the selection; right click on a targeted room (or its slot) clears it.
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
const MARQUEE_DEPTH = 640
/** Pixels the pointer must travel before a press becomes a marquee drag. */
const DRAG_THRESHOLD = 6

function pointInRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
}

export type Selection =
  | { kind: 'none' }
  | { kind: 'weapon'; slot: number }
  | { kind: 'crew'; crewIds: string[] }

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
  private readonly marquee: Phaser.GameObjects.Graphics
  private readonly badges: Badge[] = []
  private linesKey = ''
  private hoverRoom: number | null = null
  /** Marquee drag state (crew box-select on the player ship). */
  private dragStart: { x: number; y: number } | null = null
  private dragging = false
  private marqueeEligible = false
  /** True when the press landed on a door (its zone handles the toggle, so the
   *  pointerup must NOT also move crew or cancel a weapon). */
  private pressedDoor = false
  private readonly onPointerMove: (pointer: Phaser.Input.Pointer) => void
  private readonly onPointerDown: (pointer: Phaser.Input.Pointer) => void
  private readonly onPointerUp: (pointer: Phaser.Input.Pointer) => void

  constructor(deps: TargetingDeps) {
    this.d = deps
    const scene = deps.scene

    this.lineGfx = scene.add.graphics().setDepth(LINE_DEPTH)
    this.crosshair = scene.add.graphics().setDepth(CROSSHAIR_DEPTH).setVisible(false)
    this.marquee = scene.add.graphics().setDepth(MARQUEE_DEPTH)

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

    // Enemy ship: weapon targeting on click + hover. The PLAYER ship is driven by
    // the pointer handlers below, so a click moves the selected crew and a drag
    // box-selects several at once (the room/crew zones would fire on pointerDOWN,
    // which can't tell a click from the start of a drag).
    deps.enemyView.onRoomClick = (roomId, right) => this.enemyRoomClick(roomId, right)
    deps.enemyView.onRoomHover = (roomId) => {
      this.hoverRoom = roomId
      this.refreshHover()
    }

    this.onPointerMove = (pointer) => this.handlePointerMove(pointer)
    this.onPointerDown = (pointer) => this.handlePointerDown(pointer)
    this.onPointerUp = (pointer) => this.handlePointerUp(pointer)
    scene.input.on('pointermove', this.onPointerMove)
    scene.input.on('pointerdown', this.onPointerDown)
    scene.input.on('pointerup', this.onPointerUp)

    // Keyboard shortcuts: 1-4 select weapon, A toggles autofire. (ESC opens the
    // escape menu now; right-click still cancels the current selection.)
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
    this.selectCrewMany([crewId])
  }

  /** Selects every given crew id that is still alive (box-select / portrait click). */
  selectCrewMany(ids: string[]): void {
    const living = ids.filter((id) => {
      const m = this.d.getYou().crew.find((c) => c.id === id)
      return m !== undefined && m.hp > 0
    })
    if (living.length === 0) {
      this.clearSelection()
      return
    }
    this.selection = { kind: 'crew', crewIds: living }
    this.d.hud.setSelectedSlot(null)
    this.d.portraits.setSelected(living)
    this.d.playerView.setCrewSelected(living)
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

  // -------------------------------------------------------------------------
  // Player-ship pointer handling (click-to-move + drag box-select)
  // -------------------------------------------------------------------------

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.selection.kind === 'weapon') {
      this.crosshair.setPosition(pointer.worldX, pointer.worldY)
      return
    }
    if (this.dragStart === null || !pointer.isDown || !pointer.leftButtonDown()) return
    const dx = pointer.worldX - this.dragStart.x
    const dy = pointer.worldY - this.dragStart.y
    if (!this.dragging && dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return
    if (!this.marqueeEligible) return
    this.dragging = true
    this.drawMarquee(this.dragStart, pointer)
    // Live preview of who the box currently covers.
    this.d.playerView.setCrewSelected(
      this.d.playerView.crewInRect(this.dragStart.x, this.dragStart.y, pointer.worldX, pointer.worldY),
    )
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    const onPlayer = pointInRect(pointer.worldX, pointer.worldY, this.d.playerView.hullBounds())
    this.pressedDoor = onPlayer && this.d.playerView.doorAtWorld(pointer.worldX, pointer.worldY)

    if (pointer.rightButtonDown()) {
      // Right click is the MOVE / cancel command, resolved on pointerup.
      this.dragStart = null
      return
    }
    // Left press: select on click, box-select on drag.
    this.dragging = false
    this.dragStart = { x: pointer.worldX, y: pointer.worldY }
    this.marqueeEligible = this.selection.kind !== 'weapon' && !this.pressedDoor && onPlayer
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    const start = this.dragStart
    const onDoor = this.pressedDoor
    this.dragStart = null
    this.pressedDoor = false

    // Finalize a left-drag marquee.
    if (this.dragging) {
      this.dragging = false
      this.marquee.clear()
      if (start !== null) {
        const ids = this.d.playerView.crewInRect(start.x, start.y, pointer.worldX, pointer.worldY)
        if (ids.length > 0) this.selectCrewMany(ids)
        else this.clearSelection()
      }
      return
    }

    const onPlayer = pointInRect(pointer.worldX, pointer.worldY, this.d.playerView.hullBounds())

    // RIGHT click = order the selected crew to a room (RTS-style), else cancel.
    if (pointer.rightButtonReleased()) {
      if (onDoor) return // a door click only toggles the door
      if (onPlayer && this.selection.kind === 'crew') {
        const roomId = this.d.playerView.roomAtWorld(pointer.worldX, pointer.worldY)
        if (roomId !== null) {
          this.issueMove(roomId)
          return
        }
      }
      // Over the enemy ship its room zone already handled the click; otherwise a
      // right click cancels the current selection.
      if (!pointInRect(pointer.worldX, pointer.worldY, this.d.enemyView.hullBounds())) {
        this.clearSelection()
      }
      return
    }

    // LEFT click on the player ship = select a crew token, or deselect.
    if (!pointer.leftButtonReleased()) return
    if (onDoor) return
    if (!onPlayer) return
    const crewId = this.d.playerView.crewAtWorld(pointer.worldX, pointer.worldY)
    if (crewId !== null) {
      this.selectCrew(crewId)
      return
    }
    // Empty spot on your own ship: clear the selection (and cancel any weapon).
    this.clearSelection()
  }

  /** Sends every selected crew member to a room; keeps the selection for follow-ups. */
  private issueMove(roomId: number): void {
    if (this.selection.kind !== 'crew') return
    for (const id of this.selection.crewIds) {
      this.d.socket.emit('battle:move_crew', id, roomId)
    }
    this.d.audio.play('click')
  }

  private drawMarquee(start: { x: number; y: number }, pointer: Phaser.Input.Pointer): void {
    const x = Math.min(start.x, pointer.worldX)
    const y = Math.min(start.y, pointer.worldY)
    const w = Math.abs(pointer.worldX - start.x)
    const h = Math.abs(pointer.worldY - start.y)
    const g = this.marquee
    g.clear()
    g.fillStyle(COLORS.ok, 0.1)
    g.fillRect(x, y, w, h)
    g.lineStyle(1.5, COLORS.ok, 0.9)
    g.strokeRect(x, y, w, h)
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
    // Drop any dead crew from a multi-selection so orders and rings stay valid.
    // Skipped mid-drag so it doesn't fight the live marquee preview rings.
    if (this.selection.kind === 'crew' && !this.dragging) {
      const living = this.selection.crewIds.filter((id) => {
        const m = you.crew.find((c) => c.id === id)
        return m !== undefined && m.hp > 0
      })
      if (living.length !== this.selection.crewIds.length) {
        if (living.length === 0) this.clearSelection()
        else {
          this.selection = { kind: 'crew', crewIds: living }
          this.d.portraits.setSelected(living)
          this.d.playerView.setCrewSelected(living)
        }
      }
    }

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
    this.d.scene.input.off('pointerup', this.onPointerUp)
    this.lineGfx.destroy()
    this.crosshair.destroy()
    this.marquee.destroy()
    for (const b of this.badges) b.container.destroy()
    this.badges.length = 0
  }
}
