// WebAudio engine: lazy AudioContext with first-gesture unlock, a
// master/music/sfx bus graph through a gentle compressor, voice-limited
// procedural SFX and a generative music director. Pure TS + DOM (no Phaser);
// becomes a silent no-op where WebAudio is unavailable.

import { clamp } from '@stellar/shared'
import type { GameSettings, IAudioEngine, SfxName } from '../contracts'
import { MusicDirector } from './music'
import { buildSfx } from './sfx'

const MAX_VOICES = 12
const VOLUME_SMOOTHING_S = 0.08

/** Perceptual loudness curve (smooth quadratic approximation). */
function volumeCurve(v: number): number {
  const c = clamp(v, 0, 1)
  return c * c
}

interface Voice {
  name: SfxName
  startedAt: number
  endAt: number
  gain: GainNode
  cleanup: ReturnType<typeof setTimeout>
}

class AudioEngine implements IAudioEngine {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private musicGain: GainNode | null = null
  private sfxGain: GainNode | null = null
  private director: MusicDirector | null = null
  private readonly voices: Voice[] = []

  constructor() {
    try {
      const w = window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }
      const Ctor: typeof AudioContext | undefined = w.AudioContext ?? w.webkitAudioContext
      if (Ctor === undefined) return
      const ctx = new Ctor()

      const compressor = ctx.createDynamicsCompressor()
      compressor.threshold.value = -18
      compressor.knee.value = 24
      compressor.ratio.value = 3
      compressor.attack.value = 0.01
      compressor.release.value = 0.25
      compressor.connect(ctx.destination)

      const master = ctx.createGain()
      master.gain.value = volumeCurve(0.8)
      master.connect(compressor)
      const music = ctx.createGain()
      music.gain.value = volumeCurve(0.7)
      music.connect(master)
      const sfx = ctx.createGain()
      sfx.gain.value = volumeCurve(0.8)
      sfx.connect(master)

      this.ctx = ctx
      this.masterGain = master
      this.musicGain = music
      this.sfxGain = sfx
      this.director = new MusicDirector(ctx, music)
      if (ctx.state === 'suspended') this.installUnlock(ctx)
    } catch {
      this.ctx = null
    }
  }

  private installUnlock(ctx: AudioContext): void {
    const onGesture = (): void => {
      window.removeEventListener('pointerdown', onGesture)
      window.removeEventListener('keydown', onGesture)
      void ctx.resume().catch(() => undefined)
    }
    window.addEventListener('pointerdown', onGesture)
    window.addEventListener('keydown', onGesture)
  }

  play(name: SfxName, opts?: { volume?: number; detune?: number }): void {
    const ctx = this.ctx
    const bus = this.sfxGain
    if (ctx === null || bus === null) return
    // Before the unlock gesture the context is suspended: drop silently.
    if (ctx.state !== 'running') return
    try {
      const now = ctx.currentTime
      this.pruneVoices(now)
      if (this.voices.length >= MAX_VOICES) this.evictVoice(name)

      const voiceGain = ctx.createGain()
      voiceGain.gain.value = clamp(opts?.volume ?? 1, 0, 2)
      voiceGain.connect(bus)
      const t0 = now + 0.005
      const duration = buildSfx(ctx, name, voiceGain, t0, opts?.detune ?? 0)
      const voice: Voice = {
        name,
        startedAt: t0,
        endAt: t0 + duration,
        gain: voiceGain,
        cleanup: setTimeout(() => this.releaseVoice(voice), (duration + 0.15) * 1000),
      }
      this.voices.push(voice)
    } catch {
      // Synthesis failures must never break the game loop.
    }
  }

  music(mood: 'menu' | 'battle' | 'off'): void {
    try {
      this.director?.set(mood)
    } catch {
      // No-op on unsupported contexts.
    }
  }

  applySettings(settings: GameSettings): void {
    const ctx = this.ctx
    if (ctx === null || this.masterGain === null || this.musicGain === null || this.sfxGain === null) {
      return
    }
    const now = ctx.currentTime
    this.masterGain.gain.setTargetAtTime(volumeCurve(settings.masterVolume), now, VOLUME_SMOOTHING_S)
    this.musicGain.gain.setTargetAtTime(volumeCurve(settings.musicVolume), now, VOLUME_SMOOTHING_S)
    this.sfxGain.gain.setTargetAtTime(volumeCurve(settings.sfxVolume), now, VOLUME_SMOOTHING_S)
  }

  /** Drops voices whose scheduled sound has fully ended (timer backstop). */
  private pruneVoices(now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i]
      if (v !== undefined && v.endAt + 0.1 < now) {
        clearTimeout(v.cleanup)
        v.gain.disconnect()
        this.voices.splice(i, 1)
      }
    }
  }

  private releaseVoice(voice: Voice): void {
    const idx = this.voices.indexOf(voice)
    if (idx !== -1) this.voices.splice(idx, 1)
    voice.gain.disconnect()
  }

  /** Over the voice cap: kill the oldest voice of the same family, else the oldest overall. */
  private evictVoice(family: SfxName): void {
    if (this.voices.length === 0) return
    // Insertion order equals age order.
    let idx = this.voices.findIndex((v) => v.name === family)
    if (idx === -1) idx = 0
    const victim = this.voices[idx]
    if (victim === undefined) return
    this.voices.splice(idx, 1)
    clearTimeout(victim.cleanup)
    const ctx = this.ctx
    if (ctx !== null) {
      victim.gain.gain.cancelScheduledValues(ctx.currentTime)
      victim.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.01)
    }
    setTimeout(() => victim.gain.disconnect(), 60)
  }
}

let singleton: IAudioEngine | null = null

export function getAudio(): IAudioEngine {
  if (singleton === null) singleton = new AudioEngine()
  return singleton
}
