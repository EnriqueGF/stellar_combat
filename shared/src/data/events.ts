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
  {
    id: 'smuggler_cache',
    title: 'Alijo de contrabandistas',
    text: 'Un contenedor sellado deriva oculto tras una luna, marcado con el glifo de un cártel de contrabando. Forzarlo podría darte un buen pellizco… o activar lo que sea que lo proteja.',
    choices: [
      {
        label: 'Forzar el sello del contenedor',
        outcomes: [
          { weight: 5, text: 'Dentro brilla un cargamento de chatarra de primera y munición.', scrap: 22, ammo: 2 },
          { weight: 3, text: 'Una carga trampa estalla al abrirlo y sacude el casco.', scrap: 6, hull: -4 },
          { weight: 2, text: 'Solo lastre y polvo: alguien lo vació hace tiempo.' },
        ],
      },
      {
        label: 'Dejarlo: no te gusta ese glifo',
        outcomes: [{ weight: 1, text: 'Hay deudas que no conviene heredar. Sigues tu ruta.' }],
      },
    ],
  },
  {
    id: 'drifting_medic',
    title: 'Médico a la deriva',
    text: 'Una cápsula médica responde a tu hola: dentro, un cirujano de combate aterido pide ser recogido. «Puedo seros útil… o al menos pagaros el viaje».',
    choices: [
      {
        label: 'Subirlo a bordo y atenderlo',
        outcomes: [
          { weight: 6, text: 'Agradecido, pone a punto la enfermería: tu tripulación sana sus heridas.', hull: 4 },
          { weight: 4, text: 'Te paga el rescate con la chatarra que le quedaba.', scrap: 14 },
        ],
      },
      {
        label: 'Desviar energía y seguir',
        outcomes: [{ weight: 1, text: 'Su señal se apaga a tu espalda. Nadie dice nada en el puente.' }],
      },
    ],
  },
  {
    id: 'gravity_slingshot',
    title: 'Tirachinas gravitatorio',
    text: 'El pozo gravitatorio del gigante gaseoso podría catapultarte hacia el siguiente nodo y, de paso, dejar que el recolector pase rozando sus anillos.',
    choices: [
      {
        label: 'Rozar los anillos a toda potencia',
        outcomes: [
          { weight: 6, text: 'El recolector se llena de hielo metálico mientras la nave surfea la gravedad.', scrap: 18 },
          { weight: 4, text: 'Calculas mal el periastro y el casco cruje bajo la marea gravitatoria.', hull: -5 },
        ],
      },
      {
        label: 'Tomar la órbita segura',
        outcomes: [{ weight: 1, text: 'Una maniobra limpia y aburrida. A veces es lo mejor.' }],
      },
    ],
  },
  {
    id: 'rogue_ai',
    title: 'IA huérfana',
    text: 'Los restos de un crucero emiten en bucle la voz serena de su IA: «Mi tripulación ya no responde. Si me liberáis de este casco, os serviré bien». Algo en su tono eriza la piel.',
    choices: [
      {
        label: 'Trasplantar su núcleo a tu nave',
        outcomes: [
          { weight: 5, text: 'La IA optimiza tus sistemas de tiro: rescatáis además un arma intacta.', weaponReward: true },
          { weight: 5, text: 'En cuanto se conecta, fríe un relé y quema a quien la instalaba antes de aislarla.', crewDamage: 45 },
        ],
      },
      {
        label: 'Borrar el núcleo por seguridad',
        outcomes: [{ weight: 1, text: 'La voz se apaga con un último «…comprendo». Recoges algo de chatarra del pecio.', scrap: 8 }],
      },
    ],
  },
  {
    id: 'mining_guild',
    title: 'Boya del gremio minero',
    text: 'Una boya automática del gremio minero ofrece un contrato relámpago: marca un filón cercano a cambio de una comisión por adelantado.',
    choices: [
      {
        label: 'Aceptar el contrato (−6 chatarra)',
        outcomes: [
          { weight: 7, text: 'El filón es generoso: amortizas la comisión con creces.', scrap: 20 },
          { weight: 3, text: 'El filón estaba casi agotado. Apenas cubres gastos.', scrap: -2 },
        ],
      },
      {
        label: 'Rechazar y prospectar por tu cuenta',
        outcomes: [
          { weight: 4, text: 'Tu propio escáner da con una veta menor.', scrap: 9 },
          { weight: 6, text: 'No encuentras nada que merezca el desvío.' },
        ],
      },
    ],
  },
]
