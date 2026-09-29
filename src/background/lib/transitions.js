/**
 * State-graph edges — docs/02 "Transitions", docs/10 A8. Pure functions; the
 * worker decides what counts as the previous state (same tab:frame) and
 * whether a pause/resume sits between the two.
 */

/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../../shared/schema.js').AnyControlRecord} AnyControlRecord */
/** @typedef {import('../../shared/schema.js').NetEntry} NetEntry */
/** @typedef {import('../../shared/schema.js').Transition} Transition */
/** @typedef {import('../../shared/schema.js').OptionsChange} OptionsChange */
/** @typedef {import('../../shared/schema.js').ListCountChange} ListCountChange */
/** @typedef {import('../../shared/schema.js').TimelineEvent} TimelineEvent */

/**
 * Controls keyed by identity. Duplicate keys keep the first occurrence.
 * @param {StateRecord} s
 * @returns {Map<string, AnyControlRecord>}
 */
export function controlIndex(s) {
  const m = new Map();
  for (const c of s.controls) if (!m.has(c.key)) m.set(c.key, c);
  return m;
}

/**
 * List containers keyed by selector with their item/row counts.
 * @param {StateRecord} s
 * @returns {Map<string, number>}
 */
function listCounts(s) {
  const m = new Map();
  if (!s.lists) return m;
  for (const t of s.lists.tables) m.set(t.containerSelector, t.rowCount);
  for (const r of s.lists.repeats) m.set(r.containerSelector, r.itemCount);
  return m;
}

/**
 * A8: an edge must not straddle a pause or resume, or a session clear.
 * @param {TimelineEvent[]} timeline
 * @param {string} fromAt
 * @param {string} toAt
 * @returns {boolean}
 */
export function gapBetween(timeline, fromAt, toAt) {
  const a = Date.parse(fromAt);
  const b = Date.parse(toAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return timeline.some((ev) => {
    const t = Date.parse(ev.at);
    return Number.isFinite(t) && t > a && t < b;
  });
}

/**
 * Which page a state is, tolerating states stored before docs/12 B1.
 * @param {StateRecord} s
 * @returns {string}
 */
export function routeOf(s) {
  // Same fallback as naming.js routeOf, so stored edges agree with the export.
  if (typeof s.route === 'string' && s.route) return s.route;
  return s.pathname || '/';
}

/**
 * Which view of its page a state shows; '' for states stored before docs/12 B2.
 * @param {StateRecord} s
 * @returns {string}
 */
export function viewKeyOf(s) {
  return s.view && typeof s.view.key === 'string' ? s.view.key : '';
}

/**
 * @param {StateRecord} from
 * @param {StateRecord} to
 * @param {NetEntry[]} netBetween   entries attributed to `from` before `to` landed
 * @param {{ actionIds?: string[], actionId?: string|null, viaNewTab?: boolean }} [links]   docs/12 B4; the worker knows these, the states do not
 * @returns {Transition}
 */
export function buildTransition(from, to, netBetween, links = {}) {
  const a = controlIndex(from);
  const b = controlIndex(to);

  /** @type {string[]} */
  const fieldsAdded = [];
  /** @type {string[]} */
  const fieldsRemoved = [];
  /** @type {OptionsChange[]} */
  const optionsChanged = [];
  /** @type {ListCountChange[]} */
  const listCountsChanged = [];

  for (const k of b.keys()) if (!a.has(k)) fieldsAdded.push(k);
  for (const k of a.keys()) if (!b.has(k)) fieldsRemoved.push(k);

  for (const [k, cb] of b) {
    const ca = a.get(k);
    if (!ca || ca.redactedEntirely || cb.redactedEntirely) continue;
    if (!ca.options && !cb.options) continue;
    if (JSON.stringify(ca.options) !== JSON.stringify(cb.options)) optionsChanged.push({ key: k, before: ca.options, after: cb.options });
  }

  const la = listCounts(from);
  const lb = listCounts(to);
  for (const [sel, after] of lb) {
    const before = la.get(sel);
    if (before != null && before !== after) listCountsChanged.push({ selector: sel, before, after });
  }

  const prevErrors = new Set(from.errors);
  return {
    from: from.id,
    to: to.id,
    trigger: to.trigger,
    urlChanged: from.url !== to.url,
    fieldsAdded,
    fieldsRemoved,
    optionsChanged,
    listCountsChanged,
    netCallsBetween: netBetween.map((n) => n.id),
    errorsAppeared: to.errors.filter((e) => !prevErrors.has(e)),
    actionIds: links.actionIds || [],
    actionId: links.actionId || null,
    routeChanged: routeOf(from) !== routeOf(to),
    viewChanged: viewKeyOf(from) !== viewKeyOf(to),
    viaNewTab: !!links.viaNewTab,
  };
}
