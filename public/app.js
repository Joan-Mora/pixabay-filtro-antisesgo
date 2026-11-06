const estado = {
  consulta: '',
  pagina: 1,
  total: 0,
  hits: [],
  filtro: null,
  error: '',
  cargando: false,
  guardadas: [],
  visualizadas: [],
  busquedas: [],
  tab: 'galeria',
};

let secuencia = 0;
let controlador = null;
let temporizador = 0;

const $ = (selector) => document.querySelector(selector);

document.addEventListener('keydown', (event) => {
  const tecla = event.key.toLowerCase();
  const control = event.ctrlKey || event.metaKey;
  const verCodigo = control && tecla === 'u';
  const inspeccionar = event.key === 'F12' || (control && event.shiftKey && ['i', 'j', 'c'].includes(tecla));
  if (verCodigo || inspeccionar) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

function usuario() {
  const valor = $('#usuario').value.replace(/[<>]/g, '').trim().slice(0, 40);
  return valor || 'invitado';
}

function numero(valor) {
  return new Intl.NumberFormat('es-CO').format(valor || 0);
}

function textoError(codigo) {
  if (!codigo) return '';
  if (codigo === 'falta_api_key') return ' · falta la clave de Pixabay';
  return ` · ${codigo}`;
}

function fecha(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function enlaceSeguro(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const permitido = parsed.protocol === 'https:' && (host === 'pixabay.com' || host.endsWith('.pixabay.com'));
    return permitido ? parsed.href : '';
  } catch {
    return '';
  }
}

function el(tag, attrs = {}, children = []) {
  const nodo = document.createElement(tag);
  Object.entries(attrs).forEach(([clave, valor]) => {
    if (valor == null || valor === false) return;
    if (clave === 'class') nodo.className = valor;
    else nodo.setAttribute(clave, valor);
  });
  [].concat(children).forEach((hijo) => {
    if (hijo == null) return;
    nodo.append(hijo.nodeType ? hijo : document.createTextNode(String(hijo)));
  });
  return nodo;
}

function icono(tipo) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const trazos = {
    corazon: '<path d="M12 19s-7-4.4-7-8.2A3.7 3.7 0 0 1 12 8a3.7 3.7 0 0 1 7 2.8C19 14.6 12 19 12 19z"></path>',
    ojo: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"></path><circle cx="12" cy="12" r="2.5"></circle>',
  };
  svg.innerHTML = trazos[tipo];
  return svg;
}

async function api(url, opciones = {}) {
  const respuesta = await fetch(url, {
    ...opciones,
    headers: {
      'Content-Type': 'application/json',
      ...(opciones.headers || {}),
    },
  });
  const data = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    const error = new Error(data.error || 'No se pudo completar la operación');
    error.data = data;
    error.status = respuesta.status;
    throw error;
  }
  return data;
}

function idsGuardados() {
  return new Set(estado.guardadas.map((item) => item.pixabayId));
}

function pintarAviso(salud) {
  const aviso = $('#aviso-sistema');
  aviso.replaceChildren();
  if (!salud) {
    aviso.hidden = true;
    return;
  }
  const partes = [];
  if (!salud.mongo) {
    partes.push(salud.mongoError
      ? `MongoDB no está conectado (${salud.mongoError}). En la carpeta del proyecto ejecuta docker compose up -d.`
      : 'MongoDB se está conectando.');
  }
  if (!salud.apiKeyConfigurada) {
    partes.push('Falta PIXABAY_API_KEY en el archivo .env. El filtro y el registro funcionan; la galería necesita una clave de Pixabay.');
  }
  if (partes.length === 0) {
    aviso.hidden = true;
    return;
  }
  aviso.hidden = false;
  aviso.className = `banner banner--sistema ${salud.mongo ? 'banner--alerta' : 'banner--error'}`;
  aviso.append(partes.join(' '));
  if (!salud.apiKeyConfigurada) {
    aviso.append(' ');
    aviso.append(el('a', { href: 'https://pixabay.com/api/docs/', target: '_blank', rel: 'noopener noreferrer' }, 'Obtener clave'));
  }
}

function pintarCuentas() {
  $('#cuenta-galeria').textContent = `(${estado.hits.length})`;
  $('#cuenta-mongo').textContent = `(${estado.guardadas.length})`;
}

function crearTarjeta(imagen, modo) {
  const guardada = idsGuardados().has(imagen.id);
  const media = el('button', {
    type: 'button',
    class: 'card__media',
    'data-accion': 'ver',
    'data-id': imagen.id,
    'data-origen': modo,
    'aria-label': `Ver imagen: ${imagen.tags || imagen.autor}`,
  });
  const img = el('img', {
    src: enlaceSeguro(imagen.web || imagen.preview),
    alt: imagen.tags || 'Fotografía de Pixabay',
  });
  img.addEventListener('error', () => {
    img.alt = 'No se pudo cargar la vista previa';
  });
  media.append(img);

  const autor = imagen.pagina && enlaceSeguro(imagen.pagina)
    ? el('a', { href: enlaceSeguro(imagen.pagina), target: '_blank', rel: 'noopener noreferrer' }, imagen.autor)
    : imagen.autor;

  const guardar = el('button', {
    type: 'button',
    class: `card__guardar${guardada ? ' is-guardada' : ''}`,
    'data-accion': guardada ? '' : 'guardar',
    'data-id': imagen.id,
    'data-origen': modo,
  }, guardada ? 'Guardada en Mongo' : '+ Guardar en Mongo');
  if (guardada) guardar.disabled = true;

  return el('article', { class: 'card' }, [
    media,
    el('div', { class: 'card__cuerpo' }, [
      el('p', { class: 'card__tags' }, imagen.tags || 'Sin etiquetas'),
      el('p', { class: 'card__autor' }, ['Autor: ', autor]),
      el('p', { class: 'stats' }, [
        el('span', {}, [icono('corazon'), numero(imagen.likes)]),
        el('span', {}, [icono('ojo'), numero(imagen.vistas)]),
      ]),
      imagen.consulta ? el('p', { class: 'consulta-origen' }, `Búsqueda: ${imagen.consulta}`) : null,
      modo === 'guardada'
        ? el('button', {
          type: 'button',
          class: 'card__guardar',
          'data-accion': 'quitar',
          'data-id': imagen.id,
        }, 'Quitar de Mongo')
        : guardar,
    ]),
  ]);
}

function imagenLocal(id, origen) {
  if (origen === 'guardada') {
    const doc = estado.guardadas.find((item) => item.pixabayId === id);
    return doc ? normalizar(doc) : null;
  }
  return estado.hits.find((item) => item.id === id) || null;
}

function normalizar(doc) {
  return {
    id: doc.pixabayId,
    tags: doc.tags,
    autor: doc.autor,
    likes: doc.likes,
    vistas: doc.vistas,
    descargas: doc.descargas,
    preview: doc.preview,
    web: doc.web,
    grande: doc.grande,
    pagina: doc.pagina,
    consulta: doc.consulta,
  };
}

function pintarGaleria() {
  const panel = $('#galeria');
  panel.replaceChildren();
  pintarCuentas();

  if (estado.cargando) {
    panel.append(el('p', { class: 'cargando', role: 'status' }, 'Buscando…'));
  }

  if (estado.error) {
    panel.append(el('div', { class: 'estado estado--error', role: 'alert' }, [
      el('h3', {}, 'La búsqueda no llegó a la galería'),
      el('p', {}, estado.error),
    ]));
  }

  if (estado.filtro && estado.filtro.mensaje) {
    const tipo = estado.filtro.decision === 'bloqueada' ? 'bloqueada' : estado.filtro.decision;
    const titulo = estado.filtro.decision === 'bloqueada' || estado.filtro.decision === 'reescrita'
      ? 'Filtro anti-sesgo'
      : 'Excepción del filtro';
    const caja = el('div', { class: `estado estado--${tipo}`, role: 'status' }, [
      el('h3', {}, titulo),
      el('p', {}, estado.filtro.mensaje),
    ]);
    if (estado.filtro.sugerencias && estado.filtro.sugerencias.length) {
      const sugerencias = el('div', { class: 'sugerencias' });
      estado.filtro.sugerencias.forEach((sugerencia) => {
        sugerencias.append(el('button', { type: 'button', class: 'chip', 'data-q': sugerencia }, sugerencia));
      });
      caja.append(sugerencias);
    }
    panel.append(caja);
  }

  if (estado.hits.length) {
    const resumen = estado.total
      ? `Mostrando ${numero(estado.hits.length)} de ${numero(estado.total)} fotos · safesearch activo`
      : 'Safesearch activo';
    panel.append(el('p', { class: 'nota' }, resumen));
    const grid = el('div', { class: 'grid' });
    estado.hits.forEach((imagen) => grid.append(crearTarjeta(imagen, 'galeria')));
    panel.append(grid);
  } else if (!estado.cargando && !estado.error && estado.filtro && estado.filtro.decision === 'reescrita') {
    panel.append(el('p', { class: 'vacio' }, 'Pixabay no devolvió fotos para esta reinterpretación.'));
  } else if (!estado.cargando && !estado.error && !(estado.filtro && estado.filtro.decision === 'bloqueada')) {
    panel.append(el('p', { class: 'vacio' }, 'Escribe una palabra o usa una palabra de prueba. Las fotos aparecen en esta misma página.'));
  }

  if (estado.hits.length && estado.hits.length < estado.total && !estado.cargando) {
    panel.append(el('button', { type: 'button', class: 'card__guardar mas', id: 'mas' }, 'Cargar más fotos'));
  }
}

function etiquetaDecision(decision) {
  const nombres = {
    bloqueada: 'Retenida',
    reescrita: 'Reinterpretada',
    permitida: 'Enviada',
    excepcion_color: 'Excepción de color',
    excepcion_contexto: 'Excepción de tema',
  };
  return nombres[decision] || decision;
}

function pintarMongo() {
  const panel = $('#mongo');
  panel.replaceChildren();
  pintarCuentas();

  const encabezado = el('div', { class: 'pestanas' }, [
    el('h3', {}, 'Imágenes guardadas'),
    el('button', { type: 'button', class: 'secundario', id: 'actualizar' }, 'Actualizar'),
  ]);
  panel.append(encabezado);

  if (estado.guardadas.length === 0) {
    panel.append(el('p', { class: 'vacio' }, 'Todavía no hay fotos guardadas. En la galería usa “+ Guardar en Mongo”.'));
  } else {
    const grid = el('div', { class: 'grid' });
    estado.guardadas.forEach((doc) => grid.append(crearTarjeta(normalizar(doc), 'guardada')));
    panel.append(grid);
  }

  const vistas = el('section', { class: 'bloque-mongo' }, [el('h3', {}, 'Imágenes visualizadas')]);
  if (estado.visualizadas.length === 0) {
    vistas.append(el('p', { class: 'vacio' }, 'Al abrir una foto se registra aquí la visualización.'));
  } else {
    const lista = el('ul', { class: 'lista' });
    estado.visualizadas.forEach((doc) => {
      const img = el('img', { src: enlaceSeguro(doc.web || doc.preview), alt: '' });
      lista.append(el('li', { class: 'lista__item' }, [
        img,
        el('div', { class: 'lista__texto' }, [
          el('strong', {}, doc.tags || 'Sin etiquetas'),
          el('p', {}, `${doc.autor} · vista ${numero(doc.veces)} ${doc.veces === 1 ? 'vez' : 'veces'} · ${fecha(doc.actualizadaEn)}`),
        ]),
        el('button', { type: 'button', class: 'secundario', 'data-accion': 'ver', 'data-id': doc.pixabayId, 'data-origen': 'vista' }, 'Abrir'),
      ]));
    });
    vistas.append(lista);
  }
  panel.append(vistas);

  const historial = el('section', { class: 'bloque-mongo' }, [el('h3', {}, 'Historial de búsquedas')]);
  if (estado.busquedas.length === 0) {
    historial.append(el('p', { class: 'vacio' }, 'Cada búsqueda retenida o enviada aparece en este historial.'));
  } else {
    const lista = el('ul', { class: 'historial' });
    estado.busquedas.forEach((item) => {
      lista.append(el('li', { class: 'historial__fila' }, [
        el('span', { class: `pill pill--${item.decision}` }, etiquetaDecision(item.decision)),
        el('div', { class: 'historial__main' }, [
          el('strong', {}, item.terminoOriginal || '(vacía)'),
          el('p', {}, `${fecha(item.creadaEn)} · ${item.totalResultados || 0} resultados${textoError(item.errorApi)}`),
        ]),
        el('button', { type: 'button', class: 'secundario', 'data-q': item.terminoOriginal || '' }, 'Repetir'),
      ]));
    });
    historial.append(lista);
  }
  panel.append(historial);
}

function mostrarTab(tab) {
  estado.tab = tab;
  const galeria = $('#galeria');
  const mongo = $('#mongo');
  galeria.hidden = tab !== 'galeria';
  mongo.hidden = tab !== 'mongo';
  $('#tab-galeria').classList.toggle('is-activa', tab === 'galeria');
  $('#tab-mongo').classList.toggle('is-activa', tab === 'mongo');
  $('#tab-galeria').setAttribute('aria-selected', String(tab === 'galeria'));
  $('#tab-mongo').setAttribute('aria-selected', String(tab === 'mongo'));
  if (tab === 'mongo') pintarMongo();
}

async function cargarColeccion() {
  const data = await api(`/api/coleccion?usuario=${encodeURIComponent(usuario())}`);
  estado.guardadas = data.guardadas || [];
  estado.visualizadas = data.visualizadas || [];
  estado.busquedas = data.busquedas || [];
  pintarCuentas();
  if (!$('#menu-historial').hidden) pintarHistorial();
  if (estado.tab === 'galeria') pintarGaleria();
  else pintarMongo();
}

async function cargarSalud() {
  try {
    const salud = await api('/api/salud');
    pintarAviso(salud);
  } catch (error) {
    pintarAviso({ mongo: false, mongoError: error.message, apiKeyConfigurada: false });
  }
}

async function buscar(consulta, pagina = 1, opciones = {}) {
  const q = String(consulta || '').trim();
  const anexar = opciones.anexar === true;
  const forzar = opciones.forzar === true;
  if (!q) {
    estado.filtro = { decision: 'bloqueada', mensaje: 'Escribe una palabra clave, por ejemplo nature, playa o ciudad.', sugerencias: ['nature', 'technology', 'playa', 'ciudad'] };
    estado.hits = [];
    estado.error = '';
    estado.cargando = false;
    pintarGaleria();
    return;
  }
  if (!anexar && !forzar && q === estado.consulta && pagina === 1 && estado.filtro && !estado.cargando) return;

  const id = ++secuencia;
  if (controlador) controlador.abort();
  controlador = new AbortController();

  if (!anexar && q !== estado.consulta) {
    estado.hits = [];
    estado.filtro = null;
    estado.total = 0;
  }
  estado.consulta = q;
  estado.pagina = pagina;
  estado.cargando = true;
  estado.error = '';
  mostrarTab('galeria');
  pintarGaleria();
  $('#consulta').value = q;

  const params = new URLSearchParams({
    q,
    page: String(pagina),
    usuario: usuario(),
  });

  try {
    const data = await api(`/api/buscar?${params}`, { signal: controlador.signal });
    if (id !== secuencia) return;
    estado.filtro = data.filtro;
    estado.total = data.total || 0;
    estado.pagina = data.pagina || pagina;
    estado.hits = anexar ? estado.hits.concat(data.hits || []) : (data.hits || []);
    estado.cargando = false;
    pintarGaleria();
    cargarColeccion().catch(() => {});
  } catch (error) {
    if (error.name === 'AbortError' || id !== secuencia) return;
    estado.cargando = false;
    estado.error = error.message;
    if (error.data && error.data.filtro) estado.filtro = error.data.filtro;
    if (!anexar && error.data && Array.isArray(error.data.hits)) estado.hits = error.data.hits;
    pintarGaleria();
    cargarColeccion().catch(() => {});
  }

  if (opciones.desplazar) {
    $('.resultados').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function guardar(imagen, boton) {
  boton.disabled = true;
  try {
    await api('/api/coleccion', {
      method: 'POST',
      body: JSON.stringify({ usuario: usuario(), consulta: estado.consulta, imagen }),
    });
    await cargarColeccion();
  } catch (error) {
    boton.disabled = false;
    estado.error = error.message;
    pintarGaleria();
  }
}

async function quitar(id, boton) {
  if (boton.dataset.confirmar !== '1') {
    boton.dataset.confirmar = '1';
    boton.textContent = 'Confirmar quitar';
    setTimeout(() => {
      if (!boton.isConnected) return;
      boton.dataset.confirmar = '0';
      boton.textContent = 'Quitar de Mongo';
    }, 2500);
    return;
  }
  boton.disabled = true;
  await api(`/api/coleccion/${id}?usuario=${encodeURIComponent(usuario())}`, { method: 'DELETE' });
  await cargarColeccion();
}

async function abrir(imagen) {
  const src = enlaceSeguro(imagen.grande || imagen.web);
  if (!src) return;
  const visor = $('#visor');
  const img = $('#visor-img');
  img.src = src;
  img.alt = imagen.tags || 'Fotografía de Pixabay';
  const meta = $('#visor-meta');
  meta.replaceChildren(
    el('p', { class: 'card__tags' }, imagen.tags || 'Sin etiquetas'),
    el('p', {}, `Autor: ${imagen.autor}`),
    imagen.pagina && enlaceSeguro(imagen.pagina)
      ? el('p', {}, el('a', { href: enlaceSeguro(imagen.pagina), target: '_blank', rel: 'noopener noreferrer' }, 'Ver en Pixabay'))
      : null
  );
  if (!visor.open) visor.showModal();
  try {
    await api('/api/visualizaciones', {
      method: 'POST',
      body: JSON.stringify({ usuario: usuario(), consulta: imagen.consulta || estado.consulta, imagen }),
    });
    await cargarColeccion();
  } catch (error) {
    estado.error = error.message;
    if (estado.tab === 'galeria') pintarGaleria();
  }
}

function buscarImagenVista(id) {
  const doc = estado.visualizadas.find((item) => item.pixabayId === id);
  return doc ? normalizar(doc) : null;
}

function busquedasUnicas() {
  const vistas = new Set();
  const lista = [];
  for (const item of estado.busquedas) {
    const termino = String(item.terminoOriginal || '').trim();
    const clave = termino.toLowerCase();
    if (!termino || vistas.has(clave)) continue;
    vistas.add(clave);
    lista.push(item);
    if (lista.length === 10) break;
  }
  return lista;
}

function pintarHistorial() {
  const menu = $('#menu-historial');
  menu.replaceChildren();
  const items = busquedasUnicas();
  if (!items.length) {
    menu.append(el('p', { class: 'nota' }, 'Aún no hay búsquedas. Las próximas quedan en este historial.'));
    return;
  }
  items.forEach((item) => {
    const detalle = item.terminoEnviado && item.terminoEnviado !== item.terminoOriginal
      ? item.terminoEnviado
      : etiquetaDecision(item.decision);
    menu.append(el('button', {
      type: 'button',
      class: 'menu-historial__item',
      role: 'menuitem',
      'data-q': item.terminoOriginal,
    }, [
      el('strong', {}, item.terminoOriginal),
      el('span', {}, detalle),
    ]));
  });
}

function alternarHistorial(abrir) {
  const menu = $('#menu-historial');
  const visible = typeof abrir === 'boolean' ? abrir : menu.hidden;
  menu.hidden = !visible;
  $('#btn-historial').setAttribute('aria-expanded', String(visible));
  if (visible) pintarHistorial();
}

document.addEventListener('click', async (event) => {
  const chip = event.target.closest('[data-q]');
  if (chip && chip.dataset.q) {
    if (chip.closest('.menu-historial')) alternarHistorial(false);
    buscar(chip.dataset.q, 1, { forzar: true, desplazar: true });
    return;
  }

  if (event.target.id === 'btn-historial' || event.target.closest('#btn-historial')) {
    alternarHistorial();
    return;
  }

  if (!event.target.closest('.historial-rapido') && !event.target.closest('.menu-historial')) alternarHistorial(false);

  if (event.target.id === 'mas') {
    buscar(estado.consulta, estado.pagina + 1, { anexar: true, forzar: true });
    return;
  }

  if (event.target.id === 'actualizar') {
    cargarColeccion().catch((error) => {
      estado.error = error.message;
      pintarMongo();
    });
    return;
  }

  const accion = event.target.closest('[data-accion]');
  if (!accion) return;
  const id = Number(accion.dataset.id);
  const origen = accion.dataset.origen;
  const imagen = origen === 'vista' ? buscarImagenVista(id) : imagenLocal(id, origen);
  if (accion.dataset.accion === 'ver' && imagen) abrir(imagen);
  if (accion.dataset.accion === 'guardar' && imagen) guardar(imagen, accion);
  if (accion.dataset.accion === 'quitar') {
    quitar(id, accion).catch((error) => {
      estado.error = error.message;
      pintarMongo();
    });
  }
});

$('#formulario').addEventListener('submit', (event) => {
  event.preventDefault();
  clearTimeout(temporizador);
  buscar($('#consulta').value, 1, { forzar: true, desplazar: true });
});

$('#consulta').addEventListener('input', () => {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => {
    const valor = $('#consulta').value.trim();
    if (valor.length >= 3) buscar(valor, 1);
  }, 450);
});

$('#usuario').addEventListener('change', () => {
  const nombre = usuario();
  $('#usuario').value = nombre;
  localStorage.setItem('pixabay-usuario', nombre);
  cargarColeccion().catch(() => {});
});

$('#tab-galeria').addEventListener('click', () => mostrarTab('galeria'));
$('#tab-mongo').addEventListener('click', () => mostrarTab('mongo'));

$('#visor-cerrar').addEventListener('click', () => $('#visor').close());
$('#visor').addEventListener('click', (event) => {
  if (event.target.id === 'visor') $('#visor').close();
});

const guardado = localStorage.getItem('pixabay-usuario');
if (guardado) $('#usuario').value = guardado;

pintarGaleria();
cargarSalud();
cargarColeccion().catch((error) => {
  estado.error = error.message;
  pintarGaleria();
});
