# IMENIA — Análisis Funcional

| | |
|---|---|
| **Producto** | IMENIA — Biblioteca local y portable de imágenes para datasets de IA |
| **Versión del documento** | 1.0 (esqueleto v0.1) |
| **Fecha** | 19/11/2026 |
| **Plataforma objetivo** | Escritorio (Windows en primera instancia; base multiplataforma) |
| **Stack** | Electron 38 + JavaScript (vanilla) + SQLite (sql.js) |

---

## 1. Introducción

### 1.1 Propósito del documento
Este documento describe, de forma completa y detallada, **qué hace IMENIA, qué no hace todavía, y cómo está organizado funcionalmente**. Sirve como contrato entre la idea de producto y el código, y como guía para las siguientes fases de desarrollo. Está escrito pensando en que cualquier persona (tú o un colaborador) pueda retomar el proyecto sin conocimiento previo del mismo.

### 1.2 Visión del producto
> IMENIA es el "estudio de preparación de datos" personal de un aficionado/profesional de la IA: descarga o recopila imágenes, las organiza en carpetas (algunas privadas con contraseña), y dedica su tiempo a **renombrarlas, etiquetarlas y describirlas**. Cuando el dataset está listo, lo exporta en formatos directamente utilizables para entrenar modelos (JSON/CSV + captions `.txt` estilo DreamBooth/LoRA). Todo **en local**, sin nube, y **portable**: la aplicación y su biblioteca caben en una carpeta (USB, disco externo, copia de seguridad).

### 1.3 Objetivos
1. **OG-01 — Local y privado:** ningún dato sale del equipo. Sin cuentas, sin telemetría, sin red.
2. **OG-02 — Portable:** aplicable desde una carpeta copiable con la biblioteca dentro.
3. **OG-03 — Productividad de etiquetado:** minimizar el tiempo entre "importo una imagen" y "está lista para entrenar".
4. **OG-04 — Organización por carpetas** con privacidad relativa (contraseña por carpeta).
5. **OG-05 — Exportación apta para entrenamiento** en formatos estándar del ecosistema IA.

### 1.4 Glosario

| Término | Definición |
|---|---|
| **Biblioteca** | Conjunto total de imágenes gestionadas por IMENIA (vive en `data/`). |
| **Carpeta (de la app)** | Agrupación lógica de imágenes creada por el usuario; equivale a una subcarpeta física en `data/images/`. Puede tener contraseña. |
| **Tarjeta** | Representación de una imagen en la galería (miniatura + metadatos). |
| **Tag** | Etiqueta corta de una palabra/concepto, reutilizable entre imágenes (p. ej. `retrato`, `atardecer`, `estilo-óleo`). |
| **Descripción / caption** | Texto largo que describe la imagen; es el texto con el que se entrenará el modelo emparejado con la imagen. |
| **Dataset** | Export estructurado (JSON/CSV/captions) de un ámbito de la biblioteca. |
| **Papelera interna** | Carpeta `data/.trash/` a la que se mueven los ficheros eliminados. |
| **Sesión de desbloqueo** | Estado en memoria que permite ver una carpeta protegida tras introducir su contraseña; se pierde al cerrar la app. |


---

## 2. Alcance

### 2.1 Dentro del alcance (v0.1 — esqueleto funcional)

| # | Capacidad | Detalle |
|---|---|---|
| 1 | Biblioteca portable | BD + imágenes viven en `data/`, junto a la app: la carpeta completa se puede copiar/mover. |
| 2 | Carpetas | Crear, renombrar, eliminar (con papelera interna) y contraseña por carpeta. |
| 3 | Importación | Copiar imágenes (9 formatos) desde el explorador del SO a una carpeta de la app. Deduplicado por SHA-256. |
| 4 | Galería | Miniaturas en cuadrícula, contador por carpeta, pseudo-carpeta "Todas las imágenes". |
| 5 | Búsqueda | Texto libre contra nombre de archivo, descripción y tags, dentro del ámbito activo. |
| 6 | Editor | Pantalla dedicada: imagen a la izquierda, formulario a la derecha. Renombrado **físico** del archivo, tags y descripción. Ctrl+S. |
| 7 | Protección | Carpeta con contraseña bloquea listado, miniaturas (403 del protocolo interno), editor y export. Desbloqueo por sesión. |
| 8 | Export dataset | `dataset.json`, `dataset.csv` y `captions/*.txt`. Excluye carpetas bloqueadas. |
| 9 | Borrado | Imágenes y carpetas se mueven a `data/.trash/` (recuperables manualmente). |
| 10 | 100% local | Sin red, sin cuentas, sin telemetría. Persistencia atómica de la BD (temp + rename). |

### 2.2 Fuera del alcance (por ahora)

- **Cifrado real de archivos en disco** (v0.2): hoy la contraseña controla el acceso *desde la app*; explorando `data/images/` directamente los archivos siguen legibles.
- **Miniaturas en caché** (v0.2): la galería carga la imagen original escalada por CSS.
- **Edición de imágenes** (recorte/redimensionado), tags jerárquicos, autotagging con modelos locales (v1.x).
- **Exportadores adicionales** (JSONL, parquet, TFRecord, estructura por-clases) (v1.x).
- **Nube/sincronización/multiusuario**: no son objetivos del producto.

### 2.3 Supuestos y restricciones

1. **SO**: Windows (NTFS, nombres case-insensitive). Electron es multiplataforma y el diseño no lo impide, pero v0.1 se valida en Windows.
2. **Volumen objetivo inicial**: hasta ~5.000 imágenes; la galería limita cada consulta a 2000 resultados como salvaguarda.
3. **BD**: SQLite (v0.1 con sql.js/WASM → migración prevista a better-sqlite3 al empaquetar).
4. **Contenido**: el usuario es propietario de las imágenes o dispone de derechos para usarlas en entrenamiento.

---

## 3. Requerimientos funcionales

> Prioridad: **M** = imprescindible (v0.1) · **S** = importante (v0.2) · **C** = deseable (v1.x).

### RF-01 — Portabilidad de la biblioteca · M
La app y sus datos deben poder trasladarse copiando una única carpeta.
- **Entrada**: carpeta de la app con `data/` junto al ejecutable (o raíz del proyecto en desarrollo).
- **Salida**: la app crea/usar `data/` (`imenia.db`, `images/`, `.trash/`, `exports/`). Nada en `%APPDATA%` ni registro. Variable `IMENIA_DATA_DIR` para pruebas.
- **Aceptación**: al mover/copiar la carpeta a otra ubicación (u otro PC Windows), al abrir aparecen exactamente las mismas carpetas, imágenes, tags y descripciones.

### RF-02 — Gestión de carpetas · M
- **RF-02.1 Crear**: nombre único (case-insensitive), sanitizado (≤100 caracteres, sin caracteres ilegales de Windows, sin nombres reservados). Se crea la subcarpeta física `data/images/<slug>`.
- **RF-02.2 Renombrar**: actualiza la BD e intenta renombrar la subcarpeta física; si hay archivos abiertos por otro programa, mantiene el directorio actual (`storage_dir` en BD es la verdad).
- **RF-02.3 Eliminar**: confirmación escribiendo el nombre exacto; mueve la subcarpeta a `data/.trash/<timestamp>_<slug>` y borra las filas en cascada.
- **RF-02.4 Ver**: contador de imágenes en la barra lateral; clic = seleccionar ámbito; clic en ⋯ o clic derecho = menú contextual (renombrar, contraseña, bloquear, eliminar).

### RF-03 — Protección por contraseña · M
Cada carpeta puede tener una contraseña (mín. 4, máx. 256 caracteres). Añadir/cambiar/quitar exige la actual correcta.
- **Almacenamiento**: hash **scrypt** (N=16384, r=8, p=1, 32 bytes) con salt aleatorio de 16 bytes; nunca se guarda la contraseña. Comparación en tiempo constante.
- **Bloqueo efectivo**: carpeta bloqueada ⇒ excluida de "Todas", galería con estado "Carpeta bloqueada", `imenia-img://` devuelve **403** para sus imágenes, editor y export la rechazan.
- **Desbloqueo**: vive en memoria (sesión); se pierde al cerrar la app o con "Bloquear ahora". Cambiar/quitar contraseña re-bloquea la carpeta.
- **Criterios de aceptación**:
  1. No es posible ver/abrir/exportar contenido de una carpeta bloqueada desde ninguna parte de la UI.
  2. Reiniciar la app re-bloquea automáticamente.
  3. Un hash robado no revela la contraseña (función de derivación con coste).

### RF-04 — Importación de imágenes · M
- **Mecanismo**: diálogo de selección múltiple del SO → **copia** (nunca mueve) a la carpeta destino elegida. El fichero original queda intacto.
- **Formatos**: png, jpg, jpeg, webp, gif, bmp, avif, tiff, svg. Los rechazados se informan con su causa ("Formato no soportado", "Supera los 150 MB", …).
- **Deduplicado**: SHA-256 calculado leyendo por bloques; si ya existe el mismo hash en la carpeta, se omite y se informa de qué imagen existente la reproduce.
- **Nombres**: base sanitizada del original (≤120, sin caracteres ilegales de Windows); ante colisión se añade sufijo incremental `-2`, `-3`… comprobando BD **y** sistema de archivos (case-insensitive). Se conserva `original_filename` para trazabilidad.
- **Metadatos automáticos**: tamaño en bytes, dimensiones (ancho/alto, si el formato lo permite) y MIME real según extensión.
- **Informe**: recuento de importadas / duplicadas / rechazadas + detalle; la galería se refresca.

### RF-05 — Galería y búsqueda · M
- Cuadrícula responsive (tarjetas de ≥190px): miniatura vía protocolo interno `imenia-img://<id>` con `loading="lazy"`, nombre, nº de tags, indicador 📝 si tiene descripción, carpeta (solo en vista "Todas") y tamaño legible (KB/MB).
- **Búsqueda**: campo único con debounce (300 ms) que filtra por nombre de fichero, descripción o tag (LIKE case-insensitive) dentro del ámbito activo ("Todas" o carpeta seleccionada).
- Clic en tarjeta → abre el editor de esa imagen (una ventana por imagen; si ya está abierta, se enfoca).
- Vacío/estado cero con guía de uso; estado "Carpeta bloqueada" cuando aplica.
- Máximo 2000 resultados por consulta (salvaguarda; paginación real prevista v0.2).

### RF-06 — Pantalla de edición · M
Ventana dedicada por imagen, con **la imagen a la izquierda** (fondo ajedrezado, ajuste *contain*, datos de carpeta/dimensiones/peso arriba) y **el formulario a la derecha**:
1. **Nombre del archivo** (input + extensión fija como badge) → ver RF-07.
2. **Tags** → ver RF-08 (chips con Enter; autocompletado con los tags existentes ordenados por uso).
3. **Descripción** (textarea, hasta 8000 caracteres, contador visible) → el caption futuro del dataset.
- **Guardar**: botón y atajo **Ctrl+S**; estado de guardado ("Guardado a las hh:mm"), toasts de confirmación/error.
- **Navegación anterior/siguiente**: botones **‹ Anterior / Siguiente ›** y atajos **Alt+← / Alt+→** para recorrer las imágenes de la carpeta en el mismo orden de la galería, con contador de posición `n/total`; al saltar se **autoguarda** si hubo cambios (si el guardado falla, no se salta); al eliminar desde el editor se salta a la vecina automáticamente (o se cierra si era la única); el proceso principal remapea la ventana del editor al imagen cambiada para que abrir desde la galería reutilice esa misma ventana.
- **Guardián de cierre**: si hay cambios sin guardar, al cerrar se pide confirmación ("Cerrar sin guardar" / "Quedarme"); `beforeunload` bloquea el cierre accidental.
- **Eliminar imagen**: con confirmación; mueve el fichero a la papelera interna y cierra el editor.
- La carpeta protegida exige desbloqueo previo: el editor rechaza (mensaje) carpetas bloqueadas.

### RF-07 — Renombrado físico del archivo · M
Cambiar el nombre en el editor **renombra el archivo real en disco** (misma carpeta, misma extensión):
- El nombre se sanitiza igual que en importación (≤120 chars).
- Comprobación de colisiones contra BD y sistema de archivos (case-insensitive); sufijo incremental si hace falta.
- Operación transaccional: primero `fs.rename` físico; solo si tiene éxito se actualiza la BD. Si el rename físico falla (fichero bloqueado por otro programa), se informa y **no** se toca la BD.
- `original_filename` permanece inmutable; `updated_at` se actualiza.

### RF-08 — Gestión de tags · M
- Un tag = etiqueta corta (≤64 caracteres tras sanitizado), libre, reutilizable.
- **Entrada**: campo con `datalist` de sugerencias (tags existentes ordenados por frecuencia de uso, máx. 1000), Enter o coma para confirmar; Backspace con campo vacío elimina el último chip; clic en × del chip lo quita.
- **Normalización**: sin duplicados case-insensitive en la misma imagen; máximo **128 tags** por imagen.
- **Almacenamiento**: tabla `tags` (única por `name_lower`) + `image_tags` (N:M). Operación transaccional de reemplazo completo al guardar.
- **Limpieza**: al guardar se eliminan tags huérfanos (sin ninguna imagen asociada).
- Los tags alimentan la búsqueda de la galería y el export.

### RF-09 — Exportación de dataset para IA · M
Genera, en `data/exports/dataset_<AAAAmmdd_HHMMSS>/`, un paquete autocontenido:
- **`dataset.json`**: `{ _generator, _exported_at, _columns, count, items: [{ id, file, folder, tags[], description }] }`, donde `file` es la ruta relativa a `data/` con barras `/`.
- **`dataset.csv`**: cabecera `id;archivo;carpeta;tags;descripcion` (separador `;`, tags unidos con `|`, comillas dobles escapadas, BOM UTF-8 para Excel/es-ES).
- **`captions/<imagen>.txt`**: la descripción como fichero de texto junto a su nombre de imagen — formato compatible con fine-tuning tipo DreamBooth/LoRA y otras herramientas que emparejan `imagen.ext` + `imagen.txt`.
- **Ámbito**: carpeta actual o "Todas". **Las carpetas bloqueadas se excluyen siempre** y se listan en el resumen.
- **Salida**: modal con nº de imágenes, ámbito, rutas y botón "Abrir carpeta de export" (restringido a rutas dentro de `data/`).
- **Errores**: la ausencia de imágenes, o un ámbito bloqueado sin desbloquear, impide el export con un mensaje claro.

### RF-10 — Eliminación con papelera interna · M
- **Imágenes**: confirmación (desde editor o clic derecho en la galería) → el *fichero físico* se mueve a `data/.trash/<ts>_<carpeta>__<nombre>` y se borra la fila (los tags quedan desasignados en cascada).
- **Carpetas**: confirmación escribiendo el nombre exacto → la subcarpeta física completa se mueva `data/.trash/<ts>_<slug>` y las filas se borran en cascada.
- **Recuperación**: manualmente desde el explorador (mover el fichero de vuelta). Una UI de papelera con restauración es S (v0.3).
- Nunca se borra definitivamente nada en v0.1 (borrado físico real solo vaciando `.trash/` a mano).

### RF-11 — Localidad y privacidad · M
- Cero conexiones de red: no hay fetch, descargas, telemetría ni analítica en el código.
- No se persiste nada fuera de `data/` (salvo la caché interna del navegador de Electron, no accesible al usuario).
- CSP estricta en ambas pantallas (`default-src 'self'`); `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- El renderer no conoce ninguna ruta real del disco: las miniaturas se sirven por el protocolo interno con control de acceso (además de no filtrar rutas, permite denegar con 403).

### RF-12 — Estadísticas mínimas · S (parcial en v0.1)
- v0.1: contador de imágenes por carpeta, badge de resultados, indicadores por tarjeta (tags/descripción/carpeta/peso).
- v0.2 (previsto): panel "Salud del dataset": imágenes sin describir, sin tags, tags más usados, tamaño total.


---

## 4. Requerimientos no funcionales

| ID | Requisito | Criterio / detalle |
|---|---|---|
| RNF-01 | **Portabilidad** | Copiar la carpeta de la app + `data/` y funcionar en otro PC sin instalar nada. Sin datos en `%APPDATA%`/registro. Empaquetado objetivo: `electron-builder --dir` (carpeta win-unpacked) comprimida en ZIP. |
| RNF-02 | **Seguridad de contraseñas** | scrypt (N=16384, r=8, p=1, 32 bytes, salt 16 bytes) + comparación en tiempo constante. Nunca se almacena texto claro. La verificación dura decenas de ms (freno a fuerza bruta). |
| RNF-03 | **Integridad de datos** | (a) Persistencia SQLite **atómica**: se escribe a `.tmp-<ts>` y se renombra (un corte de luz nunca corrompe la BD). (b) Mutaciones de tags transaccionales (`BEGIN/COMMIT/ROLLBACK`). (c) Claves foráneas `ON DELETE CASCADE` activadas. (d) Renombrado/movimiento físicos solo confirman cambios en BD si el FS tuvo éxito antes. |
| RNF-04 | **Rendimiento** | Hashing por bloques de 1 MB (sin cargar ficheros enteros en RAM), `loading="lazy"` en miniaturas, consulta de galería con índices (`folder_id`, `tag_id`, `sha256`) y límite de 2000 filas; importación secuencial con informe. Objetivo: 5.000 imágenes fluidas (v0.2 caché de miniaturas para 50k+). |
| RNF-05 | **Robustez sobre el FS** | Windows es case-insensitive: TODAS las colisiones de nombre se comprueban insensible a mayúsculas; nombres sanitizados (caracteres ilegales, nombres reservados CON/PRN/COM1…, finales en punto); si un rename físico falla (fichero abierto externamente) se degrada con mensaje y sin corrupción de estado. |
| RNF-06 | **Usabilidad** | UI en castellano, tema oscuro por defecto, atajos (Ctrl+S guardar, Enter añadir tag, Esc cerrar diálogos), confirmación destructiva por texto escrito (carpetas) o diálogo explícito (imágenes), toasts de resultado, estados vacíos con guía. |
| RNF-07 | **Mantenibilidad** | Vanilla JS (sin build); servicios puramente Node (testeables sin UI: ver `scripts/selftest.js`); renderer sin lógica de negocio; una sola dependencia de runtime de peso (sql.js) y una utilitaria (image-size). Comentarios en español. |
| RNF-08 | **Compatibilidad** | Windows 10/11 x64 (Electron 38). Requisitos de compilación: ninguno (WASM, sin módulos nativos). Node ≥18 para desarrollo. Multiplataforma factible posterior (Chromium cuidado los `path.sep`). |
| RNF-09 | **Privacidad por diseño** | Sin red; CSP estricta; aislamiento del renderer (sandbox); el renderer nunca ve rutas absolutas (protocolo `imenia-img://`); apertura de rutas externas restringida a `data/`. |


---

## 5. Modelo de datos

### 5.1 Estructura de directorios (portable)

```
IMENIA/                     ← carpeta portable completa (ZIP = backup)
├── IMENIA.exe (al empaquetar; en desarrollo: main.js + node_modules)
└── data/                   ← TODO el contenido del usuario
    ├── imenia.db           ← SQLite: carpetas, imágenes, tags, descripciones
    ├── images/             ← las imágenes, en subcarpetas por carpeta de la app
    │   ├── retratos/       ← slug del nombre (= una carpeta del usuario)
    │   │   ├── playa_01.jpg
    │   │   └── montana.png
    │   └── privado/        ← carpeta con contraseña (CANDADO EN BD, NO cifrado)
    ├── .trash/             ← papelera interna (borrados recuperables a mano)
    │   └── 1732.../        ← carpeta o ficheros eliminados (prefijo temporal)
    └── exports/            ← datasets exportados
        └── dataset_20261119_153000/
            ├── dataset.json
            ├── dataset.csv
            └── captions/playa_01.txt
```

### 5.2 Esquema relacional (DDL resumido)

```sql
CREATE TABLE folders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL COLLATE NOCASE UNIQUE,   -- nombre visible
  storage_dir   TEXT NOT NULL COLLATE NOCASE UNIQUE,   -- subcarpeta física (slug del nombre)
  password_hash TEXT,                                  -- scrypt hex (NULL = sin candado)
  password_salt TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE images (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id         INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  filename          TEXT NOT NULL COLLATE NOCASE,   -- base SIN extensión (se renombra)
  ext               TEXT NOT NULL,                   -- ".png", ".jpg", …
  original_filename TEXT NOT NULL,                  -- nombre de origen (trazabilidad)
  mime              TEXT NOT NULL,
  sha256            TEXT NOT NULL,                  -- deduplicado por contenido
  size_bytes        INTEGER NOT NULL,
  width             INTEGER, height INTEGER,
  description       TEXT NOT NULL DEFAULT '',       -- el caption del dataset
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (folder_id, filename),                     -- colisiones imposibles en BD
  UNIQUE (folder_id, sha256)                        -- sin duplicados por carpeta
);

CREATE TABLE tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  name_lower TEXT NOT NULL COLLATE NOCASE UNIQUE
);

CREATE TABLE image_tags (                            -- N:M imagen ⇄ tag
  image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
  PRIMARY KEY (image_id, tag_id)
);

-- índices: images(sha256), images(folder_id), image_tags(tag_id)
-- app_meta(key,value): metadatos de la BD (versión de esquema, …)
```

### 5.3 Relaciones e invariantes

- `folders 1—N images`, `images N—M tags` (vía `image_tags`).
- `storage_dir` es la **única verdad** del directorio físico: si un renombrado de carpeta falla en disco, la BD conserva el directorio vigente y la app sigue encontrando los ficheros.
- La ruta física completa se calcula SIEMPRE en runtime (`data/images/<storage_dir>/<filename><ext>`) — nunca se guardan rutas absolutas (portabilidad).
- Invariantes: `(folder_id, filename)` único (case-insensitive); `(folder_id, sha256)` único; `name_lower` único; tags huérfanos purgados al guardar.
- El hash de contraseña NO viaja jamás al renderer (los DTO solo incluyen `isProtected/isUnlocked`).


---

## 6. Casos de uso

**Actor único**: el usuario (creador del dataset). No hay autenticación de aplicación: el "candado" es por carpeta.

### UC-01 — Crear carpeta (con o sin contraseña)
1. Usuario pulsa **＋ Nueva carpeta**.
2. Modal: nombre (+ contraseña opcional y su confirmación).
3. Sistema sanitiza el nombre, comprueba unicidad, crea `data/images/<id>_<slug>/`, inserta la fila (hash scrypt si hubo contraseña) y refresca la barra lateral.
   - **A1**: nombre inválido/duplicado → error en toast, no se crea nada.
   - **A2**: contraseñas no coinciden → aviso, no se crea nada.
   - **A3**: contraseña < 4 caracteres → aviso.

### UC-02 — Importar imágenes
1. Usuario selecciona una carpeta (si clicó una bloqueada, UC-05 primero) y pulsa **📥 Importar imágenes**.
2. Diálogo nativo multi-selección (filtro de 9 formatos).
3. Por fichero: validar formato/tamaño → hash SHA-256 → dedupe → nombre único → **copiar** → medir dimensiones → insertar fila.
4. Toast-resumen (X importadas · Y duplicadas · Z rechazadas) y galería refrescada.
   - **A1**: cancelación del diálogo → sin cambios.

### UC-03 — Editar metadatos (nombre/tags/descripción)
1. Clic en una tarjeta → nueva ventana editor (o enfoca la existente).
2. Sistema valida permiso de carpeta (si bloqueada → error) y pinta imagen + formulario.
3. Usuario edita nombre (badge de extensión fija), añade/quita tags (Enter/coma/×), redacta la descripción.
4. **Ctrl+S** o botón Guardar → sanitiza; renombra el **archivo físico** si cambió (colisión → sufijo); reemplaza tags transaccionalmente; guarda descripción; refresca el formulario con datos oficiales ("Guardado a las hh:mm").
   - **A1**: rename físico imposible → error visible, BD intacta.
   - **A2**: cierre con cambios → confirmación "¿Cerrar sin guardar?".

### UC-04 — Exportar dataset
1. Usuario elige ámbito (carpeta o "Todas") y pulsa **📤 Exportar dataset**.
2. Sistema recolecta imágenes de las carpetas visibles, escribe `dataset.json` + `dataset.csv` + `captions/*.txt` en `data/exports/dataset_<ts>/`.
3. Modal-resumen con nº de imágenes, rutas y botón **Abrir carpeta de export** (restringido a `data/`).
   - **A1**: ámbito bloqueado → error; **A2**: 0 imágenes → error claro.
   - **A3**: en "Todas" las carpetas bloqueadas se omiten y se nombran en el resumen.

### UC-05 — Desbloquear / bloquear carpeta
1. Clic en carpeta con 🔒 (o acción "Bloquear ahora" del menú ⋯).
2. Modal de contraseña → verificación scrypt en tiempo constante → desbloqueo de **sesión** (memoria del proceso principal).
3. Cierre de la app o "Bloquear ahora" vuelve a 🔒 automáticamente.
   - **A1**: contraseña errónea → mensaje inline, permanece bloqueada.
   - **A2**: cambiar/quitar contraseña exige la actual y re-bloquea.

### UC-06 — Eliminar (con papelera)
1. Imagen: clic derecho en tarjeta (o botón en editor) → confirmación → fichero a `data/.trash/`, fila y tags fuera (cascada).
2. Carpeta: menú ⋯ → "Eliminar…" → confirmación escribiendo el nombre → subcarpeta entera a `.trash/` + filas en cascada.
   - **A1**: ficheros abiertos externamente impiden mover → error con remedio sugerido.

### UC-07 — Buscar
1. Campo superior con debounce 300 ms; filtra nombre de archivo, descripción y tags del ámbito activo; badge con nº de resultados; estado vacío de búsqueda específico.

### UC-08 — Renombrar carpeta
1. Menú ⋯ → "Renombrar…" → nuevo nombre → BD y (si es posible) subcarpeta física renombrada; si no es posible, el directorio se conserva y la app sigue siendo consistente (véase §5.3).


---

## 7. Diseño de interfaz (wireframes)

### 7.1 Pantalla Biblioteca
```
┌──────────────────────────────────────────────────────────────────────────┐
│ IMENIA   [ 🔍 buscar por nombre, tag o descripción… ]   [📤 Export][📥 Import][＋ Nueva carpeta] │
├──────────────┬───────────────────────────────────────────────────────────┤
│ CARPETAS     │  🗿 Todas las imágenes                        [120 imagen(es)] │
│──────────────│                                                           │
│ 🗂 Todas      │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐    │
│──────────────│  │ MINI   │ │ MINI   │ │ MINI   │ │ MINI   │ │ MINI   │    │
│ 📁 Retratos  │  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘    │
│      42      │  foto_01.jpg  foto_02.jpg   …                            │
│ 📁 Privado 🔒│  🏷 3 📝 📁 2 MB                                            │
│      7       │  ┌────────┐ ┌────────┐ ┌────────┐ …                       │
│ 📁 Paisajes  │  │        │ │        │ │        │                         │
│     71       │  └────────┘ └────────┘ └────────┘                         │
│──────────────│   (clic → abre el editor · clic dcho → borrar imagen)      │
│ 3 carpeta(s) │                                                           │
└──────────────┴───────────────────────────────────────────────────────────┘
```
Menú contextual (⋯ o clic derecho sobre una carpeta): **Renombrar… · Añadir/Cambiar contraseña… · Bloquear ahora · Eliminar…**

### 7.2 Pantalla Editor (imagen izq. / formulario dcha.)
```
┌─────────────────────────────────────────────┬─────────────────────────────┐
│ 📁 Retratos            3024×4032 px · 4.2 MB │  foto_01.jpg          [✕ Cerrar] │
│                                             │ ────────────────────────── │
│                                             │  Nombre del archivo        │
│                                             │  [foto_01        ] [.jpg]  │
│                                             │  ⤷ el archivo físico se    │
│         ┌───────────────────────┐            │    renombrará al guardar   │
│         │                       │            │  Tags (Enter para añadir)  │
│         │     IMAGEN (ajuste    │            │  [retrato ×] [rojo ×]……    │
│         │       contain)        │            │  [escribe un tag…    ▾]    │
│         └───────────────────────┘            │  Descripción (≤8000)       │
│                                             │  ┌─────────────────────┐    │
│                                             │  │ Retrato de mujer…   │    │
│                                             │  └─────────────────────┘    │
│                                             │  Guardado a las 12:03      │
│                                             │ [🗑 Eliminar  ] [💾 Guardar Ctrl+S] │
└─────────────────────────────────────────────┴─────────────────────────────┘
```

---

## 8. Arquitectura técnica

```
┌──────────────── Renderer (sandbox, sin Node) ────────────────┐
│  index.html / editor.html  +  library.js / editor.js         │
│  • Solo consume window.imenia (preload) y <img src="imenia-img://id">   │
└──────────────┬───────────────────────────────┬───────────────┘
               │ contextBridge + ipcRenderer   │ protocolo imenia-img://
               ▼               (invoke)        ▼
┌──────────────── Proceso principal (Node) ─────────────────────┐
│ main.js   → ventanas, ciclo de vida, registro del protocolo    │
│ preload.js→ puente seguro (solo canales IMENIA)                │
│ lib/paths.js    → rutas portables (data/ junto al exe)          │
│ lib/db.js       → SQLite (sql.js/WASM) + persistencia atómica   │
│ lib/security.js → scrypt, sanitizadores, hash por bloques       │
│ lib/session.js  → carpetas desbloqueadas (memoria, por sesión)  │
│ lib/services/*  → carpetas · imágenes · edición (lógica pura)   │
│ lib/exporter.js → dataset JSON/CSV/captions                     │
└──────────────────────────── data/ ─────────────────────────────┘
     imenia.db (SQLite) · images/<id>_<slug>/ · .trash/ · exports/
```
- **Inversión de dependencias**: los servicios son funciones puras de Node → pueden probarse sin UI (`scripts/selftest.js`, 23 checks).
- **Migración prevista**: sustituir sql.js por `better-sqlite3` al empaquetar (misma BD, misma API REST interna), ganando transacciones en disco.
- **Empaquetado**: `electron-builder` con `win.target=dir`; copiar la carpeta resultante + su `data/` = app portable; ZIP de todo = backup total.


---

## 9. Seguridad

### 9.1 Modelo de amenaza (v0.1, honesto)
| Amenaza | ¿Protegido? | Mecanismo |
|---|---|---|
| Alguien usa TU app y abre una carpeta privada | ✅ Sí | scrypt + salt; desbloqueo solo por sesión; 403 en miniaturas/listado/export |
| Contraseña en la BD (fichero robado) | ✅ Sí | Nunca se guarda en claro; derivación con coste (≈decenas de ms/intento) + comparación en tiempo constante |
| Scripting remoto / XSS en un tag/descripción malicioso | ✅ Sí | Escapado HTML en todos los render, CSP estricta (`script-src 'self'`), renderer sandboxed sin Node |
| Rutas del disco filtradas al renderer | ✅ Sí | Protocolo `imenia-img://` con permisos evaluados en el proceso principal |
| **Alguien abre `data/images/` directamente en el explorador** | ❌ **No (aún)** | Los ficheros NO están cifrados. La contraseña es un cerrojo de la app, no un cifrado del disco |

### 9.2 Propuesta para v0.2 — cifrado real por carpeta
1. Al asignar contraseña: derivar **clave de carpeta** (HKDF sobre scrypt con la contraseña).
2. Cifrar **cada fichero** con AES-256-GCM (IV aleatorio por fichero + tag de integridad); en disco se renombrarían a `<nombre>.jpg.imenia` y se descifrarían al vuelo en el `protocol.handle` (stream de `crypto`).
3. Clave de carpeta cifrada y almacenada en `imenia.db` → cambiar la contraseña solo re-deriva claves (no hay que recifrar la biblioteca); el tag GCM verifica la integridad de cada fichero al abrirlo.
4. Descarte seguro opcional ("vaciar papelera" con sobrescritura) y aviso de que OneDrive/backup del texto claro previos no son retroactivamente cifrados.
Coste estimado: 3–5 días de trabajo; el diseño actual (protocolo central + storage_dir en BD) ya está alineado para no tocar el renderer.

### 9.3 Higiene general
- Ventanas sin navegación externa (`setWindowOpenHandler` deny + `will-navigate` bloqueado).
- `app:openPath` restringido a rutas dentro de `data/`.
- Ninguna dependencia con binarios nativos (audit mínimo permanente).


---

## 10. Formatos de exportación (ejemplos)

**`dataset.json`**
```json
{
  "_generator": "IMENIA v0.1",
  "_exported_at": "2026-11-19T15:30:00.000Z",
  "_columns": ["id", "file", "folder", "tags", "description"],
  "count": 2,
  "items": [
    {
      "id": 1,
      "file": "images/1_retratos/playa_01.jpg",
      "folder": "Retratos",
      "tags": ["retrato", "atardecer", "anonimo"],
      "description": "Retrato lateral de una persona contemplando el mar al atardecer, luz cálida dorada."
    }
  ]
}
```
**`dataset.csv`** (BOM UTF-8, separador `;`)
```csv
id;archivo;carpeta;tags;descripcion
1;images/1_retratos/playa_01.jpg;Retratos;retrato|atardecer|anonimo;"Retrato lateral de una persona, contemplando el mar al atardecer."
```
**`captions/playa_01.txt`** — texto plano de la descripción (convención adoptada por kohya_ss / DreamBooth / muchas herramientas de LoRA que emparejan `imagen.ext` con su `.txt` junto a ella).

**Uso con entrenamiento**: copia tus imágenes + `captions/` a la carpeta de entrenamiento, o consume `dataset.json/csv` directamente en tu pipeline (por ejemplo, cargar con pandas → `torch.utils.data.Dataset`; los `captions/*.txt` sirven para captioning/diffusion, y `tags` para filtros de clase o atributos supervisados).

---

## 11. Hoja de ruta

| Hito | Contenido | Estado |
|---|---|---|
| **M0 — Esqueleto** | Arquitectura, BD, contraseñas, import, editor completo, export, papelera, análisis funcional | ✅ **Este entregable** |
| **M1 — v0.1 pulida** | Miniaturas en caché (nativo-image), paginación virtual de galería, restaurar desde papelera, autotagging manual por lotes (aplicar tag a selección), modo portátil del exe | ⬜ |
| **M2 — v0.2 seguridad** | **Cifrado AES-256-GCM por fichero** (ver §9.2), vaciado seguro, bloqueo automático por inactividad | ⬜ |
| **M3 — v1.0 datasets** | Exportadores JSONL/parquet/TFRecord, plantillas de project_structure por clases, estadísticas del dataset (imágenes sin describir, tags más usados), duplicados globales | ⬜ |
| **M4 — v1.x IA local** | Autotagging opcional con modelo local (p. ej., CLIP/BLIP vía ONNX), búsqueda semántica por imagen, "colecciones inteligentes" por consulta guardada | ⬜ |

---

## 12. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| OneDrive sincroniza `node_modules/` / bloquea ficheros | Instalación rota, renames fallidos | Excluir la carpeta del proyecto de la sincronización (documentado en README) |
| sql.js mantiene la BD en memoria (persistencia por volcado) | Con BD enorme, volvados lentos | Migración a better-sqlite3 en M1 al empaquetar (prevista y aislada en `lib/db.js`) |
| Ficheros abiertos por visores externos impiden mover/renombrar | Operaciones bloqueadas | Mensaje de error accionable + degradación consistente (la BD nunca miente, §5.3) |
| Contraseña ≠ cifrado (v0.1) | Falsa sensación de privacidad | Aviso visible en UI + análisis §9.2 con plan maduro |
| Galería con miles de imágenes a resolución completa | UI lenta | Límite 2000 + lazy; miniaturas reales en M1 |
| Escapes de HTML en nombres/tags | XSS | `escHtml()` en cada render dinámico + CSP estricta |

---

## 13. Checklist de aceptación del esqueleto (M0)

- [x] `npm install` y `npm start` funcionan en Windows con Node 20.
- [x] `npm run smoke-test` valida arranque sin UI (exit 0).
- [x] `npx electron scripts/selftest.js` → 23 checks de lógica de negocio en verde.
- [x] Crear carpeta con/​sin contraseña; re-bloqueo al reiniciar.
- [x] Importar → deduplicar → ver en galería → abrir editor.
- [x] Renombrar cambia el archivo real en disco (misma extensión).
- [x] Tags con autocompletado; huérfanos purgados; máx. 128/imagen.
- [x] Export produce `dataset.json`, `dataset.csv` y `captions/*.txt` con carpetas bloqueadas excluidas.
- [x] Ningún dato sale de `data/`.



