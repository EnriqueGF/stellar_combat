// Boot scene: no external assets. Initializes global UI singletons and the
// network session, then hands over to the main menu.

import Phaser from 'phaser'
import { COLORS, installResponsiveCamera } from '../theme'
import { GAME_HEIGHT, GAME_WIDTH } from '../theme'
import { Tooltip } from '../ui/tooltip'
import { Toast } from '../ui/toast'
import { addText } from '../ui/helpers'
import { getNet, installRouting } from '../net/socket'
import { getState } from '../state'
import { getAudio } from '../audio/engine'
import { fadeInScene } from '../ui/transition'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  create(): void {
    installResponsiveCamera(this)
    Tooltip.init(this.game)
    Toast.init(this.game)
    getAudio().applySettings(getState().settings)

    const label = addText(
      this,
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      'CONECTANDO CON EL SERVIDOR…',
      'title',
      20,
      COLORS.textDim,
    ).setOrigin(0.5)
    this.tweens.add({
      targets: label,
      alpha: 0.35,
      duration: 700,
      yoyo: true,
      repeat: -1,
    })
    // Fade the splash up from black. Boot's EXIT stays an instant scene.start
    // (below): it races the global resume-routing (run:state/battle:start can
    // fire within the 150ms window), and a fade-out would set the transition
    // guard and block that routing. MainMenu/SectorMap/Battle fade in on their
    // own create(), so the hop still looks smooth.
    fadeInScene(this)

    void getNet()
      .ready()
      .then(() => {
        installRouting(this.game)
        // On a reconnect the server pushes run:state (or an ambush battle:start)
        // right after the hello; the routing layer turns that into a scene start
        // and stops Boot. We wait briefly for that, then fall back to MainMenu if
        // nothing routed us. Doing it this way (rather than starting MainMenu
        // immediately) means MainMenu is never started for a resuming player, so
        // the menu and the sector map can't end up stacked on top of each other.
        this.time.delayedCall(150, () => {
          if (this.scene.isActive('Boot')) this.scene.start('MainMenu')
        })
      })
  }
}
