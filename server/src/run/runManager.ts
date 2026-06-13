// Expedition run state (GAME_SPEC §4.1): persists the player's ship between
// battles, owns the sector graph, events, shop offers and the upgrade economy.
// All randomness flows through the run's seeded mulberry32 RNG.

import {
  COST_AMMO_PER_2,
  COST_REACTOR,
  COST_REPAIR_PER_POINT,
  COST_SYSTEM_BASE,
  COST_SYSTEM_PER_LEVEL,
  CREW_CLASSES,
  CREW_NAMES,
  CREW_SIZE,
  DRONE_IDS,
  ELITE_LOOT_MULT,
  GAME_EVENTS,
  MAX_AMMO,
  MAX_DRONES_EQUIPPED,
  NPC_TEMPLATES,
  REACTOR_MAX,
  SCRAP_BASE,
  SCRAP_PER_COLUMN,
  SCRAP_RANDOM,
  SHIPS,
  SYSTEM_MAX_LEVEL,
  WEAPONS,
  WEAPON_DROP_CHANCE,
  WEAPON_IDS,
  clamp,
  mulberry32,
  nextId,
  pickWeighted,
  type CrewClassId,
  type DefenseModuleId,
  type DroneId,
  type GameEventDef,
  type NpcTemplate,
  type RunStatePublic,
  type RunUpgradeCosts,
  type SectorMap,
  type SectorNode,
  type ShipClassId,
  type ShopOffer,
  type SystemId,
  type UpgradeItem,
  type WeaponId,
} from '@stellar/shared'
import type { CrewSetup, ShipSetup } from '../sim/api'
import { generateSector } from './sector'

const SYSTEM_IDS: SystemId[] = ['weapons', 'shields', 'engines', 'oxygen', 'medbay', 'cockpit', 'drones']
/** Last template index usable by regular/elite/ambush fights (the final one is the boss). */
const MAX_NON_BOSS_TEMPLATE = NPC_TEMPLATES.length - 2

export type NodeEntry =
  | { kind: 'battle'; template: NpcTemplate; elite: boolean; boss: boolean; firstBattle: boolean }
  | { kind: 'screen' }
  | { kind: 'invalid' }

export type BuyOutcome = { ok: true } | { ok: false; code: 'cannot_afford' | 'bad_intent'; msg: string }

export class RunManager {
  readonly rng: () => number
  readonly sector: SectorMap

  inBattle = false

  private currentNodeId: number
  private scrap = 0
  private hull: number
  private readonly hullMax: number
  private reactor: number
  private ammo: number
  private readonly shipClass: ShipClassId
  private readonly shipName: string
  private systems: Partial<Record<SystemId, number>>
  private weapons: WeaponId[]
  private drones: DroneId[]
  private readonly defenseModule: DefenseModuleId
  private crew: CrewSetup[]
  private lootWeapon: WeaponId | null = null
  private shopOffers: ShopOffer[] | null = null
  private event: GameEventDef | null = null
  private eventResult: string | null = null
  private readonly usedEventIds = new Set<string>()
  private alive = true
  private victory = false

  constructor(setup: ShipSetup, seed: number) {
    this.rng = mulberry32(seed)
    this.sector = generateSector(this.rng)
    this.currentNodeId = this.sector.startNodeId
    this.shipClass = setup.shipClass
    this.shipName = setup.name
    this.hull = setup.hull
    this.hullMax = setup.hullMax
    this.reactor = setup.reactor
    this.ammo = setup.ammo
    this.systems = { ...setup.systems }
    this.weapons = [...setup.weapons]
    this.drones = [...setup.drones]
    this.defenseModule = setup.defenseModule
    this.crew = setup.crew.map((c) => ({ ...c }))
  }

  get isAlive(): boolean {
    return this.alive
  }

  get scrapTotal(): number {
    return this.scrap
  }

  get column(): number {
    return this.currentNode().col
  }

  currentNode(): SectorNode {
    const direct = this.sector.nodes[this.currentNodeId]
    if (direct && direct.id === this.currentNodeId) return direct
    const found = this.sector.nodes.find((n) => n.id === this.currentNodeId)
    if (!found) throw new Error('run is on a node that does not exist')
    return found
  }

  /** Moves to a node reachable from the current one and reports what happens there. */
  enterNode(nodeId: number): NodeEntry {
    if (this.inBattle || !this.alive) return { kind: 'invalid' }
    if (!this.currentNode().edges.includes(nodeId)) return { kind: 'invalid' }
    const node = this.sector.nodes.find((n) => n.id === nodeId)
    if (!node) return { kind: 'invalid' }

    this.currentNodeId = nodeId
    this.event = null
    this.eventResult = null
    this.shopOffers = null

    switch (node.type) {
      case 'combat':
        return {
          kind: 'battle',
          template: this.templateAt(clamp(node.col - 1, 0, MAX_NON_BOSS_TEMPLATE)),
          elite: false,
          boss: false,
          firstBattle: node.col === 1,
        }
      case 'elite':
        // Elite at column c uses the template of column c+1 (GAME_SPEC §4.1).
        return {
          kind: 'battle',
          template: this.templateAt(clamp(node.col, 0, MAX_NON_BOSS_TEMPLATE)),
          elite: true,
          boss: false,
          firstBattle: false,
        }
      case 'boss':
        return {
          kind: 'battle',
          template: this.templateAt(NPC_TEMPLATES.length - 1),
          elite: false,
          boss: true,
          firstBattle: false,
        }
      case 'event':
        this.event = this.pickEvent()
        return { kind: 'screen' }
      case 'shop':
        this.shopOffers = this.generateShop(node.col)
        return { kind: 'screen' }
      case 'start':
        return { kind: 'invalid' }
    }
  }

  /** NPC for a reconnect ambush: regular template of the current column. */
  ambushTemplate(): NpcTemplate {
    return this.templateAt(clamp(this.column - 1, 0, MAX_NON_BOSS_TEMPLATE))
  }

  /** Ship setup for the next battle, straight from the persisted run state. */
  playerSetup(): ShipSetup {
    return {
      shipClass: this.shipClass,
      name: this.shipName,
      hull: this.hull,
      hullMax: this.hullMax,
      reactor: this.reactor,
      systems: { ...this.systems },
      weapons: [...this.weapons],
      drones: [...this.drones],
      defenseModule: this.defenseModule,
      crew: this.crew.map((c) => ({ ...c })),
      ammo: this.ammo,
    }
  }

  /**
   * Persists battle outcome. System damage is considered fully repaired between
   * nodes (crew would repair it anyway); hull and crew HP carry over as-is.
   */
  absorbBattleState(hull: number, ammo: number, crew: CrewSetup[]): void {
    this.hull = clamp(hull, 1, this.hullMax)
    this.ammo = clamp(Math.floor(ammo), 0, MAX_AMMO)
    this.crew = crew.filter((c) => c.hp > 0).map((c) => ({ ...c }))
  }

  /** Post-victory loot: scrap + 0-2 missiles + WEAPON_DROP_CHANCE of a loot weapon. */
  applyVictoryLoot(elite: boolean): void {
    let scrap = SCRAP_BASE + Math.floor(this.rng() * (SCRAP_RANDOM + 1)) + SCRAP_PER_COLUMN * this.column
    if (elite) scrap = Math.round(scrap * ELITE_LOOT_MULT)
    this.scrap += scrap
    this.ammo = clamp(this.ammo + Math.floor(this.rng() * 3), 0, MAX_AMMO)
    if (this.rng() < WEAPON_DROP_CHANCE) this.lootWeapon = this.randomWeapon()
  }

  markDefeat(): void {
    this.alive = false
  }

  markVictory(): void {
    this.victory = true
  }

  /** Resolves an event choice with pickWeighted. 'dead' = the whole crew is gone. */
  resolveEventChoice(choiceIdx: number): 'ok' | 'dead' | 'invalid' {
    if (this.inBattle || !this.alive || !this.event) return 'invalid'
    const choice = this.event.choices[choiceIdx]
    if (!choice) return 'invalid'
    const outcome = choice.outcomes[pickWeighted(choice.outcomes.map((o) => o.weight), this.rng())]
    if (!outcome) return 'invalid'

    let text = outcome.text
    if (outcome.scrap) this.scrap = Math.max(0, this.scrap + outcome.scrap)
    // Event hull damage can cripple but never destroy the ship (clamped to 1).
    if (outcome.hull) this.hull = clamp(this.hull + outcome.hull, 1, this.hullMax)
    if (outcome.ammo) this.ammo = clamp(this.ammo + outcome.ammo, 0, MAX_AMMO)
    if (outcome.weaponReward) {
      this.lootWeapon = this.randomWeapon()
      text += ` (${WEAPONS[this.lootWeapon].name} disponible gratis en la pantalla de mejora.)`
    }
    if (outcome.crewDamage) {
      const living = this.crew.filter((c) => c.hp > 0)
      const victim = living[Math.floor(this.rng() * living.length)]
      if (victim) {
        victim.hp -= outcome.crewDamage
        if (victim.hp <= 0) {
          this.crew = this.crew.filter((c) => c !== victim)
          text += ` ${victim.name} ha muerto.`
        } else {
          text += ` ${victim.name} resulta herido.`
        }
      }
    }
    this.eventResult = text
    if (this.crew.length === 0) {
      this.alive = false
      return 'dead'
    }
    return 'ok'
  }

  buy(item: UpgradeItem): BuyOutcome {
    if (this.inBattle || !this.alive) return bad('Ahora mismo no puedes comprar.')
    switch (item.kind) {
      case 'reactor': {
        if (this.reactor >= REACTOR_MAX) return bad('Reactor al máximo.')
        return this.pay(this.upgradeCosts().reactor, () => {
          this.reactor += 1
        })
      }
      case 'system': {
        const level = this.systems[item.system]
        if (level === undefined) return bad('Ese sistema no está instalado.')
        if (level >= (SYSTEM_MAX_LEVEL[item.system] ?? 8)) return bad('Sistema al nivel máximo.')
        return this.pay(this.upgradeCosts().system[item.system], () => {
          this.systems[item.system] = level + 1
        })
      }
      case 'repair': {
        const missing = this.hullMax - this.hull
        const points = Math.min(Math.floor(item.points), Math.ceil(missing))
        if (!Number.isFinite(points) || points < 1) return bad('Nada que reparar.')
        return this.pay(points * COST_REPAIR_PER_POINT, () => {
          this.hull = clamp(this.hull + points, 1, this.hullMax)
        })
      }
      case 'ammo': {
        if (this.ammo >= MAX_AMMO) return bad('Munición al máximo.')
        return this.pay(COST_AMMO_PER_2, () => {
          this.ammo = clamp(this.ammo + 2, 0, MAX_AMMO)
        })
      }
      case 'loot_weapon': {
        // Battle drops and event rewards are claimed for FREE on the upgrade screen
        // ("buying" them only consumes a weapon slot, not scrap).
        const weapon = this.lootWeapon
        if (!weapon) return bad('No hay ningún arma pendiente de recoger.')
        if (this.weapons.length >= SHIPS[this.shipClass].weaponSlots)
          return bad('Sin soportes de arma libres.')
        this.weapons.push(weapon)
        this.lootWeapon = null
        return { ok: true }
      }
      case 'shop':
        return this.buyShopOffer(item.index)
      default:
        return bad('Compra desconocida.')
    }
  }

  /** Leaves the current event/shop/upgrade screen. Unclaimed loot weapons are forfeited. */
  continueRun(): void {
    if (this.inBattle) return
    this.event = null
    this.eventResult = null
    this.shopOffers = null
    this.lootWeapon = null
  }

  publicState(): RunStatePublic {
    return {
      sector: this.sector,
      currentNodeId: this.currentNodeId,
      column: this.column,
      scrap: this.scrap,
      hull: this.hull,
      hullMax: this.hullMax,
      reactor: this.reactor,
      ammo: this.ammo,
      shipClass: this.shipClass,
      systems: { ...this.systems },
      weapons: [...this.weapons],
      drones: [...this.drones],
      defenseModule: this.defenseModule,
      crew: this.crew.map((c) => ({ ...c })),
      upgradeCosts: this.upgradeCosts(),
      lootWeapon: this.lootWeapon,
      shopOffers: this.shopOffers ? this.shopOffers.map((o) => ({ ...o })) : null,
      event: this.event,
      eventResult: this.eventResult,
      alive: this.alive,
      victory: this.victory,
    }
  }

  // -------------------------------------------------------------------------

  private templateAt(index: number): NpcTemplate {
    const template = NPC_TEMPLATES[clamp(index, 0, NPC_TEMPLATES.length - 1)]
    if (!template) throw new Error('NPC template table is empty')
    return template
  }

  /** Random event not yet seen this run (if all were seen, the pool resets). */
  private pickEvent(): GameEventDef {
    let pool = GAME_EVENTS.filter((e) => !this.usedEventIds.has(e.id))
    if (pool.length === 0) {
      this.usedEventIds.clear()
      pool = [...GAME_EVENTS]
    }
    const event = pool[Math.floor(this.rng() * pool.length)] ?? GAME_EVENTS[0]
    if (!event) throw new Error('event table is empty')
    this.usedEventIds.add(event.id)
    return event
  }

  /**
   * 4-6 offers. Prices: weapon 45+10*col (scales with depth), drone 30+5*col,
   * crew hire flat 60; ammo/repair match the upgrade-screen per-unit rates.
   */
  private generateShop(col: number): ShopOffer[] {
    const offers: ShopOffer[] = []
    const weaponPrice = 45 + 10 * col
    offers.push({ kind: 'weapon', id: this.randomWeapon(), price: weaponPrice })
    if (this.rng() < 0.5) offers.push({ kind: 'weapon', id: this.randomWeapon(), price: weaponPrice })
    offers.push({ kind: 'ammo', amount: 2, price: COST_AMMO_PER_2 })
    offers.push({ kind: 'repair', amount: 5, price: 5 * COST_REPAIR_PER_POINT })
    const droneChoices = DRONE_IDS.filter((d) => !this.drones.includes(d))
    const drone = droneChoices[Math.floor(this.rng() * droneChoices.length)]
    if (drone && this.drones.length < MAX_DRONES_EQUIPPED) {
      offers.push({ kind: 'drone', id: drone, price: 30 + 5 * col })
    } else {
      offers.push({ kind: 'ammo', amount: 4, price: 2 * COST_AMMO_PER_2 })
    }
    if (this.crew.length < CREW_SIZE && this.rng() < 0.5) {
      const cls = Object.keys(CREW_CLASSES)[Math.floor(this.rng() * Object.keys(CREW_CLASSES).length)] as
        | CrewClassId
        | undefined
      offers.push({ kind: 'crew', id: cls ?? 'engineer', price: 60 })
    }
    return offers
  }

  private buyShopOffer(index: number): BuyOutcome {
    const offers = this.shopOffers
    const offer = offers?.[index]
    if (!offers || !offer) return bad('Esa oferta ya no está disponible.')
    const consume = (): void => {
      offers.splice(offers.indexOf(offer), 1)
    }
    switch (offer.kind) {
      case 'weapon': {
        if (this.weapons.length >= SHIPS[this.shipClass].weaponSlots)
          return bad('Sin soportes de arma libres.')
        return this.pay(offer.price, () => {
          this.weapons.push(offer.id as WeaponId)
          consume()
        })
      }
      case 'drone': {
        const id = offer.id as DroneId
        if (this.drones.length >= MAX_DRONES_EQUIPPED || this.drones.includes(id))
          return bad('No puedes equipar ese dron.')
        return this.pay(offer.price, () => {
          this.drones.push(id)
          consume()
        })
      }
      case 'ammo':
        if (this.ammo >= MAX_AMMO) return bad('Munición al máximo.')
        return this.pay(offer.price, () => {
          this.ammo = clamp(this.ammo + (offer.amount ?? 2), 0, MAX_AMMO)
          consume()
        })
      case 'repair':
        if (this.hull >= this.hullMax) return bad('El casco está intacto.')
        return this.pay(offer.price, () => {
          this.hull = clamp(this.hull + (offer.amount ?? 1), 1, this.hullMax)
          consume()
        })
      case 'crew': {
        if (this.crew.length >= CREW_SIZE) return bad('La tripulación está completa.')
        return this.pay(offer.price, () => {
          this.crew.push(this.hireCrew(offer.id as CrewClassId))
          consume()
        })
      }
      default:
        return bad('Oferta desconocida.')
    }
  }

  private pay(cost: number, apply: () => void): BuyOutcome {
    if (this.scrap < cost)
      return { ok: false, code: 'cannot_afford', msg: `Necesitas ${cost} de chatarra.` }
    this.scrap -= cost
    apply()
    return { ok: true }
  }

  /** Costs with the ship's upgradeDiscount applied (vanguard weapons / bastion reactor). */
  private upgradeCosts(): RunUpgradeCosts {
    const discount = SHIPS[this.shipClass].upgradeDiscount
    const reactorMult = discount?.kind === 'reactor' ? discount.mult : 1
    const system = {} as Record<SystemId, number>
    for (const id of SYSTEM_IDS) {
      const level = this.systems[id] ?? 0
      const mult = discount?.kind === 'weapons' && id === 'weapons' ? discount.mult : 1
      system[id] = Math.round((COST_SYSTEM_BASE + COST_SYSTEM_PER_LEVEL * level) * mult)
    }
    return {
      reactor: Math.round(COST_REACTOR * reactorMult),
      system,
      repairPerPoint: COST_REPAIR_PER_POINT,
      ammoPer2: COST_AMMO_PER_2,
    }
  }

  private randomWeapon(): WeaponId {
    return WEAPON_IDS[Math.floor(this.rng() * WEAPON_IDS.length)] ?? 'laser_light'
  }

  private hireCrew(cls: CrewClassId): CrewSetup {
    const used = new Set(this.crew.map((c) => c.name))
    const free = CREW_NAMES.filter((n) => !used.has(n))
    const name = free[Math.floor(this.rng() * free.length)] ?? `Recluta ${this.crew.length + 1}`
    const hp = CREW_CLASSES[cls].hpMax[0]
    return { id: nextId('crew'), name, cls, level: 1, xp: 0, hp, hpMax: hp }
  }
}

function bad(msg: string): BuyOutcome {
  return { ok: false, code: 'bad_intent', msg }
}
