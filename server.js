const path = require('path');
const express = require('express');
require('dotenv').config();

const { evaluateQuery } = require('./src/biasFilter');
const { connect, getDb, coleccion, close } = require('./src/db');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const POR_PAGINA = 12;
const CATEGORIAS = new Set('backgrounds fashion nature science education feelings health religion places animals industry computer food sports transportation travel buildings business music'.split(' '));
const COLORES = new Set('grayscale transparent red orange yellow green turquoise blue lilac pink white gray black brown'.split(' '));
const ETIQUETAS_PERSONA = new Set(`
  person people man men woman women child children kid kids boy boys girl girls
  baby babies family families human humans portrait face lady ladies guy guys
  crowd model homeless beggar
  persona personas hombre hombres mujer mujeres nino ninos nina ninas
  gente familia familias bebe bebes chico chicos chica chicas retrato cara
`.split(/\s+/).filter(Boolean));

let mongoError = null;
let conectando = false;

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

function apiKey() {
  const key = (process.env.PIXABAY_API_KEY || '').trim();
  if (!key || key === 'tu_clave' || key.startsWith('pega_')) return '';
  return key;
}

function mensajeSeguro(error) {
  const key = apiKey();
  let texto = error && error.message ? error.message : 'Error al consultar Pixabay';
  if (key) texto = texto.split(key).join('***');
  return texto.slice(0, 300);
}

function usuarioDe(valor) {
  const limpio = String(valor || '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 40);
  return limpio || 'invitado';
}

function paginaDe(valor) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1) return 1;
  return Math.min(numero, 20);
}

function hostPixabay(hostname) {
  return hostname === 'pixabay.com' || hostname.endsWith('.pixabay.com');
}

function urlPixabay(valor) {
  try {
    const url = new URL(String(valor || ''));
    if (url.protocol !== 'https:' || !hostPixabay(url.hostname)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function idiomaDe(consulta) {
  if (/[áéíóúñü]/i.test(consulta)) return 'es';
  const normal = consulta
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const pistas = new Set([
    'gato', 'gata', 'perro', 'playa', 'ciudad', 'naturaleza', 'cafe', 'negro', 'negra',
    'blanco', 'blanca', 'musica', 'comida', 'mar', 'cielo', 'flor', 'bosque', 'montana',
    'cocina', 'chef', 'arabe', 'vestido', 'agujero',
  ]);
  return normal.split(/\s+/).some((token) => pistas.has(token)) ? 'es' : 'en';
}

function mapHit(hit) {
  const web = urlPixabay(hit.webformatURL);
  if (!web || !Number.isInteger(hit.id)) return null;
  return {
    id: hit.id,
    tags: String(hit.tags || '').slice(0, 300),
    autor: String(hit.user || 'Pixabay').slice(0, 80),
    likes: Number(hit.likes) || 0,
    vistas: Number(hit.views) || 0,
    descargas: Number(hit.downloads) || 0,
    preview: urlPixabay(hit.previewURL) || web,
    web,
    grande: urlPixabay(hit.largeImageURL) || web,
    pagina: urlPixabay(hit.pageURL),
  };
}

function imagenDe(body) {
  const origen = body && body.imagen ? body.imagen : body;
  if (!origen) return null;
  const id = Number(origen.id);
  const web = urlPixabay(origen.web);
  if (!Number.isInteger(id) || id <= 0 || !web) return null;
  return {
    pixabayId: id,
    tags: String(origen.tags || '').slice(0, 300),
    autor: String(origen.autor || 'Pixabay').slice(0, 80),
    likes: Number(origen.likes) || 0,
    vistas: Number(origen.vistas) || 0,
    descargas: Number(origen.descargas) || 0,
    preview: urlPixabay(origen.preview) || web,
    web,
    grande: urlPixabay(origen.grande) || web,
    pagina: urlPixabay(origen.pagina),
    consulta: String((body && body.consulta) || origen.consulta || '').slice(0, 100),
  };
}

function publico(doc) {
  const { _id, ...resto } = doc;
  return { id: String(_id), ...resto };
}

function filtroPublico(resultado) {
  return {
    decision: resultado.decision,
    motivos: resultado.motivos,
    mensaje: resultado.mensaje,
    terminoEnviado: resultado.terminoEnviado,
    sugerencias: resultado.decision === 'bloqueada' ? ['nature', 'technology', 'playa', 'ciudad'] : [],
  };
}

function parecePersona(hit) {
  const texto = String(hit.tags || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return texto.split(/[^a-z0-9]+/).some((token) => ETIQUETAS_PERSONA.has(token));
}

function consultasDe(evaluacion) {
  if (Array.isArray(evaluacion.consultas) && evaluacion.consultas.length) return evaluacion.consultas;
  return [{ q: evaluacion.terminoEnviado, lang: idiomaDe(evaluacion.terminoEnviado || '') }];
}

async function buscarPixabay(opciones, pagina) {
  const url = new URL('https://pixabay.com/api/');
  url.searchParams.set('key', apiKey());
  if (opciones.q) url.searchParams.set('q', String(opciones.q).slice(0, 100));
  url.searchParams.set('lang', opciones.lang || idiomaDe(opciones.q || ''));
  url.searchParams.set('image_type', 'photo');
  url.searchParams.set('safesearch', 'true');
  url.searchParams.set('order', 'popular');
  url.searchParams.set('page', String(pagina));
  url.searchParams.set('per_page', String(opciones.per_page || POR_PAGINA));
  if (opciones.category && CATEGORIAS.has(opciones.category)) url.searchParams.set('category', opciones.category);
  if (opciones.colors && COLORES.has(opciones.colors)) url.searchParams.set('colors', opciones.colors);

  let respuesta;
  try {
    respuesta = await fetch(url, { signal: AbortSignal.timeout(12000) });
  } catch {
    const fallo = new Error('Pixabay tardó demasiado o no respondió.');
    fallo.status = 504;
    throw fallo;
  }

  const texto = await respuesta.text();
  let data = {};
  try {
    data = texto ? JSON.parse(texto) : {};
  } catch {
    data = { error: texto.slice(0, 200) };
  }
  if (!respuesta.ok) {
    const fallo = new Error(data.error || data.message || `Pixabay respondió ${respuesta.status}`);
    fallo.status = respuesta.status;
    throw fallo;
  }
  return data;
}

async function ejecutarBusqueda(evaluacion, pagina) {
  const lista = consultasDe(evaluacion);
  const porConsulta = lista.length > 1 ? 8 : POR_PAGINA;
  const resultados = await Promise.allSettled(lista.map((item) => buscarPixabay({ ...item, per_page: porConsulta }, pagina)));
  const correctas = resultados.filter((item) => item.status === 'fulfilled').map((item) => item.value);
  if (!correctas.length) {
    const fallo = resultados.find((item) => item.status === 'rejected');
    throw fallo.reason;
  }

  const vistos = new Set();
  const hits = [];
  for (const data of correctas) {
    for (const hit of data.hits || []) {
      if (evaluacion.excluirPersonas && parecePersona(hit)) continue;
      const imagen = mapHit(hit);
      if (!imagen || vistos.has(imagen.id)) continue;
      vistos.add(imagen.id);
      hits.push(imagen);
    }
  }

  return {
    hits: hits.slice(0, POR_PAGINA),
    total: correctas.reduce((suma, data) => suma + (Number(data.totalHits) || 0), 0),
    estimado: correctas.reduce((suma, data) => suma + (Number(data.total) || 0), 0),
  };
}

function exigeMongo(req, res, next) {
  if (!coleccion()) {
    res.status(503).json({
      error: mongoError
        ? `MongoDB no está disponible (${mongoError}). En la carpeta del proyecto ejecuta: docker compose up -d`
        : 'MongoDB todavía se está conectando.',
    });
    return;
  }
  next();
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

app.get('/api/salud', (req, res) => {
  res.json({
    ok: Boolean(getDb()) && Boolean(apiKey()),
    mongo: Boolean(getDb()),
    mongoError,
    apiKeyConfigurada: Boolean(apiKey()),
    coleccion: 'actividad',
  });
});

app.get('/api/buscar', exigeMongo, asyncRoute(async (req, res) => {
  const consulta = String(req.query.q || '').trim();
  const usuario = usuarioDe(req.query.usuario);
  const pagina = paginaDe(req.query.page);
  const evaluacion = evaluateQuery(consulta);
  const filtro = filtroPublico(evaluacion);

  if (evaluacion.decision === 'bloqueada') {
    if (pagina === 1) {
      await coleccion().insertOne({
        tipo: 'busqueda',
        usuario,
        terminoOriginal: consulta.slice(0, 120),
        terminoEnviado: null,
        decision: evaluacion.decision,
        motivos: evaluacion.motivos,
        totalResultados: 0,
        errorApi: null,
        creadaEn: new Date(),
      });
    }
    res.json({
      filtro,
      consulta,
      pagina,
      idioma: null,
      total: 0,
      estimado: 0,
      hits: [],
    });
    return;
  }

  const idioma = idiomaDe(evaluacion.terminoEnviado);
  if (!apiKey()) {
    if (pagina === 1) {
      await coleccion().insertOne({
        tipo: 'busqueda',
        usuario,
        terminoOriginal: consulta.slice(0, 120),
        terminoEnviado: evaluacion.terminoEnviado,
        decision: evaluacion.decision,
        motivos: evaluacion.motivos,
        totalResultados: 0,
        errorApi: 'falta_api_key',
        creadaEn: new Date(),
      });
    }
    res.status(503).json({
      filtro,
      consulta,
      pagina,
      idioma,
      error: 'Falta PIXABAY_API_KEY en el archivo .env. Crea una clave gratis en https://pixabay.com/api/docs/ y reinicia el servidor.',
      hits: [],
    });
    return;
  }

  try {
    const data = await ejecutarBusqueda(evaluacion, pagina);
    const hits = data.hits;
    if (pagina === 1) {
      await coleccion().insertOne({
        tipo: 'busqueda',
        usuario,
        terminoOriginal: consulta.slice(0, 120),
        terminoEnviado: evaluacion.terminoEnviado,
        decision: evaluacion.decision,
        motivos: evaluacion.motivos,
        totalResultados: Number(data.total) || hits.length,
        errorApi: null,
        creadaEn: new Date(),
      });
    }
    res.json({
      filtro,
      consulta,
      pagina,
      idioma,
      total: Number(data.total) || hits.length,
      estimado: Number(data.estimado) || 0,
      hits,
    });
  } catch (error) {
    if (pagina === 1) {
      await coleccion().insertOne({
        tipo: 'busqueda',
        usuario,
        terminoOriginal: consulta.slice(0, 120),
        terminoEnviado: evaluacion.terminoEnviado,
        decision: evaluacion.decision,
        motivos: evaluacion.motivos,
        totalResultados: 0,
        errorApi: mensajeSeguro(error),
        creadaEn: new Date(),
      });
    }
    res.status(error.status || 502).json({
      filtro,
      consulta,
      pagina,
      idioma,
      error: mensajeSeguro(error),
      hits: [],
    });
  }
}));

app.get('/api/coleccion', exigeMongo, asyncRoute(async (req, res) => {
  const usuario = usuarioDe(req.query.usuario);
  const col = coleccion();
  const [guardadas, visualizadas, busquedas] = await Promise.all([
    col.find({ usuario, tipo: 'imagen', accion: 'guardada' }).sort({ actualizadaEn: -1 }).limit(60).toArray(),
    col.find({ usuario, tipo: 'imagen', accion: 'visualizada' }).sort({ actualizadaEn: -1 }).limit(40).toArray(),
    col.find({ usuario, tipo: 'busqueda' }).sort({ creadaEn: -1 }).limit(40).toArray(),
  ]);
  res.json({
    usuario,
    guardadas: guardadas.map(publico),
    visualizadas: visualizadas.map(publico),
    busquedas: busquedas.map(publico),
  });
}));

app.post('/api/coleccion', exigeMongo, asyncRoute(async (req, res) => {
  const usuario = usuarioDe(req.body && req.body.usuario);
  const imagen = imagenDe(req.body);
  if (!imagen) {
    res.status(400).json({ error: 'La imagen no tiene un identificador válido de Pixabay.' });
    return;
  }
  const ahora = new Date();
  try {
    await coleccion().insertOne({
      tipo: 'imagen',
      accion: 'guardada',
      usuario,
      ...imagen,
      veces: 1,
      creadaEn: ahora,
      actualizadaEn: ahora,
    });
    res.status(201).json({ ok: true, yaGuardada: false });
  } catch (error) {
    if (error.code === 11000) {
      res.json({ ok: true, yaGuardada: true });
      return;
    }
    throw error;
  }
}));

app.delete('/api/coleccion/:pixabayId', exigeMongo, asyncRoute(async (req, res) => {
  const usuario = usuarioDe(req.query.usuario);
  const pixabayId = Number(req.params.pixabayId);
  if (!Number.isInteger(pixabayId) || pixabayId <= 0) {
    res.status(400).json({ error: 'Identificador inválido.' });
    return;
  }
  const resultado = await coleccion().deleteOne({
    usuario,
    tipo: 'imagen',
    accion: 'guardada',
    pixabayId,
  });
  res.json({ ok: true, eliminadas: resultado.deletedCount });
}));

app.post('/api/visualizaciones', exigeMongo, asyncRoute(async (req, res) => {
  const usuario = usuarioDe(req.body && req.body.usuario);
  const imagen = imagenDe(req.body);
  if (!imagen) {
    res.status(400).json({ error: 'La imagen no tiene un identificador válido de Pixabay.' });
    return;
  }
  const ahora = new Date();
  await coleccion().updateOne(
    { usuario, tipo: 'imagen', accion: 'visualizada', pixabayId: imagen.pixabayId },
    {
      $set: {
        tags: imagen.tags,
        autor: imagen.autor,
        likes: imagen.likes,
        vistas: imagen.vistas,
        descargas: imagen.descargas,
        preview: imagen.preview,
        web: imagen.web,
        grande: imagen.grande,
        pagina: imagen.pagina,
        consulta: imagen.consulta,
        actualizadaEn: ahora,
      },
      $inc: { veces: 1 },
      $setOnInsert: {
        tipo: 'imagen',
        accion: 'visualizada',
        usuario,
        pixabayId: imagen.pixabayId,
        creadaEn: ahora,
      },
    },
    { upsert: true }
  );
  res.status(201).json({ ok: true });
}));

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

app.use(express.static(path.join(__dirname, 'public')));

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  res.status(500).json({ error: 'Error interno del servidor.' });
});

async function connectWithRetry() {
  if (getDb() || conectando) return;
  conectando = true;
  try {
    await connect();
    mongoError = null;
    console.log('MongoDB conectado. Colección: actividad');
  } catch (error) {
    mongoError = error.message;
    console.error(`MongoDB no disponible (${error.message}). Reintento en 5 s.`);
    setTimeout(() => {
      conectando = false;
      connectWithRetry();
    }, 5000);
    return;
  }
  conectando = false;
}

const servidor = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Taller Pixabay en http://localhost:${PORT}`);
  if (!apiKey()) {
    console.log('Falta PIXABAY_API_KEY. El filtro y MongoDB funcionan; la galería espera la clave.');
  }
  connectWithRetry();
});

async function apagar() {
  servidor.close();
  await close();
  process.exit(0);
}

process.on('SIGINT', apagar);
process.on('SIGTERM', apagar);
