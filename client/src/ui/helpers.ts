// Shared UI helpers for menu scenes and widgets.
//
// API summary:
//   css(color)                        — number color -> '#rrggbb' string.
//   textStyle(kind, size, color?)     — Phaser text style with theme fonts.
//   addText(scene, x, y, str, ...)    — convenience scene.add.text with theme style.
//   drawCategoryIcon(...)             — weapon category badge (shape + letter + color,
//                                       colorblind-safe triple coding).
//   drawDifficultyBadge(...)          — ship difficulty badge (shape + color + text).
//   drawShipLayoutPreview(...)        — mini room-grid preview from a ShipLayout.
//   buildRunHeader(scene, run)        — expedition header bar (scrap/hull/ammo/column).
//   menuChrome(scene, opts)           — backdrop + CRT + uiScale camera zoom for MENU
//                                       scenes only (Battle must not use it).
//   CATEGORY_NAMES_ES / SYSTEM_NAMES_ES / NODE_TYPE_NAMES_ES — display names.
//   formatDuration(sec)               — 'm:ss'.

import Phaser from 'phaser'
import type {
  PlanetBiome,
  RunStatePublic,
  ShipLayout,
  SystemId,
  WeaponCategory,
} from '@stellar/shared'
import { clamp } from '@stellar/shared'
import { COLORS, FONTS, GAME_HEIGHT, GAME_WIDTH, catColor } from '../theme'
import type { ICrtOverlay, ISpaceBackdrop } from '../contracts'
import { SpaceBackdrop } from '../vfx/backdrop'
import { CrtOverlay } from '../vfx/crt'
import { getState } from '../state'

export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

const TEXT_RESOLUTION = Math.min(window.devicePixelRatio || 1, 2)

export function textStyle(
  kind: 'title' | 'body',
  size: number,
  color: number = COLORS.text,
): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: kind === 'title' ? FONTS.title : FONTS.body,
    fontSize: `${size}px`,
    fontStyle: kind === 'title' ? 'bold' : 'normal',
    color: css(color),
    resolution: TEXT_RESOLUTION,
  }
}

export function addText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  str: string,
  kind: 'title' | 'body' = 'body',
  size = 15,
  color: number = COLORS.text,
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, str, textStyle(kind, size, color))
}

export const CATEGORY_NAMES_ES: Record<WeaponCategory, string> = {
  energy: 'Energía',
  kinetic: 'Cinético',
  explosive: 'Explosivo',
}

export const SYSTEM_NAMES_ES: Record<SystemId, string> = {
  weapons: 'Armas',
  shields: 'Escudos',
  engines: 'Motores',
  oxygen: 'Oxígeno',
  medbay: 'Bahía médica',
  cockpit: 'Cabina',
  drones: 'Bahía de drones',
}

export const NODE_TYPE_NAMES_ES: Record<string, string> = {
  start: 'Inicio',
  combat: 'Combate',
  elite: 'Élite',
  event: 'Evento',
  shop: 'Tienda',
  boss: 'Jefe',
}

/**
 * Weapon category badge: shape + letter + color (triple coding so the signal
 * never relies on color alone). energy=circle 'E', kinetic=square 'C',
 * explosive=triangle 'X'. Returned container is centered on (x, y).
 */
export function drawCategoryIcon(
  scene: Phaser.Scene,
  x: number,
  y: number,
  category: WeaponCategory,
  size = 16,
): Phaser.GameObjects.Container {
  const color = catColor(category)
  const g = scene.add.graphics()
  const r = size / 2
  g.lineStyle(2, color, 1)
  g.fillStyle(color, 0.22)
  if (category === 'energy') {
    g.fillCircle(0, 0, r)
    g.strokeCircle(0, 0, r)
  } else if (category === 'kinetic') {
    g.fillRect(-r, -r, size, size)
    g.strokeRect(-r, -r, size, size)
  } else {
    const tri = new Phaser.Geom.Triangle(-r, r, r, r, 0, -r)
    g.fillTriangleShape(tri)
    g.strokeTriangleShape(tri)
  }
  const letter = category === 'energy' ? 'E' : category === 'kinetic' ? 'C' : 'X'
  const t = scene.add
    .text(0, category === 'explosive' ? 1 : 0, letter, textStyle('body', Math.round(size * 0.62), color))
    .setOrigin(0.5)
  return scene.add.container(x, y, [g, t])
}

/** Ship difficulty badge: shape + color + text label, centered vertically on y. */
export function drawDifficultyBadge(
  scene: Phaser.Scene,
  x: number,
  y: number,
  difficulty: 'facil' | 'media' | 'dificil',
): Phaser.GameObjects.Container {
  const spec =
    difficulty === 'facil'
      ? { color: COLORS.ok, label: 'Fácil' }
      : difficulty === 'media'
        ? { color: COLORS.warn, label: 'Media' }
        : { color: COLORS.danger, label: 'Difícil' }
  const g = scene.add.graphics()
  g.fillStyle(spec.color, 1)
  if (difficulty === 'facil') g.fillCircle(0, 0, 5)
  else if (difficulty === 'media') g.fillRect(-5, -5, 10, 10)
  else g.fillTriangleShape(new Phaser.Geom.Triangle(-5, 5, 5, 5, 0, -5))
  const t = scene.add.text(10, 0, spec.label, textStyle('body', 13, spec.color)).setOrigin(0, 0.5)
  return scene.add.container(x, y, [g, t])
}

/**
 * Mini preview of a ship layout drawn with Graphics. (x, y) is the CENTER of
 * the preview; rooms are scaled by cellSize and centered on it.
 */
export function drawShipLayoutPreview(
  scene: Phaser.Scene,
  x: number,
  y: number,
  layout: ShipLayout,
  cellSize = 14,
  color: number = COLORS.panelBorder,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics()
  let maxX = 0
  let maxY = 0
  for (const r of layout.rooms) {
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  const ox = x - (maxX * cellSize) / 2
  const oy = y - (maxY * cellSize) / 2
  g.lineStyle(1.5, color, 0.9)
  g.fillStyle(color, 0.12)
  for (const r of layout.rooms) {
    g.fillRect(ox + r.x * cellSize, oy + r.y * cellSize, r.w * cellSize, r.h * cellSize)
    g.strokeRect(ox + r.x * cellSize, oy + r.y * cellSize, r.w * cellSize, r.h * cellSize)
    if (r.system) {
      g.fillStyle(color, 0.55)
      const cx = ox + (r.x + r.w / 2) * cellSize
      const cy = oy + (r.y + r.h / 2) * cellSize
      g.fillRect(cx - 2, cy - 2, 4, 4)
      g.fillStyle(color, 0.12)
    }
  }
  return g
}

/**
 * Expedition header bar (scrap / hull / ammo / column) used by SectorMap,
 * Event, Shop and Upgrade. Returns a container at depth 50; destroy and
 * rebuild it on each run refresh.
 */
export function buildRunHeader(scene: Phaser.Scene, run: RunStatePublic): Phaser.GameObjects.Container {
  const c = scene.add.container(0, 0).setDepth(50)
  const bg = scene.add.graphics()
  bg.fillStyle(COLORS.panel, 0.88)
  bg.fillRect(0, 0, GAME_WIDTH, 44)
  bg.lineStyle(1, COLORS.panelBorder, 0.5)
  bg.lineBetween(0, 44, GAME_WIDTH, 44)
  c.add(bg)

  const icon = (ix: number, draw: (g: Phaser.GameObjects.Graphics) => void): void => {
    const g = scene.add.graphics({ x: ix, y: 22 })
    draw(g)
    c.add(g)
  }
  const label = (lx: number, str: string, color: number): void => {
    c.add(scene.add.text(lx, 22, str, textStyle('body', 16, color)).setOrigin(0, 0.5))
  }

  // Scrap: amber hexagon.
  icon(28, (g) => {
    g.lineStyle(2, COLORS.warn, 1)
    const pts: Phaser.Math.Vector2[] = []
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6
      pts.push(new Phaser.Math.Vector2(Math.cos(a) * 8, Math.sin(a) * 8))
    }
    g.strokePoints(pts, true)
  })
  label(44, `CHATARRA ${Math.round(run.scrap)}`, COLORS.warn)

  // Hull: green square with cross.
  icon(268, (g) => {
    g.lineStyle(2, COLORS.ok, 1)
    g.strokeRect(-8, -8, 16, 16)
    g.lineBetween(-4, 0, 4, 0)
    g.lineBetween(0, -4, 0, 4)
  })
  label(284, `CASCO ${Math.round(run.hull)}/${run.hullMax}`, COLORS.ok)

  // Ammo: red triangle (missiles).
  icon(508, (g) => {
    g.lineStyle(2, COLORS.catExplosive, 1)
    g.strokeTriangleShape(new Phaser.Geom.Triangle(-7, 8, 7, 8, 0, -8))
  })
  label(524, `MISILES ${run.ammo}`, COLORS.catExplosive)

  label(700, `COLUMNA ${run.column}/8`, COLORS.text)
  return c
}

export interface MenuChrome {
  crt: ICrtOverlay
  backdrop: ISpaceBackdrop | null
}

/**
 * Standard chrome for MENU scenes (never the Battle scene):
 *  - optional procedural SpaceBackdrop wired to the scene update loop,
 *  - CRT overlay honoring settings.crtEnabled,
 *  - settings.uiScale applied as camera zoom (0.85..1.15, menus only).
 * Everything is destroyed automatically on scene shutdown.
 */
export function menuChrome(
  scene: Phaser.Scene,
  opts?: {
    biome?: PlanetBiome
    seed?: number
    planet?: { planetX?: number; planetY?: number; planetScale?: number }
  },
): MenuChrome {
  const settings = getState().settings
  let backdrop: ISpaceBackdrop | null = null
  if (opts?.biome !== undefined) {
    backdrop = new SpaceBackdrop(scene, opts.seed ?? 1, opts.biome, opts.planet)
    const onUpdate = (_time: number, dt: number): void => {
      backdrop?.update(dt)
    }
    scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate)
    })
  }
  const crt = new CrtOverlay(scene)
  crt.setEnabled(settings.crtEnabled)
  applyUiScale(scene)
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    backdrop?.destroy()
    crt.destroy()
  })
  return { crt, backdrop }
}

/** Applies settings.uiScale as a camera zoom centered on the design canvas. */
export function applyUiScale(scene: Phaser.Scene, scale?: number): void {
  const s = clamp(scale ?? getState().settings.uiScale, 0.85, 1.15)
  const cam = scene.cameras.main
  cam.setZoom(s)
  cam.centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2)
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}
