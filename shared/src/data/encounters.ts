// Pre-combat encounters (FTL-style): arriving at a hostile beacon opens a short
// narrative with choices BEFORE the shooting starts. Some choices fight, some try
// to gain the upper hand (a sneak attack), and some try to avoid the fight (evade
// or pay a toll). The per-choice `action` is resolved by the run manager; the
// client only ever sees the title/text/labels through the generic event screen.

export type EncounterAction =
  | { kind: 'fight' }
  /** Roll: success → start with the enemy damaged + on fire; failure → a normal fight. */
  | { kind: 'sneak'; successWeight: number; failWeight: number }
  /** Roll: success → skip the fight (no loot); failure → a normal fight. */
  | { kind: 'evade'; successWeight: number; failWeight: number }
  /** Pay a scrap toll to skip the fight entirely (only offered if affordable). */
  | { kind: 'bribe' }

export interface EncounterChoiceDef {
  label: string
  action: EncounterAction
  /** Result text when the choice avoids the battle (evade success / bribe paid). */
  avoidText?: string
  /** Battle-log line when a sneak attack lands (advantage). */
  successLog?: string
  /** Battle-log line when a sneak/evade fails and the fight starts anyway. */
  failLog?: string
}

export interface CombatEncounterDef {
  id: string
  title: string
  text: string
  choices: EncounterChoiceDef[]
}

export const COMBAT_ENCOUNTERS: CombatEncounterDef[] = [
  {
    id: 'hostile_contact',
    title: 'Contacto hostil',
    text: 'Una nave desconocida vira hacia ti en cuanto sales del salto, cargando sus armas sin mediar palabra. No hay tiempo para diplomacia… ¿o sí?',
    choices: [
      { label: 'Cargar de frente', action: { kind: 'fight' } },
      {
        label: 'Rodear entre los escombros y atacar por sorpresa',
        action: { kind: 'sneak', successWeight: 3, failWeight: 2 },
        successLog: 'Caes sobre el enemigo desde la sombra del planeta: su casco cruje y un incendio prende a bordo.',
        failLog: 'Te detectan a media maniobra: el factor sorpresa se pierde.',
      },
      {
        label: 'Intentar eludirlos y seguir tu ruta',
        action: { kind: 'evade', successWeight: 1, failWeight: 1 },
        avoidText: 'Apuras los motores y te pierdes en el campo de asteroides antes de que abran fuego. Sin combate, sin botín.',
        failLog: 'No consigues quitártelos de encima: te interceptan.',
      },
    ],
  },
  {
    id: 'hegemony_blockade',
    title: 'Bloqueo de la Hegemonía',
    text: 'Un patrullero de la Hegemonía corta tu trayectoria orbital. «Nave no registrada: entrega tu carga o serás abatida», restalla por la radio.',
    choices: [
      { label: 'Responder con las armas', action: { kind: 'fight' } },
      {
        label: 'Pagar el peaje exigido',
        action: { kind: 'bribe' },
        avoidText: 'Transfieres la chatarra exigida. El patrullero se aparta con desdén y te deja pasar.',
      },
      {
        label: 'Fingir avería y dispararles al acercarse',
        action: { kind: 'sneak', successWeight: 3, failWeight: 2 },
        successLog: 'Bajan la guardia ante tu falsa avería: tu primera andanada los pilla con los escudos fríos.',
        failLog: 'El capitán enemigo huele la trampa y carga sus escudos a tiempo.',
      },
    ],
  },
  {
    id: 'bounty_hunter',
    title: 'Cazarrecompensas',
    text: 'Una nave artillada te sigue desde el último nodo. «Hay un buen precio por tu casco, capitán», ríe una voz mientras afina la puntería.',
    choices: [
      { label: 'Plantar cara', action: { kind: 'fight' } },
      {
        label: 'Forzar el salto y despistarlo',
        action: { kind: 'evade', successWeight: 2, failWeight: 3 },
        avoidText: 'Aprovechas una tormenta iónica para romper su rastreo. Lo pierdes entre las descargas.',
        failLog: 'Su sensor es mejor que el tuyo: te alcanza antes de saltar.',
      },
      {
        label: 'Tenderle una emboscada con la baliza apagada',
        action: { kind: 'sneak', successWeight: 3, failWeight: 2 },
        successLog: 'Apagas la baliza y esperas: cuando entra al alcance, tu primera salva ya ha hecho blanco.',
        failLog: 'Tu silueta se recorta contra el planeta y delata la emboscada.',
      },
    ],
  },
  {
    id: 'pirate_ambush',
    title: 'Emboscada pirata',
    text: 'Tres marcas saltan a la vez sobre tus sensores: corsarios que te esperaban agazapados tras la luna. Ya están encima.',
    choices: [
      { label: 'Defenderte', action: { kind: 'fight' } },
      {
        label: 'Arrojarles parte de la carga como cebo',
        action: { kind: 'bribe' },
        avoidText: 'Sueltas un contenedor de chatarra; mientras se pelean por él, te escabulles.',
      },
    ],
  },
  {
    id: 'derelict_trap',
    title: 'Saqueador a la deriva',
    text: 'Lo que parecía un pecio inerte enciende de pronto sus motores: era un saqueador fingiéndose muerto para cazar incautos.',
    choices: [
      { label: 'Combatir', action: { kind: 'fight' } },
      {
        label: 'Adelantarte y atacar antes de que despierte del todo',
        action: { kind: 'sneak', successWeight: 4, failWeight: 1 },
        successLog: 'Reaccionas primero: lo cazas con los sistemas aún arrancando, en llamas y maltrecho.',
        failLog: 'Despierta más rápido de lo previsto y encaja tu primera andanada con los escudos ya en pie.',
      },
      {
        label: 'Retirarte con cautela',
        action: { kind: 'evade', successWeight: 1, failWeight: 1 },
        avoidText: 'Inviertes motores y te alejas despacio. El saqueador no merece el riesgo.',
        failLog: 'El saqueador es más rápido de lo que aparenta y te da caza.',
      },
    ],
  },
  {
    id: 'auto_patrol',
    title: 'Patrulla automatizada',
    text: 'Un dron de combate sin tripulación patrulla el nodo siguiendo un protocolo implacable. Te marca como objetivo en cuanto te detecta.',
    choices: [
      { label: 'Destruir el dron', action: { kind: 'fight' } },
      {
        label: 'Burlar su rutina de patrulla',
        action: { kind: 'evade', successWeight: 2, failWeight: 2 },
        avoidText: 'Te cuelas por un punto ciego de su patrón de barrido y cruzas sin disparar un solo tiro.',
        failLog: 'Su rutina predice tu maniobra y te corta el paso.',
      },
    ],
  },
  {
    id: 'rival_mercenary',
    title: 'Mercenaria rival',
    text: 'Una nave de líneas afiladas se cruza en tu camino. «Este sector lo cazo yo, capitán. Dos buitres sobran sobre la misma carroña», escupe su piloto mientras desenfunda.',
    choices: [
      { label: 'Aceptar el duelo', action: { kind: 'fight' } },
      {
        label: 'Cegarla con señuelos y atacar',
        action: { kind: 'sneak', successWeight: 3, failWeight: 2 },
        successLog: 'Sueltas una nube de señuelos térmicos; mientras sus sensores parpadean, tu andanada ya va de camino.',
        failLog: 'La veterana ignora los señuelos: ha visto ese truco mil veces.',
      },
      {
        label: 'Ofrecerle parte del botín por paso franco',
        action: { kind: 'bribe' },
        avoidText: 'Le transfieres una parte de tu chatarra. «Negocio es negocio», ríe, y baja las armas.',
      },
    ],
  },
  {
    id: 'distress_lure',
    title: 'Socorro o cebo',
    text: 'Un mercante lanza una señal de socorro a media voz… pero sus baterías están calientes y sus tubos de misiles, abiertos. Huele a emboscada.',
    choices: [
      { label: 'Adelantarte a su traición', action: { kind: 'fight' } },
      {
        label: 'Seguir su juego y dispararle al acercarte',
        action: { kind: 'sneak', successWeight: 3, failWeight: 2 },
        successLog: 'Finges acudir al rescate; cuando bajan los escudos para «recibirte», abres fuego a quemarropa.',
        failLog: 'El falso mercante no se fía y mantiene los escudos en alto.',
      },
      {
        label: 'Rodear el campo de escombros y largarte',
        action: { kind: 'evade', successWeight: 2, failWeight: 2 },
        avoidText: 'No piensas morder el anzuelo. Bordeas los escombros y dejas atrás la trampa.',
        failLog: 'En cuanto giras, te persiguen: el cebo era una emboscada en toda regla.',
      },
    ],
  },
  {
    id: 'wounded_raider',
    title: 'Asaltante malherido',
    text: 'Una nave asaltante arrastra un reguero de plasma de un combate anterior. Aun así vira hacia ti: herida y desesperada, no tiene nada que perder.',
    choices: [
      { label: 'Rematarla antes de que se rehaga', action: { kind: 'fight' } },
      {
        label: 'Apuntar a sus heridas y caer sobre ella',
        action: { kind: 'sneak', successWeight: 4, failWeight: 1 },
        successLog: 'Apuntas a sus heridas abiertas: el primer impacto reaviva sus incendios y la deja tambaleándose.',
        failLog: 'Reúne fuerzas en el último segundo y aguanta tu primera embestida.',
      },
    ],
  },
  {
    id: 'ion_storm_hunter',
    title: 'Depredador en la tormenta',
    text: 'Entre los relámpagos de una tormenta iónica acecha un cazador. Las descargas friegan tus sensores… y los suyos. Quien dispare primero con buena puntería se lleva el nodo.',
    choices: [
      { label: 'Disparar a las sombras', action: { kind: 'fight' } },
      {
        label: 'Usar la tormenta para desaparecer',
        action: { kind: 'evade', successWeight: 3, failWeight: 2 },
        avoidText: 'Apagas motores y te dejas llevar por la corriente iónica. Cuando vuelve a verte, ya no estás.',
        failLog: 'Un relámpago ilumina tu casco en el peor momento y delata tu posición.',
      },
    ],
  },
]

/** Narrated single-choice intro for the guaranteed first fight of a run. */
export const FIRST_ENCOUNTER: CombatEncounterDef = {
  id: 'first_contact',
  title: 'Primer contacto',
  text: 'Apenas estabilizas el salto, un chatarrero maltrecho se abalanza sobre tu nave: para él no eres más que un casco que desguazar. Tu tripulación corre a sus puestos.',
  choices: [{ label: 'A las armas', action: { kind: 'fight' } }],
}

/** Dramatic single-choice intro for the sector boss. */
export const BOSS_ENCOUNTER: CombatEncounterDef = {
  id: 'boss_intro',
  title: 'El Acorazado Hegemón',
  text: 'La mole del Acorazado Hegemón ocupa el horizonte, erizada de torretas. No hay rutas alternativas, ni peajes, ni huida posible: solo el puño del sector y tu nave. Es ahora.',
  choices: [{ label: 'Que empiece la batalla', action: { kind: 'fight' } }],
}
