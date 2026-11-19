'use strict';

/**
 * IMENIA — Capa de datos (SQLite vía sql.js, WebAssembly).
 *
 * sql.js ejecuta SQLite dentro de un WASM: no hay módulos nativos y, por tanto,
 * no hay problemas de compilación/rebuild en Windows. El coste es que toda la
 * BD vive en memoria y hay que volcarla a disco tras cada mutación (persist()
 * hace un write atómico: temp + rename). Más adelante (v1) se puede migrar a
 * better-sqlite3 sin cambiar el esquema ni apenas el resto del código.
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const paths = require('./paths');

let db = null;      // instancia sql.js
let initPromise = null;

async function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const SQL = await initSqlJs(); // carga wasm automáticamente en Node/Electron main
    const dbFile = paths.getDbFile();
    if (fs.existsSync(dbFile)) {
      db = new SQL.Database(fs.readFileSync(dbFile));
    } else {
      db = new SQL.Database();
    }
    db.run('PRAGMA foreign_keys = ON;');
    migrate();
    persist();
    return db;
  })();
  return initPromise;
}

function migrate() {
  db.run(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS folders (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL COLLATE NOCASE UNIQUE,
      storage_dir   TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT,
      password_salt TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS images (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id         INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      filename          TEXT NOT NULL COLLATE NOCASE,
      ext               TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      mime              TEXT NOT NULL,
      sha256            TEXT NOT NULL,
      size_bytes        INTEGER NOT NULL,
      width             INTEGER,
      height            INTEGER,
      description       TEXT NOT NULL DEFAULT '',
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (folder_id, filename),
      UNIQUE (folder_id, sha256)
    );

    CREATE INDEX IF NOT EXISTS idx_images_sha ON images(sha256);

    CREATE TABLE IF NOT EXISTS tags (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      name_lower TEXT NOT NULL COLLATE NOCASE UNIQUE
    );

    CREATE TABLE IF NOT EXISTS image_tags (
      image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
      tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
      PRIMARY KEY (image_id, tag_id)
    );

    CREATE INDEX IF NOT EXISTS idx_image_tags_tag ON image_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_images_folder  ON images(folder_id);
  `);
  const row = get('SELECT value FROM app_meta WHERE key = ?', ['schema_version']);
  if (!row) setMeta('schema_version', '1');
}

/* ------------------------- helpers SQL ------------------------- */

let dirty = false;

/** Marca la BD como modificada y la vuelca a disco (atómico) de inmediato. */
function persist() {
  if (!dirty || !db) return;
  const buffer = Buffer.from(db.export());
  const dbFile = paths.getDbFile();
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const tmp = dbFile + '.tmp-' + Date.now();
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, dbFile);
  dirty = false;
}

function markDirty() { dirty = true; }

/** Ejecuta una operación de escritura dentro de una transacción. */
function tx(fn) {
  db.run('BEGIN');
  try {
    const result = fn();
    db.run('COMMIT');
    markDirty();
    return result;
  } catch (err) {
    try { db.run('ROLLBACK'); } catch { /* noop */ }
    throw err;
  }
}

function run(sql, params = []) {
  db.run(sql, params);
  markDirty();
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

/* ------------------------- metadatos de la app ------------------------- */

function setMeta(key, value) {
  run(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, String(value)],
  );
}

function getMeta(key) {
  const row = get('SELECT value FROM app_meta WHERE key = ?', [key]);
  return row ? row.value : null;
}

function lastInsertRowId() {
  const result = db.exec('SELECT last_insert_rowid() AS id');
  return Number(result[0].values[0][0]);
}

/* ------------------------- imágenes y tags ------------------------- */

/** Pares [folder_id, nº_imágenes] para los contadores de la barra lateral. */
function imageCounts() {
  return all('SELECT folder_id, COUNT(*) AS c FROM images GROUP BY folder_id')
    .map((r) => [Number(r.folder_id), Number(r.c)]);
}

function imageTagNames(imageId) {
  return all(
    `SELECT t.name FROM image_tags it
       JOIN tags t ON t.id = it.tag_id
      WHERE it.image_id = ?
      ORDER BY t.name COLLATE NOCASE`,
    [Number(imageId)],
  ).map((r) => r.name);
}

/** Tags existentes ordenados por uso (para el autocompletado). */
function listTagNames(limit = 1000) {
  return all(
    `SELECT t.name, COUNT(it.image_id) AS uses
       FROM tags t
       LEFT JOIN image_tags it ON it.tag_id = t.id
      GROUP BY t.id
      ORDER BY uses DESC, t.name COLLATE NOCASE
      LIMIT ?`,
    [Number(limit)],
  ).map((r) => r.name);
}

function ensureTag(name) {
  const lower = String(name).toLowerCase();
  let row = get('SELECT id FROM tags WHERE name_lower = ?', [lower]);
  if (!row) {
    run('INSERT INTO tags (name, name_lower) VALUES (?, ?)', [name, lower]);
    row = get('SELECT id FROM tags WHERE name_lower = ?', [lower]);
  }
  return Number(row.id);
}

/** Sustituye todos los tags de una imagen. Ejecutar dentro de db.tx(). */
function replaceImageTags(imageId, tagNames) {
  const id = Number(imageId);
  run('DELETE FROM image_tags WHERE image_id = ?', [id]);
  for (const name of tagNames) {
    const tagId = ensureTag(name);
    run('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)', [id, tagId]);
  }
}

/** Elimina tags huérfanos (sin ninguna imagen). Ejecutar dentro de db.tx(). */
function pruneOrphanTags() {
  run('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM image_tags)');
}

module.exports = {
  init,
  persist,
  markDirty,
  tx,
  run,
  all,
  get,
  getMeta,
  setMeta,
  lastInsertRowId,
  imageCounts,
  imageTagNames,
  listTagNames,
  ensureTag,
  replaceImageTags,
  pruneOrphanTags,
};
