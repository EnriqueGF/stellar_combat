// Entry point: loads the offline fonts, waits for them (crisp Phaser text),
// then boots the game with every scene registered.

import '@fontsource/orbitron/index.css'
import '@fontsource/orbitron/700.css'
import '@fontsource/share-tech-mono/index.css'
import Phaser from 'phaser'
import { COLORS_CSS, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from './theme'
import { BootScene } from './scenes/Boot'
import { MainMenuScene } from './scenes/MainMenu'
import { LoadoutScene } from './scenes/Loadout'
import { SectorMapScene } from './scenes/SectorMap'
import { BattleScene } from './scenes/Battle'
import { EventScene } from './scenes/Event'
import { ShopScene } from './scenes/Shop'
import { UpgradeScene } from './scenes/Upgrade'
import { ResultScene } from './scenes/Result'

async function boot(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load('16px Orbitron'),
      document.fonts.load('700 16px Orbitron'),
      document.fonts.load('16px "Share Tech Mono"'),
    ])
    await document.fonts.ready
  } catch {
    // Fonts failing to load must never block the game from starting.
  }

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'app',
    // Backing store renders at RENDER_SCALE× the 1280×720 design; each scene's
    // camera is zoomed to match so coordinates stay 1280×720 (see theme.ts).
    width: GAME_WIDTH * RENDER_SCALE,
    height: GAME_HEIGHT * RENDER_SCALE,
    backgroundColor: COLORS_CSS.spaceDeep,
    disableContextMenu: true, // right-click is a game action (cancel/clear target)
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [
      BootScene,
      MainMenuScene,
      LoadoutScene,
      SectorMapScene,
      BattleScene,
      EventScene,
      ShopScene,
      UpgradeScene,
      ResultScene,
    ],
  })
}

void boot()
