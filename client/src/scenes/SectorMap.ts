// Sector map: node graph of the expedition. Current node pulses, reachable
// nodes are highlighted and clickable (run:choose_node), past columns are
// dimmed. Node types use distinct SHAPES + colors + glyphs (colorblind-safe).

import Phaser from 'phaser'
import type { NodeType, RunStatePublic, SectorNode } from '@stellar/shared'
import { COLORS, GAME_HEIGHT, GAME_WIDTH } from '../theme'
import { Button } from '../ui/button'
import { Panel } from '../ui/panel'
import { Tooltip } from '../ui/tooltip'
import { installRunEscapeMenu } from '../ui/escapeMenu'
import {
  addText,
  buildRunHeader,
  menuChrome,
  NODE_TYPE_NAMES_ES,
  textStyle,
} from '../ui/helpers'
import { getState } from '../state'
import { getNet, scOn } from '../net/socket'
import { getAudio } from '../audio/engine'
import { fadeInScene } from '../ui/transition'

interface NodeStyle {
  color: number
  shape: 'circle' | 'diamond' | 'square' | 'triangle'
}

const NODE_STYLES: Record<NodeType, NodeStyle> = {
  start: { color: 0x7f95a3, shape: 'circle' },
  combat: { color: 0xff5c57, shape: 'circle' },
  elite: { color: 0xffb454, shape: 'diamond' },
  event: { color: 0x2de2e6, shape: 'circle' },
  shop: { color: 0x5af78e, shape: 'square' },
  boss: { color: 0xff5c57, shape: 'triangle' },
}

export class SectorMapScene extends Phaser.Scene {
  private dyn: Phaser.GameObjects.Container | null = null
  private choosing = false

  constructor() {
    super('SectorMap')
  }

  create(): void {
    const run = getState().run
    if (!run) {
      // Defensive bail (no live run): instant, not a fade — this is error
      // recovery, and a direct start avoids touching the transition guard.
      this.scene.start('MainMenu')
      return
    }
    this.choosing = false
    const current = run.sector.nodes.find((n) => n.id === run.currentNodeId)
    const chrome = menuChrome(this, {
      biome: current?.biome ?? 'rocky',
      seed: current?.seed ?? 1,
      planet: { planetX: GAME_WIDTH * 0.82, planetY: GAME_HEIGHT * 0.3 },
    })
    installRunEscapeMenu(this, chrome.crt)
    getAudio().music('menu')

    this.render()
    scOn(this, 'run:refresh', () => {
      this.choosing = false
      this.render()
    })
    fadeInScene(this)
  }

  private render(): void {
    const run = getState().run
    if (!run) return
    if (this.dyn) this.dyn.destroy()
    const dyn = this.add.container(0, 0)
    this.dyn = dyn

    dyn.add(buildRunHeader(this, run))
    dyn.add(
      addText(this, GAME_WIDTH - 16, 22, 'MAPA DEL SECTOR', 'title', 16, COLORS.panelBorder)
        .setOrigin(1, 0.5),
    )

    this.renderGraph(dyn, run)
    this.renderLegend(dyn)

    dyn.add(
      new Button(this, GAME_WIDTH - 130, GAME_HEIGHT - 50, 'ABANDONAR', () => {
        this.confirmAbandon()
      }, { width: 200, height: 42, fontSize: 14, variant: 'danger' }),
    )
  }

  private nodePosition(node: SectorNode, run: RunStatePublic): { x: number; y: number } {
    const siblings = run.sector.nodes
      .filter((n) => n.col === node.col)
      .sort((a, b) => a.row - b.row)
    const idx = siblings.indexOf(node)
    const count = siblings.length
    const maxCol = run.sector.nodes.reduce((m, n) => Math.max(m, n.col), 1)
    const x = 90 + (node.col * (GAME_WIDTH - 220)) / Math.max(1, maxCol)
    const y = 360 + (idx - (count - 1) / 2) * 130
    return { x, y }
  }

  private renderGraph(dyn: Phaser.GameObjects.Container, run: RunStatePublic): void {
    const current = run.sector.nodes.find((n) => n.id === run.currentNodeId)
    const reachable = new Set<number>(current?.edges ?? [])
    const revealed = new Set<number>(run.revealedNodeIds)
    const pos = new Map<number, { x: number; y: number }>()
    for (const n of run.sector.nodes) pos.set(n.id, this.nodePosition(n, run))

    // Edges first (under the nodes).
    const edges = this.add.graphics()
    for (const n of run.sector.nodes) {
      const a = pos.get(n.id)
      if (!a) continue
      for (const targetId of n.edges) {
        const b = pos.get(targetId)
        if (!b) continue
        const isNext = n.id === run.currentNodeId && reachable.has(targetId)
        edges.lineStyle(isNext ? 2.5 : 1.5, isNext ? COLORS.panelBorder : COLORS.textDim, isNext ? 0.9 : 0.25)
        edges.lineBetween(a.x, a.y, b.x, b.y)
      }
    }
    dyn.add(edges)

    const currentCol = current?.col ?? 0
    for (const n of run.sector.nodes) {
      const p = pos.get(n.id)
      if (!p) continue
      dyn.add(
        this.renderNode(
          n,
          p,
          n.id === run.currentNodeId,
          reachable.has(n.id),
          n.col < currentCol,
          revealed.has(n.id),
        ),
      )
    }
  }

  private renderNode(
    node: SectorNode,
    p: { x: number; y: number },
    isCurrent: boolean,
    isReachable: boolean,
    isPast: boolean,
    revealed: boolean,
  ): Phaser.GameObjects.Container {
    const c = this.add.container(p.x, p.y)
    const r = revealed && node.type === 'boss' ? 30 : 22
    const accent = revealed ? NODE_STYLES[node.type].color : 0x9fd4f0

    if (revealed) {
      const style = NODE_STYLES[node.type]
      const g = this.add.graphics()
      g.fillStyle(COLORS.panel, 0.95)
      g.lineStyle(isCurrent || isReachable ? 2.5 : 1.5, style.color, 1)
      if (style.shape === 'circle') {
        g.fillCircle(0, 0, r)
        g.strokeCircle(0, 0, r)
      } else if (style.shape === 'square') {
        g.fillRect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7)
        g.strokeRect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7)
      } else if (style.shape === 'diamond') {
        const pts = [
          new Phaser.Math.Vector2(0, -r),
          new Phaser.Math.Vector2(r, 0),
          new Phaser.Math.Vector2(0, r),
          new Phaser.Math.Vector2(-r, 0),
        ]
        g.fillPoints(pts, true)
        g.strokePoints(pts, true)
      } else {
        const tri = new Phaser.Geom.Triangle(-r, r * 0.8, r, r * 0.8, 0, -r)
        g.fillTriangleShape(tri)
        g.strokeTriangleShape(tri)
      }
      c.add(g)
      c.add(this.drawNodeIcon(node.type, style.color))
    } else {
      // Undiscovered beacon: a pulsing "?" light, no hint of what it holds.
      const g = this.add.graphics()
      g.fillStyle(COLORS.panel, 0.9)
      g.fillCircle(0, 0, r)
      g.lineStyle(isReachable ? 2.5 : 1.5, isReachable ? 0x9fd4f0 : 0x6f8aa3, isReachable ? 1 : 0.65)
      g.strokeCircle(0, 0, r)
      c.add(g)
      const glow = this.add.graphics()
      glow.fillStyle(0x9fd4f0, 0.16)
      glow.fillCircle(0, 0, r * 0.6)
      c.add(glow)
      const q = this.add.text(0, 0, '?', textStyle('title', 22, 0x9fb8cc)).setOrigin(0.5)
      c.add(q)
      this.tweens.add({
        targets: [q, glow],
        alpha: 0.45,
        duration: 1100,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
    }

    if (isPast) c.setAlpha(0.35)
    else if (!isCurrent && !isReachable) c.setAlpha(revealed ? 0.65 : 0.72)

    if (isCurrent) {
      const ring = this.add.graphics()
      ring.lineStyle(2, COLORS.text, 0.9)
      ring.strokeCircle(0, 0, r + 8)
      c.add(ring)
      this.tweens.add({
        targets: ring,
        alpha: 0.25,
        scaleX: 1.18,
        scaleY: 1.18,
        duration: 800,
        yoyo: true,
        repeat: -1,
      })
    }

    if (isReachable) {
      const halo = this.add.graphics()
      halo.lineStyle(3, accent, 0.45)
      halo.strokeCircle(0, 0, r + 7)
      c.add(halo)
      this.tweens.add({ targets: halo, alpha: 0.15, duration: 650, yoyo: true, repeat: -1 })

      const hit = this.add.zone(0, 0, (r + 10) * 2, (r + 10) * 2).setInteractive({ useHandCursor: true })
      hit.on('pointerover', () => {
        getAudio().play('hover')
        c.setScale(1.12)
      })
      hit.on('pointerout', () => c.setScale(1))
      hit.on('pointerdown', () => {
        if (this.choosing) return
        this.choosing = true
        // Travelling between beacons IS a jump: sound + white flash for the FTL feel.
        getAudio().play('jump')
        this.cameras.main.flash(320, 255, 255, 255)
        getNet().socket.emit('run:choose_node', node.id)
        // Server replies with battle:start or run:state; routing navigates.
      })
      Tooltip.attach(hit, () =>
        revealed
          ? (NODE_TYPE_NAMES_ES[node.type] ?? node.type)
          : 'Baliza sin explorar — salta para descubrir qué hay.',
      )
      c.add(hit)
    }
    return c
  }

  /** Hand-drawn glyph per node type (shape-coded, not only color). */
  private drawNodeIcon(type: NodeType, color: number): Phaser.GameObjects.Container {
    const c = this.add.container(0, 0)
    const g = this.add.graphics()
    c.add(g)
    if (type === 'combat' || type === 'elite') {
      // Stylized crossed swords.
      g.lineStyle(2, color, 1)
      g.lineBetween(-7, 7, 7, -7)
      g.lineBetween(-7, -7, 7, 7)
      g.lineStyle(2, color, 0.8)
      g.lineBetween(-8, 2, -2, 8)
      g.lineBetween(8, 2, 2, 8)
      if (type === 'elite') {
        g.fillStyle(color, 1)
        g.fillCircle(0, -11, 2.5)
      }
    } else if (type === 'event') {
      c.add(this.add.text(0, 0, '?', textStyle('title', 18, color)).setOrigin(0.5))
    } else if (type === 'shop') {
      c.add(this.add.text(0, 0, '$', textStyle('title', 18, color)).setOrigin(0.5))
    } else if (type === 'boss') {
      // Fortress silhouette: block + antenna.
      g.fillStyle(color, 1)
      g.fillRect(-8, 0, 16, 8)
      g.fillRect(-3, -8, 6, 8)
      g.fillCircle(0, -11, 2)
      c.add(this.add.text(0, 18, 'JEFE', textStyle('title', 9, color)).setOrigin(0.5, 0))
    } else {
      g.fillStyle(color, 1)
      g.fillCircle(0, 0, 3)
    }
    return c
  }

  private renderLegend(dyn: Phaser.GameObjects.Container): void {
    const panel = new Panel(this, 12, GAME_HEIGHT - 76, 1010, 64)
    dyn.add(panel)
    const entries: { type: NodeType; label: string }[] = [
      { type: 'combat', label: 'Combate' },
      { type: 'elite', label: 'Élite (+botín)' },
      { type: 'event', label: 'Evento' },
      { type: 'shop', label: 'Tienda' },
      { type: 'boss', label: 'Jefe' },
    ]
    let x = 30
    for (const e of entries) {
      const style = NODE_STYLES[e.type]
      const mini = this.add.container(x, 32)
      const g = this.add.graphics()
      g.lineStyle(2, style.color, 1)
      if (style.shape === 'circle') g.strokeCircle(0, 0, 9)
      else if (style.shape === 'square') g.strokeRect(-8, -8, 16, 16)
      else if (style.shape === 'diamond') {
        g.strokePoints(
          [
            new Phaser.Math.Vector2(0, -9),
            new Phaser.Math.Vector2(9, 0),
            new Phaser.Math.Vector2(0, 9),
            new Phaser.Math.Vector2(-9, 0),
          ],
          true,
        )
      } else g.strokeTriangleShape(new Phaser.Geom.Triangle(-9, 7, 9, 7, 0, -9))
      mini.add(g)
      panel.add(mini)
      const label = this.add.text(x + 16, 24, e.label, textStyle('body', 13, COLORS.textDim))
      panel.add(label)
      x += 36 + label.width + 24
    }
    // Unexplored beacon entry.
    const unk = this.add.container(x, 32)
    const ug = this.add.graphics()
    ug.lineStyle(2, 0x6f8aa3, 1)
    ug.strokeCircle(0, 0, 9)
    unk.add(ug)
    unk.add(this.add.text(0, 0, '?', textStyle('title', 12, 0x9fb8cc)).setOrigin(0.5))
    panel.add(unk)
    const unkLabel = this.add.text(x + 16, 24, 'Sin explorar', textStyle('body', 13, COLORS.textDim))
    panel.add(unkLabel)
    x += 36 + unkLabel.width + 24
    panel.add(
      this.add.text(x + 6, 24, '· Elige un nodo conectado', textStyle('body', 13, COLORS.text)),
    )
  }

  private confirmAbandon(): void {
    const c = this.add.container(0, 0).setDepth(5000)
    c.add(
      this.add
        .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6)
        .setInteractive(),
    )
    const panel = new Panel(this, GAME_WIDTH / 2 - 250, GAME_HEIGHT / 2 - 95, 500, 190, {
      title: 'ABANDONAR EXPEDICIÓN',
    })
    c.add(panel)
    c.add(
      this.add
        .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 25, '¿Seguro? Perderás todo el progreso de esta run.', textStyle('body', 15))
        .setOrigin(0.5),
    )
    c.add(
      new Button(this, GAME_WIDTH / 2 - 115, GAME_HEIGHT / 2 + 40, 'ABANDONAR', () => {
        getNet().socket.emit('run:abandon')
        // run:over arrives next; global routing returns to the main menu.
      }, { width: 200, height: 44, fontSize: 15, variant: 'danger' }),
    )
    c.add(
      new Button(this, GAME_WIDTH / 2 + 115, GAME_HEIGHT / 2 + 40, 'CANCELAR', () => {
        c.destroy()
      }, { width: 200, height: 44, fontSize: 15, variant: 'ghost' }),
    )
  }
}
