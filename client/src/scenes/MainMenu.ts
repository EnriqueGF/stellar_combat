// Main menu: procedural planet backdrop, title, mode buttons, "how to play"
// and options overlays, online counter.

import Phaser from 'phaser'
import type { PlanetBiome } from '@stellar/shared'
import { PVP_LOADOUT_TIMEOUT_SEC } from '@stellar/shared'
import { COLORS, GAME_HEIGHT, GAME_WIDTH } from '../theme'
import type { LoadoutSceneData } from '../contracts'
import { Button } from '../ui/button'
import { Panel } from '../ui/panel'
import { fillHowTo, fillOptions } from '../ui/overlays'
import { addText, applyUiScale, css, menuChrome, type MenuChrome } from '../ui/helpers'
import { getState } from '../state'
import { getNet, scOn } from '../net/socket'
import { getAudio } from '../audio/engine'
import { fadeInScene, goToScene } from '../ui/transition'
import { MenuFlybys } from '../vfx/menuFlybys'
import { openAuthModal, closeAuthModal } from '../ui/authModal'
import {
  drawAccountIcon,
  drawDuelIcon,
  drawExpeditionIcon,
  drawGearIcon,
  drawHelpIcon,
  drawTutorialIcon,
  drawWikiIcon,
} from '../ui/menuIcons'

const BIOMES: PlanetBiome[] = ['gas_giant', 'rocky', 'ice', 'volcanic', 'oceanic', 'desert']

export class MainMenuScene extends Phaser.Scene {
  private chrome: MenuChrome | null = null
  private onlineText: Phaser.GameObjects.Text | null = null
  private overlay: Phaser.GameObjects.Container | null = null
  private flybys: MenuFlybys | null = null
  private accountBtn: Button | null = null

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
    this.flybys = new MenuFlybys(this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.flybys?.destroy()
      this.flybys = null
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
    let by = 300
    const gap = 60
    const opts = { width: 320, height: 52 }
    const ghost = { ...opts, variant: 'ghost' as const }
    new Button(this, bx, by, 'EXPEDICIÓN', () => {
      const data: LoadoutSceneData = { mode: 'expedition', timeoutSec: null }
      goToScene(this, 'Loadout', data)
    }, opts)
    this.menuIcon(bx, by, opts.width, drawExpeditionIcon, COLORS.panelBorder)
    by += gap
    new Button(this, bx, by, 'DUELO PVP', () => {
      const data: LoadoutSceneData = { mode: 'duel', timeoutSec: PVP_LOADOUT_TIMEOUT_SEC }
      goToScene(this, 'Loadout', data)
    }, opts)
    this.menuIcon(bx, by, opts.width, drawDuelIcon, COLORS.panelBorder)
    by += gap
    // Practice battle: the server starts it and battle:start routes us to Battle.
    new Button(this, bx, by, 'TUTORIAL', () => {
      getNet().socket.emit('tutorial:start')
    }, ghost)
    this.menuIcon(bx, by, opts.width, drawTutorialIcon, COLORS.textDim)
    by += gap
    new Button(this, bx, by, 'CÓMO JUGAR', () => this.openHowTo(), ghost)
    this.menuIcon(bx, by, opts.width, drawHelpIcon, COLORS.textDim)
    by += gap
    new Button(this, bx, by, 'OPCIONES', () => this.openOptions(), ghost)
    this.menuIcon(bx, by, opts.width, drawGearIcon, COLORS.textDim)
    by += gap
    // Wiki: static Astro site served at /wiki (built into client/public/wiki).
    // Opens in a new tab so the running game/session is left untouched.
    new Button(this, bx, by, 'WIKI', () => {
      window.open('/wiki/', '_blank', 'noopener')
    }, ghost)
    this.menuIcon(bx, by, opts.width, drawWikiIcon, COLORS.textDim)

    this.onlineText = addText(this, 16, GAME_HEIGHT - 26, '', 'body', 14, COLORS.textDim)
    this.refreshOnline()
    scOn(this, 'lobby', () => {
      this.refreshOnline()
    })

    // Account button (top-right): opens the login/register/profile overlay.
    const accW = 210
    const accCx = GAME_WIDTH - 120
    const accCy = 36
    this.accountBtn = new Button(this, accCx, accCy, this.accountLabel(), () => openAuthModal(this), {
      width: accW,
      height: 38,
      fontSize: 13,
      variant: 'ghost',
    })
    this.menuIcon(accCx, accCy, accW, drawAccountIcon, COLORS.textDim, 18, 14)
    scOn(this, 'auth', () => this.accountBtn?.setLabel(this.accountLabel()))
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => closeAuthModal())

    addText(this, GAME_WIDTH - 16, GAME_HEIGHT - 26, 'MVP v0.1', 'body', 13, COLORS.textDim)
      .setOrigin(1, 0)

    fadeInScene(this)
  }

  private accountLabel(): string {
    const profile = getState().profile
    if (!profile) return 'INICIAR SESIÓN'
    const name = profile.username.length > 12 ? `${profile.username.slice(0, 12)}…` : profile.username
    return `▸ ${name}`
  }

  /**
   * Draws a procedural menu icon at fixed standoff to the LEFT of a button's
   * left edge, vertically centered on the button. Buttons are created by the
   * shared Button class (not modified here); the icon is a separate Graphics so
   * it never affects the button's hit area, hover, or the responsive camera.
   * (cx, cy) is the button CENTER; `btnW` its width.
   */
  private menuIcon(
    cx: number,
    cy: number,
    btnW: number,
    draw: (g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, color: number) => void,
    color: number,
    size = 22,
    pad = 18,
  ): void {
    const ix = cx - btnW / 2 - pad - size / 2
    const g = this.add.graphics()
    draw(g, ix, cy, size, color)
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
    const panel = this.openOverlay(860, 600, 'CÓMO JUGAR')
    fillHowTo(this, panel)
  }

  private openOptions(): void {
    const panel = this.openOverlay(560, 484, 'OPCIONES')
    fillOptions(this, panel, {
      crt: this.chrome?.crt ?? null,
      onUiScale: (v) => applyUiScale(this, v),
    })
  }
}
