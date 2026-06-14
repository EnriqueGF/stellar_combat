// ShipSetup factories: from a player loadout (duel / fresh expedition) and from an
// NPC template. Pure data construction; BattleSim consumes the result.

import { CREW_NAMES, SHIPS, STARTING_AMMO, crewHpMax, defaultRaceForIndex, nextId } from '@stellar/shared'
import type { CrewClassId, CrewRaceId, Loadout, NpcTemplate } from '@stellar/shared'
import type { BattleMod, CrewSetup, ShipSetup } from './api'

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function makeCrew(classes: CrewClassId[], nameSeed: string, races?: CrewRaceId[]): CrewSetup[] {
  const offset = hashString(nameSeed) % CREW_NAMES.length
  // No explicit species -> a varied default rotated by the name seed so different
  // ships look different.
  const raceOffset = hashString(nameSeed) % 6
  return classes.map((cls, i) => {
    const race = races?.[i] ?? defaultRaceForIndex(i, raceOffset)
    const hpMax = crewHpMax(cls, race, 1)
    return {
      id: nextId('crew'),
      name: CREW_NAMES[(offset + i) % CREW_NAMES.length] ?? cls,
      cls,
      race,
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
    crew: makeCrew(loadout.crew, `${name}:${loadout.ship}`, loadout.crewRaces),
    ammo: STARTING_AMMO,
  }
}

export function setupFromNpc(template: NpcTemplate, mod?: BattleMod): ShipSetup {
  // A landed sneak attack starts the enemy damaged (hull below max) and/or on fire.
  const hullMult = mod?.enemyHullMult ?? 1
  const hull = Math.max(1, Math.round(template.hull * hullMult))
  return {
    shipClass: template.shipClass,
    name: template.name,
    hull,
    hullMax: template.hull,
    reactor: template.reactor,
    systems: { ...template.systems },
    weapons: [...template.weapons],
    drones: [...template.drones],
    defenseModule: template.defenseModule,
    crew: makeCrew(template.crew, template.name, template.crewRaces),
    ammo: STARTING_AMMO,
    boss: template.shipClass === 'hegemon',
    startFire: mod?.enemyStartFire === true,
  }
}
