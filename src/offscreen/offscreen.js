/**
 * Offscreen document — docs/09 Q14. Receives export entries one at a time
 * from the worker, compresses them into a single zip, hands back a blob: URL
 * for one chrome.downloads call, and revokes it when told. Holds nothing
 * after revoke; the worker closes the document when the export ends.
 */
import { MSG } from '../shared/constants.js';
import { createZip, addEntry, finishZip } from '../background/lib/zip.js';

/** @typedef {import('../background/lib/zip.js').ZipBuilder} ZipBuilder */

/** @type {ZipBuilder} */
let zip = createZip();
/** Serialises adds so entries land in the order they were sent. */
/** @type {Promise<unknown>} */
let chain = Promise.resolve();

/**
 * @param {string} b64
 * @returns {Uint8Array}
 */
const fromBase64 = (b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

/**
 * @param {{ text?: string, base64?: string, gzipBase64?: string }} msg
 * @returns {Promise<Uint8Array>}
 */
const toBytes = async (msg) => {
  if (typeof msg.gzipBase64 === 'string') {
    const gz = fromBase64(msg.gzipBase64);
    const stream = new Blob([/** @type {ArrayBuffer} */ (gz.buffer)]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  if (typeof msg.base64 === 'string') return fromBase64(msg.base64);
  return new TextEncoder().encode(String(msg.text ?? ''));
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;

  if (msg.type === MSG.OFFSCREEN_ZIP_RESET) {
    zip = createZip();
    chain = Promise.resolve();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === MSG.OFFSCREEN_ZIP_ADD) {
    const p = chain.then(async () => {
      await addEntry(zip, String(msg.path || ''), await toBytes(msg));
      return zip.records.length;
    });
    chain = p.catch(() => {});
    p.then(
      (count) => sendResponse({ ok: true, count }),
      (e) => sendResponse({ error: e instanceof Error ? e.message : String(e) })
    );
    return true;
  }
  if (msg.type === MSG.OFFSCREEN_ZIP_FINISH) {
    chain
      .then(() => {
        const blob = finishZip(zip);
        zip = createZip();
        sendResponse({ url: URL.createObjectURL(blob), size: blob.size });
      })
      .catch((e) => sendResponse({ error: e instanceof Error ? e.message : String(e) }));
    return true;
  }
  if (msg.type === MSG.OFFSCREEN_REVOKE) {
    try {
      if (typeof msg.url === 'string') URL.revokeObjectURL(msg.url);
    } catch {
      /* already gone */
    }
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
