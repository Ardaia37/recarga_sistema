// Banco de dados SQLite (nativo do Node 22.5+, sem instalar nada extra)
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'recargas.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS numeros (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  numero      TEXT NOT NULL UNIQUE,      -- só dígitos, ex: 65999998888
  ddd         TEXT NOT NULL,
  operadora   TEXT NOT NULL,
  apelido     TEXT,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recargas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  numero_id      INTEGER NOT NULL REFERENCES numeros(id) ON DELETE CASCADE,
  data           TEXT NOT NULL,          -- AAAA-MM-DD
  valor          REAL NOT NULL,
  validade_dias  INTEGER NOT NULL,
  vencimento     TEXT NOT NULL,          -- AAAA-MM-DD (data + validade)
  criado_em      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS avisos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  recarga_id  INTEGER NOT NULL REFERENCES recargas(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL,             -- 'antes' | 'hoje' | 'vencido'
  enviado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (recarga_id, tipo)
);

CREATE INDEX IF NOT EXISTS idx_recargas_numero ON recargas(numero_id, data DESC);
`);

module.exports = db;
