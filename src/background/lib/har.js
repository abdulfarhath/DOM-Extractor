/**
 * HAR 1.2 assembly — docs/03. Reconstructed from the fetch/XHR wrappers, so
 * timing phases the browser never exposed are -1 (legal HAR) and only the
 * caller-set request headers exist. Never invents values.
 */
import { TOOL_NAME, TOOL_VERSION } from '../../shared/constants.js';

/** @typedef {import('../../shared/schema.js').NetEntry} NetEntry */
/** @typedef {import('../../shared/schema.js').HeaderPair} HeaderPair */

/**
 * @param {string} url
 * @returns {{ name: string, value: string }[]}
 */
function queryStringOf(url) {
  try {
    return Array.from(new URL(url).searchParams.entries()).map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

/**
 * @param {NetEntry} n
 * @returns {string}
 */
function pageIdOf(n) {
  return n.pageUrl || 'unknown';
}

/**
 * @param {NetEntry[]} entries
 * @returns {object} a HAR 1.2 document
 */
export function buildHar(entries) {
  /** @type {Map<string, { id: string, startedDateTime: string, title: string }>} */
  const pages = new Map();
  for (const n of entries) {
    const url = pageIdOf(n);
    if (!pages.has(url)) {
      pages.set(url, { id: `page_${pages.size + 1}`, startedDateTime: n.startedAt, title: url });
    }
  }

  const harEntries = entries.map((n) => {
    const page = pages.get(pageIdOf(n));
    const time = Math.max(0, n.durationMs || 0);
    /** @type {Record<string, unknown>} */
    const request = {
      method: n.method,
      url: n.url,
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: n.requestHeaders || [],
      queryString: queryStringOf(n.url),
      headersSize: -1,
      bodySize: n.requestBody ? n.requestBody.length : -1,
    };
    if (n.requestBody != null) {
      const ct = (n.requestHeaders || []).find((h) => h.name.toLowerCase() === 'content-type');
      request.postData = { mimeType: ct ? ct.value : 'application/octet-stream', text: n.requestBody };
    }
    return {
      pageref: page ? page.id : undefined,
      startedDateTime: n.startedAt,
      time,
      request,
      response: {
        status: n.status,
        statusText: n.statusText || '',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: n.responseHeaders || [],
        content: {
          size: n.responseBody ? n.responseBody.length : 0,
          mimeType: n.mimeType || 'x-unknown',
          text: n.responseBody ?? '',
        },
        redirectURL: '',
        headersSize: -1,
        bodySize: -1,
      },
      cache: {},
      timings: { blocked: -1, dns: -1, connect: -1, ssl: -1, send: 0, wait: time, receive: 0 },
      comment: [
        n.error ? `error: ${n.error}` : `${n.kind}; wrapper-reconstructed, timings approximate`,
        `internal id ${n.id}`,
        n.stateIdAtTime ? `state ${n.stateIdAtTime}${n.stateIdInferred ? ' (inferred from top frame)' : ''}` : '',
      ]
        .filter(Boolean)
        .join('; '),
    };
  });

  return {
    log: {
      version: '1.2',
      creator: { name: TOOL_NAME, version: TOOL_VERSION },
      pages: Array.from(pages.values()).map((p) => ({
        startedDateTime: p.startedDateTime,
        id: p.id,
        title: p.title,
        pageTimings: { onContentLoad: -1, onLoad: -1 },
      })),
      entries: harEntries,
      comment: 'Reconstructed from fetch/XHR wrappers. Timing phases are approximate; browser-added request headers are absent.',
    },
  };
}
