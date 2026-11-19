'use strict';

/**
 * IMENIA — Proceso principal (Electron).
 * Responsabilidades: ciclo de vida, ventanas, protocolo seguro de imágenes
 * (imenia-img://) y API IPC que consume el renderer a través de preload.js.
 */

const { app, BrowserWindow, ipcMain, protocol, net, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');

const paths = require('./lib/paths');
const db = require('./lib/db');
const session = require('./lib/session');
const foldersService = require('./lib/services/folders');
const imagesService = require('./lib/services/images');
const editingService = require('./lib/services/editing');
const exporter = require('./lib/exporter');

const IMG_PROTOCOL = 'imenia-img';

let mainWindow = null;
const openEditors = new Map(); // imageId -> BrowserWindow

/* Debe llamarse ANTES de app.ready para que el esquema tenga privilegios. */
protocol.registerSchemesAsPrivileged([
  {
    scheme: IMG_PROTOCOL,
    privileges: { standard: false, secure: true, supportFetchAPI: true, stream: true },
  },
]);

function baseWebPreferences() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: false,
  };
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#0f1117',
    show: false,
    webPreferences: baseWebPreferences(),
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  // Bloquea navegación y ventanas emergentes: la UI vive en archivos locales.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  return mainWindow;
}

function openEditorWindow(imageId) {
  const existing = openEditors.get(Number(imageId));
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return existing;
  }
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 780,
    minHeight: 520,
    backgroundColor: '#0f1117',
    show: false,
    webPreferences: baseWebPreferences(),
  });
  openEditors.set(Number(imageId), win);
  win.loadFile(path.join(__dirname, 'renderer', 'editor.html'), {
    query: { id: String(imageId) },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => openEditors.delete(Number(imageId)));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  return win;
}

/* ------------------------------------------------------------------ */
/* Protocolo seguro de imágenes: imenia-img://<imageId>               */
/* El renderer nunca conoce rutas del disco; el proceso principal     */
/* valida que la carpeta no esté bloqueada antes de servir el fichero. */
/* ------------------------------------------------------------------ */

function parseImageId(urlString) {
  const m = /(\d+)\s*$/.exec(String(urlString || ''));
  return m ? Number(m[1]) : null;
}

function registerImageProtocol() {
  protocol.handle(IMG_PROTOCOL, async (request) => {
    const imageId = parseImageId(request.url);
    if (!imageId) return new Response('id inválido', { status: 400 });

    const row = db.get(
      `SELECT i.filename, i.ext, i.mime, f.password_hash, f.storage_dir
         FROM images i JOIN folders f ON f.id = i.folder_id
        WHERE i.id = ?`,
      [imageId],
    );
    if (!row) return new Response('imagen no encontrada', { status: 404 });
    if (!session.isViewable(row)) return new Response('carpeta bloqueada', { status: 403 });

    const file = paths.imageFile(row.storage_dir, row.filename, row.ext);
    if (!fs.existsSync(file)) return new Response('archivo no encontrado', { status: 404 });

    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set('Content-Type', row.mime || 'application/octet-stream');
    headers.set('Cache-Control', 'no-cache');
    return new Response(response.body, { status: response.status, headers });
  });
}

/* ------------------------------------------------------------------ */
/* API IPC (canal → servicio). Cada canal es una función pura del      */
/* proceso principal; el renderer solo puede llamar por preload.js.   */
/* ------------------------------------------------------------------ */

function on(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (err) {
      const e = new Error(err && err.message ? err.message : 'Error interno');
      if (err && err.code) e.code = err.code;
      console.error(`[IMENIA] IPC ${channel}:`, err && err.stack ? err.stack : err);
      throw e;
    }
  });
}

function registerIpc() {
  on('folders:list', () => foldersService.listFolders());
  on('folders:create', (_e, data) => foldersService.createFolder(data));
  on('folders:rename', (_e, id, newName) => foldersService.renameFolder(id, newName));
  on('folders:delete', (_e, id) => foldersService.deleteFolder(id));
  on('folders:setPassword', (_e, id, current, next) => foldersService.setPassword(id, current, next));
  on('folders:unlock', (_e, id, password) => foldersService.unlockFolder(id, password));
  on('folders:lock', (_e, id) => foldersService.lockFolder(id));

  on('images:list', (_e, scope, search) => imagesService.listCards(scope, search));
  on('images:import', (event, folderId) =>
    imagesService.importImages(folderId, BrowserWindow.fromWebContents(event.sender)));
  on('images:delete', (_e, imageId) => imagesService.deleteImage(imageId));
  on('images:openEditor', (_e, imageId) => {
    openEditorWindow(imageId);
    return { opened: true };
  });

  on('editor:get', (_e, imageId) => editingService.getEditorPayload(imageId));
  on('editor:update', (_e, imageId, patch) => editingService.updateImage(imageId, patch));
  on('editor:neighbors', (_e, imageId) => editingService.getNeighbors(imageId));
  on('editor:moved', (_e, fromId, toId) => {
    // La ventana que mostraba `fromId` ahora muestra `toId`: remapear para que
    // "abrir en el editor" desde la galería reutilice esta ventana y no abra dos.
    const win = openEditors.get(Number(fromId));
    if (win) {
      openEditors.delete(Number(fromId));
      openEditors.set(Number(toId), win);
    }
    return { moved: true };
  });

  on('tags:list', () => db.listTagNames());
  on('export:run', (_e, scope) => exporter.run(scope));
  on('app:openPath', (_e, target) => {
    const abs = path.resolve(String(target || ''));
    if (!abs.toLowerCase().startsWith(paths.getDataDir().toLowerCase())) {
      throw new Error('Ruta no permitida (solo se permite abrir dentro de data/).');
    }
    shell.openPath(abs);
    return { opened: true };
  });
}

/* ------------------------------------------------------------------ */
/* Ciclo de vida                                                      */
/* ------------------------------------------------------------------ */

const isUtilRun = process.argv.includes('--smoke-test')
  || process.argv.includes('--diag')
  || process.argv.includes('--diag-editor');
const gotSingleLock = isUtilRun ? true : app.requestSingleInstanceLock();

if (!gotSingleLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });

  app.whenReady().then(async () => {
    paths.ensureDataTree();
    await db.init();
    registerImageProtocol();
    registerIpc();

    // Modo de prueba automática: valida arranque + BD y sale sin abrir UI.
    if (process.argv.includes('--smoke-test')) {
      console.log('[IMENIA] SMOKE_OK · datos en: ' + paths.getDataDir());
      app.quit();
      return;
    }

    // Modo diagnóstico: abre la biblioteca REAL, mide lo que pinta Chromium y sale.
    // Uso: npx electron . --diag --enable-logging
    if (process.argv.includes('--diag')) {
      const win = createMainWindow();
      win.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          try {
            await win.webContents.executeJavaScript(`(() => {
              const tile = document.querySelector('.folder-tile[data-id]:not(.locked)');
              if (tile) window.selectScope(Number(tile.dataset.id));
              return !!tile;
            })()`);
            await new Promise((res) => setTimeout(res, 1500));
            const info = await win.webContents.executeJavaScript(`(() => {
              const grid = document.querySelector('.grid');
              const thumb = document.querySelector('.card .thumb');
              const imgEl = document.querySelector('.card .thumb img');
              const card = document.querySelector('.card');
              const out = {
                stylesheets: document.styleSheets.length,
                window: [window.innerWidth, window.innerHeight],
                tiles: document.querySelectorAll('.folder-tile').length,
                cards: document.querySelectorAll('.card').length,
              };
              if (grid) {
                const g = getComputedStyle(grid);
                out.grid = { display: g.display, cols: g.gridTemplateColumns,
                  clientH: grid.clientHeight, scrollH: grid.scrollHeight, ovY: g.overflowY };
              }
              if (card) out.card = (() => {
                const r = card.getBoundingClientRect();
                return [Math.round(r.width), Math.round(r.height)];
              })();
              if (thumb) out.thumb = (() => {
                const r = thumb.getBoundingClientRect();
                return [Math.round(r.width), Math.round(r.height)];
              })();
              if (imgEl) {
                const r = imgEl.getBoundingClientRect();
                const c = getComputedStyle(imgEl);
                out.img = { box: [Math.round(r.width), Math.round(r.height)],
                  fit: c.objectFit, pos: c.objectPosition,
                  loaded: imgEl.complete && imgEl.naturalWidth > 0,
                  natural: [imgEl.naturalWidth, imgEl.naturalHeight] };
              }
              return JSON.stringify(out);
            })()`);
            console.log('DIAG_JSON ' + info);
          } catch (err) {
            console.log('DIAG_ERROR ' + (err && err.message ? err.message : err));
          }
          app.quit();
        }, 1800);
      });
      return;
    }

    // Diagnóstico del editor de imágenes: prueba real del comportamiento
    // de los chips de tags (clic en × y clic en el cuadro). No guarda nada.
    if (process.argv.includes('--diag-editor')) {
      const firstImage = db.get(
        `SELECT i.id FROM images i
           JOIN folders f ON f.id = i.folder_id
          WHERE f.password_hash IS NULL
          ORDER BY i.id LIMIT 1`,
      );
      if (!firstImage) {
        console.log('DIAG_EDITOR_JSON {"error":"sin imagenes visibles"}');
        app.quit();
        return;
      }
      const win = openEditorWindow(Number(firstImage.id));
      win.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          try {
            const result = await win.webContents.executeJavaScript(`(async () => {
              const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
              const chipNames = () => [...document.querySelectorAll('#chip-box .chip')]
                .map((c) => (c.childNodes[0] ? String(c.childNodes[0].data).trim() : ''));
              window.addTag('uno');
              window.addTag('dos');
              window.addTag('tres');
              await sleep(80);
              const before = chipNames();
              const log = { before };
              log.xButtons = document.querySelectorAll('#chip-box .chip-x').length;
              // Clic real (con activación completa) en la × del chip central ('dos')
              const xButtons = document.querySelectorAll('#chip-box .chip-x');
              if (xButtons[1]) xButtons[1].click();
              await sleep(150);
              log.afterRemoveMiddle = chipNames();
              // Clic en la zona del cuadro de chips (no en ningún botón)
              document.querySelector('#chip-box').click();
              await sleep(150);
              log.afterBoxClick = chipNames();
              log.inTagFocusedAfterBoxClick =
                document.activeElement === document.querySelector('#in-tag');
              return JSON.stringify(log);
            })()`);
            console.log('DIAG_EDITOR_JSON ' + result);
          } catch (err) {
            console.log('DIAG_EDITOR_ERROR ' + (err && err.message ? err.message : err));
          }
          app.quit();
        }, 1500);
      });
      return;
    }

    createMainWindow();
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => {
    try { db.persist(); } catch (err) { console.error('[IMENIA] persistencia final:', err); }
    session.lockAll();
  });
}
