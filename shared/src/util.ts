// Small shared utilities. The server seeds battle RNG with mulberry32 for reproducibility.

/** Deterministic PRNG; returns a function yielding floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/** Picks an index from relative weights using the given roll in [0,1). */
export function pickWeighted(weights: number[], roll: number): number {
  const total = weights.reduce((a, b) => a + b, 0)
  let acc = 0
  const target = roll * total
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i] ?? 0
    if (target < acc) return i
  }
  return weights.length - 1
}

let idCounter = 0
/** Process-unique id (server-side use). */
export function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}_${idCounter.toString(36)}`
}
