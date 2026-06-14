// Procedural icons for the main-menu items. Same conventions as battle/icons.ts:
// every function draws with Graphics primitives (no emoji, no sprites), centered
// at (cx, cy) with `s` as the full icon size. Each metaphor uses a distinct
// shape so items stay identifiable for colorblind players (shape + color).

import Phaser from 'phaser'
import { COLORS } from '../theme'

type G = Phaser.GameObjects.Graphics

/** Expedition: a star-map route — connected nodes along a jump path, ending in a star. */
export function drawExpeditionIcon(g: G, cx: number, cy: number, s: number, color: number): void {
  const h = s / 2
  // Three waypoints linked by a dashed-feel path (straight segments).
  const a = { x: cx - h * 0.8, y: cy + h * 0.55 }
  const b = { x: cx - h * 0.05, y: cy - h * 0.45 }
  const c = { x: cx + h * 0.8, y: cy + h * 0.05 }
  g.lineStyle(Math.max(1.4, s * 0.1), color, 0.85)
  g.lineBetween(a.x, a.y, b.x, b.y)
  g.lineBetween(b.x, b.y, c.x, c.y)
  // Start + mid nodes (hollow rings), destination as a filled 4-point star.
  g.fillStyle(COLORS.panel, 1)
  g.lineStyle(Math.max(1.4, s * 0.1), color, 1)
  g.fillCircle(a.x, a.y, s * 0.12)
  g.strokeCircle(a.x, a.y, s * 0.12)
  g.fillCircle(b.x, b.y, s * 0.1)
  g.strokeCircle(b.x, b.y, s * 0.1)
  g.fillStyle(color, 1)
  const sr = s * 0.2
  g.fillTriangle(c.x, c.y - sr, c.x - sr * 0.42, c.y, c.x + sr * 0.42, c.y)
  g.fillTriangle(c.x, c.y + sr, c.x - sr * 0.42, c.y, c.x + sr * 0.42, c.y)
  g.fillTriangle(c.x - sr, c.y, c.x, c.y - sr * 0.42, c.x, c.y + sr * 0.42)
  g.fillTriangle(c.x + sr, c.y, c.x, c.y - sr * 0.42, c.x, c.y + sr * 0.42)
}

/** Duel (PvP): two ships nose-to-nose with a crossed-beams clash spark between them. */
export function drawDuelIcon(g: G, cx: number, cy: number, s: number, color: number): void {
  const h = s / 2
  // Left ship: small delta pointing right.
  g.fillStyle(color, 1)
  g.fillTriangle(cx - h * 0.95, cy - h * 0.55, cx - h * 0.95, cy + h * 0.55, cx - h * 0.2, cy)
  // Right ship: small delta pointing left.
  g.fillTriangle(cx + h * 0.95, cy - h * 0.55, cx + h * 0.95, cy + h * 0.55, cx + h * 0.2, cy)
  // Crossed beams / clash in the middle.
  g.lineStyle(Math.max(1.2, s * 0.09), COLORS.danger, 1)
  g.lineBetween(cx - h * 0.18, cy - h * 0.45, cx + h * 0.18, cy + h * 0.45)
  g.lineBetween(cx + h * 0.18, cy - h * 0.45, cx - h * 0.18, cy + h * 0.45)
}

/** Tutorial: an open book (two facing pages) — learn-the-ropes practice. */
export function drawTutorialIcon(g: G, cx: number, cy: number, s: number, color: number): void {
  const h = s / 2
  g.lineStyle(Math.max(1.3, s * 0.09), color, 1)
  // Spine.
  g.lineBetween(cx, cy - h * 0.8, cx, cy + h * 0.78)
  // Left page (outer edge curves up toward the spine).
  g.beginPath()
  g.moveTo(cx, cy - h * 0.8)
  g.lineTo(cx - h * 0.9, cy - h * 0.5)
  g.lineTo(cx - h * 0.9, cy + h * 0.7)
  g.lineTo(cx, cy + h * 0.78)
  g.strokePath()
  // Right page (mirror).
  g.beginPath()
  g.moveTo(cx, cy - h * 0.8)
  g.lineTo(cx + h * 0.9, cy - h * 0.5)
  g.lineTo(cx + h * 0.9, cy + h * 0.7)
  g.lineTo(cx, cy + h * 0.78)
  g.strokePath()
  // Text lines hint.
  g.lineStyle(Math.max(1, s * 0.06), color, 0.55)
  g.lineBetween(cx - h * 0.68, cy - h * 0.18, cx - h * 0.18, cy - h * 0.08)
  g.lineBetween(cx - h * 0.68, cy + h * 0.18, cx - h * 0.18, cy + h * 0.28)
  g.lineBetween(cx + h * 0.18, cy - h * 0.08, cx + h * 0.68, cy - h * 0.18)
  g.lineBetween(cx + h * 0.18, cy + h * 0.28, cx + h * 0.68, cy + h * 0.18)
}

/** How to play: a question mark inside a ring — quick help / reference. */
export function drawHelpIcon(g: G, cx: number, cy: number, s: number, color: number): void {
  const h = s / 2
  g.lineStyle(Math.max(1.3, s * 0.09), color, 1)
  g.strokeCircle(cx, cy, h * 0.92)
  // Question-mark hook: arc across the top + short stem.
  const r = h * 0.34
  const top = cy - h * 0.28
  g.beginPath()
  g.arc(cx, top, r, Phaser.Math.DegToRad(160), Phaser.Math.DegToRad(20), false)
  g.strokePath()
  g.lineBetween(cx + Math.cos(Phaser.Math.DegToRad(20)) * r, top + Math.sin(Phaser.Math.DegToRad(20)) * r, cx, cy + h * 0.16)
  // Dot.
  g.fillStyle(color, 1)
  g.fillCircle(cx, cy + h * 0.46, Math.max(1.2, s * 0.07))
}

/** Options: a settings gear (toothed ring + hub). */
export function drawGearIcon(g: G, cx: number, cy: number, s: number, color: number): void {
  const h = s / 2
  const teeth = 8
  const rOut = h * 0.92
  const rIn = h * 0.62
  g.lineStyle(Math.max(1.3, s * 0.09), color, 1)
  g.beginPath()
  for (let k = 0; k < teeth * 2; k++) {
    const a = (Math.PI / teeth) * k
    const rr = k % 2 === 0 ? rOut : rIn
    const px = cx + Math.cos(a) * rr
    const py = cy + Math.sin(a) * rr
    if (k === 0) g.moveTo(px, py)
    else g.lineTo(px, py)
  }
  g.closePath()
  g.strokePath()
  // Hub.
  g.strokeCircle(cx, cy, h * 0.3)
}

/** Wiki: an external-link card — a framed page with an out-arrow (opens new tab). */
export function drawWikiIcon(g: G, cx: number, cy: number, s: number, color: number): void {
  const h = s / 2
  // Page frame, with the top-right corner left open for the arrow.
  g.lineStyle(Math.max(1.3, s * 0.09), color, 1)
  g.beginPath()
  g.moveTo(cx + h * 0.18, cy - h * 0.78)
  g.lineTo(cx - h * 0.78, cy - h * 0.78)
  g.lineTo(cx - h * 0.78, cy + h * 0.78)
  g.lineTo(cx + h * 0.78, cy + h * 0.78)
  g.lineTo(cx + h * 0.78, cy - h * 0.18)
  g.strokePath()
  // Text lines.
  g.lineStyle(Math.max(1, s * 0.06), color, 0.6)
  g.lineBetween(cx - h * 0.5, cy - h * 0.18, cx + h * 0.3, cy - h * 0.18)
  g.lineBetween(cx - h * 0.5, cy + h * 0.12, cx + h * 0.42, cy + h * 0.12)
  g.lineBetween(cx - h * 0.5, cy + h * 0.42, cx + h * 0.1, cy + h * 0.42)
  // Out-arrow (top-right): diagonal shaft + head.
  g.lineStyle(Math.max(1.3, s * 0.09), color, 1)
  const a0 = { x: cx + h * 0.34, y: cy - h * 0.34 }
  const a1 = { x: cx + h * 0.9, y: cy - h * 0.9 }
  g.lineBetween(a0.x, a0.y, a1.x, a1.y)
  g.lineBetween(a1.x, a1.y, a1.x - h * 0.36, a1.y)
  g.lineBetween(a1.x, a1.y, a1.x, a1.y + h * 0.36)
}

/** Account: a person silhouette (head + shoulders) — sign in / profile. */
export function drawAccountIcon(g: G, cx: number, cy: number, s: number, color: number): void {
  const h = s / 2
  g.fillStyle(color, 1)
  // Head.
  g.fillCircle(cx, cy - h * 0.42, h * 0.36)
  // Shoulders: a rounded arc-cap. Approximate with a filled half-disc using a
  // triangle fan via arc on a Graphics path.
  g.beginPath()
  g.arc(cx, cy + h * 0.62, h * 0.74, Phaser.Math.DegToRad(200), Phaser.Math.DegToRad(340), false)
  g.lineTo(cx + h * 0.7, cy + h * 0.78)
  g.lineTo(cx - h * 0.7, cy + h * 0.78)
  g.closePath()
  g.fillPath()
}
