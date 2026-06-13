// First-battle guided tutorial (GAME_SPEC §6.3): 6 steps with a dark cutout
// around the highlighted element, arrow + text panel, "Siguiente" and "Saltar
// tutorial" buttons, plus one-shot contextual hints (no ammo, first jump
// confirm). The battle keeps running behind the overlay; the highlighted
// elements stay clickable (the dim layer is not interactive).

import type Phaser from 'phaser'
import type { WeaponCategory } from '@stellar/shared'
import type { IAudioEngine } from '../contracts'
import { COLORS, COLORS_CSS, GAME_HEIGHT, GAME_WIDTH } from '../theme'
import { CATEGORY_NAMES, makeText, makeTitleText, type Rect } from './common'
import { drawCategoryIcon } from './icons'
import { Button, Toast, type IButton } from './uiKit'

const DEPTH = 1000
const PANEL_W = 500

// Session-wide one-shot flags for contextual hints.
let ammoHintShown = false
let jumpConfirmShown = false

export interface TutorialTargets {
  shieldsColumn(): Rect | null
  weaponSlot(slot: number): Rect | null
  playerShip(): Rect
  portraits(): Rect
}

interface Step {
  title: string
  text: string
  rect(): Rect | null
  diagram?: boolean
}

export class TutorialController {
  active = false
  private readonly scene: Phaser.Scene
  private readonly audio: IAudioEngine
  private readonly onDone: () => void
  private readonly steps: Step[]
  private stepIdx = 0
  private dimGfx: Phaser.GameObjects.Graphics | null = null
  private panelGfx: Phaser.GameObjects.Graphics | null = null
  private titleText: Phaser.GameObjects.Text | null = null
  private bodyText: Phaser.GameObjects.Text | null = null
  private stepText: Phaser.GameObjects.Text | null = null
  private diagramTexts: Phaser.GameObjects.Text[] = []
  private nextBtn: IButton | null = null
  private skipBtn: IButton | null = null
  private modal: { destroy(): void }[] = []

  constructor(
    scene: Phaser.Scene,
    targets: TutorialTargets,
    deps: { audio: IAudioEngine; onDone: () => void },
  ) {
    this.scene = scene
    this.audio = deps.audio
    this.onDone = deps.onDone
    this.steps = [
      {
        title: 'ENERGÍA',
        text:
          'El reactor alimenta tus sistemas. Los pips de cada columna son el botón: ' +
          'haz click en el 2º pip de ESCUDOS para asignar 2 de energía y levantar una capa. ' +
          'Click derecho o rueda abajo quita energía.',
        rect: () => targets.shieldsColumn(),
      },
      {
        title: 'APUNTAR',
        text:
          'Selecciona el arma 1 (click en el slot o tecla 1) y luego haz click en la sala de ' +
          'ARMAS de la nave enemiga para fijar el objetivo. El arma disparará sola al cargarse.',
        rect: () => targets.weaponSlot(0),
      },
      {
        title: 'EL TRIÁNGULO',
        text:
          'Energía funde escudos, Cinético perfora cascos, Explosivo revienta sistemas. ' +
          'Cada categoría hace ×1.25 contra su favorita y ×0.75 contra su débil. ' +
          'El icono de cada slot te recuerda su categoría.',
        rect: () => null,
        diagram: true,
      },
      {
        title: 'ESCUDOS',
        text:
          'La burbuja absorbe proyectiles no perforantes: cada 2 niveles de energía en Escudos ' +
          'mantienen 1 capa (◆). Las capas se regeneran tras unos segundos sin recibir impactos.',
        rect: () => targets.playerShip(),
      },
      {
        title: 'TRIPULACIÓN',
        text:
          'Haz click en un retrato para seleccionar a un tripulante y luego en una sala de tu ' +
          'nave para enviarlo. Reparan, apagan fuegos y sellan brechas solos; el ingeniero ' +
          'repara más rápido. Click derecho deselecciona.',
        rect: () => targets.portraits(),
      },
      {
        title: 'PAUSA TÁCTICA',
        text:
          'Pulsa ESPACIO para pausar el combate contra la IA. En pausa puedes apuntar, mover ' +
          'energía y dar órdenes con calma. ¡Buena caza!',
        rect: () => null,
      },
    ]
  }

  start(): void {
    if (this.active) return
    this.active = true
    this.stepIdx = 0
    this.render()
  }

  // -------------------------------------------------------------------------
  // Contextual one-shots
  // -------------------------------------------------------------------------

  /** First time a weapon runs dry: explain the global missile pool. */
  notifyAmmoEmpty(): void {
    if (ammoHintShown) return
    ammoHintShown = true
    Toast.show('Sin munición: las armas explosivas gastan misiles. Compra más tras el combate.')
    this.audio.play('error')
  }

  /**
   * First jump of the session asks for confirmation (fleeing loses the node
   * loot). Returns true when a modal was shown (the caller must wait).
   */
  requestJumpConfirm(onConfirm: () => void): boolean {
    if (jumpConfirmShown || this.modal.length > 0) return false
    jumpConfirmShown = true

    const scene = this.scene
    const blocker = scene.add
      .zone(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT)
      .setInteractive()
      .setDepth(DEPTH + 10)
    const g = scene.add.graphics().setDepth(DEPTH + 11)
    g.fillStyle(0x000a14, 0.6)
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)
    g.fillStyle(COLORS.panel, 0.98)
    g.fillRoundedRect(GAME_WIDTH / 2 - 230, 280, 460, 150, 8)
    g.lineStyle(2, COLORS.warn, 1)
    g.strokeRoundedRect(GAME_WIDTH / 2 - 230, 280, 460, 150, 8)
    const title = makeTitleText(scene, GAME_WIDTH / 2, 305, '¿HUIR DEL COMBATE?', 18, COLORS_CSS.warn)
      .setOrigin(0.5)
      .setDepth(DEPTH + 12)
    const body = makeText(
      scene,
      GAME_WIDTH / 2,
      345,
      'Huir pierde el botín del nodo. ¿Cargar salto?',
      13,
      COLORS_CSS.text,
      { align: 'center', wordWrap: { width: 420 } },
    )
      .setOrigin(0.5)
      .setDepth(DEPTH + 12)
    const closeModal = (): void => {
      for (const obj of this.modal) obj.destroy()
      this.modal = []
    }
    const yes = new Button(
      scene,
      GAME_WIDTH / 2 - 90,
      398,
      'Cargar salto',
      () => {
        closeModal()
        onConfirm()
      },
      { width: 160, height: 34, fontSize: 14 },
    ).setDepth(DEPTH + 12)
    const no = new Button(
      scene,
      GAME_WIDTH / 2 + 90,
      398,
      'Cancelar',
      () => {
        closeModal()
      },
      { width: 160, height: 34, fontSize: 14, variant: 'ghost' },
    ).setDepth(DEPTH + 12)
    this.modal = [blocker, g, title, body, yes, no]
    return true
  }

  // -------------------------------------------------------------------------
  // Step rendering
  // -------------------------------------------------------------------------

  private render(): void {
    this.clearStep()
    const step = this.steps[this.stepIdx]
    if (step === undefined) {
      this.finish()
      return
    }
    const scene = this.scene
    const hole = step.rect()

    const dim = scene.add.graphics().setDepth(DEPTH)
    dim.fillStyle(0x000a14, 0.55)
    if (hole !== null) {
      const m = 6
      const hx = hole.x - m
      const hy = hole.y - m
      const hw = hole.w + m * 2
      const hh = hole.h + m * 2
      dim.fillRect(0, 0, GAME_WIDTH, hy)
      dim.fillRect(0, hy + hh, GAME_WIDTH, GAME_HEIGHT - hy - hh)
      dim.fillRect(0, hy, hx, hh)
      dim.fillRect(hx + hw, hy, GAME_WIDTH - hx - hw, hh)
      dim.lineStyle(2, COLORS.warn, 1)
      dim.strokeRoundedRect(hx, hy, hw, hh, 6)
    } else {
      dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)
    }
    this.dimGfx = dim

    // Panel placed away from the hole.
    const holeCy = hole === null ? GAME_HEIGHT : hole.y + hole.h / 2
    const panelH = step.diagram === true ? 220 : 160
    const panelY = holeCy > GAME_HEIGHT / 2 ? 90 : 430
    const panelX = GAME_WIDTH / 2 - PANEL_W / 2

    const panel = scene.add.graphics().setDepth(DEPTH + 1)
    panel.fillStyle(COLORS.panel, 0.97)
    panel.fillRoundedRect(panelX, panelY, PANEL_W, panelH, 8)
    panel.lineStyle(2, COLORS.panelBorder, 0.9)
    panel.strokeRoundedRect(panelX, panelY, PANEL_W, panelH, 8)

    // Arrow towards the hole.
    if (hole !== null) {
      const ax = Math.min(Math.max(hole.x + hole.w / 2, panelX + 40), panelX + PANEL_W - 40)
      panel.fillStyle(COLORS.warn, 1)
      if (holeCy > panelY + panelH) {
        panel.fillTriangle(ax - 10, panelY + panelH, ax + 10, panelY + panelH, ax, panelY + panelH + 16)
      } else {
        panel.fillTriangle(ax - 10, panelY, ax + 10, panelY, ax, panelY - 16)
      }
    }
    this.panelGfx = panel

    this.titleText = makeTitleText(scene, panelX + 18, panelY + 14, step.title, 17, COLORS_CSS.panelBorder).setDepth(
      DEPTH + 2,
    )
    this.stepText = makeText(
      scene,
      panelX + PANEL_W - 16,
      panelY + 18,
      `${this.stepIdx + 1}/${this.steps.length}`,
      11,
      COLORS_CSS.textDim,
    )
      .setOrigin(1, 0)
      .setDepth(DEPTH + 2)
    this.bodyText = makeText(scene, panelX + 18, panelY + 44, step.text, 12, COLORS_CSS.text, {
      wordWrap: { width: PANEL_W - 36 },
      lineSpacing: 4,
    }).setDepth(DEPTH + 2)

    if (step.diagram === true) {
      const cats: WeaponCategory[] = ['energy', 'kinetic', 'explosive']
      const labels = ['funde escudos', 'perfora cascos', 'revienta sistemas']
      cats.forEach((cat, i) => {
        const cx = panelX + 90 + i * 165
        const cy = panelY + 150
        drawCategoryIcon(panel, cat, cx, cy, 20, catIconColor(cat))
        const t = makeText(
          scene,
          cx,
          cy + 16,
          `${CATEGORY_NAMES[cat]}\n${labels[i] ?? ''}`,
          10,
          COLORS_CSS.textDim,
          { align: 'center' },
        )
          .setOrigin(0.5, 0)
          .setDepth(DEPTH + 2)
        this.diagramTexts.push(t)
      })
    }

    const last = this.stepIdx === this.steps.length - 1
    this.nextBtn = new Button(
      scene,
      panelX + PANEL_W - 80,
      panelY + panelH - 26,
      last ? '¡A luchar!' : 'Siguiente',
      () => {
        this.stepIdx += 1
        this.render()
      },
      { width: 130, height: 30, fontSize: 13 },
    ).setDepth(DEPTH + 3)
    this.skipBtn = new Button(
      scene,
      panelX + 92,
      panelY + panelH - 26,
      'Saltar tutorial',
      () => {
        this.finish()
      },
      { width: 140, height: 30, fontSize: 12, variant: 'ghost' },
    ).setDepth(DEPTH + 3)
  }

  private clearStep(): void {
    this.dimGfx?.destroy()
    this.panelGfx?.destroy()
    this.titleText?.destroy()
    this.bodyText?.destroy()
    this.stepText?.destroy()
    for (const t of this.diagramTexts) t.destroy()
    this.diagramTexts = []
    this.nextBtn?.destroy()
    this.skipBtn?.destroy()
    this.dimGfx = null
    this.panelGfx = null
    this.titleText = null
    this.bodyText = null
    this.stepText = null
    this.nextBtn = null
    this.skipBtn = null
  }

  private finish(): void {
    if (!this.active) return
    this.active = false
    this.clearStep()
    this.onDone()
  }

  destroy(): void {
    this.active = false
    this.clearStep()
    for (const obj of this.modal) obj.destroy()
    this.modal = []
  }
}

function catIconColor(cat: WeaponCategory): number {
  return cat === 'energy' ? COLORS.catEnergy : cat === 'kinetic' ? COLORS.catKinetic : COLORS.catExplosive
}
