/**
 * Service worker — message router, screenshot throttle, pause-flag owner.
 * Content scripts send drafts here; the panel polls here; nothing else in the
 * extension writes to storage. All storage work goes through store.enqueue.
 */
import { MSG, TIMING, CAPS } from '../shared/constants.js';
import * as store from './lib/store.js';
import { buildTransition, fieldKey } from './lib/transitions.js';
import { detectDependency, isDuplicateDependency } from './lib/deps.js';
import { runExport, getExportProgress } from './lib/export.js';

/** @typedef {import('../shared/schema.js').StateDraft} StateDraft */
/** @typedef {import('../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../shared/schema.js').NetDraft} NetDraft */
/** @typedef {import('../shared/schema.js').Stats} Stats */
/** @typedef {import('../shared/schema.js').PanelRow} PanelRow */
/** @typedef {import('../shared/schema.js').TabMap} TabMap */

// ------------------------------------------------------------------ setup

const openPanelOnClick = () => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
};
chrome.runtime.onInstalled.addListener(() => {
  openPanelOnClick();
  void store.enqueue(() => store.ensureMeta());
});
chrome.runtime.onStartup.addListener(() => {
  openPanelOnClick();
  void store.enqueue(() => store.ensureMeta());
});
openPanelOnClick();

/**
 * Transitions are per document, so a tab's iframes are tracked apart from its
 * top frame. See Q12.
 * @param {number} tabId
 * @param {number} frameId
 */
const tabKey = (tabId, frameId) => `${tabId}:${frameId}`;

// ------------------------------------------------------------ screenshots

/** @type {Array<{ stateId: string, windowId: number, inIframe: boolean }>} */
const shotQueue = [];
let shotPumping = false;
let lastShotAt = 0;

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Drop-not-block: past the queue cap the request is simply forgotten.
 * Iframe states are captured too; the image is the whole tab, so it is
 * labelled `parent-frame` (Q1).
 * @param {string} stateId
 * @param {number} windowId
 * @param {boolean} inIframe
 */
function enqueueScreenshot(stateId, windowId, inIframe) {
  if (shotQueue.length >= TIMING.SCREENSHOT_QUEUE_MAX) return;
  shotQueue.push({ stateId, windowId, inIframe });
  void pumpScreenshots();
}

async function pumpScreenshots() {
  if (shotPumping) return;
  shotPumping = true;
  try {
    while (shotQueue.length) {
      const wait = TIMING.SCREENSHOT_THROTTLE_MS - (Date.now() - lastShotAt);
      if (wait > 0) await sleep(wait);
      const job = shotQueue.shift();
      if (!job) break;
      lastShotAt = Date.now();
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(job.windowId, { format: 'png' });
        const b64 = typeof dataUrl === 'string' ? dataUrl.split(',')[1] : '';
        if (b64) await store.enqueue(() => store.putScreenshot(job.stateId, b64, job.inIframe ? 'parent-frame' : 'page'));
      } catch {
        // Tab not visible, rate-limited, or window gone: drop this one.
      }
    }
  } finally {
    shotPumping = false;
  }
}

// --------------------------------------------------------------- handlers

/**
 * @param {StateDraft} draft
 * @param {string|null} dom
 * @param {chrome.runtime.MessageSender} sender
 * @returns {Promise<{ id: string }|{ skipped: string }>}
 */
async function onStateCaptured(draft, dom, sender) {
  const tabId = sender.tab?.id ?? -1;
  const frameId = sender.frameId ?? 0;
  const windowId = sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;

  return store.enqueue(async () => {
    const meta = await store.getMeta();
    if (!meta.recording) return { skipped: 'paused' };

    const tabs = await store.getTabs();
    const key = tabKey(tabId, frameId);
    const info = tabs[key] || { lastStateId: null, lastSignature: null, lastErrorsKey: null };
    const errorsKey = draft.errors.join(' | ');
    const sameAsLast = info.lastSignature === draft.signature && info.lastErrorsKey === errorsKey;

    // Second line of dedupe behind the content script's own: a re-injected
    // content script (extension reload, bfcache restore) re-sends `load` for a
    // page that is already the tab's latest state.
    if (draft.trigger === 'load' && sameAsLast) {
      return { skipped: 'duplicate' };
    }

    const state = await store.addState(draft, dom, tabId, frameId);
    // Q10: a manual capture is always stored, but an identical one says so.
    if (draft.trigger === 'manual' && sameAsLast && info.lastStateId) {
      state.duplicateOf = info.lastStateId;
      await store.updateState(state.id, { duplicateOf: info.lastStateId });
    }

    if (info.lastStateId) {
      const states = await store.getStates();
      const prev = states.find((s) => s.id === info.lastStateId);
      if (prev) {
        const net = await store.getNet();
        const between = net.filter((n) => n.tabId === tabId && n.stateIdAtTime === prev.id);
        const edge = buildTransition(prev, state, between);
        await store.addTransition(edge);
        if (between.length) await store.updateState(state.id, { netRefs: between.map((n) => n.id) });
        const dep = detectDependency(state, edge, between);
        if (dep) {
          const existing = await store.getDeps();
          if (!isDuplicateDependency(existing, dep)) await store.addDep(dep);
        }
      }
    }

    tabs[key] = { lastStateId: state.id, lastSignature: state.signature, lastErrorsKey: errorsKey };
    await store.setTabs(tabs);

    if (meta.screenshots && tabId >= 0) enqueueScreenshot(state.id, windowId, draft.inIframe);
    return { id: state.id };
  });
}

/**
 * @param {NetDraft} entry
 * @param {chrome.runtime.MessageSender} sender
 */
async function onNetEntry(entry, sender) {
  const tabId = sender.tab?.id ?? -1;
  const frameId = sender.frameId ?? 0;
  return store.enqueue(async () => {
    const meta = await store.getMeta();
    if (!meta.recording) return { skipped: 'paused' };
    const tabs = await store.getTabs();
    const own = tabs[tabKey(tabId, frameId)];
    const top = tabs[tabKey(tabId, 0)];
    const info = own || top;
    const inferred = !own && !!top;
    const saved = await store.addNet(entry, tabId, frameId, info?.lastStateId ?? null, inferred);
    return { id: saved.id };
  });
}

/** @returns {Promise<Stats>} */
async function onGetStats() {
  const meta = await store.getMeta();
  return {
    states: meta.stateCount,
    net: meta.netCount,
    screenshots: meta.screenshotCount,
    recording: meta.recording,
    screenshotsEnabled: meta.screenshots,
    sessionStartedAt: meta.sessionStartedAt,
    exportProgress: getExportProgress(),
  };
}

/** @returns {Promise<PanelRow[]>} */
async function onGetStates() {
  const states = await store.getStates();
  const transitions = await store.getTransitions();
  const added = new Set(transitions.filter((t) => t.fieldsAdded.length > 0).map((t) => t.to));
  return states.slice(-CAPS.PANEL_ROWS).map((s) => ({
    id: s.id,
    seq: s.seq,
    title: s.title,
    pathname: s.pathname,
    trigger: s.trigger,
    capturedAt: s.capturedAt,
    fieldCount: s.fieldCount,
    errorCount: s.errors.length,
    newFields: added.has(s.id),
    duplicate: !!s.duplicateOf,
    inIframe: s.inIframe,
    headings: s.headings.slice(0, 10),
    steps: s.steps,
    fieldLabels: s.fields.slice(0, 10).map((f) => f.label || fieldKey(f)),
  }));
}

/** Relay to every frame of the active MCA tab in the current window. */
async function onCaptureNow() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || tab.id == null || !/^https:\/\/(www\.)?mca\.gov\.in\//.test(tab.url || '')) {
    return { ok: false, reason: 'active tab is not an MCA page' };
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: MSG.CAPTURE_NOW });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'no content script in that tab (reload it)' };
  }
}

// ----------------------------------------------------------------- router

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;

  /** @param {Promise<unknown>} p */
  const reply = (p) => {
    p.then(
      (r) => sendResponse(r),
      (e) => sendResponse({ error: String(e && e.message ? e.message : e) })
    );
    return true; // keep the channel open for the async reply
  };

  switch (msg.type) {
    case MSG.STATE_CAPTURED:
      return reply(onStateCaptured(msg.draft, typeof msg.dom === 'string' ? msg.dom : null, sender));
    case MSG.NET_ENTRY:
      return reply(onNetEntry(msg.entry, sender));
    case MSG.GET_FLAGS:
      return reply(store.getMeta().then((m) => ({ recording: m.recording, screenshots: m.screenshots })));
    case MSG.GET_STATS:
      return reply(onGetStats());
    case MSG.GET_STATES:
      return reply(onGetStates());
    case MSG.SET_RECORDING:
      return reply(store.enqueue(() => store.setMeta({ recording: !!msg.on })).then((m) => ({ recording: m.recording })));
    case MSG.SET_SCREENSHOTS:
      return reply(store.enqueue(() => store.setMeta({ screenshots: !!msg.on })).then((m) => ({ screenshots: m.screenshots })));
    case MSG.CAPTURE_NOW:
      return reply(onCaptureNow());
    case MSG.EXPORT:
      return reply(runExport());
    case MSG.CLEAR:
      shotQueue.length = 0;
      return reply(store.enqueue(() => store.clearAll()).then(() => ({ ok: true })));
    default:
      return false;
  }
});
