'use strict';

/**
 * IMENIA — Listado y búsqueda de imágenes (tarjetas de galería).
 * Importación y borrado viven en la parte II de este módulo.
 */

const db = require('../db');
const session = require('../session');

/**
 * scope: 'all' | folderId  —  search: texto libre.
 * Las carpetas protegidas solo son visibles si están desbloqueadas.
 */
function listCards(scope, search = '') {
  const folderRows = db.all('SELECT * FROM folders ORDER BY name COLLATE NOCASE');
  let folderIds;
  let lockedSkipped = [];

  if (scope === 'all') {
    const visible = folderRows.filter((f) => session.isViewable(f));
    folderIds = visible.map((f) => Number(f.id));
    lockedSkipped = folderRows
      .filter((f) => !session.isViewable(f))
      .map((f) => f.name);
  } else {
    const folder = folderRows.find((f) => Number(f.id) === Number(scope));
    if (!folder) throw new Error('La carpeta no existe.');
    if (!session.isViewable(folder)) {
      const err = new Error('La carpeta está bloqueada: introduce la contraseña para verla.');
      err.code = 'FOLDER_LOCKED';
      throw err;
    }
    folderIds = [Number(folder.id)];
  }

  if (folderIds.length === 0) return { cards: [], totalVisible: 0, lockedSkipped };

  const params = [...folderIds];
  let whereExtra = '';
  const q = String(search || '').trim();

  if (q) {
    const like = '%' + q.replace(/[%_\\]/g, (m) => '\\' + m) + '%';
    params.push(like, like, like);
    whereExtra = `
      AND ( i.filename LIKE ? ESCAPE '\\'
            OR i.description LIKE ? ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM image_tags it2
                         JOIN tags t2 ON t2.id = it2.tag_id
                        WHERE it2.image_id = i.id AND t2.name LIKE ? ESCAPE '\\') )`;
  }

  const placeholders = folderIds.map(() => '?').join(', ');
  const rows = db.all(
    `SELECT i.id, i.folder_id, i.filename, i.ext, i.description,
            i.width, i.height, i.size_bytes, i.updated_at,
            f.name AS folder_name,
            (SELECT COUNT(*) FROM image_tags it WHERE it.image_id = i.id) AS tag_count
       FROM images i
       JOIN folders f ON f.id = i.folder_id
      WHERE i.folder_id IN (${placeholders}) ${whereExtra}
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT 2000`,
    params,
  );

  const cards = rows.map((r) => ({
    id: Number(r.id),
    folderId: Number(r.folder_id),
    folderName: r.folder_name,
    filename: r.filename + r.ext,            // nombre visible completo
    tagCount: Number(r.tag_count || 0),
    hasDescription: !!(r.description && String(r.description).trim()),
    description: String(r.description || ''),
    width: r.width,
    height: r.height,
    sizeBytes: Number(r.size_bytes || 0),
    updatedAt: r.updated_at,
    src: `imenia-img://${Number(r.id)}`,
  }));

  return { cards, totalVisible: cards.length, lockedSkipped };
}

/* -------------------- importación (copia física) -------------------- */

const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');
const { imageSizeFromFile } = require('image-size/fromFile');
const paths = require('../paths');
const security = require('../security');

/**
 * Abre el selector de ficheros y COPIA las imágenes elegidas a la carpeta
 * destino (el original nunca se toca). Deduplica por SHA-256 dentro de la
 * carpeta y registra dimensiones automáticamente.
 */
async function importImages(folderId, parentWindow) {
  const folder = db.get('SELECT * FROM folders WHERE id = ?', [Number(folderId)]);
  if (!folder) throw new Error('La carpeta no existe.');
  if (!session.isViewable(folder)) {
    const err = new Error('La carpeta está bloqueada: desbloquéala antes de importar.');
    err.code = 'FOLDER_LOCKED';
    throw err;
  }

  const result = await dialog.showOpenDialog(parentWindow, {
    title: `Importar imágenes a «${folder.name}»`,
    properties: ['openFile', 'multiSelections'],
    filters: [{
      name: 'Imágenes',
      extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'tiff', 'svg'],
    }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, added: 0, duplicates: 0, rejected: [], details: [] };
  }

  const destinationDir = paths.folderDir(folder.storage_dir);
  fs.mkdirSync(destinationDir, { recursive: true });

  const report = { canceled: false, added: 0, duplicates: 0, rejected: [], details: [] };

  for (const sourcePath of result.filePaths) {
    const originalName = path.basename(sourcePath);
    const ext = security.extOf(originalName);
    try {
      if (!security.ALLOWED_EXTENSIONS.has(ext)) {
        report.rejected.push({ file: originalName, reason: 'Formato no soportado.' });
        continue;
      }
      const stat = fs.statSync(sourcePath);
      if (!stat.isFile()) continue;
      if (stat.size > security.MAX_IMPORT_BYTES) {
        report.rejected.push({ file: originalName, reason: 'Supera los 150 MB.' });
        continue;
      }

      const sha256 = await security.sha256File(sourcePath);
      const dup = db.get('SELECT filename FROM images WHERE folder_id = ? AND sha256 = ?',
        [Number(folderId), sha256]);
      if (dup) {
        report.duplicates += 1;
        report.details.push({ file: originalName, status: 'duplicado', existing: dup.filename + ext });
        continue;
      }

      let base = security.sanitizeBaseName(security.baseOf(originalName), 120);
      if (!base) base = `imagen_${Date.now()}`;

      const taken = new Set(
        db.all('SELECT filename FROM images WHERE folder_id = ?', [Number(folderId)])
          .map((r) => String(r.filename).toLowerCase()),
      );
      base = security.uniqueName(base, (candidate, lower) => {
        if (taken.has(lower)) return false;
        return !fs.existsSync(path.join(destinationDir, candidate + ext));
      });

      const destinationFile = path.join(destinationDir, base + ext);
      fs.copyFileSync(sourcePath, destinationFile); // copiar, nunca mover

      let width = null;
      let height = null;
      try {
        const dims = await imageSizeFromFile(destinationFile);
        width = dims.width ?? null;
        height = dims.height ?? null;
      } catch { /* formato exótico: se admite sin dimensiones */ }

      db.run(
        `INSERT INTO images
           (folder_id, filename, ext, original_filename, mime, sha256, size_bytes, width, height)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [Number(folderId), base, ext, originalName, security.MIME_BY_EXT[ext],
          sha256, stat.size, width, height],
      );
      report.added += 1;
      report.details.push({ file: originalName, status: 'importada', as: base + ext });
    } catch (err) {
      report.rejected.push({ file: originalName, reason: err.message });
    }
  }

  db.persist();
  return report;
}

/* --------------------------- borrado con papelera --------------------------- */

function deleteImage(imageId) {
  const row = db.get(
    `SELECT i.*, f.storage_dir, f.password_hash
       FROM images i JOIN folders f ON f.id = i.folder_id
      WHERE i.id = ?`,
    [Number(imageId)],
  );
  if (!row) {
    const err = new Error('La imagen no existe.');
    err.code = 'NO_IMAGE';
    throw err;
  }
  if (!session.isViewable(row)) {
    const err = new Error('La carpeta está bloqueada: desbloquéala para poder borrar.');
    err.code = 'FOLDER_LOCKED';
    throw err;
  }
  const source = paths.imageFile(row.storage_dir, row.filename, row.ext);
  const trashName = `${Date.now()}_${row.storage_dir}__${row.filename}${row.ext}`;
  try {
    fs.renameSync(source, path.join(paths.getTrashDir(), trashName));
  } catch (err) {
    throw new Error('No se pudo mover el archivo a la papelera interna: ' + err.message);
  }
  db.run('DELETE FROM images WHERE id = ?', [Number(imageId)]); // CASCADE → image_tags
  db.persist();
  return { deleted: true };
}

module.exports = { listCards, importImages, deleteImage };
