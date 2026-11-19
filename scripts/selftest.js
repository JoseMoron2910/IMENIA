'use strict';

/* IMENIA — Autotest de la lógica de negocio (sin UI, sin tocar tu biblioteca).
   Uso:  npx electron scripts/selftest.js --enable-logging
   Crea una biblioteca desechable en .selftest-data. */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const ROOT = path.join(__dirname, '..');
process.env.IMENIA_DATA_DIR = path.join(ROOT, '.selftest-data');

const paths = require(path.join(ROOT, 'lib', 'paths'));
const db = require(path.join(ROOT, 'lib', 'db'));
const session = require(path.join(ROOT, 'lib', 'session'));
const folders = require(path.join(ROOT, 'lib', 'services', 'folders'));
const images = require(path.join(ROOT, 'lib', 'services', 'images'));
const editing = require(path.join(ROOT, 'lib', 'services', 'editing'));
const exporter = require(path.join(ROOT, 'lib', 'exporter'));

let failures = 0;
function check(name, cond) {
  console.log((cond ? '  PASS' : '  FAIL') + ' - ' + name);
  if (!cond) failures += 1;
}

/* PNG 1x1 embebido: no depende de ficheros externos */
const SAMPLE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

app.whenReady().then(async () => {
  try {
    console.log('== IMENIA selftest ==');
    paths.ensureDataTree();
    await db.init();

    /* 1 - Carpeta y contraseña */
    const folder = folders.createFolder({ name: 'Prueba automatica', password: 'secreta' });
    check('crea carpeta con id', Number(folder.id) > 0);
    check('la carpeta queda protegida', folder.isProtected === true);

    let threw = false;
    try { images.listCards(folder.id, ''); } catch { threw = true; }
    check('listado bloqueado lanza error', threw);

    let wrongPw = false;
    try { folders.unlockFolder(folder.id, 'incorrecta'); } catch (e) { wrongPw = e.code === 'WRONG_PASSWORD'; }
    check('contrasena incorrecta rechazada', wrongPw);

    folders.unlockFolder(folder.id, 'secreta');
    check('desbloqueo correcto', session.isUnlocked(folder.id));

    /* 2 - Imagen sintetica (evita el dialogo nativo de import) */
    const row = folders.getFolderOrThrow(folder.id);
    const dir = paths.folderDir(row.storage_dir);
    const pngBuffer = Buffer.from(SAMPLE_PNG, 'base64');
    fs.writeFileSync(path.join(dir, 'foto_test.png'), pngBuffer);
    db.run(
      `INSERT INTO images
         (folder_id, filename, ext, original_filename, mime, sha256, size_bytes, width, height)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [Number(row.id), 'foto_test', '.png', 'foto_test.png', 'image/png',
        'a'.repeat(64), pngBuffer.length, 1, 1],
    );
    db.persist();

    const imageId = Number(db.get('SELECT id FROM images').id);
    check('la imagen aparece en la galeria', images.listCards(folder.id, '').cards.length === 1);

    /* 3 - Edicion: renombrado fisico + tags + descripcion */
    const updated = editing.updateImage(imageId, {
      name: 'foto_renombrada',
      tags: ['retrato', 'prueba', 'PRUEBA'],
      description: '  Una descripcion de prueba.  ',
    });
    check('renombrado en BD', updated.filename === 'foto_renombrada');
    check('renombrado fisico en disco',
      fs.existsSync(path.join(dir, 'foto_renombrada.png'))
      && !fs.existsSync(path.join(dir, 'foto_test.png')));
    check('tags deduplicados (2 de 3)', updated.tags.length === 2);
    check('descripcion recortada', updated.description === 'Una descripcion de prueba.');
    check('payload de editor ok', editing.getEditorPayload(imageId).tags.length === 2);

    /* 4 - Busqueda por tag */
    check('busqueda global por tag', images.listCards('all', 'retrato').cards.length === 1);

    /* 4b - Navegacion anterior/siguiente del editor */
    const nb = editing.getNeighbors(imageId);
    check('navegacion: lista de vecinos con la propia imagen', nb.ids.length === 1 && nb.index === 0);

    /* 5 - Restricciones con la carpeta bloqueada */
    folders.lockFolder(folder.id);
    threw = false;
    try { editing.getEditorPayload(imageId); } catch { threw = true; }
    check('editor rechaza carpeta bloqueada', threw);
    threw = false;
    try { exporter.run(folder.id); } catch { threw = true; }
    check('export rechaza carpeta bloqueada', threw);
    threw = false;
    try { images.deleteImage(imageId); } catch { threw = true; }
    check('borrado rechaza carpeta bloqueada', threw);

    /* 6 - Export con carpeta desbloqueada */
    folders.unlockFolder(folder.id, 'secreta');
    const exp = exporter.run(folder.id);
    check('exporta 1 imagen', exp.count === 1);
    check('dataset.json generado', fs.existsSync(exp.jsonPath));
    check('dataset.csv generado', fs.existsSync(exp.csvPath));
    check('caption .txt generado', fs.readdirSync(exp.captionsDir).length === 1);

    /* 7 - Eliminacion con papelera interna */
    images.deleteImage(imageId);
    check('imagen eliminada de BD', images.listCards(folder.id, '').cards.length === 0);
    check('papelera interna poblada', fs.readdirSync(paths.getTrashDir()).length === 1);

    console.log(failures === 0
      ? 'RESULT: SELFTEST_OK (todos los checks en verde)'
      : 'RESULT: SELFTEST_FAILED con ' + failures + ' fallo(s)');
  } catch (err) {
    console.error('RESULT: SELFTEST_ERROR', err && err.stack ? err.stack : err);
  } finally {
    app.quit();
  }
});
