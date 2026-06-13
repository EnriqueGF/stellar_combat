// Procedural SFX synthesis. Each builder schedules its full sound at t0 into
// `out` and returns the total duration in seconds. Peak levels are balanced
// across the set (UI blips quiet, combat hits mid, explosion loudest).

import type { SfxName } from '../contracts'
import { detuneFactor, envelope, noiseBurst, pluck } from './helpers'

export function buildSfx(
  ctx: AudioContext,
  name: SfxName,
  out: GainNode,
  t0: number,
  detuneCents: number,
): number {
  const df = detuneFactor(detuneCents)
  switch (name) {
    case 'laser':
      return laser(ctx, out, t0, df)
    case 'gauss':
      return gauss(ctx, out, t0, df)
    case 'missile':
      return missile(ctx, out, t0, df)
    case 'bomb':
      return bomb(ctx, out, t0, df)
    case 'explosion':
      return explosion(ctx, out, t0, df)
    case 'shield_hit':
      return shieldHit(ctx, out, t0, df)
    case 'shield_down':
      return shieldDown(ctx, out, t0, df)
    case 'intercept':
      return intercept(ctx, out, t0, df)
    case 'miss':
      return miss(ctx, out, t0, df)
    case 'alarm':
      return alarm(ctx, out, t0, df)
    case 'click':
      return click(ctx, out, t0, df)
    case 'hover':
      return hover(ctx, out, t0, df)
    case 'heal':
      return heal(ctx, out, t0, df)
    case 'levelup':
      return levelup(ctx, out, t0, df)
    case 'jump':
      return jump(ctx, out, t0, df)
    case 'purchase':
      return purchase(ctx, out, t0, df)
    case 'error':
      return errorBuzz(ctx, out, t0, df)
    case 'victory':
      return victory(ctx, out, t0, df)
    case 'defeat':
      return defeat(ctx, out, t0, df)
    case 'door':
      return door(ctx, out, t0, df)
  }
}

function laser(ctx: AudioContext, out: AudioNode, t0: number, df: number): number {
  pluck(ctx, out, t0, {
    type: 'square',
    freq: 880 * df,
    freqEnd: 220 * df,
    glide: 0.12,
    attack: 0.004,
    peak: 0.28,
    decay: 0.13,
  })
  pluck(ctx, out, t0, {
    type: 'sine',
    freq: 880 * df,
    freqEnd: 220 * df,
    glide: 0.12,
    attack: 0.003,
    peak: 0.3,
    decay: 0.11,
  })
  // Attack click.
  noiseBurst(ctx, out, t0, { filterType: 'highpass', freq: 3000, attack: 0.001, peak: 0.18, decay: 0.018 })
  return 0.16
}

function gauss(ctx: AudioContext, out: AudioNode, t0: number, df: number): number {
  pluck(ctx, out, t0, {
    type: 'triangle',
    freq: 90 * df,
    freqEnd: 50 * df,
    glide: 0.2,
    attack: 0.004,
    peak: 0.85,
    decay: 0.22,
  })
  noiseBurst(ctx, out, t0, { filterType: 'lowpass', freq: 1200 * df, attack: 0.002, peak: 0.3, decay: 0.07 })
  return 0.27
}

function missile(ctx: AudioContext, out: AudioNode, t0: number, df: number): number {
  noiseBurst(ctx, out, t0, {
    filterType: 'bandpass',
    freq: 400 * df,
    freqEnd: 1200 * df,
    glide: 0.28,
    q: 2.5,
    attack: 0.06,
    peak: 0.5,
    decay: 0.24,
  })
  return 0.32
}

function bomb(ctx: AudioContext, out: AudioNode, t0: number, df: number): number {
  for (const mult of [1, 1.013, 0.988]) {
    pluck(ctx, out, t0, { type: 'sine', freq: 1700 * mult * df, attack: 0.04, peak: 0.1, decay: 0.3 })
  }
  // Pop.
  pluck(ctx, out, t0, {
    type: 'sine',
    freq: 260 * df,
    freqEnd: 70 * df,
    glide: 0.09,
    at: 0.02,
    attack: 0.003,
    peak: 0.65,
    decay: 0.11,
  })
  return 0.37
}

function explosion(ctx: AudioContext, out: AudioNode, t0: number, df: number): number {
  noiseBurst(ctx, out, t0, {
    filterType: 'lowpass',
    freq: 2000 * df,
    freqEnd: 200 * df,
    glide: 0.38,
    attack: 0.005,
    peak: 0.85,
    decay: 0.4,
  })
  // Sub boom.
  pluck(ctx, out, t0, {
    type: 'sine',
    freq: 55 * df,
    freqEnd: 42 * df,
    glide: 0.3,
    attack: 0.008,
    peak: 0.75,
    decay: 0.36,
  })
  return 0.43
}

function shieldHit(ctx: AudioContext, out: AudioNode, t0: number, df: number): number {
  // Two inharmonic partials give the metallic character.
  pluck(ctx, out, t0, { type: 'sine', freq: 1200 * df, attack: 0.002, peak: 0.3, decay: 0.16 })
  pluck(ctx, out, t0, { type: 'sine', freq: 1730 * df, attack: 0.002, peak: 0.24, decay: 0.12 })
  // Short ring-modulated tail.
  const carrier = ctx.createOscillator()
  carrier.type = 'sine'
  carrier.frequency.value = 1200 * df
  const ring = ctx.createGain()
  ring.gain.value = 0
  const lfo = ctx.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 90
  lfo.connect(ring.gain)
  const env = envelope(ctx, t0, 0.004, 0.12, 0.13)
  carrier.connect(ring)
  ring.connect(env)
  env.connect(out)
  carrier.start(t0)
  carrier.stop(t0 + 0.18)
  lfo.start(t0)
  lfo.stop(t0 + 0.18)
  return 0.2
}

function shieldDown(ctx: AudioContext, out: AudioNode, t0: number, df: number): number {
  pluck(ctx, out, t0, {
    type: 'sine',
    freq: 600 * df,
    freqEnd: 200 * df,
    glide: 0.38,
    attack: 0.01,
    peak: 0.4,
    decay: 0.4,
  })
  pluck(ctx, out, t0, {
    type: 'triangle',
    freq: 300 * df,
    freqEnd: 100 * df,
    glide: 0.38,
    attack: 0.01,
    peak: 0.16,
    decay: 0.4,
  })
  return 0.44
}

function intercept(ctx: AudioContext, out: AudioNode, t0: number, df: number): number {
  pluck(ctx, out, t0, {
    type: 'sawtooth',
    freq: 2600 * df,
    freqEnd: 1200 * df,
    glide: 0.06,
    attack: 0.002,
    peak: 0.2,
    decay: 0.07,
  })
  pluck(ctx, out, t0, {
    type: 'square',
    freq: 3400 * df,
    freqEnd: 1700 * df,
    glide: 0.05,
    attack: 0.001,
    peak: 0.09,
    decay: 0.05,
  })
  return 0.1
}

function miss(ctx: AudioContext, out: AudioNode, t0: number, df: number): number {
  noiseBurst(ctx, out, t0, {
    filterType: 'bandpass',
    freq: 900 * df,
    freqEnd: 400 * df,
    glide: 0.16,
    q: 1.2,
    attack: 0.04,
    peak: 0.16,
    decay: 0.14,
  })
  return 0.2
}

function alarm(ctx: AudioContext, out: AudioNode, t0: number, df: number): number {
  const osc = ctx.createOscillator()
  osc.type = 'square'
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 1600 * df
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t0)
  const seg = 0.14
  for (let i = 0; i < 4; i++) {
    const ts = t0 + i * seg
    osc.frequency.setValueAtTime((i % 2 === 0 ? 800 : 600) * df, ts)
    g.gain.setValueAtTime(0, ts)
    g.gain.linearRampToValueAtTime(0.2, ts + 0.015)
    g.gain.setValueAtTime(0.2, ts + seg - 0.03)
    g.gain.linearRampToValueAtTime(0, ts + seg - 0.005)
  }
  osc.connect(lp)
  lp.connect(g)
  g.connect(out)
  osc.start(t0)
  osc.stop(t0 + 4 * seg + 0.02)
  return 4 * seg + 0.03
}

function click(ctx: AudioContext, out: AudioNode, t0: number, df: number): number {
  pluck(ctx, out, t0, { type: 'sine', freq: 1000 * df, attack: 0.002, peak: 0.22, decay: 0.028 })
  return 0.05
}

function hover(ctx: AudioContext, out: AudioNode, t0: number, df: number): number {
  pluck(ctx, out, t0, { type: 'sine', freq: 1400 * df, attack: 0.001, peak: 0.1, decay: 0.015 })
  return 0.05
}

function heal(ctx: AudioContext, out: AudioNode, t0: number, df: number): number {
  const notes = [523.25, 659.26, 783.99]
  notes.forEach((f, i) => {
    pluck(ctx, out, t0, { type: 'sine', freq: f * df, at: i * 0.11, attack: 0.02, peak: 0.2, decay: 0.26 })
  })
  return 0.52
}

function levelup(ctx: AudioContext, out: AudioNode, t0: number, df: number): number {
  const notes = [523.25, 659.26, 783.99, 1046.5]
  notes.forEach((f, i) => {
    const at = i * 0.09
    pluck(ctx, out, t0, {
      type: 'triangle',
      freq: f * df,
      at,
      attack: 0.005,
      peak: 0.24,
      decay: i === notes.length - 1 ? 0.28 : 0.12,
    })
    // Sparkle an octave up.
    pluck(ctx, out, t0, { type: 'sine', freq: f * 2 * df, at, attack: 0.005, peak: 0.07, decay: 0.1 })
  })
  return 0.58
}

function jump(ctx: AudioContext, out: AudioNode, t0: number, df: number): number {
  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(200 * df, t0)
  osc.frequency.exponentialRampToValueAtTime(1600 * df, t0 + 0.55)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(500 * df, t0)
  lp.frequency.exponentialRampToValueAtTime(3500 * df, t0 + 0.55)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(0.28, t0 + 0.45)
  g.gain.linearRampToValueAtTime(0, t0 + 0.6)
  osc.connect(lp)
  lp.connect(g)
  g.connect(out)
  osc.start(t0)
  osc.stop(t0 + 0.62)
  // Late shimmer.
  for (const mult of [1, 1.011, 0.992]) {
    pluck(ctx, out, t0, { type: 'sine', freq: 2200 * mult * df, at: 0.3, attack: 0.12, peak: 0.05, decay: 0.16 })
  }
  return 0.62
}

function purchase(ctx: AudioContext, out: AudioNode, t0: number, df: number): number {
  pluck(ctx, out, t0, { type: 'square', freq: 900 * df, attack: 0.002, peak: 0.14, decay: 0.04 })
  pluck(ctx, out, t0, { type: 'square', freq: 1125 * df, at: 0.07, attack: 0.002, peak: 0.14, decay: 0.04 })
  pluck(ctx, out, t0, { type: 'sine', freq: 1760 * df, at: 0.14, attack: 0.004, peak: 0.26, decay: 0.2 })
  pluck(ctx, out, t0, { type: 'sine', freq: 2637 * df, at: 0.14, attack: 0.004, peak: 0.09, decay: 0.15 })
  return 0.38
}

function errorBuzz(ctx: AudioContext, out: AudioNode, t0: number, df: number): number {
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 600
  const env = envelope(ctx, t0, 0.005, 0.32, 0.12)
  lp.connect(env)
  env.connect(out)
  // Two close low squares beat against each other.
  for (const f of [110, 92]) {
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = f * df
    osc.connect(lp)
    osc.start(t0)
    osc.stop(t0 + 0.16)
  }
  return 0.16
}

function victory(ctx: AudioContext, out: AudioNode, t0: number, df: number): number {
  const notes = [523.25, 659.26, 783.99, 1046.5]
  notes.forEach((f, i) => {
    const at = i * 0.09
    pluck(ctx, out, t0, { type: 'triangle', freq: f * df, at, attack: 0.02, peak: 0.16, decay: 0.56 - at })
    pluck(ctx, out, t0, { type: 'sine', freq: f * 2 * df, at, attack: 0.02, peak: 0.05, decay: 0.4 - at * 0.5 })
  })
  return 0.62
}

function door(ctx: AudioContext, out: AudioNode, t0: number, df: number): number {
  // Soft pneumatic servo: a short band-passed air hiss plus a low mechanical
  // thunk. Quiet (it fires often). Detune (open higher / close lower) varies it.
  noiseBurst(ctx, out, t0, {
    filterType: 'bandpass',
    freq: 760 * df,
    freqEnd: 340 * df,
    glide: 0.1,
    q: 1.5,
    attack: 0.006,
    peak: 0.13,
    decay: 0.1,
  })
  pluck(ctx, out, t0, {
    type: 'triangle',
    freq: 190 * df,
    freqEnd: 120 * df,
    glide: 0.07,
    at: 0.02,
    attack: 0.004,
    peak: 0.12,
    decay: 0.08,
  })
  return 0.14
}

function defeat(ctx: AudioContext, out: AudioNode, t0: number, df: number): number {
  const notes = [440, 329.63, 261.63, 220]
  notes.forEach((f, i) => {
    const at = i * 0.12
    pluck(ctx, out, t0, { type: 'sine', freq: f * df, at, attack: 0.03, peak: 0.2, decay: 0.58 - at })
    pluck(ctx, out, t0, { type: 'triangle', freq: (f / 2) * df, at, attack: 0.03, peak: 0.07, decay: 0.58 - at })
  })
  return 0.64
}
