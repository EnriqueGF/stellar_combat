# Stellar Combat — Especificación de implementación (MVP)

> Derivada del GDD v0.1.0. Este documento CIERRA todas las secciones "Pendiente de definir"
> y es el contrato único de implementación. Los huecos «pendiente de definir» los cierra
> libremente esta spec; toda desviación de algo EXPLÍCITO en el GDD se lista en §10
> (Desviaciones deliberadas) con su motivo.
> Idioma del juego: **español**. Código (identificadores, comentarios): **inglés**.
> Revisada por panel de críticos (balance / UX / fidelidad GDD) — v2.

## 0. Resumen ejecutivo

Juego de navegador multijugador en tiempo real de combate táctico 1v1 entre naves espaciales,
inspirado en FTL. Server-authoritative a 20 ticks/s. Dos modos:

- **Expedición (run roguelite)**: sector de 8 nodos vs NPCs y eventos, con chatarra, mejoras
  y jefe final. Pausa táctica disponible. Si el jugador se desconecta en combate, la IA toma
  el control de su nave (riesgo de perder la run).
- **Duelo (PvP)**: matchmaking 1v1 en tiempo real con loadouts de presupuesto fijo. Sin pausa.

## 1. Stack y arquitectura

| Componente | Tecnología |
|---|---|
| Cliente | Phaser 3 (v3.80+), TypeScript estricto, Vite |
| Servidor | Node.js 24, Express, Socket.IO, TypeScript (tsx para dev) |
| Comunicación | WebSockets (Socket.IO), JSON |
| Monorepo | npm workspaces: `shared/`, `server/`, `client/` |

- `shared/` contiene **tipos, constantes, tablas de datos y protocolo**. Servidor y cliente
  importan de `@stellar/shared`. Ninguna lógica de simulación vive en el cliente.
- Servidor simula a **20 tps** (`TICK_MS = 50`). Envía snapshot completo a **10 Hz** +
  eventos discretos (`shot_fired`, `hit`, `explosion`, …) para VFX/SFX en el momento exacto.
- El cliente envía **intents** (peticiones); el servidor valida todo (anti-cheat por diseño).
- Producción: `vite build` y Express sirve `client/dist` estático. Dev: Vite dev server
  (puerto 5173) con proxy de socket.io al servidor (puerto 3000).

## 2. La nave

### 2.1 Estructura

Una nave tiene: **casco (HP)**, **reactor (energía)**, **salas** conectadas por puertas,
**sistemas** (cada uno en una sala), **tripulación** (4), **armas** (2–4 slots),
**drones** (máx 3 equipados, máx 2 activos) y **un módulo de defensa**.

Las salas forman una rejilla (cada sala 1×1 o 2×1 celdas). Cada sala tiene: O2 (0–100),
fuego (0–100), brecha (0–100), sistema opcional, y tripulantes presentes.

### 2.2 Sistemas (energía máx por nivel = nivel)

| Sistema | id | Niveles | Función |
|---|---|---|---|
| Armas | `weapons` | 1–8 | Cada arma equipada consume su energía; sin energía no carga |
| Escudos | `shields` | 1–8 | 1 capa por cada 2 niveles alimentados (máx 4 capas) |
| Motores | `engines` | 1–8 | Evasión +5%/nivel alimentado; necesario para cargar el salto |
| Oxígeno | `oxygen` | 1–3 | Rellena O2 de toda la nave (+1.2%/s por nivel; sin energía el O2 cae) |
| Bahía médica | `medbay` | 1–3 | Cura 6/12/18 HP/s a tripulantes en la sala |
| Cabina de mando | `cockpit` | 1–3 | Tripulada da la evasión de motores; carga del salto x1/x1.5/x2 |
| Bahía de drones | `drones` | 1–3 | Permite 1 dron activo por nivel alimentado (máx 2) |

- **Daño de sistema**: cada punto de daño reduce 1 nivel utilizable. Sistema a 0 = inactivo.
  Daño interno con decimales (float); la UI redondea.
- **Reparación**: tripulante en la sala repara 1 punto cada 6 s (modificado por clase).
- **Reactor**: inicial según nave (7–9), máximo 25. La energía se asigna en vivo desde el HUD.
- **Modelo de escudos (HP fraccional)**: cada capa = 2 puntos de escudo (shieldHP).
  Un proyectil bloqueado resta `daño × mult. de categoría` shieldHP (acumulado fraccional,
  sin redondeos por impacto). Capas visibles = ceil(shieldHP/2). Mientras shieldHP > 0,
  los proyectiles no perforantes son absorbidos. Perforación N: atraviesa si capas ≤ N.
  Regeneración: **1 capa cada 6 s**, tras 2 s sin impactos; **cada impacto de escudo
  reinicia el temporizador de gracia**.
- Evasión total = motores alimentados ×5% + bonus de piloto (si cabina tripulada) + módulo.
  Máx 45%. Sin nadie en cabina: evasión = 0 (con alerta visible en el HUD, ver §6.3).

### 2.3 Naves jugables (elección con hándicap/potencial, GDD §2.1)

| Nave | Perfil | Reactor | Slots arma | Niveles iniciales | Rasgo |
|---|---|---|---|---|---|
| **Centinela** | Equilibrada (fácil) | 8 | 3 | armas 3, escudos 2, motores 2, resto 1 | Sin extremos; mejoras a coste estándar |
| **Vanguardia** | Agresiva (difícil, alto potencial) | 7 | **4** | armas 4, escudos 2, motores 2, resto 1 | Mejoras de armas −25% chatarra |
| **Bastión** | Defensiva (lenta, escala tarde) | 9 | 2 | armas 2, escudos 4, motores 1, resto 1 | +3 casco; mejoras de reactor −25% chatarra |

Casco base: 30 (Bastión 33). Layouts de salas distintos por nave (definidos en
`shared/src/data/ships.ts` como rejillas). Estos niveles aplican a ambos modos
(en Duelo no hay progresión: la nave entra tal cual).

## 3. Combate

### 3.1 Armas — triángulo de categorías (GDD §2.4.1: 1.25×/0.75×)

Cada categoría destaca contra una capa de defensa y flojea contra otra. Regla legible
para el jugador: **"Energía funde escudos, Cinético perfora cascos, Explosivo revienta sistemas."**

| Categoría | Bonus (×1.25) | Malus (×0.75) | Rasgo |
|---|---|---|---|
| **Energía** | daño a escudos (shieldHP) | daño a casco | cadencia alta, sin munición |
| **Cinético** | daño a casco | daño a sistemas | sin munición, proyectil rápido |
| **Explosivo** | daño a sistemas | daño a escudos (si lo bloquean) | perfora escudos; munición |

Triángulo cerrado: cada categoría tiene exactamente un ×1.25 y un ×0.75.
Resolución de un impacto: si shieldHP > 0 y el arma no perfora → resta
`daño × mult. escudos` shieldHP y no toca casco. Si pasa → tira evasión; si impacta →
daño a casco (×mult. casco) + daño al sistema de la sala objetivo (×mult. sistemas)
+ efectos (`fireChance` → fuego a intensidad 60; `breachChance` → brecha a 100).
Casco y daño de sistema se acumulan en float (sin redondeo por impacto); la UI redondea.

### 3.2 Tabla de armas (presupuesto de selección: 8 puntos)

| Arma | id | Cat | Pts | Energía | Daño | Cadencia | Especial |
|---|---|---|---|---|---|---|---|
| Láser Ligero | `laser_light` | E | 1 | 1 | 1 | 8 s | — |
| Láser de Ráfaga | `laser_burst` | E | 2 | 2 | 1×2 | 12 s | 2 proyectiles |
| Haz Fundente | `beam_melter` | E | 3 | 2 | 2 | 14 s | barre 2 salas (2+2); no falla; si hay escudos, no entra pero funde 1 capa |
| Cañón Gauss | `gauss_cannon` | C | 1 | 1 | 2 | 11 s | — |
| Metralla | `flak_scatter` | C | 2 | 2 | 1×4 | 14 s | 4 proyectiles, −10% precisión c/u |
| Magnetocañón | `mag_heavy` | C | 3 | 3 | 4 | 18 s | +10% prob. brecha |
| Misil Colibrí | `missile_swift` | X | 1 | 1 | 2 | 13 s | munición; perfora 1 escudo |
| Misil Brecha | `missile_breach` | X | 2 | 2 | 3 | 17 s | munición; perfora 1 escudo; 50% brecha |
| Bomba Ígnea | `bomb_incendiary` | X | 2 | 2 | 2 | 15 s | munición; perfora TODOS los escudos (teleporta); 100% fuego; no daña casco; daño solo a sistema |

- Pts = Energía en todas las armas (GDD: presupuesto de 8 puntos de energía).
- Munición inicial: 12. Máx 20. Sin munición el arma no carga. Probabilidades base:
  fuego 10% (E), brecha 10% (C), salvo indicado.
- Las armas se cargan solo con energía asignada; al quitar energía conservan el 50% de la carga.
- **Autofire** por arma (toggle): repite el último objetivo.

### 3.3 Módulos de defensa (elegir 1 en el loadout, GDD §2.4.2)

| Módulo | id | Descripción | Contrapartida |
|---|---|---|---|
| Escudos estándar | `mod_shields_std` | +0 (referencia neutra) | — |
| Armadura reactiva | `mod_reactive_armor` | −25% daño al casco | −5% evasión |
| Campo de dispersión | `mod_dispersion_field` | +10% evasión | escudos regeneran un 50% más lento |
| Defensa puntual | `mod_point_defense` | 70% de derribar misiles/bombas entrantes | solo misiles; escudos regeneran un 25% más lento |

### 3.4 Drones (GDD §2.4.3 — máx 3 equipados y activos, **sin duplicados**; 1 punto de presupuesto c/u)

Drones activos simultáneos = nivel alimentado de la bahía (máx 3, alineado con "max 3" del GDD).

| Dron | id | Tipo | Energía | Función |
|---|---|---|---|---|
| Dron de Combate | `drone_combat` | ofensivo | 2 | dispara 1 de daño Energía a una sala enemiga aleatoria cada 7 s |
| Dron de Defensa | `drone_defense` | defensivo | 1 | 60% de derribar un proyectil entrante; **3 s de recarga entre intentos** (las salvas lo saturan) |
| Dron de Reparación | `drone_repair` | interno | 1 | repara 1 punto de sistema cada 5 s (va al más dañado) |

Anti-personal, Escudo y Abordaje: **fase 2** (fuera del MVP, igual que en el GDD están sin definir).

### 3.5 Entorno y peligros (GDD §2.6)

- **O2**: difusión entre salas conectadas por puertas (iguala niveles, tasa 4%/s por puerta).
  Sistema de oxígeno alimentado rellena; sin energía, el O2 global decae 0.6%/s.
  Tripulante en sala con O2<15% pierde 4 HP/s. Sala sin O2 sofoca el fuego.
- **Fuego** (0–100 por sala): daña sistema 0.5/s y tripulantes 5 HP/s; consume O2 1.5%/s;
  con O2<20% se extingue solo. Se propaga: cada 5 s, 20% a cada sala conectada.
  Tripulante lo combate (−10/s, modificado por Soldado).
- **Brecha** (0–100): drena O2 de la sala 3%/s; se repara por tripulante (−8/s).
  Mientras haya brecha el sistema de la sala no puede repararse.

### 3.6 Tripulación (GDD §2.5 — 4 miembros, clases con 3 niveles)

HP base 100. Velocidad 1.6 salas/s. Suben de nivel por uso (XP de su acción).

| Clase | id | Habilidad por nivel (1/2/3) |
|---|---|---|
| Piloto | `pilot` | +5/+8/+12% evasión al tripular la cabina |
| Ingeniero | `engineer` | repara ×1.25/×1.5/×2 |
| Artillero | `gunner` | +10/20/30% velocidad de carga al tripular armas |
| Médico | `medic` | bahía médica ×1.5/×2/×3 con él dentro; cura 1/2/3 HP/s a compañeros en su sala |
| Soldado | `soldier` | apaga fuego ×1.5/×2/×3; HP máx 125/140/160 |
| Técnico | — | **NO implementar** (GDD: pendiente) |

**Auto-tareas** (prioridad GDD: Fuego > Brecha > Reparar > Operar): cada tripulante sin
orden directa evalúa su sala actual; si no hay nada que hacer, vuelve a su puesto asignado.
Orden directa del jugador (click tripulante → click sala) tiene prioridad y fija su puesto.

### 3.7 Huida (GDD §2.1/§2.3)

Cargar el salto requiere: cabina tripulada + motores con ≥1 energía. Carga 15 s
(×1.5/×2 según nivel de cabina; pausada si se interrumpen requisitos, no se reinicia).
Al saltar: huyes del combate y **pierdes el botín del nodo** (GDD §2.1.3). En Duelo,
huir cuenta como rendición.

## 4. Modos de juego

### 4.1 Expedición (run roguelite)

- **Sector**: grafo de 8 columnas. Columnas 1–7: el jugador elige entre 2–3 nodos;
  columna 8: **jefe**. Tipos de nodo: `combat` (60%), `elite` (15%), `event` (15%),
  `shop` (10%). El mapa se ve en una pantalla de sector con el planeta/fondo de cada nodo.
- **Dificultad — tabla de escalada NPC por columna** (plantillas en `shared/src/data/npc.ts`;
  élite en columna c usa la plantilla c+1 y +50% botín; jefe = "Acorazado Hegemón",
  2 fases: al 50% de casco alimenta +2 armas y +2 motores):

| Col | Casco | Reactor | Escudos (capas) | Motores | Armas | Trip. |
|---|---|---|---|---|---|---|
| 1 (intro) | 16 | 4 | 0 | 1 | Láser Ligero | 2 |
| 2 | 20 | 6 | 2 (1) | 2 | Láser Ligero + Gauss | 2 |
| 3 | 22 | 8 | 4 (2) | 2 | Ráfaga + Gauss | 3 |
| 4 | 24 | 9 | 4 (2) | 3 | Ráfaga + M. Colibrí | 3 |
| 5 | 26 | 11 | 6 (3) | 3 | Ráfaga + Gauss + M. Colibrí | 3 |
| 6 | 28 | 12 | 6 (3) | 4 | Magnetocañón + Ráfaga + M. Colibrí | 4 |
| 7 | 30 | 14 | 6 (3) | 4 | Magnetocañón + Ráfaga + Metralla + Dron Combate | 4 |
| 8 (jefe) | 45 | 16 | 6 (3) | 3 | Mag + Ráfaga + M. Brecha + Dron Defensa | 4 |

  La columna 1 es **garantizadamente ganable** con cualquier loadout inicial (sin escudos).
- **Botín** tras victoria: chatarra (25 + rand(0–10) + 8×columna), 0–2 misiles,
  10% de soltar un arma.
- **Pantalla de mejora** (tras cada nodo): gastar chatarra en: reactor +1 (coste plano 25),
  nivel de sistema (10+3×nivel actual), reparar casco (2/punto), munición (4/2 misiles),
  comprar arma suelta si la tienda/botín la ofreció. Economía verificada: ingreso esperado
  de la run ≈ 320 chatarra ≥ progresión viable (reactor +4 = 100, escudos +2 = ~50,
  armas +2 = ~50, reparaciones ≈ 80).
- **Eventos**: 10 eventos de texto con 2–3 opciones y resultados probabilísticos
  (chatarra, daño de casco, fuego a bordo, tripulante herido, arma gratis, nada).
  Definidos como datos en `shared/src/data/events.ts`.
- **Derrota** (casco 0 o tripulación muerta): fin de la run → pantalla de resultado.
- **Desconexión en combate**: la IA (la misma del NPC) controla tu nave hasta que vuelvas.
  Reconexión por token (`localStorage`). Si tu nave muere mientras tanto, run perdida.
- **Desconexión fuera de combate** (GDD §2.1.4 — riesgo constante): la run queda "en órbita".
  Al reconectar, 25% de probabilidad de **emboscada**: combate inmediato contra un NPC de la
  columna actual antes de poder hacer nada más. (Aproximación MVP del "luchar automáticamente";
  ver §10.)

### 4.2 Duelo (PvP)

- Cola de matchmaking; al emparejar, ambos eligen loadout (60 s): nave + armas (8 pts)
  + módulo de defensa + drones + clases de tripulación. Sin progresión: partida única.
- Cada nave tiene **2 presets** ("Equilibrado", "Agresivo") en `shared/src/data/presets.ts`;
  el preset Equilibrado viene precargado. Si expira el temporizador, se confirma
  automáticamente el loadout actual (siempre válido por construcción).
- Sin pausa. Misiles limitados (12). Victoria por destrucción o rendición/desconexión (30 s de gracia).
- **Muerte súbita anti-tablas**: a los 5 minutos, la regeneración de escudos de ambos se
  desactiva (aviso a los 4:30 con alarma).
- Si no llega rival en 15 s, se ofrece "combatir contra un NPC equivalente" (mismo flujo).

### 4.3 Pausa táctica

Solo vs NPC (Expedición o Duelo-vs-NPC). `SPACE` pausa la simulación de esa batalla en el
servidor; se puede apuntar, redistribuir energía y dar órdenes en pausa. Indicador claro "PAUSA".

## 5. Pantallas y flujo (GDD §3.1)

`Menú principal` → `Selección de loadout` → `[Mapa de sector]` → `Batalla` → `Resultado`
con `Mejora` / `Evento` / `Tienda` entre nodos en Expedición.

1. **MainMenu**: título con planeta procedural de fondo; botones: Expedición, Duelo PvP,
   Opciones (volúmenes, CRT on/off, escala UI), Cómo jugar.
2. **Loadout**: elegir nave (cards con stats y layout), armas con presupuesto de 8 pts,
   módulo de defensa, drones, 4 tripulantes por clase. Botón "Listo".
3. **SectorMap** (Expedición): grafo de nodos sobre fondo planetario; nodo actual brillante.
4. **Battle**: ver §6.3.
5. **Result**: victoria/derrota, estadísticas (daño infligido/recibido, precisión,
   sistemas destruidos, chatarra), botones contextuales (Continuar / Menú).

## 6. Arte y UX

### 6.1 Dirección

Sci-fi oscuro con **estética planetaria**: cada batalla ocurre en órbita de un planeta
procedural distinto (gigante gaseoso con bandas, rocoso con cráteres, helado, volcánico…)
que domina el fondo, con atmósfera glow, 3 capas de estrellas con parallax y nebulosas
animadas. **Todo procedural** (Phaser Graphics/RenderTexture/partículas), cero sprites
externos. Resolución adaptable (escala FIT, diseño base 1280×720).

**Retro/pixel-art híbrido** (GDD §5.1 pide pixel-art): los fondos procedurales (planeta,
nebulosas, estrellas) se generan a baja resolución (¼–½) en RenderTextures escaladas con
filtro NEAREST → look pixelado genuino, con bandas de color cuantizadas y dithering en los
planetas. Naves, VFX y UI se renderizan nítidos a resolución completa por legibilidad
(decisión de accesibilidad, ver §10). El overlay CRT remata el look retro.

### 6.2 Paleta (colorblind-safe en señales críticas: forma + icono + color)

| Uso | Color |
|---|---|
| Fondo espacio | `#0a0e1a` / `#141b2e` |
| Panel UI / borde | `#101826` / `#2de2e6` (cian) |
| Texto | `#cfe8ef` |
| OK / curación | `#5af78e` |
| Aviso | `#ffb454` (ámbar) |
| Peligro / daño | `#ff5c57` |
| Escudos | `#4d9be6` |
| Energía | `#f3f99d` |
| Cat. Energía / Cinético / Explosivo | `#2de2e6` / `#ffb454` / `#ff5c57` |

Tipografías: **Orbitron** (títulos) y **Share Tech Mono** (cuerpo), via `@fontsource` (offline).

### 6.3 Batalla — layout HUD (1280×720, presupuesto de píxeles explícito)

Zonas fijas (la escena Battle NO se ve afectada por la opción "escala UI", que solo aplica
a menús):

| Zona | Rect aprox. | Contenido |
|---|---|---|
| Log de combate | x340..940, y4..56 | últimas 3 entradas, fade-out; fuera de la trayectoria de los números de daño |
| Retratos tripulación | x0..86, y90..480 | 4 cards verticales (HP, clase, nivel), clicables |
| Nave jugador (+escudo) | x96..556, y110..560 | cutaway con burbuja hexagonal incluida en la zona |
| Nave enemiga (+escudo) | x720..1180, y90..470 | cutaway más pequeña; planeta procedural detrás |
| Lecturas de nave | x96..556, y68..100 | "Evasión: X%" permanente + iconos de alerta (cabina vacía, O2 bajo) |
| Barra inferior | y585..720 | ver desglose |

Desglose de la barra inferior (≈1270 px usables):
**reactor** (70px, pips verticales de energía libre) · **7 sistemas** (40px/columna = 280px;
los **pips son el target de click**: click en pip N asigna hasta N, click derecho o rueda
abajo quita; pips con 3 estados visuales: asignado/lleno, disponible/hueco, dañado = ✕ roja)
· **armas** (4 × 105px = 420px: nombre corto, cooldown radial, nº de slot, icono de categoría
con mini-triángulo de bonus, estados: sin energía = pips apagados + icono enchufe; sin
munición = misil tachado; cargando = radial; lista = borde pulsante; autofire = Ⓐ)
· **contador GLOBAL de misiles** (60px, único para toda la nave) · **drones** (3 × 56px)
· **salto** (110px: estados deshabilitado/cargando/pausado/listo + texto del requisito
incumplido: "Cabina sin piloto" / "Motores sin energía") · márgenes/separadores (~70px).

- Salas: rects redondeados con icono del sistema; tripulantes = fichas circulares con
  color+icono de clase y barra HP; fuego/brecha/O2 con partículas y overlays.
- Escudos: burbuja de **hexágonos** alrededor de la nave, ripple al impacto, capas visibles.
- **Targeting**: seleccionar arma (click o tecla 1–4) → crosshair sobre la nave enemiga →
  click en sala = fijar. **ESC o click derecho cancela la selección**; click derecho sobre
  la sala objetivo (o sobre el slot) limpia el objetivo. Con un arma seleccionada, los
  clicks sobre la nave propia solo cancelan la selección (sin ambigüedad con tripulación).
  Las líneas de objetivo llevan **badge con el nº de slot (1–4)** y trazo distinto por
  categoría (continuo/discontinuo/punteado) además del color. El Haz Fundente fija una sala
  y el servidor barre automáticamente a la sala adyacente con sistema más valioso (simplificación MVP).
- Feedback: números de daño flotantes (suben alejándose del log), shake en impactos de casco,
  flash + icono de alerta de O2 y de cabina vacía (forma + texto, nunca solo color).
- Accesibilidad: pausa táctica, tooltips en TODO (hover ≥300 ms) incluyendo el triángulo de
  categorías en cada slot de arma, atajos (1–4 armas, SPACE pausa, J salto, ESC cancelar),
  CRT/scanlines desactivable, sin información solo-por-color.
- Tutorial: primera batalla de Expedición (vs NPC intro sin escudos, ganable garantizado)
  con 6 pasos guiados (energía → apuntar → triángulo de categorías → escudos → tripulación
  → pausa), saltable, persistido en localStorage; pasos contextuales la primera vez que
  aplican munición y salto/huida ("huir pierde el botín del nodo").

### 6.4 VFX (GDD §5.3)

Lásers (tracer + glow), proyectiles cinéticos (shell + estela), misiles (curva + humo),
haz (línea barriendo con partículas), explosiones (flash + anillo + partículas + shake),
ripple hexagonal de escudo, fuego (partículas naranjas), brecha (grieta + partículas
aspiradas), overlay CRT con scanlines + viñeta (toggle), estrellas/nebulosas/planeta animados.

## 7. Audio (GDD §6) — 100% procedural con WebAudio

- **SFX**: láser (sweep descendente), gauss (thump), misil (whoosh+boom), explosión
  (noise burst filtrado), impacto escudo (ping metálico), alarma O2/casco (two-tone),
  clicks UI, curación, level-up, salto FTL.
- **Música**: pad ambiental generativo (acordes lentos, filtro LFO) + arpegio pentatónico
  de baja densidad; intensidad sube en combate (más densidad/percusión suave).
- Mezclador: master/música/SFX con sliders en Opciones; mute al perder foco (opcional).

## 8. Protocolo de red (resumen; detalle en `shared/src/protocol.ts`)

Cliente→Servidor (intents): `queue:join {mode, loadout}`, `battle:set_power {system, value}`,
`battle:set_target {weaponSlot, room | null}`, `battle:toggle_autofire {weaponSlot}`,
`battle:move_crew {crewId, room}`, `battle:toggle_drone {droneSlot}`, `battle:jump`,
`battle:pause {paused}`, `run:choose_node {nodeId}`, `run:buy {item}`, `run:event_choice {choiceIdx}`,
`session:resume {token}`.

Servidor→Cliente: `lobby:state`, `battle:start {estado inicial completo}`, `battle:snapshot` (10 Hz),
`battle:event` (disparos/impactos/explosiones/log con timestamps), `battle:end {result}`,
`run:state`, `error {code, msg}`.

## 9. Calidad y convenciones

- TypeScript `strict: true`; sin `any` (usar tipos de shared). ESM en todo el monorepo.
- Determinismo razonable: RNG con semilla por batalla (mulberry32) en el servidor.
- La simulación (server/src/sim) no importa nada de Socket.IO: pura, testeable.
- Tests: suite de simulación con `node:test` (batalla NPC vs NPC corre a término sin NaN
  ni estados imposibles; triángulo de daño; O2/fuego/brecha; huida) + test e2e de socket.
- `npm run dev` levanta servidor+cliente; `npm run build` + `npm start` para producción;
  `npm test` corre las suites.

## 10. Desviaciones deliberadas del GDD (con motivo)

1. **PvP dentro de las runs → modo Duelo separado (fase 2 la integración)**. El GDD (§1.2,
   §2.1.2, §4.2) contempla enfrentarse a jugadores dentro del loop. Con la población de un
   MVP, el matchmaking por dificultad dentro de runs produciría esperas largas o emparejes
   injustos. El MVP entrega ambos pilares por separado (run roguelite vs NPC + PvP en
   tiempo real); fase 2: encuentros PvP opt-in en nodos de Expedición con botín aumentado.
2. **"Luchar automáticamente al desconectar" → emboscada al reconectar (25%)**. Simular
   batallas completas para jugadores ausentes no es observable ni depurable en MVP; la
   emboscada preserva la sensación de riesgo. En combate sí toma el control la IA.
3. **Pixel-art → híbrido retro** (fondos pixelados + naves/UI nítidas): prioriza la
   legibilidad y accesibilidad necesarias en un juego táctico denso en información.
   El CRT overlay y la cuantización de color conservan el look.
4. **Drones anti-personal/escudo/abordaje fuera del MVP**: recorte de alcance del MVP
   (requieren sistema de abordaje completo); el GDD solo los nombra.
5. **Clase Técnico no implementada**: el propio GDD la marca "pendiente de implementar".
6. **Presupuesto de armas**: puntos de selección = energía del arma en TODAS las armas,
   alineado con "8 puntos de energía" del GDD.
