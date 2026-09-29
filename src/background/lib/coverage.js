/**
 * coverage.json — docs/12 B8. What the recording visited, what it saw and
 * never opened, and what it left half-done: a list that was never paged, a
 * tab that was never selected. The `hints` are the same findings as
 * sentences the person recording can act on, most valuable first.
 *
 * Pure, and called by the worker on every panel refresh: no chrome.*, no
 * storage.
 */
import { CAPS } from '../../shared/constants.js';
import { routeOf } from './naming.js';
import { arr, norm, menuId, pageLabels } from './sitemap.js';

/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../../shared/schema.js').ActionEntry} ActionEntry */
/** @typedef {import('../../shared/schema.js').DownloadEntry} DownloadEntry */
/** @typedef {import('../../shared/schema.js').SiteMap} SiteMap */
/** @typedef {import('../../shared/schema.js').SiteMapNode} SiteMapNode */
/** @typedef {import('../../shared/schema.js').Coverage} Coverage */
/** @typedef {import('../../shared/schema.js').CoveragePage} CoveragePage */

/**
 * The same path shape capture.js uses for its logged-in signal: a path
 * segment, never visible text, so it holds in any language. Pressing it ends
 * the session, so it is never something the recording "missed".
 */
const LOGOUT_PATH_RE = /(^|[/?#_-])(logout|signout|sign-out|log-out)([/?#_-]|$)/i;

/**
 * @param {string} s
 * @returns {string}   safe between double quotes in a sentence
 */
const q = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/"/g, "'").trim();

/**
 * @param {SiteMap} siteMap
 * @param {StateRecord[]} states
 * @param {ActionEntry[]} actions
 * @param {DownloadEntry[]} downloads
 * @param {string} origin
 * @returns {Coverage}
 */
export function buildCoverage(siteMap, states, actions, downloads, origin) {
  const menu = arr(siteMap && siteMap.menu);
  const pages = arr(siteMap && siteMap.pages);
  const allStates = arr(states).filter((s) => s && s.id);
  const labels = pageLabels(siteMap);

  // ---- menu
  /** @type {Map<string, SiteMapNode[]>} */
  const children = new Map();
  for (const node of menu) {
    if (arr(node.path).length < 2) continue;
    const parent = menuId(node.path.slice(0, -1));
    const list = children.get(parent);
    if (list) list.push(node);
    else children.set(parent, [node]);
  }
  /** @param {SiteMapNode} node */
  const isLogout = (node) => !!node.href && LOGOUT_PATH_RE.test(node.href);
  /** @type {Map<string, boolean>} */
  const done = new Map();
  /**
   * A branch heading with no address of its own has nothing to open; it is
   * covered once everything under it is.
   * @param {SiteMapNode} node
   * @param {number} depth
   * @returns {boolean}
   */
  const covered = (node, depth) => {
    const known = done.get(node.id);
    if (known !== undefined) return known;
    let v = !!node.visited;
    if (!v && node.hasChildren && !node.href && depth < 12) {
      const kids = (children.get(node.id) || []).filter((k) => !isLogout(k));
      v = kids.length > 0 && kids.every((k) => covered(k, depth + 1));
    }
    done.set(node.id, v);
    return v;
  };
  const counted = menu.filter((n) => !isLogout(n));
  const unvisited = counted.filter((n) => !covered(n, 0));

  // ---- what the states and actions say about each page
  /** @type {Map<string, Set<string>>} route → net ids */
  const callsOn = new Map();
  /** @type {Set<string>} routes that show something to download */
  const offersDownload = new Set();
  /** @type {Set<string>} `route|group|option` for options that were pressable at least once */
  const enabled = new Set();
  /** @type {Set<string>} same key, for options seen at all */
  const seen = new Set();
  for (const s of allStates) {
    const route = routeOf(s);
    let calls = callsOn.get(route);
    if (!calls) callsOn.set(route, (calls = new Set()));
    for (const id of arr(s.netRefs)) calls.add(id);
    const lists = s.lists;
    if (lists && (arr(lists.downloads).length || arr(lists.repeats).some((r) => arr(r && r.slots).some((slot) => slot && slot.download)))) offersDownload.add(route);
    for (const g of arr(s.nav && s.nav.viewGroups)) {
      const name = String((g && (g.name || g.label || g.containerSelector)) || '');
      for (const o of arr(g && g.options)) {
        if (!o) continue;
        const key = `${route}|${name}|${norm(o.text) || o.selector}`;
        seen.add(key);
        if (!o.disabled) enabled.add(key);
      }
    }
  }
  for (const a of arr(actions)) if (a && a.download && a.route) offersDownload.add(a.route);

  // ---- pages
  /** @type {string[]} */
  const viewHints = [];
  /** @type {string[]} */
  const pagingHints = [];
  /** @type {string[]} */
  const openHints = [];
  /** @type {string[]} */
  const downloadHints = [];
  let viewOptions = 0;
  let viewOptionsVisited = 0;
  let lists = 0;
  let listsPaged = 0;

  /** @type {CoveragePage[]} */
  const coveragePages = pages.map((p) => {
    const name = q(labels.get(p.id) || p.route);
    /** @type {string[]} */
    const missing = [];

    const viewGroups = arr(p.viewGroups).map((g) => {
      const what = g.kind === 'tabs' ? 'tab' : g.kind === 'chips' ? 'filter option' : 'option';
      const verb = g.kind === 'tabs' ? 'opened' : 'selected';
      const of = g.label && arr(g.options).length ? ` of "${q(g.label)}"` : '';
      for (const o of arr(g.options)) {
        viewOptions++;
        if (o.visited) {
          viewOptionsVisited++;
          continue;
        }
        const key = `${p.route}|${g.name}|${norm(o.text) || o.selector}`;
        // An option that was greyed out every time it was seen is not something the person skipped.
        if (seen.has(key) && !enabled.has(key)) continue;
        const sentence = `On "${name}", the ${what} "${q(o.text) || q(o.selector)}"${of} was never ${verb}.`;
        missing.push(sentence);
        viewHints.push(sentence);
      }
      return { name: g.name, options: arr(g.options).map((o) => ({ text: o.text, visited: !!o.visited })) };
    });

    const pageLists = arr(p.lists).map((l) => {
      lists++;
      if (l.paged && l.hasPagination) listsPaged++;
      return { selector: l.selector, kind: l.kind, hasPagination: !!l.hasPagination, paged: !!l.paged, itemOpened: !!l.itemOpened, downloadSeen: !!l.downloadSeen };
    });
    // One sentence per page, however many lists it holds: a page of cards,
    // a sidebar and a footer is still one thing to the person looking at it.
    const many = pageLists.length > 1;
    if (pageLists.some((l) => l.hasPagination && !l.paged)) {
      const sentence = `The list on "${name}" has more pages but "next page" was never clicked.`;
      missing.push(sentence);
      pagingHints.push(sentence);
    }
    if (pageLists.length && !pageLists.some((l) => l.itemOpened)) {
      const sentence = many ? `No item was opened from any of the ${pageLists.length} lists on "${name}".` : `No item was opened from the list on "${name}".`;
      missing.push(sentence);
      openHints.push(sentence);
    }
    const downloadCount = arr(p.downloadIds).length;
    if (!downloadCount && offersDownload.has(p.route)) {
      const sentence = `No download was recorded on "${name}" although the page has download links.`;
      missing.push(sentence);
      downloadHints.push(sentence);
    }

    return {
      pageId: p.id,
      route: p.route,
      title: p.title,
      viewGroups,
      lists: pageLists,
      downloads: downloadCount,
      apiCalls: (callsOn.get(p.route) || new Set()).size,
      complete: missing.length === 0,
      missing,
    };
  });

  const menuHints = unvisited.map((n) => `Menu item "${q(arr(n.path).join(' > ') || n.text)}" was seen but never opened.`);
  const hints = [...menuHints, ...viewHints, ...pagingHints, ...openHints, ...downloadHints].slice(0, CAPS.HINTS);

  return {
    generatedAt: new Date().toISOString(),
    origin,
    totals: {
      // Logout items are left out of both numbers, so a complete recording can read 12 of 12.
      menuItems: counted.length,
      menuVisited: counted.length - unvisited.length,
      pages: pages.length,
      viewOptions,
      viewOptionsVisited,
      lists,
      listsPaged,
      downloads: arr(downloads).length,
    },
    unvisitedMenu: unvisited.map((n) => ({ id: n.id, path: arr(n.path), selector: n.selector })),
    pages: coveragePages,
    hints,
  };
}
