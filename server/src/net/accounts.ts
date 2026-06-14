// Optional accounts: username + password, hashed with scrypt and persisted to a
// SQLite database (node:sqlite, zero-dependency, ships with Node 24). Guests keep
// playing without one; an account just adds a persistent profile with lifetime
// stats. Reads are served from in-memory maps loaded once on construction; every
// mutation writes through to the DB immediately so nothing is lost on a crash.

import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import type { AccountStats, AuthResult, Profile } from '@stellar/shared'

const USERNAME_RE = /^[\p{L}\p{N} _.-]{3,16}$/u
const MIN_PASSWORD = 6
const SCRYPT_KEYLEN = 32

interface AccountRecord {
  id: string
  /** Lowercased unique key. */
  key: string
  displayName: string
  salt: string
  hash: string
  token: string
  createdAt: number
  stats: AccountStats
}

/** Row shape as stored in SQLite (stats live in a single JSON blob column). */
interface AccountRow {
  id: string
  key: string
  displayName: string
  salt: string
  hash: string
  token: string
  createdAt: number
  stats: string
}

function emptyStats(): AccountStats {
  return {
    runsStarted: 0,
    runsWon: 0,
    bestColumn: 0,
    battlesWon: 0,
    battlesLost: 0,
    duelsWon: 0,
    duelsLost: 0,
    scrapEarned: 0,
    crewLost: 0,
  }
}

function toProfile(rec: AccountRecord): Profile {
  return { username: rec.displayName, createdAt: rec.createdAt, stats: { ...rec.stats } }
}

export class AccountStore {
  private readonly byId = new Map<string, AccountRecord>()
  private readonly byKey = new Map<string, string>()
  private readonly byToken = new Map<string, string>()
  private readonly db: DatabaseSync
  private readonly insertStmt
  private readonly updateStatsStmt

  /**
   * @param dir Directory for the `accounts.db` file, or `':memory:'` for an
   *   ephemeral in-memory database (tests). Defaults to `server/data`.
   */
  constructor(dir?: string) {
    const baseDir =
      dir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data')

    let dbPath: string
    if (baseDir === ':memory:') {
      dbPath = ':memory:'
    } else {
      mkdirSync(baseDir, { recursive: true })
      dbPath = path.join(baseDir, 'accounts.db')
    }

    this.db = new DatabaseSync(dbPath)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id          TEXT PRIMARY KEY,
        key         TEXT NOT NULL UNIQUE,
        displayName TEXT NOT NULL,
        salt        TEXT NOT NULL,
        hash        TEXT NOT NULL,
        token       TEXT NOT NULL,
        createdAt   INTEGER NOT NULL,
        stats       TEXT NOT NULL
      )
    `)

    this.insertStmt = this.db.prepare(
      `INSERT INTO accounts (id, key, displayName, salt, hash, token, createdAt, stats)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    this.updateStatsStmt = this.db.prepare(`UPDATE accounts SET stats = ? WHERE id = ?`)

    this.load(baseDir)
  }

  // --- auth ---------------------------------------------------------------

  register(username: string, password: string): AuthResult {
    const name = typeof username === 'string' ? username.trim() : ''
    if (!USERNAME_RE.test(name)) {
      return { ok: false, error: 'El usuario debe tener 3-16 caracteres (letras, números, _ . -).' }
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
      return { ok: false, error: `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.` }
    }
    const key = name.toLowerCase()
    if (this.byKey.has(key)) return { ok: false, error: 'Ese nombre de usuario ya está en uso.' }

    const salt = randomBytes(16).toString('hex')
    const rec: AccountRecord = {
      id: randomUUID(),
      key,
      displayName: name,
      salt,
      hash: this.hash(password, salt),
      token: randomUUID(),
      createdAt: Date.now(),
      stats: emptyStats(),
    }
    this.insert(rec)
    return { ok: true, token: rec.token, profile: toProfile(rec) }
  }

  login(username: string, password: string): AuthResult {
    const key = typeof username === 'string' ? username.trim().toLowerCase() : ''
    const rec = this.recordByKey(key)
    if (!rec || typeof password !== 'string' || !this.verify(password, rec)) {
      return { ok: false, error: 'Usuario o contraseña incorrectos.' }
    }
    return { ok: true, token: rec.token, profile: toProfile(rec) }
  }

  /** Re-binds from a stored token (reconnect). */
  resume(token: string): AuthResult {
    const rec = this.recordByToken(token)
    if (!rec) return { ok: false, error: 'Sesión expirada. Vuelve a iniciar sesión.' }
    return { ok: true, token: rec.token, profile: toProfile(rec) }
  }

  // --- reads / writes ------------------------------------------------------

  accountIdForToken(token: string | null | undefined): string | null {
    if (!token) return null
    return this.byToken.get(token) ?? null
  }

  displayName(accountId: string): string | null {
    return this.byId.get(accountId)?.displayName ?? null
  }

  profile(accountId: string): Profile | null {
    const rec = this.byId.get(accountId)
    return rec ? toProfile(rec) : null
  }

  /** Mutates an account's stats and persists immediately. No-op for unknown ids. */
  updateStats(accountId: string | null, fn: (s: AccountStats) => void): void {
    if (!accountId) return
    const rec = this.byId.get(accountId)
    if (!rec) return
    fn(rec.stats)
    try {
      this.updateStatsStmt.run(JSON.stringify(rec.stats), rec.id)
    } catch {
      // Disk/DB hiccup: keep the in-memory mutation so the session stays consistent.
    }
  }

  // --- internals -----------------------------------------------------------

  private hash(password: string, salt: string): string {
    return scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex')
  }

  private verify(password: string, rec: AccountRecord): boolean {
    const candidate = Buffer.from(this.hash(password, rec.salt), 'hex')
    const known = Buffer.from(rec.hash, 'hex')
    return candidate.length === known.length && timingSafeEqual(candidate, known)
  }

  private recordByKey(key: string): AccountRecord | undefined {
    const id = this.byKey.get(key)
    return id ? this.byId.get(id) : undefined
  }

  private recordByToken(token: string): AccountRecord | undefined {
    const id = this.byToken.get(token)
    return id ? this.byId.get(id) : undefined
  }

  /** Mirrors a record into the in-memory indexes (no DB write). */
  private index(rec: AccountRecord): void {
    this.byId.set(rec.id, rec)
    this.byKey.set(rec.key, rec.id)
    this.byToken.set(rec.token, rec.id)
  }

  /** Indexes a brand-new record and persists it to the DB. */
  private insert(rec: AccountRecord): void {
    this.index(rec)
    this.insertStmt.run(
      rec.id,
      rec.key,
      rec.displayName,
      rec.salt,
      rec.hash,
      rec.token,
      rec.createdAt,
      JSON.stringify(rec.stats),
    )
  }

  private rowToRecord(row: AccountRow): AccountRecord {
    let stats: AccountStats
    try {
      // Backfill any stats fields added after the row was written.
      stats = { ...emptyStats(), ...(JSON.parse(row.stats) as Partial<AccountStats>) }
    } catch {
      stats = emptyStats()
    }
    return {
      id: row.id,
      key: row.key,
      displayName: row.displayName,
      salt: row.salt,
      hash: row.hash,
      token: row.token,
      createdAt: row.createdAt,
      stats,
    }
  }

  private load(baseDir: string): void {
    for (const row of this.db.prepare('SELECT * FROM accounts').all() as unknown as AccountRow[]) {
      this.index(this.rowToRecord(row))
    }
    // One-time migration: import a legacy accounts.json if the DB is still empty.
    if (this.byId.size === 0 && baseDir !== ':memory:') {
      this.importLegacyJson(path.join(baseDir, 'accounts.json'))
    }
  }

  /** Imports records from the old flat-file store exactly once. Safe to no-op. */
  private importLegacyJson(file: string): void {
    try {
      if (!existsSync(file)) return
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { accounts?: AccountRecord[] }
      for (const rec of raw.accounts ?? []) {
        if (!rec?.id || !rec.key || this.byKey.has(rec.key)) continue
        this.insert({ ...rec, stats: { ...emptyStats(), ...rec.stats } })
      }
    } catch {
      // Corrupt or unreadable legacy file: skip migration rather than crash.
    }
  }

  /** Closes the database handle (server shutdown). */
  close(): void {
    this.db.close()
  }
}
