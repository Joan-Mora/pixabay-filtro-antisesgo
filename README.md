# Pixabay · filtro anti-sesgo

Galería web que consulta la [API de Pixabay](https://pixabay.com/api/docs/), reinterpreta búsquedas que refuerzan estereotipos y guarda la actividad de cada usuario en MongoDB.

Una búsqueda como `poor` no pide retratos de personas. La aplicación la convierte en casas abandonadas y objetos relacionados con el dinero, y descarta las fotos etiquetadas como personas. `gato negro` sí se consulta tal cual, porque ahí el color describe un objeto.

## Contenido

- [Puesta en marcha](#puesta-en-marcha)
- [Variables de entorno](#variables-de-entorno)
- [Qué probar](#qué-probar)
- [Filtro](#filtro)
- [Datos](#datos)
- [API](#api)
- [Estructura](#estructura)

## Puesta en marcha

Requisitos: Node.js 18 o superior, Docker Desktop y una clave gratuita de la [API de Pixabay](https://pixabay.com/api/docs/).

```powershell
docker compose up -d
Copy-Item .env.example .env
npm install
npm start
```

Abre http://localhost:3000 y escribe la clave en `.env`. Reinicia `npm start` después de guardarla.

```powershell
npm test
npm run dev
```

`npm test` comprueba el filtro sin llamar a Pixabay. `npm run dev` reinicia el servidor al guardar un archivo.

MongoDB del proyecto escucha en **27018**. El puerto 27017 queda libre para otra instalación local, como MongoDB Compass apuntando a un servicio distinto. En Compass usa:

```text
mongodb://127.0.0.1:27018
```

Base `pixabay_taller`, colección `actividad`. Esta instancia no tiene usuario ni contraseña.

Si prefieres MongoDB Atlas, cambia `MONGODB_URI` en `.env` por la cadena de conexión del clúster y no levantes el contenedor.

## Variables de entorno

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `PIXABAY_API_KEY` | Sí, para ver fotos | Clave de la API. No se envía al navegador. |
| `MONGODB_URI` | No | Por defecto `mongodb://127.0.0.1:27018/pixabay_taller`. |
| `PORT` | No | Por defecto `3000`. El servidor escucha en `0.0.0.0`. |

`.env` no se versiona. Parte de `.env.example`.

## Qué probar

1. Escribe un nombre de usuario. Cada nombre tiene su propio historial.
2. **NATURE** y **TECHNOLOGY** muestran la galería y registran la búsqueda.
3. **POOR** muestra casas abandonadas y dinero, sin personas.
4. **BLACK** muestra objetos de ese color, como café o un gato.
5. **gato negro** se envía tal cual: el color acompaña a un objeto.
6. **Historial** repite una búsqueda anterior.
7. Abrir una foto registra una visualización. **+ Guardar en Mongo** la deja en la pestaña Colección MongoDB.
8. Cambia el usuario y comprueba que la colección cambia con él.

Otras consultas: `música latina` se permite como tema, `mujer ingeniera` se permite, `mujer cocinando` se reinterpreta hacia la actividad y `fotos en blanco y negro` se trata como fotografía.

## Filtro

La decisión está en `src/biasFilter.js` y se aplica en el servidor. El navegador solo muestra el resultado.

Pixabay acepta una categoría por consulta y no ofrece un parámetro para excluir personas. Cuando la búsqueda pide un estereotipo, el servidor arma otras consultas y descarta las fotos cuyas etiquetas nombran personas.

| Entrada | Qué se consulta | Categoría de Pixabay |
| --- | --- | --- |
| `poor`, `pobre`, `homeless` | `abandoned house` y `money coins wallet` | `buildings` y `business` |
| `black` o `negro` solos, o junto a personas | `black coffee` y `black cat` | `food` y `animals`, con `colors=black` |
| `white` o `blanco` solos, o junto a personas | `white flower` y `white texture` | `nature` y `backgrounds`, con `colors=white` |
| Etiqueta étnica sola o unida a personas | `traditional food` y `folk music` | `food` y `music` |
| Estereotipo de género | `kitchen cooking` y `home interior` | `food` y `buildings` |
| Insulto | `nature landscape` | `nature` |
| `gato negro`, `black coffee` | El texto original | Sin cambio de categoría |

Toda consulta lleva `safesearch=true` e `image_type=photo`. El parámetro `q` no supera 100 caracteres, que es el límite de la API. Pixabay devuelve como máximo 500 imágenes por consulta (`totalHits`).

## Datos

Una sola colección, `actividad`, en la base `pixabay_taller`. El campo `tipo` distingue la forma del documento.

Búsqueda reinterpretada:

```json
{
  "tipo": "busqueda",
  "usuario": "invitado",
  "terminoOriginal": "poor",
  "terminoEnviado": "abandoned house · money coins wallet",
  "decision": "reescrita",
  "motivos": ["sesgo_socioeconomico"],
  "totalResultados": 1000,
  "creadaEn": "2026-11-06T00:00:00.000Z"
}
```

Imagen guardada. Una visualización usa el mismo esquema con `"accion": "visualizada"` y un contador `veces`.

```json
{
  "tipo": "imagen",
  "accion": "guardada",
  "usuario": "invitado",
  "pixabayId": 123,
  "tags": "house, abandoned",
  "autor": "autor",
  "consulta": "poor"
}
```

Hay un índice único parcial sobre `usuario`, `pixabayId` y `accion` para los documentos `tipo: "imagen"`. Una persona no guarda dos veces la misma foto, y la visualización puede convivir con el guardado.

```powershell
docker exec -it pixabay-taller-mongo mongosh pixabay_taller
```

Las consultas de ejemplo están en `consultas.mongodb`.

```javascript
db.actividad.find({ tipo: "busqueda", decision: "reescrita" }).sort({ creadaEn: -1 })
db.actividad.find({ tipo: "imagen", accion: "guardada", usuario: "invitado" })
```

## API

| Método | Ruta | Uso |
| --- | --- | --- |
| `GET` | `/api/salud` | Estado de MongoDB y de la clave |
| `GET` | `/api/buscar?q=&usuario=&page=` | Filtro, registro y fotos |
| `GET` | `/api/coleccion?usuario=` | Guardadas, vistas e historial |
| `POST` | `/api/coleccion` | Guardar una foto |
| `DELETE` | `/api/coleccion/:pixabayId?usuario=` | Quitar una foto guardada |
| `POST` | `/api/visualizaciones` | Registrar que se abrió una foto |

Las imágenes se muestran con atribución a su autor y un enlace a Pixabay, como pide la API. Las URL de vista previa sirven para mostrar resultados; Pixabay no permite dejarlas como enlace permanente en una aplicación publicada.

## Estructura

```text
.
├── public/               Interfaz
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── src/
│   ├── biasFilter.js     Reglas del filtro
│   ├── biasFilter.test.js
│   └── db.js             Conexión e índices
├── server.js             API y proxy de Pixabay
├── docker-compose.yml
├── consultas.mongodb
└── .env.example
```

## Licencia

[MIT](LICENSE). Las fotografías pertenecen a sus autores en Pixabay y se usan según la [Pixabay Content License](https://pixabay.com/service/license-summary/).
