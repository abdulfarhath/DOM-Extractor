/**
 * routes.json — docs/12 B8. For every recorded page and view, the clicks that
 * lead there from the entry state, each with the locator to use and what to
 * check once it has been pressed. Breadth-first over a graph whose nodes are
 * pages and views — (route, view key) — not states: coming back to a page
 * later produces a new state, and the clicks recorded from there are just as
 * repeatable from the first visit. Fewest steps first, then the most stable
 * selectors, then the edges seen most often. Nothing flagged
 * `danger` is ever a step, and no path crosses an edge on which a danger
 * action was pressed.
 *
 * Pure: no chrome.*, no storage.
 */
import { routeOf, viewKeyOf, PLACEHOLDER_RE } from './naming.js';
import { arr, menuId, entryStateOf } from './sitemap.js';

/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../../shared/schema.js').ActionEntry} ActionEntry */
/** @typedef {import('../../shared/schema.js').Transition} Transition */
/** @typedef {import('../../shared/schema.js').SiteMap} SiteMap */
/** @typedef {import('../../shared/schema.js').RouteStep} RouteStep */
/** @typedef {import('../../shared/schema.js').RouteRecipe} RouteRecipe */
/** @typedef {import('../../shared/schema.js').RoutesFile} RoutesFile */

/**
 * One way from a page+view to another: the concrete edge chosen to stand for
 * it, and how many recorded transitions did the same thing.
 * @typedef {{ edge: Transition, action: ActionEntry, cost: number, from: string, to: string, seen: number }} Hop
 */
/** @typedef {{ steps: number, cost: number, seen: number, via: Hop|null }} Reach */

/**
 * The search node a state collapses to.
 * @param {StateRecord} s
 * @returns {string}
 */
const nodeOf = (s) => `${routeOf(s)}\u0000${viewKeyOf(s)}`;

/**
 * Lower is sturdier. An action without selectors can still be described, but
 * a path through it is the last one to choose.
 * @param {ActionEntry} a
 * @returns {number}
 */
function instability(a) {
  const sel = a.selectors;
  if (!sel || !sel.primary) return 4;
  const base = sel.stability === 'stable' ? 0 : sel.stability === 'likely' ? 1 : 2;
  return base + (sel.unique === false ? 1 : 0);
}

/**
 * @param {StateRecord|undefined} s
 * @returns {string|null}
 */
const firstHeading = (s) => {
  const h = s ? arr(s.headings).find((x) => typeof x === 'string' && x.trim()) : undefined;
  return h ? h.trim() : null;
};

/**
 * @param {StateRecord[]} states
 * @param {ActionEntry[]} actions
 * @param {Transition[]} transitions
 * @param {SiteMap} siteMap
 * @param {string} origin
 * @returns {RoutesFile}
 */
export function buildRoutes(states, actions, transitions, siteMap, origin) {
  const allStates = arr(states).filter((s) => s && s.id);
  const allActions = arr(actions).filter((a) => a && a.id);
  /** @type {Map<string, StateRecord>} */
  const stateById = new Map(allStates.map((s) => [s.id, s]));
  /** @type {Map<string, ActionEntry>} */
  const actionById = new Map(allActions.map((a) => [a.id, a]));

  const fromMap = siteMap && siteMap.entryStateId ? stateById.get(siteMap.entryStateId) : undefined;
  const entry = fromMap || entryStateOf(allStates);

  // ---- the graph: only edges a reader can repeat, between pages and views
  /** @type {Map<string, Map<string, Hop>>} from node → (to node + what was pressed) → hop */
  const outByKey = new Map();
  /** @type {Map<string, Transition[]>} edges into a node that were left out, for the note */
  const refused = new Map();
  /** @type {Set<string>} actions that changed the route themselves */
  const navigated = new Set();
  for (const t of arr(transitions)) {
    if (!t || !stateById.has(t.from) || !stateById.has(t.to)) continue;
    const action = t.actionId ? actionById.get(t.actionId) : undefined;
    if (action && routeOf(/** @type {StateRecord} */ (stateById.get(t.from))) !== routeOf(/** @type {StateRecord} */ (stateById.get(t.to)))) navigated.add(action.id);
    // A danger click anywhere between the two states may be what produced the
    // second one (a confirm, then the button that closes the dialog). Replaying
    // the rest without it would claim a path the recording does not show.
    const dangerBefore = arr(t.actionIds).some((id) => {
      const a = actionById.get(id);
      return !!a && a.danger;
    });
    const from = nodeOf(/** @type {StateRecord} */ (stateById.get(t.from)));
    const to = nodeOf(/** @type {StateRecord} */ (stateById.get(t.to)));
    if (!action || action.danger || dangerBefore) {
      const list = refused.get(to);
      if (list) list.push(t);
      else refused.set(to, [t]);
      continue;
    }
    // Staying on the same page and view gets a reader nowhere.
    if (from === to) continue;
    // The same control pressed on different visits is one way with more evidence.
    const pressed = (action.selectors && action.selectors.primary) || `label:${String(action.label || '')}|${arr(action.menuPath).join('>')}`;
    const key = `${to}\u0001${pressed}`;
    const cost = instability(action);
    let hops = outByKey.get(from);
    if (!hops) outByKey.set(from, (hops = new Map()));
    const known = hops.get(key);
    if (!known) hops.set(key, { edge: t, action, cost, from, to, seen: 1 });
    else {
      known.seen += 1;
      // Keep the sturdiest recorded instance, the latest among equals.
      if (cost < known.cost || (cost === known.cost && (action.seq || 0) > (known.action.seq || 0))) {
        known.edge = t;
        known.action = action;
        known.cost = cost;
      }
    }
  }
  /** @type {Map<string, Hop[]>} */
  const out = new Map();
  for (const [from, hops] of outByKey) out.set(from, Array.from(hops.values()));

  // ---- breadth-first, level by level, so equal-length paths compete on
  // stability and then on how often they were seen
  const entryNode = entry ? nodeOf(entry) : null;
  /** @type {Map<string, Reach>} node → best way in */
  const reach = new Map();
  if (entryNode) {
    reach.set(entryNode, { steps: 0, cost: 0, seen: 0, via: null });
    let frontier = [entryNode];
    while (frontier.length) {
      /** @type {Map<string, Reach>} */
      const level = new Map();
      for (const node of frontier) {
        const here = /** @type {Reach} */ (reach.get(node));
        for (const hop of out.get(node) || []) {
          if (reach.has(hop.to)) continue;
          const cand = { steps: here.steps + 1, cost: here.cost + hop.cost, seen: here.seen + hop.seen, via: hop };
          const best = level.get(hop.to);
          if (!best || cand.cost < best.cost || (cand.cost === best.cost && cand.seen > best.seen)) level.set(hop.to, cand);
        }
      }
      for (const [id, r] of level) reach.set(id, r);
      frontier = Array.from(level.keys());
    }
  }

  // ---- menu branches: the click that opens a collapsed branch changes no state,
  // so no edge is caused by it, yet the item inside cannot be pressed without it.
  /** @type {Map<string, ActionEntry[]>} */
  const openers = new Map();
  for (const a of allActions) {
    if (a.kind !== 'click' || a.danger || !arr(a.menuPath).length || navigated.has(a.id)) continue;
    const id = menuId(a.menuPath);
    const list = openers.get(id);
    if (list) list.push(a);
    else openers.set(id, [a]);
  }

  /**
   * @param {ActionEntry} action
   * @param {Transition} edge
   * @param {RouteStep[]} steps   what the recipe already holds
   * @returns {ActionEntry[]}   ancestors to press first, outermost first
   */
  const branchOpeners = (action, edge, steps) => {
    const path = arr(action.menuPath);
    // A branch opened earlier in the recipe counts as still open only while
    // the route has not changed since: dropdowns close when the page
    // changes, and with a page graph the steps before may come from other
    // visits than the ones the human made in one go.
    let lastMove = -1;
    steps.forEach((s, i) => {
      const from = stateById.get(s.fromStateId);
      if (s.fromStateId !== s.toStateId && (!from || routeOf(from) !== s.expectRoute)) lastMove = i;
    });
    const stillOpen = steps.slice(lastMove + 1);
    /** @type {ActionEntry[]} */
    const found = [];
    for (let depth = 1; depth < path.length; depth++) {
      const id = menuId(path.slice(0, depth));
      const known = (openers.get(id) || []).filter((a) => a.id !== action.id);
      if (!known.length) continue;
      const sameEdge = known.filter((a) => arr(edge.actionIds).includes(a.id));
      // The human reopening it on this very edge is evidence it had closed.
      if (!sameEdge.length && stillOpen.some((s) => menuId(s.menuPath) === id)) continue;
      const earlier = known.filter((a) => (a.seq || 0) < (action.seq || 0));
      const pool = sameEdge.length ? sameEdge : earlier.length ? earlier : known;
      found.push(pool.slice().sort((a, b) => instability(a) - instability(b) || (b.seq || 0) - (a.seq || 0))[0]);
    }
    return found;
  };

  /**
   * @param {string} targetNode
   * @returns {RouteStep[]}
   */
  const stepsTo = (targetNode) => {
    /** @type {Hop[]} */
    const hops = [];
    for (let r = reach.get(targetNode); r && r.via; r = reach.get(r.via.from)) hops.unshift(r.via);
    /** @type {RouteStep[]} */
    const steps = [];
    for (const { edge, action } of hops) {
      const from = /** @type {StateRecord} */ (stateById.get(edge.from));
      const to = /** @type {StateRecord} */ (stateById.get(edge.to));
      for (const opener of branchOpeners(action, edge, steps)) {
        steps.push({
          n: steps.length + 1,
          actionId: opener.id,
          kind: opener.kind === 'change' ? 'change' : 'click',
          label: String(opener.label || ''),
          selectors: opener.selectors || null,
          menuPath: arr(opener.menuPath),
          href: opener.href || null,
          chosen: opener.chosen || null,
          // Same state on both sides: the step prepares the next one and leads nowhere itself.
          fromStateId: from.id,
          toStateId: from.id,
          expectRoute: routeOf(from),
          expectViewKey: viewKeyOf(from),
          expectHeading: null,
          opensNewTab: false,
        });
      }
      steps.push({
        n: steps.length + 1,
        actionId: action.id,
        kind: action.kind === 'change' ? 'change' : 'click',
        label: String(action.label || ''),
        selectors: action.selectors || null,
        menuPath: arr(action.menuPath),
        href: action.href || null,
        chosen: action.chosen || null,
        fromStateId: from.id,
        toStateId: to.id,
        expectRoute: routeOf(to),
        expectViewKey: viewKeyOf(to),
        expectHeading: firstHeading(to),
        opensNewTab: !!edge.viaNewTab,
      });
    }
    return steps;
  };

  /**
   * @param {StateRecord} target
   * @returns {string}
   */
  const whyUnreachable = (target) => {
    if (!entry) return 'No states were recorded.';
    const into = refused.get(nodeOf(target)) || [];
    const dangerous = into
      .flatMap((t) => [t.actionId, ...arr(t.actionIds)])
      .map((id) => (id ? actionById.get(id) : undefined))
      .find((a) => a && a.danger);
    if (dangerous) return `Reached in the recording only through "${dangerous.label || dangerous.id}" (${dangerous.id}), which is flagged danger and is never replayed. A human has to take that step.`;
    if (into.length) return `Reached in the recording by \`${into[0].trigger}\` from ${into[0].from}, with no recorded click behind it, so there is nothing to replay.`;
    if (target.openedFrom) return 'Opened in a new tab whose opener was not recorded.';
    if (target.trigger === 'load') return `Seen only as a page load; no recorded click leads here from the entry page (${routeOf(entry)}, entry state ${entry.id}).`;
    return `No recorded click path leads here from the entry page (${routeOf(entry)}, entry state ${entry.id}). The chain it belongs to starts elsewhere: a new tab, a reload, or a pause in the recording.`;
  };

  // ---- one recipe per (page, view key)
  /** @type {Map<string, import('../../shared/schema.js').SiteMapNode>} */
  const menuById = new Map(arr(siteMap && siteMap.menu).map((n) => [n.id, n]));
  /** @type {Map<string, string>} */
  const pageIdByRoute = new Map();
  for (const p of arr(siteMap && siteMap.pages)) pageIdByRoute.set(p.route, p.id);
  /** @type {Map<string, StateRecord[]>} */
  const targets = new Map();
  /** @type {Map<string, StateRecord[]>} */
  const byRoute = new Map();
  for (const s of allStates) {
    const route = routeOf(s);
    const key = `${route}\u0000${viewKeyOf(s)}`;
    const list = targets.get(key);
    if (list) list.push(s);
    else targets.set(key, [s]);
    const onRoute = byRoute.get(route);
    if (onRoute) onRoute.push(s);
    else byRoute.set(route, [s]);
  }

  /** @type {Set<string>} every state of the entry page and view */
  const entryStates = new Set(entryNode ? allStates.filter((s) => nodeOf(s) === entryNode).map((s) => s.id) : []);

  /** @type {RouteRecipe[]} */
  const recipes = [];
  for (const [node, group] of targets) {
    const route = routeOf(group[0]);
    const r = reach.get(node);
    const reachable = !!r;
    const isEntry = !!entry && node === entryNode;
    // The concrete state the chosen path lands on; the entry state itself for the entry node.
    const landed = r && r.via ? stateById.get(r.via.edge.to) : undefined;
    const target = isEntry && entry ? entry : landed || group[0];
    const onRoute = byRoute.get(route) || [];
    const loaded = onRoute.filter((s) => s.trigger === 'load');
    // A route with a redacted segment is not an address anyone can open.
    const openable = loaded.length > 0 && !PLACEHOLDER_RE.test(route);
    const queryKeys = Array.from(new Set(loaded.flatMap((s) => arr(s.queryKeys)))).sort();

    /** @type {string[]} */
    const notes = [];
    if (isEntry) notes.push('This is the entry state: the recording starts here, after the human has logged in.');
    if (!reachable) notes.push(whyUnreachable(target));
    if (loaded.length && !openable) notes.push('The route holds a redacted segment, so no direct URL is given; take the value from the page that links here.');
    if (openable && queryKeys.length) notes.push(`When it was loaded the URL carried query parameters (${queryKeys.join(', ')}); their values were not recorded and directUrl leaves them out.`);
    // A load lands on the page's default view; any other view still has to be selected after it.
    if (openable && !loaded.some((s) => viewKeyOf(s) === viewKeyOf(target))) notes.push('directUrl opens the page, not this view of it; the view still has to be selected.');

    const steps = reachable ? stepsTo(node) : [];
    const last = steps[steps.length - 1];
    if (last && entry && last.menuPath.length > 0 && steps.length > last.menuPath.length) {
      const item = menuById.get(menuId(last.menuPath));
      // The same menu is usually on every page; the recording only proves the path it took.
      if (item && item.seenOnStates.some((id) => entryStates.has(id))) notes.push(`The menu item ${JSON.stringify(last.menuPath.join(' > '))} was also present on the entry state, so opening it from there (its branch first) is probably shorter; that shorter path was not recorded.`);
    }
    const itemSteps = steps.filter((s) => {
      const a = actionById.get(s.actionId);
      return !!a && !!a.listSelector && !a.pagination && !a.viewGroup;
    });
    if (itemSteps.length) notes.push(`Step ${itemSteps.map((s) => s.n).join(', ')} opens one particular item of a list (the one the person clicked). Any item leads to the same kind of page, but the route and heading after it carry that item's own id or name, so compare them loosely.`);
    if (steps.some((s) => s.toStateId === s.fromStateId)) notes.push('A step whose toStateId equals its fromStateId opens a collapsed menu branch for the step after it. Skip it when that step\'s target is already visible.');
    if (steps.some((s) => !s.selectors || !s.selectors.primary)) notes.push('At least one step was recorded without a selector; find its target by label.');

    recipes.push({
      pageId: pageIdByRoute.get(route) || '',
      route,
      viewKey: viewKeyOf(target),
      targetStateId: target.id,
      reachable,
      directUrl: openable ? `${String(origin || '').replace(/\/+$/, '')}${route.startsWith('/') ? '' : '/'}${route}` : null,
      steps,
      note: notes.join(' '),
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    origin,
    entryStateId: entry ? entry.id : null,
    entryRoute: entry ? routeOf(entry) : null,
    recipes,
  };
}
