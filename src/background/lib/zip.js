/**
 * Minimal ZIP writer, no dependencies. Local file headers, central directory,
 * end-of-central-directory; CRC-32 via a generated table; UTF-8 names.
 * Method 8 (deflate) through CompressionStream('deflate-raw') for text-like
 * files, method 0 (store) for files that are already compressed.
 *
 * Usable from the offscreen document and the worker alike (both have
 * CompressionStream and Blob). No zip64: a session export stays far below
 * 4 GB and 65k entries.
 */

/** Extensions written with method 0 — compressing them again buys nothing. */
const STORE_RE = /\.(png|gz|zip|jpe?g|webp)$/i;

/** @type {Uint32Array|null} */
let crcTable = null;

/** @returns {Uint32Array} */
function table() {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
}

/**
 * @param {Uint8Array} bytes
 * @returns {number}   unsigned CRC-32
 */
export function crc32(bytes) {
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}   raw deflate stream, no zlib/gzip wrapper
 */
async function deflateRaw(bytes) {
  const stream = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * A Uint8Array view may be a slice of a larger buffer; Blob wants exact bytes.
 * @param {Uint8Array} bytes
 * @returns {ArrayBuffer}
 */
function toArrayBuffer(bytes) {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) return bytes.buffer;
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/**
 * MS-DOS time and date fields, local time.
 * @param {Date} d
 * @returns {{ time: number, date: number }}
 */
function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * @typedef {Object} ZipEntryRecord
 * @property {Uint8Array} name    UTF-8 path
 * @property {number} method
 * @property {number} crc
 * @property {number} size
 * @property {number} compressedSize
 * @property {number} offset      of the local header
 * @property {number} time
 * @property {number} date
 */

/**
 * @typedef {Object} ZipBuilder
 * @property {BlobPart[]} parts
 * @property {ZipEntryRecord[]} records
 * @property {number} offset
 * @property {Set<string>} names
 */

/** @returns {ZipBuilder} */
export function createZip() {
  return { parts: [], records: [], offset: 0, names: new Set() };
}

/**
 * Compress (or store) one file and append its local header + data.
 * Duplicate paths get a numeric suffix so the archive stays valid.
 * @param {ZipBuilder} z
 * @param {string} path
 * @param {Uint8Array} bytes
 * @param {Date} [when]
 */
export async function addEntry(z, path, bytes, when = new Date()) {
  let name = path.replace(/^\/+/, '').replace(/\\/g, '/');
  if (z.names.has(name)) {
    let i = 2;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    while (z.names.has(`${stem} (${i})${ext}`)) i++;
    name = `${stem} (${i})${ext}`;
  }
  z.names.add(name);

  const store = STORE_RE.test(name) || bytes.length < 64;
  const data = store ? bytes : await deflateRaw(bytes);
  const method = store ? 0 : 8;
  const crc = crc32(bytes);
  const nameBytes = new TextEncoder().encode(name);
  const { time, date } = dosDateTime(when);

  const header = new ArrayBuffer(30 + nameBytes.length);
  const v = new DataView(header);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(4, 20, true); // version needed: 2.0 (deflate)
  v.setUint16(6, 0x0800, true); // bit 11: UTF-8 names
  v.setUint16(8, method, true);
  v.setUint16(10, time, true);
  v.setUint16(12, date, true);
  v.setUint32(14, crc, true);
  v.setUint32(18, data.length, true);
  v.setUint32(22, bytes.length, true);
  v.setUint16(26, nameBytes.length, true);
  v.setUint16(28, 0, true);
  new Uint8Array(header, 30).set(nameBytes);

  z.records.push({ name: nameBytes, method, crc, size: bytes.length, compressedSize: data.length, offset: z.offset, time, date });
  z.parts.push(header, toArrayBuffer(data));
  z.offset += header.byteLength + data.length;
}

/**
 * Append the central directory and EOCD; return the archive.
 * @param {ZipBuilder} z
 * @returns {Blob}
 */
export function finishZip(z) {
  const cdStart = z.offset;
  let cdSize = 0;
  for (const r of z.records) {
    const buf = new ArrayBuffer(46 + r.name.length);
    const v = new DataView(buf);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(4, 20, true); // version made by
    v.setUint16(6, 20, true); // version needed
    v.setUint16(8, 0x0800, true);
    v.setUint16(10, r.method, true);
    v.setUint16(12, r.time, true);
    v.setUint16(14, r.date, true);
    v.setUint32(16, r.crc, true);
    v.setUint32(20, r.compressedSize, true);
    v.setUint32(24, r.size, true);
    v.setUint16(28, r.name.length, true);
    v.setUint16(30, 0, true); // extra
    v.setUint16(32, 0, true); // comment
    v.setUint16(34, 0, true); // disk
    v.setUint16(36, 0, true); // internal attrs
    v.setUint32(38, 0, true); // external attrs
    v.setUint32(42, r.offset, true);
    new Uint8Array(buf, 46).set(r.name);
    z.parts.push(buf);
    cdSize += buf.byteLength;
  }
  const eocd = new ArrayBuffer(22);
  const e = new DataView(eocd);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(4, 0, true);
  e.setUint16(6, 0, true);
  e.setUint16(8, z.records.length, true);
  e.setUint16(10, z.records.length, true);
  e.setUint32(12, cdSize, true);
  e.setUint32(16, cdStart, true);
  e.setUint16(20, 0, true);
  z.parts.push(eocd);
  return new Blob(z.parts, { type: 'application/zip' });
}

/**
 * One-shot form: entries in, archive out.
 * @param {Array<{ path: string, bytes: Uint8Array }>} entries
 * @returns {Promise<Blob>}
 */
export async function buildZip(entries) {
  const z = createZip();
  for (const e of entries) await addEntry(z, e.path, e.bytes);
  return finishZip(z);
}
