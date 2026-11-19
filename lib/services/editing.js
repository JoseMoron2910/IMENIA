'use strict';

/**
 * IMENIA — Edición de metadatos de una imagen:
 * renombrado físico del archivo (misma carpeta, extensión intacta),
 * descripción y sincronización de tags.
 */

const fs = require('fs');
const paths = require('../paths');
const security = require('../security');
const session = require('../session');
const db = require('../db');

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function assertViewableFolder(folderRow) {
  if (!session.isViewable(folderRow)) {
    const err = new Error('La carpeta está bloqueada: introduce la contraseña en la biblioteca para desbloquearla.');
    err.code = 'FOLDER_LOCKED';
    throw err;
  }
}

/** Normaliza y valida un array de tags de entrada. */
function normalizeTags(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const tag = security.sanitizeBaseName(String(raw), 64);
    if (!tag || tag.length < 1) continue;
    const lower = tag.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(tag);
    if (out.length >= 128) break;
  }
  return out;
}

/** Carga la imagen + su carpeta y exige sesión desbloqueada. */
function getImageContext(imageId) {
  const row = db.get(
    `SELECT i.*, f.name AS folder_name, f.storage_dir, f.password_hash
       FROM images i JOIN folders f ON f.id = i.folder_id
      WHERE i.id = ?`,
    [Number(imageId)],
  );
  if (!row) {
    const err = new Error('La imagen no existe (quizá fue borrada).');
    err.code = 'NO_IMAGE';
    throw err;
  }
  assertViewableFolder(row);
  return row;
}

function toPayload(row, tagNames) {
  return {
    id: Number(row.id),
    folderId: Number(row.folder_id),
    folderName: row.folder_name,
    filename: row.filename,        // base sin extensión
    ext: row.ext,
    displayFilename: row.filename + row.ext,
    originalFilename: row.original_filename,
    description: row.description || '',
    tags: tagNames,
    width: row.width,
    height: row.height,
    sizeBytes: Number(row.size_bytes),
    mime: row.mime,
    src: `imenia-img://${Number(row.id)}`,
    updatedAt: row.updated_at,
  };
}

function getEditorPayload(imageId) {
  const row = getImageContext(imageId);
  const tags = db.imageTagNames(row.id);
  return toPayload(row, tags);
}

/**
 * Actualiza nombre/description/tags. El renombrado es FÍSICO:
 * cambia el nombre real del archivo en disco (la extensión no se toca).
 */
function updateImage(imageId, patch = {}) {
  const row = getImageContext(imageId);
  const changes = {};

  /* 1) Renombrado físico ------------------------------------------ */
  const desiredBase = patch.name !== undefined
    ? security.sanitizeBaseName(String(patch.name), 120)
    : row.filename;

  if (desiredBase && desiredBase !== row.filename) {
    // Colisiones: DB (case-insensitive) y sistema de archivos.
    const taken = new Set(
      db.all('SELECT filename FROM images WHERE folder_id = ? AND id != ?', [row.folder_id, row.id])
        .map((r) => String(r.filename).toLowerCase()),
    );
    const newBase = security.uniqueName(desiredBase, (candidate, lower) => {
      if (taken.has(lower)) return false;
      return !fs.existsSync(paths.imageFile(row.storage_dir, candidate, row.ext));
    });
    const oldFile = paths.imageFile(row.storage_dir, row.filename, row.ext);
    const newFile = paths.imageFile(row.storage_dir, newBase, row.ext);
    try {
      fs.renameSync(oldFile, newFile);
    } catch (err) {
      throw new Error('No se pudo renombrar el archivo en disco: ' + err.message);
    }
    changes.filename = newBase;
  }

  /* 2) Descripción -------------------------------------------------- */
  if (patch.description !== undefined) {
    const description = String(patch.description || '').trim();
    if (description.length > 8000) throw new Error('La descripción no puede superar los 8000 caracteres.');
    if (description !== (row.description || '')) changes.description = description;
  }

  /* 3) Tags ---------------------------------------------------------- */
  if (Array.isArray(patch.tags)) {
    const tags = normalizeTags(patch.tags);
    db.tx(() => {
      db.replaceImageTags(row.id, tags);
      db.pruneOrphanTags();
    });
  }

  /* 4) Persistir columnas ------------------------------------------- */
  if (Object.keys(changes).length > 0) {
    db.run(
      `UPDATE images
          SET filename = COALESCE(?, filename),
              description = COALESCE(?, description),
              updated_at = ?
        WHERE id = ?`,
      [changes.filename ?? null, changes.description ?? null, now(), row.id],
    );
  }
  db.persist();
  return getEditorPayload(imageId);
}

/**
 * Vecinos de navegación del editor: ids de todas las imágenes de la misma
 * carpeta en el MISMO orden que la galería (created_at DESC, id DESC) más
 * el índice de la actual. El editor lo usa para ‹ Anterior / Siguiente ›.
 */
function getNeighbors(imageId) {
  const row = db.get('SELECT folder_id FROM images WHERE id = ?', [Number(imageId)]);
  if (!row) {
    const err = new Error('La imagen no existe.');
    err.code = 'NO_IMAGE';
    throw err;
  }
  const ids = db.all(
    'SELECT id FROM images WHERE folder_id = ? ORDER BY created_at DESC, id DESC',
    [Number(row.folder_id)],
  ).map((r) => Number(r.id));
  const index = ids.indexOf(Number(imageId));
  if (index === -1) {
    const err = new Error('La imagen ya no existe en la carpeta.');
    err.code = 'NO_IMAGE';
    throw err;
  }
  return { ids, index };
}

module.exports = {
  getEditorPayload,
  updateImage,
  normalizeTags,
  getNeighbors,
};
