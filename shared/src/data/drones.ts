import type { DroneDef, DroneId } from '../types.js'

// GAME_SPEC §3.4 — máx 3 equipados y activos, sin duplicados; 1 punto de presupuesto c/u.
// Activos simultáneos = nivel alimentado de la bahía de drones.
// Anti-personal, Escudo y Abordaje: fase 2 (recorte de alcance del MVP).

export const DRONES: Record<DroneId, DroneDef> = {
  drone_combat: {
    id: 'drone_combat',
    name: 'Dron de Combate',
    desc: 'Orbita al enemigo disparando láseres a salas aleatorias.',
    kind: 'offensive',
    power: 2,
    points: 1,
    period: 7,
    interceptChance: 0,
  },
  drone_defense: {
    id: 'drone_defense',
    name: 'Dron de Defensa',
    desc: 'Derriba proyectiles entrantes (60%), pero necesita 3 s entre intentos: las salvas lo saturan.',
    kind: 'defensive',
    power: 1,
    points: 1,
    period: 3,
    interceptChance: 0.6,
  },
  drone_repair: {
    id: 'drone_repair',
    name: 'Dron de Reparación',
    desc: 'Repara automáticamente el sistema más dañado de tu nave.',
    kind: 'internal',
    power: 1,
    points: 1,
    period: 5,
    interceptChance: 0,
  },
}

export const DRONE_IDS = Object.keys(DRONES) as DroneId[]
