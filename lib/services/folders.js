'use strict';

/**
 * IMENIA — Lógica de carpetas: creación, renombrado, contraseña y borrado.
 * Cada carpeta de la app equivale a una subcarpeta física
 * data/images/<id>_<slug> (el id evita colisiones; el slug la hace legible).
 */

const fs = require('fs');
const path = require('path');
const paths = require('../paths');
const security = require('../security');
const session = require('../session');
const db = require('../db');

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function getFolderOrThrow(id) {
  const row = db.get('SELECT * FROM folders WHERE id = ?', [Number(id)]);
  if (!row) {
    const err = new Error('La carpeta no existe.');
    err.code = 'NO_FOLDER';
    throw err;
  }
  return row;
}

/** Devuelve un slug físico que no exista ni en la BD ni en disco. */
function availableSlug(desired) {
  for (let i = 0; i < 300; i++) {
    const candidate = i === 0 ? desired : `${desired}-${i}`;
    const inDb = db.get('SELECT id FROM folders WHERE storage_dir = ?', [candidate]);
    const inFs = fs.existsSync(paths.folderDir(candidate));
    if (!inDb && !inFs) return candidate;
  }
  return `${desired}-${Date.now()}`;
}

/** DTO de carpeta para la UI (nunca expone hash ni salt). */
function toDto(row, imageCount = 0) {
  const id = Number(row.id);
  return {
    id,
    name: row.name,
    isProtected: !!row.password_hash,
    isUnlocked: !!row.password_hash && session.isUnlocked(id),
    imageCount: Number(imageCount) || 0,
    createdAt: row.created_at,
  };
}

function listFolders() {
  const rows = db.all('SELECT * FROM folders ORDER BY name COLLATE NOCASE');
  const counts = new Map(db.imageCounts());
  return rows.map((r) => toDto(r, counts.get(Number(r.id)) || 0));
}

function createFolder({ name, password }) {
  const cleanName = security.sanitizeBaseName(name, 100);
  if (!cleanName) {
    throw new Error('El nombre de la carpeta no es válido (¿vacío o solo caracteres ilegales?).');
  }
  if (db.get('SELECT id FROM folders WHERE name = ?', [cleanName])) {
    throw new Error(`Ya existe una carpeta llamada «${cleanName}».`);
  }
  let hash = null;
  let salt = null;
  if (password !== undefined && password !== null && String(password).length > 0) {
    const pw = String(password);
    if (pw.length < 4) {
      throw new Error('La contraseña debe tener al menos 4 caracteres (o déjala vacía para no protegerla).');
    }
    if (pw.length > 256) throw new Error('La contraseña no puede superar 256 caracteres.');
    const hashed = security.hashPassword(pw);
    hash = hashed.hash;
    salt = hashed.salt;
  }
  const slug = availableSlug(security.slugifyDir(cleanName));
  fs.mkdirSync(paths.folderDir(slug), { recursive: true });
  db.run(
    'INSERT INTO folders (name, storage_dir, password_hash, password_salt) VALUES (?, ?, ?, ?)',
    [cleanName, slug, hash, salt],
  );
  db.persist();
  return toDto(getFolderOrThrow(db.lastInsertRowId()), 0);
}

function renameFolder(id, newName) {
  const folder = getFolderOrThrow(id);
  const cleanName = security.sanitizeBaseName(newName, 100);
  if (!cleanName) throw new Error('El nuevo nombre de la carpeta no es válido.');
  const clash = db.get('SELECT id FROM folders WHERE name = ? AND id != ?', [cleanName, Number(id)]);
  if (clash) throw new Error(`Ya existe otra carpeta llamada «${cleanName}».`);

  // Físico: si es posible, la subcarpeta se renombra para seguir siendo legible.
  // Si falla (p. ej. un visor externo tiene un fichero abierto), se conserva el
  // directorio actual: `storage_dir` es SIEMPRE la verdad de dónde vive cada fichero.
  let usedSlug = folder.storage_dir;
  const desiredSlug = security.slugifyDir(cleanName);
  if (desiredSlug !== folder.storage_dir) {
    const candidate = availableSlug(desiredSlug);
    try {
      fs.renameSync(paths.folderDir(folder.storage_dir), paths.folderDir(candidate));
      usedSlug = candidate;
    } catch { /* se conserva el directorio actual */ }
  }
  db.run('UPDATE folders SET name = ?, storage_dir = ?, updated_at = ? WHERE id = ?',
    [cleanName, usedSlug, now(), Number(id)]);
  db.persist();
  return toDto(getFolderOrThrow(id));
}

function deleteFolder(id) {
  const folder = getFolderOrThrow(id);
  // Mismo volumen → mover a la papelera interna es instantáneo.
  const trashTarget = path.join(paths.getTrashDir(), `${Date.now()}_${folder.storage_dir}`);
  try {
    fs.renameSync(paths.folderDir(folder.storage_dir), trashTarget);
  } catch (err) {
    throw new Error(
      'No se pudieron mover los archivos a la papelera interna. Cierra los visores externos ' +
      'que puedan tener las imágenes abiertas e inténtalo de nuevo. (' + err.message + ')',
    );
  }
  db.run('DELETE FROM folders WHERE id = ?', [Number(id)]); // CASCADE → images, image_tags
  db.persist();
  session.lock(id);
  return { deleted: true };
}

function setPassword(id, currentPassword, newPassword) {
  const folder = getFolderOrThrow(id);
  if (folder.password_hash) {
    const ok = security.verifyPassword(currentPassword || '', folder.password_salt, folder.password_hash);
    if (!ok) {
      const err = new Error('La contraseña actual no es correcta.');
      err.code = 'WRONG_PASSWORD';
      throw err;
    }
  }
  if (newPassword === null || newPassword === undefined || String(newPassword).length === 0) {
    db.run('UPDATE folders SET password_hash = NULL, password_salt = NULL, updated_at = ? WHERE id = ?',
      [now(), Number(id)]);
    session.lock(id);
  } else {
    const pw = String(newPassword);
    if (pw.length < 4) throw new Error('La nueva contraseña debe tener al menos 4 caracteres.');
    if (pw.length > 256) throw new Error('La contraseña no puede superar 256 caracteres.');
    const hashed = security.hashPassword(pw);
    db.run('UPDATE folders SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?',
      [hashed.hash, hashed.salt, now(), Number(id)]);
    session.lock(id); // tras cambiarla, exige la nueva contraseña
  }
  db.persist();
  return toDto(getFolderOrThrow(id));
}

function unlockFolder(id, password) {
  const folder = getFolderOrThrow(id);
  const ok = security.verifyPassword(password || '', folder.password_salt, folder.password_hash);
  if (!ok) {
    const err = new Error('Contraseña incorrecta.');
    err.code = 'WRONG_PASSWORD';
    throw err;
  }
  session.unlock(id);
  return toDto(folder);
}

function lockFolder(id) {
  session.lock(id);
  return { locked: true };
}

module.exports = {
  listFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  setPassword,
  unlockFolder,
  lockFolder,
  getFolderOrThrow,
};
