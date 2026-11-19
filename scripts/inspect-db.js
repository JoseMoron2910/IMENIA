'use strict';

/* IMENIA — Inspector de la base de datos (solo lectura).
   Uso: node scripts/inspect-db.js            (usa data/ real)
        IMENIA_DATA_DIR=... node scripts/inspect-db.js
*/

const fs = require('fs');
const path = require('path');

async function main() {
  const initSqlJs = require('sql.js');
  const root = path.join(__dirname, '..');
  const dataDir = process.env.IMENIA_DATA_DIR
    ? path.resolve(process.env.IMENIA_DATA_DIR)
    : path.join(root, 'data');
  const dbFile = path.join(dataDir, 'imenia.db');

  console.log('dataDir =', dataDir);
  if (!fs.existsSync(dbFile)) {
    console.log('RESULT: la BD no existe todavía');
    return;
  }
  console.log('bd size =', fs.statSync(dbFile).size, 'bytes');

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbFile));

  const show = (sql) => {
    try {
      const result = db.exec(sql);
      console.log(sql, '=>', JSON.stringify(result.map((r) => r.values)));
    } catch (err) {
      console.log(sql, 'ERR:', err.message);
    }
  };

  show('SELECT id, name, storage_dir, (password_hash IS NOT NULL) AS protegida FROM folders');
  show('SELECT COUNT(*) AS imagenes FROM images');
  show('SELECT COUNT(*) AS tags FROM tags');
  show('SELECT COUNT(*) AS asignaciones FROM image_tags');
  show("SELECT key, value FROM app_meta WHERE key = 'schema_version'");

  if (fs.existsSync(path.join(dataDir, 'images'))) {
    for (const entry of fs.readdirSync(path.join(dataDir, 'images'))) {
      const full = path.join(dataDir, 'images', entry);
      if (fs.statSync(full).isDirectory()) {
        console.log('carpeta física en disco:', entry,
          '·', fs.readdirSync(full).filter((f) => !f.startsWith('.')).length, 'archivos');
      }
    }
  }
}

main().catch((err) => { console.error('INSPECT_ERROR', err); process.exit(1); });
