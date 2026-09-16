/* Offscreen document — docs/09 Q14. Turns export payloads into blob: URLs the
   worker can hand to chrome.downloads. Holds nothing after revoke; the worker
   closes the document when the export ends. Classic script: no imports. */
(() => {
  // Mirrors src/shared/constants.js MSG.
  const MAKE = 'fp:offscreen-make-blob';
  const REVOKE = 'fp:offscreen-revoke';

  /**
   * @param {string} b64
   * @returns {ArrayBuffer}
   */
  const fromBase64 = (b64) => {
    const bin = atob(b64);
    const buf = new ArrayBuffer(bin.length);
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return buf;
  };

  /**
   * @param {{ text?: string, base64?: string, gzipBase64?: string, mime: string }} msg
   * @returns {Promise<Blob>}
   */
  const toBlob = async (msg) => {
    const mime = msg.mime || 'application/octet-stream';
    if (typeof msg.gzipBase64 === 'string') {
      const stream = new Blob([fromBase64(msg.gzipBase64)]).stream().pipeThrough(new DecompressionStream('gzip'));
      const buf = await new Response(stream).arrayBuffer();
      return new Blob([buf], { type: mime });
    }
    if (typeof msg.base64 === 'string') return new Blob([fromBase64(msg.base64)], { type: mime });
    return new Blob([String(msg.text ?? '')], { type: mime });
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'offscreen') return false;
    if (msg.type === MAKE) {
      toBlob(msg).then(
        (blob) => sendResponse({ url: URL.createObjectURL(blob), size: blob.size }),
        (e) => sendResponse({ error: e instanceof Error ? e.message : String(e) })
      );
      return true;
    }
    if (msg.type === REVOKE) {
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
})();
