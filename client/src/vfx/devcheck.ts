// Manual VFX validation demo. NOT registered in main and not imported by
// production code — mount it from a scratch scene while debugging:
//   import { mountVfxDemo } from '../vfx/devcheck'
//   create() { mountVfxDemo(this) }
// Controls: click/SPACE cycles biome, R ripple, L layers, E explosion,
// P projectiles, B beam, M miss, I intercept, D damage number, S shake.

import Phaser from 'phaser'
import type { PlanetBiome } from '@stellar/shared'
import { SpaceBackdrop } from './backdrop'
import { ShieldBubble } from './shield'
import { fx } from './fx'
import { CrtOverlay } from './crt'
import { COLORS, FONTS, catColor } from '../theme'

const ALL_BIOMES: PlanetBiome[] = ['gas_giant', 'rocky', 'ice', 'volcanic', 'oceanic', 'desert']

export function mountVfxDemo(scene: Phaser.Scene): void {
  let biomeIdx = 0
  let seed = 1337
  let backdrop = new SpaceBackdrop(scene, seed, ALL_BIOMES[0] ?? 'gas_giant')
  const shield = new ShieldBubble(scene, 320, 340, 230, 200)
  let layers = 3
  shield.setLayers(layers, 4)
  const crt = new CrtOverlay(scene)

  const label = scene.add
    .text(12, 12, '', {
      fontFamily: FONTS.body,
      fontSize: '14px',
      color: '#cfe8ef',
      backgroundColor: '#101826',
      padding: { x: 8, y: 6 },
    })
    .setDepth(11000)
    .setScrollFactor(0)

  const refreshLabel = (): void => {
    label.setText(
      `VFX demo — bioma: ${ALL_BIOMES[biomeIdx] ?? '?'} (click/SPACE cambia)\n` +
        `R onda escudo · L capas (${layers}) · E explosión · P proyectiles\n` +
        'B haz · M fallo · I intercepción · D daño · S sacudida',
    )
  }
  refreshLabel()

  const cycleBiome = (): void => {
    biomeIdx = (biomeIdx + 1) % ALL_BIOMES.length
    seed += 101
    backdrop.destroy()
    backdrop = new SpaceBackdrop(scene, seed, ALL_BIOMES[biomeIdx] ?? 'gas_giant')
    refreshLabel()
  }

  scene.input.on(Phaser.Input.Events.POINTER_DOWN, cycleBiome)
  const kb = scene.input.keyboard
  if (kb) {
    kb.on('keydown-SPACE', cycleBiome)
    kb.on('keydown-R', () => shield.ripple(Math.random() * Math.PI * 2))
    kb.on('keydown-L', () => {
      layers = (layers + 1) % 5
      shield.setLayers(layers, 4)
      refreshLabel()
    })
    kb.on('keydown-E', () => fx.explosion(scene, 950, 300, Math.random() < 0.5 ? 'small' : 'big'))
    kb.on('keydown-P', () => {
      const from = { x: 320, y: 340 }
      fx.projectile(scene, 'laser', from, { x: 900, y: 220 }, 600, catColor('energy'))
      fx.projectile(scene, 'kinetic', from, { x: 950, y: 300 }, 500, catColor('kinetic'))
      fx.projectile(scene, 'missile', from, { x: 1000, y: 380 }, 1100, catColor('explosive'))
      fx.projectile(scene, 'bomb', from, { x: 880, y: 420 }, 1200, catColor('explosive'))
      fx.projectile(scene, 'drone_shot', from, { x: 920, y: 160 }, 400, COLORS.catEnergy)
    })
    kb.on('keydown-B', () =>
      fx.beam(scene, { x: 320, y: 340 }, { x: 880, y: 240 }, { x: 1020, y: 320 }, catColor('energy'), 900),
    )
    kb.on('keydown-M', () => fx.missDeflect(scene, 950, 300))
    kb.on('keydown-I', () => fx.intercept(scene, 640, 330))
    kb.on('keydown-D', () =>
      fx.damageNumber(scene, 950, 280, 1 + Math.floor(Math.random() * 4), COLORS.danger),
    )
    kb.on('keydown-S', () => fx.screenShake(scene, 1 + Math.random() * 2))
    kb.on('keydown-C', () => {
      crtOn = !crtOn
      crt.setEnabled(crtOn)
    })
  }
  let crtOn = true

  scene.events.on(Phaser.Scenes.Events.UPDATE, (_t: number, dt: number) => backdrop.update(dt))
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    backdrop.destroy()
    shield.destroy()
    crt.destroy()
  })
}
