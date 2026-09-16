/**
 * Service worker — message router, consent state, screenshot throttle,
 * pause enforcement. Content scripts send drafts here; the panel polls here;
 * nothing else writes to storage. Every cross-message fact lives in
 * chrome.storage.local (A4): this module keeps no state a restart could lose
 * except the screenshot pacing clock.
 */
import { MSG, TIMING, CAPS, PACKS } from '../shared/constants.js';
import * as store from './lib/store.js';
import * as origins from './lib/origins.js';
import { buildTransition, gapBetween } from './lib/transitions.js';
import { detectDependency, isDuplicateDependency } from './lib/deps.js';
import { runExport, getExportProgress } from './lib/export.js';

/** @typedef {import('../shared/schema.js').StateDraft} StateDraft */
/** @typedef {import('../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../shared/schema.js').NetDraft} NetDraft */
/** @typedef {import('../shared/schema.js').Stats} Stats */
/** @typedef {import('../shared/schema.js').PanelRow} PanelRow */
/** @typedef {import('../shared/schema.js').OriginInfo} OriginInfo */
/** @typedef {import('../shared/schema.js').SessionMeta} SessionMeta */

// ------------------------------------------------------------------ setup
// Runs on every worker start, including unpacked reloads where onStartup
// never fires (A4).
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
void store.enqueue(() => store.reconcile());
chrome.runtime.onInstalled.addListener(() => void store.enqueue(() => store.reconcile()));

/**
 * Transitions are per document: a tab's iframes are tracked apart from its
 * top frame (Q12).
 * @param {number} tabId
 * @param {number} frameId
 */
const tabKey = (tabId, frameId) => `${tabId}:${frameId}`;

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ screenshots

let shotPumping = false;
let lastShotAt = 0;

/**
 * Drop-not-block: past the queue cap the request is forgotten. The queue is
 * stored so a worker restart mid-wait does not lose it (A4).
 * @param {string} stateId
 * @param {number} windowId
 */
async function enqueueScreenshot(stateId, windowId) {
  await store.withLock(async () => {
    const q = await store.getQueue();
    if (q.length >= TIMING.SCREENSHOT_QUEUE_MAX) return;
    q.push({ stateId, windowId, at: Date.now() });
    await store.setQueue(q);
  });
  void pumpScreenshots();
}

async function pumpScreenshots() {
  if (shotPumping) return;
  shotPumping = true;
  try {
    for (;;) {
      const job = await store.withLock(async () => {
        const q = await store.getQueue();
        const j = q.shift();
        if (j) await store.setQueue(q);
        return j || null;
      });
      if (!job) break;
      const wait = TIMING.SCREENSHOT_THROTTLE_MS - (Date.now() - lastShotAt);
      if (wait > 0) await sleep(wait);
      lastShotAt = Date.now();
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(job.windowId, { format: 'png' });
        const b64 = typeof dataUrl === 'string' ? dataUrl.split(',')[1] : '';
        if (b64) await store.withLock(() => store.putScreenshot(job.stateId, b64));
      } catch {
        // Tab not visible, rate-limited, or window gone: drop this one.
      }
    }
  } finally {
    shotPumping = false;
  }
}

// --------------------------------------------------------------- consent

/**
 * @param {chrome.runtime.MessageSender} sender
 * @returns {string|null}
 */
const topOriginOf = (sender) => (sender.tab && sender.tab.url ? origins.originOf(sender.tab.url) : null);

/**
 * The gate: everything the content script needs to decide whether to exist.
 * @param {{ origin: string, inIframe: boolean }} msg
 * @param {chrome.runtime.MessageSender} sender
 */
async function onGateCheck(msg, sender) {
  const list = await origins.listOrigins();
  const consented = typeof msg.origin === 'string' && list.includes(msg.origin);
  const top = topOriginOf(sender);
  const meta = await store.getMeta();
  return {
    consented,
    topConsented: !!top && list.includes(top),
    recording: meta.recording,
    screenshots: meta.screenshots,
    dangerWords: meta.dangerWords,
    packs: meta.packs,
  };
}

/**
 * Recompute enabled packs: auto packs for the consented hosts plus whatever
 * the user switched on by hand.
 * @param {SessionMeta} meta
 * @param {string[]} list
 * @returns {string[]}
 */
function packsFor(meta, list) {
  const auto = origins.autoPacks(list, PACKS.AUTO_BY_HOST);
  const manual = meta.packs.filter((p) => PACKS.ALL.includes(p));
  return Array.from(new Set([...auto, ...manual]));
}

/**
 * @param {{ origin: string, tabId?: number }} msg
 */
async function onAddOrigin(msg) {
  const origin = origins.originOf(msg.origin || '');
  if (!origin) return { ok: false, reason: 'not an http(s) origin' };
  const list = await origins.addOrigin(origin);
  await store.withLock(async () => {
    const meta = await store.getMeta();
    await store.setMeta({ packs: packsFor(meta, list) });
  });
  // Reload so the MAIN-world hooks and the gate run from document_start.
  if (typeof msg.tabId === 'number') {
    try {
      await chrome.tabs.reload(msg.tabId);
    } catch {
      /* tab gone */
    }
  }
  return { ok: true, origins: list };
}

/**
 * @param {{ origin: string }} msg
 */
async function onRemoveOrigin(msg) {
  const list = await origins.removeOrigin(msg.origin);
  return { ok: true, origins: list };
}

/**
 * @param {{ origin: string, tabId?: number }} msg
 * @returns {Promise<OriginInfo>}
 */
async function onGetOriginInfo(msg) {
  const list = await origins.listOrigins();
  const meta = await store.getMeta();
  const origin = origins.originOf(msg.origin || '') || msg.origin || '';
  const blocked = typeof msg.tabId === 'number' ? meta.blockedFrames[String(msg.tabId)] || [] : [];
  return {
    origin,
    consented: list.includes(origin),
    otherOrigins: list.filter((o) => o !== origin),
    blockedFrames: blocked.filter((o) => !list.includes(o)),
  };
}

/**
 * A3: a frame inside a consented page hit the gate. Remember it per tab so
 * the panel can offer it.
 * @param {{ origin: string }} msg
 * @param {chrome.runtime.MessageSender} sender
 */
async function onFrameBlocked(msg, sender) {
  const tabId = sender.tab?.id;
  const origin = origins.originOf(msg.origin || '');
  if (tabId == null || !origin) return { ok: false };
  await store.withLock(async () => {
    const meta = await store.getMeta();
    const blocked = { ...meta.blockedFrames };
    const list = blocked[String(tabId)] || [];
    if (!list.includes(origin)) blocked[String(tabId)] = [...list, origin];
    await store.setMeta({ blockedFrames: blocked });
  });
  return { ok: true };
}

// --------------------------------------------------------------- capture

/**
 * @param {StateDraft} draft
 * @param {string|null} dom
 * @param {chrome.runtime.MessageSender} sender
 */
async function onStateCaptured(draft, dom, sender) {
  const tabId = sender.tab?.id ?? -1;
  const frameId = sender.frameId ?? 0;
  const windowId = sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
  if (!draft || typeof draft.origin !== 'string') return { skipped: 'malformed' };

  // Rule 1 re-checked here: a stale content script must not slip a state in.
  if (!(await origins.isConsented(draft.origin))) return { skipped: 'not consented' };

  const result = await store.withLock(async () => {
    const meta = await store.getMeta();
    if (!meta.recording) return { skipped: 'paused' };

    const tabs = await store.getTabs();
    const key = tabKey(tabId, frameId);
    const info = tabs[key] || { lastStateId: null, lastSignature: null, lastErrorsKey: null, lastAt: null, origin: null };
    const errorsKey = draft.errors.join(' | ');
    const sameAsLast = info.lastSignature === draft.signature && info.lastErrorsKey === errorsKey;

    // A re-injected content script re-sends `load` for a page already stored.
    if (draft.trigger === 'load' && sameAsLast) return { skipped: 'duplicate' };

    const blocked = meta.blockedFrames[String(tabId)] || [];
    const state = await store.addState(draft, dom, tabId, frameId, blocked);
    if (!state) return { skipped: 'storage exhausted' };

    if (draft.trigger === 'manual' && sameAsLast && info.lastStateId) {
      state.duplicateOf = info.lastStateId;
      await store.updateState(state.id, { duplicateOf: info.lastStateId });
    }

    // A8: no edge across a pause/resume, a session clear, or a different tab.
    const prevOk = info.lastStateId && info.lastAt && info.origin === draft.origin && !gapBetween(meta.timeline, info.lastAt, state.capturedAt);
    if (prevOk) {
      const states = await store.getStates();
      const prev = states.find((s) => s.id === info.lastStateId);
      if (prev) {
        const net = await store.getNet();
        const between = net.filter((n) => n.tabId === tabId && n.stateIdAtTime === prev.id);
        const edge = buildTransition(prev, state, between);
        await store.addTransition(edge);
        if (between.length) await store.updateState(state.id, { netRefs: between.map((n) => n.id) });
        const dep = detectDependency(state, edge, between);
        if (dep && !isDuplicateDependency(await store.getDeps(), dep)) await store.addDep(dep);
      }
    }

    tabs[key] = { lastStateId: state.id, lastSignature: state.signature, lastErrorsKey: errorsKey, lastAt: state.capturedAt, origin: draft.origin };
    await store.setTabs(tabs);

    const shoot = meta.screenshots && !meta.degraded.screenshots && !draft.inIframe && tabId >= 0;
    return { id: state.id, shoot };
  });

  if ('shoot' in result && result.shoot) await enqueueScreenshot(result.id, windowId);
  return result;
}

/**
 * @param {NetDraft} entry
 * @param {chrome.runtime.MessageSender} sender
 */
async function onNetEntry(entry, sender) {
  const tabId = sender.tab?.id ?? -1;
  const frameId = sender.frameId ?? 0;
  const top = topOriginOf(sender);
  if (!entry || typeof entry.url !== 'string') return { skipped: 'malformed' };
  // The sending frame's own origin is what was consented, not the URL called.
  const frameOrigin = origins.originOf(entry.pageUrl || '') || top;
  if (!frameOrigin || !(await origins.isConsented(frameOrigin))) return { skipped: 'not consented' };

  return store.withLock(async () => {
    const meta = await store.getMeta();
    if (!meta.recording) return { skipped: 'paused' };
    const tabs = await store.getTabs();
    const own = tabs[tabKey(tabId, frameId)];
    const topInfo = tabs[tabKey(tabId, 0)];
    const info = own || topInfo;
    const saved = await store.addNet(entry, tabId, frameId, info?.lastStateId ?? null, !own && !!topInfo);
    return { id: saved.id };
  });
}

/**
 * @param {{ origin: string, until: number }} msg
 */
async function onThrottled(msg) {
  const origin = origins.originOf(msg.origin || '');
  if (!origin) return { ok: false };
  await store.withLock(async () => {
    const meta = await store.getMeta();
    await store.setMeta({ throttledUntil: { ...meta.throttledUntil, [origin]: Number(msg.until) || Date.now() + TIMING.MUTATION_BREAKER_COOLDOWN_MS } });
  });
  return { ok: true };
}

// ----------------------------------------------------------------- panel

/** @returns {Promise<Stats>} */
async function onGetStats() {
  const meta = await store.getMeta();
  const list = await origins.listOrigins();
  const now = Date.now();
  return {
    states: meta.stateCount,
    net: meta.netCount,
    lists: meta.listPatternCount,
    screenshots: meta.screenshotCount,
    recording: meta.recording,
    screenshotsEnabled: meta.screenshots,
    dangerWords: meta.dangerWords,
    packs: meta.packs,
    origins: list,
    sessionStartedAt: meta.sessionStartedAt,
    degraded: meta.degraded,
    throttled: Object.values(meta.throttledUntil).some((t) => t > now),
    exportProgress: getExportProgress(),
  };
}

/** @returns {Promise<PanelRow[]>} */
async function onGetStates() {
  const states = await store.getStates();
  const transitions = await store.getTransitions();
  const added = new Set(transitions.filter((t) => t.fieldsAdded.length > 0).map((t) => t.to));
  return states.slice(-CAPS.PANEL_ROWS).map((s) => {
    const l = s.lists || { tables: [], repeats: [], pagination: [], downloads: [] };
    /** @type {string[]} */
    const listSummary = [];
    for (const t of l.tables) listSummary.push(`table ${t.headers.length} cols × ${t.rowCount} rows — ${t.containerSelector}`);
    for (const r of l.repeats) listSummary.push(`${r.itemCount} × ${r.itemSelector}`);
    for (const p of l.pagination) listSummary.push(`pagination (${p.style}) — ${p.containerSelector}`);
    if (l.downloads.length) listSummary.push(`${l.downloads.length} download link${l.downloads.length === 1 ? '' : 's'}`);
    return {
      id: s.id,
      seq: s.seq,
      title: s.title,
      pathname: s.pathname,
      trigger: s.trigger,
      capturedAt: s.capturedAt,
      controlCount: s.controlCount,
      errorCount: s.errors.length,
      listCount: l.tables.length + l.repeats.length + l.pagination.length + l.downloads.length,
      newControls: added.has(s.id),
      duplicate: !!s.duplicateOf,
      inIframe: s.inIframe,
      degraded: !!s.captureDegraded,
      headings: s.headings.slice(0, 10),
      steps: s.steps,
      controlLabels: s.controls.slice(0, 10).map((c) => c.label || c.key),
      listSummary: listSummary.slice(0, 8),
    };
  });
}

/** Relay to every frame of the active tab, if its origin is consented. */
async function onCaptureNow() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const origin = tab && tab.url ? origins.originOf(tab.url) : null;
  if (!tab || tab.id == null || !origin) return { ok: false, reason: 'active tab has no http(s) origin' };
  if (!(await origins.isConsented(origin))) return { ok: false, reason: 'this site is not being recorded' };
  try {
    await chrome.tabs.sendMessage(tab.id, { type: MSG.CAPTURE_NOW });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'no content script in that tab — reload it' };
  }
}

/**
 * @param {boolean} on
 */
async function onSetRecording(on) {
  return store.withLock(async () => {
    const meta = await store.getMeta();
    if (meta.recording === on) return { recording: on };
    await store.setMeta({ recording: on });
    await store.appendTimeline(on ? 'resumed' : 'paused');
    return { recording: on };
  });
}

/**
 * @param {unknown} words
 */
async function onSetDangerWords(words) {
  const list = Array.isArray(words) ? words.filter((w) => typeof w === 'string').map((w) => w.trim().toLowerCase()).filter(Boolean).slice(0, 50) : [];
  const meta = await store.withLock(() => store.setMeta({ dangerWords: list }));
  return { dangerWords: meta.dangerWords };
}

/**
 * @param {unknown} packs
 */
async function onSetPacks(packs) {
  const wanted = Array.isArray(packs) ? packs.filter((p) => typeof p === 'string' && PACKS.ALL.includes(p)) : [];
  const meta = await store.withLock(() => store.setMeta({ packs: Array.from(new Set(['generic', ...wanted])) }));
  return { packs: meta.packs };
}

// ----------------------------------------------------------------- router

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;
  // Offscreen replies are addressed to the export module, not this router.
  if (msg.target === 'offscreen') return false;

  /** @param {Promise<unknown>} p */
  const reply = (p) => {
    p.then(
      (r) => sendResponse(r),
      (e) => sendResponse({ error: e instanceof Error ? e.message : String(e) })
    );
    return true;
  };

  switch (msg.type) {
    case MSG.GATE_CHECK:
      return reply(onGateCheck(msg, sender));
    case MSG.STATE_CAPTURED:
      return reply(onStateCaptured(msg.draft, typeof msg.dom === 'string' ? msg.dom : null, sender));
    case MSG.NET_ENTRY:
      return reply(onNetEntry(msg.entry, sender));
    case MSG.FRAME_BLOCKED:
      return reply(onFrameBlocked(msg, sender));
    case MSG.THROTTLED:
      return reply(onThrottled(msg));
    case MSG.GET_STATS:
      return reply(onGetStats());
    case MSG.GET_STATES:
      return reply(onGetStates());
    case MSG.GET_ORIGIN_INFO:
      return reply(onGetOriginInfo(msg));
    case MSG.ADD_ORIGIN:
      return reply(onAddOrigin(msg));
    case MSG.REMOVE_ORIGIN:
      return reply(onRemoveOrigin(msg));
    case MSG.SET_RECORDING:
      return reply(onSetRecording(!!msg.on));
    case MSG.SET_SCREENSHOTS:
      return reply(store.withLock(() => store.setMeta({ screenshots: !!msg.on })).then((m) => ({ screenshots: m.screenshots })));
    case MSG.SET_DANGER_WORDS:
      return reply(onSetDangerWords(msg.words));
    case MSG.SET_PACKS:
      return reply(onSetPacks(msg.packs));
    case MSG.CAPTURE_NOW:
      return reply(onCaptureNow());
    case MSG.EXPORT:
      return reply(runExport());
    case MSG.CLEAR:
      return reply(store.withLock(() => store.clearAll()).then(() => ({ ok: true })));
    default:
      return false;
  }
});
