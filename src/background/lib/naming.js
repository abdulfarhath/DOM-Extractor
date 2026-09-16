/**
 * File naming for the export folder — docs/03. One stem per state, shared by
 * states/, dom/ and screens/ so the files line up.
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
