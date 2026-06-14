// End-to-end socket test: session -> expedition -> first battle -> intents ->
// surrender -> run over. Runs the real app (ephemeral port) with a real client.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AddressInfo } from 'node:net'
import { io as ioClient, type Socket } from 'socket.io-client'
import {
  LOADOUT_PRESETS,
  type BattleSnapshot,
  type ClientToServerEvents,
  type ErrorMsg,
  type ServerToClientEvents,
} from '@stellar/shared'
import { createApp } from '../src/app'

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>

function waitFor<K extends keyof ServerToClientEvents>(
  socket: TestSocket,
  event: K,
  timeoutMs = 5000,
): Promise<Parameters<ServerToClientEvents[K]>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout esperando ${String(event)}`)),
      timeoutMs,
    )
    const handler = (...args: unknown[]): void => {
      clearTimeout(timer)
      resolve(args as Parameters<ServerToClientEvents[K]>)
    }
    socket.once(event, handler as never)
  })
}

test('expedition end-to-end over sockets', async () => {
  const bundle = createApp()
  await new Promise<void>((resolve) => {
    bundle.httpServer.listen(0, resolve)
  })
  const address = bundle.httpServer.address() as AddressInfo
  const socket: TestSocket = ioClient(`http://127.0.0.1:${address.port}`, {
    transports: ['websocket'],
    forceNew: true,
  })
  const serverErrors: ErrorMsg[] = []
  socket.on('error', (err) => serverErrors.push(err))

  try {
    // session:hello returns a fresh token via callback.
    const token = await new Promise<string>((resolve) => {
      socket.emit('session:hello', null, resolve)
    })
    assert.ok(token.length > 10, 'session token issued')

    // queue:join expedition with a valid preset -> run:state with the sector map.
    const preset = LOADOUT_PRESETS.sentinel[0]
    assert.ok(preset, 'sentinel preset exists')
    const runStateP = waitFor(socket, 'run:state')
    socket.emit('queue:join', 'expedition', preset.loadout)
    const [run] = await runStateP
    assert.equal(run.alive, true)
    assert.equal(run.currentNodeId, run.sector.startNodeId)

    const startNode = run.sector.nodes.find((n) => n.id === run.sector.startNodeId)
    assert.ok(startNode, 'start node present')
    const introId = startNode.edges[0]
    assert.ok(introId !== undefined, 'start node has an outgoing edge')
    const intro = run.sector.nodes.find((n) => n.id === introId)
    assert.ok(intro, 'intro node present')
    assert.equal(intro.col, 1)
    assert.equal(intro.type, 'combat')

    // Choosing the column-1 node opens the narrated first-contact encounter,
    // which names the hostile ship before any shooting.
    const encounterP = waitFor(socket, 'run:state')
    socket.emit('run:choose_node', intro.id)
    const [enc] = await encounterP
    assert.ok(enc.event, 'first combat shows a pre-battle encounter')
    assert.equal(enc.event.combat, true)
    assert.ok(
      enc.event.enemyName !== undefined && enc.event.enemyName.length > 0,
      'the encounter names the enemy ship',
    )

    // Confirming the encounter ("A las armas") starts the guaranteed intro battle.
    const battleStartP = waitFor(socket, 'battle:start')
    socket.emit('run:event_choice', 0)
    const [start] = await battleStartP
    assert.equal(start.mode, 'expedition')
    assert.equal(start.side, 'a')
    assert.equal(start.vsNpc, true)
    assert.equal(start.firstBattle, true)
    assert.ok(start.snapshot.you.hull > 0)
    assert.ok(start.snapshot.enemy.hull > 0)

    // Snapshots flow at 10 Hz with advancing ticks.
    const snaps: BattleSnapshot[] = []
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no llegan snapshots')), 5000)
      const onSnap = (snap: BattleSnapshot): void => {
        snaps.push(snap)
        if (snaps.length >= 3) {
          clearTimeout(timer)
          socket.off('battle:snapshot', onSnap)
          resolve()
        }
      }
      socket.on('battle:snapshot', onSnap)
    })
    const first = snaps[0]
    const last = snaps[snaps.length - 1]
    assert.ok(first && last && last.tick > first.tick, 'ticks advance across snapshots')

    // Intents: power weapons and target the first enemy room; verify they land.
    const enemyRoom = start.snapshot.enemy.rooms[0]
    assert.ok(enemyRoom, 'enemy has rooms')
    socket.emit('battle:set_power', 'weapons', 3)
    socket.emit('battle:set_target', 0, enemyRoom.id)
    let applied: BattleSnapshot | null = null
    for (let i = 0; i < 10 && !applied; i++) {
      const [snap] = await waitFor(socket, 'battle:snapshot')
      const weapons = snap.you.systems.find((s) => s.id === 'weapons')
      const slot0 = snap.you.weapons[0]
      if (weapons?.power === 3 && slot0?.targetRoomId === enemyRoom.id) applied = snap
    }
    assert.ok(applied, 'set_power and set_target reflected in snapshots')

    // Surrender ends the battle and (expedition defeat) the whole run.
    const endP = waitFor(socket, 'battle:end')
    const overP = waitFor(socket, 'run:over')
    socket.emit('battle:surrender')
    const [result, side] = await endP
    assert.equal(side, 'a')
    assert.equal(result.winner, 'b')
    assert.equal(result.reason, 'surrender')
    const [victory, summary] = await overP
    assert.equal(victory, false)
    assert.equal(summary.column, 1)

    assert.deepEqual(serverErrors, [], 'no error events from the server')
  } finally {
    socket.disconnect()
    bundle.close()
    await new Promise<void>((resolve) => {
      bundle.httpServer.close(() => resolve())
    })
  }
})
