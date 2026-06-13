// Reusable modal overlays shared by the main menu and the in-game escape menu:
//   openModal(scene, w, h, title, depth)  — dim + centered panel; returns a handle.
//   fillOptions(scene, panel, hooks)       — volume/music/sfx/CRT/uiScale controls.
//   fillHowTo(scene, panel)                — the "how to play" reference text.
//
// The dim covers the whole VISIBLE world (stage + ultrawide margins) so there is
// never an undimmed strip on non-16:9 screens. Overlays live in world space and
// are rendered through the scene camera like everything else.

import Phaser from 'phaser'
import { BACKDROP_MARGIN_X, BACKDROP_MARGIN_Y, COLORS, GAME_HEIGHT, GAME_WIDTH, catColor } from '../theme'
import type { ICrtOverlay } from '../contracts'
import { Panel } from './panel'
import { Slider } from './slider'
import { Toggle } from './toggle'
import { applyUiScale, drawCategoryIcon, textStyle } from './helpers'
import { getState } from '../state'
import { getAudio } from '../audio/engine'

export interface ModalHandle {
  container: Phaser.GameObjects.Container
  panel: Panel
  close(): void
}

/** Dim backdrop + centered titled panel at `depth`. The caller adds buttons. */
export function openModal(
  scene: Phaser.Scene,
  w: number,
  h: number,
  title: string,
  depth: number,
): ModalHandle {
  const container = scene.add.container(0, 0).setDepth(depth)
  const dim = scene.add
    .rectangle(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      GAME_WIDTH + BACKDROP_MARGIN_X * 2,
      GAME_HEIGHT + BACKDROP_MARGIN_Y * 2,
      0x000000,
      0.62,
    )
    .setInteractive() // swallow clicks/hovers on whatever is behind the modal
  container.add(dim)
  const panel = new Panel(scene, (GAME_WIDTH - w) / 2, (GAME_HEIGHT - h) / 2, w, h, { title })
  container.add(panel)
  return {
    container,
    panel,
    close: () => container.destroy(),
  }
}

export interface OptionsHooks {
  /** Live-toggle the scene's CRT overlay, if it has one. */
  crt?: ICrtOverlay | null
  /** Live-apply the UI scale (menus/run scenes); omit where it shouldn't apply. */
  onUiScale?: (v: number) => void
}

/** Populates `panel` with the standard settings controls. */
export function fillOptions(scene: Phaser.Scene, panel: Panel, hooks: OptionsHooks = {}): void {
  const state = getState()
  const apply = (): void => {
    state.saveSettings()
    getAudio().applySettings(state.settings)
  }

  let y = panel.contentTop + 30
  panel.add(
    new Slider(scene, 24, y, {
      width: 300,
      label: 'Volumen general',
      value: state.settings.masterVolume,
      onChange: (v) => {
        state.settings.masterVolume = v
        apply()
      },
    }),
  )
  y += 62
  panel.add(
    new Slider(scene, 24, y, {
      width: 300,
      label: 'Música',
      value: state.settings.musicVolume,
      onChange: (v) => {
        state.settings.musicVolume = v
        apply()
      },
    }),
  )
  y += 62
  panel.add(
    new Slider(scene, 24, y, {
      width: 300,
      label: 'Efectos de sonido',
      value: state.settings.sfxVolume,
      onChange: (v) => {
        state.settings.sfxVolume = v
        apply()
        getAudio().play('click')
      },
    }),
  )
  y += 54
  panel.add(
    new Toggle(scene, 35, y, 'Efecto CRT (scanlines)', state.settings.crtEnabled, (v) => {
      state.settings.crtEnabled = v
      state.saveSettings()
      hooks.crt?.setEnabled(v)
    }),
  )
  y += 50
  panel.add(
    new Slider(scene, 24, y + 26, {
      width: 300,
      label: 'Escala de la interfaz (solo menús)',
      min: 0.85,
      max: 1.15,
      step: 0.05,
      value: state.settings.uiScale,
      format: (v) => `${Math.round(v * 100)}%`,
      onChange: (v) => {
        state.settings.uiScale = v
        state.saveSettings()
        hooks.onUiScale?.(v)
      },
    }),
  )
  y += 84
  panel.add(
    scene.add.text(
      24,
      y,
      'Accesibilidad: ninguna señal depende solo del color (formas + iconos +\ntexto), tooltips en toda la interfaz y pausa táctica contra la IA.',
      textStyle('body', 13, COLORS.textDim),
    ),
  )
}

/** Convenience: open an Options modal wired to a scene's CRT + uiScale. */
export function openOptions(scene: Phaser.Scene, depth: number, crt: ICrtOverlay | null): ModalHandle {
  const m = openModal(scene, 560, 484, 'OPCIONES', depth)
  fillOptions(scene, m.panel, { crt, onUiScale: (v) => applyUiScale(scene, v) })
  return m
}

/** Populates `panel` with the how-to-play reference. */
export function fillHowTo(scene: Phaser.Scene, panel: Panel): void {
  const lines = [
    '· EXPEDICIÓN: recorre un sector de 8 columnas eligiendo nodos; combate,',
    '  comercia y mejora tu nave con chatarra hasta el jefe final.',
    '· ENERGÍA: el reactor alimenta los sistemas. En batalla, haz clic en los',
    '  pips de la barra inferior para asignar o retirar energía en vivo.',
    '· TRIPULACIÓN: 4 especialistas que reparan, apagan fuegos y potencian',
    '  sistemas. Clic en un tripulante y luego en una sala para moverlo.',
    '· HUIDA: carga el salto (cabina tripulada + motores) para escapar,',
    '  pero perderás el botín del nodo. En duelo cuenta como rendición.',
    '· PAUSA / MENÚ: ESC abre el menú (pausa contra la IA); clic derecho',
    '  cancela el arma seleccionada.',
  ]
  let y = panel.contentTop + 8
  for (const line of lines) {
    panel.add(scene.add.text(20, y, line, textStyle('body', 15)))
    y += 22
  }

  y += 14
  panel.add(
    scene.add.text(
      20,
      y,
      'TRIÁNGULO DE CATEGORÍAS — cada una brilla (×1.25) contra una defensa:',
      textStyle('title', 14, COLORS.panelBorder),
    ),
  )
  y += 34
  const entries: { cat: 'energy' | 'kinetic' | 'explosive'; text: string }[] = [
    { cat: 'energy', text: 'ENERGÍA funde escudos · cadencia alta, sin munición' },
    { cat: 'kinetic', text: 'CINÉTICO perfora cascos · proyectiles rápidos' },
    { cat: 'explosive', text: 'EXPLOSIVO revienta sistemas · perfora escudos, gasta misiles' },
  ]
  for (const e of entries) {
    panel.add(drawCategoryIcon(scene, 34, y + 9, e.cat, 18))
    panel.add(scene.add.text(52, y, e.text, textStyle('body', 15, catColor(e.cat))))
    y += 30
  }
  panel.add(
    scene.add.text(
      20,
      y + 6,
      'Y flojea (×0.75) contra la siguiente: Energía→casco · Cinético→sistemas · Explosivo→escudos.',
      textStyle('body', 13, COLORS.textDim),
    ),
  )
}

/** Convenience: open a "Cómo jugar" modal. */
export function openHowTo(scene: Phaser.Scene, depth: number): ModalHandle {
  const m = openModal(scene, 860, 600, 'CÓMO JUGAR', depth)
  fillHowTo(scene, m.panel)
  return m
}
