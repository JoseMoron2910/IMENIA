'use strict';

/**
 * IMENIA — Exportación del dataset para entrenamiento de modelos de IA.
 *
 * Genera, en data/exports/dataset_<fecha>/:
 *   dataset.json        → [{ file, folder, tags, description }, …] + metadatos
 *   dataset.csv         → id;archivo;carpeta;tags;descripcion (BOM UTF-8 para Excel)
 *   captions/*.txt      → un .txt por imagen con la descripción (formato caption
 *                          usado por flujos de fine-tuning tipo DreamBooth/LoRA)
 *
 * Las carpetas bloqueadas quedan SIEMPRE excluidas del export.
 */

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const session = require('./session');
const db = require('./db');

function csvCell(text) {
  const value = String(text ?? '');
  const needsQuotes = /[";\r\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function timestampSlug() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function run(scope) {
  const folderRows = db.all('SELECT * FROM folders ORDER BY name COLLATE NOCASE');
  let targets;
  let lockedSkipped = [];

  if (scope === 'all') {
    targets = folderRows.filter((f) => session.isViewable(f));
    lockedSkipped = folderRows.filter((f) => !session.isViewable(f)).map((f) => f.name);
  } else {
    const row = folderRows.find((f) => Number(f.id) === Number(scope));
    if (!row) throw new Error('La carpeta indicada no existe.');
    if (!session.isViewable(row)) throw new Error('La carpeta está bloqueada: desbloquéala antes de exportarla.');
    targets = [row];
  }

  const folderIds = targets.map((f) => Number(f.id));
  if (folderIds.length === 0) {
    throw new Error('No hay carpetas visibles que exportar (¿están todas bloqueadas?).');
  }

  const placeholders = folderIds.map(() => '?').join(', ');
  const rows = db.all(
    `SELECT i.id, i.filename, i.ext, i.description, i.size_bytes,
            f.name AS folder_name, f.storage_dir
       FROM images i JOIN folders f ON f.id = i.folder_id
      WHERE i.folder_id IN (${placeholders})
      ORDER BY f.name COLLATE NOCASE, i.filename COLLATE NOCASE`,
    folderIds,
  );

  const items = rows.map((row) => {
    const tags = db.imageTagNames(row.id);
    const relativeFile = path.join('images', row.storage_dir, row.filename + row.ext);
    return {
      id: Number(row.id),
      file: relativeFile.split(path.sep).join('/'),
      folder: row.folder_name,
      tags,
      description: String(row.description || ''),
    };
  });

  const outDir = path.join(paths.getExportsDir(), `dataset_${timestampSlug()}`);
  fs.mkdirSync(outDir, { recursive: true });

  /* dataset.json */
  const jsonPath = path.join(outDir, 'dataset.json');
  fs.writeFileSync(jsonPath, JSON.stringify({
    _generator: 'IMENIA v0.1',
    _exported_at: new Date().toISOString(),
    _columns: ['id', 'file', 'folder', 'tags', 'description'],
    count: items.length,
    items,
  }, null, 2), 'utf8');

  /* dataset.csv (separador ; + BOM para Excel en español) */
  const csvLines = ['id;archivo;carpeta;tags;descripcion'];
  for (const item of items) {
    csvLines.push([
      item.id,
      csvCell(item.file),
      csvCell(item.folder),
      csvCell(item.tags.join('|')),
      csvCell(item.description),
    ].join(';'));
  }
  const csvPath = path.join(outDir, 'dataset.csv');
  fs.writeFileSync(csvPath, '\uFEFF' + csvLines.join('\r\n'), 'utf8');

  /* captions/*.txt */
  const captionsDir = path.join(outDir, 'captions');
  fs.mkdirSync(captionsDir, { recursive: true });
  const usedCaptionNames = new Set();
  for (const item of items) {
    let captionName = (item.file.split('/').pop() || `img_${item.id}`).replace(/\.[^.]+$/, '') + '.txt';
    if (usedCaptionNames.has(captionName.toLowerCase())) {
      captionName = `img_${item.id}.txt`;
    }
    usedCaptionNames.add(captionName.toLowerCase());
    fs.writeFileSync(path.join(captionsDir, captionName), item.description, 'utf8');
  }

  return {
    dir: outDir,
    jsonPath,
    csvPath,
    captionsDir,
    count: items.length,
    folders: targets.map((f) => f.name),
    lockedSkipped,
  };
}

module.exports = { run };
