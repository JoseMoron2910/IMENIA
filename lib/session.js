'use strict';

/**
 * IMENIA — Sesión de desbloqueo de carpetas.
 *
 * Las carpetas con contraseña están "bloqueadas": no se listan, no se ven sus
 * miniaturas (el protocolo imenia-img:// devuelve 403) ni se exportan, hasta
 * que el usuario introduce la contraseña correcta. El desbloqueo vive solo en
 * memoria y se pierde al cerrar la aplicación (o al bloquear manualmente).
 */

const unlockedFolderIds = new Set();

module.exports = {
  isProtected(folderRow) {
    return !!(folderRow && folderRow.password_hash);
  },
  isUnlocked(folderId) {
    return unlockedFolderIds.has(Number(folderId));
  },
  isViewable(folderRow) {
    if (!folderRow) return false;
    if (!folderRow.password_hash) return true;
    return unlockedFolderIds.has(Number(folderRow.id));
  },
  unlock(folderId) {
    unlockedFolderIds.add(Number(folderId));
  },
  lock(folderId) {
    unlockedFolderIds.delete(Number(folderId));
  },
  lockAll() {
    unlockedFolderIds.clear();
  },
};
