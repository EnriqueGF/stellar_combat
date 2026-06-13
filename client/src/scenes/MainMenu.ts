// Main menu: procedural planet backdrop, title, mode buttons, "how to play"
// and options overlays, online counter.

import Phaser from 'phaser'
import type { PlanetBiome } from '@stellar/shared'
import { PVP_LOADOUT_TIMEOUT_SEC } from '@stellar/shared'
import { COLORS, GAME_HEIGHT, GAME_WIDTH, catColor } from '../theme'
import type { LoadoutSceneData } from '../contracts'
import { Button } from '../ui/button'
import { Panel } from '../ui/panel'
import { Slider } from '../ui/slider'
import { Toggle } from '../ui/toggle'
import {
  addText,
  applyUiScale,
  css,
  drawCategoryIcon,
  menuChrome,
  textStyle,
  type MenuChrome,
} from '../ui/helpers'
import { getState } from '../state'
import { getNet, scOn } from '../net/socket'
import { getAudio } from '../audio/engine'

const BIOMES: PlanetBiome[] = ['gas_giant', 'rocky', 'ice', 'volcanic', 'oceanic', 'desert']

export class MainMenuScene extends Phaser.Scene {
  private chrome: MenuChrome | null = null
  private onlineText: Phaser.GameObjects.Text | null = null
  private overlay: Phaser.GameObjects.Container | null = null

  constructor() {
    super('MainMenu')
  }

  create(): void {
    const state = getState()
    // Returning to the menu always ends any lingering run/battle context.
    state.run = null
    state.runOver = null
    state.mode = null
    state.snapshot = null

    // Date.now() seed is fine here: purely cosmetic, client-side only.
    const seed = Date.now() % 0x7fffffff
    const biome = BIOMES[seed % BIOMES.length] ?? 'gas_giant'
    this.chrome = menuChrome(this, {
      biome,
      seed,
      planet: { planetX: GAME_WIDTH * 0.74, planetY: GAME_HEIGHT * 0.42 },
    })
    getAudio().music('menu')

    const title = addText(this, GAME_WIDTH / 2, 150, 'STELLAR COMBAT', 'title', 64)
    title.setOrigin(0.5)
    title.setShadow(0, 0, css(COLORS.panelBorder), 18, true, true)
    addText(
      this,
      GAME_WIDTH / 2,
      205,
      'Combate táctico en órbita — 1v1 en tiempo real',
      'body',
      18,
      COLORS.textDim,
    ).setOrigin(0.5)

    const bx = GAME_WIDTH / 2
    let by = 320
    const gap = 66
    new Button(this, bx, by, 'EXPEDICIÓN', () => {
      const data: LoadoutSceneData = { mode: 'expedition', timeoutSec: null }
      this.scene.start('Loadout', data)
    }, { width: 320, height: 54 })
    by += gap
    new Button(this, bx, by, 'DUELO PVP', () => {
      const data: LoadoutSceneData = { mode: 'duel', timeoutSec: PVP_LOADOUT_TIMEOUT_SEC }
      this.scene.start('Loadout', data)
    }, { width: 320, height: 54 })
    by += gap
    new Button(this, bx, by, 'CÓMO JUGAR', () => {
      this.openHowTo()
    }, { width: 320, height: 54, variant: 'ghost' })
    by += gap
    new Button(this, bx, by, 'OPCIONES', () => {
      this.openOptions()
    }, { width: 320, height: 54, variant: 'ghost' })

    this.onlineText = addText(this, 16, GAME_HEIGHT - 26, '', 'body', 14, COLORS.textDim)
    this.refreshOnline()
    scOn(this, 'lobby', () => {
      this.refreshOnline()
    })

    addText(this, GAME_WIDTH - 16, GAME_HEIGHT - 26, 'MVP v0.1', 'body', 13, COLORS.textDim)
      .setOrigin(1, 0)
  }

  private refreshOnline(): void {
    const lobby = getState().lobby
    if (!this.onlineText || !this.onlineText.active) return
    this.onlineText.setText(
      lobby ? `En línea: ${lobby.online} · En cola de duelo: ${lobby.queue}` : 'En línea: —',
    )
  }

  // ----------------------------------------------------------------- overlays

  private openOverlay(w: number, h: number, title: string): Panel {
    this.closeOverlay()
    const c = this.add.container(0, 0).setDepth(5000)
    const dim = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6)
      .setInteractive() // swallow clicks behind the overlay
    c.add(dim)
    const panel = new Panel(this, (GAME_WIDTH - w) / 2, (GAME_HEIGHT - h) / 2, w, h, { title })
    c.add(panel)
    const close = new Button(
      this,
      GAME_WIDTH / 2,
      (GAME_HEIGHT - h) / 2 + h - 40,
      'CERRAR',
      () => {
        this.closeOverlay()
      },
      { width: 180, height: 44, variant: 'ghost' },
    )
    c.add(close)
    this.overlay = c
    return panel
  }

  private closeOverlay(): void {
    if (this.overlay) {
      this.overlay.destroy()
      this.overlay = null
    }
  }

  private openHowTo(): void {
    const w = 860
    const h = 600
    const panel = this.openOverlay(w, h, 'CÓMO JUGAR')

    const lines = [
      '· EXPEDICIÓN: recorre un sector de 8 columnas eligiendo nodos; combate,',
      '  comercia y mejora tu nave con chatarra hasta el jefe final.',
      '· ENERGÍA: el reactor alimenta los sistemas. En batalla, haz clic en los',
      '  pips de la barra inferior para asignar o retirar energía en vivo.',
      '· TRIPULACIÓN: 4 especialistas que reparan, apagan fuegos y potencian',
      '  sistemas. Clic en un tripulante y luego en una sala para moverlo.',
      '· HUIDA: carga el salto (cabina tripulada + motores) para escapar,',
      '  pero perderás el botín del nodo. En duelo cuenta como rendición.',
      '· PAUSA TÁCTICA: ESPACIO pausa la batalla, solo contra la IA.',
    ]
    let y = panel.contentTop + 8
    for (const line of lines) {
      panel.add(this.add.text(20, y, line, textStyle('body', 15)))
      y += 22
    }

    // Category triangle: shape + color + text per category (colorblind-safe).
    y += 14
    panel.add(
      this.add.text(
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
      const icon = drawCategoryIcon(this, 34, y + 9, e.cat, 18)
      panel.add(icon)
      panel.add(this.add.text(52, y, e.text, textStyle('body', 15, catColor(e.cat))))
      y += 30
    }
    panel.add(
      this.add.text(
        20,
        y + 6,
        'Y flojea (×0.75) contra la siguiente: Energía→casco · Cinético→sistemas · Explosivo→escudos.',
        textStyle('body', 13, COLORS.textDim),
      ),
    )
  }

  private openOptions(): void {
    const w = 560
    const h = 480
    const panel = this.openOverlay(w, h, 'OPCIONES')
    const state = getState()
    const apply = (): void => {
      state.saveSettings()
      getAudio().applySettings(state.settings)
    }

    let y = panel.contentTop + 36
    panel.add(
      new Slider(this, 24, y, {
        width: 300,
        label: 'Volumen general',
        value: state.settings.masterVolume,
        onChange: (v) => {
          state.settings.masterVolume = v
          apply()
        },
      }),
    )
    y += 64
    panel.add(
      new Slider(this, 24, y, {
        width: 300,
        label: 'Música',
        value: state.settings.musicVolume,
        onChange: (v) => {
          state.settings.musicVolume = v
          apply()
        },
      }),
    )
    y += 64
    panel.add(
      new Slider(this, 24, y, {
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
    y += 56
    panel.add(
      new Toggle(this, 35, y, 'Efecto CRT (scanlines)', state.settings.crtEnabled, (v) => {
        state.settings.crtEnabled = v
        state.saveSettings()
        this.chrome?.crt.setEnabled(v)
      }),
    )
    y += 52
    panel.add(
      new Slider(this, 24, y + 26, {
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
          applyUiScale(this, v)
        },
      }),
    )
    y += 86
    panel.add(
      this.add.text(
        24,
        y,
        'Accesibilidad: ninguna señal depende solo del color (formas + iconos +\ntexto), tooltips en toda la interfaz y pausa táctica contra la IA.',
        textStyle('body', 13, COLORS.textDim),
      ),
    )
  }
}
