// Boot scene: no external assets. Initializes global UI singletons and the
// network session, then hands over to the main menu.

import Phaser from 'phaser'
import { COLORS } from '../theme'
import { GAME_HEIGHT, GAME_WIDTH } from '../theme'
import { Tooltip } from '../ui/tooltip'
import { Toast } from '../ui/toast'
import { addText } from '../ui/helpers'
import { getNet, installRouting } from '../net/socket'
import { getState } from '../state'
import { getAudio } from '../audio/engine'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  create(): void {
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

    void getNet()
      .ready()
      .then(() => {
        installRouting(this.game)
        if (this.scene.isActive('Boot')) this.scene.start('MainMenu')
      })
  }
}
