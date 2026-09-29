/**
 * flow-map.json and selectors.json — docs/03, docs/09 Q2/Q16, docs/10 A6/A7,
 * docs/12 B1. The roll-up across all states of one origin: pages, unique
 * controls, list patterns, dependencies and the state graph. `sourceField`
 * is always null; a human binds it to their own data model. "Which page"
 * means the route (pathname plus fragment path), never the pathname alone.
 */
import { routeOf, viewKeyOf, pageIdsByRoute } from './naming.js';

/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../../shared/schema.js').ControlRecord} ControlRecord */
/** @typedef {import('../../shared/schema.js').Dependency} Dependency */
/** @typedef {import('../../shared/schema.js').Transition} Transition */
/** @typedef {import('../../shared/schema.js').TimelineEvent} TimelineEvent */
/** @typedef {import('../../shared/schema.js').FlowMap} FlowMap */
/** @typedef {import('../../shared/schema.js').FlowMapControl} FlowMapControl */
/** @typedef {import('../../shared/schema.js').FlowMapList} FlowMapList */
/** @typedef {import('../../shared/schema.js').FlowMapPage} FlowMapPage */
/** @typedef {import('../../shared/schema.js').SelectorsFile} SelectorsFile */
/** @typedef {import('../../shared/schema.js').SelectorStability} SelectorStability */

const LABEL_RANK = ['for', 'wrap', 'aria-labelledby', 'aria-label', 'container', 'sibling', 'placeholder', 'none'];
const STABILITY_RANK = ['stable', 'likely', 'fragile'];

/** @param {string} s */
const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Q2: the same logical control (same path, same name/binding/label) seen
 * with different ids across captures means the id is minted per render.
 * @param {StateRecord[]} states
 * @returns {Map<string, Set<string>>}   id → the set of ids it alternated with
 */
export function findVaryingIds(states) {
  /** @type {Map<string, Set<string>>} */
  const groups = new Map();
  for (const s of states) {
    for (const c of s.controls) {
      if (!c.id) continue;
      if (!c.formControlName && !c.name && !c.label) continue;
      const g = `${routeOf(s)}|${c.formControlName}|${c.name}|${norm(c.label)}|${c.type}`;
      let ids = groups.get(g);
      if (!ids) groups.set(g, (ids = new Set()));
      ids.add(c.id);
    }
  }
  /** @type {Map<string, Set<string>>} */
  const varying = new Map();
  for (const ids of groups.values()) if (ids.size > 1) for (const id of ids) varying.set(id, ids);
  return varying;
}

/**
 * The control's key, unless that key *is* an id that was seen to vary.
 * @param {ControlRecord} c
 * @param {Map<string, Set<string>>} varying
 * @returns {string}
 */
function effectiveKey(c, varying) {
  if (c.id && c.key === c.id && varying.has(c.id)) return c.formControlName || c.name || c.label || c.key;
  return c.key;
}

/**
 * @param {ControlRecord} c
 * @param {Map<string, Set<string>>} varying
 * @returns {{ selectors: FlowMapControl['selectors'], note: string }}
 */
function selectorsFor(c, varying) {
  const sel = c.selectors;
  const alternates = c.id ? varying.get(c.id) : undefined;
  if (!alternates || !sel.primary.startsWith('#')) {
    return { selectors: { primary: sel.primary, fallbacks: sel.fallbacks, shadowPath: sel.shadowPath || [], stability: sel.stability }, note: '' };
  }
  const fallbacks = sel.fallbacks.filter((x) => !x.startsWith('#'));
  const primary = fallbacks[0] || sel.primary;
  /** @type {SelectorStability} */
  const stability = /^\[(data-testid|data-test|data-cy|data-qa|data-test-id|data-automation-id)=/.test(primary)
    ? 'stable'
    : /^\[(formcontrolname|name)=/.test(primary) || /aria-label=/.test(primary)
      ? 'likely'
      : 'fragile';
  return {
    selectors: { primary, fallbacks: fallbacks.slice(1), shadowPath: sel.shadowPath || [], stability },
    note: `id varies across captures (${Array.from(alternates).join(', ')}); id selector demoted`,
  };
}

/**
 * @param {ControlRecord} c
 * @param {string} key
 * @param {string} stateId
 * @param {string} note
 * @param {Map<string, Set<string>>} varying
 * @returns {FlowMapControl}
 */
function newEntry(c, key, stateId, note, varying) {
  const { selectors, note: selNote } = selectorsFor(c, varying);
  /** @type {FlowMapControl} */
  const e = {
    key,
    altKeys: [],
    seenOnStates: [stateId],
    label: c.label,
    labelSource: c.labelSource,
    type: c.type,
    required: c.required,
    maxLength: c.maxLength,
    pattern: c.pattern,
    selectors,
    options: c.options,
    entry: c.entry || null,
    dependsOn: [],
    affects: [],
    collidesWith: [],
    redactedEntirely: !!c.redactedEntirely,
    sourceField: null,
    notes: [c.selectors.notes, selNote, note, c.redactedEntirely ? 'redactedEntirely: human fills this; never bind a data source' : ''].filter(Boolean).join('; '),
  };
  addAlts(e, c);
  return e;
}

/**
 * @param {FlowMapControl} e
 * @param {ControlRecord} c
 */
function addAlts(e, c) {
  for (const k of [c.key, c.id, c.name, c.formControlName, c.label]) {
    if (k && k !== e.key && !e.altKeys.includes(k)) e.altKeys.push(k);
  }
}

/**
 * @param {FlowMapControl} e
 * @param {ControlRecord} c
 * @param {string} stateId
 * @param {Map<string, Set<string>>} varying
 */
function mergeInto(e, c, stateId, varying) {
  if (!e.seenOnStates.includes(stateId)) e.seenOnStates.push(stateId);
  addAlts(e, c);
  if (LABEL_RANK.indexOf(c.labelSource) < LABEL_RANK.indexOf(e.labelSource)) {
    e.label = c.label;
    e.labelSource = c.labelSource;
  }
  if (c.options && (!e.options || c.options.length > e.options.length)) e.options = c.options;
  if (c.required) e.required = true;
  if (c.maxLength != null && e.maxLength == null) e.maxLength = c.maxLength;
  if (c.pattern && !e.pattern) e.pattern = c.pattern;
  const { selectors, note } = selectorsFor(c, varying);
  if (STABILITY_RANK.indexOf(selectors.stability) < STABILITY_RANK.indexOf(e.selectors.stability)) e.selectors = selectors;
  if (note && !e.notes.includes('id varies')) e.notes = [e.notes, note].filter(Boolean).join('; ');
  if (c.entry && e.entry && e.entry.mode === 'unknown' && c.entry.mode !== 'unknown') e.entry = c.entry;
  // Once a credential, always a credential: the flag never downgrades on merge.
  if (c.redactedEntirely && !e.redactedEntirely) {
    e.redactedEntirely = true;
    e.options = null;
    e.notes = [e.notes, 'redactedEntirely: human fills this; never bind a data source'].filter(Boolean).join('; ');
  }
}

/**
 * @param {StateRecord[]} states
 * @param {Dependency[]} deps
 * @param {Transition[]} transitions
 * @param {TimelineEvent[]} timeline
 * @param {string} origin
 * @returns {FlowMap}
 */
export function buildFlowMap(states, deps, transitions, timeline, origin) {
  const varying = findVaryingIds(states);
  const edgeInto = new Map(transitions.map((t) => [t.to, t]));
  const pageIds = pageIdsByRoute(states);

  // ---- pages
  /** @type {FlowMapPage[]} */
  const pages = states.map((s) => {
    const t = edgeInto.get(s.id);
    const route = routeOf(s);
    return { stateId: s.id, pathname: s.pathname, title: s.title, reachedBy: t ? `${t.trigger} from ${t.from}` : s.trigger, route, viewKey: viewKeyOf(s), pageId: pageIds.get(route) || null };
  });

  // ---- controls, A7 collision-aware
  /** @type {Map<string, Array<{ c: ControlRecord, stateId: string, route: string }>>} */
  const byKey = new Map();
  // Credential controls are included (docs/11): a consumer needs their
  // selectors to leave them to the human and to wait for what follows.
  for (const s of states) {
    for (const c of s.controls) {
      const k = effectiveKey(c, varying);
      const arr = byKey.get(k) || [];
      arr.push({ c, stateId: s.id, route: routeOf(s) });
      byKey.set(k, arr);
    }
  }

  /** @type {FlowMapControl[]} */
  const controls = [];
  /** @type {Map<string, string>} state-level key → flow-map key, per state */
  const keyLookup = new Map();
  for (const [k, seen] of byKey) {
    /** @type {Map<string, FlowMapControl>} (normLabel|type) → entry */
    const variants = new Map();
    /** @type {Map<string, string>} variant → first route */
    const firstPath = new Map();
    for (const { c, stateId, route } of seen) {
      const v = `${norm(c.label)}|${c.type}`;
      let e = variants.get(v);
      if (!e) {
        e = newEntry(c, k, stateId, '', varying);
        variants.set(v, e);
        firstPath.set(v, route);
      } else mergeInto(e, c, stateId, varying);
    }
    if (variants.size === 1) {
      const e = Array.from(variants.values())[0];
      controls.push(e);
      for (const { stateId } of seen) keyLookup.set(`${stateId}|${k}`, e.key);
      continue;
    }
    // Same key, different label or type: keep apart and cross-reference.
    const entries = Array.from(variants.entries()).map(([v, e]) => {
      e.key = `${firstPath.get(v)}::${k}`;
      e.notes = [e.notes, `key "${k}" collides with another control of a different label/type`].filter(Boolean).join('; ');
      return e;
    });
    for (const e of entries) e.collidesWith = entries.filter((o) => o !== e).map((o) => o.key);
    controls.push(...entries);
    for (const { c, stateId } of seen) {
      const v = `${norm(c.label)}|${c.type}`;
      const e = variants.get(v);
      if (e) keyLookup.set(`${stateId}|${k}`, e.key);
    }
  }

  // ---- A6: a click on a control that revealed new controls means a widget.
  for (const t of transitions) {
    if (!t.trigger.startsWith('click:') || !t.fieldsAdded.length) continue;
    const clicked = norm(t.trigger.slice(6));
    for (const e of controls) {
      if (!e.seenOnStates.includes(t.from)) continue;
      if (norm(e.label).slice(0, 40) !== clicked && norm(e.key).slice(0, 40) !== clicked) continue;
      if (e.entry && e.entry.mode === 'unknown') e.entry = { ...e.entry, mode: 'widget', evidence: `click opened ${t.fieldsAdded.length} new control(s) in ${t.to}` };
      else if (!e.notes.includes('click opened')) e.notes = [e.notes, `click opened ${t.fieldsAdded.length} new control(s) in ${t.to}`].filter(Boolean).join('; ');
    }
  }

  // ---- dependencies → dependsOn / affects
  /**
   * @param {string} stateId
   * @param {string} k
   */
  const resolve = (stateId, k) => keyLookup.get(`${stateId}|${k}`) || k;
  const entryByKey = new Map(controls.map((e) => [e.key, e]));
  for (const d of deps) {
    const src = resolve(d.stateId, d.sourceKey);
    const srcEntry = entryByKey.get(src);
    for (const tk of d.targetKeys) {
      const tgt = resolve(d.stateId, tk);
      const tgtEntry = entryByKey.get(tgt);
      if (srcEntry && !srcEntry.affects.includes(tgt)) srcEntry.affects.push(tgt);
      if (tgtEntry && !tgtEntry.dependsOn.includes(src)) tgtEntry.dependsOn.push(src);
    }
    if (srcEntry && d.viaNetwork && d.endpoint && !srcEntry.notes.includes(d.endpoint)) {
      srcEntry.notes = [srcEntry.notes, `change triggers ${d.endpoint}`].filter(Boolean).join('; ');
    }
  }

  // ---- lists, deduped by kind + selector
  /** @type {Map<string, FlowMapList>} */
  const lists = new Map();
  /** @param {FlowMapList['kind']} kind @param {string} selector @param {FlowMapList['pattern']} pattern @param {string} stateId */
  const addList = (kind, selector, pattern, stateId) => {
    const id = `${kind}|${selector}`;
    const e = lists.get(id);
    if (e) {
      if (!e.seenOnStates.includes(stateId)) e.seenOnStates.push(stateId);
      return;
    }
    lists.set(id, { kind, selector, seenOnStates: [stateId], pattern });
  };
  for (const s of states) {
    const l = s.lists;
    if (!l) continue;
    for (const t of l.tables) addList('table', t.containerSelector, t, s.id);
    for (const r of l.repeats) addList('repeat', r.containerSelector, r, s.id);
    for (const p of l.pagination) addList('pagination', p.containerSelector, p, s.id);
    for (const d of l.downloads) addList('download', d.selector, d, s.id);
  }

  const fw = states.find((s) => s.framework && s.framework.framework !== 'plain') || states[0];
  return {
    generatedAt: new Date().toISOString(),
    origin,
    framework: fw && fw.framework ? fw.framework.framework : 'plain',
    pages,
    controls,
    lists: Array.from(lists.values()),
    dependencies: deps,
    transitions,
    timeline,
  };
}

/**
 * selectors.json — a flat map so generated code can import selectors
 * without parsing the whole flow map.
 * @param {FlowMap} map
 * @returns {SelectorsFile}
 */
export function buildSelectorsFile(map) {
  /** @type {SelectorsFile} */
  const out = { selectors: {}, fallbacks: {}, shadowPaths: {} };
  for (const c of map.controls) {
    out.selectors[c.key] = c.selectors.primary;
    out.fallbacks[c.key] = c.selectors.fallbacks;
    if (c.selectors.shadowPath.length) out.shadowPaths[c.key] = c.selectors.shadowPath;
  }
  return out;
}
