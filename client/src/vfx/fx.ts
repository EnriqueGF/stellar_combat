// Fire-and-forget combat VFX (GAME_SPEC §6.4). All particle textures are
// generated procedurally (white, tinted at use). Images/Texts are pooled per
// scene; nothing allocates per frame in steady state.

import Phaser from 'phaser'
import { clamp, mulberry32 } from '@stellar/shared'
import type { FxApi, ProjectileVisualKind } from '../contracts'
import { COLORS, FONTS, TEXT_RESOLUTION } from '../theme'
import { PixelBuffer, cssColor } from './helpers'

const FX_DEPTH = 600
const TEXT_DEPTH = 800
const EDGE_DEPTH = 9000

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter

interface FxCtx {
  scene: Phaser.Scene
  freeImages: Phaser.GameObjects.Image[]
  freeTexts: Phaser.GameObjects.Text[]
  dot: Emitter
  spark: Emitter
  smoke: Emitter
  edge: Phaser.GameObjects.Container
  edgeTween: Phaser.Tweens.Tween | null
}

const ctxMap = new Map<Phaser.Scene, FxCtx>()

// ---------------------------------------------------------------------------
// Procedural particle textures (game-lifetime, generated once)
// ---------------------------------------------------------------------------

function ensureTextures(scene: Phaser.Scene): void {
  const tm = scene.textures
  if (tm.exists('fx_dot')) return
  const white = { r: 255, g: 255, b: 255 }

  const dot = new PixelBuffer(8, 8)
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const d = Math.sqrt((x - 3.5) ** 2 + (y - 3.5) ** 2) / 4
      if (d < 1) dot.set(x, y, white, (1 - d) ** 2)
    }
  }
  dot.toTexture(scene, 'fx_dot')

  const spark = new PixelBuffer(6, 6)
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 6; x++) {
      const d = Math.sqrt((x - 2.5) ** 2 + (y - 2.5) ** 2) / 3
      if (d < 1) spark.set(x, y, white, (1 - d) ** 1.2)
    }
  }
  spark.toTexture(scene, 'fx_spark')

  const rng = mulberry32(0xf00d)
  const smoke = new PixelBuffer(24, 24)
  for (let b = 0; b < 6; b++) {
    const cx = 8 + rng() * 8
    const cy = 8 + rng() * 8
    const cr = 5 + rng() * 5
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / cr
        if (d < 1) {
          const i = (y * 24 + x) * 4
          const add = (1 - d) ** 2 * 90
          smoke.data[i] = 255
          smoke.data[i + 1] = 255
          smoke.data[i + 2] = 255
          smoke.data[i + 3] = Math.min(200, (smoke.data[i + 3] ?? 0) + add)
        }
      }
    }
  }
  smoke.toTexture(scene, 'fx_smoke')

  const tracer = new PixelBuffer(32, 8)
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 32; x++) {
      const tx = x / 31
      const vy = Math.max(0, 1 - Math.abs(y - 3.5) / 3.2)
      let a = tx ** 1.6 * vy * vy
      if (tx > 0.85) a = Math.min(1, a + (tx - 0.85) * 3 * vy)
      if (a > 0.02) tracer.set(x, y, white, a)
    }
  }
  tracer.toTexture(scene, 'fx_tracer')

  const shell = new PixelBuffer(10, 4)
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 10; x++) {
      const dx = Math.max(0, Math.abs(x - 4.5) - 2.5) / 2.5
      const dy = Math.abs(y - 1.5) / 2
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < 1) shell.set(x, y, white, 1 - d * 0.7)
    }
  }
  shell.toTexture(scene, 'fx_shell')

  const missile = new PixelBuffer(14, 6)
  for (let y = 1; y <= 4; y++) {
    for (let x = 1; x <= 10; x++) missile.set(x, y, white, y === 1 ? 1 : 0.85)
  }
  missile.set(11, 2, white, 1)
  missile.set(11, 3, white, 1)
  missile.set(12, 2, white, 0.9)
  missile.set(12, 3, white, 0.9)
  missile.set(13, 2, white, 0.6)
  missile.set(0, 2, white, 0.5)
  missile.set(0, 3, white, 0.5)
  missile.toTexture(scene, 'fx_missile')

  const ring = new PixelBuffer(40, 40)
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 40; x++) {
      const d = Math.sqrt((x - 19.5) ** 2 + (y - 19.5) ** 2)
      const e = Math.abs(d - 17.5)
      if (e < 2) ring.set(x, y, white, 1 - e / 2)
    }
  }
  ring.toTexture(scene, 'fx_ring')

  const flash = new PixelBuffer(48, 48)
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const d = Math.sqrt((x - 23.5) ** 2 + (y - 23.5) ** 2) / 24
      if (d < 1) flash.set(x, y, white, (1 - d) ** 2.5)
    }
  }
  flash.toTexture(scene, 'fx_flash')
}

// ---------------------------------------------------------------------------
// Per-scene context with shared emitters and pools
// ---------------------------------------------------------------------------

function ctx(scene: Phaser.Scene): FxCtx {
  const existing = ctxMap.get(scene)
  if (existing) return existing
  ensureTextures(scene)

  const dot = scene.add.particles(0, 0, 'fx_dot', {
    lifespan: 320,
    alpha: { start: 0.7, end: 0 },
    scale: { start: 0.85, end: 0.15 },
    speed: { min: 0, max: 14 },
    blendMode: Phaser.BlendModes.ADD,
    emitting: false,
  })
  dot.setDepth(FX_DEPTH - 1)

  const spark = scene.add.particles(0, 0, 'fx_spark', {
    lifespan: { min: 240, max: 560 },
    speed: { min: 60, max: 240 },
    alpha: { start: 1, end: 0 },
    scale: { start: 1.1, end: 0 },
    blendMode: Phaser.BlendModes.ADD,
    emitting: false,
  })
  spark.setDepth(FX_DEPTH + 1)

  const smoke = scene.add.particles(0, 0, 'fx_smoke', {
    lifespan: { min: 420, max: 900 },
    speed: { min: 4, max: 26 },
    alpha: { start: 0.26, end: 0 },
    scale: { start: 0.7, end: 1.7 },
    emitting: false,
  })
  smoke.setDepth(FX_DEPTH - 2)

  const W = scene.scale.width
  const H = scene.scale.height
  const t = 22
  const edge = scene.add.container(0, 0, [
    scene.add.rectangle(0, 0, t, H, COLORS.danger).setOrigin(0),
    scene.add.rectangle(W - t, 0, t, H, COLORS.danger).setOrigin(0),
    scene.add.rectangle(t, 0, W - 2 * t, t, COLORS.danger).setOrigin(0),
    scene.add.rectangle(t, H - t, W - 2 * t, t, COLORS.danger).setOrigin(0),
  ])
  edge.setDepth(EDGE_DEPTH).setScrollFactor(0).setAlpha(0)

  const c: FxCtx = {
    scene,
    freeImages: [],
    freeTexts: [],
    dot,
    spark,
    smoke,
    edge,
    edgeTween: null,
  }
  ctxMap.set(scene, c)
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => ctxMap.delete(scene))
  scene.events.once(Phaser.Scenes.Events.DESTROY, () => ctxMap.delete(scene))
  return c
}

function getImage(c: FxCtx, key: string): Phaser.GameObjects.Image {
  let img = c.freeImages.pop()
  if (img) img.setTexture(key)
  else img = c.scene.add.image(0, 0, key)
  img
    .setActive(true)
    .setVisible(true)
    .setAlpha(1)
    .setScale(1)
    .setRotation(0)
    .setOrigin(0.5)
    .setBlendMode(Phaser.BlendModes.NORMAL)
    .setDepth(FX_DEPTH)
  img.clearTint()
  return img
}

function release(c: FxCtx, img: Phaser.GameObjects.Image): void {
  c.scene.tweens.killTweensOf(img)
  img.setVisible(false).setActive(false)
  c.freeImages.push(img)
}

function getText(c: FxCtx): Phaser.GameObjects.Text {
  let txt = c.freeTexts.pop()
  if (!txt) {
    txt = c.scene.add.text(0, 0, '', {
      fontFamily: FONTS.body,
      fontSize: '17px',
      fontStyle: 'bold',
      color: '#ffffff',
      stroke: '#0a0e1a',
      strokeThickness: 4,
      resolution: TEXT_RESOLUTION,
    })
    txt.setOrigin(0.5).setDepth(TEXT_DEPTH)
  }
  txt.setActive(true).setVisible(true).setAlpha(1)
  return txt
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// ---------------------------------------------------------------------------
// Projectile visuals — tween duration === travelMs so arrival syncs with the
// server impact event (the caller fires impact VFX exactly then).
// ---------------------------------------------------------------------------

function flyStraight(
  c: FxCtx,
  imgs: Phaser.GameObjects.Image[],
  from: { x: number; y: number },
  to: { x: number; y: number },
  travelMs: number,
  trailEveryMs: number,
  trailTint: number,
  trail: Emitter | null,
): void {
  let lastEmit = 0
  c.scene.tweens.addCounter({
    from: 0,
    to: 1,
    duration: travelMs,
    onUpdate: (tw) => {
      const k = tw.getValue() ?? 0
      const x = lerp(from.x, to.x, k)
      const y = lerp(from.y, to.y, k)
      for (const img of imgs) img.setPosition(x, y)
      const now = c.scene.time.now
      if (trail && now - lastEmit >= trailEveryMs) {
        lastEmit = now
        trail.particleTint = trailTint
        trail.emitParticleAt(x, y, 1)
      }
    },
    onComplete: () => {
      for (const img of imgs) release(c, img)
    },
  })
}

function projectile(
  scene: Phaser.Scene,
  kind: ProjectileVisualKind,
  from: { x: number; y: number },
  to: { x: number; y: number },
  travelMs: number,
  color: number,
): void {
  const c = ctx(scene)
  const angle = Math.atan2(to.y - from.y, to.x - from.x)

  switch (kind) {
    case 'laser': {
      const glow = getImage(c, 'fx_tracer')
      glow
        .setTint(color)
        .setAlpha(0.32)
        .setScale(1.7, 2.6)
        .setRotation(angle)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setPosition(from.x, from.y)
      const tracer = getImage(c, 'fx_tracer')
      tracer
        .setTint(color)
        .setScale(1.2, 1)
        .setRotation(angle)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setPosition(from.x, from.y)
      flyStraight(c, [glow, tracer], from, to, travelMs, 28, color, c.dot)
      break
    }
    case 'kinetic': {
      const shell = getImage(c, 'fx_shell')
      shell
        .setTint(color)
        .setScale(1.3)
        .setRotation(angle)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setPosition(from.x, from.y)
      flyStraight(c, [shell], from, to, travelMs, 52, color, c.dot)
      break
    }
    case 'drone_shot': {
      const tracer = getImage(c, 'fx_tracer')
      tracer
        .setTint(color)
        .setAlpha(0.9)
        .setScale(0.75, 0.5)
        .setRotation(angle)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setPosition(from.x, from.y)
      flyStraight(c, [tracer], from, to, travelMs, 60, color, c.dot)
      break
    }
    case 'missile': {
      // Curved flight: quadratic bezier with a sideways control point.
      const mx = (from.x + to.x) / 2
      const my = (from.y + to.y) / 2
      const dx = to.x - from.x
      const dy = to.y - from.y
      const len = Math.max(1, Math.sqrt(dx * dx + dy * dy))
      const side = Math.random() < 0.5 ? -1 : 1
      const off = side * (len * 0.18 + 30)
      const cpx = mx + (-dy / len) * off
      const cpy = my + (dx / len) * off
      const body = getImage(c, 'fx_missile')
      body.setTint(color).setScale(1.4).setPosition(from.x, from.y)
      let lastSmoke = 0
      c.scene.tweens.addCounter({
        from: 0,
        to: 1,
        duration: travelMs,
        onUpdate: (tw) => {
          const t = tw.getValue() ?? 0
          const u = 1 - t
          const x = u * u * from.x + 2 * u * t * cpx + t * t * to.x
          const y = u * u * from.y + 2 * u * t * cpy + t * t * to.y
          const tanX = 2 * u * (cpx - from.x) + 2 * t * (to.x - cpx)
          const tanY = 2 * u * (cpy - from.y) + 2 * t * (to.y - cpy)
          body.setPosition(x, y).setRotation(Math.atan2(tanY, tanX))
          const now = c.scene.time.now
          if (now - lastSmoke >= 34) {
            lastSmoke = now
            c.smoke.particleTint = 0xb8bdc4
            c.smoke.emitParticleAt(x, y, 1)
            c.dot.particleTint = color
            c.dot.emitParticleAt(x, y, 1)
          }
        },
        onComplete: () => release(c, body),
      })
      break
    }
    case 'bomb': {
      // Fades out mid-flight and re-materializes at the destination (teleport).
      const orb = getImage(c, 'fx_dot')
      orb
        .setTint(color)
        .setScale(2.2)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setPosition(from.x, from.y)
      scene.tweens.add({
        targets: orb,
        scale: 2.7,
        duration: 150,
        yoyo: true,
        repeat: -1,
      })
      const midX = lerp(from.x, to.x, 0.45)
      const midY = lerp(from.y, to.y, 0.45)
      scene.tweens.add({
        targets: orb,
        x: midX,
        y: midY,
        alpha: 0,
        duration: travelMs * 0.45,
        ease: 'Quad.easeIn',
      })
      scene.time.delayedCall(travelMs * 0.8, () => {
        if (!orb.active) return
        orb.setPosition(to.x, to.y)
        scene.tweens.add({ targets: orb, alpha: 1, duration: Math.min(120, travelMs * 0.15) })
        const ring = getImage(c, 'fx_ring')
        ring
          .setTint(color)
          .setScale(0.3)
          .setAlpha(0.9)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setPosition(to.x, to.y)
        scene.tweens.add({
          targets: ring,
          scale: 1.2,
          alpha: 0,
          duration: 250,
          onComplete: () => release(c, ring),
        })
      })
      scene.time.delayedCall(travelMs, () => {
        if (!orb.active) return
        scene.tweens.killTweensOf(orb)
        scene.tweens.add({
          targets: orb,
          alpha: 0,
          scale: 1,
          duration: 110,
          onComplete: () => release(c, orb),
        })
      })
      break
    }
  }
}

// ---------------------------------------------------------------------------

export const fx: FxApi = {
  projectile,

  beam(scene, from, toA, toB, color, durationMs) {
    const c = ctx(scene)
    const g = scene.add.graphics().setDepth(FX_DEPTH).setBlendMode(Phaser.BlendModes.ADD)
    let lastSpark = 0
    scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: durationMs,
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0
        const ex = lerp(toA.x, toB.x, t)
        const ey = lerp(toA.y, toB.y, t)
        g.clear()
        g.lineStyle(9, color, 0.22)
        g.lineBetween(from.x, from.y, ex, ey)
        g.lineStyle(4, color, 0.55)
        g.lineBetween(from.x, from.y, ex, ey)
        g.lineStyle(1.5, 0xffffff, 0.9)
        g.lineBetween(from.x, from.y, ex, ey)
        const now = scene.time.now
        if (now - lastSpark >= 36) {
          lastSpark = now
          c.spark.particleTint = color
          c.spark.emitParticleAt(ex, ey, 1)
        }
      },
      onComplete: () => {
        scene.tweens.add({
          targets: g,
          alpha: 0,
          duration: 140,
          onComplete: () => g.destroy(),
        })
      },
    })
  },

  explosion(scene, x, y, size) {
    const c = ctx(scene)
    const big = size === 'big'
    const flash = getImage(c, 'fx_flash')
    flash
      .setTint(0xffd9a0)
      .setScale(big ? 1.2 : 0.7)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setPosition(x, y)
    scene.tweens.add({
      targets: flash,
      scale: big ? 3 : 1.6,
      alpha: 0,
      duration: big ? 220 : 160,
      ease: 'Quad.easeOut',
      onComplete: () => release(c, flash),
    })
    const ring = getImage(c, 'fx_ring')
    ring
      .setTint(COLORS.warn)
      .setScale(0.4)
      .setAlpha(0.8)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setPosition(x, y)
    scene.tweens.add({
      targets: ring,
      scale: big ? 2.6 : 1.4,
      alpha: 0,
      duration: big ? 380 : 280,
      ease: 'Quad.easeOut',
      onComplete: () => release(c, ring),
    })
    c.spark.particleTint = 0xffc07a
    c.spark.emitParticleAt(x, y, big ? 24 : 12)
    c.smoke.particleTint = 0x55606b
    c.smoke.emitParticleAt(x, y, big ? 6 : 3)
  },

  missDeflect(scene, x, y) {
    // Dodge visual only: a tracer streaks past the target and fades away.
    const c = ctx(scene)
    const ang = Math.random() * Math.PI * 2
    const perp = ang + Math.PI / 2
    const offX = Math.cos(perp) * 18
    const offY = Math.sin(perp) * 18
    const streak = getImage(c, 'fx_tracer')
    streak
      .setTint(0xcfe8ef)
      .setAlpha(0.85)
      .setScale(1.1, 0.7)
      .setRotation(ang)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setPosition(x - Math.cos(ang) * 55 + offX, y - Math.sin(ang) * 55 + offY)
    scene.tweens.add({
      targets: streak,
      x: x + Math.cos(ang) * 95 + offX,
      y: y + Math.sin(ang) * 95 + offY,
      alpha: 0,
      duration: 260,
      ease: 'Quad.easeOut',
      onComplete: () => release(c, streak),
    })
    const puff = getImage(c, 'fx_dot')
    puff
      .setTint(0xcfe8ef)
      .setAlpha(0.4)
      .setScale(1.6)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setPosition(x + offX, y + offY)
    scene.tweens.add({
      targets: puff,
      alpha: 0,
      scale: 2.4,
      duration: 200,
      onComplete: () => release(c, puff),
    })
  },

  intercept(scene, x, y) {
    // Small bluish burst (point defense / defense drone shootdown).
    const c = ctx(scene)
    const flash = getImage(c, 'fx_flash')
    flash
      .setTint(COLORS.shield)
      .setScale(0.7)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setPosition(x, y)
    scene.tweens.add({
      targets: flash,
      scale: 1.3,
      alpha: 0,
      duration: 150,
      onComplete: () => release(c, flash),
    })
    const ring = getImage(c, 'fx_ring')
    ring
      .setTint(0x9fd4f0)
      .setScale(0.2)
      .setAlpha(0.85)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setPosition(x, y)
    scene.tweens.add({
      targets: ring,
      scale: 0.8,
      alpha: 0,
      duration: 240,
      onComplete: () => release(c, ring),
    })
    c.spark.particleTint = 0x9fd4f0
    c.spark.emitParticleAt(x, y, 8)
  },

  damageNumber(scene, x, y, amount, color) {
    const c = ctx(scene)
    const txt = getText(c)
    txt
      .setText(String(Math.round(amount)))
      .setColor(cssColor(color))
      .setPosition(x + (Math.random() * 16 - 8), y)
    scene.tweens.add({
      targets: txt,
      y: y - 36,
      alpha: 0,
      duration: 800,
      ease: 'Quad.easeOut',
      onComplete: () => {
        txt.setVisible(false).setActive(false)
        c.freeTexts.push(txt)
      },
    })
  },

  screenShake(scene, intensity) {
    const c = ctx(scene)
    const i = clamp(intensity, 0.2, 3)
    scene.cameras.main.shake(110 + 70 * i, 0.0018 + 0.0028 * i)
    if (c.edgeTween) c.edgeTween.stop()
    c.edge.setAlpha(Math.min(0.12, 0.05 + 0.03 * i))
    c.edgeTween = scene.tweens.add({
      targets: c.edge,
      alpha: 0,
      duration: 280,
      onComplete: () => {
        c.edgeTween = null
      },
    })
  },
}
