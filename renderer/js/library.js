'use strict';

/* IMENIA — Pantalla Biblioteca: carpetas en la barra lateral + galería. */

const $ = (sel) => document.querySelector(sel);

const state = {
  scope: 'all',            // 'all' | folderId
  search: '',
  folders: [],
  cards: [],
  ctxFolderId: null,       // carpeta del menú contextual
  unlockTarget: null,      // carpeta en el diálogo de desbloqueo
  renameTarget: null,      // carpeta en el diálogo de renombrado
  pwTarget: null,          // carpeta en el diálogo de contraseña
  delFolderTarget: null,   // carpeta en el diálogo de borrado
  deleteImageId: null,     // imagen en el diálogo de borrado
};

/* ------------------------------ utilidades UI ------------------------------ */

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&' + 'amp;',
    '<': '<' + 'lt;',
    '>': '>' + 'gt;',
    '"': '"' + 'quot;',
    "'": "'" + '#39;',
  }[c]));
}

function toast(message, kind = 'ok') {
  const el = $('#toast');
  el.textContent = message;
  el.dataset.kind = kind;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3200);
}

function humanSize(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function currentFolderDto() {
  return state.folders.find((f) => f.id === state.scope) || null;
}

function activeScopeIsLocked() {
  const f = currentFolderDto();
  if (!f) return false;
  if (state.scope === 'all') return false;
  return f.isProtected && !f.isUnlocked;
}

/* ------------------------------ carga de datos ------------------------------ */

async function refreshFolders() {
  state.folders = await window.imenia.folders.list();
  renderFolders();
  $('#storage-hint').textContent =
    `${state.folders.length} carpeta(s) · datos locales en data/`;
}

async function refreshImages() {
  // Inicio sin búsqueda = pantalla de carpetas (no hay que pedir imágenes).
  if (state.scope === 'all' && !state.search.trim()) {
    state.cards = [];
    renderCards();
    return;
  }
  if (activeScopeIsLocked()) {
    state.cards = [];
  } else {
    const result = await window.imenia.images.list(state.scope, state.search);
    state.cards = result.cards;
  }
  renderCards();
}

async function refreshAll() {
  try {
    await refreshFolders();
    await refreshImages();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

/* ------------------------------ render: carpetas ------------------------------ */

function renderFolders() {
  const list = $('#folder-list');
  list.innerHTML = '';

  // Pseudo-carpeta "Todas"
  const all = document.createElement('button');
  all.className = 'folder-item' + (state.scope === 'all' ? ' active' : '');
  all.innerHTML = `<span class="folder-ico">🏠</span> <span class="folder-name">Inicio</span>`;
  all.addEventListener('click', () => selectScope('all'));
  list.appendChild(all);

  const divider = document.createElement('div');
  divider.className = 'folder-divider';
  list.appendChild(divider);

  for (const folder of state.folders) {
    const item = document.createElement('button');
    item.className = 'folder-item' + (state.scope === folder.id ? ' active' : '');
    const lock = folder.isProtected
      ? `<span class="lock ${folder.isUnlocked ? 'unlocked' : 'locked'}">${folder.isUnlocked ? '🔓' : '🔒'}</span>`
      : '';
    item.innerHTML = `
      <span class="folder-ico">📁</span>
      <span class="folder-name">${escHtml(folder.name)}</span>
      ${lock}
      <span class="folder-count">${folder.imageCount}</span>
      <span class="folder-menu-btn" title="Opciones">⋯</span>`;
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('folder-menu-btn')) {
        // stopPropagation es CLAVE: sin él, el listener global de window ve el
        // mismo click, cree que es un click "fuera" del menú y lo cierra
        // antes de que llegues a verlo.
        e.stopPropagation();
        openContextMenu(e, folder);
        return;
      }
      selectScope(folder.id);
    });
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openContextMenu(e, folder);
    });
    list.appendChild(item);
  }
}

async function selectScope(scope) {
  const folder = typeof scope === 'number' ? state.folders.find((f) => f.id === scope) : null;
  if (folder && folder.isProtected && !folder.isUnlocked) {
    openUnlockDialog(folder);
    return;
  }
  state.scope = scope;
  renderFolders();
  renderScopeTitle();
  await refreshImages();
}

function renderScopeTitle() {
  const title = $('#current-title');
  if (state.scope === 'all') {
    title.textContent = state.search.trim() ? 'Resultados en toda la biblioteca' : 'Carpetas';
  } else {
    const folder = currentFolderDto();
    title.textContent = folder ? folder.name : '—';
  }
}

/* ------------------------- render: galería ------------------------- */

function renderCards() {
  const grid = $('#grid');
  const empty = $('#empty-state');
  const badge = $('#count-badge');
  grid.innerHTML = '';
  grid.className = 'grid';   // filas altas (imágenes); 'grid home' = filas bajas

  // La pantalla de Inicio muestra LAS CARPETAS, no las imágenes.
  // (con texto de búsqueda muestra resultados globales de imágenes)
  if (state.scope === 'all' && !state.search.trim()) {
    renderFolderTiles();
    return;
  }

  const f = currentFolderDto();
  const scopeLocked = state.scope !== 'all' && f && f.isProtected && !f.isUnlocked;

  badge.textContent = scopeLocked
    ? '🔒'
    : `${state.cards.length} imagen(es)` + (state.search ? ` · filtro «${state.search}»` : '');

  if (scopeLocked) {
    empty.hidden = false;
    empty.innerHTML = `
      <div class="empty-icon">🔒</div>
      <h3>Carpeta bloqueada</h3>
      <p>Introduce la contraseña para desbloquear «${escHtml(f.name)}».</p>`;
  } else if (state.cards.length === 0) {
    empty.hidden = false;
    empty.innerHTML = state.search
      ? `<div class="empty-icon">🔍</div><h3>Sin resultados</h3><p>Ninguna imagen coincide con «${escHtml(state.search)}».</p>`
      : `<div class="empty-icon">🖼️</div>
         <h3>Aún no hay imágenes aquí</h3>
         <p>Crea una carpeta y pulsa <b>Importar imágenes</b> para empezar a construir tu dataset.</p>`;
  } else {
    empty.hidden = true;
  }

  for (const card of state.cards) {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.id = card.id;

    const showFolder = state.scope === 'all';
    el.innerHTML = `
      <div class="thumb"><img src="${card.src}" loading="lazy" alt="${escHtml(card.filename)}" draggable="false"></div>
      <div class="card-body">
        <div class="card-title" title="${escHtml(card.filename)}">${escHtml(card.filename)}</div>
        <div class="card-sub">
          <span class="pill" title="Tags">🏷 ${card.tagCount}</span>
          ${card.hasDescription ? '<span class="pill" title="Tiene descripción">📝</span>' : ''}
          ${showFolder ? `<span class="pill" title="Carpeta">📁 ${escHtml(card.folderName)}</span>` : ''}
          ${card.sizeBytes ? `<span class="pill">${escHtml(humanSize(card.sizeBytes))}</span>` : ''}
        </div>
      </div>`;

    // Un clic abre el editor de esa imagen.
    el.addEventListener('click', () => {
      window.imenia.images.openEditor(card.id).catch((err) => toast(err.message, 'error'));
    });
    grid.appendChild(el);
  }
}

/* ------------------ pantalla Inicio: losetas de carpetas ------------------ */

function renderFolderTiles() {
  const grid = $('#grid');
  const empty = $('#empty-state');
  const badge = $('#count-badge');
  grid.innerHTML = '';
  grid.className = 'grid home';   // filas más bajas para las losetas de carpeta
  badge.textContent = `${state.folders.length} carpeta(s)`;

  if (state.folders.length === 0) {
    empty.hidden = false;
    empty.innerHTML = `
      <div class="empty-icon">📁</div>
      <h3>Todavía no hay carpetas</h3>
      <p>Crea tu primera carpeta para empezar a organizar tu dataset.</p>`;
  } else {
    empty.hidden = true;
  }

  // Loseta "+Nueva carpeta" (disponible siempre)
  const newTile = document.createElement('button');
  newTile.type = 'button';
  newTile.className = 'folder-tile tile-new';
  newTile.title = 'Crear una carpeta nueva';
  newTile.innerHTML = `<span class="tile-plus">＋</span><span>Nueva carpeta</span>`;
  newTile.addEventListener('click', () => openNewFolderDialog());
  grid.appendChild(newTile);

  for (const folder of state.folders) {
    const tile = document.createElement('div');
    tile.className = 'folder-tile'
      + (folder.isProtected && !folder.isUnlocked ? ' locked' : '');
    tile.dataset.id = folder.id;
    const lock = folder.isProtected
      ? `<span class="tile-lock">${folder.isUnlocked ? '🔓' : '🔒'}</span>`
      : '';
    tile.innerHTML = `
      <div class="tile-icon">📁</div>
      ${lock}
      <div class="tile-name" title="${escHtml(folder.name)}">${escHtml(folder.name)}</div>
      <div class="tile-meta">${folder.imageCount} imagen(es)</div>
      <button class="folder-menu-btn" type="button" title="Opciones de la carpeta">⋯</button>`;

    tile.addEventListener('click', (e) => {
      if (e.target.classList.contains('folder-menu-btn')) {
        e.stopPropagation(); // evita que el listener global cierre el menú al instante
        openContextMenu(e, folder);
        return;
      }
      selectScope(folder.id); // protegida y bloqueada → pedirá contraseña sola
    });
    tile.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openContextMenu(e, folder);
    });
    grid.appendChild(tile);
  }
}

/* ------------------------- menú contextual ------------------------- */

function openContextMenu(e, folder) {
  const menu = $('#ctx-menu');
  state.ctxFolderId = folder.id;

  const entries = [
    { label: '🖊 Renombrar…', action: () => openRenameDialog(folder) },
    folder.isProtected
      ? { label: '🔑 Cambiar contraseña…', action: () => openSetPasswordDialog(folder) }
      : { label: '🔑 Añadir contraseña…', action: () => openSetPasswordDialog(folder) },
    folder.isProtected && folder.isUnlocked
      ? { label: '🔒 Bloquear ahora', action: () => lockFolderNow(folder.id) }
      : null,
    { label: '🗑 Eliminar…', danger: true, action: () => openDeleteFolderDialog(folder) },
  ].filter(Boolean);

  menu.innerHTML = '';
  for (const entry of entries) {
    const btn = document.createElement('button');
    btn.textContent = entry.label;
    if (entry.danger) btn.classList.add('danger');
    btn.addEventListener('click', async () => {
      hideContextMenu();
      entry.action();
    });
    menu.appendChild(btn);
  }

  menu.hidden = false;
  const x = Math.min(e.clientX + 4, window.innerWidth - menu.offsetWidth - 8);
  const y = Math.min(e.clientY + 4, window.innerHeight - menu.offsetHeight - 8);
  menu.style.left = `${Math.max(8, x)}px`;
  menu.style.top = `${Math.max(8, y)}px`;
}

function hideContextMenu() {
  const menu = $('#ctx-menu');
  menu.hidden = true;
  state.ctxFolderId = null;
}

window.addEventListener('click', (e) => {
  if (!$('#ctx-menu').hidden && !e.target.closest('#ctx-menu')) hideContextMenu();
});
window.addEventListener('blur', hideContextMenu);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#ctx-menu').hidden) hideContextMenu();
});

async function lockFolderNow(folderId) {
  try {
    await window.imenia.folders.lock(folderId);
    if (state.scope === folderId) { /* permanece en la carpeta, ahora bloqueada */ }
    await refreshAll();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ------------------------------ diálogos ------------------------------ */

function wireCloseButtons() {
  document.querySelectorAll('dialog [data-close]').forEach((btn) => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => btn.closest('dialog').close());
  });
}

function openNewFolderDialog() {
  $('#nf-name').value = '';
  $('#nf-password').value = '';
  $('#nf-password2').value = '';
  $('#dlg-new-folder').showModal();
}

function openUnlockDialog(folder) {
  state.unlockTarget = folder.id;
  $('#unlock-folder-name').textContent = `«${folder.name}»`;
  $('#unlock-password').value = '';
  $('#unlock-error').hidden = true;
  $('#dlg-unlock').showModal();
}

function openRenameDialog(folder) {
  state.renameTarget = folder.id;
  $('#rf-name').value = folder.name;
  $('#dlg-rename-folder').showModal();
}

function openSetPasswordDialog(folder) {
  state.pwTarget = folder.id;
  $('#sp-title').textContent = folder.isProtected ? 'Cambiar contraseña' : 'Añadir contraseña';
  $('#sp-current-row').style.display = folder.isProtected ? '' : 'none';
  $('#sp-current').value = '';
  $('#sp-new').value = '';
  $('#dlg-set-password').showModal();
}

function openDeleteFolderDialog(folder) {
  state.delFolderTarget = folder.id;
  state.deleteFolderName = folder.name;
  $('#df-name').textContent = folder.name;
  $('#df-count').textContent = folder.imageCount;
  $('#df-confirm').value = '';
  $('#df-submit').disabled = true;
  $('#dlg-delete-folder').showModal();
}

/* --------------------------- formularios --------------------------- */

$('#form-new-folder').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('#nf-password').value;
  if (pw !== $('#nf-password2').value) { toast('Las contraseñas no coinciden.', 'error'); return; }
  $('#nf-submit').disabled = true;
  try {
    const created = await window.imenia.folders.create({
      name: $('#nf-name').value,
      password: pw || null,
    });
    $('#dlg-new-folder').close();
    toast(`Carpeta «${created.name}» creada ✔`);
    state.scope = created.id;
    await refreshAll();
    renderScopeTitle();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    $('#nf-submit').disabled = false;
  }
});

$('#form-unlock').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await window.imenia.folders.unlock(state.unlockTarget, $('#unlock-password').value);
    $('#dlg-unlock').close();
    toast('Carpeta desbloqueada ✔');
    state.scope = state.unlockTarget;
    await refreshAll();
    renderScopeTitle();
  } catch {
    $('#unlock-error').hidden = false;
  }
});

$('#form-rename-folder').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await window.imenia.folders.rename(state.renameTarget, $('#rf-name').value);
    $('#dlg-rename-folder').close();
    toast('Carpeta renombrada ✔');
    await refreshAll();
    renderScopeTitle();
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#form-set-password').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const next = $('#sp-new').value;
    await window.imenia.folders.setPassword(state.pwTarget, $('#sp-current').value, next || null);
    $('#dlg-set-password').close();
    toast('Contraseña actualizada ✔ (la carpeta queda bloqueada)');
    await refreshAll();
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#df-confirm').addEventListener('input', (e) => {
  const target = String(state.deleteFolderName || '').toLowerCase();
  $('#df-submit').disabled = e.target.value.trim().toLowerCase() !== target;
});

$('#form-delete-folder').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('#df-submit').disabled) return;
  try {
    await window.imenia.folders.remove(state.delFolderTarget);
    $('#dlg-delete-folder').close();
    toast('Carpeta eliminada (archivos en data/.trash/)');
    if (state.scope === state.delFolderTarget) state.scope = 'all';
    await refreshAll();
    renderScopeTitle();
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#di-confirm').addEventListener('click', async () => {
  try {
    await window.imenia.images.remove(state.deleteImageId);
    toast('Imagen eliminada (archivo en data/.trash/)');
    await refreshAll();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    $('#dlg-delete-image').close();
  }
});


/* --------------------------- barra superior --------------------------- */

$('#btn-new-folder').addEventListener('click', openNewFolderDialog);

$('#btn-import').addEventListener('click', async () => {
  if (state.scope === 'all') {
    toast('Selecciona primero una carpeta de la barra lateral para importar.', 'error');
    return;
  }
  try {
    const report = await window.imenia.images.import(state.scope);
    if (report.canceled) return;
    const parts = [`${report.added} importada(s)`];
    if (report.duplicates) parts.push(`${report.duplicates} duplicada(s)`);
    if (report.rejected.length) parts.push(`${report.rejected.length} rechazada(s)`);
    toast('📥 ' + parts.join(' · '), report.rejected.length ? 'error' : 'ok');
    await refreshAll();
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#btn-export').addEventListener('click', async () => {
  try {
    const result = await window.imenia.exportDataset.run(state.scope);
    const scopeName = state.scope === 'all'
      ? 'todas las carpetas visibles'
      : `«${$('#current-title').textContent}»`;
    $('#ex-summary').innerHTML =
      `Se exportaron <b>${result.count}</b> imagen(es) de ${scopeName} a <code>${escHtml(result.dir)}</code>.` +
      (result.lockedSkipped && result.lockedSkipped.length
        ? `<br><br>Se excluyeron por estar bloqueadas: ${result.lockedSkipped.map(escHtml).join(', ')}.`
        : '');
    $('#dlg-export').showModal();
    $('#ex-open').onclick = () => {
      window.imenia.app.openPath(result.dir).catch((err) => toast(err.message, 'error'));
    };
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* ------------------------------ búsqueda ------------------------------ */

let searchTimer = null;
$('#search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const value = e.target.value;
  searchTimer = setTimeout(async () => {
    state.search = value;
    await refreshImages();
  }, 300);
});

/* --------------------------- eventos globales --------------------------- */

// Refresco silencioso al recuperar el foco (p. ej., al cerrar el editor).
window.addEventListener('focus', () => refreshAll());

// Clic derecho en una tarjeta → confirmación de borrado de imagen.
$('#grid').addEventListener('contextmenu', (e) => {
  const el = e.target.closest('.card');
  if (!el) return;
  e.preventDefault();
  const card = state.cards.find((c) => c.id === Number(el.dataset.id));
  if (!card) return;
  state.deleteImageId = card.id;
  $('#di-name').textContent = card.filename;
  $('#dlg-delete-image').showModal();
});

/* ------------------------------ arranque ------------------------------ */

wireCloseButtons();
renderScopeTitle();
refreshAll();

