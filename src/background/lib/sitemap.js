/**
 * site-map.json — docs/12 B8. The menu merged across every state it was seen
 * on, and one entry per distinct route with its views, view groups, lists,
 * the endpoints that feed them and the downloads seen there. Every node and
 * option carries a `visited` flag: what the recording never touched is as
 * much a finding as what it did.
 *
 * Pure, and called by the worker on every panel refresh: no chrome.*, no
 * storage, one pass over each input.
 */
import { routeOf, viewKeyOf, pageIdsByRoute } from './naming.js';
import { groupEndpoints, endpointIdsByCall, attributeCalls, listPathsOf } from './apicatalog.js';

/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../../shared/schema.js').ActionEntry} ActionEntry */
/** @typedef {import('../../shared/schema.js').Transition} Transition */
/** @typedef {import('../../shared/schema.js').DownloadEntry} DownloadEntry */
/** @typedef {import('../../shared/schema.js').NetEntry} NetEntry */
/** @typedef {import('../../shared/schema.js').NavItem} NavItem */
/** @typedef {import('../../shared/schema.js').SiteMap} SiteMap */
/** @typedef {import('../../shared/schema.js').SiteMapNode} SiteMapNode */
/** @typedef {import('../../shared/schema.js').SitePage} SitePage */
/** @typedef {import('../../shared/schema.js').SiteViewGroup} SiteViewGroup */
/** @typedef {import('../../shared/schema.js').SiteList} SiteList */

/**
 * What an action led to, as far as the recording can tell.
 * @typedef {Object} Outcome
 * @property {string|null} from
 * @property {string} to
 * @property {boolean} viaNewTab
 */

const LABEL_MAX = 60;

/**
 * Comparison form for text taken from the page: case and spacing differ
 * between a menu item and the action that clicked it.
 * @param {unknown} s
 * @returns {string}
 */
export const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * @template T
 * @param {T[]|null|undefined} v
 * @returns {T[]}
 */
export const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * @param {string[]} path
 * @returns {string}   the id a SiteMapNode carries
 */
export const menuId = (path) => arr(path).map((p) => String(p ?? '').replace(/\s+/g, ' ').trim()).join(' > ').toLowerCase();

/**
 * @param {string} r
 * @returns {string}
 */
const trimRoute = (r) => (r.length > 1 && r.endsWith('/') ? r.slice(0, -1) : r);

/**
 * Whether a menu item's href points at a recorded route. A bare fragment
 * (`#/orders`) matches any route ending in it.
 * @param {string|null|undefined} href
 * @param {string} route
 * @returns {boolean}
 */
export function hrefMatchesRoute(href, route) {
  if (!href || !route) return false;
  const h = trimRoute(String(href));
  const r = trimRoute(route);
  if (h === r) return true;
  return h.startsWith('#') && h.length > 1 && r.endsWith(h);
}

/**
 * docs/12 B8: the first logged-in state; the first state when none is.
 * @param {StateRecord[]} states
 * @returns {StateRecord|null}
 */
export function entryStateOf(states) {
  const list = arr(states);
  return list.find((s) => s && s.authHints && s.authHints.loggedIn === true) || list[0] || null;
}

/**
 * What each action led to. The edge that names an action as its cause is the
 * authority; `resultStateId` is every action's "next state in this tab" and
 * is used only for actions no edge mentions, so a click that merely preceded
 * a navigation is not credited with it.
 * @param {ActionEntry[]} actions
 * @param {Transition[]} transitions
 * @param {StateRecord[]} states
 * @returns {Map<string, Outcome>}   action id → outcome
 */
export function outcomesOf(actions, transitions, states) {
  /** @type {Map<string, Outcome>} */
  const out = new Map();
  /** @type {Set<string>} */
  const mentioned = new Set();
  for (const t of arr(transitions)) {
    if (!t) continue;
    for (const id of arr(t.actionIds)) mentioned.add(id);
    if (t.actionId) {
      mentioned.add(t.actionId);
      if (!out.has(t.actionId)) out.set(t.actionId, { from: t.from, to: t.to, viaNewTab: !!t.viaNewTab });
    }
  }
  for (const s of arr(states)) {
    const o = s && s.openedFrom;
    if (o && o.actionId && !out.has(o.actionId)) out.set(o.actionId, { from: o.stateId || null, to: s.id, viaNewTab: true });
  }
  for (const a of arr(actions)) {
    if (!a || !a.id || !a.resultStateId || out.has(a.id) || mentioned.has(a.id)) continue;
    out.set(a.id, { from: a.stateIdAtTime || null, to: a.resultStateId, viaNewTab: false });
  }
  return out;
}

/**
 * @param {string[]} list
 * @param {string|null|undefined} v
 */
function pushUnique(list, v) {
  if (v && !list.includes(v)) list.push(v);
}

// -------------------------------------------------------------------- menu

/**
 * @param {StateRecord[]} states
 * @returns {SiteMapNode[]}   parents before their children, otherwise in order of first sight
 */
function mergeMenu(states) {
  /** @type {Map<string, SiteMapNode>} */
  const nodes = new Map();
  for (const s of states) {
    for (const item of arr(s.nav && s.nav.menus)) {
      if (!item) continue;
      const path = arr(item.path).length ? item.path.map((p) => String(p ?? '')) : [String(item.text || '')];
      const text = String(item.text || path[path.length - 1] || '');
      if (!text.trim()) continue;
      const id = menuId(path);
      const node = nodes.get(id);
      if (!node) {
        nodes.set(id, {
          id,
          text,
          path,
          depth: path.length - 1,
          selector: String(item.selector || ''),
          shadowPath: arr(item.shadowPath),
          href: item.href || null,
          hasChildren: !!item.hasChildren,
          seenOnStates: [s.id],
          visited: false,
          visitedBy: [],
          leadsTo: [],
        });
        continue;
      }
      // An overlay menu is seen complete only while open; later sightings fill what earlier ones lacked.
      if (!node.href && item.href) node.href = item.href;
      if (!node.selector && item.selector) node.selector = item.selector;
      if (item.hasChildren) node.hasChildren = true;
      if (node.seenOnStates[node.seenOnStates.length - 1] !== s.id) node.seenOnStates.push(s.id);
    }
  }

  /** @type {Map<string, SiteMapNode[]>} */
  const children = new Map();
  /** @type {SiteMapNode[]} */
  const roots = [];
  for (const node of nodes.values()) {
    const parent = node.path.length > 1 ? nodes.get(menuId(node.path.slice(0, -1))) : undefined;
    if (!parent) {
      roots.push(node);
      continue;
    }
    parent.hasChildren = true;
    const list = children.get(parent.id);
    if (list) list.push(node);
    else children.set(parent.id, [node]);
  }
  /** @type {SiteMapNode[]} */
  const ordered = [];
  // Iterative: a menu nested 300 deep is absurd, a stack overflow in an export is worse.
  const stack = roots.slice().reverse();
  while (stack.length) {
    const node = /** @type {SiteMapNode} */ (stack.pop());
    ordered.push(node);
    const kids = children.get(node.id);
    if (kids) for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return ordered;
}

// ------------------------------------------------------------------- build

/**
 * @param {StateRecord[]} states
 * @param {ActionEntry[]} actions
 * @param {Transition[]} transitions
 * @param {DownloadEntry[]} downloads
 * @param {NetEntry[]} net
 * @param {string} origin
 * @returns {SiteMap}
 */
export function buildSiteMap(states, actions, transitions, downloads, net, origin) {
  const allStates = arr(states).filter((s) => s && s.id);
  const allActions = arr(actions).filter((a) => a && a.id);
  const allDownloads = arr(downloads).filter((d) => d && d.id);

  /** @type {Map<string, StateRecord>} */
  const stateById = new Map(allStates.map((s) => [s.id, s]));
  /** @type {Map<string, ActionEntry>} */
  const actionById = new Map(allActions.map((a) => [a.id, a]));
  const outcomes = outcomesOf(allActions, transitions, allStates);
  const pageIds = pageIdsByRoute(allStates);

  // ---- endpoints: identity from the shared helper, so ids match api-catalog.json
  const groups = groupEndpoints(net, origin);
  const endpointOf = endpointIdsByCall(groups);
  const fed = attributeCalls(net, allStates);
  /** @type {Map<string, NetEntry[]>} */
  const callsByState = new Map();
  for (const g of groups) {
    for (const n of g.calls) {
      const sid = fed.get(n.id);
      if (!sid) continue;
      const list = callsByState.get(sid);
      if (list) list.push(n);
      else callsByState.set(sid, [n]);
    }
  }
  /** @type {Map<string, number[]>} */
  const rowLengths = new Map();
  /** @param {NetEntry} n */
  const lengthsOf = (n) => {
    let v = rowLengths.get(n.id);
    if (!v) rowLengths.set(n.id, (v = listPathsOf(n.responseShape).map((p) => p.len)));
    return v;
  };

  // ---- actions by where they happened
  /** @type {Map<string, ActionEntry[]>} */
  const actionsByRoute = new Map();
  for (const a of allActions) {
    const at = a.stateIdAtTime ? stateById.get(a.stateIdAtTime) : undefined;
    const route = a.route || (at ? routeOf(at) : '');
    const list = actionsByRoute.get(route);
    if (list) list.push(a);
    else actionsByRoute.set(route, [a]);
  }
  /**
   * An action inside a list that went somewhere. Paging and view switches
   * sit inside list containers too and change the view key; they are not an
   * item being opened.
   * @param {ActionEntry} a
   * @returns {boolean}
   */
  const opened = (a) => {
    if (a.pagination || a.viewGroup) return false;
    const o = outcomes.get(a.id);
    if (!o) return false;
    if (o.viaNewTab) return true;
    const to = stateById.get(o.to);
    const from = o.from ? stateById.get(o.from) : undefined;
    if (!to) return false;
    const fromRoute = from ? routeOf(from) : a.route || '';
    const fromView = from ? viewKeyOf(from) : a.viewKey || '';
    return routeOf(to) !== fromRoute || viewKeyOf(to) !== fromView;
  };
  /** @type {Set<string>} */
  const downloadActions = new Set();
  for (const d of allDownloads) if (d.actionId) downloadActions.add(d.actionId);

  // ---- pages
  /**
   * @typedef {Object} PageDraft
   * @property {SitePage} page
   * @property {Map<string, { key: string, stateIds: string[] }>} views
   * @property {Map<string, { group: SiteViewGroup, options: Map<string, import('../../shared/schema.js').SiteViewOption> }>} groups
   * @property {Map<string, { list: SiteList, counts: Map<string, number> }>} lists
   * @property {boolean} hasPagination
   */
  /** @type {Map<string, PageDraft>} */
  const drafts = new Map();

  for (const s of allStates) {
    const route = routeOf(s);
    let d = drafts.get(route);
    if (!d) {
      d = {
        page: {
          id: pageIds.get(route) || '',
          route,
          title: String(s.title || ''),
          headings: arr(s.headings).slice(0, 5),
          stateIds: [],
          views: [],
          viewGroups: [],
          lists: [],
          apiEndpoints: [],
          downloadIds: [],
          loggedIn: false,
        },
        views: new Map(),
        groups: new Map(),
        lists: new Map(),
        hasPagination: false,
      };
      drafts.set(route, d);
    }
    const page = d.page;
    page.stateIds.push(s.id);
    if (!page.title && s.title) page.title = s.title;
    if (!page.headings.length && arr(s.headings).length) page.headings = s.headings.slice(0, 5);
    if (s.authHints && s.authHints.loggedIn === true) page.loggedIn = true;

    const key = viewKeyOf(s);
    const view = d.views.get(key);
    if (view) view.stateIds.push(s.id);
    else d.views.set(key, { key, stateIds: [s.id] });

    for (const g of arr(s.nav && s.nav.viewGroups)) {
      if (!g) continue;
      const name = String(g.name || g.label || g.containerSelector || '');
      if (!name) continue;
      let merged = d.groups.get(name);
      if (!merged) {
        merged = {
          group: { name, label: String(g.label || ''), kind: g.kind || 'tabs', containerSelector: String(g.containerSelector || ''), shadowPath: arr(g.shadowPath), options: [] },
          options: new Map(),
        };
        d.groups.set(name, merged);
      }
      for (const o of arr(g.options)) {
        if (!o) continue;
        const text = String(o.text || '');
        const id = norm(text) || String(o.selector || '');
        if (!id) continue;
        const known = merged.options.get(id);
        if (known) {
          if (o.active) known.visited = true;
          if (!known.selector && o.selector) known.selector = o.selector;
        } else merged.options.set(id, { text, selector: String(o.selector || ''), visited: !!o.active });
      }
    }

    const lists = s.lists;
    if (lists) {
      // Only a pattern with a control to press is pagination a reader can act on.
      if (arr(lists.pagination).some((p) => p && (p.next || p.prev || p.pageIndicator))) d.hasPagination = true;
      for (const t of arr(lists.tables)) {
        if (!t || !t.containerSelector) continue;
        const id = `table|${t.containerSelector}`;
        let e = d.lists.get(id);
        if (!e) d.lists.set(id, (e = { list: newList('table', t.containerSelector), counts: new Map() }));
        if (arr(t.headers).length > e.list.headers.length) e.list.headers = t.headers.slice();
        e.counts.set(s.id, Number(t.rowCount) || 0);
      }
      for (const r of arr(lists.repeats)) {
        if (!r || !r.containerSelector) continue;
        const id = `repeat|${r.containerSelector}`;
        let e = d.lists.get(id);
        if (!e) d.lists.set(id, (e = { list: newList('repeat', r.containerSelector), counts: new Map() }));
        e.counts.set(s.id, Number(r.itemCount) || 0);
      }
    }
  }

  // ---- downloads, by the page they were started from
  for (const dl of allDownloads) {
    const at = dl.stateIdAtTime ? stateById.get(dl.stateIdAtTime) : undefined;
    const action = dl.actionId ? actionById.get(dl.actionId) : undefined;
    const route = dl.route && drafts.has(dl.route) ? dl.route : at ? routeOf(at) : action && action.route ? action.route : dl.route || '';
    const d = drafts.get(route);
    if (d) d.page.downloadIds.push(dl.id);
  }

  // ---- finish each page
  /** @type {SitePage[]} */
  const pages = [];
  for (const d of drafts.values()) {
    const page = d.page;
    const here = actionsByRoute.get(page.route) || [];
    page.views = Array.from(d.views.values());

    for (const { group, options } of d.groups.values()) {
      const clicks = here.filter((a) => a.viewGroup === group.name);
      for (const o of options.values()) {
        if (o.visited) continue;
        const text = norm(o.text);
        o.visited = clicks.some((a) => (text && (norm(a.label) === text || norm(a.chosen) === text)) || (!!o.selector && !!a.selectors && a.selectors.primary === o.selector));
      }
      group.options = Array.from(options.values());
      page.viewGroups.push(group);
    }

    /** @type {Set<string>} */
    const endpoints = new Set();
    /** @type {Set<string>} */
    const listLike = new Set();
    for (const sid of page.stateIds) {
      for (const n of callsByState.get(sid) || []) {
        const id = endpointOf.get(n.id);
        if (!id) continue;
        endpoints.add(id);
        if (lengthsOf(n).length) listLike.add(id);
      }
    }
    page.apiEndpoints = Array.from(endpoints).sort();

    const paged = here.some((a) => a.pagination === true);
    for (const { list, counts } of d.lists.values()) {
      const inside = here.filter((a) => a.listSelector === list.selector);
      list.hasPagination = d.hasPagination;
      list.paged = paged;
      list.itemOpened = inside.some(opened);
      list.downloadSeen = inside.some((a) => downloadActions.has(a.id));

      /** @type {Set<string>} */
      const exact = new Set();
      for (const [sid, count] of counts) {
        if (count < 2) continue;
        for (const n of callsByState.get(sid) || []) {
          const id = endpointOf.get(n.id);
          if (id && lengthsOf(n).includes(count)) exact.add(id);
        }
      }
      list.apiEndpoints = Array.from(exact.size ? exact : listLike).sort();
      page.lists.push(list);
    }
    pages.push(page);
  }

  // ---- menu: visited flags and where each item leads
  const menu = mergeMenu(allStates);
  /** @type {Map<string, ActionEntry[]>} */
  const byMenuPath = new Map();
  /** @type {Map<string, ActionEntry[]>} */
  const bySelector = new Map();
  const nodeIds = new Set(menu.map((n) => n.id));
  for (const a of allActions) {
    const path = arr(a.menuPath);
    const id = path.length ? menuId(path) : '';
    if (id) {
      const list = byMenuPath.get(id);
      if (list) list.push(a);
      else byMenuPath.set(id, [a]);
    }
    // An action whose menu path names a known item is matched on that alone: a
    // selector can repeat across menus. One whose path matches nothing (an
    // overlay seen with different labels) still gets the selector.
    if ((!id || !nodeIds.has(id)) && a.selectors && a.selectors.primary) {
      const list = bySelector.get(a.selectors.primary);
      if (list) list.push(a);
      else bySelector.set(a.selectors.primary, [a]);
    }
  }
  for (const node of menu) {
    const clicks = [...(byMenuPath.get(node.id) || []), ...((node.selector && bySelector.get(node.selector)) || [])];
    for (const a of clicks) {
      pushUnique(node.visitedBy, a.id);
      const o = outcomes.get(a.id);
      const to = o ? stateById.get(o.to) : undefined;
      if (!o || !to) continue;
      const from = o.from ? stateById.get(o.from) : undefined;
      const fromRoute = from ? routeOf(from) : a.route || '';
      // Opening a branch leaves the page where it was; that is not a destination.
      if (o.viaNewTab || routeOf(to) !== fromRoute) pushUnique(node.leadsTo, pageIds.get(routeOf(to)));
    }
    if (node.href) for (const p of pages) if (hrefMatchesRoute(node.href, p.route)) pushUnique(node.leadsTo, p.id);
    node.visited = node.visitedBy.length > 0 || (!!node.href && pages.some((p) => hrefMatchesRoute(node.href, p.route)));
  }

  const entry = entryStateOf(allStates);
  return { generatedAt: new Date().toISOString(), origin, entryStateId: entry ? entry.id : null, menu, pages };
}

/**
 * @param {'table'|'repeat'} kind
 * @param {string} selector
 * @returns {SiteList}
 */
function newList(kind, selector) {
  return { kind, selector, headers: [], hasPagination: false, paged: false, itemOpened: false, downloadSeen: false, apiEndpoints: [] };
}

// ------------------------------------------------------------------ labels

/**
 * A name for each page that a person would recognise and that no other page
 * shares. Single-page apps keep one document title for every route, so the
 * title is used only when it is this page's alone; then a heading no other
 * page has, then the menu item that leads here, then the route.
 * @param {SiteMap} siteMap
 * @returns {Map<string, string>}   page id → label
 */
export function pageLabels(siteMap) {
  const pages = arr(siteMap && siteMap.pages);
  /** @type {Map<string, number>} */
  const titles = new Map();
  /** @type {Map<string, number>} */
  const headings = new Map();
  for (const p of pages) {
    const t = norm(p.title);
    if (t) titles.set(t, (titles.get(t) || 0) + 1);
    for (const h of new Set(arr(p.headings).map(norm))) if (h) headings.set(h, (headings.get(h) || 0) + 1);
  }
  /** @type {Map<string, string>} */
  const fromMenu = new Map();
  for (const node of arr(siteMap && siteMap.menu)) for (const id of arr(node.leadsTo)) if (!fromMenu.has(id) && node.text) fromMenu.set(id, node.text);

  /** @param {string} s */
  const short = (s) => {
    const t = String(s).replace(/\s+/g, ' ').trim();
    return t.length > LABEL_MAX ? `${t.slice(0, LABEL_MAX - 1)}…` : t;
  };
  /** @type {Map<string, string>} */
  const out = new Map();
  /** @type {Map<string, number>} */
  const used = new Map();
  for (const p of pages) {
    const ownHeading = arr(p.headings).find((h) => norm(h) && headings.get(norm(h)) === 1);
    let label = '';
    if (norm(p.title) && titles.get(norm(p.title)) === 1) label = short(p.title);
    else if (ownHeading) label = short(ownHeading);
    else if (fromMenu.has(p.id)) label = short(fromMenu.get(p.id) || '');
    if (!label) label = p.route;
    out.set(p.id, label);
    used.set(norm(label), (used.get(norm(label)) || 0) + 1);
  }
  for (const p of pages) {
    const label = out.get(p.id) || p.route;
    if ((used.get(norm(label)) || 0) > 1 && label !== p.route) out.set(p.id, `${label} (${p.route})`);
  }
  return out;
}

/**
 * Pages in the order the site's own menu lists them; pages no menu item
 * leads to follow, in order of first visit.
 * @param {SiteMap} siteMap
 * @returns {SitePage[]}
 */
export function pagesInMenuOrder(siteMap) {
  const pages = arr(siteMap && siteMap.pages);
  /** @type {Map<string, number>} */
  const rank = new Map();
  let i = 0;
  for (const node of arr(siteMap && siteMap.menu)) for (const id of arr(node.leadsTo)) if (!rank.has(id)) rank.set(id, i++);
  const at = new Map(pages.map((p, n) => [p.id, n]));
  return pages.slice().sort((a, b) => {
    const ra = rank.has(a.id) ? /** @type {number} */ (rank.get(a.id)) : Infinity;
    const rb = rank.has(b.id) ? /** @type {number} */ (rank.get(b.id)) : Infinity;
    if (ra !== rb) return ra < rb ? -1 : 1;
    return (at.get(a.id) || 0) - (at.get(b.id) || 0);
  });
}
