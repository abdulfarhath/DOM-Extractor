/**
 * chrome.storage.local access — docs/01 storage model, docs/10 A4 (restart
 * durability) and A5 (quota degradation). Every mutation goes through
 * `withLock`, which serialises within this worker instance and guards across
 * instances with a stored `fp:lock` timestamp. Nothing else in the extension
 * touches storage, except the consent list in origins.js and the content
 * scripts' read-only onChanged mirrors.
 */
import { KEYS, CAPS, TIMING, DEFAULT_DANGER_WORDS } from '../../shared/constants.js';

/** @typedef {import('../../shared/schema.js').StateDraft} StateDraft */
/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../../shared/schema.js').NetDraft} NetDraft */
/** @typedef {import('../../shared/schema.js').NetEntry} NetEntry */
/** @typedef {import('../../shared/schema.js').Transition} Transition */
/** @typedef {import('../../shared/schema.js').Dependency} Dependency */
/** @typedef {import('../../shared/schema.js').SessionMeta} SessionMeta */
/** @typedef {import('../../shared/schema.js').TabMap} TabMap */
/** @typedef {import('../../shared/schema.js').ScreenshotJob} ScreenshotJob */
/** @typedef {import('../../shared/schema.js').Degraded} Degraded */
/** @typedef {import('../../shared/schema.js').TimelineEvent} TimelineEvent */
/** @typedef {import('../../shared/schema.js').ActionDraft} ActionDraft */
/** @typedef {import('../../shared/schema.js').ActionEntry} ActionEntry */
/** @typedef {import('../../shared/schema.js').DownloadEntry} DownloadEntry */
/** @typedef {import('../../shared/schema.js').OpenedFrom} OpenedFrom */

/**
 * Browser download id → `dl_` id, for downloads still in progress. The
 * browser reports progress by its own id and a DownloadEntry has no room for
 * it, so the link is kept beside the log rather than in it (A4: it has to
 * outlive the worker). Starts with `fp:` so Clear session wipes it.
 */
const DOWNLOAD_MAP_KEY = KEYS.PREFIX + 'dlmap';
const DOWNLOAD_MAP_MAX = 50;

/** @type {Promise<unknown>} */
let chain = Promise.resolve();

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string} key
 * @returns {Promise<unknown>}
 */
async function get(key) {
  const r = await chrome.storage.local.get(key);
  return r[key];
}

/** @param {Record<string, unknown>} obj */
async function set(obj) {
  await chrome.storage.local.set(obj);
}

// ------------------------------------------------------------------ lock

/**
 * A4: the in-memory chain dies with the worker; the stored timestamp does not.
 * Waits for a live lock, steals a stale one.
 */
async function acquireLock() {
  for (let i = 0; i < 100; i++) {
    const lock = /** @type {number|undefined} */ (await get(KEYS.LOCK));
    if (!lock || Date.now() - lock > TIMING.LOCK_STALE_MS) {
      await set({ [KEYS.LOCK]: Date.now() });
      return;
    }
    await sleep(50);
  }
  // Something is wedged; proceed rather than lose the state.
  await set({ [KEYS.LOCK]: Date.now() });
}

async function releaseLock() {
  await chrome.storage.local.remove(KEYS.LOCK);
}

/**
 * Serialise a storage mutation behind every previous one in this worker and
 * behind any other live worker's lock. Errors propagate to the caller and do
 * not poison the chain.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withLock(fn) {
  const p = chain.then(async () => {
    await acquireLock();
    try {
      return await fn();
    } finally {
      await releaseLock();
    }
  });
  chain = p.catch((e) => console.warn('[flowprint] store op failed:', e instanceof Error ? e.message : String(e)));
  return p;
}

/**
 * Serialise a read-only step behind pending writes, without taking the lock.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function enqueue(fn) {
  const p = chain.then(fn);
  chain = p.catch(() => {});
  return p;
}

// ------------------------------------------------------------------ meta

/** @returns {Degraded} */
export function freshDegraded() {
  return { screenshots: false, snapshots: false, bodiesDropped: false, netTrimmed: false, statesRefused: false };
}

/** @returns {SessionMeta} */
function defaultMeta() {
  return {
    sessionStartedAt: new Date().toISOString(),
    recording: true,
    screenshots: true,
    dangerWords: [...DEFAULT_DANGER_WORDS],
    packs: ['generic'],
    seq: 0,
    netSeq: 0,
    stateCount: 0,
    netCount: 0,
    domCount: 0,
    screenshotCount: 0,
    listPatternCount: 0,
    keepBodies: 'shape',
    actionSeq: 0,
    actionCount: 0,
    downloadSeq: 0,
    downloadCount: 0,
    timeline: [],
    degraded: freshDegraded(),
    blockedFrames: {},
    throttledUntil: {},
  };
}

/**
 * Meta written by an older version lacks the docs/12 fields; the defaults
 * fill them in, so a session survives an update of the extension.
 * @returns {Promise<SessionMeta>}
 */
export async function getMeta() {
  const m = /** @type {Partial<SessionMeta>|undefined} */ (await get(KEYS.META));
  const d = defaultMeta();
  const meta = { ...d, ...(m || {}), degraded: { ...d.degraded, ...((m && m.degraded) || {}) } };
  // Anything but an explicit 'full' is the safe default.
  if (meta.keepBodies !== 'full') meta.keepBodies = 'shape';
  return meta;
}

/**
 * @param {Partial<SessionMeta>} patch
 * @returns {Promise<SessionMeta>}
 */
export async function setMeta(patch) {
  const meta = { ...(await getMeta()), ...patch };
  await set({ [KEYS.META]: meta });
  return meta;
}

/** Creates meta if missing so sessionStartedAt reflects the first worker start. */
export async function ensureMeta() {
  if (!(await get(KEYS.META))) await set({ [KEYS.META]: defaultMeta() });
}

/**
 * A8: pause/resume boundaries in the timeline.
 * @param {TimelineEvent['type']} type
 * @returns {Promise<SessionMeta>}
 */
export async function appendTimeline(type) {
  const meta = await getMeta();
  const timeline = [...meta.timeline, { type, at: new Date().toISOString() }].slice(-CAPS.TIMELINE);
  return setMeta({ timeline });
}

// ---------------------------------------------------------------- states

/**
 * States stored before docs/12 have no route, view, navigation or action
 * list. They are completed here, on the way out, so no reader has to know:
 * the route falls back to the pathname and everything else to empty.
 * @param {StateRecord} s
 * @returns {StateRecord}
 */
function completeState(s) {
  if (typeof s.route === 'string' && s.view && s.nav && Array.isArray(s.actionIds) && Array.isArray(s.queryKeys) && s.openedFrom !== undefined) return s;
  return {
    ...s,
    route: typeof s.route === 'string' ? s.route : s.pathname || '',
    queryKeys: Array.isArray(s.queryKeys) ? s.queryKeys : [],
    view: s.view || { key: '', active: [] },
    nav: s.nav || { menus: [], viewGroups: [], breadcrumbs: [] },
    actionIds: Array.isArray(s.actionIds) ? s.actionIds : [],
    openedFrom: s.openedFrom || null,
  };
}

/** @returns {Promise<StateRecord[]>} */
export async function getStates() {
  const list = /** @type {StateRecord[]} */ ((await get(KEYS.STATES)) || []);
  return list.map(completeState);
}

/** @returns {Promise<TabMap>} */
export async function getTabs() {
  return /** @type {TabMap} */ ((await get(KEYS.TABS)) || {});
}

/** @param {TabMap} tabs */
export async function setTabs(tabs) {
  await set({ [KEYS.TABS]: tabs });
}

/** @param {number} n */
const pad = (n) => String(n).padStart(4, '0');

/**
 * A5 (Q10): a write that fails for any reason steps the ladder and is retried
 * once. The storage estimate is not consulted — a failed write is the only
 * signal that means anything on a machine with unlimitedStorage.
 * @param {Record<string, unknown>} writes
 * @param {SessionMeta} meta
 * @returns {Promise<SessionMeta>}   meta after any degradation
 */
async function setOrDegrade(writes, meta) {
  try {
    await set(writes);
    return meta;
  } catch (e) {
    console.warn('[flowprint] write failed, degrading:', e instanceof Error ? e.message : String(e));
    const stepped = await degradeStep(meta, null);
    if (KEYS.META in writes) writes[KEYS.META] = { .../** @type {SessionMeta} */ (writes[KEYS.META]), degraded: stepped.meta.degraded };
    await set(writes);
    return stepped.meta;
  }
}

/**
 * docs/12 B7: removes every stored full body and clears the flag on the
 * entries that pointed at one.
 * @param {NetEntry[]|null} net   passed when the caller already holds it
 * @returns {Promise<{ removed: number, net: NetEntry[]|null }>}
 */
async function dropNetBodies(net) {
  const keys = (await allKeys()).filter((k) => k.startsWith(KEYS.NETBODY_PREFIX));
  if (!keys.length) return { removed: 0, net };
  await chrome.storage.local.remove(keys);
  const list = (net || (await getNet())).map((n) => (n.hasFullBody ? { ...n, hasFullBody: false } : n));
  try {
    await set({ [KEYS.NET]: list });
  } catch {
    // Storage is full enough that even this failed; the export finds no body
    // behind the flag and says so.
  }
  return { removed: keys.length, net: list };
}

/**
 * A5 and docs/12 B7: apply the next degradation step — screenshots,
 * snapshots, full bodies, network entries, and only then states. States
 * already stored are never dropped here.
 * @param {SessionMeta} meta
 * @param {NetEntry[]|null} net   passed when the caller already holds it
 * @returns {Promise<{ meta: SessionMeta, net: NetEntry[]|null }>}
 */
export async function degradeStep(meta, net) {
  const d = { ...meta.degraded };
  if (!d.screenshots) d.screenshots = true;
  else if (!d.snapshots) d.snapshots = true;
  else if (!d.bodiesDropped || !d.netTrimmed) {
    let freed = false;
    if (!d.bodiesDropped) {
      // From here on no new body is stored either (putNetBody checks the flag).
      d.bodiesDropped = true;
      const dropped = await dropNetBodies(net);
      net = dropped.net;
      freed = dropped.removed > 0;
    }
    // A step that freed nothing would waste the one retry the failed write
    // gets, so with no bodies to drop the ladder moves straight on.
    if (!freed) {
      d.netTrimmed = true;
      const list = net || (await getNet());
      const trimmed = list.slice(-Math.floor(CAPS.NET / 4));
      await set({ [KEYS.NET]: trimmed });
      net = trimmed;
      meta = { ...meta, netCount: trimmed.length };
    }
  } else d.statesRefused = true;
  meta = { ...meta, degraded: d };
  await set({ [KEYS.META]: meta });
  console.warn('[flowprint] storage degraded:', JSON.stringify(d));
  return { meta, net };
}

/**
 * Assigns id/seq, stores the DOM snapshot under its own key, enforces the cap
 * (dropping the oldest states and their side keys) and bumps the counters.
 * Returns null only when every degradation step has been exhausted.
 * @param {StateDraft} draft
 * @param {string|null} dom   gzipped base64 or null
 * @param {number} tabId
 * @param {number} frameId
 * @param {string[]} blockedFrames
 * @param {{ actionIds?: string[], openedFrom?: OpenedFrom|null }} [links]   docs/12 B4
 * @returns {Promise<StateRecord|null>}
 */
export async function addState(draft, dom, tabId, frameId, blockedFrames, links = {}) {
  const meta = await getMeta();
  if (meta.degraded.statesRefused) return null;
  if (meta.degraded.snapshots) dom = null;

  const seq = meta.seq + 1;
  const id = `st_${pad(seq)}`;
  /** @type {StateRecord} */
  const state = {
    ...draft,
    id,
    seq,
    tabId,
    frameId,
    domRef: dom ? KEYS.DOM_PREFIX + id : null,
    screenshotRef: null,
    duplicateOf: null,
    blockedFrames,
    netRefs: [],
    actionIds: links.actionIds || [],
    openedFrom: links.openedFrom || null,
  };

  const states = await getStates();
  states.push(state);

  /** @type {string[]} */
  const doomed = [];
  let domCount = meta.domCount + (dom ? 1 : 0);
  let shotCount = meta.screenshotCount;
  let listCount = meta.listPatternCount + countLists(state);
  while (states.length > CAPS.STATES) {
    const old = states.shift();
    if (!old) break;
    if (old.domRef) {
      doomed.push(old.domRef);
      domCount--;
    }
    if (old.screenshotRef) {
      doomed.push(old.screenshotRef);
      shotCount--;
    }
    listCount -= countLists(old);
  }

  /** @type {Record<string, unknown>} */
  const writes = { [KEYS.STATES]: states };
  if (dom && state.domRef) writes[state.domRef] = dom;
  writes[KEYS.META] = {
    ...meta,
    seq,
    stateCount: states.length,
    domCount: Math.max(0, domCount),
    screenshotCount: Math.max(0, shotCount),
    listPatternCount: Math.max(0, listCount),
  };
  try {
    await set(writes);
  } catch (e) {
    // A5: a failed write never loses a state — degrade and retry without the snapshot.
    console.warn('[flowprint] state write failed, degrading:', e instanceof Error ? e.message : String(e));
    const stepped = await degradeStep(meta, null);
    if (stepped.meta.degraded.statesRefused) return null;
    state.domRef = null;
    delete writes[KEYS.DOM_PREFIX + id];
    writes[KEYS.META] = { ...(/** @type {SessionMeta} */ (writes[KEYS.META])), degraded: stepped.meta.degraded, domCount: Math.max(0, domCount - (dom ? 1 : 0)) };
    await set(writes);
  }
  if (doomed.length) await chrome.storage.local.remove(doomed);
  return state;
}

/**
 * @param {StateRecord} s
 * @returns {number}
 */
function countLists(s) {
  const l = s.lists;
  return l ? l.tables.length + l.repeats.length + l.pagination.length + l.downloads.length : 0;
}

/**
 * @param {string} id
 * @param {Partial<StateRecord>} patch
 * @returns {Promise<StateRecord|null>}
 */
export async function updateState(id, patch) {
  const states = await getStates();
  const i = states.findIndex((s) => s.id === id);
  if (i < 0) return null;
  states[i] = { ...states[i], ...patch };
  await set({ [KEYS.STATES]: states });
  return states[i];
}

// ------------------------------------------------------------------- net

/**
 * Entries stored before docs/12 lack the shape and download fields.
 * @param {NetEntry} n
 * @returns {NetEntry}
 */
function completeNet(n) {
  if (typeof n.hasFullBody === 'boolean' && n.requestShape !== undefined && n.actionIdAtTime !== undefined) return n;
  return {
    ...n,
    requestShape: n.requestShape || null,
    responseShape: n.responseShape || null,
    responseSize: typeof n.responseSize === 'number' ? n.responseSize : -1,
    bodyTruncated: !!n.bodyTruncated,
    disposition: n.disposition || null,
    dispositionExt: n.dispositionExt || null,
    isDownload: !!n.isDownload,
    actionIdAtTime: n.actionIdAtTime || null,
    hasFullBody: !!n.hasFullBody,
  };
}

/** @returns {Promise<NetEntry[]>} */
export async function getNet() {
  const list = /** @type {NetEntry[]} */ ((await get(KEYS.NET)) || []);
  return list.map(completeNet);
}

/**
 * The full body, when the draft carries one, never goes into `fp:net`: it is
 * stored under its own key, and only while the user has asked for full
 * bodies and the ladder has not dropped them.
 * @param {NetDraft} draft
 * @param {number} tabId
 * @param {number} frameId
 * @param {string|null} stateIdAtTime
 * @param {boolean} stateIdInferred
 * @param {string|null} [actionIdAtTime]   docs/12 B5
 * @returns {Promise<NetEntry>}
 */
export async function addNet(draft, tabId, frameId, stateIdAtTime, stateIdInferred, actionIdAtTime = null) {
  let meta = await getMeta();
  const seq = meta.netSeq + 1;
  const id = `net_${pad(seq)}`;
  const { responseFull, ...rest } = draft;
  let hasFullBody = false;
  if (typeof responseFull === 'string' && responseFull) {
    hasFullBody = await putNetBody(id, responseFull);
    // A failed body write steps the ladder, which rewrites meta.
    if (!hasFullBody) meta = await getMeta();
  }
  /** @type {NetEntry} */
  const entry = { ...rest, id, seq, tabId, frameId, stateIdAtTime, stateIdInferred, actionIdAtTime, hasFullBody };
  const net = await getNet();
  net.push(entry);
  const cap = meta.degraded.netTrimmed ? Math.floor(CAPS.NET / 4) : CAPS.NET;
  /** @type {string[]} */
  const doomed = [];
  while (net.length > cap) {
    const old = net.shift();
    if (old && old.hasFullBody) doomed.push(KEYS.NETBODY_PREFIX + old.id);
  }
  try {
    await setOrDegrade({ [KEYS.NET]: net, [KEYS.META]: { ...meta, netSeq: seq, netCount: net.length } }, meta);
  } catch (e) {
    // The entry never landed; its body must not be left behind without one.
    if (hasFullBody) await chrome.storage.local.remove(KEYS.NETBODY_PREFIX + id).catch(() => {});
    throw e;
  }
  if (doomed.length) await chrome.storage.local.remove(doomed);
  return entry;
}

/**
 * docs/12 B5: one full, scrubbed response body under `fp:netbody:<netId>`.
 * Refuses unless full bodies are switched on, and after the ladder dropped
 * them. Does not touch the entry's `hasFullBody`; `addNet` sets that.
 * @param {string} netId
 * @param {string} text
 * @returns {Promise<boolean>}   true when the body was stored
 */
export async function putNetBody(netId, text) {
  const meta = await getMeta();
  if (meta.keepBodies !== 'full' || meta.degraded.bodiesDropped) return false;
  if (typeof text !== 'string' || !text) return false;
  try {
    await set({ [KEYS.NETBODY_PREFIX + netId]: text.length > CAPS.FULL_BODY_CHARS ? text.slice(0, CAPS.FULL_BODY_CHARS) : text });
    return true;
  } catch (e) {
    console.warn('[flowprint] body write failed, degrading:', e instanceof Error ? e.message : String(e));
    await degradeStep(meta, null);
    return false;
  }
}

/**
 * @param {string} netId
 * @returns {Promise<string|null>}
 */
export async function getNetBody(netId) {
  const v = await get(KEYS.NETBODY_PREFIX + netId);
  return typeof v === 'string' ? v : null;
}

// --------------------------------------------------------------- actions

/** @returns {Promise<ActionEntry[]>} */
export async function getActions() {
  return /** @type {ActionEntry[]} */ ((await get(KEYS.ACTIONS)) || []);
}

/**
 * docs/12 B4. `resultStateId` stays null until the next state lands in the
 * same tab and frame.
 * @param {ActionDraft} draft
 * @param {number} tabId
 * @param {number} frameId
 * @param {string|null} stateIdAtTime
 * @returns {Promise<ActionEntry>}
 */
export async function addAction(draft, tabId, frameId, stateIdAtTime) {
  const meta = await getMeta();
  const seq = meta.actionSeq + 1;
  /** @type {ActionEntry} */
  const entry = { ...draft, id: `act_${pad(seq)}`, seq, tabId, frameId, stateIdAtTime, resultStateId: null };
  const list = await getActions();
  list.push(entry);
  while (list.length > CAPS.ACTIONS) list.shift();
  await setOrDegrade({ [KEYS.ACTIONS]: list, [KEYS.META]: { ...meta, actionSeq: seq, actionCount: list.length } }, meta);
  return entry;
}

/**
 * @param {string[]} ids
 * @param {Partial<ActionEntry>} patch   `id` and `seq` are never changed
 * @returns {Promise<void>}
 */
export async function patchActions(ids, patch) {
  if (!ids.length) return;
  const want = new Set(ids);
  const list = await getActions();
  let hit = false;
  for (let i = 0; i < list.length; i++) {
    if (!want.has(list[i].id)) continue;
    list[i] = { ...list[i], ...patch, id: list[i].id, seq: list[i].seq };
    hit = true;
  }
  if (hit) await set({ [KEYS.ACTIONS]: list });
}

// ------------------------------------------------------------- downloads

/** @returns {Promise<DownloadEntry[]>} */
export async function getDownloads() {
  return /** @type {DownloadEntry[]} */ ((await get(KEYS.DOWNLOADS)) || []);
}

/**
 * docs/12 B6.
 * @param {Omit<DownloadEntry, 'id'|'seq'>} entry
 * @returns {Promise<DownloadEntry>}
 */
export async function addDownload(entry) {
  const meta = await getMeta();
  const seq = meta.downloadSeq + 1;
  /** @type {DownloadEntry} */
  const saved = { ...entry, id: `dl_${pad(seq)}`, seq };
  const list = await getDownloads();
  list.push(saved);
  while (list.length > CAPS.DOWNLOAD_LOG) list.shift();
  await setOrDegrade({ [KEYS.DOWNLOADS]: list, [KEYS.META]: { ...meta, downloadSeq: seq, downloadCount: list.length } }, meta);
  return saved;
}

/**
 * @param {string} id
 * @param {Partial<DownloadEntry>} patch   `id` and `seq` are never changed
 * @returns {Promise<void>}
 */
export async function patchDownload(id, patch) {
  const list = await getDownloads();
  const i = list.findIndex((d) => d.id === id);
  if (i < 0) return;
  list[i] = { ...list[i], ...patch, id: list[i].id, seq: list[i].seq };
  await set({ [KEYS.DOWNLOADS]: list });
}

/**
 * Browser download id → `dl_` id for downloads that have not settled.
 * @returns {Promise<Record<string, string>>}
 */
export async function getDownloadMap() {
  const v = await get(DOWNLOAD_MAP_KEY);
  return v && typeof v === 'object' ? /** @type {Record<string, string>} */ (v) : {};
}

/**
 * @param {Record<string, string>} map   trimmed to the most recent entries
 * @returns {Promise<void>}
 */
export async function setDownloadMap(map) {
  const keys = Object.keys(map);
  /** @type {Record<string, string>} */
  const kept = {};
  for (const k of keys.slice(-DOWNLOAD_MAP_MAX)) kept[k] = map[k];
  await set({ [DOWNLOAD_MAP_KEY]: kept });
}

// ------------------------------------------------------ transitions/deps

/** @returns {Promise<Transition[]>} */
export async function getTransitions() {
  const list = /** @type {Transition[]} */ ((await get(KEYS.TRANSITIONS)) || []);
  // Edges stored before docs/12 carry no actions; `urlChanged` is the
  // closest thing they recorded to a route change.
  return list.map((t) =>
    Array.isArray(t.actionIds)
      ? t
      : { ...t, actionIds: [], actionId: null, routeChanged: !!t.urlChanged, viewChanged: false, viaNewTab: false }
  );
}

/** @param {Transition} t */
export async function addTransition(t) {
  const list = await getTransitions();
  list.push(t);
  while (list.length > CAPS.TRANSITIONS) list.shift();
  await setOrDegrade({ [KEYS.TRANSITIONS]: list }, await getMeta());
}

/** @returns {Promise<Dependency[]>} */
export async function getDeps() {
  return /** @type {Dependency[]} */ ((await get(KEYS.DEPS)) || []);
}

/** @param {Dependency} d */
export async function addDep(d) {
  const list = await getDeps();
  list.push(d);
  while (list.length > CAPS.DEPS) list.shift();
  await setOrDegrade({ [KEYS.DEPS]: list }, await getMeta());
}

// ------------------------------------------------------------ snapshots

/**
 * @param {string} stateId
 * @param {string} pngBase64
 * @returns {Promise<boolean>} false if the state has already been capped away
 */
export async function putScreenshot(stateId, pngBase64) {
  const ref = KEYS.SHOT_PREFIX + stateId;
  const updated = await updateState(stateId, { screenshotRef: ref });
  if (!updated) return false;
  const meta = await getMeta();
  try {
    await set({ [ref]: pngBase64, [KEYS.META]: { ...meta, screenshotCount: meta.screenshotCount + 1 } });
  } catch {
    await updateState(stateId, { screenshotRef: null });
    await degradeStep(meta, null);
    return false;
  }
  return true;
}

/**
 * @param {string} stateId
 * @returns {Promise<string|null>}
 */
export async function getDom(stateId) {
  const v = await get(KEYS.DOM_PREFIX + stateId);
  return typeof v === 'string' ? v : null;
}

/**
 * @param {string} stateId
 * @returns {Promise<string|null>}
 */
export async function getScreenshot(stateId) {
  const v = await get(KEYS.SHOT_PREFIX + stateId);
  return typeof v === 'string' ? v : null;
}

// --------------------------------------------------------- screenshot queue

/** @returns {Promise<ScreenshotJob[]>} */
export async function getQueue() {
  return /** @type {ScreenshotJob[]} */ ((await get(KEYS.QUEUE)) || []);
}

/** @param {ScreenshotJob[]} q */
export async function setQueue(q) {
  await set({ [KEYS.QUEUE]: q });
}

/**
 * A4: runs at every worker start. Drops stale queue entries and abandoned locks.
 */
export async function reconcile() {
  const lock = /** @type {number|undefined} */ (await get(KEYS.LOCK));
  if (lock && Date.now() - lock > TIMING.LOCK_STALE_MS) await releaseLock();
  const q = await getQueue();
  const fresh = q.filter((j) => Date.now() - j.at < TIMING.SCREENSHOT_QUEUE_STALE_MS);
  if (fresh.length !== q.length) await setQueue(fresh);
  await ensureMeta();
}

// ----------------------------------------------------------------- clear

/**
 * Every `fp:` key. Uses getKeys() where Chrome has it (130+) so the wipe never
 * loads the snapshots into memory.
 * @returns {Promise<string[]>}
 */
async function allKeys() {
  const local = /** @type {{ getKeys?: () => Promise<string[]> }} */ (/** @type {unknown} */ (chrome.storage.local));
  if (typeof local.getKeys === 'function') return local.getKeys();
  return Object.keys(await chrome.storage.local.get(null));
}

/** Rule 6 — wipe everything including consented origins, then a fresh meta. */
export async function clearAll() {
  const keys = (await allKeys()).filter((k) => k.startsWith(KEYS.PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
  await set({ [KEYS.META]: defaultMeta() });
}
