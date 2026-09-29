/**
 * Unpack a zip to a folder. Uses `unzip` from the shell when it is there,
 * otherwise a minimal reader: central directory, methods 0 (store) and 8
 * (deflate) only, which is all Flowprint's own writer produces.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

/**
 * @param {string} zipPath
 * @param {string} destDir
 * @returns {{ method: 'unzip'|'builtin', entries: number }}
 */
export function unzipTo(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const probe = spawnSync('unzip', ['-v'], { encoding: 'utf8' });
  if (!probe.error && probe.status === 0) {
    const r = spawnSync('unzip', ['-q', '-o', zipPath, '-d', destDir], { encoding: 'utf8' });
    // Exit 1 is "warnings only"; the files are there.
    if (!r.error && (r.status === 0 || r.status === 1)) return { method: 'unzip', entries: countFiles(destDir) };
  }
  return { method: 'builtin', entries: unzipBuiltin(zipPath, destDir) };
}

/** @param {string} dir */
function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else n++;
  }
  return n;
}

/**
 * @param {string} zipPath
 * @param {string} destDir
 * @returns {number}
 */
export function unzipBuiltin(zipPath, destDir) {
  const buf = fs.readFileSync(zipPath);
  // End of central directory: signature 0x06054b50, searched from the end.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  let written = 0;
  const root = path.resolve(destDir);
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad central directory entry at ${p}`);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;

    const target = path.resolve(root, name);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`zip entry escapes the folder: ${name}`);
    if (name.endsWith('/')) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`unsupported compression method ${method} for ${name}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    written++;
  }
  return written;
}
