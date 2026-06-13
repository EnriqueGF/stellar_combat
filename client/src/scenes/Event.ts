// Event scene: shows run.event (title/text/choices) or, after resolving a
// choice, run.eventResult plus a CONTINUAR button. Navigation back to the
// sector map happens via global routing once run:continue clears the event.

import Phaser from 'phaser'
import { GAME_HEIGHT, GAME_WIDTH } from '../theme'
import { Button } from '../ui/button'
import { Panel } from '../ui/panel'
import { installRunEscapeMenu } from '../ui/escapeMenu'
import { buildRunHeader, menuChrome, textStyle } from '../ui/helpers'
import { getState } from '../state'
import { getNet, scOn } from '../net/socket'
import { getAudio } from '../audio/engine'

export class EventScene extends Phaser.Scene {
  private dyn: Phaser.GameObjects.Container | null = null
  private busy = false

  constructor() {
    super('Event')
  }

  create(): void {
    const run = getState().run
    if (!run || (run.event === null && run.eventResult === null)) {
      this.scene.start(run ? 'SectorMap' : 'MainMenu')
      return
    }
    this.busy = false
    const node = run.sector.nodes.find((n) => n.id === run.currentNodeId)
    const chrome = menuChrome(this, {
      biome: node?.biome ?? 'rocky',
      seed: node?.seed ?? 1,
      planet: { planetX: GAME_WIDTH * 0.18, planetY: GAME_HEIGHT * 0.75 },
    })
    installRunEscapeMenu(this, chrome.crt)
    getAudio().music('menu')

    this.render()
    scOn(this, 'run:refresh', () => {
      this.busy = false
      this.render()
    })
  }

  private render(): void {
    const run = getState().run
    if (!run) return
    if (this.dyn) this.dyn.destroy()
    const dyn = this.add.container(0, 0)
    this.dyn = dyn
    dyn.add(buildRunHeader(this, run))

    const w = 720
    const px = (GAME_WIDTH - w) / 2

    if (run.eventResult !== null) {
      // Resolution view.
      const h = 280
      const py = (GAME_HEIGHT - h) / 2
      const panel = new Panel(this, px, py, w, h, { title: run.event?.title ?? 'SUCESO' })
      dyn.add(panel)
      panel.add(
        this.add.text(24, panel.contentTop + 14, run.eventResult, {
          ...textStyle('body', 17),
          wordWrap: { width: w - 48 },
        }),
      )
      dyn.add(
        new Button(this, GAME_WIDTH / 2, py + h - 50, 'CONTINUAR', () => {
          if (this.busy) return
          this.busy = true
          getNet().socket.emit('run:continue')
          // run:state without event -> global routing moves to SectorMap.
        }, { width: 240, height: 50 }),
      )
      return
    }

    const event = run.event
    if (!event) return
    // Measure the body text first so the panel fits text + choices exactly.
    const body = this.add.text(0, 0, event.text, {
      ...textStyle('body', 16),
      wordWrap: { width: w - 48 },
    })
    const choiceH = event.choices.length * 62
    const h = 36 + 14 + body.height + 26 + choiceH + 14
    const py = Math.max(60, (GAME_HEIGHT - h) / 2)
    const panel = new Panel(this, px, py, w, h, { title: event.title.toUpperCase() })
    dyn.add(panel)
    body.setPosition(24, panel.contentTop + 14)
    panel.add(body)

    let y = py + panel.contentTop + 14 + body.height + 26 + 24
    event.choices.forEach((choice, idx) => {
      dyn.add(
        new Button(this, GAME_WIDTH / 2, y, choice.label, () => {
          if (this.busy) return
          this.busy = true
          getNet().socket.emit('run:event_choice', idx)
        }, { width: w - 80, height: 48, fontSize: 15 }),
      )
      y += 62
    })
  }
}
