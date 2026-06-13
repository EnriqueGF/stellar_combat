// Generative ambient music. A layer per mood: slow heavily-lowpassed saw pads
// over an i-VI-III-VII progression in C# minor, a low pedal note and sparse
// echoing "stars". Battle mode adds an internal tempo clock with a sparse
// minor-pentatonic arpeggio and soft percussion, plus a more open pad cutoff.
// Scheduling uses a setTimeout clock with lookahead; every layer tears down
// all of its nodes and timers so repeated scene changes never leak.

import { noiseBurst, noteHz, pluck } from './helpers'

export type MusicMood = 'menu' | 'battle' | 'off'

const CROSSFADE_S = 1.5
const LOOKAHEAD_S = 0.2
const CLOCK_MS = 100
const CHORD_S = 8
// i-VI-III-VII in C# minor, as MIDI notes per chord.
const PROGRESSION: readonly (readonly number[])[] = [
  [49, 56, 61, 64], // C#m
  [45, 52, 57, 61], // A
  [52, 56, 59, 64], // E
  [47, 54, 59, 63], // B
]
const PEDAL_MIDI = 37 // C#2
const PENTATONIC: readonly number[] = [61, 64, 66, 68, 71, 73, 76] // C# minor pentatonic
const STAR_MIDIS: readonly number[] = [85, 88, 90, 92, 95]
const BEAT_S = 0.65

class MusicLayer {
  private readonly gain: GainNode
  private readonly padFilter: BiquadFilterNode
  private readonly delay: DelayNode
  private readonly delayFeedback: GainNode
  private readonly delaySend: GainNode
  private readonly persistent: OscillatorNode[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private chordIdx = 0
  private nextChordT: number
  private nextStarT: number
  private nextBeatT: number
  private beatCount = 0

  constructor(
    private readonly ctx: AudioContext,
    bus: GainNode,
    private readonly mood: 'menu' | 'battle',
  ) {
    const now = ctx.currentTime
    this.gain = ctx.createGain()
    this.gain.gain.setValueAtTime(0, now)
    this.gain.gain.linearRampToValueAtTime(1, now + CROSSFADE_S)
    this.gain.connect(bus)

    this.padFilter = ctx.createBiquadFilter()
    this.padFilter.type = 'lowpass'
    this.padFilter.frequency.value = mood === 'battle' ? 1100 : 600
    this.padFilter.Q.value = 0.9
    this.padFilter.connect(this.gain)

    // Slow LFO on the pad cutoff.
    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = 0.05
    const lfoDepth = ctx.createGain()
    lfoDepth.gain.value = this.mood === 'battle' ? 450 : 250
    lfo.connect(lfoDepth)
    lfoDepth.connect(this.padFilter.frequency)
    lfo.start(now)
    this.persistent.push(lfo)

    // Low pedal note.
    const pedal = ctx.createOscillator()
    pedal.type = 'triangle'
    pedal.frequency.value = noteHz(PEDAL_MIDI)
    const pedalGain = ctx.createGain()
    pedalGain.gain.setValueAtTime(0, now)
    pedalGain.gain.linearRampToValueAtTime(0.09, now + 4)
    pedal.connect(pedalGain)
    pedalGain.connect(this.gain)
    pedal.start(now)
    this.persistent.push(pedal)

    // Echo bus for stars / arpeggio: dry path plus a feedback delay.
    this.delay = ctx.createDelay(1)
    this.delay.delayTime.value = 0.45
    this.delayFeedback = ctx.createGain()
    this.delayFeedback.gain.value = 0.3
    this.delay.connect(this.delayFeedback)
    this.delayFeedback.connect(this.delay)
    this.delay.connect(this.gain)
    this.delaySend = ctx.createGain()
    this.delaySend.connect(this.gain)
    this.delaySend.connect(this.delay)

    this.nextChordT = now + 0.05
    this.nextStarT = now + 2 + Math.random() * 4
    this.nextBeatT = now + 1
    this.tick()
  }

  private tick = (): void => {
    if (this.disposed) return
    const horizon = this.ctx.currentTime + LOOKAHEAD_S
    while (this.nextChordT < horizon) {
      this.scheduleChord(this.nextChordT)
      this.nextChordT += CHORD_S
    }
    while (this.nextStarT < horizon) {
      this.scheduleStar(this.nextStarT)
      this.nextStarT += 4 + Math.random() * 5
    }
    if (this.mood === 'battle') {
      while (this.nextBeatT < horizon) {
        this.scheduleBeat(this.nextBeatT, this.beatCount)
        this.beatCount += 1
        this.nextBeatT += BEAT_S
      }
    }
    this.timer = setTimeout(this.tick, CLOCK_MS)
  }

  private scheduleChord(t: number): void {
    const chord = PROGRESSION[this.chordIdx % PROGRESSION.length]
    this.chordIdx += 1
    if (chord === undefined) return
    for (const midi of chord) {
      for (const detune of [-6, 5]) {
        const osc = this.ctx.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.value = noteHz(midi)
        osc.detune.value = detune
        const g = this.ctx.createGain()
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(0.035, t + 2.8)
        g.gain.setValueAtTime(0.035, t + CHORD_S - 0.5)
        g.gain.linearRampToValueAtTime(0, t + CHORD_S + 2.8)
        osc.connect(g)
        g.connect(this.padFilter)
        osc.start(t)
        osc.stop(t + CHORD_S + 3)
      }
    }
  }

  private scheduleStar(t: number): void {
    const midi = STAR_MIDIS[Math.floor(Math.random() * STAR_MIDIS.length)] ?? 88
    pluck(this.ctx, this.delaySend, t, {
      type: 'sine',
      freq: noteHz(midi),
      attack: 0.02,
      peak: 0.05,
      decay: 1.1,
    })
  }

  private scheduleBeat(t: number, n: number): void {
    if (n % 2 === 0) {
      // Soft brush.
      noiseBurst(this.ctx, this.gain, t, {
        filterType: 'bandpass',
        freq: 3200,
        q: 0.7,
        attack: 0.012,
        peak: 0.045,
        decay: 0.12,
      })
    }
    if (n % 4 === 0) {
      // Soft kick around 60 Hz.
      pluck(this.ctx, this.gain, t, {
        type: 'sine',
        freq: 100,
        freqEnd: 50,
        glide: 0.1,
        attack: 0.003,
        peak: 0.22,
        decay: 0.2,
      })
    }
    // Sparse pentatonic arpeggio: ~1 note every 1-2 s on average.
    if (Math.random() < 0.45) {
      const midi = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)] ?? 64
      pluck(this.ctx, this.delaySend, t + Math.random() * 0.1, {
        type: 'triangle',
        freq: noteHz(midi),
        attack: 0.015,
        peak: 0.07,
        decay: 0.7,
      })
    }
  }

  fadeOutAndDispose(fadeS: number): void {
    if (this.disposed) return
    this.disposed = true
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const now = this.ctx.currentTime
    this.gain.gain.cancelScheduledValues(now)
    this.gain.gain.setValueAtTime(this.gain.gain.value, now)
    this.gain.gain.linearRampToValueAtTime(0, now + fadeS)
    const stopAt = now + fadeS + 0.05
    for (const osc of this.persistent) {
      try {
        osc.stop(stopAt)
      } catch {
        // Already stopped; ignore.
      }
    }
    // Already-scheduled pad/percussion voices carry their own stop times;
    // breaking the graph here (incl. the delay feedback loop) frees the rest.
    setTimeout(
      () => {
        this.delayFeedback.disconnect()
        this.delay.disconnect()
        this.delaySend.disconnect()
        this.padFilter.disconnect()
        this.gain.disconnect()
      },
      (fadeS + 0.2) * 1000,
    )
  }
}

export class MusicDirector {
  private current: MusicLayer | null = null
  private mood: MusicMood = 'off'

  constructor(
    private readonly ctx: AudioContext,
    private readonly bus: GainNode,
  ) {}

  set(mood: MusicMood): void {
    if (mood === this.mood) return
    this.mood = mood
    this.current?.fadeOutAndDispose(CROSSFADE_S)
    this.current = mood === 'off' ? null : new MusicLayer(this.ctx, this.bus, mood)
  }
}
