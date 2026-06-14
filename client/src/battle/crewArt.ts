// Procedural crew art: each species is a small pixel-art humanoid drawn from a
// per-race cell grid. RACE reads from the skin colour + silhouette features
// (antennae, crystal crown, glow…); CLASS reads from the suit colour. No sprites
// — every "pixel" is a filled rect, so it scales to any token size.

import type Phaser from 'phaser'
import { CREW_RACES, type CrewClassId, type CrewRaceId } from '@stellar/shared'
import { CLASS_COLORS } from './common'

const DEFAULT_FILL = 0xd9a77f
const DEFAULT_ACCENT = 0x2de2e6

// Logical pixel grid (all figures share these dimensions so sizing is uniform).
const GW = 10
const GH = 13

/** Scales each channel of an RGB colour by `f` (clamped), for cheap shading. */
function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f))
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * f))
  const b = Math.min(255, Math.round((color & 0xff) * f))
  return (r << 16) | (g << 8) | b
}

/** Builds the per-race cell grid (cells hold a colour or -1 for transparent). */
function buildFigure(raceId: CrewRaceId, cls: CrewClassId): number[][] {
  const race = CREW_RACES[raceId]
  const skin = race?.color ?? DEFAULT_FILL
  const accent = race?.accent ?? DEFAULT_ACCENT
  const suit = CLASS_COLORS[cls] ?? 0x8a93a3
  const line = shade(skin, 0.32) // dark outline, tinted by the species hue
  const boot = shade(suit, 0.7)

  const cells: number[][] = Array.from({ length: GH }, () => new Array<number>(GW).fill(-1))
  const set = (x: number, y: number, c: number): void => {
    if (x >= 0 && x < GW && y >= 0 && y < GH && c >= 0) cells[y]![x] = c
  }
  const clr = (x: number, y: number): void => {
    if (x >= 0 && x < GW && y >= 0 && y < GH) cells[y]![x] = -1
  }
  const rect = (x: number, y: number, w: number, h: number, c: number): void => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c)
  }

  // --- shared humanoid base: head, torso (suit), arms, two legs ---
  rect(3, 1, 4, 4, line) // helmet
  rect(4, 2, 2, 2, skin) // face
  rect(2, 5, 6, 4, line) // torso block (shoulders wider than head)
  rect(3, 6, 4, 2, suit) // suit front
  set(1, 5, line); set(1, 6, line); set(1, 7, skin) // left arm + hand
  set(8, 5, line); set(8, 6, line); set(8, 7, skin) // right arm + hand
  rect(2, 9, 2, 4, line) // left leg
  rect(6, 9, 2, 4, line) // right leg (gap at cols 4-5)
  set(2, 12, boot); set(3, 12, boot); set(6, 12, boot); set(7, 12, boot)

  switch (race?.shape) {
    case 'rock': {
      // Bulky silicate colossus: blocky head, broad torso, facet glints.
      rect(2, 1, 5, 4, line); rect(3, 2, 3, 2, skin)
      rect(1, 5, 8, 4, line); rect(2, 6, 6, 2, suit)
      set(0, 6, line); set(9, 6, line); set(0, 7, skin); set(9, 7, skin)
      set(5, 3, accent); set(3, 6, accent) // facet glints
      break
    }
    case 'synth': {
      // Synthetic: antenna nub + a horizontal optical visor.
      set(5, 0, accent)
      rect(3, 2, 4, 1, accent) // eye bar
      break
    }
    case 'mantid': {
      // Insectoid: two antennae and big compound eyes; slim frame.
      set(2, 0, accent); set(3, 1, accent)
      set(7, 0, accent); set(6, 1, accent)
      set(4, 2, accent); set(5, 2, accent)
      break
    }
    case 'plasmid': {
      // Energy being: glowing core, no legs — a tapered plasma tail.
      rect(2, 9, 6, 4, -1)
      rect(3, 6, 4, 2, accent)
      set(4, 9, accent); set(5, 9, accent)
      set(4, 10, suit); set(5, 10, suit); set(4, 11, accent)
      set(2, 4, accent); set(7, 4, accent) // halo sparks
      break
    }
    case 'cryo': {
      // Cryon: crystalline crown and shoulder shards, bright eyes.
      set(4, 0, accent); set(5, 0, accent)
      set(3, 1, accent); set(6, 1, accent)
      set(4, 2, accent); set(5, 2, accent)
      set(2, 5, accent); set(7, 5, accent)
      break
    }
    default: {
      // Human: visored helmet.
      clr(3, 3); clr(6, 3)
      rect(3, 3, 4, 1, accent)
      break
    }
  }

  return cells
}

/** Draws a species pixel-figure centred at (0,0) into `g`, sized so it is
 *  `radius*2` tall (its natural width is narrower, so it fits a round token). */
export function drawRaceBody(
  g: Phaser.GameObjects.Graphics,
  raceId: CrewRaceId,
  cls: CrewClassId,
  radius: number,
): void {
  const cells = buildFigure(raceId, cls)
  const cell = (radius * 2 * 0.96) / GH
  const ox = -(GW * cell) / 2
  const oy = -(GH * cell) / 2
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const c = cells[y]![x]!
      if (c >= 0) {
        g.fillStyle(c, 1)
        g.fillRect(ox + x * cell, oy + y * cell, cell + 0.6, cell + 0.6)
      }
    }
  }
}
