import type { GameEventDef } from '../types.js'

// GAME_SPEC §4.1 — eventos de texto con resultados probabilísticos.
// weight = peso relativo dentro de la opción elegida.

export const GAME_EVENTS: GameEventDef[] = [
  {
    id: 'derelict',
    title: 'Nave a la deriva',
    text: 'Los sensores detectan un carguero sin energía flotando en la sombra del planeta. Su bodega podría estar intacta… o ser una trampa.',
    choices: [
      {
        label: 'Abordar y registrar la bodega',
        outcomes: [
          { weight: 5, text: 'La bodega está llena de chatarra aprovechable.', scrap: 25 },
          { weight: 2, text: 'Un sistema de seguridad provoca un incendio a bordo. Te llevas algo de chatarra.', scrap: 10, hull: -2 },
          { weight: 3, text: 'Alguien llegó antes: solo quedan estanterías vacías.' },
        ],
      },
      {
        label: 'Seguir de largo',
        outcomes: [{ weight: 1, text: 'Mejor no arriesgarse. La nave se pierde en la oscuridad.' }],
      },
    ],
  },
  {
    id: 'distress',
    title: 'Señal de socorro',
    text: 'Una cápsula de escape emite una señal débil desde el anillo de escombros: «…sin oxígeno… por favor…».',
    choices: [
      {
        label: 'Acudir al rescate',
        outcomes: [
          { weight: 6, text: 'El superviviente te recompensa con los créditos de su difunta nave.', scrap: 18 },
          { weight: 4, text: '¡Era un cebo pirata! Encajas varios impactos antes de escapar.', hull: -4 },
        ],
      },
      {
        label: 'Ignorar la señal',
        outcomes: [{ weight: 1, text: 'La señal se apaga lentamente tras de ti.' }],
      },
    ],
  },
  {
    id: 'pirate_toll',
    title: 'Peaje pirata',
    text: 'Una fragata corsaria bloquea tu ruta orbital: «10 de chatarra y nadie sale herido».',
    choices: [
      {
        label: 'Pagar el peaje (−10 chatarra)',
        outcomes: [{ weight: 1, text: 'Los piratas te escoltan con sorna hasta el límite del nodo.', scrap: -10 }],
      },
      {
        label: 'Negarte y acelerar',
        outcomes: [
          { weight: 5, text: 'Tu maniobra los pilla desprevenidos: escapas sin un rasguño.' },
          {
            weight: 5,
            text: 'Te persiguen disparando: el casco sufre y un garfio magnético te roba parte de la carga.',
            hull: -4,
            scrap: -8,
          },
        ],
      },
    ],
  },
  {
    id: 'asteroid_field',
    title: 'Campo de asteroides',
    text: 'Un cinturón de asteroides ricos en mineral cruza tu trayectoria. Atravesarlo ahorraría tiempo y quizá algo más.',
    choices: [
      {
        label: 'Atravesarlo recolectando mineral',
        outcomes: [
          { weight: 5, text: 'El recolector funciona a pleno rendimiento entre las rocas.', scrap: 20 },
          { weight: 5, text: 'Un fragmento impacta de lleno contra el casco.', hull: -5 },
        ],
      },
      {
        label: 'Rodearlo con cuidado',
        outcomes: [{ weight: 1, text: 'Tardas más, pero llegas de una pieza.' }],
      },
    ],
  },
  {
    id: 'abandoned_station',
    title: 'Estación abandonada',
    text: 'Una estación minera orbita en silencio sobre el polo del planeta. El muelle de carga sigue presurizado.',
    choices: [
      {
        label: 'Atracar y explorar',
        outcomes: [
          { weight: 4, text: 'En el arsenal queda un arma operativa. ¡A bordo con ella!', weaponReward: true },
          { weight: 4, text: 'Rescatas chatarra de los talleres.', scrap: 12 },
          { weight: 2, text: 'Un mamparo cede y hiere a un tripulante durante el registro.', crewDamage: 30 },
        ],
      },
      {
        label: 'No detenerse',
        outcomes: [{ weight: 1, text: 'La estación queda atrás, muda como una lápida.' }],
      },
    ],
  },
  {
    id: 'merchant',
    title: 'Mercader errante',
    text: 'Un bazar ambulante despliega sus antenas: «¡Munición fresca, mejor precio del cuadrante!».',
    choices: [
      {
        label: 'Comprar 4 misiles (−8 chatarra)',
        outcomes: [{ weight: 1, text: 'El mercader carga los misiles en tu bodega silbando una melodía.', scrap: -8, ammo: 4 }],
      },
      {
        label: 'Declinar la oferta',
        outcomes: [{ weight: 1, text: '«Tú te lo pierdes, capitán». El bazar pliega velas.' }],
      },
    ],
  },
  {
    id: 'ion_storm',
    title: 'Tormenta iónica',
    text: 'Una tormenta iónica envuelve el nodo. Cruzarla ahora ahorraría combustible, pero los rayos lamen el casco.',
    choices: [
      {
        label: 'Cruzar la tormenta',
        outcomes: [
          { weight: 6, text: 'Surfeas las corrientes iónicas sin un solo arañazo.', scrap: 8 },
          { weight: 4, text: 'Una descarga recorre los pasillos y electrocuta a un tripulante.', crewDamage: 35 },
        ],
      },
      {
        label: 'Esperar a que amaine',
        outcomes: [{ weight: 1, text: 'Pierdes un tiempo precioso, pero la nave lo agradece.' }],
      },
    ],
  },
  {
    id: 'battle_wreck',
    title: 'Restos de batalla',
    text: 'Dos cruceros destrozados giran lentamente entre nubes de combustible congelado. Los restos brillan, prometedores.',
    choices: [
      {
        label: 'Recuperar chatarra de los restos',
        outcomes: [
          { weight: 7, text: 'Una cosecha excelente de placas y componentes.', scrap: 25 },
          { weight: 3, text: 'Un reactor dañado detona cerca durante el salvamento.', scrap: 8, hull: -3 },
        ],
      },
      {
        label: 'Alejarse: huele a trampa',
        outcomes: [{ weight: 1, text: 'Prudencia ante todo. Los restos quedan atrás.' }],
      },
    ],
  },
  {
    id: 'alien_probe',
    title: 'Sonda alienígena',
    text: 'Un artefacto de origen desconocido escanea tu nave con un haz violeta. No parece hostil… todavía.',
    choices: [
      {
        label: 'Estudiarla de cerca',
        outcomes: [
          { weight: 5, text: 'Sus aleaciones exóticas valen una fortuna en chatarra.', scrap: 30 },
          { weight: 5, text: 'La sonda libera una descarga defensiva contra el tripulante que la manipulaba.', crewDamage: 40 },
        ],
      },
      {
        label: 'Destruirla a distancia',
        outcomes: [{ weight: 1, text: 'Recoges algunos fragmentos humeantes.', scrap: 5 }],
      },
    ],
  },
  {
    id: 'refugees',
    title: 'Convoy de refugiados',
    text: 'Tres transportes maltrechos huyen del avance de la Hegemonía. Piden suministros para llegar al siguiente sistema.',
    choices: [
      {
        label: 'Donar suministros (−10 chatarra)',
        outcomes: [
          { weight: 3, text: 'Como agradecimiento, su mecánico te regala un arma que rescataron.', scrap: -10, weaponReward: true },
          { weight: 7, text: 'Te despiden con lágrimas y bendiciones. La tripulación sonríe.', scrap: -10 },
        ],
      },
      {
        label: 'No puedes permitírtelo',
        outcomes: [{ weight: 1, text: 'El convoy se aleja renqueando hacia la oscuridad.' }],
      },
    ],
  },
]
