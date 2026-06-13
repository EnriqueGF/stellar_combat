// Sector graph generation (GAME_SPEC §4.1): SECTOR_COLUMNS columns.
// Col 0 = start (1 node), col 1 = guaranteed single intro combat,
// cols 2..6 = 2-3 nodes weighted by NODE_TYPE_WEIGHTS, last col = boss.

import {
  NODE_TYPE_WEIGHTS,
  SECTOR_COLUMNS,
  pickWeighted,
  type NodeType,
  type PlanetBiome,
  type SectorMap,
  type SectorNode,
} from '@stellar/shared'

const BIOMES: PlanetBiome[] = ['gas_giant', 'rocky', 'ice', 'volcanic', 'oceanic', 'desert']
const WEIGHTED_TYPES = Object.keys(NODE_TYPE_WEIGHTS) as (keyof typeof NODE_TYPE_WEIGHTS)[]
const TYPE_WEIGHTS = WEIGHTED_TYPES.map((t) => NODE_TYPE_WEIGHTS[t])

export function generateSector(rng: () => number): SectorMap {
  const nodes: SectorNode[] = []
  const columns: SectorNode[][] = []

  for (let col = 0; col < SECTOR_COLUMNS; col++) {
    const single = col === 0 || col === 1 || col === SECTOR_COLUMNS - 1
    const count = single ? 1 : 2 + (rng() < 0.5 ? 1 : 0)
    const rows = rowsFor(count)
    const colNodes: SectorNode[] = []
    for (let i = 0; i < count; i++) {
      const node: SectorNode = {
        id: nodes.length,
        col,
        row: rows[i] ?? i,
        type: nodeTypeFor(col, rng),
        edges: [],
        biome: BIOMES[Math.floor(rng() * BIOMES.length)] ?? 'rocky',
        seed: Math.floor(rng() * 0x7fffffff),
      }
      nodes.push(node)
      colNodes.push(node)
    }
    columns.push(colNodes)
  }

  for (let col = 0; col < SECTOR_COLUMNS - 1; col++) {
    connectColumns(columns[col] ?? [], columns[col + 1] ?? [], rng)
  }

  return { nodes, startNodeId: columns[0]?.[0]?.id ?? 0 }
}

/** Visual rows 0..2; spread nodes so edges stay readable. */
function rowsFor(count: number): number[] {
  if (count === 1) return [1]
  if (count === 2) return [0, 2]
  return [0, 1, 2]
}

function nodeTypeFor(col: number, rng: () => number): NodeType {
  if (col === 0) return 'start'
  if (col === 1) return 'combat'
  if (col === SECTOR_COLUMNS - 1) return 'boss'
  return WEIGHTED_TYPES[pickWeighted(TYPE_WEIGHTS, rng())] ?? 'combat'
}

/**
 * Connects two consecutive columns without crossings: each `from` node links to a
 * contiguous window of `to` nodes. The base windows partition `to`, so every node
 * is guaranteed >=1 incoming and >=1 outgoing edge; random window extensions add
 * variety (1-3 edges per node).
 */
function connectColumns(from: SectorNode[], to: SectorNode[], rng: () => number): void {
  const na = from.length
  const nb = to.length
  if (na === 0 || nb === 0) return

  for (let i = 0; i < na; i++) {
    const node = from[i]
    if (!node) continue
    let lo = Math.floor((i * nb) / na)
    let hi = Math.floor(((i + 1) * nb) / na - 1e-9)
    if (hi < lo) hi = lo
    if (hi - lo < 2 && hi < nb - 1 && rng() < 0.35) hi += 1
    else if (hi - lo < 2 && lo > 0 && rng() < 0.2) lo -= 1
    for (let j = lo; j <= hi && node.edges.length < 3; j++) {
      const target = to[j]
      if (target && !node.edges.includes(target.id)) node.edges.push(target.id)
    }
  }

  // Safety net (window math already covers all of `to`): attach orphans to the
  // nearest-by-row `from` node, preferring nodes that still have edge capacity.
  for (const t of to) {
    if (from.some((f) => f.edges.includes(t.id))) continue
    const withCapacity = from.filter((f) => f.edges.length < 3)
    const pool = withCapacity.length > 0 ? withCapacity : from
    let best: SectorNode | undefined
    for (const f of pool) {
      if (!best || Math.abs(f.row - t.row) < Math.abs(best.row - t.row)) best = f
    }
    best?.edges.push(t.id)
  }
}
