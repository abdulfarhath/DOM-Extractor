/* MAIN-world hooks — docs/01, docs/02 "Network capture", docs/09 Q7/Q8.
   Runs in the page's own JS realm at document_start so it can wrap fetch,
   XMLHttpRequest and history before the app bundle loads, and can see page
   globals for framework detection. It has no chrome.* access, keeps no
   captured data, and must never alter what the page sees: same response
   object, same errors, same history behaviour.

   Everything goes out through window.postMessage with a `__fp` envelope. When
   no content script is listening (origin not consented) the messages are
   simply dropped by the browser. Bodies are truncated here and scrubbed in
   the isolated world before storage.

   docs/12 B5/B6: the hook also describes the *shape* of JSON bodies, flags
   downloads, and reports createObjectURL / window.open calls. That extra work
   only starts once the isolated world has spoken to this realm (`detect` or
   `config`), which it does only behind the consent gate — a site nobody is
   recording should not pay for a JSON walk it will never use. */
(() => {
  if (window.__fpHooked) return;
  window.__fpHooked = true;

  const MAX_REQ = 2000; // CAPS.REQUEST_BODY_CHARS
  const MAX_RES = 4000; // CAPS.RESPONSE_BODY_CHARS
  const MAX_READ_CHARS = 2000000; // CAPS.RESPONSE_READ_CHARS
  // content-length counts bytes and one character can take four of them, so
  // the byte gate sits above the character cap; the reader stops at the cap.
  const MAX_READ_BYTES = 8 * 1024 * 1024;
  const MAX_FULL = 1000000; // CAPS.FULL_BODY_CHARS
  const SHAPE_CHARS = 12000; // CAPS.SHAPE_CHARS
  const SHAPE_DEPTH = 8; // CAPS.SHAPE_DEPTH
  const SHAPE_KEYS = 80; // CAPS.SHAPE_KEYS
  const SHAPE_ARRAY_SAMPLE = 25; // CAPS.SHAPE_ARRAY_SAMPLE
  const ENUM_MIN_SEEN = 5; // CAPS.ENUM_MIN_SEEN
  const ENUM_MAX_DISTINCT = 8; // CAPS.ENUM_MAX_DISTINCT
  const ENUM_VALUE_CHARS = 40; // CAPS.ENUM_VALUE_CHARS
  // The walk runs on the page's own thread, so it is bounded twice: by values
  // visited and by the clock. Whatever is left when either runs out is
  // reported as `truncated` rather than guessed.
  const SHAPE_MAX_NODES = 20000;
  const SHAPE_BUDGET_MS = 40;
  const KEY_CHARS = 80;
  const ENUM_CODE_CHARS = 4;
  const BODY_READ_TIMEOUT_MS = 5000;
  const TEXT_MIME_RE = /^(text\/|application\/(json|xml|x-www-form-urlencoded|javascript|ld\+json|problem\+json|graphql)|.*\+(json|xml))/i;
  const JSON_MIME_RE = /json/i;
  // Document types a browser saves rather than renders. CSV and other text
  // types count only when served as an attachment.
  const BINARY_DOC_RE = /^application\/(pdf|zip|x-zip-compressed|octet-stream|msword|vnd\.ms-|vnd\.openxmlformats-officedocument\.)/i;

  /** True once the isolated world has posted to this realm. */
  let listening = false;
  /** @type {'shape'|'full'} */
  let keepBodies = 'shape';

  /**
   * @param {FPWindowMessage} msg
   */
  const post = (msg) => {
    try {
      window.postMessage(msg, location.origin);
    } catch {
      /* structured-clone failure or opaque origin: drop, never throw into the page */
    }
  };

  /**
   * @param {string|null|undefined} s
   * @param {number} max
   * @returns {string|null}
   */
  const truncate = (s, max) => {
    if (s == null) return null;
    return s.length > max ? s.slice(0, max) + `…[+${s.length - max} chars]` : s;
  };

  /**
   * Serialise a request body without consuming or mutating it.
   * @param {unknown} body
   * @returns {string|null}
   */
  const describeBody = (body) => {
    try {
      if (body == null) return null;
      if (typeof body === 'string') return body;
      if (body instanceof URLSearchParams) return body.toString();
      if (body instanceof FormData) {
        const parts = [];
        for (const [k, v] of body.entries()) parts.push(`${k}=${v instanceof Blob ? `<file ${v.size} bytes>` : String(v)}`);
        return parts.join('&');
      }
      if (body instanceof Blob) return `<Blob ${body.size} bytes ${body.type}>`;
      if (body instanceof ArrayBuffer) return `<ArrayBuffer ${body.byteLength} bytes>`;
      if (ArrayBuffer.isView(body)) return `<${body.constructor.name} ${body.byteLength} bytes>`;
      if (body instanceof ReadableStream) return '<ReadableStream>';
      return JSON.stringify(body);
    } catch {
      return '<unserialisable body>';
    }
  };

  /**
   * @param {HeadersInit|undefined} h
   * @returns {{ name: string, value: string }[]}
   */
  const headersFromInit = (h) => {
    /** @type {{ name: string, value: string }[]} */
    const out = [];
    try {
      if (!h) return out;
      const iter = h instanceof Headers ? h.entries() : Array.isArray(h) ? h : Object.entries(h);
      for (const [name, value] of iter) out.push({ name: String(name), value: String(value) });
    } catch {
      /* ignore */
    }
    return out;
  };

  /**
   * @param {Headers} h
   * @returns {{ name: string, value: string }[]}
   */
  const headersFromHeaders = (h) => {
    const out = [];
    try {
      for (const [name, value] of h.entries()) out.push({ name, value });
    } catch {
      /* ignore */
    }
    return out;
  };

  /**
   * @param {string} raw   getAllResponseHeaders() output
   * @returns {{ name: string, value: string }[]}
   */
  const headersFromRaw = (raw) =>
    (raw || '')
      .trim()
      .split(/[\r\n]+/)
      .filter(Boolean)
      .map((line) => {
        const i = line.indexOf(':');
        return i < 0 ? { name: line.trim(), value: '' } : { name: line.slice(0, i).trim(), value: line.slice(i + 1).trim() };
      });

  /**
   * @param {{ name: string, value: string }[]} headers
   * @returns {string}
   */
  const mimeOf = (headers) => {
    const ct = headers.find((h) => h.name.toLowerCase() === 'content-type');
    return ct ? ct.value.split(';')[0].trim() : '';
  };

  /**
   * @param {{ name: string, value: string }[]} headers
   * @returns {number}
   */
  const contentLength = (headers) => {
    const cl = headers.find((h) => h.name.toLowerCase() === 'content-length');
    const n = cl ? parseInt(cl.value, 10) : NaN;
    return Number.isFinite(n) ? n : -1;
  };

  /**
   * @param {string} url
   * @returns {string}
   */
  const absolute = (url) => {
    try {
      return new URL(url, location.href).href;
    } catch {
      return String(url);
    }
  };

  const pageUrl = () => location.href.split('?')[0].split('#')[0];

  /**
   * The fields docs/12 added, at their "nothing known" values.
   * @returns {Pick<NetDraft, 'requestShape'|'responseShape'|'responseSize'|'bodyTruncated'|'disposition'|'dispositionExt'|'isDownload'>}
   */
  const blankExtras = () => ({
    requestShape: null,
    responseShape: null,
    responseSize: -1,
    bodyTruncated: false,
    disposition: null,
    dispositionExt: null,
    isDownload: false,
  });

  /**
   * Reads content-disposition and then rewrites the header in place without
   * its file name: names of saved files carry people and case numbers, and
   * the header list is posted along with everything else (docs/12 B6).
   * @param {{ name: string, value: string }[]} headers   the hook's own copy, never the page's
   * @returns {{ kind: 'attachment'|'inline'|null, ext: string|null }}
   */
  const readDisposition = (headers) => {
    /** @type {{ kind: 'attachment'|'inline'|null, ext: string|null }} */
    const out = { kind: null, ext: null };
    try {
      const h = headers.find((x) => x.name.toLowerCase() === 'content-disposition');
      if (!h) return out;
      const raw = String(h.value);
      const first = raw.split(';')[0].trim().toLowerCase();
      if (first === 'attachment' || first === 'inline') out.kind = first;
      const m = /filename\*?\s*=\s*(?:[\w!#$%&+^`{}~-]*'[^']*')?\s*"?([^";]*)/i.exec(raw);
      if (m) {
        const e = /\.([A-Za-z0-9]{1,8})\s*$/.exec(m[1]);
        if (e) out.ext = e[1].toLowerCase();
      }
      h.value = (/^[a-z-]+$/.test(first) ? first : 'unknown') + (m ? `; filename=<redacted>${out.ext ? '.' + out.ext : ''}` : '');
    } catch {
      /* ignore */
    }
    return out;
  };

  /**
   * @param {NetDraft} draft   with responseHeaders and mimeType already set
   */
  const applyDisposition = (draft) => {
    const d = readDisposition(draft.responseHeaders);
    draft.disposition = d.kind;
    draft.dispositionExt = d.ext;
    draft.isDownload = d.kind === 'attachment' || BINARY_DOC_RE.test(draft.mimeType);
  };

  // --------------------------------------------------------------- shapes
  // docs/12 B5. A shape is the structure of a JSON value with the values
  // taken out. Key names and the few enum-like values that survive are
  // scrubbed by the isolated world before anything is stored.

  /** @typedef {NonNullable<JsonShape['format']>} ShapeFormat */

  /**
   * Working form of a shape while samples are still being merged.
   * @typedef {Object} ShapeNode
   * @property {JsonShape['t']} t
   * @property {boolean} nullable
   * @property {number} n      samples of this type merged into this position
   * @property {number} len
   * @property {Map<string, { node: ShapeNode, c: number }>|null} keys
   * @property {ShapeNode|null} item
   * @property {ShapeFormat|null} fmt   null until a non-empty string was seen
   * @property {Set<string>|null} vals  null once the position stopped looking like an enum
   */

  /** @typedef {{ nodes: number, deadline: number, over: boolean }} ShapeBudget */

  /**
   * @param {JsonShape['t']} t
   * @returns {ShapeNode}
   */
  const shapeNode = (t) => ({ t, nullable: false, n: 1, len: 0, keys: null, item: null, fmt: null, vals: null });

  const FORMAT_RES = /** @type {[ShapeFormat, RegExp][]} */ ([
    ['uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i],
    ['datetime', /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}[T ]\d{1,2}:\d{2}/],
    ['date', /^\d{4}-\d{2}-\d{2}$|^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/],
    ['numeric', /^[+-]?(\d+|\d{1,3}(,\d{2,3})+)(\.\d+)?$/],
    ['boolean', /^(true|false|yes|no|y|n)$/i],
    ['url', /^(https?:)?\/\/\S+$/i],
    ['email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/],
  ]);

  /**
   * @param {string} v
   * @returns {ShapeFormat}
   */
  const formatOf = (v) => {
    if (v.length > 300) return 'text';
    const s = v.trim();
    for (const [name, re] of FORMAT_RES) if (re.test(s)) return name;
    return 'text';
  };

  /**
   * Formats that name a person, a record or a moment are never status labels,
   * so they never qualify as enum values however often they repeat. Digits
   * qualify only while they are short enough to be a code rather than an
   * amount or an account number.
   * @param {ShapeFormat|null} fmt
   * @param {Set<string>} vals
   */
  const enumLike = (fmt, vals) => {
    if (fmt === 'text' || fmt === 'boolean') return true;
    if (fmt !== 'numeric') return false;
    for (const v of vals) if (v.length > ENUM_CODE_CHARS) return false;
    return true;
  };

  /**
   * Folds `b` into `a` and returns the survivor. Both are the hook's own nodes.
   * @param {ShapeNode} a
   * @param {ShapeNode} b
   * @returns {ShapeNode}
   */
  const mergeShapes = (a, b) => {
    // A branch the budget cut off says nothing; the other sample stands.
    if (a.t === 'truncated') {
      b.nullable = b.nullable || a.nullable;
      return b;
    }
    if (b.t === 'truncated') {
      a.nullable = a.nullable || b.nullable;
      return a;
    }
    if (a.t === 'null') {
      if (b.t !== 'null') b.nullable = true;
      return b;
    }
    if (b.t === 'null') {
      a.nullable = true;
      return a;
    }
    a.nullable = a.nullable || b.nullable;
    if (a.t === 'mixed') return a;
    if (a.t !== b.t) {
      a.t = 'mixed';
      a.keys = null;
      a.item = null;
      a.vals = null;
      a.fmt = null;
      a.len = 0;
      return a;
    }
    a.n += b.n;
    if (a.t === 'string') {
      a.len = Math.max(a.len, b.len);
      a.fmt = a.fmt === null ? b.fmt : b.fmt === null || b.fmt === a.fmt ? a.fmt : 'text';
      if (a.vals && b.vals) {
        for (const v of b.vals) a.vals.add(v);
        if (a.vals.size > ENUM_MAX_DISTINCT) a.vals = null;
      } else a.vals = null;
    } else if (a.t === 'array') {
      a.len = Math.max(a.len, b.len);
      a.item = a.item && b.item ? mergeShapes(a.item, b.item) : a.item || b.item;
    } else if (a.t === 'object' && a.keys && b.keys) {
      for (const [k, e] of b.keys) {
        const cur = a.keys.get(k);
        if (cur) {
          cur.node = mergeShapes(cur.node, e.node);
          cur.c += e.c;
        } else if (a.keys.size < SHAPE_KEYS) a.keys.set(k, e);
      }
    }
    return a;
  };

  /**
   * @param {unknown} v
   * @param {number} depth   1 for the root
   * @param {ShapeBudget} budget
   * @returns {ShapeNode}
   */
  const walkShape = (v, depth, budget) => {
    budget.nodes++;
    if (budget.nodes > SHAPE_MAX_NODES || ((budget.nodes & 255) === 0 && performance.now() > budget.deadline)) budget.over = true;
    if (budget.over || depth > SHAPE_DEPTH) return shapeNode('truncated');
    if (v === null || v === undefined) return shapeNode('null');
    if (typeof v === 'string') {
      const n = shapeNode('string');
      n.len = v.length;
      n.fmt = v.trim() ? formatOf(v) : null;
      // An empty string neither is an enum value nor rules the position out.
      n.vals = v.length > ENUM_VALUE_CHARS ? null : new Set(v ? [v] : []);
      return n;
    }
    if (typeof v === 'number' || typeof v === 'bigint') return shapeNode('number');
    if (typeof v === 'boolean') return shapeNode('boolean');
    if (typeof v !== 'object') return shapeNode('mixed');
    if (Array.isArray(v)) {
      const n = shapeNode('array');
      n.len = v.length;
      const lim = Math.min(v.length, SHAPE_ARRAY_SAMPLE);
      for (let i = 0; i < lim; i++) {
        const s = walkShape(v[i], depth + 1, budget);
        n.item = n.item ? mergeShapes(n.item, s) : s;
      }
      return n;
    }
    const n = shapeNode('object');
    n.keys = new Map();
    const rec = /** @type {Record<string, unknown>} */ (v);
    for (const k of Object.keys(rec)) {
      if (n.keys.size >= SHAPE_KEYS) break;
      const name = k.length > KEY_CHARS ? k.slice(0, KEY_CHARS) : k;
      if (!n.keys.has(name)) n.keys.set(name, { node: walkShape(rec[k], depth + 1, budget), c: 1 });
    }
    return n;
  };

  /**
   * @param {ShapeNode} s
   * @returns {JsonShape}
   */
  const finishShape = (s) => {
    /** @type {JsonShape} */
    const out = { t: s.t };
    if (s.nullable) out.nullable = true;
    if (s.t === 'string') {
      out.len = s.len;
      out.format = s.fmt || 'text';
      if (s.vals && s.vals.size > 0 && s.n >= ENUM_MIN_SEEN && enumLike(s.fmt, s.vals)) out.values = Array.from(s.vals);
    } else if (s.t === 'array') {
      out.len = s.len;
      out.item = s.item ? finishShape(s.item) : null;
    } else if (s.t === 'object' && s.keys) {
      /** @type {Record<string, JsonShape>} */
      const keys = {};
      /** @type {string[]} */
      const optional = [];
      for (const [k, e] of s.keys) {
        // defineProperty so a key called `__proto__` stays a key.
        Object.defineProperty(keys, k, { value: finishShape(e.node), enumerable: true, writable: true, configurable: true });
        if (e.c < s.n) optional.push(k);
      }
      out.keys = keys;
      if (optional.length) out.optional = optional;
    }
    return out;
  };

  /**
   * @param {unknown} value   an already-parsed JSON value
   * @returns {JsonShape|null}
   */
  const shapeOfValue = (value) => {
    try {
      const budget = { nodes: 0, deadline: performance.now() + SHAPE_BUDGET_MS, over: false };
      const shape = finishShape(walkShape(value, 1, budget));
      return JSON.stringify(shape).length > SHAPE_CHARS ? { t: 'truncated' } : shape;
    } catch {
      return null;
    }
  };

  /**
   * Shape of a body when it is JSON: the MIME type says so, or the text opens
   * like an object or an array. Anything else, and anything that fails, is null.
   * @param {string|null|undefined} text   the whole body, before truncation
   * @param {string} mime
   * @returns {JsonShape|null}
   */
  const shapeOfText = (text, mime) => {
    try {
      if (!listening || typeof text !== 'string' || !text || text.length > MAX_READ_CHARS) return null;
      // Some servers prefix JSON with an unparseable guard line; it is not part of the value.
      const body = text.startsWith(")]}'") ? text.replace(/^\)\]\}',?\s*/, '') : text;
      if (!JSON_MIME_RE.test(mime) && !/^\s*[{[]/.test(body.slice(0, 256))) return null;
      return shapeOfValue(JSON.parse(body));
    } catch {
      return null;
    }
  };

  /**
   * @param {{ name: string, value: string }[]} headers
   * @returns {string}
   */
  const contentTypeOf = (headers) => {
    const ct = headers.find((h) => h.name.toLowerCase() === 'content-type');
    return ct ? String(ct.value) : '';
  };

  /**
   * Fills the response side of a draft from text that was read.
   * @param {NetDraft} draft
   * @param {string} text
   * @param {boolean} complete   false when the read stopped at the cap or the clock
   * @param {{ value: unknown }} [parsed]   set when the browser already parsed the body
   */
  const applyText = (draft, text, complete, parsed) => {
    draft.responseSize = text.length;
    draft.responseBody = truncate(text, MAX_RES);
    draft.bodyTruncated = !complete || text.length > MAX_RES;
    if (!complete) draft.responseShape = null;
    else draft.responseShape = parsed ? (listening ? shapeOfValue(parsed.value) : null) : shapeOfText(text, draft.mimeType);
    // Full bodies are opt-in (docs/12 B5); by default nothing beyond the
    // truncated body and the shape ever leaves this function.
    if (listening && keepBodies === 'full') draft.responseFull = text.length > MAX_FULL ? text.slice(0, MAX_FULL) : text;
  };

  /**
   * Reads a clone of the response as text, stopping at `max` characters.
   * `progress` always holds what has been read so far, so a timeout can use it.
   * @param {Response} res
   * @param {number} max
   * @param {{ text: string, cancel: () => void }} progress
   * @returns {Promise<boolean>}   true when the body ended before the cap
   */
  const readCapped = async (res, max, progress) => {
    const body = res.clone().body;
    if (!body) return true;
    const reader = body.getReader();
    progress.cancel = () => void reader.cancel().catch(() => {});
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        progress.text += decoder.decode();
        return progress.text.length <= max;
      }
      progress.text += decoder.decode(value, { stream: true });
      if (progress.text.length >= max) {
        progress.cancel();
        return false;
      }
    }
  };

  // ---------------------------------------------------------------- fetch
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    /**
     * @this {unknown}
     * @param {RequestInfo | URL} input
     * @param {RequestInit} [init]
     * @returns {Promise<Response>}
     */
    const wrapped = async function (input, init) {
      const startedAt = new Date().toISOString();
      const t0 = performance.now();
      /** @type {NetDraft} */
      let draft;
      /** @type {string|null} */
      let requestText = null;
      let requestType = '';
      try {
        const req = input instanceof Request ? input : null;
        const url = absolute(req ? req.url : input instanceof URL ? input.href : String(input));
        const method = String((init && init.method) || (req && req.method) || 'GET').toUpperCase();
        const requestHeaders = init && init.headers ? headersFromInit(init.headers) : req ? headersFromHeaders(req.headers) : [];
        requestText = describeBody(init && init.body);
        requestType = contentTypeOf(requestHeaders);
        draft = {
          kind: 'fetch',
          method,
          url,
          status: 0,
          statusText: '',
          requestHeaders,
          requestBody: truncate(requestText, MAX_REQ),
          responseHeaders: [],
          responseBody: null,
          mimeType: '',
          startedAt,
          durationMs: 0,
          pageUrl: pageUrl(),
          error: null,
          ...blankExtras(),
        };
      } catch {
        return origFetch.call(this, input, init);
      }

      // The request's shape is worked out when the entry is posted, never
      // before the call goes out: the page's request must not wait on it.
      const send = () => {
        draft.requestShape = shapeOfText(requestText, requestType);
        post({ __fp: 'net', entry: draft });
      };

      let res;
      try {
        res = await origFetch.call(this, input, init);
      } catch (err) {
        draft.error = String(err);
        draft.durationMs = Math.round(performance.now() - t0);
        send();
        throw err;
      }

      try {
        draft.status = res.status;
        draft.statusText = res.statusText;
        draft.responseHeaders = headersFromHeaders(res.headers);
        draft.mimeType = mimeOf(draft.responseHeaders);
        draft.durationMs = Math.round(performance.now() - t0);
        applyDisposition(draft);
        const len = contentLength(draft.responseHeaders);
        // A file being saved is never read, whatever its type (docs/12 B6).
        const readable = !draft.isDownload && (draft.mimeType === '' || TEXT_MIME_RE.test(draft.mimeType)) && (len < 0 || len <= MAX_READ_BYTES);
        if (readable && res.body && !res.bodyUsed) {
          // One message per call: body, read error, or timeout — first wins.
          let posted = false;
          const progress = { text: '', cancel: () => {} };
          /**
           * @param {boolean} complete
           * @param {string|null} marker   stands in for the body when nothing usable was read
           */
          const finish = (complete, marker) => {
            if (posted) return;
            posted = true;
            try {
              if (marker !== null && !progress.text) draft.responseBody = marker;
              else applyText(draft, progress.text.length > MAX_READ_CHARS ? progress.text.slice(0, MAX_READ_CHARS) : progress.text, complete);
            } catch {
              draft.responseBody = '<unreadable>';
            }
            send();
          };
          const timer = setTimeout(() => {
            finish(false, `<body read timed out after ${BODY_READ_TIMEOUT_MS}ms>`);
            // Stop pulling a stream that may never end.
            progress.cancel();
          }, BODY_READ_TIMEOUT_MS);
          readCapped(res, MAX_READ_CHARS, progress)
            .then((complete) => finish(complete, null))
            .catch(() => finish(false, '<unreadable>'))
            .finally(() => clearTimeout(timer));
        } else {
          draft.responseBody = draft.mimeType ? `<${draft.mimeType} body not captured>` : null;
          draft.responseSize = len;
          send();
        }
      } catch {
        send();
      }
      return res;
    };
    window.fetch = wrapped;
  }

  // ------------------------------------------------------------------ XHR
  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open;
  const origSend = XHR.send;
  const origSetHeader = XHR.setRequestHeader;

  /**
   * @typedef {Object} XhrMeta
   * @property {string} method
   * @property {string} url
   * @property {{ name: string, value: string }[]} headers
   * @property {string} startedAt
   * @property {number} t0
   */
  /** @type {WeakMap<XMLHttpRequest, XhrMeta>} */
  const metas = new WeakMap();

  /**
   * @this {XMLHttpRequest}
   * @param {string} method
   * @param {string|URL} url
   * @param {unknown[]} rest
   */
  XHR.open = function (method, url, ...rest) {
    try {
      metas.set(this, { method: String(method || 'GET').toUpperCase(), url: absolute(String(url || '')), headers: [], startedAt: '', t0: 0 });
    } catch {
      /* ignore */
    }
    // @ts-ignore — forwarding the overloaded (async, user, password) tail verbatim
    return origOpen.call(this, method, url, ...rest);
  };

  XHR.setRequestHeader = function (name, value) {
    try {
      const m = metas.get(this);
      if (m) m.headers.push({ name: String(name), value: String(value) });
    } catch {
      /* ignore */
    }
    return origSetHeader.call(this, name, value);
  };

  XHR.send = function (body) {
    const m = metas.get(this);
    if (m) {
      m.startedAt = new Date().toISOString();
      m.t0 = performance.now();
      const requestText = describeBody(body);
      const requestBody = truncate(requestText, MAX_REQ);
      this.addEventListener('loadend', () => {
        try {
          const responseHeaders = headersFromRaw(this.getAllResponseHeaders());
          /** @type {NetDraft} */
          const draft = {
            kind: 'xhr',
            method: m.method,
            url: m.url,
            status: this.status,
            statusText: this.statusText,
            requestHeaders: m.headers,
            requestBody,
            responseHeaders,
            responseBody: null,
            mimeType: mimeOf(responseHeaders),
            startedAt: m.startedAt,
            durationMs: Math.round(performance.now() - m.t0),
            pageUrl: pageUrl(),
            error: this.status === 0 ? 'network error or aborted' : null,
            ...blankExtras(),
          };
          applyDisposition(draft);
          draft.requestShape = shapeOfText(requestText, contentTypeOf(m.headers));

          const rt = this.responseType;
          /** @type {string|null} */
          let text = null;
          if (rt === '' || rt === 'text') text = this.responseText;
          else if (rt === 'json') text = JSON.stringify(this.response);
          else if (rt === 'document') text = this.response?.documentElement?.outerHTML ?? null;
          else {
            // Binary: the size is knowable without looking inside.
            draft.responseBody = `<${rt} body not captured>`;
            const r = this.response;
            if (r instanceof Blob) draft.responseSize = r.size;
            else if (r instanceof ArrayBuffer) draft.responseSize = r.byteLength;
            else draft.responseSize = contentLength(responseHeaders);
          }

          if (typeof text === 'string') {
            if (draft.isDownload) {
              // A file being saved is never copied, whatever its type (docs/12 B6).
              draft.responseBody = `<${draft.mimeType || 'download'} body not captured>`;
              draft.responseSize = text.length;
            } else {
              const complete = text.length <= MAX_READ_CHARS;
              // A `json` response is already parsed by the browser: describe the value itself.
              applyText(draft, complete ? text : text.slice(0, MAX_READ_CHARS), complete, rt === 'json' ? { value: this.response } : undefined);
              draft.responseSize = text.length;
            }
          }
          post({ __fp: 'net', entry: draft });
        } catch {
          /* ignore */
        }
      });
    }
    return origSend.call(this, body);
  };

  // ------------------------------------------------------- downloads, tabs
  // docs/12 B6. Both wrappers forward first and report second, so the page
  // gets the browser's own result or the browser's own exception. Only the
  // Blob's type and size are reported; its contents are never touched.
  const origCreateObjectURL = URL.createObjectURL;
  if (typeof origCreateObjectURL === 'function') {
    URL.createObjectURL = function (...args) {
      // @ts-ignore — forwarding the overloaded signature verbatim
      const r = origCreateObjectURL.apply(this, args);
      try {
        const obj = args[0];
        if (listening && obj instanceof Blob) post({ __fp: 'blob', mime: String(obj.type || ''), size: obj.size, at: new Date().toISOString() });
      } catch {
        /* ignore */
      }
      return r;
    };
  }

  /**
   * Where a window.open points, without its query string or the query part of
   * its fragment. Anything that is not http(s) is reported as null.
   * @param {unknown} url
   * @returns {string|null}
   */
  const cleanOpenUrl = (url) => {
    try {
      if (url == null || url === '') return null;
      const u = new URL(String(url), location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      const frag = /^#!?\//.test(u.hash) ? u.hash.split('?')[0] : '';
      return u.origin + u.pathname + frag;
    } catch {
      return null;
    }
  };

  const origWindowOpen = window.open;
  if (typeof origWindowOpen === 'function') {
    window.open = function (...args) {
      // @ts-ignore — forwarding the overloaded signature verbatim
      const r = origWindowOpen.apply(this, args);
      try {
        if (listening) post({ __fp: 'open', url: cleanOpenUrl(args[0]), target: args[1] == null ? null : String(args[1]).slice(0, 80), at: new Date().toISOString() });
      } catch {
        /* ignore */
      }
      return r;
    };
  }

  // -------------------------------------------------------------- history
  // Patched here because an isolated-world patch only sees the isolated
  // world's own calls; the page router lives in this realm (Q7).
  for (const fn of /** @type {const} */ (['pushState', 'replaceState'])) {
    const orig = history[fn];
    if (typeof orig !== 'function') continue;
    history[fn] = function (...args) {
      // @ts-ignore — forwarding the overloaded signature verbatim
      const r = orig.apply(this, args);
      post({ __fp: 'nav', kind: fn });
      return r;
    };
  }

  // ------------------------------------------------------------ framework
  // Globals and expando properties are only visible from this realm. Answered
  // on request so the content script can ask after the app has booted.
  const detectFramework = () => {
    const w = /** @type {Record<string, any>} */ (/** @type {unknown} */ (window));
    /** @type {Partial<FrameworkInfo>} */
    const out = { framework: 'plain', version: null, confidence: 'low', webComponents: false };
    try {
      const ngEl = document.querySelector('[ng-version]');
      if (ngEl || w.ng || w.getAllAngularRootElements) {
        out.framework = 'angular';
        out.version = ngEl ? ngEl.getAttribute('ng-version') : w.ng && w.ng.VERSION ? String(w.ng.VERSION.full) : null;
        out.confidence = 'high';
      } else if (w.__REACT_DEVTOOLS_GLOBAL_HOOK__ || hasExpando(/^__react(Fiber|InternalInstance|Props)\$/)) {
        out.framework = 'react';
        const hook = w.__REACT_DEVTOOLS_GLOBAL_HOOK__;
        try {
          const renderers = hook && hook.renderers ? Array.from(hook.renderers.values()) : [];
          out.version = renderers.length && renderers[0].version ? String(renderers[0].version) : null;
        } catch {
          /* ignore */
        }
        out.confidence = 'high';
      } else if (w.__VUE__ || w.Vue || hasExpando(/^__vue(_app)?__$/)) {
        out.framework = 'vue';
        out.version = w.Vue && w.Vue.version ? String(w.Vue.version) : w.__VUE__ ? '3' : null;
        out.confidence = 'high';
      } else if (document.querySelector('[class*="svelte-"]')) {
        out.framework = 'svelte';
        out.confidence = 'medium';
      } else if (w.jQuery && w.jQuery.fn) {
        out.framework = 'jquery';
        out.version = w.jQuery.fn.jquery ? String(w.jQuery.fn.jquery) : null;
        out.confidence = 'high';
      }
      out.webComponents = hasCustomElements();
    } catch {
      /* ignore */
    }
    return out;
  };

  /**
   * @param {RegExp} re
   * @returns {boolean}
   */
  const hasExpando = (re) => {
    const els = document.querySelectorAll('body, body *');
    const limit = Math.min(els.length, 300);
    for (let i = 0; i < limit; i++) {
      for (const k of Object.keys(els[i])) if (re.test(k)) return true;
    }
    return false;
  };

  const hasCustomElements = () => {
    const els = document.querySelectorAll('*');
    const limit = Math.min(els.length, 2000);
    for (let i = 0; i < limit; i++) {
      const tag = els[i].tagName.toLowerCase();
      if (tag.includes('-') && customElements.get(tag)) return true;
      if (els[i].shadowRoot) return true;
    }
    return false;
  };

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data) return;
    const kind = ev.data.__fp;
    if (kind === 'detect') {
      listening = true;
      post({ __fp: 'framework', info: detectFramework() });
    } else if (kind === 'config') {
      listening = true;
      // Anything but an explicit 'full' is the default. The worker checks the
      // setting again before it stores a body, so a page posting this
      // envelope to itself gains nothing.
      keepBodies = ev.data.keepBodies === 'full' ? 'full' : 'shape';
    }
  });
})();
