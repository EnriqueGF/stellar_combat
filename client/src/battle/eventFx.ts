// Routes discrete battle events (server-timed) to VFX, SFX and combat log
// entries. Projectile travel time matches the server resolution tick, so the
// matching impact event arrives right when the visual lands.

import type Phaser from 'phaser'
import {
  HULL_SHAKE_THRESHOLD,
  SHIPS,
  TICK_MS,
  WEAPONS,
  type BattleEvent,
  type ProjectileKind,
  type Side,
  type SystemId,
} from '@stellar/shared'
import type { IAudioEngine, IShieldBubble, SfxName } from '../contracts'
import { fx } from '../vfx/fx'
import { COLORS, catColor } from '../theme'
import type { CombatLog } from './combatLog'
import type { CrewPortraits } from './portraits'
import type { ShipView } from './shipView'
import { SYSTEM_NAMES, type Vec2 } from './common'

const SHOT_SFX: Record<ProjectileKind, SfxName> = {
  laser: 'laser',
  kinetic: 'gauss',
  missile: 'missile',
  bomb: 'bomb',
  drone_shot: 'laser',
}

export interface EventRouterDeps {
  scene: Phaser.Scene
  mySide: Side
  /** View of the ship OWNED by the given side. */
  viewFor(side: Side): ShipView
  bubbleFor(side: Side): IShieldBubble
  log: CombatLog
  audio: IAudioEngine
  portraits: CrewPortraits
  /** Battle has visually ended (suppresses redundant alarms). */
  isEnded(): boolean
}

function other(side: Side): Side {
  return side === 'a' ? 'b' : 'a'
}

export class BattleEventRouter {
  private readonly d: EventRouterDeps

  constructor(deps: EventRouterDeps) {
    this.d = deps
  }

  handle(events: BattleEvent[]): void {
    for (const ev of events) this.one(ev)
  }

  private one(ev: BattleEvent): void {
    const d = this.d
    switch (ev.t) {
      case 'shot': {
        const firer = d.viewFor(ev.side)
        const target = d.viewFor(other(ev.side))
        const from = ev.fromRoomId !== null ? firer.roomCenter(ev.fromRoomId) : firer.noseTip()
        const to = target.roomCenter(ev.targetRoomId)
        const def = ev.weaponId !== null ? WEAPONS[ev.weaponId] : null
        const color = def !== null ? catColor(def.category) : COLORS.catEnergy
        fx.projectile(d.scene, ev.kind, from, to, Math.max(80, ev.travelTicks * TICK_MS), color)
        const sfx = SHOT_SFX[ev.kind]
        d.audio.play(sfx, ev.kind === 'drone_shot' ? { volume: 0.5, detune: 250 } : undefined)
        break
      }

      case 'impact': {
        // ev.side owns the TARGET ship.
        const mine = ev.side === d.mySide
        const targetView = d.viewFor(ev.side)
        const pos = targetView.roomCenter(ev.targetRoomId)
        const roomName = this.roomName(ev.side, ev.targetRoomId)
        switch (ev.outcome) {
          case 'miss': {
            fx.missDeflect(d.scene, pos.x, pos.y)
            d.audio.play('miss')
            d.log.add(mine ? 'El disparo enemigo falla.' : 'Tu disparo falla.', COLORS.textDim)
            break
          }
          case 'shield': {
            const bubble = d.bubbleFor(ev.side)
            bubble.ripple(this.angleTowardsAttacker(ev.side) + (Math.random() - 0.5) * 0.5)
            d.audio.play('shield_hit')
            d.log.add(
              mine ? 'Tus escudos absorben el impacto.' : 'Los escudos enemigos absorben el impacto.',
              COLORS.shield,
            )
            break
          }
          case 'intercepted': {
            const p = this.interceptPoint(ev.side)
            fx.intercept(d.scene, p.x, p.y)
            d.audio.play('intercept')
            d.log.add(
              mine ? 'Tu defensa intercepta un proyectil.' : 'El enemigo intercepta tu proyectil.',
              COLORS.shield,
            )
            break
          }
          case 'hull': {
            const big = ev.hullDamage >= HULL_SHAKE_THRESHOLD
            fx.explosion(d.scene, pos.x, pos.y, big ? 'big' : 'small')
            if (big) fx.screenShake(d.scene, mine ? ev.hullDamage / 2 : ev.hullDamage / 3)
            d.audio.play('explosion', { volume: big ? 1 : 0.7 })
            if (ev.hullDamage > 0) {
              fx.damageNumber(d.scene, pos.x, pos.y - 6, ev.hullDamage, COLORS.danger)
            }
            if (ev.systemDamage > 0) {
              fx.damageNumber(d.scene, pos.x + 20, pos.y + 8, ev.systemDamage, COLORS.warn)
            }
            const extras = `${ev.fire ? ' ¡Fuego!' : ''}${ev.breach ? ' ¡Brecha!' : ''}`
            const dmg = Math.round(ev.hullDamage)
            d.log.add(
              mine
                ? `Impacto en ${roomName}: ${dmg} al casco.${extras}`
                : `Aciertas en ${roomName} enemiga: ${dmg} al casco.${extras}`,
              mine ? COLORS.danger : COLORS.ok,
            )
            break
          }
        }
        break
      }

      case 'beam': {
        const firer = d.viewFor(ev.side)
        const target = d.viewFor(other(ev.side))
        const weaponsRoom = firer.systemRoomId('weapons')
        const from = weaponsRoom !== null ? firer.roomCenter(weaponsRoom) : firer.noseTip()
        const mine = ev.side === d.mySide
        if (ev.blocked) {
          const bubble = d.bubbleFor(other(ev.side))
          const angle = this.angleTowardsAttacker(other(ev.side))
          bubble.ripple(angle)
          const rim = this.rimPoint(other(ev.side), angle)
          fx.beam(d.scene, from, rim, rim, catColor('energy'), 420)
          d.audio.play('shield_hit', { detune: -300 })
          d.log.add(
            mine
              ? 'Tu haz es absorbido, pero funde una capa de escudo.'
              : 'El haz enemigo es absorbido por tus escudos.',
            COLORS.shield,
          )
        } else {
          const first = ev.roomIds[0]
          const second = ev.roomIds[1] ?? first
          if (first === undefined) break
          const a = target.roomCenter(first)
          const b = second !== undefined ? target.roomCenter(second) : a
          fx.beam(d.scene, from, a, b, catColor('energy'), 700)
          d.audio.play('laser', { detune: -500, volume: 1.1 })
          const names = ev.roomIds.map((r) => this.roomName(other(ev.side), r)).join(' y ')
          d.log.add(
            mine ? `Tu haz barre ${names}.` : `Un haz enemigo barre ${names}.`,
            mine ? COLORS.ok : COLORS.danger,
          )
        }
        break
      }

      case 'shield_layer': {
        const bubble = d.bubbleFor(ev.side)
        const view = d.viewFor(ev.side)
        bubble.setLayers(ev.layers, view.getState().shieldLayersMax)
        if (ev.broke) {
          d.audio.play('shield_down')
          if (ev.layers === 0) {
            d.log.add(
              ev.side === d.mySide ? '¡Tus escudos han caído!' : '¡Escudos enemigos caídos!',
              ev.side === d.mySide ? COLORS.danger : COLORS.ok,
            )
          }
        }
        break
      }

      case 'system_destroyed': {
        const mine = ev.side === d.mySide
        const view = d.viewFor(ev.side)
        const roomId = view.systemRoomId(ev.system)
        if (roomId !== null) {
          const p = view.roomCenter(roomId)
          fx.explosion(d.scene, p.x, p.y, 'small')
        }
        if (mine && !d.isEnded()) d.audio.play('alarm')
        d.log.add(
          mine
            ? `¡Tu sistema de ${this.systemName(ev.system)} ha sido destruido!`
            : `¡${this.systemName(ev.system)} enemigos destruidos!`,
          mine ? COLORS.danger : COLORS.ok,
        )
        break
      }

      case 'crew_died': {
        const mine = ev.side === d.mySide
        d.viewFor(ev.side).flashCrew(ev.crewId, COLORS.danger)
        if (mine) {
          d.portraits.flash(ev.crewId, COLORS.danger)
          if (!d.isEnded()) d.audio.play('alarm')
        }
        d.log.add(
          mine ? `${ev.name} ha muerto.` : `${ev.name} (enemigo) ha muerto.`,
          mine ? COLORS.danger : COLORS.ok,
        )
        break
      }

      case 'crew_levelup': {
        const mine = ev.side === d.mySide
        d.viewFor(ev.side).flashCrew(ev.crewId, COLORS.ok)
        if (mine) {
          d.portraits.flash(ev.crewId, COLORS.ok)
          d.audio.play('levelup')
          const member = d.viewFor(ev.side).getState().crew.find((c) => c.id === ev.crewId)
          d.log.add(`${member?.name ?? 'Tripulante'} sube a nivel ${ev.level}.`, COLORS.ok)
        }
        break
      }

      case 'jump_charged': {
        d.scene.cameras.main.flash(280, 255, 255, 255)
        d.audio.play('jump')
        d.log.add(
          ev.side === d.mySide ? '¡Salto cargado!' : '¡El enemigo ha cargado su salto!',
          COLORS.warn,
        )
        break
      }

      case 'fled': {
        d.scene.cameras.main.flash(450, 255, 255, 255)
        d.audio.play('jump')
        d.log.add(
          ev.side === d.mySide ? 'Has huido del combate.' : 'La nave enemiga ha huido.',
          COLORS.warn,
        )
        break
      }

      case 'hull_destroyed': {
        const view = d.viewFor(ev.side)
        d.bubbleFor(ev.side).setLayers(0, view.getState().shieldLayersMax)
        // Chain of explosions over the hull (~1.2 s) with a strong shake.
        fx.screenShake(d.scene, 2.6)
        for (let i = 0; i < 5; i++) {
          d.scene.time.delayedCall(i * 240 + Math.random() * 80, () => {
            const p = view.randomHullPoint()
            fx.explosion(d.scene, p.x, p.y, 'big')
            d.audio.play('explosion', { volume: 0.9, detune: (Math.random() - 0.5) * 400 })
          })
        }
        d.log.add(
          ev.side === d.mySide ? '¡Tu nave ha sido destruida!' : '¡Nave enemiga destruida!',
          ev.side === d.mySide ? COLORS.danger : COLORS.ok,
        )
        break
      }

      case 'log': {
        d.log.add(ev.msg)
        break
      }
    }
  }

  // -------------------------------------------------------------------------

  private systemName(id: SystemId): string {
    return SYSTEM_NAMES[id]
  }

  private roomName(side: Side, roomId: number): string {
    const view = this.d.viewFor(side)
    const def = SHIPS[view.getState().shipClass]
    const room = def.layout.rooms.find((r) => r.id === roomId)
    if (room?.system !== undefined) return SYSTEM_NAMES[room.system]
    return `la sala ${roomId}`
  }

  /** Angle from the bubble center of `side` towards the opposing ship. */
  private angleTowardsAttacker(side: Side): number {
    const target = this.d.viewFor(side).bubbleParams()
    const attacker = this.d.viewFor(other(side)).center()
    return Math.atan2(attacker.y - target.cy, attacker.x - target.cx)
  }

  private rimPoint(side: Side, angle: number): Vec2 {
    const b = this.d.viewFor(side).bubbleParams()
    return { x: b.cx + Math.cos(angle) * b.rx, y: b.cy + Math.sin(angle) * b.ry }
  }

  private interceptPoint(targetSide: Side): Vec2 {
    const t = this.d.viewFor(targetSide).center()
    const a = this.d.viewFor(other(targetSide)).center()
    const k = 0.3 + Math.random() * 0.15
    return {
      x: t.x + (a.x - t.x) * k,
      y: t.y + (a.y - t.y) * k + (Math.random() - 0.5) * 40,
    }
  }
}
