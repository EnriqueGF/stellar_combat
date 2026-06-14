// All HUD/ship icons are drawn with Graphics primitives (no emoji, no sprites).
// Every function draws centered at (cx, cy) with `s` as the full icon size.

import type Phaser from 'phaser'
import type { CrewTask, SystemId, WeaponCategory } from '@stellar/shared'
import { COLORS } from '../theme'

type G = Phaser.GameObjects.Graphics

export function drawSystemIcon(g: G, sys: SystemId, cx: number, cy: number, s: number, color: number): void {
  const h = s / 2
  switch (sys) {
    case 'weapons': {
      // Triple cannon: three barrels over a base block.
      g.fillStyle(color, 1)
      const bw = Math.max(2, s * 0.14)
      g.fillRect(cx - s * 0.32 - bw / 2, cy - h * 0.55, bw, s * 0.75)
      g.fillRect(cx - bw / 2, cy - h, bw, s * 1.0)
      g.fillRect(cx + s * 0.32 - bw / 2, cy - h * 0.55, bw, s * 0.75)
      g.fillRect(cx - s * 0.42, cy + h * 0.45, s * 0.84, s * 0.28)
      break
    }
    case 'shields': {
      // Rhombus with a faint core.
      g.lineStyle(1.5, color, 1)
      g.beginPath()
      g.moveTo(cx, cy - h)
      g.lineTo(cx + h * 0.8, cy)
      g.lineTo(cx, cy + h)
      g.lineTo(cx - h * 0.8, cy)
      g.closePath()
      g.strokePath()
      g.fillStyle(color, 0.35)
      g.beginPath()
      g.moveTo(cx, cy - h * 0.45)
      g.lineTo(cx + h * 0.36, cy)
      g.lineTo(cx, cy + h * 0.45)
      g.lineTo(cx - h * 0.36, cy)
      g.closePath()
      g.fillPath()
      break
    }
    case 'engines': {
      // Nozzle with exhaust flame.
      g.fillStyle(color, 1)
      g.beginPath()
      g.moveTo(cx - h * 0.45, cy - h)
      g.lineTo(cx + h * 0.45, cy - h)
      g.lineTo(cx + h * 0.85, cy + h * 0.15)
      g.lineTo(cx - h * 0.85, cy + h * 0.15)
      g.closePath()
      g.fillPath()
      g.fillStyle(color, 0.7)
      g.fillTriangle(cx - h * 0.4, cy + h * 0.3, cx + h * 0.4, cy + h * 0.3, cx, cy + h)
      break
    }
    case 'oxygen': {
      // Bubbles.
      g.lineStyle(1.5, color, 1)
      g.strokeCircle(cx - s * 0.08, cy + s * 0.08, h * 0.62)
      g.fillStyle(color, 1)
      g.fillCircle(cx + h * 0.55, cy - h * 0.5, s * 0.12)
      g.fillCircle(cx + h * 0.2, cy - h * 0.85, s * 0.07)
      break
    }
    case 'medbay': {
      // Medical cross.
      g.fillStyle(color, 1)
      g.fillRect(cx - s * 0.14, cy - h * 0.9, s * 0.28, s * 0.9)
      g.fillRect(cx - h * 0.9, cy - s * 0.14, s * 0.9, s * 0.28)
      break
    }
    case 'cockpit': {
      // Helm pointer (cursor) with a short tail.
      g.fillStyle(color, 1)
      g.fillTriangle(
        cx - h * 0.55,
        cy - h * 0.8,
        cx + h * 0.75,
        cy + h * 0.05,
        cx - h * 0.2,
        cy + h * 0.35,
      )
      g.lineStyle(1.5, color, 1)
      g.lineBetween(cx - h * 0.15, cy + h * 0.25, cx + h * 0.25, cy + h * 0.85)
      break
    }
    case 'drones': {
      // Hexagon with a core dot.
      g.lineStyle(1.5, color, 1)
      g.beginPath()
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k - Math.PI / 6
        const px = cx + Math.cos(a) * h * 0.85
        const py = cy + Math.sin(a) * h * 0.85
        if (k === 0) g.moveTo(px, py)
        else g.lineTo(px, py)
      }
      g.closePath()
      g.strokePath()
      g.fillStyle(color, 1)
      g.fillCircle(cx, cy, s * 0.12)
      break
    }
  }
}

export function drawCategoryIcon(
  g: G,
  cat: WeaponCategory,
  cx: number,
  cy: number,
  s: number,
  color: number,
): void {
  const h = s / 2
  switch (cat) {
    case 'energy': {
      // Lightning bolt.
      g.fillStyle(color, 1)
      g.beginPath()
      g.moveTo(cx + s * 0.18, cy - h)
      g.lineTo(cx - s * 0.3, cy + s * 0.1)
      g.lineTo(cx - s * 0.02, cy + s * 0.1)
      g.lineTo(cx - s * 0.18, cy + h)
      g.lineTo(cx + s * 0.3, cy - s * 0.08)
      g.lineTo(cx + s * 0.02, cy - s * 0.08)
      g.closePath()
      g.fillPath()
      break
    }
    case 'kinetic': {
      // Shell with speed lines.
      g.fillStyle(color, 1)
      g.fillRect(cx - s * 0.28, cy - s * 0.18, s * 0.46, s * 0.36)
      g.fillCircle(cx + s * 0.18, cy, s * 0.18)
      g.lineStyle(1.5, color, 0.8)
      g.lineBetween(cx - h, cy - s * 0.12, cx - s * 0.34, cy - s * 0.12)
      g.lineBetween(cx - h, cy + s * 0.12, cx - s * 0.34, cy + s * 0.12)
      break
    }
    case 'explosive': {
      // Four-point starburst.
      g.fillStyle(color, 1)
      g.fillTriangle(cx, cy - h, cx - s * 0.14, cy, cx + s * 0.14, cy)
      g.fillTriangle(cx, cy + h, cx - s * 0.14, cy, cx + s * 0.14, cy)
      g.fillTriangle(cx - h, cy, cx, cy - s * 0.14, cx, cy + s * 0.14)
      g.fillTriangle(cx + h, cy, cx, cy - s * 0.14, cx, cy + s * 0.14)
      g.fillCircle(cx, cy, s * 0.12)
      break
    }
  }
}

/** Small triangle outline marking "category triangle" affinity info. */
export function drawTriangleBadge(g: G, cx: number, cy: number, s: number, color: number): void {
  const h = s / 2
  g.lineStyle(1.2, color, 0.9)
  g.strokeTriangle(cx, cy - h, cx + h * 0.95, cy + h * 0.8, cx - h * 0.95, cy + h * 0.8)
}

export function drawCrossOut(g: G, cx: number, cy: number, s: number, color: number): void {
  const h = s / 2
  g.lineStyle(2, color, 1)
  g.lineBetween(cx - h, cy - h, cx + h, cy + h)
  g.lineBetween(cx + h, cy - h, cx - h, cy + h)
}

/** Unplugged power connector (crossed). */
export function drawPlugCrossed(g: G, cx: number, cy: number, s: number, color: number): void {
  const h = s / 2
  g.fillStyle(color, 1)
  g.fillRect(cx - s * 0.22, cy - s * 0.18, s * 0.44, s * 0.42)
  g.lineStyle(1.5, color, 1)
  g.lineBetween(cx - s * 0.1, cy - s * 0.18, cx - s * 0.1, cy - h)
  g.lineBetween(cx + s * 0.1, cy - s * 0.18, cx + s * 0.1, cy - h)
  g.lineBetween(cx, cy + s * 0.24, cx, cy + h)
  drawCrossOut(g, cx, cy, s * 1.2, COLORS.danger)
}

export function drawMissileIcon(
  g: G,
  cx: number,
  cy: number,
  s: number,
  color: number,
  crossed: boolean,
): void {
  const h = s / 2
  g.fillStyle(color, 1)
  g.fillRect(cx - s * 0.13, cy - s * 0.3, s * 0.26, s * 0.6)
  g.fillTriangle(cx - s * 0.13, cy - s * 0.3, cx + s * 0.13, cy - s * 0.3, cx, cy - h)
  g.fillTriangle(cx - s * 0.13, cy + s * 0.3, cx - s * 0.3, cy + h, cx - s * 0.13, cy + h)
  g.fillTriangle(cx + s * 0.13, cy + s * 0.3, cx + s * 0.3, cy + h, cx + s * 0.13, cy + h)
  if (crossed) drawCrossOut(g, cx, cy, s * 1.1, COLORS.danger)
}

/** Crossed-out droplet for rooms with critically low O2. */
export function drawDropletCrossed(g: G, cx: number, cy: number, s: number, color: number): void {
  const h = s / 2
  g.fillStyle(color, 1)
  g.fillCircle(cx, cy + s * 0.15, s * 0.32)
  g.fillTriangle(cx - s * 0.3, cy + s * 0.1, cx + s * 0.3, cy + s * 0.1, cx, cy - h)
  g.lineStyle(1.5, COLORS.danger, 1)
  g.lineBetween(cx - h, cy + h, cx + h, cy - h)
}

/** Scrap currency: an amber hex nut (salvaged parts), distinct from the solid drone hexagon. */
export function drawScrapIcon(g: G, cx: number, cy: number, s: number, color: number): void {
  const r = s * 0.5
  const hex = (rr: number): void => {
    g.beginPath()
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k - Math.PI / 6
      const px = cx + Math.cos(a) * rr
      const py = cy + Math.sin(a) * rr
      if (k === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.closePath()
  }
  g.fillStyle(color, 0.18)
  hex(r)
  g.fillPath()
  g.lineStyle(Math.max(1.5, s * 0.12), color, 1)
  hex(r)
  g.strokePath()
  g.lineStyle(Math.max(1, s * 0.09), color, 1)
  g.strokeCircle(cx, cy, r * 0.42)
}

/** Hull: a delta-wing starship silhouette (nose up, notched tail). */
export function drawHullIcon(g: G, cx: number, cy: number, s: number, color: number): void {
  const h = s / 2
  g.fillStyle(color, 0.25)
  g.lineStyle(1.5, color, 1)
  g.beginPath()
  g.moveTo(cx, cy - h)
  g.lineTo(cx + h * 0.78, cy + h)
  g.lineTo(cx, cy + h * 0.45)
  g.lineTo(cx - h * 0.78, cy + h)
  g.closePath()
  g.fillPath()
  g.strokePath()
}

/** Evasion: a swerve/dodge double-chevron. */
export function drawEvasionIcon(g: G, cx: number, cy: number, s: number, color: number): void {
  const h = s / 2
  g.lineStyle(Math.max(1.5, s * 0.14), color, 1)
  for (const dx of [-h * 0.55, h * 0.05]) {
    g.beginPath()
    g.moveTo(cx + dx - h * 0.2, cy - h * 0.6)
    g.lineTo(cx + dx + h * 0.4, cy)
    g.lineTo(cx + dx - h * 0.2, cy + h * 0.6)
    g.strokePath()
  }
}

export function drawWarnTriangle(g: G, cx: number, cy: number, s: number, color: number): void {
  const h = s / 2
  g.lineStyle(2, color, 1)
  g.strokeTriangle(cx, cy - h, cx + h, cy + h * 0.85, cx - h, cy + h * 0.85)
  g.fillStyle(color, 1)
  g.fillRect(cx - 1, cy - s * 0.22, 2, s * 0.32)
  g.fillRect(cx - 1, cy + s * 0.2, 2, 2)
}

export function drawTaskIcon(g: G, task: CrewTask, cx: number, cy: number, s: number, color: number): void {
  const h = s / 2
  switch (task) {
    case 'repair': {
      // Hammer: a head block at the top of a diagonal handle.
      const hx = cx + h * 0.28
      const hy = cy - h * 0.5
      g.lineStyle(Math.max(2, s * 0.22), color, 1)
      g.lineBetween(cx - h * 0.55, cy + h * 0.78, hx, hy)
      g.fillStyle(color, 1)
      g.fillRect(hx - s * 0.42, hy - s * 0.2, s * 0.74, s * 0.36)
      break
    }
    case 'fight_fire': {
      // Flame, slashed.
      g.fillStyle(color, 1)
      g.fillTriangle(cx - s * 0.3, cy + h, cx + s * 0.3, cy + h, cx, cy - h)
      g.lineStyle(1.5, COLORS.danger, 1)
      g.lineBetween(cx - h, cy + h, cx + h, cy - h)
      break
    }
    case 'seal_breach': {
      // Patch plate with rivets.
      g.lineStyle(1.5, color, 1)
      g.strokeRect(cx - h * 0.8, cy - h * 0.8, s * 0.8, s * 0.8)
      g.fillStyle(color, 1)
      g.fillRect(cx - 1, cy - 1, 2, 2)
      break
    }
    case 'heal': {
      g.fillStyle(color, 1)
      g.fillRect(cx - 1, cy - h, 2, s)
      g.fillRect(cx - h, cy - 1, s, 2)
      break
    }
    case 'operate': {
      // Console: ring with ticks.
      g.lineStyle(1.5, color, 1)
      g.strokeCircle(cx, cy, h * 0.65)
      g.lineBetween(cx, cy - h, cx, cy - h * 0.45)
      g.lineBetween(cx, cy + h * 0.45, cx, cy + h)
      break
    }
    case 'idle':
    case 'moving':
      break
  }
}
