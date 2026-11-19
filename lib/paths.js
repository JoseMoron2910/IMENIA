'use strict';

/**
 * IMENIA — Rutas portables.
 *
 * Regla de portabilidad:
 *  - En desarrollo: los datos viven en <proyecto>/data/
 *  - Empaquetado:   los datos viven junto al .exe en <exe>/data/
 *  - Override:      variable de entorno IMENIA_DATA_DIR=<carpeta> (para tests/smoke)
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function getAppRoot() {
  return app.isPackaged ? path.dirname(process.execPath) : app.getAppPath();
}

function getDataDir() {
  if (process.env.IMENIA_DATA_DIR) {
    return path.resolve(process.env.IMENIA_DATA_DIR);
  }
  return path.join(getAppRoot(), 'data');
}

const getImagesRoot = () => path.join(getDataDir(), 'images');
const getTrashDir = () => path.join(getDataDir(), '.trash');
const getExportsDir = () => path.join(getDataDir(), 'exports');
const getDbFile = () => path.join(getDataDir(), 'imenia.db');

/** Fichero físico de una imagen: images/<storage_dir>/<filename><ext> */
function imageFile(storageDir, filename, ext) {
  return path.join(getImagesRoot(), storageDir, filename + ext);
}

/** Carpeta física de una carpeta: images/<storage_dir> */
function folderDir(storageDir) {
  return path.join(getImagesRoot(), storageDir);
}

/** Crea (si no existen) todos los directorios de datos. Idempotente. */
function ensureDataTree() {
  const dirs = [getDataDir(), getImagesRoot(), getTrashDir(), getExportsDir()];
  // mkdirSync(recursive) no lanza si ya existen.
  fs.mkdirSync(getImagesRoot(), { recursive: true });
  fs.mkdirSync(getTrashDir(), { recursive: true });
  fs.mkdirSync(getExportsDir(), { recursive: true });
  return dirs;
}

module.exports = {
  getAppRoot,
  getDataDir,
  getImagesRoot,
  getTrashDir,
  getExportsDir,
  getDbFile,
  imageFile,
  folderDir,
  ensureDataTree,
};
