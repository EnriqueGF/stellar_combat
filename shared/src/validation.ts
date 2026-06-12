import { CREW_SIZE, MAX_DRONES_EQUIPPED, WEAPON_BUDGET_POINTS } from './constants.js'
import { CREW_CLASSES } from './data/crew.js'
import { DRONES } from './data/drones.js'
import { DEFENSE_MODULES } from './data/modules.js'
import { SHIPS } from './data/ships.js'
import { WEAPONS } from './data/weapons.js'
import type { Loadout } from './types.js'

export interface LoadoutValidation {
  ok: boolean
  errors: string[]
  /** Budget points spent (weapons + drones). */
  points: number
  /** Total weapon energy vs ship's initial weapons system level (UI warning, not an error). */
  weaponPowerNeeded: number
  weaponPowerAvailable: number
}

/** Server-authoritative loadout validation; the client uses it for live UI feedback. */
export function validateLoadout(loadout: Loadout): LoadoutValidation {
  const errors: string[] = []
  const ship = SHIPS[loadout.ship]

  if (!ship || !ship.playable) errors.push('Nave no válida.')

  const weaponDefs = loadout.weapons.map((w) => WEAPONS[w]).filter(Boolean)
  if (weaponDefs.length !== loadout.weapons.length) errors.push('Arma desconocida.')
  if (ship && loadout.weapons.length > ship.weaponSlots)
    errors.push(`Máximo ${ship.weaponSlots} armas en esta nave.`)
  if (loadout.weapons.length === 0) errors.push('Equipa al menos un arma.')

  const droneDefs = loadout.drones.map((d) => DRONES[d]).filter(Boolean)
  if (droneDefs.length !== loadout.drones.length) errors.push('Dron desconocido.')
  if (loadout.drones.length > MAX_DRONES_EQUIPPED)
    errors.push(`Máximo ${MAX_DRONES_EQUIPPED} drones.`)
  if (new Set(loadout.drones).size !== loadout.drones.length)
    errors.push('No se permiten drones duplicados.')

  const points =
    weaponDefs.reduce((a, w) => a + w.points, 0) + droneDefs.reduce((a, d) => a + d.points, 0)
  if (points > WEAPON_BUDGET_POINTS)
    errors.push(`Presupuesto excedido: ${points}/${WEAPON_BUDGET_POINTS} puntos.`)

  if (!DEFENSE_MODULES[loadout.defenseModule]) errors.push('Módulo de defensa no válido.')

  if (loadout.crew.length !== CREW_SIZE) errors.push(`La tripulación debe ser de ${CREW_SIZE}.`)
  if (loadout.crew.some((c) => !CREW_CLASSES[c])) errors.push('Clase de tripulante no válida.')

  const weaponPowerNeeded = weaponDefs.reduce((a, w) => a + w.power, 0)
  const weaponPowerAvailable = ship?.systems.weapons ?? 0

  return { ok: errors.length === 0, errors, points, weaponPowerNeeded, weaponPowerAvailable }
}
