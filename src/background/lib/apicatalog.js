/**
 * api-catalog.json — docs/12 B8. One entry per endpoint the page called:
 * a URL template, the merged shape of what went in and what came back, which
 * arrays in the response look like row data, which parameters look like
 * paging, and which pages and actions caused the call.
 *
 * Pure: no chrome.*, no storage. `groupEndpoints` is the single source of
 * endpoint identity — site-map.json derives its endpoint ids through it, so
 * an id means the same endpoint in every file of the package.
 */
import { routeOf, PLACEHOLDER_RE } from './naming.js';

/** @typedef {import('../../shared/schema.js').NetEntry} NetEntry */
/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../../shared/schema.js').ActionEntry} ActionEntry */
/** @typedef {import('../../shared/schema.js').JsonShape} JsonShape */
/** @typedef {import('../../shared/schema.js').ApiEndpoint} ApiEndpoint */
/** @typedef {import('../../shared/schema.js').ApiCatalog} ApiCatalog */

/**
 * @typedef {Object} ParsedCallUrl
 * @property {string} scheme
 * @property {string} host
 * @property {string[]} segments    decoded path segments, matrix parameters dropped
 * @property {string[]} queryKeys   names only
 * @property {string} ext           lowercased extension of the last segment, '' without one
 */

/**
 * Calls that share one template.
 * @typedef {Object} EndpointGroup
 * @property {string} id            `api_001`, in order of first call
 * @property {string} key           `METHOD host/templated/path`
 * @property {string} method
 * @property {string} scheme
 * @property {string} host
 * @property {string} path          templated, leading slash
 * @property {string} urlTemplate   scheme://host + path
 * @property {NetEntry[]} calls
 */

/** @typedef {{ n: NetEntry, method: string, scheme: string, host: string, segs: string[] }} CallInfo */

const ID = '{id}';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RE = /^[0-9a-f]{16,}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,}$/;
const EXT_RE = /\.([A-Za-z][A-Za-z0-9]{0,4})$/;
const URL_RE = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/i;

/** Scripts, styles, images, fonts and source maps are never endpoints. */
const STATIC_EXT = new Set(['js', 'mjs', 'cjs', 'css', 'map', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp', 'woff', 'woff2', 'ttf', 'otf', 'eot']);
const STATIC_MIME_RE = /javascript|ecmascript|text\/css|^image\/|^font\/|x-font|font-|ms-fontobject|opentype|truetype/i;

/** Two shapes are the same endpoint when this share of their leaf paths is common. */
const SHAPE_MATCH = 0.7;
/** Templating one position can expose the next; three rounds settle every case seen. */
const MAX_PASSES = 3;
const MAX_LIST_PATHS = 20;
const MAX_ENUM = 8;

/**
 * Parameter names that mean paging on their own, lowercased with separators
 * removed. Matched on the name only, never on a value.
 */
const PAGING_EXACT = new Set([
  'page', 'pg', 'pageno', 'pagenum', 'pagenumber', 'pageindex', 'pagesize', 'perpage', 'currentpage',
  'offset', 'limit', 'size', 'start', 'skip', 'top', 'cursor',
]);
/** Words that mean paging wherever they appear in a name: `nextPageToken`, `page[size]`. */
const PAGING_ANYWHERE = new Set(['page', 'paging', 'pagination', 'offset', 'cursor', 'limit', 'skip']);
/** `size` and `start` are too common to trust alone inside a longer name; they need one of these beside them. */
const PAGING_UNIT = new Set(['size', 'start', 'count', 'max', 'first', 'last']);
const PAGING_NOUN = new Set(['row', 'rows', 'record', 'records', 'result', 'results', 'item', 'items', 'index', 'batch']);

/**
 * @param {string} s
 * @returns {string}
 */
function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Split a recorded URL without `new URL()`: recorded URLs have been through
 * the redaction packs and may hold `<PLACEHOLDER>` text that a strict parser
 * rejects or percent-encodes.
 * @param {string} url
 * @param {string} origin   base for relative URLs
 * @returns {ParsedCallUrl|null}   null for anything that is not http(s)
 */
export function parseCallUrl(url, origin) {
  let text = String(url || '').trim();
  if (!text) return null;
  if (text.startsWith('//')) text = `${(URL_RE.exec(origin || '') || [])[1] || 'https'}:${text}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    if (!origin) return null;
    text = `${origin.replace(/\/+$/, '')}${text.startsWith('/') ? '' : '/'}${text}`;
  }
  const m = URL_RE.exec(text);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') return null;
  const host = m[2].replace(/^[^@]*@/, '').toLowerCase();
  const segments = (m[3] || '')
    .split('/')
    .map((s) => safeDecode(s.split(';')[0]))
    .filter(Boolean);
  /** @type {Set<string>} */
  const keys = new Set();
  for (const pair of (m[4] || '').split('&')) {
    const k = safeDecode(pair.split('=')[0].replace(/\+/g, ' ')).trim();
    if (k) keys.add(k);
  }
  const last = segments[segments.length - 1] || '';
  const e = EXT_RE.exec(last);
  return { scheme, host, segments, queryKeys: Array.from(keys).sort(), ext: e ? e[1].toLowerCase() : '' };
}

/**
 * @param {NetEntry} n
 * @param {ParsedCallUrl} u
 * @returns {boolean}
 */
export function isStaticAsset(n, u) {
  // A file the site hands over is what a scraper is after, whatever its type.
  if (n.isDownload) return false;
  const mime = String(n.mimeType || '');
  if (STATIC_MIME_RE.test(mime)) return true;
  if (u.ext === 'map') return true;
  if (u.ext && STATIC_EXT.has(u.ext)) return !/json|xml/i.test(mime);
  return false;
}

/**
 * How often the character class (lower, upper, digit, other) changes between
 * neighbours, 0..1. Random tokens switch constantly; names switch at word
 * boundaries only. Tells `getAccountSummaryV2` from an opaque token without
 * knowing any language.
 * @param {string} s
 * @returns {number}
 */
function classChurn(s) {
  if (s.length < 2) return 0;
  /** @param {number} c */
  const cls = (c) => (c >= 97 && c <= 122 ? 1 : c >= 65 && c <= 90 ? 2 : c >= 48 && c <= 57 ? 3 : 4);
  let changes = 0;
  for (let i = 1; i < s.length; i++) if (cls(s.charCodeAt(i)) !== cls(s.charCodeAt(i - 1))) changes++;
  return changes / (s.length - 1);
}

/**
 * docs/12 B8: all digits, a UUID, a hash or token, or anything a redaction
 * pack replaced.
 * @param {string} seg
 * @returns {boolean}
 */
export function looksLikeId(seg) {
  if (!seg) return false;
  if (seg === ID) return true;
  if (PLACEHOLDER_RE.test(seg)) return true;
  if (/^\d+$/.test(seg)) return true;
  if (UUID_RE.test(seg) || HEX_RE.test(seg)) return true;
  return TOKEN_RE.test(seg) && /\d/.test(seg) && /[A-Za-z]/.test(seg) && classChurn(seg) >= 0.4;
}

/**
 * @param {string} seg
 * @returns {string}   `{id}`, `{id}.ext`, or the segment unchanged
 */
function templateSegment(seg) {
  if (looksLikeId(seg)) return ID;
  const e = EXT_RE.exec(seg);
  if (e && looksLikeId(seg.slice(0, e.index))) return `${ID}.${e[1].toLowerCase()}`;
  return seg;
}

/** @param {string} seg */
const isTemplated = (seg) => seg === ID || seg.startsWith(`${ID}.`);

/**
 * One URL with its identifier-like segments replaced, for a download or a
 * link that has no sibling calls to compare against. Query values were never
 * recorded; only the names remain, and they are listed, not templated.
 * @param {string} url
 * @param {string} origin
 * @returns {string}   the input when it cannot be parsed
 */
export function templateUrl(url, origin) {
  const u = parseCallUrl(url, origin);
  if (!u) return String(url || '');
  return `${u.scheme}://${u.host}/${u.segments.map(templateSegment).join('/')}`;
}

// ------------------------------------------------------------------ shapes

/**
 * Leaf key paths of a shape, arrays written `[]`. Used only to decide whether
 * two responses are the same kind of thing.
 * @param {JsonShape|null|undefined} shape
 * @param {string} prefix
 * @param {number} depth
 * @param {Set<string>} out
 */
function leafPaths(shape, prefix, depth, out) {
  if (!shape || shape.t === 'truncated') return;
  if (shape.t === 'object' && shape.keys && depth < 5) {
    const keys = Object.keys(shape.keys);
    if (!keys.length) out.add(`${prefix}{}`);
    for (const k of keys) leafPaths(shape.keys[k], `${prefix}.${k}`, depth + 1, out);
    return;
  }
  if (shape.t === 'array' && shape.item && depth < 5) {
    leafPaths(shape.item, `${prefix}[]`, depth + 1, out);
    return;
  }
  // Value types are left out on purpose: null in one call and a string in the next is one field.
  out.add(shape.t === 'object' || shape.t === 'array' ? `${prefix}:${shape.t}` : prefix);
}

/**
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number}
 */
function overlap(a, b) {
  if (!a.size && !b.size) return 1;
  let common = 0;
  for (const x of a) if (b.has(x)) common++;
  return common / (a.size + b.size - common);
}

/**
 * Union of two shapes: every key either one has, keys missing from one side
 * marked optional. Builds new objects; the inputs belong to stored entries.
 * @param {JsonShape|null|undefined} a
 * @param {JsonShape|null|undefined} b
 * @returns {JsonShape|null}
 */
export function mergeShapes(a, b) {
  if (!a || typeof a !== 'object') return b && typeof b === 'object' ? b : null;
  if (!b || typeof b !== 'object' || a === b) return a;
  // A truncated shape says nothing; the other side is always the better record.
  if (a.t === 'truncated') return b;
  if (b.t === 'truncated') return a;
  if (a.t === 'null' && b.t === 'null') return a;
  if (a.t === 'null') return { ...b, nullable: true };
  if (b.t === 'null') return { ...a, nullable: true };
  const nullable = a.nullable || b.nullable ? { nullable: true } : {};
  if (a.t !== b.t) return { t: 'mixed', ...nullable };

  if (a.t === 'object') {
    const ka = a.keys || {};
    const kb = b.keys || {};
    /** @type {Record<string, JsonShape>} */
    const keys = {};
    const optional = new Set([...(a.optional || []), ...(b.optional || [])]);
    for (const k of Object.keys(ka)) {
      const merged = Object.prototype.hasOwnProperty.call(kb, k) ? mergeShapes(ka[k], kb[k]) : ka[k];
      if (!Object.prototype.hasOwnProperty.call(kb, k)) optional.add(k);
      if (merged) keys[k] = merged;
    }
    for (const k of Object.keys(kb)) {
      if (Object.prototype.hasOwnProperty.call(ka, k)) continue;
      optional.add(k);
      keys[k] = kb[k];
    }
    /** @type {JsonShape} */
    const out = { t: 'object', keys, ...nullable };
    if (optional.size) out.optional = Array.from(optional).filter((k) => Object.prototype.hasOwnProperty.call(keys, k)).sort();
    return out;
  }

  if (a.t === 'array') {
    return { t: 'array', len: Math.max(a.len || 0, b.len || 0), item: mergeShapes(a.item, b.item), ...nullable };
  }

  if (a.t === 'string') {
    /** @type {JsonShape} */
    const out = { t: 'string', ...nullable };
    if (a.len != null || b.len != null) out.len = Math.max(a.len || 0, b.len || 0);
    if (a.format && a.format === b.format) out.format = a.format;
    else if (a.format || b.format) out.format = 'text';
    // Enum-like only while both sides are: free text on either side ends it.
    if (a.values && b.values) {
      const values = Array.from(new Set([...a.values, ...b.values]));
      if (values.length <= MAX_ENUM) out.values = values;
    }
    return out;
  }

  return { t: a.t, ...nullable };
}

/**
 * Arrays in a shape that look like row data: items are objects and there was
 * more than one. `$` is the root, `[]` steps into an array's items.
 * @param {JsonShape|null|undefined} shape
 * @returns {{ path: string, len: number }[]}
 */
export function listPathsOf(shape) {
  /** @type {{ path: string, len: number }[]} */
  const out = [];
  /**
   * @param {JsonShape|null|undefined} s
   * @param {string} path
   * @param {number} depth
   */
  const walk = (s, path, depth) => {
    if (!s || typeof s !== 'object' || depth > 10 || out.length >= MAX_LIST_PATHS) return;
    if (s.t === 'array') {
      const len = typeof s.len === 'number' ? s.len : 0;
      if (s.item && s.item.t === 'object' && len > 1) out.push({ path, len });
      if (s.item) walk(s.item, `${path}[]`, depth + 1);
    } else if (s.t === 'object' && s.keys) {
      for (const k of Object.keys(s.keys)) walk(s.keys[k], /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`, depth + 1);
    }
  };
  walk(shape, '$', 0);
  return out;
}

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isPagingParam(name) {
  const raw = String(name || '');
  if (PAGING_EXACT.has(raw.toLowerCase().replace(/[^a-z0-9]+/g, ''))) return true;
  const words = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.some((w) => PAGING_ANYWHERE.has(w))) return true;
  return words.some((w) => PAGING_UNIT.has(w)) && words.some((w) => PAGING_NOUN.has(w));
}

// --------------------------------------------------------------- templates

/**
 * What a call says about the kind of thing its endpoint returns. Only
 * successful responses count: an error body looks the same on every endpoint.
 * @param {CallInfo[]} infos
 * @returns {Set<string>|null}   null when there is nothing to go on
 */
function evidenceOf(infos) {
  /** @type {Set<string>} */
  const out = new Set();
  let any = false;
  for (const { n } of infos) {
    const ok = typeof n.status !== 'number' || (n.status >= 200 && n.status < 300);
    const shape = ok && n.responseShape && n.responseShape.t !== 'truncated' ? n.responseShape : null;
    if (!shape) continue;
    any = true;
    leafPaths(shape, '$', 0, out);
  }
  if (any) return out;
  for (const { n } of infos) {
    if (!n.requestShape || n.requestShape.t === 'truncated') continue;
    any = true;
    leafPaths(n.requestShape, '?', 0, out);
  }
  return any ? out : null;
}

/**
 * docs/12 B8, "segments that vary between calls". Calls that share method,
 * host, segment count and every segment but one are candidates for a single
 * template. They are folded only when they also look like one endpoint:
 * matching response shapes, or — with no shapes to compare — values that
 * carry a digit. Without that check two sibling resources (`/api/users`,
 * `/api/orders`) would collapse into `/api/{id}` and their shapes would be
 * merged into nonsense.
 * @param {CallInfo[]} infos   mutated: `segs` end up templated
 */
function templateByVariance(infos) {
  let maxLen = 0;
  for (const i of infos) if (i.segs.length > maxLen) maxLen = i.segs.length;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    for (let pos = 0; pos < maxLen; pos++) {
      /** @type {Map<string, CallInfo[]>} */
      const buckets = new Map();
      for (const i of infos) {
        if (i.segs.length <= pos) continue;
        const rest = i.segs.map((s, k) => (k === pos ? '\u0000' : s)).join('/');
        const key = `${i.method} ${i.host} ${i.segs.length} ${rest}`;
        const arr = buckets.get(key);
        if (arr) arr.push(i);
        else buckets.set(key, [i]);
      }
      for (const bucket of buckets.values()) {
        if (bucket.length < 2) continue;
        /** @type {Map<string, CallInfo[]>} */
        const byValue = new Map();
        for (const i of bucket) {
          const arr = byValue.get(i.segs[pos]);
          if (arr) arr.push(i);
          else byValue.set(i.segs[pos], [i]);
        }
        if (byValue.size < 2) continue;

        /** @type {{ values: string[], evidence: Set<string>|null, valueLike: boolean }[]} */
        const clusters = [];
        for (const [value, calls] of byValue) {
          const evidence = evidenceOf(calls);
          const valueLike = isTemplated(value) || /\d/.test(value);
          const home = clusters.find((c) => (c.evidence && evidence ? overlap(c.evidence, evidence) >= SHAPE_MATCH : c.valueLike && valueLike));
          if (home) home.values.push(value);
          else clusters.push({ values: [value], evidence, valueLike });
        }
        for (const c of clusters) {
          if (c.values.length < 2) continue;
          // `a.pdf` and `b.pdf` stay `{id}.pdf`; mixed or missing extensions drop it.
          const exts = new Set(c.values.map((v) => (isTemplated(v) ? v.slice(ID.length + 1) : (EXT_RE.exec(v) || ['', ''])[1].toLowerCase())));
          const ext = exts.size === 1 ? Array.from(exts)[0] : '';
          const template = ext ? `${ID}.${ext}` : ID;
          for (const v of c.values) {
            if (v === template) continue;
            for (const i of byValue.get(v) || []) i.segs[pos] = template;
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }
}

/**
 * Endpoint identity. Every call that is not a static asset, grouped by
 * method + host + templated path, numbered in order of first call. Depends on
 * `net` and `origin` alone, so any two builders given the same log agree on
 * every id.
 * @param {NetEntry[]} net
 * @param {string} origin   base for relative URLs
 * @returns {EndpointGroup[]}
 */
export function groupEndpoints(net, origin) {
  /** @type {CallInfo[]} */
  const infos = [];
  for (const n of Array.isArray(net) ? net : []) {
    if (!n || typeof n.url !== 'string') continue;
    const u = parseCallUrl(n.url, origin);
    if (!u || isStaticAsset(n, u)) continue;
    infos.push({ n, method: String(n.method || 'GET').toUpperCase(), scheme: u.scheme, host: u.host, segs: u.segments.map(templateSegment) });
  }
  templateByVariance(infos);

  /** @type {Map<string, EndpointGroup>} */
  const groups = new Map();
  for (const i of infos) {
    const path = `/${i.segs.join('/')}`;
    const key = `${i.method} ${i.host}${path}`;
    let g = groups.get(key);
    if (!g) {
      g = { id: `api_${String(groups.size + 1).padStart(3, '0')}`, key, method: i.method, scheme: i.scheme, host: i.host, path, urlTemplate: `${i.scheme}://${i.host}${path}`, calls: [] };
      groups.set(key, g);
    }
    g.calls.push(i.n);
  }
  return Array.from(groups.values());
}

/**
 * @param {EndpointGroup[]} groups
 * @returns {Map<string, string>}   net id → endpoint id
 */
export function endpointIdsByCall(groups) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const g of groups) for (const n of g.calls) out.set(n.id, g.id);
  return out;
}

// ------------------------------------------------------------ attribution

/**
 * @param {string|null|undefined} url
 * @returns {string}   pathname, '' when it cannot be read
 */
function pathOfUrl(url) {
  const m = URL_RE.exec(String(url || ''));
  return m ? m[3] || '/' : '';
}

/**
 * Which state a call fed. `stateIdAtTime` is the state that was on screen
 * when the call started, which for the calls that load a page is the page
 * before it: the new state is only captured once the page has settled. A
 * call belongs to the next state in its tab when it started after the
 * trigger that produced that state, or when it was made from that state's
 * URL and not from the previous one.
 * @param {NetEntry[]} net
 * @param {StateRecord[]} states
 * @returns {Map<string, string|null>}   net id → state id
 */
export function attributeCalls(net, states) {
  /** @type {Map<string, StateRecord>} */
  const byId = new Map();
  /** @type {Map<string, { at: number, s: StateRecord }[]>} */
  const byFrame = new Map();
  for (const s of Array.isArray(states) ? states : []) {
    if (!s || !s.id) continue;
    byId.set(s.id, s);
    const at = Date.parse(s.capturedAt);
    if (!Number.isFinite(at)) continue;
    const key = `${s.tabId}:${s.frameId || 0}`;
    const arr = byFrame.get(key);
    if (arr) arr.push({ at, s });
    else byFrame.set(key, [{ at, s }]);
  }
  for (const arr of byFrame.values()) arr.sort((a, b) => a.at - b.at);

  /** @type {Map<string, string|null>} */
  const out = new Map();
  for (const n of Array.isArray(net) ? net : []) {
    if (!n || !n.id) continue;
    const atTime = n.stateIdAtTime ? byId.get(n.stateIdAtTime) || null : null;
    const started = Date.parse(n.startedAt);
    /** @type {StateRecord|null} */
    let next = null;
    if (Number.isFinite(started)) {
      const arr = byFrame.get(`${n.tabId}:${n.stateIdInferred ? 0 : n.frameId || 0}`) || [];
      let lo = 0;
      let hi = arr.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid].at < started) lo = mid + 1;
        else hi = mid;
      }
      if (lo < arr.length) next = arr[lo].s;
    }
    if (!next || next === atTime) {
      out.set(n.id, atTime ? atTime.id : null);
      continue;
    }
    if (!atTime) {
      out.set(n.id, next.id);
      continue;
    }
    const trigger = Date.parse(next.triggerAt);
    const from = pathOfUrl(n.pageUrl);
    const afterTrigger = Number.isFinite(trigger) && started >= trigger;
    const fromNextUrl = !!from && from === pathOfUrl(next.url) && from !== pathOfUrl(atTime.url);
    out.set(n.id, afterTrigger || fromNextUrl ? next.id : atTime.id);
  }
  return out;
}

// ----------------------------------------------------------------- catalog

/**
 * @param {string[]} list
 * @param {string|null|undefined} v
 */
function pushUnique(list, v) {
  if (v && !list.includes(v)) list.push(v);
}

const WRITE_METHODS = new Set(['PUT', 'PATCH', 'DELETE']);
/** Verbs in code identifiers (path segments, operation names), not UI text. */
const WRITE_TOKEN_RE = /^(?:update|upd|delete|del|remove|submit|cancel|withdraw|approve|reject|upload|pay|payment|confirm|finali[sz]e|revoke|mark|set|patch|put|post|create|insert|discard|file|lodge)$/i;
/** Request-body keys that conventionally name the operation a POST performs. */
const OP_KEY_RE = /^(?:service(?:name)?|action(?:name)?|operation(?:name)?|op|method|command|cmd|mutation|query)$/i;

/**
 * @param {string} id
 * @returns {string[]}
 */
const idTokens = (id) => id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z]+/).filter(Boolean);

/**
 * Whether an endpoint may change something on the server, and why: the HTTP
 * method, a write verb in the path, or a write verb in the operation name a
 * POST body carries. POST alone proves nothing — many sites read over POST.
 * A consumer that must stay read-only treats every hit as off limits.
 * @param {EndpointGroup} g
 * @returns {string|null}
 */
export function writeHintOf(g) {
  if (WRITE_METHODS.has(g.method)) return `method ${g.method}`;
  if (g.method === 'GET' || g.method === 'HEAD' || g.method === 'OPTIONS') return null;
  for (const seg of g.path.split('/')) {
    const hit = idTokens(seg).find((t) => WRITE_TOKEN_RE.test(t));
    if (hit) return `path word "${hit}"`;
  }
  for (const n of g.calls) {
    if (!n.requestBody) continue;
    try {
      const body = JSON.parse(n.requestBody);
      if (!body || typeof body !== 'object' || Array.isArray(body)) continue;
      for (const [k, v] of Object.entries(body)) {
        if (typeof v !== 'string' || !OP_KEY_RE.test(k)) continue;
        const hit = idTokens(v).find((t) => WRITE_TOKEN_RE.test(t));
        if (hit) return `operation "${v.slice(0, 60)}"`;
      }
    } catch {
      /* not JSON: nothing to read */
    }
  }
  return null;
}

/**
 * @param {NetEntry[]} net
 * @param {StateRecord[]} states
 * @param {ActionEntry[]} actions
 * @param {string} origin
 * @returns {ApiCatalog}
 */
export function buildApiCatalog(net, states, actions, origin) {
  const groups = groupEndpoints(net, origin);
  const fed = attributeCalls(net, states);
  /** @type {Map<string, StateRecord>} */
  const stateById = new Map();
  for (const s of Array.isArray(states) ? states : []) if (s && s.id) stateById.set(s.id, s);
  /** @type {Map<string, ActionEntry>} */
  const actionById = new Map();
  for (const a of Array.isArray(actions) ? actions : []) if (a && a.id) actionById.set(a.id, a);

  /** @type {ApiEndpoint[]} */
  const endpoints = groups.map((g) => {
    /** @type {Set<string>} */
    const queryKeys = new Set();
    /** @type {Set<number>} */
    const statuses = new Set();
    /** @type {Map<string, number>} */
    const mimes = new Map();
    /** @type {string[]} */
    const routes = [];
    /** @type {string[]} */
    const stateIds = [];
    /** @type {string[]} */
    const actionIds = [];
    /** @type {JsonShape|null} */
    let requestShape = null;
    /** @type {JsonShape|null} */
    let responseShape = null;
    /** @type {JsonShape|null} */
    let errorShape = null;
    let isDownload = false;
    let hasFullBody = false;

    for (const n of g.calls) {
      const u = parseCallUrl(n.url, origin);
      for (const k of u ? u.queryKeys : []) queryKeys.add(k);
      if (typeof n.status === 'number') statuses.add(n.status);
      const mime = String(n.mimeType || '').split(';')[0].trim().toLowerCase();
      if (mime) mimes.set(mime, (mimes.get(mime) || 0) + 1);
      requestShape = mergeShapes(requestShape, n.requestShape);
      // Error bodies are a different document; merging them in would mark every real key optional.
      if (typeof n.status === 'number' && n.status >= 400) errorShape = mergeShapes(errorShape, n.responseShape);
      else responseShape = mergeShapes(responseShape, n.responseShape);
      if (n.isDownload) isDownload = true;
      if (n.hasFullBody) hasFullBody = true;

      const stateId = fed.get(n.id) || null;
      const state = stateId ? stateById.get(stateId) : undefined;
      const action = n.actionIdAtTime ? actionById.get(n.actionIdAtTime) : undefined;
      pushUnique(stateIds, stateId);
      pushUnique(actionIds, n.actionIdAtTime);
      // With no state to go by, the page the action happened on, then the page URL.
      pushUnique(routes, state ? routeOf(state) : action && action.route ? action.route : pathOfUrl(n.pageUrl));
    }

    // An endpoint that only ever failed still shows what its failure looks like.
    if (!responseShape) responseShape = errorShape;

    /** @type {Set<string>} */
    const paging = new Set();
    for (const k of queryKeys) if (isPagingParam(k)) paging.add(k);
    const body = /** @type {JsonShape|null} */ (requestShape);
    if (body && body.t === 'object' && body.keys) for (const k of Object.keys(body.keys)) if (isPagingParam(k)) paging.add(k);

    let mimeType = '';
    let best = 0;
    for (const [m, count] of mimes) {
      if (count > best) {
        best = count;
        mimeType = m;
      }
    }

    return {
      id: g.id,
      method: g.method,
      urlTemplate: g.urlTemplate,
      host: g.host,
      queryKeys: Array.from(queryKeys).sort(),
      count: g.calls.length,
      statuses: Array.from(statuses).sort((a, b) => a - b),
      mimeType,
      requestShape,
      responseShape,
      listPaths: listPathsOf(responseShape),
      pagingParams: Array.from(paging).sort(),
      calledFromRoutes: routes,
      stateIds,
      actionIds,
      netIds: g.calls.map((n) => n.id),
      isDownload,
      hasFullBody,
      writeHint: writeHintOf(g),
    };
  });

  return { generatedAt: new Date().toISOString(), origin, endpoints };
}
