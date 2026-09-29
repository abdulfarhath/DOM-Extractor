/**
 * File naming for the export folder — docs/03. One stem per state, shared by
 * states/, dom/ and screens/ so the files line up. Also the page identity
 * every export builder shares (docs/12 B1/B2), kept here because this module
 * imports nothing and so can be imported by all of them.
 */

/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */

const STEM_MAX = 40;

/**
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, STEM_MAX)
    .replace(/-+$/, '');
}

/**
 * `0007-step-2` — zero-padded sequence plus a slug of the title, or the
 * pathname when the title is empty.
 * @param {StateRecord} s
 * @returns {string}
 */
export function stemFor(s) {
  const source = s.title && s.title.trim() ? s.title : s.pathname;
  const slug = slugify(source) || slugify(s.pathname) || 'page';
  return `${String(s.seq).padStart(4, '0')}-${slug}`;
}

/**
 * @param {string} origin
 * @returns {string}   host with dots kept, everything else slugged
 */
export function hostSlug(origin) {
  try {
    return new URL(origin).host.replace(/[^a-z0-9.-]+/gi, '-').toLowerCase();
  } catch {
    return slugify(origin) || 'site';
  }
}

/**
 * `flowprint-example.com-2026-09-16T1430` — local time, minute precision.
 * @param {string|null} host   null when the session spans several origins
 * @param {Date} d
 * @returns {string}
 */
export function exportFolderName(host, d) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}`;
  return host ? `flowprint-${host}-${stamp}` : `flowprint-${stamp}`;
}

/**
 * A TypeScript-safe identifier from a stem or key.
 * @param {string} text
 * @returns {string}
 */
export function identifier(text) {
  const parts = text.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const camel = parts.map((p, i) => (i === 0 ? p.toLowerCase() : p[0].toUpperCase() + p.slice(1).toLowerCase())).join('');
  const safe = /^[0-9]/.test(camel) ? `_${camel}` : camel || '_';
  return /^(break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|false|finally|for|function|if|import|in|instanceof|new|null|return|super|switch|this|throw|true|try|typeof|var|void|while|with|yield|let|static|await|async)$/.test(safe) ? `_${safe}` : safe;
}

// ------------------------------------------------ docs/12: page identity

/**
 * Which page a state is. States captured before 1.1.0 have no `route`; their
 * pathname is the best identity they carry.
 * @param {StateRecord} s
 * @returns {string}
 */
export function routeOf(s) {
  if (!s) return '/';
  if (typeof s.route === 'string' && s.route) return s.route;
  return typeof s.pathname === 'string' && s.pathname ? s.pathname : '/';
}

/**
 * @param {StateRecord} s
 * @returns {string}   '' when the page has no view groups, or the state predates them
 */
export function viewKeyOf(s) {
  return s && s.view && typeof s.view.key === 'string' ? s.view.key : '';
}

/**
 * @param {number} n   1-based
 * @returns {string}   `pg_001`
 */
export function pageIdFor(n) {
  return `pg_${String(n).padStart(3, '0')}`;
}

/**
 * Page ids by route, in order of first appearance. site-map.json, routes.json,
 * coverage.json and flow-map.json all take their ids from here, so a page has
 * one id across the package.
 * @param {StateRecord[]} states
 * @returns {Map<string, string>}   route → page id
 */
export function pageIdsByRoute(states) {
  /** @type {Map<string, string>} */
  const ids = new Map();
  for (const s of states || []) {
    // The same filter every builder applies, so no builder numbers a page another skipped.
    if (!s || !s.id) continue;
    const r = routeOf(s);
    if (!ids.has(r)) ids.set(r, pageIdFor(ids.size + 1));
  }
  return ids;
}

/**
 * Redaction packs replace matched text with `<UPPERCASE>` placeholders, in
 * routes and URLs too. Matched by shape so no pack has to be named here.
 */
export const PLACEHOLDER_RE = /<[A-Z][A-Z0-9_]*>/;

/**
 * `base`, or `base_2`, `base_3`… when taken. Adds the result to `taken`.
 * @param {string} base
 * @param {Set<string>} taken
 * @returns {string}
 */
export function uniqueName(base, taken) {
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
  taken.add(name);
  return name;
}
