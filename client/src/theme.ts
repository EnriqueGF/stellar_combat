// GAME_SPEC §6.2 — palette and typography. Single source of truth for client visuals.
// Critical signals NEVER rely on color alone (shape + icon + text accompany it).

export const COLORS = {
  spaceDeep: 0x0a0e1a,
  spaceLight: 0x141b2e,
  panel: 0x101826,
  panelBorder: 0x2de2e6,
  text: 0xcfe8ef,
  textDim: 0x7f95a3,
  ok: 0x5af78e,
  warn: 0xffb454,
  danger: 0xff5c57,
  shield: 0x4d9be6,
  energy: 0xf3f99d,
  catEnergy: 0x2de2e6,
  catKinetic: 0xffb454,
  catExplosive: 0xff5c57,
  fire: 0xff7733,
  o2Low: 0xff5c8a,
} as const

export const COLORS_CSS = {
  spaceDeep: '#0a0e1a',
  panel: '#101826',
  panelBorder: '#2de2e6',
  text: '#cfe8ef',
  textDim: '#7f95a3',
  ok: '#5af78e',
  warn: '#ffb454',
  danger: '#ff5c57',
  shield: '#4d9be6',
  energy: '#f3f99d',
  catEnergy: '#2de2e6',
  catKinetic: '#ffb454',
  catExplosive: '#ff5c57',
} as const

export const FONTS = {
  title: '"Orbitron", sans-serif',
  body: '"Share Tech Mono", monospace',
} as const

export const GAME_WIDTH = 1280
export const GAME_HEIGHT = 720

/**
 * Supersampling factor. The world is designed in 1280×720 units, but the canvas
 * backing store renders at GAME_WIDTH×GAME_HEIGHT×RENDER_SCALE and every scene's
 * camera is zoomed by RENDER_SCALE (see applyRenderScale / applyUiScale), so the
 * logical coordinate system stays 1280×720 while pixels are drawn at 2–3× density.
 * Scale.FIT then shrinks that high-res canvas to the window, which is what makes
 * text and vector art crisp instead of an upscaled 1280×720 blur. Integer factor
 * keyed to device pixel ratio × the FIT upscale, clamped to [2,3] for sanity and
 * fill-rate. Falls back to 2 outside the browser (e.g. tests).
 */
export const RENDER_SCALE: number = (() => {
  if (typeof window === 'undefined') return 2
  const dpr = window.devicePixelRatio || 1
  const fit = Math.max(1, window.innerWidth / GAME_WIDTH, window.innerHeight / GAME_HEIGHT)
  return Math.min(3, Math.max(2, Math.ceil(dpr * fit)))
})()

/** Text rasterization density. Matches RENDER_SCALE so glyphs are pixel-crisp
 *  after the camera zoom and FIT downscale (a lower value would blur under zoom). */
export const TEXT_RESOLUTION = RENDER_SCALE

/** Zooms a scene's main camera so the 1280×720 world fills the supersampled
 *  canvas. Call once in create() for scenes that don't go through menuChrome. */
export function applyRenderScale(scene: import('phaser').Scene): void {
  scene.cameras.main.setZoom(RENDER_SCALE)
  scene.cameras.main.centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2)
}

/** GAME_SPEC §6.3 — fixed HUD zones for the Battle scene (pixels, 1280×720). */
export const HUD = {
  logRect: { x: 340, y: 4, w: 600, h: 52 },
  portraitsRect: { x: 0, y: 90, w: 86, h: 390 },
  playerShipRect: { x: 96, y: 110, w: 460, h: 450 },
  enemyShipRect: { x: 720, y: 90, w: 460, h: 380 },
  readoutsRect: { x: 96, y: 64, w: 460, h: 40 },
  bottomBar: { y: 585, h: 135 },
} as const

export function catColor(category: 'energy' | 'kinetic' | 'explosive'): number {
  return category === 'energy'
    ? COLORS.catEnergy
    : category === 'kinetic'
      ? COLORS.catKinetic
      : COLORS.catExplosive
}

/** Dash pattern per weapon category for target lines (shape, not just color). */
export function catDash(category: 'energy' | 'kinetic' | 'explosive'): number[] {
  return category === 'energy' ? [] : category === 'kinetic' ? [8, 6] : [2, 6]
}
