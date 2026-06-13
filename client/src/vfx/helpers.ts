// Internal helpers for the procedural VFX library (pixel buffers, color math,
// Bayer dithering, circle-accumulation noise). Not exported outside vfx/.

import Phaser from 'phaser'

let uid = 0
/** Unique texture key per instance so scenes never collide. */
export function uniqueKey(prefix: string): string {
  uid += 1
  return `${prefix}_${uid.toString(36)}`
}

export interface Rgb {
  r: number
  g: number
  b: number
}

export function rgb(hex: number): Rgb {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff }
}

export function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = t < 0 ? 0 : t > 1 ? 1 : t
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  }
}

/** Multiplies brightness; f > 1 lightens (clamped to 255). */
export function shadeRgb(c: Rgb, f: number): Rgb {
  return {
    r: Math.min(255, c.r * f),
    g: Math.min(255, c.g * f),
    b: Math.min(255, c.b * f),
  }
}

// Bayer 2x2 threshold offsets centered on 0 (used at quantization band edges).
const BAYER2 = [
  [-0.375, 0.125],
  [0.375, -0.125],
] as const

export function bayer2(x: number, y: number): number {
  const row = BAYER2[y & 1]
  return row?.[x & 1] ?? 0
}

/** Quantizes v in [0,1] to a palette index with Bayer 2x2 dithering at edges. */
export function ditherIndex(v: number, levels: number, x: number, y: number): number {
  const i = Math.floor(v * levels + bayer2(x, y) * 0.9)
  return i < 0 ? 0 : i >= levels ? levels - 1 : i
}

/** RGBA pixel buffer committed once into a Phaser CanvasTexture (NEAREST). */
export class PixelBuffer {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray<ArrayBuffer>

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width))
    this.height = Math.max(1, Math.ceil(height))
    this.data = new Uint8ClampedArray(this.width * this.height * 4)
  }

  set(x: number, y: number, c: Rgb, alpha = 1): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    const i = (y * this.width + x) * 4
    this.data[i] = c.r
    this.data[i + 1] = c.g
    this.data[i + 2] = c.b
    this.data[i + 3] = Math.max(0, Math.min(255, Math.round(alpha * 255)))
  }

  /**
   * Uploads the buffer as a low-resolution canvas texture scaled later with
   * FilterMode.NEAREST for the genuine pixel-art look (GAME_SPEC §6.1).
   */
  toTexture(scene: Phaser.Scene, key: string): string {
    if (scene.textures.exists(key)) scene.textures.remove(key)
    const tex = scene.textures.createCanvas(key, this.width, this.height)
    if (!tex) throw new Error(`vfx: cannot create canvas texture ${key}`)
    const ctx = tex.getContext()
    ctx.putImageData(new ImageData(this.data, this.width, this.height), 0, 0)
    tex.refresh()
    tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
    return key
  }
}

/**
 * Cheap fractal value noise: octaves of random circles accumulated (ADD),
 * normalized to [0,1]. Good enough for nebulae, continents and mottling.
 */
export function fbmCircles(
  width: number,
  height: number,
  rng: () => number,
  octaves = 3,
  baseCount = 10,
): Float32Array {
  const buf = new Float32Array(width * height)
  let radius = Math.max(width, height) * 0.42
  let gain = 1
  let count = baseCount
  for (let o = 0; o < octaves; o++) {
    for (let n = 0; n < count; n++) {
      const cx = rng() * width
      const cy = rng() * height
      const r = radius * (0.5 + rng() * 0.7)
      const x0 = Math.max(0, Math.floor(cx - r))
      const x1 = Math.min(width - 1, Math.ceil(cx + r))
      const y0 = Math.max(0, Math.floor(cy - r))
      const y1 = Math.min(height - 1, Math.ceil(cy + r))
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx
          const dy = y - cy
          const d = Math.sqrt(dx * dx + dy * dy) / r
          if (d < 1) {
            const idx = y * width + x
            buf[idx] = (buf[idx] ?? 0) + (1 - d) * gain
          }
        }
      }
    }
    radius *= 0.5
    gain *= 0.55
    count *= 2
  }
  let max = 0
  for (let i = 0; i < buf.length; i++) max = Math.max(max, buf[i] ?? 0)
  if (max > 0) for (let i = 0; i < buf.length; i++) buf[i] = (buf[i] ?? 0) / max
  return buf
}

export function sampleNoise(
  buf: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const xi = Math.max(0, Math.min(width - 1, Math.round(x)))
  const yi = Math.max(0, Math.min(height - 1, Math.round(y)))
  return buf[yi * width + xi] ?? 0
}

/**
 * Stamps a meandering 1px walk into a mask buffer (crack/lava-vein shapes).
 * Returns positions visited so callers can thicken or glow around them.
 */
export function randomWalk(
  mask: Float32Array,
  width: number,
  height: number,
  rng: () => number,
  startX: number,
  startY: number,
  steps: number,
  value = 1,
): void {
  let x = startX
  let y = startY
  let dir = rng() * Math.PI * 2
  for (let i = 0; i < steps; i++) {
    const xi = Math.round(x)
    const yi = Math.round(y)
    if (xi >= 0 && yi >= 0 && xi < width && yi < height) {
      mask[yi * width + xi] = Math.max(mask[yi * width + xi] ?? 0, value)
    }
    dir += (rng() - 0.5) * 1.1
    x += Math.cos(dir)
    y += Math.sin(dir)
    if (x < 1 || y < 1 || x > width - 2 || y > height - 2) break
  }
}

export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}
