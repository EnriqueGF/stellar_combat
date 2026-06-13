# Stellar Combat

Juego de navegador multijugador en tiempo real de combate táctico 1v1 entre naves
espaciales, inspirado en **FTL: Faster Than Light**. MVP del GDD v0.1.0.

## Jugar

```bash
./start.sh          # compila si hace falta, arranca el servidor y abre el navegador
```

o manualmente:

```bash
npm install         # solo la primera vez
npm run build       # compila el cliente (client/dist)
npm start           # servidor en http://localhost:3000
```

Desarrollo (recarga en vivo): `npm run dev` → cliente en http://localhost:5173 con el
servidor en :3000 detrás del proxy.

Tests y comprobación de tipos: `npm test` · `npm run typecheck`.

## Modos

- **Expedición** — run roguelite: un sector de 8 columnas de nodos (combates, élites,
  eventos, tiendas) contra NPCs cada vez más duros, con chatarra, mejoras de nave y un
  jefe final. Pausa táctica con `ESPACIO`. Si te desconectas en combate, la IA pilota tu
  nave: puedes perder la run.
- **Duelo PvP** — 1v1 en tiempo real contra otro jugador (o una IA si no llega rival),
  con loadouts de presupuesto fijo de 8 puntos. Sin pausa; muerte súbita a los 5 min.
- **Tutorial** — combate de práctica autocontenido contra el NPC introductorio, con el
  tutorial guiado siempre activo y pausa táctica. Se puede repetir cuando quieras.

## Controles

| Tecla | Acción |
|---|---|
| `1–4` | seleccionar arma (luego click en una sala enemiga para apuntar) |
| Click derecho | cancelar el arma/objetivo seleccionado |
| `ESC` | menú (reanudar · opciones · cómo jugar · abandonar) |
| `ESPACIO` | pausa táctica (solo contra la IA) |
| `J` | cargar/cancelar el salto (huir pierde el botín del nodo) |
| Click en un sistema | click izq. +1 de energía · click dcho. −1 |
| Click tripulante → sala | dar orden de movimiento |

Regla de oro: **Energía funde escudos, Cinético perfora cascos, Explosivo revienta sistemas.**

## Stack

Phaser 3 + TypeScript + Vite (cliente) · Node.js + Express + Socket.IO (servidor,
autoritativo a 20 ticks/s) · monorepo npm workspaces (`shared/`, `server/`, `client/`).
Todo el arte es **procedural** (sin sprites externos) y el audio se sintetiza con WebAudio.

- `docs/GAME_SPEC.md` — especificación de implementación (cierra los huecos del GDD).
- GDD original: «Stellar Combat - Game Design Document» (PDF).
