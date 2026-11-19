'use strict';

/* IMENIA — Pantalla Editor: imagen a la izquierda, formulario a la derecha. */

const $ = (sel) => document.querySelector(sel);

const state = {
  id: null,
  payload: null,
  tags: [],
  dirty: false,
  saving: false,
  siblings: [],       // ids de la carpeta en el mismo orden que la galería
  siblingIndex: -1,    // posición de la imagen actual dentro de siblings
};

/* ------------------------------ utilidades ------------------------------ */

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
  toast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

function markDirty(on) {
  if (state.saving) return;
  state.dirty = on;
  document.title = (state.dirty ? '● ' : '') + 'IMENIA — Editor';
  $('#btn-save').disabled = !state.dirty;
}

/* ------------------------------ chips de tags ------------------------------ */

function renderChips() {
  const box = $('#chip-box');
  box.innerHTML = '';
  const field = box.parentElement;
  for (const [i, tag] of state.tags.entries()) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = tag;
    const x = document.createElement('button');
    x.className = 'chip-x';
    x.type = 'button';
    x.textContent = '×';
    x.title = 'Quitar tag';
    x.addEventListener('click', (e) => {
      e.stopPropagation(); // el clic MUERE aquí: ningún ancestro (label/div) lo reprocesa
      state.tags.splice(i, 1);
      renderChips();
      markDirty(true);
    });
    chip.appendChild(x);
    box.appendChild(chip);
  }
  field.classList.toggle('empty-chips', state.tags.length === 0);
}

function addTag(raw) {
  const value = String(raw || '').trim().replace(/[<>:"/\\|?*]+/g, '');
  if (!value) return;
  const exists = state.tags.some((t) => t.toLowerCase() === value.toLowerCase());
  if (!exists) {
    state.tags.push(value.slice(0, 64));
    renderChips();
    markDirty(true);
  }
  $('#in-tag').value = '';
}

/* ------------------------------ carga inicial ------------------------------ */

async function load() {
  const params = new URLSearchParams(location.search);
  const initialId = Number(params.get('id'));
  try {
    await loadImage(initialId);
  } catch (err) {
    document.body.innerHTML = `<div class="fatal-error"><h3>No se pudo abrir la imagen</h3><p>${escHtml(err.message)}</p></div>`;
  }
}

/** Carga una imagen concreda (usada al abrir y al navegar anterior/siguiente). */
async function loadImage(imageId) {
  const payload = await window.imenia.editor.get(imageId);
  state.id = Number(imageId);
  state.payload = payload;
  state.tags = [...payload.tags];
  fill(payload);
  await refreshNav();
  await fillTagSuggestions();
}

async function fillTagSuggestions() {
  try {
    const names = await window.imenia.tags.list();
    $('#tag-list').innerHTML = names.map((n) => `<option value="${escHtml(n)}"></option>`).join('');
  } catch { /* las sugerencias son opcionales */ }
}

function fill(payload) {
  $('#form-title').textContent = payload.displayFilename;
  document.title = 'IMENIA — ' + payload.displayFilename;
  $('#view-folder').textContent = payload.folderName;
  $('#view-dims').textContent = payload.width && payload.height
    ? `${payload.width} × ${payload.height} px · ${(payload.sizeBytes / 1048576).toFixed(2)} MB`
    : `${(payload.sizeBytes / 1048576).toFixed(2)} MB`;
  $('#the-image').src = payload.src;
  $('#in-name').value = payload.filename;
  $('#ext-badge').textContent = payload.ext;
  $('#in-description').value = payload.description;
  $('#char-count').textContent = `${payload.description.length}/8000 caracteres`;
  renderChips();
  resetZoom(); // cada vez que se (re)carga la imagen, visor al estado "ajustado"
  markDirty(false);
}

/* ------------------------------ guardado ------------------------------ */

async function save() {
  if (!state.payload) return false;
  if (state.saving) return false;
  if (!state.dirty) return true; // no hay cambios pendientes: éxito
  state.saving = true;
  $('#btn-save').disabled = true;
  const patch = {
    name: $('#in-name').value.trim(),
    tags: state.tags,
    description: $('#in-description').value,
  };
  try {
    const updated = await window.imenia.editor.update(state.id, patch);
    state.payload = updated;
    state.tags = [...updated.tags];
    fill(updated);
    const time = new Date().toLocaleTimeString();
    setStatus(`Guardado a las ${time}`);
    toast('Cambios guardados ✔');
    await fillTagSuggestions();
    return true;
  } catch (err) {
    setStatus('Error: ' + err.message, true);
    toast('No se pudo guardar: ' + err.message, 'error');
    return false;
  } finally {
    state.saving = false;
    markDirty($('#in-name').value.trim() !== state.payload.filename
      || $('#in-description').value !== state.payload.description
      || JSON.stringify(state.tags) !== JSON.stringify(state.payload.tags));
  }
}

function setStatus(text, isError = false) {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

/* ------------------- navegación anterior / siguiente ------------------- */
/* Botones ‹ › y atajos Alt+←/Alt+→. Al saltar se autoguarda si hay
   cambios; el recorrido sigue el ORDEN de la galería de la carpeta. */

function updateNavButtons() {
  const total = state.siblings.length;
  $('#btn-prev').disabled = state.siblingIndex <= 0;
  $('#btn-next').disabled = state.siblingIndex >= total - 1;
  $('#nav-position').textContent = total > 0
    ? `${state.siblingIndex + 1} / ${total}`
    : '';
}

async function refreshNav() {
  try {
    const nav = await window.imenia.editor.siblings(state.id);
    state.siblings = nav.ids;
    state.siblingIndex = nav.index;
  } catch {
    state.siblings = state.id ? [state.id] : [];
    state.siblingIndex = state.id ? 0 : -1;
  }
  updateNavButtons();
}

async function goTo(delta) {
  if (state.saving) return;
  const targetId = state.siblings[state.siblingIndex + delta];
  if (!targetId || Number(targetId) === state.id) return;
  const fromId = state.id;

  const saved = await save(); // autoguarda antes de saltar (true si no hay cambios)
  if (!saved) return;         // si falló el guardado, no cambiamos de imagen

  try {
    await loadImage(Number(targetId));
    // informa al proceso principal de que esta ventana ahora muestra otra imagen
    window.imenia.editor.moved(fromId, state.id).catch(() => {});
  } catch (err) {
    toast('No se pudo cambiar de imagen: ' + err.message, 'error');
  }
}

$("#btn-prev").addEventListener('click', () => goTo(-1));
$('#btn-next').addEventListener('click', () => goTo(1));

document.addEventListener('keydown', (e) => {
  if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goTo(-1); }
  else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goTo(1); }
});

/* ------------------------------ eventos ------------------------------ */

$('#in-name').addEventListener('input', () => markDirty(true));
$('#in-description').addEventListener('input', () => {
  markDirty(true);
  $('#char-count').textContent = `${$('#in-description').value.length}/8000 caracteres`;
});

$('#in-tag').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addTag(e.target.value);
  } else if (e.key === 'Backspace' && e.target.value === '' && state.tags.length > 0) {
    state.tags.pop();
    renderChips();
    markDirty(true);
  }
});
$('#in-tag').addEventListener('change', (e) => { if (e.target.value) addTag(e.target.value); });

$('#btn-save').addEventListener('click', save);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  }
});

/* ---------------------------- cierre controlado ---------------------------- */

$('#btn-close').addEventListener('click', askClose);

function askClose() {
  if (!state.dirty) { window.close(); return; }
  $('#dlg-confirm-close').showModal();
}

$('#dlg-confirm-close').addEventListener('click', (e) => {
  const mode = e.target.dataset.close;
  if (mode === 'force') {
    state.dirty = false; // evita el guardián de beforeunload
    window.close();
  } else if (mode) {
    $('#dlg-confirm-close').close();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

/* ------------------------------ eliminación ------------------------------ */

$('#btn-delete').addEventListener('click', () => {
  $('#dlg-confirm-delete').showModal();
  $('#del-confirm').addEventListener('click', async () => {
    try {
      const deletedId = state.id;
      await window.imenia.editor.delete(deletedId);
      state.dirty = false;
      toast('Imagen eliminada');
      // Tras eliminar: salta a la vecina (siguiente → anterior) o cierra.
      const candidate = state.siblings[state.siblingIndex + 1]
        ?? state.siblings[state.siblingIndex - 1]
        ?? null;
      $('#dlg-confirm-delete').close();
      if (candidate) {
        await loadImage(Number(candidate));
        window.imenia.editor.moved(deletedId, state.id).catch(() => {});
        await refreshNav(); // la lista "heredada" incluye a la borrada: refrescar
        updateNavButtons();
      } else {
        setTimeout(() => window.close(), 350);
      }
    } catch (err) {
      toast('No se pudo eliminar: ' + err.message, 'error');
      $('#dlg-confirm-delete').close();
    }
  }, { once: true });
});

/* --------------------------- zoom del visor --------------------------- */
/* Clic: ampliar 2.5x · Rueda: ajustar el nivel · Arrastrar: moverse
   Doble clic o botón "⟲ Ajustar": volver al ajuste. */

const stage = document.querySelector('.viewer-stage');
const zoomImg = $('#the-image');
const btnFit = $('#btn-fit');
const zoomHint = $('#zoom-hint');

const zoom = { scale: 1, x: 0, y: 0, dragging: false, sx: 0, sy: 0, moved: false };

function applyZoom() {
  zoomImg.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
  const active = zoom.scale > 1.001;
  zoomImg.classList.toggle('zoomed', active);
  btnFit.hidden = !active;
  zoomHint.hidden = !active;
}

function resetZoom() {
  zoom.scale = 1;
  zoom.x = 0;
  zoom.y = 0;
  applyZoom();
}

function setZoomScale(next) {
  zoom.scale = Math.min(10, Math.max(1, next));
  if (zoom.scale === 1) { zoom.x = 0; zoom.y = 0; }
  applyZoom();
}

zoomImg.addEventListener('wheel', (e) => {
  e.preventDefault(); // la rueda hace zoom, no scroll de página
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  setZoomScale(zoom.scale * factor);
}, { passive: false });

zoomImg.addEventListener('mousedown', (e) => {
  if (zoom.scale <= 1.001) return; // solo se arrastra cuando está ampliada
  zoom.dragging = true;
  zoom.moved = false;
  zoom.sx = e.clientX;
  zoom.sy = e.clientY;
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!zoom.dragging) return;
  const dx = e.clientX - zoom.sx;
  const dy = e.clientY - zoom.sy;
  if (Math.abs(dx) + Math.abs(dy) > 3) zoom.moved = true;
  zoom.x += dx;
  zoom.y += dy;
  zoom.sx = e.clientX;
  zoom.sy = e.clientY;
  applyZoom();
});

window.addEventListener('mouseup', () => { zoom.dragging = false; });

zoomImg.addEventListener('click', () => {
  if (zoom.moved) return;               // fue un arrastre, no un clic real
  if (zoom.scale > 1.001) resetZoom();
  else setZoomScale(2.5);
});

stage.addEventListener('dblclick', resetZoom);
btnFit.addEventListener('click', resetZoom);

/* ------------------- cierre genérico de diálogos ------------------- */

document.querySelectorAll('dialog button[data-close]').forEach((btn) => {
  if (btn.dataset.close === 'force') return; // 'force' cierra la ventana (arriba)
  btn.addEventListener('click', () => btn.closest('dialog').close());
});

/* ------------------------------ arranque ------------------------------ */

load();
