// Screen transitions ("juice"): every scene change cross-fades through the
// deep-space colour instead of cutting instantly, so navigation feels polished.
//
// Two entry points cover the whole navigation graph:
//   - goToScene(scene, key, data?)  — leave a scene from inside itself.
//   - routeToScene(game, key, data?)— leave whatever scene is on top, used by
//     the global net routing (net/socket.ts), which stops every active scene
//     and starts a fresh one from OUTSIDE any particular scene's update.
// Both fade the active main camera OUT, then start the target. The target then
// calls fadeInScene(this) in its own create() to fade back IN.
//
// Design notes:
//   - We fade to COLORS.spaceDeep (the game background), so the dip reads as a
//     clean settle into space, never a white flash.
//   - A single module-level guard (`transitioning`) prevents overlapping
//     transitions: a second goToScene/routeToScene while one is mid-fade is
//     ignored, so a double-click or a burst of routing events can't start two
//     scenes or stack them. The guard clears the instant the new scene starts.
//   - Phaser's CAMERA_FADE_OUT_COMPLETE event drives the swap, but we also arm a
//     fallback timer: if the event never fires (e.g. the camera was replaced by
//     a resize mid-fade) the scene STILL starts, so we never get stuck black.
//   - Input on the leaving scene is disabled during the fade to swallow stray
//     clicks; the scene is being torn down immediately afterwards anyway.

import Phaser from 'phaser'
import { COLORS } from '../theme'
import { getAudio } from '../audio/engine'

/** Fade durations (ms). Snappy but clearly noticeable — the game previously cut
 *  instantly, which felt abrupt. ~250ms each side is the sweet spot: enough to
 *  register as a transition, short enough to never feel sluggish. */
export const FADE_OUT_MS = 250
export const FADE_IN_MS = 250

/** Deep-space background colour, as RGB components for the camera fade. */
const R = (COLORS.spaceDeep >> 16) & 0xff
const G = (COLORS.spaceDeep >> 8) & 0xff
const B = COLORS.spaceDeep & 0xff

/** Global so it spans the leaving scene AND the starting scene (the leaving one
 *  is torn down before the new one's create runs, so an instance flag wouldn't
 *  survive the hop). Cleared the moment the next scene is started. */
let transitioning = false

/**
 * Fades the scene's main camera OUT to deep space, then starts `key` with
 * `data`. Use this to replace a direct `scene.scene.start(...)` so leaving a
 * screen fades instead of cutting. Ignored (no-op) if a transition is already
 * running, which guards against double-clicks and re-entrancy.
 */
export function goToScene(
  scene: Phaser.Scene,
  key: string,
  data?: object,
): void {
  if (transitioning) return
  transitioning = true
  playWhoosh()
  fadeOutThen(scene, () => {
    // Starting a fresh scene clears this one; the guard is released here so the
    // target's own fadeInScene (and any later navigation) isn't blocked.
    transitioning = false
    scene.scene.start(key, data)
  })
}

/**
 * Like goToScene but for the GLOBAL net routing, which lives outside any one
 * scene: it fades whichever scene is currently on top, then stops EVERY active
 * scene and starts `key` fresh (matching the previous startScene semantics so
 * nothing ends up stacked). Falls back to a plain start if no scene is active.
 */
export function routeToScene(
  game: Phaser.Game,
  key: string,
  data?: object,
): void {
  if (transitioning) return
  const active = game.scene.getScenes(true)
  const top = active[active.length - 1]
  const start = (): void => {
    transitioning = false
    for (const s of game.scene.getScenes(true)) s.scene.stop()
    game.scene.start(key, data)
  }
  if (!top) {
    // Nothing on screen to fade (e.g. very first boot): start immediately.
    start()
    return
  }
  transitioning = true
  playWhoosh()
  fadeOutThen(top, start)
}

/**
 * Fades the scene's main camera IN from deep space. Call once at the END of
 * create(), after the camera has been set up (installResponsiveCamera /
 * fitCameraToStage) and the chrome built, so the scene reveals smoothly. Safe to
 * call unconditionally — it only fades the camera and never blocks input.
 */
export function fadeInScene(scene: Phaser.Scene): void {
  // fadeIn paints the camera fully with (R,G,B) on frame 0, then lifts it, so the
  // scene is never shown un-faded for a frame. Phaser force-restarts the effect
  // internally, so it's clean even on a reused scene/camera (a leftover fadeOut
  // from this scene's previous life can't get stuck).
  scene.cameras.main.fadeIn(FADE_IN_MS, R, G, B)
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Fades `scene`'s main camera out, runs `then` exactly once on completion, and
 *  arms a fallback timer so `then` still fires if the camera event doesn't. */
function fadeOutThen(scene: Phaser.Scene, then: () => void): void {
  // Don't let lingering clicks fire on the scene we're leaving.
  scene.input.enabled = false

  let done = false
  const finish = (): void => {
    if (done) return
    done = true
    then()
  }

  const cam = scene.cameras.main
  cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, finish)
  // Safety net: if the event never arrives (camera swapped on resize, etc.),
  // start anyway so we never hang on a black screen. Slightly longer than the
  // fade so the event wins under normal conditions.
  scene.time.delayedCall(FADE_OUT_MS + 120, finish)

  cam.fadeOut(FADE_OUT_MS, R, G, B)
}

/** Soft, quiet transition blip layered under every scene change. */
function playWhoosh(): void {
  getAudio().play('whoosh', { volume: 0.5 })
}
