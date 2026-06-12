import type { Loadout, ShipClassId } from '../types.js'

// GAME_SPEC §4.2 — two presets per playable ship; "Equilibrado" is preloaded in Duel.
// All presets are valid by construction (≤8 budget points, ≤weapon slots, 4 crew, no dup drones).

export interface LoadoutPreset {
  name: string
  loadout: Loadout
}

export const LOADOUT_PRESETS: Record<Exclude<ShipClassId, 'hegemon'>, LoadoutPreset[]> = {
  sentinel: [
    {
      name: 'Equilibrado',
      loadout: {
        ship: 'sentinel',
        weapons: ['laser_burst', 'gauss_cannon', 'missile_swift'],
        defenseModule: 'mod_shields_std',
        drones: ['drone_defense', 'drone_repair'],
        crew: ['pilot', 'engineer', 'gunner', 'medic'],
      },
    },
    {
      name: 'Agresivo',
      loadout: {
        ship: 'sentinel',
        weapons: ['laser_burst', 'mag_heavy', 'missile_breach'],
        defenseModule: 'mod_point_defense',
        drones: ['drone_combat'],
        crew: ['pilot', 'gunner', 'gunner', 'soldier'],
      },
    },
  ],
  vanguard: [
    {
      name: 'Equilibrado',
      loadout: {
        ship: 'vanguard',
        weapons: ['laser_light', 'laser_burst', 'gauss_cannon', 'missile_swift'],
        defenseModule: 'mod_shields_std',
        drones: ['drone_defense', 'drone_repair'],
        crew: ['pilot', 'engineer', 'gunner', 'medic'],
      },
    },
    {
      name: 'Agresivo',
      loadout: {
        ship: 'vanguard',
        weapons: ['mag_heavy', 'laser_burst', 'laser_light', 'missile_swift'],
        defenseModule: 'mod_dispersion_field',
        drones: ['drone_combat'],
        crew: ['pilot', 'gunner', 'gunner', 'engineer'],
      },
    },
  ],
  bastion: [
    {
      name: 'Equilibrado',
      loadout: {
        ship: 'bastion',
        weapons: ['laser_burst', 'missile_swift'],
        defenseModule: 'mod_shields_std',
        drones: ['drone_combat', 'drone_defense', 'drone_repair'],
        crew: ['pilot', 'engineer', 'gunner', 'medic'],
      },
    },
    {
      name: 'Agresivo',
      loadout: {
        ship: 'bastion',
        weapons: ['mag_heavy', 'missile_breach'],
        defenseModule: 'mod_reactive_armor',
        drones: ['drone_combat', 'drone_defense'],
        crew: ['pilot', 'gunner', 'engineer', 'soldier'],
      },
    },
  ],
}
