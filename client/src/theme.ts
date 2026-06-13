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
