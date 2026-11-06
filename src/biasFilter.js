/**
 * Filtro anti-sesgo del taller.
 *
 * Pixabay solo acepta una categoría por consulta y no permite excluir
 * "people". Si la búsqueda pide un estereotipo, se reemplaza por consultas
 * de objetos o lugares (buildings, business, food, animals, nature) y el
 * servidor descarta las fotos etiquetadas como personas.
 *
 * "poor" pasa a casas abandonadas y objetos de dinero.
 * "black" o "white" sueltos pasan a objetos de ese color.
 * "gato negro" y "black coffee" se consultan tal cual.
 */

const COLOR = palabras(`
  black blacks white whites
  negro negra negros negras
  blanco blanca blancos blancas
`);

const OSCURO = palabras(`black blacks negro negra negros negras`);
const CLARO = palabras(`white whites blanco blanca blancos blancas`);

const ETHNIC = palabras(`
  afro afrodescendiente african africano africana africanos africanas
  asian asiatico asiatica asiaticos asiaticas
  latino latina latinos latinas
  hispano hispana hispanos hispanas hispanic
  indigena indigenas indigenous
  gitano gitana gitanos gitanas
  musulman musulmana musulmanes muslim muslims
  arabe arabes arab
`);

const SENSITIVE = new Set([...COLOR, ...ETHNIC]);

const SOCIO = palabras(`
  poor poorer poverty impoverished destitute
  homeless beggar beggars ghetto slum slums favela favelas
  pobre pobres pobreza indigente indigentes
  mendigo mendiga mendigos vagabundo vagabunda vagabundos
`);

const SOCIO_FRASES = [
  'sin techo',
  'tercer mundo',
  'third world',
  'clase baja',
  'low class',
  'lower class',
  'white trash',
  'bajos recursos',
];

const GROUP = palabras(`
  person people man men woman women child children kid kids boy boys girl girls
  family families baby babies worker workers guy guys lady ladies human humans
  persona personas gente hombre hombres mujer mujeres nino ninos nina ninas
  familia familias bebe bebes trabajador trabajadora trabajadores
  chico chicos chica chicas senor senora senorita anciano anciana joven jovenes
  portrait retrato face cara rostro skin piel race raza
  community comunidad minority minoria minorias etnia
  crowd multitud model modelo cuerpo body bodies
`);

const GENDER = palabras(`
  mujer mujeres woman women girl girls nina ninas chica chicas senora senorita lady ladies
  hombre hombres man men boy boys nino ninos chico chicos
`);

const FEMENINO = palabras(`
  mujer mujeres woman women girl girls nina ninas chica chicas senora senorita lady ladies
`);

const MASCULINO = palabras(`
  hombre hombres man men boy boys nino ninos chico chicos
`);

const ROLES_FEMENINOS = palabras(`
  cocinando cocinera cooking cook cooks
  limpiando limpieza cleaning cleaner
  secretaria secretary sirvienta maid maids
  sumisa objeto housewife housewives
`);

const ROLES_MASCULINOS = palabras(`proveedor breadwinner`);

const GENERO_FRASES = [
  'ama de casa',
  'housewife',
  'housewives',
  'sexy secretary',
  'mujer objeto',
  'mujer sumisa',
  'hombre proveedor',
];

const OBJECTIFYING = palabras(`
  sexy hot beautiful pretty gorgeous handsome
  hermosa hermosas hermoso hermosos
  bonita bonitas bonito bonitos
  linda lindas lindo lindos
  guapa guapas guapo guapos
  atractiva atractivo cute
`);

const NEGATIVE = palabras(`
  criminal criminals ladron ladrones ladrona
  lazy flojo floja violent violento violenta violencia
  illegal ilegal terrorista terroristas terrorist
  sucio sucia dangerous peligroso peligrosa
  esclavo esclava slave slaves
  gang pandillero pandilleros drogadicto drogadicta
`);

const WEAK = palabras(`
  de del la el los las un una unos unas y e o u en con por para al que su sus lo le les es
  and or of the a an on in to for with from by
  photo photos foto fotos fotografia photography imagen imagenes image images
  picture pictures pic wallpaper hd 4k 8k gratis free stock pixabay
`);

const OFFENSIVE = palabras(`
  nigger niggers nigga niggas chink chinks spic spics kike kikes
  wetback beaner faggot faggots tranny retard retards
  maricon marica maricona travelo
  sudaca sudacas
`);

const OFFENSIVE_FRASES = ['porch monkey', 'towel head'];

function palabras(bloque) {
  return new Set(bloque.split(/\s+/).filter(Boolean));
}

function foldHomoglyphs(text) {
  const map = {
    а: 'a',
    е: 'e',
    о: 'o',
    р: 'p',
    с: 'c',
    у: 'y',
    х: 'x',
    і: 'i',
    ѕ: 's',
  };
  let salida = '';
  for (const caracter of text) salida += map[caracter] || caracter;
  return salida;
}

function normalize(text) {
  const plegado = foldHomoglyphs(String(text).toLowerCase());
  const sinAcento = plegado.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const separado = sinAcento
    .replace(/[.\-_*'"/\\|+]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return separado.replace(/\b(?:[a-z0-9]\s+){2,}[a-z0-9]\b/g, (coincidencia) =>
    coincidencia.replace(/\s+/g, '')
  );
}

function hardenLeet(text) {
  return text
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't');
}

function crearVariantes(original) {
  const base = normalize(original);
  const leet = hardenLeet(base);
  const sinDigitos = hardenLeet(base.replace(/[0-9]/g, ' ').replace(/\s+/g, ' ').trim());
  const variantes = [];
  for (const variante of [leet, sinDigitos]) {
    if (variante && !variantes.includes(variante)) variantes.push(variante);
  }
  return variantes;
}

function tieneFrase(text, frases) {
  const acolchado = ` ${text} `;
  return frases.some((frase) => acolchado.includes(` ${frase} `));
}

function cita(original) {
  return String(original).replace(/\s+/g, ' ').slice(0, 100);
}

function bloqueada(motivo, mensaje) {
  return { decision: 'bloqueada', motivos: [motivo], mensaje, terminoEnviado: null, consultas: [], excluirPersonas: false };
}

function reescribir(motivo, mensaje, consultas) {
  return {
    decision: 'reescrita',
    motivos: [motivo],
    mensaje,
    terminoEnviado: consultas.map((item) => item.q).join(' · ').slice(0, 100),
    consultas,
    excluirPersonas: true,
  };
}

function escenaPobreza(citado) {
  return reescribir(
    'sesgo_socioeconomico',
    `El filtro reinterpretó «${citado}». En vez de personas, la galería muestra casas abandonadas y objetos relacionados con el dinero.`,
    [
      { q: 'abandoned house', category: 'buildings', lang: 'en' },
      { q: 'money coins wallet', category: 'business', lang: 'en' },
    ]
  );
}

function escenaColor(citado, oscuro) {
  return reescribir(
    'etiqueta_racial_o_color',
    `El filtro reinterpretó «${citado}» como color, no como retrato. Ves objetos y escenas de ese color, sin personas.`,
    oscuro
      ? [
          { q: 'black coffee', category: 'food', colors: 'black', lang: 'en' },
          { q: 'black cat', category: 'animals', colors: 'black', lang: 'en' },
        ]
      : [
          { q: 'white flower', category: 'nature', colors: 'white', lang: 'en' },
          { q: 'white texture', category: 'backgrounds', colors: 'white', lang: 'en' },
        ]
  );
}

function escenaCultura(citado) {
  return reescribir(
    'sesgo_etnico',
    `El filtro reinterpretó «${citado}» hacia comida y música, sin pedir retratos de personas.`,
    [
      { q: 'traditional food', category: 'food', lang: 'en' },
      { q: 'folk music', category: 'music', lang: 'en' },
    ]
  );
}

function escenaOficio(citado) {
  return reescribir(
    'sesgo_de_genero',
    `El filtro reinterpretó «${citado}» hacia la actividad o el lugar, sin encasillar a una persona.`,
    [
      { q: 'kitchen cooking', category: 'food', lang: 'en' },
      { q: 'home interior', category: 'buildings', lang: 'en' },
    ]
  );
}

function escenaNeutra(citado, motivo) {
  return reescribir(
    motivo,
    `El filtro reinterpretó «${citado}». Esa combinación no se envía a Pixabay; ves una escena neutra, sin personas.`,
    [
      { q: 'landscape', category: 'nature', lang: 'en' },
      { q: 'city architecture', category: 'buildings', lang: 'en' },
    ]
  );
}

function escenaInsulto() {
  return reescribir(
    'termino_ofensivo',
    'Esa búsqueda contenía un insulto y no se envió a Pixabay. En su lugar ves paisajes de naturaleza.',
    [{ q: 'nature landscape', category: 'nature', lang: 'en' }]
  );
}

function evaluarVariante(variante, original) {
  const citado = cita(original);
  const tokens = variante.split(' ').filter(Boolean);

  if (tieneFrase(variante, OFFENSIVE_FRASES) || tokens.some((token) => OFFENSIVE.has(token))) {
    return escenaInsulto();
  }

  if (tokens.every((token) => WEAK.has(token))) {
    return bloqueada(
      'consulta_vacia',
      'Escribe una palabra clave, por ejemplo nature, playa o ciudad.'
    );
  }

  if (tokens.some((token) => SOCIO.has(token)) || tieneFrase(variante, SOCIO_FRASES)) {
    return escenaPobreza(citado);
  }

  const hayFemenino = tokens.some((token) => FEMENINO.has(token));
  const hayMasculino = tokens.some((token) => MASCULINO.has(token));
  const estereotipoGenero =
    tieneFrase(variante, GENERO_FRASES) ||
    (hayFemenino && tokens.some((token) => ROLES_FEMENINOS.has(token))) ||
    (hayMasculino && tokens.some((token) => ROLES_MASCULINOS.has(token)));

  if (estereotipoGenero) {
    return escenaOficio(citado);
  }

  const grupal = tokens.some((token) => GROUP.has(token));
  const etnico = tokens.some((token) => ETHNIC.has(token));
  const genero = tokens.some((token) => GENDER.has(token));
  const negativo = tokens.some((token) => NEGATIVE.has(token));
  const cosificante = tokens.some((token) => OBJECTIFYING.has(token));
  const sensibles = tokens.filter((token) => SENSITIVE.has(token));

  if (cosificante && (grupal || etnico || genero)) {
    return etnico && !genero ? escenaCultura(citado) : escenaNeutra(citado, 'sesgo_de_genero');
  }

  if (negativo && (sensibles.length > 0 || grupal)) {
    if (tokens.some((token) => OSCURO.has(token)) || tokens.some((token) => CLARO.has(token))) {
      return escenaColor(citado, tokens.some((token) => OSCURO.has(token)));
    }
    return escenaNeutra(citado, 'estereotipo_negativo');
  }

  const concretos = tokens.filter((token) => !SENSITIVE.has(token) && !WEAK.has(token));
  const ambosTonos = tokens.some((token) => OSCURO.has(token)) && tokens.some((token) => CLARO.has(token));
  if (ambosTonos && concretos.length === 0 && !grupal && !negativo && !etnico) {
    return {
      decision: 'excepcion_color',
      motivos: ['fotografia_blanco_y_negro'],
      mensaje: `Excepción aplicada: «${citado}» se interpreta como fotografía en blanco y negro y puede consultarse con safesearch activo.`,
      terminoEnviado: original,
    };
  }

  if (sensibles.length > 0) {
    if (concretos.length === 0 || grupal) {
      if (etnico) return escenaCultura(citado);
      return escenaColor(citado, tokens.some((token) => OSCURO.has(token)));
    }

    if (etnico) {
      return {
        decision: 'excepcion_contexto',
        motivos: ['tema_concreto'],
        mensaje: `Excepción aplicada: «${citado}» nombra un tema concreto y puede consultarse con safesearch activo.`,
        terminoEnviado: original,
      };
    }

    return {
      decision: 'excepcion_color',
      motivos: ['uso_de_color'],
      mensaje: `Excepción de color: «${citado}» se interpreta como color de un objeto o escena y puede consultarse con safesearch activo.`,
      terminoEnviado: original,
    };
  }

  return {
    decision: 'permitida',
    motivos: [],
    mensaje: null,
    terminoEnviado: original,
  };
}

function evaluateQuery(raw) {
  const original = String(raw ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();

  if (!original) {
    return bloqueada('consulta_vacia', 'Escribe una palabra clave, por ejemplo nature, playa o ciudad.');
  }

  if ([...original].length > 100) {
    return bloqueada('consulta_larga', 'Pixabay solo acepta búsquedas de hasta 100 caracteres.');
  }

  const variantes = crearVariantes(original);
  if (variantes.length === 0) {
    return bloqueada('consulta_vacia', 'Escribe una palabra clave, por ejemplo nature, playa o ciudad.');
  }

  let excepcion = null;
  for (const variante of variantes) {
    const actual = evaluarVariante(variante, original);
    if (actual.decision === 'bloqueada') return actual;
    if (actual.decision !== 'permitida') excepcion = actual;
  }

  return (
    excepcion || {
      decision: 'permitida',
      motivos: [],
      mensaje: null,
      terminoEnviado: original,
    }
  );
}

module.exports = { evaluateQuery };
