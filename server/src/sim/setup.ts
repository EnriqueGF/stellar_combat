// ShipSetup factories: from a player loadout (duel / fresh expedition) and from an
// NPC template. Pure data construction; BattleSim consumes the result.

import { CREW_CLASSES, CREW_NAMES, SHIPS, STARTING_AMMO, nextId } from '@stellar/shared'
import type { CrewClassId, Loadout, NpcTemplate } from '@stellar/shared'
import type { CrewSetup, ShipSetup } from './api'

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function makeCrew(classes: CrewClassId[], nameSeed: string): CrewSetup[] {
  const offset = hashString(nameSeed) % CREW_NAMES.length
  return classes.map((cls, i) => {
    const def = CREW_CLASSES[cls]
    const hpMax = def.hpMax[0]
    return {
      id: nextId('crew'),
      name: CREW_NAMES[(offset + i) % CREW_NAMES.length] ?? def.name,
      cls,
      level: 1 as const,
      xp: 0,
      hp: hpMax,
      hpMax,
    }
  })
}

export function setupFromLoadout(loadout: Loadout, name: string): ShipSetup {
  const ship = SHIPS[loadout.ship]
  return {
    shipClass: loadout.ship,
    name,
    hull: ship.hullMax,
    hullMax: ship.hullMax,
    reactor: ship.reactor,
    systems: { ...ship.systems },
    weapons: [...loadout.weapons],
    drones: [...loadout.drones],
    defenseModule: loadout.defenseModule,
    crew: makeCrew(loadout.crew, `${name}:${loadout.ship}`),
    ammo: STARTING_AMMO,
  }
}

export function setupFromNpc(template: NpcTemplate): ShipSetup {
  return {
    shipClass: template.shipClass,
    name: template.name,
    hull: template.hull,
    hullMax: template.hull,
    reactor: template.reactor,
    systems: { ...template.systems },
    weapons: [...template.weapons],
    drones: [...template.drones],
    defenseModule: template.defenseModule,
    crew: makeCrew(template.crew, template.name),
    ammo: STARTING_AMMO,
    boss: template.shipClass === 'hegemon',
  }
}
