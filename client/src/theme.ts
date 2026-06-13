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

// ---------------------------------------------------------------------------
// Responsive scaling (all resolutions + ultrawide).
//
// The canvas fills the whole window at native device resolution (see main.ts),
// so there are NO letterbox bars on any aspect ratio. Gameplay is laid out in a
// fixed 1280×720 "stage"; each scene's camera is zoomed by fitCameraToStage so
// that stage is fully visible and centered. On non-16:9 screens the camera then
// reveals extra world around the stage — filled by the backdrop, which is built
// large enough (stage + the margins below) to cover it. Net effect: the HUD/ship
// layout never distorts, ultrawide shows more space on the sides, and rendering
// is pixel-native (no upscale blur).
// ---------------------------------------------------------------------------

/** How far (world units) the backdrop extends beyond the 1280×720 stage on each
 *  axis, so stars/nebula/planet fill the screen on wide/tall aspects. X covers
 *  up to ~32:9, Y up to ~1:1. */
export const BACKDROP_MARGIN_X = 900
export const BACKDROP_MARGIN_Y = 400

/** Text rasterization density: must be ≥ the camera zoom (≈ device px ÷ 720) so
 *  glyphs stay crisp under the zoom. Clamped [2,3]; falls back to 2 in tests. */
export const TEXT_RESOLUTION: number = (() => {
  if (typeof window === 'undefined') return 2
  const dpr = window.devicePixelRatio || 1
  const fit = Math.min(window.innerWidth / GAME_WIDTH, window.innerHeight / GAME_HEIGHT)
  return Math.min(3, Math.max(2, Math.ceil(dpr * Math.max(1, fit))))
})()

/** Zooms/centres a scene's main camera so the 1280×720 stage fits the current
 *  canvas (centered, fully visible). extraZoom layers the menu uiScale on top. */
export function fitCameraToStage(scene: import('phaser').Scene, extraZoom = 1): void {
  const w = scene.scale.gameSize.width
  const h = scene.scale.gameSize.height
  const cam = scene.cameras.main
  cam.setSize(w, h)
  cam.setZoom(Math.min(w / GAME_WIDTH, h / GAME_HEIGHT) * extraZoom)
  cam.centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2)
}

/** Fits the camera now and re-fits whenever the canvas resizes; auto-cleans on
 *  scene shutdown/destroy. extraZoom is read fresh on each resize (so the menu
 *  uiScale stays applied). */
export function installResponsiveCamera(
  scene: import('phaser').Scene,
  extraZoom: () => number = () => 1,
): void {
  const refit = (): void => fitCameraToStage(scene, extraZoom())
  refit()
  scene.scale.on('resize', refit)
  const off = (): void => {
    scene.scale.off('resize', refit)
  }
  scene.events.once('shutdown', off)
  scene.events.once('destroy', off)
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
