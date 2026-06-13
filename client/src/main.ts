// Entry point: loads the offline fonts, waits for them (crisp Phaser text),
// then boots the game with every scene registered.

import '@fontsource/orbitron/index.css'
import '@fontsource/orbitron/700.css'
import '@fontsource/share-tech-mono/index.css'
import Phaser from 'phaser'
import { COLORS_CSS } from './theme'
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

  // Cap device-pixel-ratio so 4K/retina don't blow the canvas up to absurd sizes.
  const dpr = (): number => Math.min(Math.max(window.devicePixelRatio || 1, 1), 3)

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'app',
    // The canvas fills the whole window at native device resolution (any aspect
    // ratio, no letterbox). Scenes fit the 1280×720 stage via the camera and the
    // backdrop fills the surrounding space (see theme.ts).
    width: Math.floor(window.innerWidth * dpr()),
    height: Math.floor(window.innerHeight * dpr()),
    backgroundColor: COLORS_CSS.spaceDeep,
    disableContextMenu: true, // right-click is a game action (cancel/clear target)
    scale: {
      mode: Phaser.Scale.NONE, // we size the canvas manually (see resizeToWindow)
      autoCenter: Phaser.Scale.NO_CENTER,
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

  // Backing store = window × dpr (crisp native pixels); CSS size = window (fills
  // the screen). Scenes listen to the scale 'resize' event to refit their camera.
  const resizeToWindow = (): void => {
    const w = Math.max(1, Math.floor(window.innerWidth))
    const h = Math.max(1, Math.floor(window.innerHeight))
    const r = dpr()
    game.scale.resize(Math.floor(w * r), Math.floor(h * r))
    const canvas = game.canvas
    if (canvas) {
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
  }
  resizeToWindow()
  window.addEventListener('resize', resizeToWindow)
  window.addEventListener('orientationchange', resizeToWindow)
}

void boot()
