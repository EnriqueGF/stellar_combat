import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AccountStore } from '../src/net/accounts'

test('accounts: register/login, reject bad input and duplicates, persist stats to SQLite', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sc-acc-'))
  try {
    const store = new AccountStore(dir)

    const reg = store.register('Vega', 'secret123')
    assert.equal(reg.ok, true)
    assert.ok(reg.token)
    assert.equal(reg.profile?.username, 'Vega')

    // Duplicate (case-insensitive), weak password and too-short username are rejected.
    assert.equal(store.register('vega', 'other123').ok, false)
    assert.equal(store.register('Otra', '123').ok, false)
    assert.equal(store.register('a', 'secret123').ok, false)

    // Login: right password works; wrong password / unknown user fail.
    assert.equal(store.login('vega', 'secret123').ok, true)
    assert.equal(store.login('vega', 'WRONG').ok, false)
    assert.equal(store.login('nadie', 'secret123').ok, false)

    // Token resolves to the account; stats mutate.
    const id = store.accountIdForToken(reg.token)
    assert.ok(id)
    store.updateStats(id, (s) => {
      s.runsWon += 2
      s.bestColumn = 5
    })
    assert.equal(store.profile(id ?? '')?.stats.runsWon, 2)
    store.close() // flush + close the DB handle

    // A fresh store reloads the account, its stats and its token from the DB file.
    const store2 = new AccountStore(dir)
    assert.equal(store2.login('vega', 'secret123').ok, true)
    const id2 = store2.accountIdForToken(reg.token)
    assert.ok(id2)
    assert.equal(store2.profile(id2 ?? '')?.stats.runsWon, 2)
    assert.equal(store2.profile(id2 ?? '')?.stats.bestColumn, 5)
    assert.equal(store2.resume(reg.token ?? '').ok, true)
    store2.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('accounts: in-memory DB keeps data isolated and supports the full API', () => {
  const store = new AccountStore(':memory:')
  try {
    const reg = store.register('Nova', 'hunter2x')
    assert.equal(reg.ok, true)
    const id = store.accountIdForToken(reg.token)
    assert.ok(id)
    assert.equal(store.displayName(id ?? ''), 'Nova')

    // Duplicate username is rejected once persisted.
    assert.equal(store.register('NOVA', 'another1').ok, false)

    store.updateStats(id, (s) => {
      s.duelsWon += 3
    })
    assert.equal(store.profile(id ?? '')?.stats.duelsWon, 3)
    // No-op for unknown / null ids.
    store.updateStats(null, (s) => (s.duelsWon = 99))
    store.updateStats('missing', (s) => (s.duelsWon = 99))
    assert.equal(store.profile(id ?? '')?.stats.duelsWon, 3)
  } finally {
    store.close()
  }
})
