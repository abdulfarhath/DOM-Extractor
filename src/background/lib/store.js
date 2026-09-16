/**
 * chrome.storage.local access. Every mutation goes through `enqueue` so
 * captures from several frames never interleave a read-modify-write.
 * Keys and caps come from shared/constants.js; nothing else in the extension
 * touches storage directly.
 */
import { KEYS, CAPS } from '../../shared/constants.js';

/** @typedef {import('../../shared/schema.js').StateDraft} StateDraft */
/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../../shared/schema.js').NetDraft} NetDraft */
/** @typedef {import('../../shared/schema.js').NetEntry} NetEntry */
/** @typedef {import('../../shared/schema.js').Transition} Transition */
/** @typedef {import('../../shared/schema.js').Dependency} Dependency */
/** @typedef {import('../../shared/schema.js').SessionMeta} SessionMeta */
/** @typedef {import('../../shared/schema.js').TabMap} TabMap */

/** @type {Promise<unknown>} */
let queue = Promise.resolve();

/**
 * Serialise a storage operation behind every previous one. Errors are logged
 * (ids only, never content) and do not poison the chain.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function enqueue(fn) {
  const p = queue.then(fn);
  queue = p.catch((e) => console.warn('[mcadc] store op failed:', e && e.message));
  return p;
}

/**
 * @param {string} key
 * @returns {Promise<unknown>}
 */
async function get(key) {
  const r = await chrome.storage.local.get(key);
  return r[key];
}

/**
 * @param {Record<string, unknown>} obj
 */
async function set(obj) {
  await chrome.storage.local.set(obj);
}

/** @returns {SessionMeta} */
function defaultMeta() {
  return {
    sessionStartedAt: new Date().toISOString(),
    recording: true,
    screenshots: true,
    seq: 0,
    netSeq: 0,
    stateCount: 0,
    netCount: 0,
    domCount: 0,
    screenshotCount: 0,
  };
}

/** @returns {Promise<SessionMeta>} */
export async function getMeta() {
  const m = /** @type {Partial<SessionMeta>|undefined} */ (await get(KEYS.META));
  return { ...defaultMeta(), ...(m || {}) };
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
  const m = await get(KEYS.META);
  if (!m) await set({ [KEYS.META]: defaultMeta() });
}

/** @returns {Promise<StateRecord[]>} */
export async function getStates() {
  return /** @type {StateRecord[]} */ ((await get(KEYS.STATES)) || []);
}

/** @returns {Promise<TabMap>} */
export async function getTabs() {
  return /** @type {TabMap} */ ((await get(KEYS.TABS)) || {});
}

/** @param {TabMap} tabs */
export async function setTabs(tabs) {
  await set({ [KEYS.TABS]: tabs });
}

/**
 * @param {number} n
 * @returns {string}
 */
const pad = (n) => String(n).padStart(4, '0');

/**
 * Assigns id/seq, stores the DOM snapshot under its own key, enforces the cap
 * (dropping oldest states and their side keys) and bumps the counters.
 * @param {StateDraft} draft
 * @param {string|null} dom   gzipped base64 or null
 * @param {number} tabId
 * @param {number} frameId
 * @returns {Promise<StateRecord>}
 */
export async function addState(draft, dom, tabId, frameId) {
  const meta = await getMeta();
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
    screenshotOf: null,
    duplicateOf: null,
    netRefs: [],
  };

  const states = await getStates();
  states.push(state);

  /** @type {string[]} */
  const doomed = [];
  let domCount = meta.domCount + (dom ? 1 : 0);
  let shotCount = meta.screenshotCount;
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
  };
  await set(writes);
  if (doomed.length) await chrome.storage.local.remove(doomed);
  return state;
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

/** @returns {Promise<NetEntry[]>} */
export async function getNet() {
  return /** @type {NetEntry[]} */ ((await get(KEYS.NET)) || []);
}

/**
 * @param {NetDraft} draft
 * @param {number} tabId
 * @param {number} frameId
 * @param {string|null} stateIdAtTime
 * @param {boolean} stateIdInferred   attributed to the top frame's state, not this frame's (Q12)
 * @returns {Promise<NetEntry>}
 */
export async function addNet(draft, tabId, frameId, stateIdAtTime, stateIdInferred) {
  const meta = await getMeta();
  const seq = meta.netSeq + 1;
  /** @type {NetEntry} */
  const entry = { ...draft, id: `net_${pad(seq)}`, seq, tabId, frameId, stateIdAtTime, stateIdInferred };
  const net = await getNet();
  net.push(entry);
  while (net.length > CAPS.NET) net.shift();
  await set({ [KEYS.NET]: net, [KEYS.META]: { ...meta, netSeq: seq, netCount: net.length } });
  return entry;
}

/** @returns {Promise<Transition[]>} */
export async function getTransitions() {
  return /** @type {Transition[]} */ ((await get(KEYS.TRANSITIONS)) || []);
}

/** @param {Transition} t */
export async function addTransition(t) {
  const list = await getTransitions();
  list.push(t);
  while (list.length > CAPS.TRANSITIONS) list.shift();
  await set({ [KEYS.TRANSITIONS]: list });
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
  await set({ [KEYS.DEPS]: list });
}

/**
 * @param {string} stateId
 * @param {string} pngBase64
 * @param {'page'|'parent-frame'} screenshotOf   what the image actually shows (Q1)
 * @returns {Promise<boolean>} false if the state has already been capped away
 */
export async function putScreenshot(stateId, pngBase64, screenshotOf) {
  const ref = KEYS.SHOT_PREFIX + stateId;
  const updated = await updateState(stateId, { screenshotRef: ref, screenshotOf });
  if (!updated) return false;
  const meta = await getMeta();
  await set({ [ref]: pngBase64, [KEYS.META]: { ...meta, screenshotCount: meta.screenshotCount + 1 } });
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

/**
 * Every `dc:` key. Uses getKeys() where Chrome has it (130+) so the wipe never
 * has to load the snapshots into memory.
 * @returns {Promise<string[]>}
 */
async function allKeys() {
  const local = /** @type {{ getKeys?: () => Promise<string[]> }} */ (/** @type {unknown} */ (chrome.storage.local));
  if (typeof local.getKeys === 'function') return local.getKeys();
  return Object.keys(await chrome.storage.local.get(null));
}

/** Rule 5 — wipe everything, then start a fresh meta so counters read zero. */
export async function clearAll() {
  const keys = (await allKeys()).filter((k) => k.startsWith(KEYS.PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
  await set({ [KEYS.META]: defaultMeta() });
}
