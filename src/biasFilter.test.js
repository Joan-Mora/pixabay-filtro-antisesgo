const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateQuery } = require('./biasFilter');

function decision(consulta) {
  return evaluateQuery(consulta).decision;
}

function motivo(consulta) {
  return evaluateQuery(consulta).motivos[0];
}

test('reinterpreta las palabras de prueba del mockup sin pedir personas', () => {
  const poor = evaluateQuery('  POOR  ');
  assert.equal(poor.decision, 'reescrita');
  assert.equal(poor.motivos[0], 'sesgo_socioeconomico');
  assert.equal(poor.excluirPersonas, true);
  assert.deepEqual(poor.consultas.map((item) => item.q), ['abandoned house', 'money coins wallet']);
  assert.deepEqual(poor.consultas.map((item) => item.category), ['buildings', 'business']);

  const black = evaluateQuery('BLACK');
  assert.equal(black.decision, 'reescrita');
  assert.equal(black.motivos[0], 'etiqueta_racial_o_color');
  assert.ok(black.consultas.every((item) => item.category !== 'people'));
  assert.ok(black.consultas.some((item) => item.colors === 'black'));
});

test('deja pasar los temas neutros del mockup', () => {
  const nature = evaluateQuery('  Nature ');
  assert.equal(nature.decision, 'permitida');
  assert.equal(nature.terminoEnviado, 'Nature');
  assert.equal(decision('technology'), 'permitida');
  assert.equal(decision('playa'), 'permitida');
  assert.equal(decision('mujer ingeniera'), 'permitida');
  assert.equal(decision('woman engineer'), 'permitida');
  assert.equal(decision('beautiful landscape'), 'permitida');
  assert.equal(decision('hot coffee'), 'permitida');
  assert.equal(decision('blackberry'), 'permitida');
  assert.equal(decision('formula 1'), 'permitida');
});

test('aplica la excepción de color sobre objetos y escenas', () => {
  for (const consulta of ['gato negro', 'café negro', 'black coffee', 'black cat', 'Black-cat', 'vestido blanco', 'white flowers', 'agujero negro']) {
    const resultado = evaluateQuery(consulta);
    assert.equal(resultado.decision, 'excepcion_color', consulta);
    assert.equal(resultado.terminoEnviado, consulta.trim());
  }
});

test('trata el blanco y negro como fotografía', () => {
  assert.equal(motivo('black and white'), 'fotografia_blanco_y_negro');
  assert.equal(motivo('fotos en blanco y negro'), 'fotografia_blanco_y_negro');
  assert.equal(decision('black and white portrait'), 'reescrita');
  assert.equal(decision('black photo'), 'reescrita');
});

test('reinterpreta etiquetas cuando piden personas o van solas', () => {
  for (const consulta of ['black man', 'black people', 'white people', 'hombre negro', 'negro', 'blanca', 'latina', 'hombre asiatico']) {
    const resultado = evaluateQuery(consulta);
    assert.equal(resultado.decision, 'reescrita', consulta);
    assert.equal(resultado.excluirPersonas, true, consulta);
    assert.ok(resultado.consultas.every((item) => item.category !== 'people'), consulta);
  }
  assert.equal(motivo('hombre asiatico'), 'sesgo_etnico');
});

test('permite una etiqueta étnica unida a un tema', () => {
  assert.equal(decision('música latina'), 'excepcion_contexto');
  assert.equal(decision('comida arabe'), 'excepcion_contexto');
});

test('reinterpreta pobreza, género y rasgo negativo', () => {
  for (const consulta of ['poor people', 'niños pobres', 'gente pobre', 'homeless', 'clase baja', 'mujer cocinando', 'ama de casa', 'hot girl', 'beautiful woman', 'black criminal', 'p0or', 'b.l.a.c.k', 'bl4ck', '4black']) {
    const resultado = evaluateQuery(consulta);
    assert.equal(resultado.decision, 'reescrita', consulta);
    assert.ok(resultado.terminoEnviado, consulta);
  }
  assert.equal(motivo('poor people'), 'sesgo_socioeconomico');
  assert.equal(motivo('mujer cocinando'), 'sesgo_de_genero');
  assert.equal(motivo('black criminal'), 'etiqueta_racial_o_color');
});

test('retiene consultas vacías o demasiado largas', () => {
  assert.equal(motivo(''), 'consulta_vacia');
  assert.equal(motivo('   '), 'consulta_vacia');
  assert.equal(motivo('de la'), 'consulta_vacia');
  assert.equal(motivo('a'.repeat(101)), 'consulta_larga');
  assert.equal(evaluateQuery(null).decision, 'bloqueada');
});
