import type { CrewClassDef, CrewClassId, CrewRaceDef, CrewRaceId } from '../types.js'

// GAME_SPEC §3.6 — 4 miembros por nave, clases con 3 niveles. Técnico: NO implementado (GDD pendiente).

export const CREW_CLASSES: Record<CrewClassId, CrewClassDef> = {
  pilot: {
    id: 'pilot',
    name: 'Piloto',
    desc: 'Aumenta la evasión cuando tripula la cabina.',
    hpMax: [100, 100, 100],
    repairMult: [1, 1, 1],
    fireMult: [1, 1, 1],
    pilotEvasion: [0.05, 0.08, 0.12],
    gunneryMult: [1, 1, 1],
    medbayMult: [1, 1, 1],
    fieldHeal: [0, 0, 0],
  },
  engineer: {
    id: 'engineer',
    name: 'Ingeniero',
    desc: 'Repara sistemas mucho más rápido.',
    hpMax: [100, 100, 100],
    repairMult: [1.25, 1.5, 2],
    fireMult: [1, 1, 1],
    pilotEvasion: [0, 0, 0],
    gunneryMult: [1, 1, 1],
    medbayMult: [1, 1, 1],
    fieldHeal: [0, 0, 0],
  },
  gunner: {
    id: 'gunner',
    name: 'Artillero',
    desc: 'Acelera la carga de las armas al tripular la sala de armas.',
    hpMax: [100, 100, 100],
    repairMult: [1, 1, 1],
    fireMult: [1, 1, 1],
    pilotEvasion: [0, 0, 0],
    gunneryMult: [1.1, 1.2, 1.3],
    medbayMult: [1, 1, 1],
    fieldHeal: [0, 0, 0],
  },
  medic: {
    id: 'medic',
    name: 'Médico',
    desc: 'Potencia la bahía médica y cura a compañeros en su sala.',
    hpMax: [100, 100, 100],
    repairMult: [1, 1, 1],
    fireMult: [1, 1, 1],
    pilotEvasion: [0, 0, 0],
    gunneryMult: [1, 1, 1],
    medbayMult: [1.5, 2, 3],
    fieldHeal: [1, 2, 3],
  },
  soldier: {
    id: 'soldier',
    name: 'Soldado',
    desc: 'Resistente y experto apagando incendios.',
    hpMax: [125, 140, 160],
    repairMult: [1, 1, 1],
    fireMult: [1.5, 2, 3],
    pilotEvasion: [0, 0, 0],
    gunneryMult: [1, 1, 1],
    medbayMult: [1, 1, 1],
    fieldHeal: [0, 0, 0],
  },
}

export const CREW_CLASS_IDS = Object.keys(CREW_CLASSES) as CrewClassId[]

// Crew species (orthogonal to class). Each one looks distinct and carries passive
// traits, so the same gunner plays differently as a fragile Plasmoide or a tanky
// Pétreo. Multipliers are 1 = baseline human.
export const CREW_RACES: Record<CrewRaceId, CrewRaceDef> = {
  human: {
    id: 'human',
    name: 'Humano',
    desc: 'Adaptable y equilibrado: sin debilidades ni extremos.',
    shape: 'human',
    color: 0xd9a77f,
    accent: 0x2de2e6,
    hpMult: 1,
    moveMult: 1,
    repairMult: 1,
    fireFightMult: 1,
    fireDamageMult: 1,
    hypoxiaDamageMult: 1,
  },
  rockfolk: {
    id: 'rockfolk',
    name: 'Pétreo',
    desc: 'Coloso de silicato: mucha vida y aguanta el fuego, pero lento y torpe reparando.',
    shape: 'rock',
    color: 0xc8843c,
    accent: 0x6e4422,
    hpMult: 1.5,
    moveMult: 0.7,
    repairMult: 0.85,
    fireFightMult: 1.1,
    fireDamageMult: 0.35,
    hypoxiaDamageMult: 0.7,
  },
  synthetic: {
    id: 'synthetic',
    name: 'Autómata',
    desc: 'Unidad sintética: no respira (inmune a la asfixia) y repara rapidísimo, pero frágil y sensible al fuego.',
    shape: 'synth',
    color: 0x9fb6c4,
    accent: 0x2de2e6,
    hpMult: 0.8,
    moveMult: 1,
    repairMult: 1.6,
    fireFightMult: 1,
    fireDamageMult: 1.5,
    hypoxiaDamageMult: 0,
  },
  mantid: {
    id: 'mantid',
    name: 'Mantíspido',
    desc: 'Insectoide veloz: cruza la nave en un parpadeo, pero sus garras reparan despacio.',
    shape: 'mantid',
    color: 0x6fae4f,
    accent: 0xc7f06a,
    hpMult: 1,
    moveMult: 1.6,
    repairMult: 0.6,
    fireFightMult: 1,
    fireDamageMult: 1,
    hypoxiaDamageMult: 1,
  },
  plasmid: {
    id: 'plasmid',
    name: 'Plasmoide',
    desc: 'Ser de energía: ágil y resistente al fuego y al vacío, pero muy frágil.',
    shape: 'plasmid',
    color: 0xf3f99d,
    accent: 0xeaff7a,
    hpMult: 0.55,
    moveMult: 1.35,
    repairMult: 1,
    fireFightMult: 1.3,
    fireDamageMult: 0.6,
    hypoxiaDamageMult: 0.4,
  },
  cryon: {
    id: 'cryon',
    name: 'Glacial',
    desc: 'Críita de mundos helados: experta apagando incendios y resiste bien sin oxígeno.',
    shape: 'cryo',
    color: 0xa6d2e8,
    accent: 0xeafaff,
    hpMult: 1.1,
    moveMult: 0.9,
    repairMult: 1,
    fireFightMult: 1.6,
    fireDamageMult: 0.4,
    hypoxiaDamageMult: 0.45,
  },
}

export const CREW_RACE_IDS = Object.keys(CREW_RACES) as CrewRaceId[]

/** Deterministic varied default so a fresh 4-crew ship shows distinct species. */
export function defaultRaceForIndex(i: number, offset = 0): CrewRaceId {
  return CREW_RACE_IDS[(i + offset) % CREW_RACE_IDS.length] ?? 'human'
}

/** Max HP for a (class, race, level): the class HP scaled by the race's hpMult. */
export function crewHpMax(cls: CrewClassId, race: CrewRaceId, level: 1 | 2 | 3): number {
  const base = CREW_CLASSES[cls].hpMax[level - 1] ?? CREW_CLASSES[cls].hpMax[0]
  return Math.round(base * (CREW_RACES[race]?.hpMult ?? 1))
}

export const CREW_NAMES = [
  'Vega',
  'Orión',
  'Lyra',
  'Cassio',
  'Nova',
  'Altair',
  'Mira',
  'Deneb',
  'Rigel',
  'Sirio',
  'Elara',
  'Tycho',
  'Andrómeda',
  'Ícaro',
  'Selene',
  'Helio',
] as const
