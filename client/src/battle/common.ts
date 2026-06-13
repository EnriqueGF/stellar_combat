// Shared helpers and naming tables for the Battle scene modules.

import Phaser from 'phaser'
import type { CrewClassId, SystemId, WeaponCategory, WeaponId } from '@stellar/shared'
import { COLORS_CSS, FONTS } from '../theme'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Vec2 {
  x: number
  y: number
}

export const SYSTEM_ORDER: SystemId[] = [
  'weapons',
  'shields',
  'engines',
  'oxygen',
  'medbay',
  'cockpit',
  'drones',
]

export const SYSTEM_NAMES: Record<SystemId, string> = {
  weapons: 'Armas',
  shields: 'Escudos',
  engines: 'Motores',
  oxygen: 'Oxígeno',
  medbay: 'Bahía médica',
  cockpit: 'Cabina',
  drones: 'Drones',
}

export const WEAPON_SHORT: Record<WeaponId, string> = {
  laser_light: 'LÁSER LIG.',
  laser_burst: 'L. RÁFAGA',
  beam_melter: 'HAZ FUND.',
  gauss_cannon: 'C. GAUSS',
  flak_scatter: 'METRALLA',
  mag_heavy: 'MAGNETO',
  missile_swift: 'M. COLIBRÍ',
  missile_breach: 'M. BRECHA',
  bomb_incendiary: 'B. ÍGNEA',
}

export const CATEGORY_NAMES: Record<WeaponCategory, string> = {
  energy: 'Energía',
  kinetic: 'Cinético',
  explosive: 'Explosivo',
}

export const CATEGORY_TRIANGLE_TEXT: Record<WeaponCategory, string> = {
  energy: 'Energía: ×1.25 escudos, ×0.75 casco',
  kinetic: 'Cinético: ×1.25 casco, ×0.75 sistemas',
  explosive: 'Explosivo: ×1.25 sistemas, ×0.75 escudos',
}

export const CLASS_COLORS: Record<CrewClassId, number> = {
  pilot: 0x2de2e6,
  engineer: 0xf3f99d,
  gunner: 0xffb454,
  medic: 0x5af78e,
  soldier: 0xc792ea,
}

export const CLASS_INITIALS: Record<CrewClassId, string> = {
  pilot: 'P',
  engineer: 'I',
  gunner: 'A',
  medic: 'M',
  soldier: 'S',
}

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function cssOf(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

export function rectCenter(r: Rect): Vec2 {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

export function makeText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  size: number,
  color: string = COLORS_CSS.text,
  extra: Phaser.Types.GameObjects.Text.TextStyle = {},
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, {
    fontFamily: FONTS.body,
    fontSize: `${size}px`,
    color,
    ...extra,
  })
}

export function makeTitleText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  size: number,
  color: string = COLORS_CSS.text,
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, {
    fontFamily: FONTS.title,
    fontSize: `${size}px`,
    color,
  })
}

/** Draws a dashed line; an empty dash pattern draws a solid line. */
export function drawDashedLine(
  g: Phaser.GameObjects.Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dash: number[],
): void {
  const on = dash[0]
  const off = dash[1]
  if (on === undefined || off === undefined) {
    g.lineBetween(x1, y1, x2, y2)
    return
  }
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  if (len < 1) return
  const ux = dx / len
  const uy = dy / len
  let t = 0
  while (t < len) {
    const seg = Math.min(on, len - t)
    g.lineBetween(x1 + ux * t, y1 + uy * t, x1 + ux * (t + seg), y1 + uy * (t + seg))
    t += on + off
  }
}

/** One pass of Chaikin corner cutting per iteration (closed polygon). */
export function chaikin(points: Vec2[], iterations: number): Vec2[] {
  let cur = points
  for (let it = 0; it < iterations; it++) {
    const out: Vec2[] = []
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i]
      const b = cur[(i + 1) % cur.length]
      if (a === undefined || b === undefined) continue
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 })
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 })
    }
    cur = out
  }
  return cur
}
