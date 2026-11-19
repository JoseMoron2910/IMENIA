'use strict';

/**
 * IMENIA — Seguridad y nombres de archivo seguros.
 */

const crypto = require('crypto');
const fs = require('fs');

/** Extensiones de imagen aceptadas al importar. */
const ALLOWED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.tiff', '.svg',
]);

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
};

const RESERVED_WINDOWS = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/** Máximo por defecto: 150 MB por imagen. */
const MAX_IMPORT_BYTES = 150 * 1024 * 1024;

/** Caracteres ilegales en nombres de archivo de Windows. */
const ILLEGAL_RE = /[<>:"/\\|?*\u0000-\u001F]/g;

/**
 * Sanitiza la parte base de un nombre de archivo (sin extensión):
 * quita caracteres ilegales, recorta, colapsa espacios y evita
 * nombres reservados de Windows y finales en punto/espacio.
 */
function sanitizeBaseName(raw, maxLength = 80) {
  let name = String(raw || '');
  name = name.replace(ILLEGAL_RE, '');
  name = name.replace(/\s+/g, ' ').trim();
  name = name.replace(/[. ]+$/g, '');
  if (!name) return '';
  if (RESERVED_WINDOWS.has(name.toUpperCase())) return '';
  if (name.length > maxLength) {
    name = name.slice(0, maxLength).replace(/[. ]+$/g, '').trim();
  }
  return name;
}

/** Devuelve la extensión (con punto, minúsculas) o '' si no tiene. */
function extOf(filename) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(filename || ''));
  return m ? '.' + m[1].toLowerCase() : '';
}

/** Base de un nombre de archivo (sin extensión). */
function baseOf(filename) {
  const ext = extOf(filename);
  return ext ? String(filename).slice(0, -ext.length) : String(filename || '');
}

/** Slug para el nombre de la subcarpeta física: "Mi gatos 2024" -> "mi_gatos_2024" */
function slugifyDir(name, maxLength = 48) {
  let slug = String(name || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(ILLEGAL_RE, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+|[._]+$/g, '');
  if (!slug) slug = 'carpeta';
  if (RESERVED_WINDOWS.has(slug.toUpperCase())) slug = '_' + slug;
  return slug.slice(0, maxLength).replace(/[._]+$/g, '') || 'carpeta';
}

/* ------------------------------------------------------------------ */
/* Contraseñas de carpeta: scrypt + salt aleatorio + comparación segura */
/* ------------------------------------------------------------------ */

const SCRYPT_KEYLEN = 32;

/** Devuelve { salt, hash } en hexadecimal. */
function hashPassword(plainPassword) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(plainPassword), salt, SCRYPT_KEYLEN, {
    N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
  });
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

/** Comparación en tiempo constante del intento contra el hash almacenado. */
function verifyPassword(plainPassword, saltHex, hashHex) {
  try {
    const salt = Buffer.from(String(saltHex), 'hex');
    const expected = Buffer.from(String(hashHex), 'hex');
    const actual = crypto.scryptSync(String(plainPassword), salt, expected.length, {
      N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/**
 * Añade un sufijo incremental ("-2", "-3", …) al nombre base hasta que
 * `isFree(base)` devuelva true. Comprobación case-insensitive porque
 * el sistema de archivos de Windows también lo es.
 */
function uniqueName(base, isFree) {
  const lower = base.toLowerCase();
  if (isFree(base, lower)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (isFree(candidate, candidate.toLowerCase())) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/** SHA-256 de un fichero leyendo por bloques (soporta archivos grandes). */
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

module.exports = {
  ALLOWED_EXTENSIONS,
  MIME_BY_EXT,
  MAX_IMPORT_BYTES,
  sanitizeBaseName,
  extOf,
  baseOf,
  slugifyDir,
  hashPassword,
  verifyPassword,
  uniqueName,
  sha256File,
};
