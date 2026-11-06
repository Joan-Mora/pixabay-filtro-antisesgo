const { MongoClient } = require('mongodb');

const COLECCION = 'actividad';

let client;
let database;

function uri() {
  return process.env.MONGODB_URI || 'mongodb://127.0.0.1:27018/pixabay_taller';
}

async function connect() {
  const nuevo = new MongoClient(uri(), { serverSelectionTimeoutMS: 4000 });
  try {
    await nuevo.connect();
    const db = nuevo.db();
    const col = db.collection(COLECCION);
    await col.createIndex({ usuario: 1, tipo: 1, creadaEn: -1 });
    await col.createIndex(
      { usuario: 1, pixabayId: 1, accion: 1 },
      { unique: true, partialFilterExpression: { tipo: 'imagen' } }
    );
    client = nuevo;
    database = db;
    return database;
  } catch (error) {
    await nuevo.close().catch(() => {});
    throw error;
  }
}

function getDb() {
  return database || null;
}

function coleccion() {
  if (!database) return null;
  return database.collection(COLECCION);
}

async function close() {
  if (client) await client.close();
  client = undefined;
  database = undefined;
}

module.exports = { connect, getDb, coleccion, close, COLECCION };
