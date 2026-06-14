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
  jefe final. Antes de cada combate (salvo el primero) surge un **encuentro narrativo**
  estilo FTL con elecciones: combatir, atacar por sorpresa, eludir o pagar un peaje.
  Pausa táctica con `ESPACIO`. Si te desconectas en combate, la IA pilota tu nave:
  puedes perder la run.
- **Duelo PvP** — 1v1 en tiempo real contra otro jugador (o una IA si no llega rival),
  con loadouts de presupuesto fijo de 8 puntos. Sin pausa; muerte súbita a los 5 min.
- **Tutorial** — combate de práctica autocontenido contra el NPC introductorio, con el
  tutorial guiado siempre activo y pausa táctica. Se puede repetir cuando quieras.

## Tripulación y razas

Cada tripulante tiene una **clase** (piloto, ingeniero, artillero, médico, soldado) y una
**especie** independiente, distinguible por su silueta y color: humano, pétreo (tanque,
resiste el fuego), autómata (no respira y repara rapidísimo), mantíspido (veloz),
plasmoide (frágil pero ágil) y glacial (apaga incendios y aguanta el vacío). La especie
de cada puesto se elige en la pantalla de equipamiento.

## Cuentas (opcional)

Puedes jugar como invitado sin más. Desde el botón de la esquina del menú puedes
**registrarte o iniciar sesión** para tener un perfil persistente con estadísticas
(expediciones, combates, duelos, chatarra…). Las cuentas se guardan en el servidor con
contraseñas cifradas (scrypt); no se requiere ninguna base de datos externa.

## Controles

| Tecla | Acción |
|---|---|
| `1–4` | seleccionar arma (luego click en una sala enemiga para apuntar) |
| Click derecho (con arma) | cancelar el arma/objetivo seleccionado |
| `ESC` | menú (reanudar · opciones · cómo jugar · abandonar) |
| `ESPACIO` | pausa táctica (solo contra la IA) |
| `J` | saltar y huir (el salto se carga solo; necesita un tripulante en motores; pierde el botín del nodo) |
| Click en un sistema | click izq. +1 de energía · click dcho. −1 |
| Click en una compuerta | abrir/cerrar. Las naves arrancan **selladas** (puertas cerradas): ábrelas para repartir O2, ciérralas para aislar una sala y asfixiar un incendio |
| Clic izq. tripulante · arrastrar | seleccionar uno o varios tripulantes (clic izq. en zona vacía deselecciona) |
| **Clic derecho** en una sala | enviar allí a los tripulantes seleccionados |

Los tripulantes recorren la nave **pasando por las puertas** (no saltan en diagonal). La
IA enemiga también gestiona sus compuertas: sella las salas en llamas para asfixiarlas y
moviliza a su tripulación para apagar incendios.

Regla de oro: **Energía funde escudos, Cinético perfora cascos, Explosivo revienta sistemas.**

## Stack

Phaser 3 + TypeScript + Vite (cliente) · Node.js + Express + Socket.IO (servidor,
autoritativo a 20 ticks/s) · monorepo npm workspaces (`shared/`, `server/`, `client/`).
Todo el arte es **procedural** (sin sprites externos) y el audio se sintetiza con WebAudio.

- `docs/GAME_SPEC.md` — especificación de implementación (cierra los huecos del GDD).
- GDD original: «Stellar Combat - Game Design Document» (PDF).
