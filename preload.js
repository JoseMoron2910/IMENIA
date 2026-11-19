'use strict';

/**
 * IMENIA — Puente seguro entre la interfaz (renderer) y el proceso principal.
 * El renderer NO tiene acceso a Node ni al sistema de archivos: solo a esta API.
 */

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

const api = {
  folders: {
    list: () => invoke('folders:list'),
    create: (data) => invoke('folders:create', data),
    rename: (id, newName) => invoke('folders:rename', id, newName),
    remove: (id) => invoke('folders:delete', id),
    setPassword: (id, currentPassword, newPassword) => invoke('folders:setPassword', id, currentPassword, newPassword),
    unlock: (id, password) => invoke('folders:unlock', id, password),
    lock: (id) => invoke('folders:lock', id),
  },
  images: {
    /** scope: 'all' | folderId ; search: string opcional */
    list: (scope, search) => invoke('images:list', scope, search),
    import: (folderId) => invoke('images:import', folderId),
    openEditor: (imageId) => invoke('images:openEditor', imageId),
    remove: (imageId) => invoke('images:delete', imageId),
  },
  editor: {
    get: (imageId) => invoke('editor:get', imageId),
    update: (imageId, patch) => invoke('editor:update', imageId, patch),
    delete: (imageId) => invoke('images:delete', imageId),
    /** Lista ordenada de imágenes de la misma carpeta + índice de la actual. */
    siblings: (imageId) => invoke('editor:neighbors', imageId),
    /** Avisa de que esta ventana de editor ahora muestra otra imagen. */
    moved: (fromId, toId) => invoke('editor:moved', fromId, toId),
  },
  tags: {
    list: () => invoke('tags:list'),
  },
  exportDataset: {
    /** scope: 'all' | folderId */
    run: (scope) => invoke('export:run', scope),
  },
  app: {
    openPath: (targetPath) => invoke('app:openPath', targetPath),
  },
};

contextBridge.exposeInMainWorld('imenia', api);
