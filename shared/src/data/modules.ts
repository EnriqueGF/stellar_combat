import type { DefenseModuleDef, DefenseModuleId } from '../types.js'

// GAME_SPEC §3.3 — cada nave equipa exactamente un módulo de defensa.

export const DEFENSE_MODULES: Record<DefenseModuleId, DefenseModuleDef> = {
  mod_shields_std: {
    id: 'mod_shields_std',
    name: 'Escudos Estándar',
    desc: 'Configuración de fábrica, sin sorpresas.',
    tradeoff: 'Sin contrapartida.',
    hullDamageMult: 1,
    evasionBonus: 0,
    shieldRegenTimeMult: 1,
    missileInterceptChance: 0,
    maxShieldLayersMod: 0,
  },
  mod_reactive_armor: {
    id: 'mod_reactive_armor',
    name: 'Armadura Reactiva',
    desc: 'Placas que detonan al impacto: −25% de daño al casco.',
    tradeoff: 'El peso reduce la evasión un 5%.',
    hullDamageMult: 0.75,
    evasionBonus: -0.05,
    shieldRegenTimeMult: 1,
    missileInterceptChance: 0,
    maxShieldLayersMod: 0,
  },
  mod_dispersion_field: {
    id: 'mod_dispersion_field',
    name: 'Campo de Dispersión',
    desc: 'Distorsiona los sensores enemigos: +10% de evasión.',
    tradeoff: 'Los escudos regeneran un 50% más lento.',
    hullDamageMult: 1,
    evasionBonus: 0.1,
    shieldRegenTimeMult: 1.5,
    missileInterceptChance: 0,
    maxShieldLayersMod: 0,
  },
  mod_point_defense: {
    id: 'mod_point_defense',
    name: 'Defensa Puntual',
    desc: 'Torretas automáticas: 70% de derribar misiles y bombas entrantes.',
    tradeoff: 'Solo misiles; su consumo ralentiza la regeneración de escudos un 25%.',
    hullDamageMult: 1,
    evasionBonus: 0,
    shieldRegenTimeMult: 1.25,
    missileInterceptChance: 0.7,
    maxShieldLayersMod: 0,
  },
}

export const DEFENSE_MODULE_IDS = Object.keys(DEFENSE_MODULES) as DefenseModuleId[]
