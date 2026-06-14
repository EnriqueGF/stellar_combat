import type {
  CrewClassId,
  CrewRaceId,
  DefenseModuleId,
  DroneId,
  ShipClassId,
  SystemId,
  WeaponId,
} from '../types.js'

// GAME_SPEC §4.1 — NPC scaling per sector column. Elite at column c uses template c+1.
// Column 1 is the guaranteed-winnable intro fight (no shields).

export interface NpcTemplate {
  /** Visual/layout ship class. */
  shipClass: ShipClassId
  name: string
  hull: number
  reactor: number
  systems: Partial<Record<SystemId, number>>
  weapons: WeaponId[]
  drones: DroneId[]
  defenseModule: DefenseModuleId
  crew: CrewClassId[]
  /** Optional species per crew slot (parallel to `crew`); absent = varied default. */
  crewRaces?: CrewRaceId[]
}

/** Index 0 = column 1 ... index 7 = column 8 (boss). */
export const NPC_TEMPLATES: NpcTemplate[] = [
  {
    shipClass: 'sentinel',
    name: 'Chatarrero Errante',
    hull: 16,
    reactor: 4,
    systems: { engines: 1, weapons: 1, oxygen: 1, cockpit: 1 },
    weapons: ['laser_light'],
    drones: [],
    defenseModule: 'mod_shields_std',
    crew: ['pilot', 'engineer'],
  },
  {
    shipClass: 'vanguard',
    name: 'Corsario Ligero',
    hull: 20,
    reactor: 6,
    systems: { engines: 2, weapons: 2, shields: 2, oxygen: 1, cockpit: 1 },
    weapons: ['laser_light', 'gauss_cannon'],
    drones: [],
    defenseModule: 'mod_shields_std',
    crew: ['pilot', 'gunner'],
    crewRaces: ['mantid', 'mantid'],
  },
  {
    shipClass: 'sentinel',
    name: 'Patrullero de la Hegemonía',
    hull: 22,
    reactor: 8,
    systems: { engines: 2, weapons: 3, shields: 4, oxygen: 1, cockpit: 1, medbay: 1 },
    weapons: ['laser_burst', 'gauss_cannon'],
    drones: [],
    defenseModule: 'mod_shields_std',
    crew: ['pilot', 'gunner', 'engineer'],
    crewRaces: ['human', 'human', 'synthetic'],
  },
  {
    shipClass: 'vanguard',
    name: 'Cazador Pirata',
    hull: 24,
    reactor: 9,
    systems: { engines: 3, weapons: 3, shields: 4, oxygen: 1, cockpit: 1, medbay: 1 },
    weapons: ['laser_burst', 'missile_swift'],
    drones: [],
    defenseModule: 'mod_dispersion_field',
    crew: ['pilot', 'gunner', 'soldier'],
    crewRaces: ['mantid', 'mantid', 'rockfolk'],
  },
  {
    shipClass: 'bastion',
    name: 'Guardián de Bloqueo',
    hull: 26,
    reactor: 11,
    systems: { engines: 3, weapons: 4, shields: 6, oxygen: 2, cockpit: 1, medbay: 1 },
    weapons: ['laser_burst', 'gauss_cannon', 'missile_swift'],
    drones: [],
    defenseModule: 'mod_reactive_armor',
    crew: ['pilot', 'gunner', 'engineer'],
  },
  {
    shipClass: 'sentinel',
    name: 'Crucero de Asalto',
    hull: 28,
    reactor: 12,
    systems: { engines: 4, weapons: 6, shields: 6, oxygen: 2, cockpit: 2, medbay: 1 },
    weapons: ['mag_heavy', 'laser_burst', 'missile_swift'],
    drones: [],
    defenseModule: 'mod_shields_std',
    crew: ['pilot', 'gunner', 'engineer', 'soldier'],
  },
  {
    shipClass: 'vanguard',
    name: 'Señor de la Guerra',
    hull: 30,
    reactor: 14,
    systems: { engines: 4, weapons: 6, shields: 6, oxygen: 2, cockpit: 2, medbay: 2, drones: 1 },
    weapons: ['mag_heavy', 'laser_burst', 'flak_scatter'],
    drones: ['drone_combat'],
    defenseModule: 'mod_reactive_armor',
    crew: ['pilot', 'gunner', 'gunner', 'engineer'],
  },
  {
    shipClass: 'hegemon',
    name: 'Acorazado Hegemón',
    hull: 45,
    reactor: 16,
    systems: { engines: 3, weapons: 6, shields: 6, oxygen: 2, cockpit: 2, medbay: 2, drones: 1 },
    weapons: ['mag_heavy', 'laser_burst', 'missile_breach'],
    drones: ['drone_defense'],
    defenseModule: 'mod_shields_std',
    crew: ['pilot', 'gunner', 'engineer', 'soldier'],
    crewRaces: ['human', 'synthetic', 'synthetic', 'rockfolk'],
  },
]

/** Boss phase 2 (at 50% hull): extra reactor power surge. */
export const BOSS_PHASE2_BONUS_POWER = 4
