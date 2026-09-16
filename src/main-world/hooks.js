/* MAIN-world hooks — docs/01, docs/02 "Network capture", docs/09 Q7/Q8.
   Runs in the page's own JS realm at document_start so it can wrap fetch,
   XMLHttpRequest and history before the app bundle loads, and can see page
   globals for framework detection. It has no chrome.* access, keeps no
   captured data, and must never alter what the page sees: same response
   object, same errors, same history behaviour.

   Everything goes out through window.postMessage with a `__fp` envelope. When
   no content script is listening (origin not consented) the messages are
   simply dropped by the browser. Bodies are truncated here and scrubbed in
   the isolated world before storage. */
(() => {
  if (window.__fpHooked) return;
  window.__fpHooked = true;

  const MAX_REQ = 2000; // CAPS.REQUEST_BODY_CHARS
  const MAX_RES = 4000; // CAPS.RESPONSE_BODY_CHARS
  const MAX_READ_BYTES = 2 * 1024 * 1024;
  const BODY_READ_TIMEOUT_MS = 5000;
  const TEXT_MIME_RE = /^(text\/|application\/(json|xml|x-www-form-urlencoded|javascript|ld\+json|problem\+json|graphql)|.*\+(json|xml))/i;

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
      try {
        const req = input instanceof Request ? input : null;
        const url = absolute(req ? req.url : input instanceof URL ? input.href : String(input));
        const method = String((init && init.method) || (req && req.method) || 'GET').toUpperCase();
        const requestHeaders = init && init.headers ? headersFromInit(init.headers) : req ? headersFromHeaders(req.headers) : [];
        draft = {
          kind: 'fetch',
          method,
          url,
          status: 0,
          statusText: '',
          requestHeaders,
          requestBody: truncate(describeBody(init && init.body), MAX_REQ),
          responseHeaders: [],
          responseBody: null,
          mimeType: '',
          startedAt,
          durationMs: 0,
          pageUrl: pageUrl(),
          error: null,
        };
      } catch {
        return origFetch.call(this, input, init);
      }

      let res;
      try {
        res = await origFetch.call(this, input, init);
      } catch (err) {
        draft.error = String(err);
        draft.durationMs = Math.round(performance.now() - t0);
        post({ __fp: 'net', entry: draft });
        throw err;
      }

      try {
        draft.status = res.status;
        draft.statusText = res.statusText;
        draft.responseHeaders = headersFromHeaders(res.headers);
        draft.mimeType = mimeOf(draft.responseHeaders);
        draft.durationMs = Math.round(performance.now() - t0);
        const len = contentLength(draft.responseHeaders);
        const readable = (draft.mimeType === '' || TEXT_MIME_RE.test(draft.mimeType)) && (len < 0 || len <= MAX_READ_BYTES);
        if (readable && res.body && !res.bodyUsed) {
          // One message per call: body, read error, or timeout — first wins.
          let posted = false;
          /** @param {string|null} body */
          const finish = (body) => {
            if (posted) return;
            posted = true;
            draft.responseBody = body;
            post({ __fp: 'net', entry: draft });
          };
          const timer = setTimeout(() => finish(`<body read timed out after ${BODY_READ_TIMEOUT_MS}ms>`), BODY_READ_TIMEOUT_MS);
          res
            .clone()
            .text()
            .then((text) => finish(truncate(text, MAX_RES)))
            .catch(() => finish('<unreadable>'))
            .finally(() => clearTimeout(timer));
        } else {
          draft.responseBody = draft.mimeType ? `<${draft.mimeType} body not captured>` : null;
          post({ __fp: 'net', entry: draft });
        }
      } catch {
        post({ __fp: 'net', entry: draft });
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
      const requestBody = truncate(describeBody(body), MAX_REQ);
      this.addEventListener('loadend', () => {
        try {
          const responseHeaders = headersFromRaw(this.getAllResponseHeaders());
          /** @type {string|null} */
          let responseBody;
          const rt = this.responseType;
          if (rt === '' || rt === 'text') responseBody = truncate(this.responseText, MAX_RES);
          else if (rt === 'json') responseBody = truncate(JSON.stringify(this.response), MAX_RES);
          else if (rt === 'document') responseBody = truncate(this.response?.documentElement?.outerHTML ?? null, MAX_RES);
          else responseBody = `<${rt} body not captured>`;
          post({
            __fp: 'net',
            entry: {
              kind: 'xhr',
              method: m.method,
              url: m.url,
              status: this.status,
              statusText: this.statusText,
              requestHeaders: m.headers,
              requestBody,
              responseHeaders,
              responseBody,
              mimeType: mimeOf(responseHeaders),
              startedAt: m.startedAt,
              durationMs: Math.round(performance.now() - m.t0),
              pageUrl: pageUrl(),
              error: this.status === 0 ? 'network error or aborted' : null,
            },
          });
        } catch {
          /* ignore */
        }
      });
    }
    return origSend.call(this, body);
  };

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
    if (ev.source !== window || !ev.data || ev.data.__fp !== 'detect') return;
    post({ __fp: 'framework', info: detectFramework() });
  });
})();
