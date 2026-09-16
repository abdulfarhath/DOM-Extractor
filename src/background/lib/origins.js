/**
 * Consent allow-list — docs/05 rule 1. Origins are exact (`scheme://host[:port]`);
 * subdomains are separate origins and must be added on their own. Nothing else
 * in the extension decides whether capture is allowed.
 */
import { KEYS } from '../../shared/constants.js';

/**
 * @param {string} url
 * @returns {string|null}   normalised origin, or null for non-http(s) URLs
 */
export function originOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** @returns {Promise<string[]>} */
export async function listOrigins() {
  const r = await chrome.storage.local.get(KEYS.ORIGINS);
  const v = r[KEYS.ORIGINS];
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
}

/**
 * @param {string} origin
 * @returns {Promise<boolean>}
 */
export async function isConsented(origin) {
  return (await listOrigins()).includes(origin);
}

/**
 * @param {string} origin
 * @returns {Promise<string[]>}   the list after the change
 */
export async function addOrigin(origin) {
  const list = await listOrigins();
  if (!list.includes(origin)) list.push(origin);
  await chrome.storage.local.set({ [KEYS.ORIGINS]: list });
  return list;
}

/**
 * @param {string} origin
 * @returns {Promise<string[]>}
 */
export async function removeOrigin(origin) {
  const list = (await listOrigins()).filter((o) => o !== origin);
  await chrome.storage.local.set({ [KEYS.ORIGINS]: list });
  return list;
}

/**
 * Packs that should be on for the current set of origins: `generic` always,
 * plus any host-suffix auto-enable from constants (`.in` → `india`).
 * @param {string[]} origins
 * @param {Readonly<Record<string, string>>} autoByHost
 * @returns {string[]}
 */
export function autoPacks(origins, autoByHost) {
  const out = ['generic'];
  for (const o of origins) {
    let host = '';
    try {
      host = new URL(o).hostname;
    } catch {
      continue;
    }
    for (const [suffix, pack] of Object.entries(autoByHost)) {
      if (host.endsWith(suffix) && !out.includes(pack)) out.push(pack);
    }
  }
  return out;
}
