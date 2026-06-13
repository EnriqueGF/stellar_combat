// Procedural pixel-art space backdrop (GAME_SPEC §6.1): 3 parallax star layers,
// quantized nebulae and a big dithered biome planet. Everything is generated
// once per instance into low-res (1/3) textures scaled with NEAREST.

import Phaser from 'phaser'
import { clamp, mulberry32 } from '@stellar/shared'
import type { PlanetBiome } from '@stellar/shared'
import type { ISpaceBackdrop } from '../contracts'
import { BACKDROP_MARGIN_X, BACKDROP_MARGIN_Y, COLORS, GAME_HEIGHT, GAME_WIDTH } from '../theme'
import {
  PixelBuffer,
  type Rgb,
  bayer2,
  ditherIndex,
  fbmCircles,
  lerpRgb,
  randomWalk,
  rgb,
  sampleNoise,
  shadeRgb,
  uniqueKey,
} from './helpers'

const PIX = 3 // 1/3 resolution, scaled up with NEAREST

interface BiomeStyle {
  ramp: number[]
  glow: number
  nebula: [number, number]
  detail: [number, number]
  rotSpeed: number // fake-rotation overlay speed, low-res px/s
}

const BIOMES: Record<PlanetBiome, BiomeStyle> = {
  gas_giant: {
    ramp: [0x221742, 0x3a2a66, 0x5c4490, 0x8a62a8, 0xc08a78, 0xeec08a],
    glow: 0xb583d6,
    nebula: [0x4a2d7a, 0x2d4a8a],
    detail: [0x3a2a66, 0xc08a78],
    rotSpeed: 2.2,
  },
  rocky: {
    ramp: [0x261f1c, 0x403630, 0x5c4f44, 0x78695a, 0x948270, 0xb3a18a],
    glow: 0x9a8a72,
    nebula: [0x4a3a5e, 0x2d4a6e],
    detail: [0x403630, 0x948270],
    rotSpeed: 0.8,
  },
  ice: {
    ramp: [0x1a3354, 0x2a527e, 0x4478a8, 0x6fa6cc, 0xa6d2e8, 0xeafaff],
    glow: 0x9fd4f0,
    nebula: [0x2d5a8a, 0x3a7a9a],
    detail: [0x2a527e, 0xa6d2e8],
    rotSpeed: 0.7,
  },
  volcanic: {
    ramp: [0x120e0d, 0x221814, 0x36251c, 0x4c3426, 0x644432],
    glow: 0xff7a4d,
    nebula: [0x6e2d3a, 0x4a2d5e],
    detail: [0x221814, 0x4c3426],
    rotSpeed: 1.0,
  },
  oceanic: {
    ramp: [0x0e2e52, 0x16477c, 0x2166a8, 0x3488c8],
    glow: 0x5ab0e8,
    nebula: [0x2d5a7a, 0x2d7a6e],
    detail: [0x16477c, 0xeef6fa],
    rotSpeed: 1.4,
  },
  desert: {
    ramp: [0x47301e, 0x664527, 0x8a5f33, 0xad7c42, 0xcf9c58, 0xeec27f],
    glow: 0xe8b46a,
    nebula: [0x6e4a2d, 0x4a2d5e],
    detail: [0x664527, 0xcf9c58],
    rotSpeed: 0.9,
  },
}

const OCEAN_LAND_RAMP = [0x2e6b3e, 0x4d8a4a, 0x79a85f]
const OCEAN_CLOUD = 0xeef6fa
const STAR_TINTS = [0xffffff, 0xcfe8ef, 0x9fb8d9, 0x8ad9e6, 0xb8a8e6, 0xd9e6ff]
// Light direction (upper-left), |L| ~ 1.
const LX = -0.5
const LY = -0.42
const LZ = 0.76
const LIGHT_STEPS = [0.28, 0.55, 0.78, 1] as const
const WHITE_KEY = 'vfx_white1'

function at(ramp: Rgb[], idx: number): Rgb {
  return ramp[clamp(idx, 0, ramp.length - 1)] ?? { r: 255, g: 255, b: 255 }
}

function ensureWhitePixel(scene: Phaser.Scene): void {
  if (scene.textures.exists(WHITE_KEY)) return
  const buf = new PixelBuffer(1, 1)
  buf.set(0, 0, { r: 255, g: 255, b: 255 }, 1)
  buf.toTexture(scene, WHITE_KEY)
}

interface StarLayerSpec {
  count: number
  brightness: number
  bigChance: number
  driftX: number // low-res px/s
}

const STAR_LAYERS: StarLayerSpec[] = [
  { count: 140, brightness: 0.5, bigChance: 0, driftX: 0.35 },
  { count: 80, brightness: 0.75, bigChance: 0.2, driftX: 0.65 },
  { count: 40, brightness: 1, bigChance: 0.45, driftX: 1.0 },
]

export class SpaceBackdrop implements ISpaceBackdrop {
  private readonly scene: Phaser.Scene
  private readonly keys: string[] = []
  private readonly layers: { sprite: Phaser.GameObjects.TileSprite; dx: number }[] = []
  private readonly twinkles: Phaser.GameObjects.Image[] = []
  private readonly nebulae: Phaser.GameObjects.Image[] = []
  private planetImg: Phaser.GameObjects.Image | null = null
  private detail: Phaser.GameObjects.TileSprite | null = null
  private maskGfx: Phaser.GameObjects.Graphics | null = null
  private readonly rotSpeed: number
  private readonly twinkleDrift: number
  /** Left edge and width of the covered world (stage + ultrawide margins). */
  private readonly covOX: number
  private readonly covW: number
  private destroyed = false

  constructor(
    scene: Phaser.Scene,
    seed: number,
    biome: PlanetBiome,
    opts?: { planetX?: number; planetY?: number; planetScale?: number },
  ) {
    this.scene = scene
    const rng = mulberry32(seed)
    const style = BIOMES[biome]
    // Cover the 1280×720 stage PLUS margins (in logical units, NOT the device
    // backing size) so stars/nebula fill the screen on any aspect ratio. The
    // camera centres the stage; this extra area is revealed around it on
    // ultrawide/tall screens. Origin sits in negative space so the stage stays
    // centred within the coverage.
    const OX = -BACKDROP_MARGIN_X
    const OY = -BACKDROP_MARGIN_Y
    const W = GAME_WIDTH + BACKDROP_MARGIN_X * 2
    const H = GAME_HEIGHT + BACKDROP_MARGIN_Y * 2
    this.covOX = OX
    this.covW = W
    const lw = Math.ceil(W / PIX)
    const lh = Math.ceil(H / PIX)

    // --- 3 star layers (baked, drifting via TileSprite) ---
    STAR_LAYERS.forEach((spec, li) => {
      const buf = new PixelBuffer(lw, lh)
      for (let i = 0; i < spec.count; i++) {
        const x = Math.floor(rng() * lw)
        const y = Math.floor(rng() * lh)
        const tint = rgb(STAR_TINTS[Math.floor(rng() * STAR_TINTS.length)] ?? 0xffffff)
        const a = spec.brightness * (0.45 + rng() * 0.55)
        buf.set(x, y, tint, a)
        if (rng() < spec.bigChance) {
          buf.set(x + 1, y, tint, a * 0.7)
          buf.set(x, y + 1, tint, a * 0.7)
          buf.set(x + 1, y + 1, tint, a * 0.45)
        }
      }
      const key = uniqueKey('bd_stars')
      buf.toTexture(scene, key)
      this.keys.push(key)
      const sprite = scene.add
        .tileSprite(OX, OY, lw, lh, key)
        .setOrigin(0)
        .setScale(PIX)
        .setDepth(-106 + li)
        .setScrollFactor(1)
      this.layers.push({ sprite, dx: spec.driftX })
    })
    this.twinkleDrift = STAR_LAYERS[2]?.driftX ?? 1

    // --- twinkling stars (individual, alpha tweens) ---
    ensureWhitePixel(scene)
    const twinkleCount = 10 + Math.floor(rng() * 5)
    for (let i = 0; i < twinkleCount; i++) {
      const img = scene.add
        .image(OX + rng() * W, OY + rng() * H, WHITE_KEY)
        .setScale(rng() < 0.3 ? PIX * 2 : PIX)
        .setTint(STAR_TINTS[Math.floor(rng() * STAR_TINTS.length)] ?? 0xffffff)
        .setDepth(-104) // with the front star layer, behind nebulae and planet
        .setScrollFactor(1)
        .setAlpha(0.3 + rng() * 0.5)
      scene.tweens.add({
        targets: img,
        alpha: 0.05 + rng() * 0.15,
        duration: 500 + rng() * 1100,
        delay: rng() * 1200,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
      this.twinkles.push(img)
    }

    // --- nebulae (quantized fractal blobs, ADD blend) ---
    const nebCount = 2 + (rng() < 0.5 ? 1 : 0)
    for (let i = 0; i < nebCount; i++) {
      const bw = 90 + Math.floor(rng() * 60)
      const bh = 70 + Math.floor(rng() * 50)
      const noise = fbmCircles(bw, bh, rng, 3, 7)
      const toneA = rgb(style.nebula[0])
      const toneB = rgb(style.nebula[1])
      const buf = new PixelBuffer(bw, bh)
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const fx = (x / bw) * 2 - 1
          const fy = (y / bh) * 2 - 1
          const falloff = clamp(1 - (fx * fx + fy * fy), 0, 1)
          const m = sampleNoise(noise, bw, bh, x, y) * falloff * 1.25
          const lvl = ditherIndex(clamp(m, 0, 0.999), 5, x, y)
          if (lvl <= 0) continue
          buf.set(x, y, lerpRgb(toneA, toneB, lvl / 4), 0.08 + lvl * 0.055)
        }
      }
      const key = uniqueKey('bd_nebula')
      buf.toTexture(scene, key)
      this.keys.push(key)
      const img = scene.add
        .image(OX + rng() * W, OY + rng() * H, key)
        .setScale(PIX)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(-103)
        .setScrollFactor(1)
      this.nebulae.push(img)
    }

    // --- planet ---
    const screenR = (180 + rng() * 80) * (opts?.planetScale ?? 1)
    const rLow = Math.max(28, Math.round(screenR / PIX))
    const px = opts?.planetX ?? GAME_WIDTH * 0.74
    const py = opts?.planetY ?? GAME_HEIGHT * 0.4
    const planetKey = uniqueKey('bd_planet')
    paintPlanet(scene, planetKey, biome, rng, rLow)
    this.keys.push(planetKey)
    this.planetImg = scene.add
      .image(px, py, planetKey)
      .setScale(PIX)
      .setDepth(-102)
      .setScrollFactor(1)

    // --- fake rotation: drifting sparse-detail overlay masked to the disc ---
    const detKey = uniqueKey('bd_detail')
    const detBuf = new PixelBuffer(96, 96)
    const dA = rgb(style.detail[0])
    const dB = rgb(style.detail[1])
    for (let i = 0; i < 120; i++) {
      const x = Math.floor(rng() * 96)
      const y = Math.floor(rng() * 96)
      detBuf.set(x, y, rng() < 0.5 ? dA : dB, 0.7 + rng() * 0.3)
      if (rng() < 0.3) detBuf.set((x + 1) % 96, y, dA, 0.5)
    }
    detBuf.toTexture(scene, detKey)
    this.keys.push(detKey)
    const dSide = Math.max(2, Math.floor(rLow * 2 * 0.97))
    this.detail = scene.add
      .tileSprite(px, py, dSide, dSide, detKey)
      .setScale(PIX)
      .setAlpha(0.16)
      .setDepth(-101)
      .setScrollFactor(1)
    this.maskGfx = scene.add.graphics().setVisible(false)
    this.maskGfx.fillStyle(0xffffff)
    this.maskGfx.fillCircle(px, py, rLow * PIX * 0.96)
    this.detail.setMask(this.maskGfx.createGeometryMask())
    this.rotSpeed = style.rotSpeed
  }

  update(dtMs: number): void {
    if (this.destroyed) return
    const dt = dtMs / 1000
    for (const layer of this.layers) {
      layer.sprite.tilePositionX += layer.dx * dt
      layer.sprite.tilePositionY += layer.dx * 0.18 * dt
    }
    if (this.detail) this.detail.tilePositionX += this.rotSpeed * dt
    const drift = this.twinkleDrift * PIX * dt
    for (const star of this.twinkles) {
      star.x -= drift
      if (star.x < this.covOX - 4) star.x += this.covW + 8
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    for (const star of this.twinkles) {
      this.scene.tweens.killTweensOf(star)
      star.destroy()
    }
    for (const layer of this.layers) layer.sprite.destroy()
    for (const img of this.nebulae) img.destroy()
    this.planetImg?.destroy()
    this.detail?.destroy()
    this.maskGfx?.destroy()
    for (const key of this.keys) {
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key)
    }
  }
}

// ---------------------------------------------------------------------------
// Planet painter: per-pixel quantized bands + Bayer dithering + terminator +
// atmosphere rings, with a distinct pattern per biome (GAME_SPEC §6.1).
// ---------------------------------------------------------------------------

function paintPlanet(
  scene: Phaser.Scene,
  key: string,
  biome: PlanetBiome,
  rng: () => number,
  r: number,
): void {
  const style = BIOMES[biome]
  const atmFrac = 0.16
  const atm = Math.ceil(r * atmFrac) + 2
  const size = (r + atm) * 2 + 2
  const c = r + atm + 1
  const buf = new PixelBuffer(size, size)
  const ramp = style.ramp.map(rgb)
  const glow = rgb(style.glow)
  const noise = fbmCircles(size, size, rng, 3, 8)

  // Per-biome precomputed features.
  const bandFreq = 4 + rng() * 3
  const bandPhase = rng() * Math.PI * 2
  const waveAmp = 0.25 + rng() * 0.3
  const stormLon = (rng() - 0.5) * 0.8
  const stormLat = (0.15 + rng() * 0.35) * (rng() < 0.5 ? -1 : 1)
  const stormRLon = 0.35 + rng() * 0.2
  const stormRLat = 0.16 + rng() * 0.08

  const craters: { lon: number; lat: number; cr: number }[] = []
  if (biome === 'rocky') {
    const n = 6 + Math.floor(rng() * 7)
    for (let i = 0; i < n; i++) {
      craters.push({
        lon: (rng() - 0.5) * 1.6,
        lat: (rng() - 0.5) * 1.5,
        cr: 0.07 + rng() * 0.13,
      })
    }
  }

  const capEdge = 0.6 + rng() * 0.1
  const lineMask = new Float32Array(size * size)
  if (biome === 'ice' || biome === 'volcanic') {
    const walks = (biome === 'ice' ? 9 : 11) + Math.floor(rng() * 6)
    for (let i = 0; i < walks; i++) {
      const sx = c + (rng() - 0.5) * 1.5 * r
      const sy = c + (rng() - 0.5) * 1.5 * r
      randomWalk(lineMask, size, size, rng, sx, sy, Math.floor(r * (1 + rng() * 0.8)), 1)
    }
  }
  let lineGlow: Float32Array | null = null
  if (biome === 'volcanic') {
    lineGlow = new Float32Array(size * size)
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x
        if ((lineMask[i] ?? 0) > 0) continue
        const near =
          (lineMask[i - 1] ?? 0) +
          (lineMask[i + 1] ?? 0) +
          (lineMask[i - size] ?? 0) +
          (lineMask[i + size] ?? 0)
        if (near > 0) lineGlow[i] = 1
      }
    }
  }

  let contNoise: Float32Array | null = null
  const cloudMask = new Float32Array(biome === 'oceanic' ? size * size : 0)
  if (biome === 'oceanic') {
    contNoise = fbmCircles(size, size, rng, 3, 6)
    const swirls = 3 + Math.floor(rng() * 3)
    for (let s = 0; s < swirls; s++) {
      const scx = c + (rng() - 0.5) * 1.2 * r
      const scy = c + (rng() - 0.5) * 1.2 * r
      const turns = (2 + rng() * 1.5) * Math.PI
      const r0 = r * 0.05
      const r1 = r * (0.18 + rng() * 0.14)
      for (let a = 0; a < turns; a += 0.16) {
        const sr = r0 + (r1 - r0) * (a / turns)
        const x = Math.round(scx + Math.cos(a) * sr * 1.4)
        const y = Math.round(scy + Math.sin(a) * sr)
        if (x >= 0 && y >= 0 && x < size && y < size) {
          cloudMask[y * size + x] = 1
          if (x + 1 < size) cloudMask[y * size + x + 1] = 1
        }
      }
    }
  }

  const landRamp = OCEAN_LAND_RAMP.map(rgb)
  const cloudCol = rgb(OCEAN_CLOUD)
  const veinA = rgb(COLORS.danger)
  const veinB = rgb(COLORS.warn)
  const desertFreq = 3 + rng() * 2
  const desertPhase = rng() * Math.PI * 2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c
      const dy = y - c
      const dist = Math.sqrt(dx * dx + dy * dy) / r
      if (dist > 1 + atmFrac) continue

      if (dist > 1) {
        // Atmosphere: 3 quantized glow rings, brighter on the lit side.
        const t = (dist - 1) / atmFrac
        const ring = Math.min(2, Math.floor(t * 3))
        const base = [0.36, 0.2, 0.09][ring] ?? 0.09
        const nx0 = dx / (dist * r)
        const ny0 = dy / (dist * r)
        const rim = clamp(LX * nx0 + LY * ny0, 0, 1)
        buf.set(x, y, glow, base * (0.55 + 0.45 * rim))
        continue
      }

      const nx = dx / r
      const ny = dy / r
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
      const light = clamp(nx * LX + ny * LY + nz * LZ, 0, 1)
      const lf = LIGHT_STEPS[ditherIndex(light, 4, x, y)] ?? 1
      const lon = Math.atan2(nx, nz)
      const lat = ny
      const n = sampleNoise(noise, size, size, x, y)
      const mi = y * size + x

      let col: Rgb | null = null
      let v = 0.5

      switch (biome) {
        case 'gas_giant': {
          v =
            0.5 +
            0.5 *
              Math.sin(
                lat * bandFreq * Math.PI + Math.sin(lon * 2.3 + bandPhase) * waveAmp + (n - 0.5) * 1.1,
              )
          const e =
            ((lon - stormLon) / stormRLon) ** 2 + ((lat - stormLat) / stormRLat) ** 2
          if (e < 1) v = clamp(1.08 - e * 0.75, 0, 1)
          break
        }
        case 'rocky': {
          v = 0.3 + n * 0.55
          for (const cr of craters) {
            const dlon = lon - cr.lon
            const dlat = lat - cr.lat
            const d = Math.sqrt(dlon * dlon + dlat * dlat) / cr.cr
            if (d < 0.8) {
              v *= 0.5
              break
            }
            if (d < 1.15) {
              v = dlon * LX + dlat * LY > 0 ? Math.min(1, v + 0.35) : v * 0.75
              break
            }
          }
          break
        }
        case 'ice': {
          v = 0.5 + n * 0.4
          if (Math.abs(ny) + (n - 0.5) * 0.25 > capEdge) v = 0.85 + n * 0.15
          if ((lineMask[mi] ?? 0) > 0.5) v = 0.1
          break
        }
        case 'volcanic': {
          if ((lineMask[mi] ?? 0) > 0.5) {
            col = shadeRgb(lerpRgb(veinA, veinB, n), Math.max(lf, 0.9))
            break
          }
          v = 0.12 + n * 0.45
          if (lineGlow && (lineGlow[mi] ?? 0) > 0) v = Math.min(1, v + 0.4)
          break
        }
        case 'oceanic': {
          if (cloudMask[mi] === 1 && bayer2(x, y) > -0.3) {
            col = shadeRgb(cloudCol, Math.max(lf, 0.45))
            break
          }
          const cv = contNoise ? sampleNoise(contNoise, size, size, x, y) : 0
          if (cv + bayer2(x, y) * 0.05 > 0.58) {
            const li = ditherIndex(clamp((cv - 0.58) * 2.4 + n * 0.4, 0, 1), 3, x, y)
            col = shadeRgb(at(landRamp, li), lf)
            break
          }
          v = 0.25 + n * 0.5
          break
        }
        case 'desert': {
          v = 0.5 + 0.26 * Math.sin(lat * desertFreq * Math.PI + desertPhase + (n - 0.5) * 1.4)
          const n2 = sampleNoise(noise, size, size, (x * 2) % size, (y * 2) % size)
          v += (n2 - 0.5) * 0.2
          break
        }
      }

      if (!col) {
        const idx = ditherIndex(clamp(v, 0, 1), ramp.length, x, y)
        col = shadeRgb(at(ramp, idx), lf)
      }
      buf.set(x, y, col, 1)
    }
  }

  buf.toTexture(scene, key)
}
