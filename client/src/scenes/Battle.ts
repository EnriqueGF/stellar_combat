// Battle scene (GAME_SPEC §6.3): renders both ships from server snapshots,
// routes discrete battle events to VFX/SFX, exposes every intent (power,
// targeting, crew, drones, jump, pause) and hosts the first-battle tutorial.
// All socket listeners registered here are removed on shutdown.

import Phaser from 'phaser'
import {
  SHIPS,
  mulberry32,
  type BattleResult,
  type BattleSnapshot,
  type BattleStartMsg,
  type PlanetBiome,
  type Side,
} from '@stellar/shared'
import type {
  BattleSceneData,
  GameStateStore,
  IShieldBubble,
  ICrtOverlay,
  ISpaceBackdrop,
  Net,
  ResultSceneData,
} from '../contracts'
import { getAudio } from '../audio/engine'
import { getNet, scOn } from '../net/socket'
import { getState } from '../state'
import { SpaceBackdrop } from '../vfx/backdrop'
import { ShieldBubble } from '../vfx/shield'
import { CrtOverlay } from '../vfx/crt'
import { COLORS, COLORS_CSS, GAME_HEIGHT, GAME_WIDTH, HUD, installResponsiveCamera } from '../theme'
import { SYSTEM_NAMES, makeText, makeTitleText } from '../battle/common'
import { CombatLog } from '../battle/combatLog'
import { BattleEventRouter } from '../battle/eventFx'
import { BottomHud } from '../battle/hud'
import { CrewPortraits } from '../battle/portraits'
import { Readouts } from '../battle/readouts'
import { ShipView } from '../battle/shipView'
import { TargetingController } from '../battle/targeting'
import { TutorialController } from '../battle/tutorial'
import { Toast, Tooltip } from '../battle/uiKit'

const BIOMES: PlanetBiome[] = ['gas_giant', 'rocky', 'ice', 'volcanic', 'oceanic', 'desert']

export class BattleScene extends Phaser.Scene {
  private start!: BattleStartMsg
  private snap!: BattleSnapshot
  private mySide: Side = 'a'
  private net!: Net
  private store!: GameStateStore

  private backdrop: ISpaceBackdrop | null = null
  private crt: ICrtOverlay | null = null
  private playerView!: ShipView
  private enemyView!: ShipView
  private playerBubble!: IShieldBubble
  private enemyBubble!: IShieldBubble
  private hud!: BottomHud
  private portraits!: CrewPortraits
  private readouts!: Readouts
  private log!: CombatLog
  private targeting!: TargetingController
  private tutorial!: TutorialController
  private router!: BattleEventRouter

  private pauseOverlay: Phaser.GameObjects.Container | null = null
  private created = false
  private ended = false
  private fledByMe = false
  /** True while the first-battle tutorial paused the fight on its own. */
  private tutorialPaused = false

  private readonly onSnapshot = (snap: BattleSnapshot): void => {
    this.applySnapshot(snap)
  }
  private readonly onEvents = (events: Parameters<BattleEventRouter['handle']>[0]): void => {
    if (!this.created) return
    for (const ev of events) {
      if (ev.t === 'fled' && ev.side === this.mySide) this.fledByMe = true
    }
    this.router.handle(events)
  }
  private readonly onEnd = (result: BattleResult, yourSide: Side): void => {
    if (this.ended) return
    this.ended = true
    // Let the final VFX (explosion chain / jump flash) play before the switch.
    this.time.delayedCall(1500, () => {
      const run = this.store.run
      const node = run?.sector.nodes.find((n) => n.id === run.currentNodeId)
      const bossNode = node?.type === 'boss'
      const data: ResultSceneData = {
        result,
        yourSide,
        mode: this.start.mode,
        runContinues:
          this.start.mode === 'expedition' &&
          !bossNode &&
          (result.winner === yourSide || (result.reason === 'fled' && this.fledByMe)),
      }
      this.scene.start('Result', data)
    })
  }

  constructor() {
    super('Battle')
  }

  init(data: BattleSceneData): void {
    this.start = data.start
    this.snap = data.start.snapshot
    this.mySide = data.start.side
    this.created = false
    this.ended = false
    this.fledByMe = false
  }

  create(): void {
    installResponsiveCamera(this)
    this.net = getNet()
    this.store = getState()
    const audio = getAudio()
    this.input.mouse?.disableContextMenu()

    // --- backdrop: planet to the right, behind the enemy ship ---
    const seed = this.start.backdropSeed
    const rng = mulberry32(seed)
    const biome = BIOMES[Math.floor(rng() * BIOMES.length)] ?? 'rocky'
    this.backdrop = new SpaceBackdrop(this, seed, biome, { planetX: 950, planetY: 260 })

    audio.music('battle')

    // --- ships + shields ---
    this.playerView = new ShipView(this, HUD.playerShipRect, this.snap.you, {
      facing: 1,
      maxCell: 52,
    })
    this.enemyView = new ShipView(this, HUD.enemyShipRect, this.snap.enemy, {
      facing: -1,
      maxCell: 44,
    })
    const pb = this.playerView.bubbleParams()
    this.playerBubble = new ShieldBubble(this, pb.cx, pb.cy, pb.rx, pb.ry)
    const eb = this.enemyView.bubbleParams()
    this.enemyBubble = new ShieldBubble(this, eb.cx, eb.cy, eb.rx, eb.ry)

    this.attachRoomTooltips(this.playerView, false)
    this.attachRoomTooltips(this.enemyView, true)

    // --- HUD widgets ---
    this.log = new CombatLog(this)
    this.readouts = new Readouts(this, audio)
    this.portraits = new CrewPortraits(this, this.snap.you.crew, {
      onSelect: (crewId) => this.targeting.selectCrew(crewId),
      onDeselect: () => this.targeting.clearSelection(),
    })
    this.hud = new BottomHud(
      this,
      this.snap.you,
      {
        socket: this.net.socket,
        audio,
        fleeTooltip:
          this.start.mode === 'expedition'
            ? 'Huir: pierdes el botín del nodo.\nRequiere cabina tripulada y motores con energía.'
            : 'Huir: en Duelo cuenta como rendición.',
      },
      {
        onSelectWeapon: (slot) => this.targeting.selectWeapon(slot),
        onSlotRightClick: (slot) => this.targeting.onSlotRightClick(slot),
        onJumpClick: () => this.jumpClicked(),
        onAmmoDepleted: () => this.tutorial.notifyAmmoEmpty(),
      },
    )
    this.targeting = new TargetingController({
      scene: this,
      socket: this.net.socket,
      audio,
      playerView: this.playerView,
      enemyView: this.enemyView,
      hud: this.hud,
      portraits: this.portraits,
      getYou: () => this.snap.you,
    })

    this.router = new BattleEventRouter({
      scene: this,
      mySide: this.mySide,
      viewFor: (side) => (side === this.mySide ? this.playerView : this.enemyView),
      bubbleFor: (side) => (side === this.mySide ? this.playerBubble : this.enemyBubble),
      log: this.log,
      audio,
      portraits: this.portraits,
      isEnded: () => this.ended,
    })

    this.buildPauseOverlay()

    // --- tutorial ---
    this.tutorial = new TutorialController(
      this,
      {
        shieldsColumn: () => this.hud.systemColumnRect('shields'),
        weaponSlot: (slot) => this.hud.slotRect(slot),
        playerShip: () => ({ ...HUD.playerShipRect }),
        portraits: () => this.portraits.rect(),
      },
      {
        audio,
        onDone: () => {
          this.store.settings.tutorialDone = true
          this.store.saveSettings()
          // Resume the fight the tutorial paused (unless the battle already ended).
          if (this.tutorialPaused) {
            this.tutorialPaused = false
            if (!this.ended && this.snap.paused) this.net.socket.emit('battle:pause', false)
          }
        },
      },
    )
    if (this.start.firstBattle && !this.store.settings.tutorialDone) {
      this.time.delayedCall(700, () => {
        if (this.ended) return
        // Auto-pause while the tutorial is on screen so the player can read it
        // without taking fire (pause is allowed vs the NPC in Expedición).
        if (this.snap.pauseAllowed && !this.snap.paused) {
          this.tutorialPaused = true
          this.net.socket.emit('battle:pause', true)
        }
        this.tutorial.start()
      })
    }

    // --- CRT on top ---
    this.crt = new CrtOverlay(this)
    this.crt.setEnabled(this.store.settings.crtEnabled)

    // --- keyboard ---
    const kb = this.input.keyboard
    if (kb !== null) {
      kb.on('keydown-SPACE', () => this.togglePause())
      kb.on('keydown-J', () => this.jumpClicked())
    }

    // --- network: 'sc' bus listeners auto-unsubscribe on scene shutdown ---
    scOn(this, 'battle:snapshot', this.onSnapshot)
    scOn(this, 'battle:events', this.onEvents)
    scOn(this, 'battle:end', this.onEnd)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup())

    this.created = true
    this.applySnapshot(this.snap)
  }

  // -------------------------------------------------------------------------
  // Intents
  // -------------------------------------------------------------------------

  private togglePause(): void {
    if (this.ended) return
    if (!this.snap.pauseAllowed) {
      Toast.show('Sin pausa en Duelo')
      return
    }
    this.net.socket.emit('battle:pause', !this.snap.paused)
  }

  private jumpClicked(): void {
    if (this.ended) return
    const jump = this.snap.you.jump
    if (jump.charging) {
      this.net.socket.emit('battle:jump', false)
      return
    }
    const engage = (): void => {
      this.net.socket.emit('battle:jump', true)
    }
    // First jump of an expedition asks to confirm losing the node loot.
    if (this.start.mode === 'expedition' && this.tutorial.requestJumpConfirm(engage)) return
    engage()
  }

  // -------------------------------------------------------------------------
  // Snapshot flow
  // -------------------------------------------------------------------------

  private applySnapshot(snap: BattleSnapshot): void {
    if (!this.created) {
      this.snap = snap
      return
    }
    this.snap = snap
    this.playerView.apply(snap.you)
    this.enemyView.apply(snap.enemy)
    this.playerBubble.setLayers(snap.you.shieldLayers, snap.you.shieldLayersMax)
    this.enemyBubble.setLayers(snap.enemy.shieldLayers, snap.enemy.shieldLayersMax)
    this.hud.apply(snap.you)
    this.portraits.apply(snap.you.crew)
    this.readouts.apply(snap.you)
    this.targeting.refresh(snap.you)
    // While the tutorial is up the auto-pause is implied by its own dim overlay,
    // so don't also show the PAUSA TÁCTICA banner (they'd overlap near the top).
    this.pauseOverlay?.setVisible(snap.paused && !this.tutorial.active)
  }

  // -------------------------------------------------------------------------
  // Pause overlay
  // -------------------------------------------------------------------------

  private buildPauseOverlay(): void {
    const g = this.add.graphics()
    // Subtle bluish vignette: game keeps rendering and accepting orders.
    g.fillStyle(COLORS.shield, 0.06)
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)
    g.fillStyle(COLORS.shield, 0.1)
    g.fillRect(0, 0, GAME_WIDTH, 14)
    g.fillRect(0, GAME_HEIGHT - 14, GAME_WIDTH, 14)
    g.fillRect(0, 0, 14, GAME_HEIGHT)
    g.fillRect(GAME_WIDTH - 14, 0, 14, GAME_HEIGHT)
    g.lineStyle(2, COLORS.shield, 0.6)
    g.strokeRect(3, 3, GAME_WIDTH - 6, GAME_HEIGHT - 6)

    const bannerBg = this.add.graphics()
    bannerBg.fillStyle(COLORS.panel, 0.92)
    bannerBg.fillRoundedRect(GAME_WIDTH / 2 - 150, 60, 300, 48, 8)
    bannerBg.lineStyle(2, COLORS.shield, 0.9)
    bannerBg.strokeRoundedRect(GAME_WIDTH / 2 - 150, 60, 300, 48, 8)
    const title = makeTitleText(this, GAME_WIDTH / 2, 76, 'PAUSA TÁCTICA', 19, COLORS_CSS.shield).setOrigin(
      0.5,
    )
    const sub = makeText(
      this,
      GAME_WIDTH / 2,
      96,
      'Puedes apuntar, mover energía y dar órdenes',
      10,
      COLORS_CSS.textDim,
    ).setOrigin(0.5)

    this.pauseOverlay = this.add.container(0, 0, [g, bannerBg, title, sub])
    this.pauseOverlay.setDepth(900).setVisible(false)
  }

  // -------------------------------------------------------------------------
  // Tooltips for ship rooms
  // -------------------------------------------------------------------------

  private attachRoomTooltips(view: ShipView, isEnemy: boolean): void {
    for (const [roomId, zone] of view.roomZones) {
      Tooltip.attach(zone, () => {
        const st = view.getState()
        const room = st.rooms.find((r) => r.id === roomId)
        const sys = st.systems.find((s) => s.roomId === roomId)
        const def = SHIPS[st.shipClass].layout.rooms.find((r) => r.id === roomId)
        const name =
          def?.system !== undefined ? SYSTEM_NAMES[def.system] : `Sala ${roomId}`
        const lines: string[] = [isEnemy ? `${name} (enemigo)` : name]
        if (sys !== undefined) {
          const usable = Math.max(0, Math.floor(sys.level - sys.damage + 0.0001))
          lines.push(`Nivel ${sys.level} · energía ${sys.power} · útiles ${usable}`)
        }
        if (room !== undefined) {
          let env = `O2: ${Math.round(room.o2)}%`
          if (room.fire > 0) env += ' · ¡FUEGO!'
          if (room.breach > 0) env += ' · ¡BRECHA!'
          lines.push(env)
        }
        lines.push(
          isEnemy
            ? 'Con un arma seleccionada: click fija el objetivo'
            : 'Con un tripulante seleccionado: click lo envía aquí',
        )
        return lines.join('\n')
      })
    }
  }

  // -------------------------------------------------------------------------
  // Loop + teardown
  // -------------------------------------------------------------------------

  override update(time: number, delta: number): void {
    if (!this.created) return
    this.playerView.update(time, delta)
    this.enemyView.update(time, delta)
    this.hud.update(time, delta)
    this.portraits.update(time)
    this.readouts.update(time)
    this.log.update(time)
    this.backdrop?.update(delta)
    if (this.pauseOverlay !== null && this.pauseOverlay.visible) {
      this.pauseOverlay.setAlpha(0.85 + 0.15 * Math.sin(time / 350))
    }
  }

  private cleanup(): void {
    this.targeting.destroy()
    this.tutorial.destroy()
    this.hud.destroy()
    this.portraits.destroy()
    this.readouts.destroy()
    this.log.destroy()
    this.playerBubble.destroy()
    this.enemyBubble.destroy()
    this.playerView.destroy()
    this.enemyView.destroy()
    this.backdrop?.destroy()
    this.backdrop = null
    this.crt?.destroy()
    this.crt = null
    this.pauseOverlay = null
    this.created = false
  }
}
