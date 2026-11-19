# IMENIA — Biblioteca portable de imágenes para datasets de IA

Aplicación de escritorio **100% local y portable** para organizar imágenes en
**carpetas protegibles con contraseña**, etiquetarlas y describirlas con el objetivo
de **preparar datasets para entrenar modelos de IA**.

> 📄 El análisis funcional completo está en [`ANALISIS_FUNCIONAL.md`](./ANALISIS_FUNCIONAL.md).

## Características (esqueleto v0.1)

- ✅ **Portable**: la base de datos y tus imágenes viven en la carpeta `data/` del proyecto
  (junto al ejecutable cuando empaquetas). Copia la carpeta a un USB y listo.
- ✅ **Carpetas de imágenes** con contraseña opcional por carpeta (lock de sesión con scrypt).
- ✅ **Galería** con miniaturas, búsqueda por nombre, tag o descripción.
- ✅ **Editor**: imagen a la izquierda, formulario a la derecha (renombrado *real* del
  archivo en disco, tags con autocompletado y descripción).
- ✅ **Navegación en el editor**: ‹ Anterior / Siguiente › (o **Alt+←/→**) para recorrer
  las imágenes de la carpeta sin salir del editor, con autoguardado al saltar y
  contador de posición `n / total`.
- ✅ **Exportación de dataset para IA**: `dataset.json`, `dataset.csv` y captions `.txt`
  por imagen (formato compatible con fine-tuning estilo DreamBooth/LoRA y otros flujos).

## Requisitos

- **Node.js 18+** y npm (probado con Node 20).

## Puesta en marcha

```powershell
cd IMENIA
npm install     # descarga Electron y dependencias (unos minutos la primera vez)
npm start       # arranca la aplicación
```

### Prueba automática (sin abrir ventana)

```powershell
npm run smoke-test                      # valida el arranque + BD y sale (exit 0)
npx electron scripts/selftest.js        # 21 checks de la lógica de negocio: carpetas,
                                       # contraseñas, bloqueos, renombrado físico,
                                       # tags, búsqueda, export y papelera
```


## Estructura del proyecto

```
IMENIA/
├── main.js                  # Proceso principal Electron: ventanas, IPC, protocolo imenia-img://
├── preload.js               # Puente seguro (contextBridge) entre UI y proceso principal
├── lib/                     # Lógica (nativa de Node, sin UI)
│   ├── paths.js             # Rutas portables (data/ junto al ejecutable)
│   ├── security.js          # scrypt, sanitizado de nombres, MIME types
│   ├── db.js                # SQLite (sql.js): esquema + persistencia atómica
│   ├── session.js           # Carpetas desbloqueadas durante la sesión
│   ├── exporter.js          # Exportación de dataset (JSON / CSV / captions)
│   └── services/            # Carpeta, imágenes, edición (renombrado físico, tags)
├── renderer/                # Interfaz (HTML/CSS/JS puro)
│   ├── index.html           # Pantalla Biblioteca (carpetas + galería)
│   ├── editor.html          # Pantalla Editor (imagen + formulario)
│   ├── styles/global.css
│   └── js/library.js · js/editor.js
└── data/                    # ⬅ SE CREA SOLA AL ARRANCAR (aquí viven tus datos)
    ├── imenia.db            # Base de datos SQLite
    ├── images/              # Tu biblioteca de imágenes
    │   └── 1_MiCarpeta/     # Una carpeta de la app = subcarpeta física
    ├── .trash/              # Borrados (papelera interna)
    └── exports/             # Datasets exportados para IA
```

## Uso rápido

1. **Nueva carpeta** → ponle nombre y (opcionalmente) contraseña.
2. Selecciona la carpeta y pulsa **Importar imágenes** (se **copian** a `data/images/`).
3. Haz clic en una imagen → se abre el **Editor** (imagen izquierda / formulario derecha):
   cambia el nombre del archivo, añade tags (Enter para confirmar cada uno) y escribe la descripción.
   **Ctrl+S** para guardar.
4. **Exportar dataset** → elige el ámbito (carpeta actual o todo) → se genera
   `data/exports/dataset_<fecha>/` con `dataset.json`, `dataset.csv` y `captions/*.txt`.

## Seguridad de las contraseñas (léeme)

- Las contraseñas se guardan como **hash scrypt + salt** (nunca en claro).
- El bloqueo **controla el acceso desde la aplicación** (galería, miniaturas, editor y export).
- ⚠️ **Los archivos siguen en disco sin cifrar**: alguien con acceso directo a la carpeta
  `data/` podría verlos. El cifrado real de archivos es un objetivo de la v0.2
  (ver `ANALISIS_FUNCIONAL.md`, §9).

## Empaquetado portable (cuando quieras distribuir)

```powershell
npm i -D electron-builder     # se instala solo cuando empaquetas
npx electron-builder --dir    # genera dist/win-unpacked/IMENIA.exe + recursos
```

Comprime `dist/win-unpacked/` en un ZIP → esa carpeta **es** la aplicación portable.
Al ejecutarla, se creará `win-unpacked/data/` junto al `.exe` con tu biblioteca.

## Problemas frecuentes

- **`npm install` tarda mucho la primera vez**: Electron descarga ~120 MB.
- **Portabilidad Node/Electron**: usa Node 18–20+; Electron 38 funciona con tu Node 20.
- **OneDrive**: si sincronizas `node_modules/`, excluye la carpeta del proyecto de la
  sincronización para evitar conflictos de bloqueos de archivos.
