// Low-level WebAudio building blocks shared by sfx.ts and music.ts.

let cachedNoise: AudioBuffer | null = null
let cachedNoiseCtx: BaseAudioContext | null = null

/** 1.5 s of white noise, cached per context (regenerated if the context changes). */
export function getNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  if (cachedNoise === null || cachedNoiseCtx !== ctx) {
    const length = Math.floor(ctx.sampleRate * 1.5)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    cachedNoise = buffer
    cachedNoiseCtx = ctx
  }
  return cachedNoise
}

export function detuneFactor(cents: number): number {
  return 2 ** (cents / 1200)
}

export function noteHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

/** Gain with linear attack to `peak`, then exponential decay to silence. */
export function envelope(
  ctx: BaseAudioContext,
  t0: number,
  attack: number,
  peak: number,
  decay: number,
): GainNode {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(peak, t0 + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay)
  g.gain.linearRampToValueAtTime(0, t0 + attack + decay + 0.01)
  return g
}

export interface PluckOpts {
  type: OscillatorType
  freq: number
  freqEnd?: number
  /** Seconds for the pitch glide; defaults to attack+decay. */
  glide?: number
  attack: number
  peak: number
  decay: number
  /** Start offset from t0, seconds. */
  at?: number
}

/** One-shot oscillator with optional pitch glide and a percussive envelope. */
export function pluck(ctx: BaseAudioContext, out: AudioNode, t0: number, o: PluckOpts): void {
  const start = t0 + (o.at ?? 0)
  const decay = Math.max(o.decay, 0.015)
  const osc = ctx.createOscillator()
  osc.type = o.type
  osc.frequency.setValueAtTime(Math.max(o.freq, 1), start)
  if (o.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(o.freqEnd, 1),
      start + (o.glide ?? o.attack + decay),
    )
  }
  const env = envelope(ctx, start, o.attack, o.peak, decay)
  osc.connect(env)
  env.connect(out)
  osc.start(start)
  osc.stop(start + o.attack + decay + 0.05)
}

export interface NoiseBurstOpts {
  filterType?: BiquadFilterType
  freq?: number
  freqEnd?: number
  /** Seconds for the filter sweep; defaults to attack+decay. */
  glide?: number
  q?: number
  attack: number
  peak: number
  decay: number
  /** Start offset from t0, seconds. */
  at?: number
}

/** One-shot filtered white-noise burst with a percussive envelope. */
export function noiseBurst(
  ctx: BaseAudioContext,
  out: AudioNode,
  t0: number,
  o: NoiseBurstOpts,
): void {
  const start = t0 + (o.at ?? 0)
  const decay = Math.max(o.decay, 0.015)
  const src = ctx.createBufferSource()
  src.buffer = getNoiseBuffer(ctx)
  src.loop = true
  let head: AudioNode = src
  if (o.filterType !== undefined) {
    const filter = ctx.createBiquadFilter()
    filter.type = o.filterType
    filter.frequency.setValueAtTime(Math.max(o.freq ?? 1000, 1), start)
    if (o.freqEnd !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(o.freqEnd, 1),
        start + (o.glide ?? o.attack + decay),
      )
    }
    if (o.q !== undefined) filter.Q.value = o.q
    head.connect(filter)
    head = filter
  }
  const env = envelope(ctx, start, o.attack, o.peak, decay)
  head.connect(env)
  env.connect(out)
  // Random read offset so repeated bursts do not sound identical.
  src.start(start, Math.random() * 0.5)
  src.stop(start + o.attack + decay + 0.05)
}
