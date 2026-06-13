// In-game escape menu (ESC): Reanudar · Opciones · Cómo jugar · Abandonar.
//
// One instance per gameplay scene. The scene wires ESC to toggle() and supplies
// the context-specific "abandon" action (surrender a battle / abandon a run) plus
// optional open/close hooks (e.g. pause the fight while the menu is up). Options
// and how-to reuse the shared builders in overlays.ts. Everything lives above the
// CRT so the menu is always crisp and on top.

import type Phaser from 'phaser'
import { COLORS, GAME_HEIGHT, GAME_WIDTH } from '../theme'
import type { ICrtOverlay } from '../contracts'
import { Button } from './button'
import { applyUiScale, textStyle } from './helpers'
import { fillHowTo, fillOptions, openModal, type ModalHandle } from './overlays'
import { getAudio } from '../audio/engine'
import { getNet } from '../net/socket'

const MENU_DEPTH = 12000
const CHILD_DEPTH = 12200

export interface EscapeMenuOpts {
  /** Label for the destructive button, e.g. 'ABANDONAR' or 'RENDIRSE'. */
  abandonLabel: string
  /** Body text of the confirmation dialog. */
  abandonConfirm: string
  /** Runs when the player confirms abandon (emit surrender / run:abandon). */
  onAbandon: () => void
  /** Scene CRT overlay, for the live CRT toggle. */
  crt?: ICrtOverlay | null
  /** Whether the uiScale slider should live-apply to this scene (menus/run only). */
  applyUiScaleLive?: boolean
  /** Fires when the menu opens (e.g. pause the battle). */
  onOpen?: () => void
  /** Fires when the menu closes without abandoning (e.g. resume the battle). */
  onClose?: () => void
}

export class EscapeMenu {
  private readonly scene: Phaser.Scene
  private readonly opts: EscapeMenuOpts
  private menu: ModalHandle | null = null
  private child: ModalHandle | null = null

  constructor(scene: Phaser.Scene, opts: EscapeMenuOpts) {
    this.scene = scene
    this.opts = opts
  }

  get isOpen(): boolean {
    return this.menu !== null
  }

  /** ESC behaviour: close the child if any, else close the menu, else open it. */
  toggle(): void {
    if (this.child) {
      this.closeChild()
    } else if (this.menu) {
      this.close()
    } else {
      this.open()
    }
  }

  open(): void {
    if (this.menu) return
    getAudio().play('click')
    this.opts.onOpen?.()

    const w = 360
    const h = 384
    const m = openModal(this.scene, w, h, 'MENÚ', MENU_DEPTH)
    const cx = GAME_WIDTH / 2
    const top = (GAME_HEIGHT - h) / 2

    this.addButton(m, cx, top + 90, 'REANUDAR', 'primary', () => this.close())
    this.addButton(m, cx, top + 150, 'OPCIONES', 'ghost', () => this.openOptions())
    this.addButton(m, cx, top + 210, 'CÓMO JUGAR', 'ghost', () => this.openHowTo())
    this.addButton(m, cx, top + 300, this.opts.abandonLabel, 'danger', () => this.openConfirm())

    this.menu = m
  }

  close(): void {
    this.closeChild()
    if (this.menu) {
      this.menu.close()
      this.menu = null
      this.opts.onClose?.()
    }
  }

  destroy(): void {
    this.closeChild()
    this.menu?.close()
    this.menu = null
  }

  // --- children (drawn above the menu) -------------------------------------

  private openOptions(): void {
    this.closeChild()
    const m = openModal(this.scene, 560, 484, 'OPCIONES', CHILD_DEPTH)
    fillOptions(this.scene, m.panel, {
      crt: this.opts.crt ?? null,
      onUiScale: this.opts.applyUiScaleLive ? (v) => applyUiScale(this.scene, v) : undefined,
    })
    this.addButton(m, GAME_WIDTH / 2, (GAME_HEIGHT + 484) / 2 - 34, 'CERRAR', 'ghost', () =>
      this.closeChild(),
    )
    this.child = m
  }

  private openHowTo(): void {
    this.closeChild()
    const m = openModal(this.scene, 860, 600, 'CÓMO JUGAR', CHILD_DEPTH)
    fillHowTo(this.scene, m.panel)
    this.addButton(m, GAME_WIDTH / 2, (GAME_HEIGHT + 600) / 2 - 34, 'CERRAR', 'ghost', () =>
      this.closeChild(),
    )
    this.child = m
  }

  private openConfirm(): void {
    this.closeChild()
    const w = 500
    const h = 240
    const m = openModal(this.scene, w, h, '¿ESTÁS SEGURO?', CHILD_DEPTH)
    m.panel.add(
      this.scene.add.text(24, m.panel.contentTop + 14, this.opts.abandonConfirm, {
        ...textStyle('body', 15, COLORS.text),
        wordWrap: { width: w - 48 },
        lineSpacing: 4,
      }),
    )
    const cy = (GAME_HEIGHT + h) / 2 - 40
    this.addButton(m, GAME_WIDTH / 2 - 110, cy, this.opts.abandonLabel, 'danger', () => {
      this.opts.onAbandon()
      this.close()
    })
    this.addButton(m, GAME_WIDTH / 2 + 110, cy, 'CANCELAR', 'ghost', () => this.closeChild())
    this.child = m
  }

  private closeChild(): void {
    if (this.child) {
      this.child.close()
      this.child = null
    }
  }

  private addButton(
    m: ModalHandle,
    x: number,
    y: number,
    label: string,
    variant: 'primary' | 'ghost' | 'danger',
    onClick: () => void,
  ): void {
    const btn = new Button(this.scene, x, y, label, onClick, { width: 240, height: 46, variant })
    m.container.add(btn)
  }
}

/**
 * Installs the standard expedition escape menu on a run scene (sector map, event,
 * shop, upgrade): ESC opens it, and "Abandonar" ends the whole run (run:abandon),
 * losing all progress. Auto-cleans on scene shutdown.
 */
export function installRunEscapeMenu(scene: Phaser.Scene, crt: ICrtOverlay | null): EscapeMenu {
  const menu = new EscapeMenu(scene, {
    abandonLabel: 'ABANDONAR',
    abandonConfirm:
      'Abandonarás la expedición. Perderás todo el progreso, la chatarra acumulada y la nave.',
    onAbandon: () => getNet().socket.emit('run:abandon'),
    crt,
    applyUiScaleLive: true,
  })
  scene.input.keyboard?.on('keydown-ESC', () => menu.toggle())
  const off = (): void => menu.destroy()
  scene.events.once('shutdown', off)
  scene.events.once('destroy', off)
  return menu
}
