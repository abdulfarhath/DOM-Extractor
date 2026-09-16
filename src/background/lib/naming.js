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
 * `0007-spice-part-a` — zero-padded sequence plus a slug of the title, or the
 * pathname when the title is empty or generic.
 * @param {StateRecord} s
 * @returns {string}
 */
export function stemFor(s) {
  const source = s.title && s.title.trim() ? s.title : s.pathname;
  const slug = slugify(source) || slugify(s.pathname) || 'page';
  return `${String(s.seq).padStart(4, '0')}-${slug}`;
}

/**
 * `mca-capture-2026-09-16T1430` — local time, minute precision.
 * @param {Date} d
 * @returns {string}
 */
export function exportFolderName(d) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `mca-capture-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}`;
}
