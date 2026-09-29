/**
 * Service worker — message router, consent state, screenshot throttle,
 * pause enforcement. Content scripts send drafts here; the panel polls here;
 * nothing else writes to storage. Every cross-message fact lives in
 * chrome.storage.local (A4): this module keeps no state a restart could lose
 * except the screenshot pacing clock.
 */
import { MSG, TIMING, CAPS, PACKS, DOCUMENT_EXTENSIONS } from '../shared/constants.js';
import * as store from './lib/store.js';
import * as origins from './lib/origins.js';
import { buildTransition, gapBetween, routeOf, viewKeyOf } from './lib/transitions.js';
import { detectDependency, isDuplicateDependency } from './lib/deps.js';
import { runExport, getExportProgress } from './lib/export.js';
import { buildSiteMap } from './lib/sitemap.js';
import { buildCoverage } from './lib/coverage.js';

/** @typedef {import('../shared/schema.js').StateDraft} StateDraft */
/** @typedef {import('../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../shared/schema.js').NetDraft} NetDraft */
/** @typedef {import('../shared/schema.js').Stats} Stats */
/** @typedef {import('../shared/schema.js').PanelRow} PanelRow */
/** @typedef {import('../shared/schema.js').OriginInfo} OriginInfo */
/** @typedef {import('../shared/schema.js').SessionMeta} SessionMeta */
/** @typedef {import('../shared/schema.js').ActionDraft} ActionDraft */
/** @typedef {import('../shared/schema.js').ActionEntry} ActionEntry */
/** @typedef {import('../shared/schema.js').DownloadEntry} DownloadEntry */
/** @typedef {import('../shared/schema.js').NetEntry} NetEntry */
/** @typedef {import('../shared/schema.js').OpenedFrom} OpenedFrom */
/** @typedef {import('../shared/schema.js').TabInfo} TabInfo */
/** @typedef {import('../shared/schema.js').TabMap} TabMap */
/** @typedef {import('../shared/schema.js').HeaderPair} HeaderPair */
/** @typedef {import('../shared/schema.js').CoverageReply} CoverageReply */

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

/**
 * @param {string|null} origin
 * @returns {TabInfo}
 */
const blankTab = (origin) => ({ lastStateId: null, lastSignature: null, lastErrorsKey: null, lastAt: null, origin });

/**
 * Every frame of one tab that has bookkeeping.
 * @param {TabMap} tabs
 * @param {number} tabId
 * @returns {{ key: string, frameId: number, info: TabInfo }[]}
 */
function framesOf(tabs, tabId) {
  const prefix = `${tabId}:`;
  return Object.keys(tabs)
    .filter((k) => k.startsWith(prefix))
    .map((k) => ({ key: k, frameId: Number(k.slice(prefix.length)) || 0, info: tabs[k] }));
}

/**
 * @param {string|null|undefined} iso
 * @returns {number}   epoch ms, NaN when unparseable
 */
const ms = (iso) => (typeof iso === 'string' ? Date.parse(iso) : NaN);

/**
 * @param {unknown} iso
 * @returns {string}   the timestamp when it parses, else now
 */
const isoOrNow = (iso) => (typeof iso === 'string' && Number.isFinite(Date.parse(iso)) ? iso : new Date().toISOString());

// ------------------------------------------------------------ url scrub
// The redaction packs live in the content world and cannot be loaded here.
// Download URLs and file names reach the worker straight from the browser,
// so they get this small, pattern-free scrub instead: query values and
// fragments go, identifier-shaped path segments become `{id}`, and a file
// name is reduced to its shape. It knows nothing about any site or country.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extensions kept as written. A dot followed by anything else is treated as
 * part of the name, because the tail of `statement.surname` is not a type.
 */
const KNOWN_EXTENSIONS = new Set([
  ...DOCUMENT_EXTENSIONS,
  'htm', 'html', 'md', 'tsv', 'log', 'ics', 'vcf', 'eml', 'msg', 'epub', 'odp', 'xlsm', 'xlsb', 'docm', 'pptm',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tif', 'tiff', 'mp3', 'mp4', 'wav', 'webm', 'mov', 'avi',
  'gz', 'tar', 'tgz', '7z', 'rar', 'bin', 'dat', 'exe', 'msi', 'dmg', 'apk',
]);

/**
 * @param {string} name   a file name or a path segment
 * @returns {{ stem: string, ext: string|null }}
 */
function splitExtension(name) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  const ext = m ? m[1].toLowerCase() : null;
  if (!m || !ext || !KNOWN_EXTENSIONS.has(ext)) return { stem: name, ext: null };
  return { stem: name.slice(0, m.index), ext };
}

/**
 * @param {string} seg   one path segment, still percent-encoded
 * @returns {string}
 */
function scrubSegment(seg) {
  if (!seg) return seg;
  let plain = seg;
  try {
    plain = decodeURIComponent(seg);
  } catch {
    /* keep the encoded form */
  }
  const { stem, ext } = splitExtension(plain);
  const idLike =
    /\d{6,}/.test(stem) ||
    UUID_RE.test(stem) ||
    /^[0-9a-f]{16,}$/i.test(stem) ||
    // base64url shares its alphabet with ordinary words; a digit tells them apart
    (/^[A-Za-z0-9_-]{16,}$/.test(stem) && /\d/.test(stem));
  return idLike ? `{id}${ext ? '.' + ext : ''}` : seg;
}

/**
 * Origin plus path, with identifier-shaped segments replaced. No query, no
 * fragment — except, when asked, the path part of a routing fragment.
 * @param {string} url
 * @param {boolean} [keepRoute]   keep `#/…` or `#!/…` up to its `?`
 * @returns {string|null}   null for anything that is not http(s)
 */
function scrubUrl(url, keepRoute = false) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const path = u.pathname.split('/').map(scrubSegment).join('/');
    let frag = '';
    if (keepRoute && /^#!?\//.test(u.hash)) frag = u.hash.split('?')[0].split('/').map(scrubSegment).join('/');
    return u.origin + path + frag;
  } catch {
    return null;
  }
}

/**
 * @param {string} url
 * @returns {string}   everything before the query and the fragment
 */
const withoutQuery = (url) => String(url).split('#')[0].split('?')[0];

/**
 * Parameter names only, sorted.
 * @param {string} url
 * @returns {string[]}
 */
function queryKeysOf(url) {
  try {
    const names = Array.from(new URL(url).searchParams.keys()).map((k) => k.slice(0, 80));
    return Array.from(new Set(names)).sort().slice(0, 40);
  } catch {
    return [];
  }
}

/**
 * docs/12 B6: the structure of a file name with the name taken out. Runs of
 * letters become `A{n}`, runs of digits `9{n}`, everything else stays.
 * @param {string} path   a file name, or a local path whose directories are discarded
 * @returns {{ nameShape: string, extension: string|null }}
 */
function nameShapeOf(path) {
  const base = String(path || '').split(/[\\/]/).pop() || '';
  const { stem, ext } = splitExtension(base);
  // Combining marks belong to the letter they sit on.
  const shape = stem.replace(/[\p{L}\p{M}]+|\p{N}+/gu, (run) => `${/^\p{N}/u.test(run) ? '9' : 'A'}{${Array.from(run).length}}`);
  return { nameShape: shape + (ext ? '.' + ext : ''), extension: ext };
}

/**
 * content-disposition without its file name. The hook already does this;
 * the worker is the last point before storage, so it does not rely on that.
 * @param {HeaderPair[]} headers
 * @returns {HeaderPair[]}
 */
function withoutFileNames(headers) {
  if (!Array.isArray(headers)) return [];
  return headers.map((h) => {
    if (!h || typeof h.name !== 'string' || h.name.toLowerCase() !== 'content-disposition') return h;
    const raw = String(h.value || '');
    const first = raw.split(';')[0].trim().toLowerCase();
    const named = /filename/i.test(raw);
    const m = /\.([A-Za-z0-9]{1,8})["'\s]*$/.exec(raw);
    const ext = m && KNOWN_EXTENSIONS.has(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
    return { name: h.name, value: (/^[a-z-]+$/.test(first) ? first : 'unknown') + (named ? `; filename=<redacted>${ext ? '.' + ext : ''}` : '') };
  });
}

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
    keepBodies: meta.keepBodies,
  };
}

/**
 * The origin of the frame that sent a message, from what the browser says
 * about the sender rather than from what the message claims.
 * @param {chrome.runtime.MessageSender} sender
 * @returns {string|null}
 */
const frameOriginOf = (sender) => origins.originOf(sender.url || '') || origins.originOf(sender.origin || '') || topOriginOf(sender);

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

/** A click reaches the worker a moment before or after the tab it opened; this much disorder is tolerated. */
const OPEN_SLACK_MS = 250;

/**
 * True when `at` falls inside the `windowMs` that end at `when`.
 * @param {number} at
 * @param {number} when
 * @param {number} windowMs
 * @param {number} [slackMs]   how far after `when` still counts
 */
const within = (at, when, windowMs, slackMs = 0) => Number.isFinite(at) && Number.isFinite(when) && at <= when + slackMs && when - at <= windowMs;

/**
 * docs/12 B4: the actions of one document that no state has claimed yet.
 * Actions from before a pause are left alone — the state after a resume did
 * not follow from them (A8).
 * @param {ActionEntry[]} actions
 * @param {number} tabId
 * @param {number} frameId
 * @param {string} capturedAt
 * @param {SessionMeta} meta
 * @returns {ActionEntry[]}
 */
function unclaimedActions(actions, tabId, frameId, capturedAt, meta) {
  const limit = ms(capturedAt);
  return actions.filter((a) => {
    if (a.tabId !== tabId || a.frameId !== frameId || a.resultStateId != null) return false;
    const at = ms(a.at);
    if (Number.isFinite(at) && Number.isFinite(limit) && at > limit) return false;
    return !gapBetween(meta.timeline, a.at, capturedAt);
  });
}

/**
 * docs/12 B4: which action opened this tab, looked up when the tab's first
 * state lands rather than when the tab appeared — by then the click has
 * certainly been stored, whichever of the two reached the worker first.
 * @param {ActionEntry[]} actions
 * @param {OpenedFrom} link
 * @param {string|null} createdAt   when the tab appeared
 * @returns {ActionEntry|null}
 */
function openingAction(actions, link, createdAt) {
  if (link.actionId) return actions.find((a) => a.id === link.actionId) || null;
  const when = ms(createdAt);
  const near = actions.filter((a) => a.tabId === link.tabId && within(ms(a.at), when, TIMING.ACTION_NET_WINDOW_MS, OPEN_SLACK_MS));
  const clicks = near.filter((a) => a.kind === 'click');
  const pool = clicks.length ? clicks : near;
  return pool.length ? pool[pool.length - 1] : null;
}

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
    const info = tabs[key] || blankTab(null);
    const errorsKey = draft.errors.join(' | ');
    const sameAsLast = info.lastSignature === draft.signature && info.lastErrorsKey === errorsKey;

    // A re-injected content script re-sends `load` for a page already stored.
    if (draft.trigger === 'load' && sameAsLast) return { skipped: 'duplicate' };

    // docs/12 B4: what the user did since the previous state of this document.
    const actions = await store.getActions();
    const claimed = unclaimedActions(actions, tabId, frameId, draft.capturedAt, meta);
    const claimedIds = claimed.map((a) => a.id);
    const matching = claimed.filter((a) => a.trigger === draft.trigger);
    const primary = matching.length ? matching[matching.length - 1] : claimed.length ? claimed[claimed.length - 1] : null;

    // docs/12 B4: the first state of a tab that a recorded tab opened.
    /** @type {OpenedFrom|null} */
    let openedFrom = null;
    /** @type {ActionEntry|null} */
    let opener = null;
    if (info.openedFrom && !info.lastStateId) {
      opener = openingAction(actions, info.openedFrom, info.lastAt);
      openedFrom = {
        tabId: info.openedFrom.tabId,
        stateId: (opener && opener.stateIdAtTime) || info.openedFrom.stateId,
        actionId: opener ? opener.id : null,
      };
    }

    const blocked = meta.blockedFrames[String(tabId)] || [];
    const actionIds = opener && !claimedIds.includes(opener.id) ? [opener.id, ...claimedIds] : claimedIds;
    const state = await store.addState(draft, dom, tabId, frameId, blocked, { actionIds, openedFrom });
    if (!state) return { skipped: 'storage exhausted' };

    if (draft.trigger === 'manual' && sameAsLast && info.lastStateId) {
      state.duplicateOf = info.lastStateId;
      await store.updateState(state.id, { duplicateOf: info.lastStateId });
    }
    if (claimedIds.length) await store.patchActions(claimedIds, { resultStateId: state.id });

    // A8: no edge across a pause/resume, a session clear, or a different tab.
    const prevOk = info.lastStateId && info.lastAt && info.origin === draft.origin && !gapBetween(meta.timeline, info.lastAt, state.capturedAt);
    const needStates = prevOk || (openedFrom && openedFrom.stateId);
    const states = needStates ? await store.getStates() : [];
    if (prevOk) {
      const prev = states.find((s) => s.id === info.lastStateId);
      if (prev) {
        const net = await store.getNet();
        const between = net.filter((n) => n.tabId === tabId && n.stateIdAtTime === prev.id);
        const edge = buildTransition(prev, state, between, { actionIds: claimedIds, actionId: primary ? primary.id : null });
        await store.addTransition(edge);
        if (between.length) await store.updateState(state.id, { netRefs: between.map((n) => n.id) });
        const dep = detectDependency(state, edge, between);
        if (dep && !isDuplicateDependency(await store.getDeps(), dep)) await store.addDep(dep);
      }
    }

    // docs/12 B4: the one edge that may cross tabs. A8 still holds: nothing
    // is drawn across a pause, and nothing when the opener's state is gone.
    if (openedFrom && openedFrom.stateId) {
      const from = states.find((s) => s.id === openedFrom.stateId);
      if (from && !gapBetween(meta.timeline, from.capturedAt, state.capturedAt)) {
        await store.addTransition(buildTransition(from, state, [], { actionIds: opener ? [opener.id] : [], actionId: opener ? opener.id : null, viaNewTab: true }));
        // The click's own tab may never change; then this state is its result.
        if (opener && opener.resultStateId == null && !claimedIds.includes(opener.id)) await store.patchActions([opener.id], { resultStateId: state.id });
      }
    }

    tabs[key] = {
      ...info,
      lastStateId: state.id,
      lastSignature: state.signature,
      lastErrorsKey: errorsKey,
      lastAt: state.capturedAt,
      origin: draft.origin,
      lastRoute: routeOf(state),
      openedFrom: null,
    };
    await store.setTabs(tabs);

    const shoot = meta.screenshots && !meta.degraded.screenshots && !draft.inIframe && tabId >= 0;
    return { id: state.id, shoot };
  });

  if ('shoot' in result && result.shoot) await enqueueScreenshot(result.id, windowId);
  return result;
}

/**
 * docs/12 B4: stored the moment it happens, whether or not a state follows.
 * @param {ActionDraft} draft
 * @param {chrome.runtime.MessageSender} sender
 */
async function onAction(draft, sender) {
  const tabId = sender.tab?.id ?? -1;
  const frameId = sender.frameId ?? 0;
  if (!draft || typeof draft !== 'object' || typeof draft.origin !== 'string' || typeof draft.trigger !== 'string') return { skipped: 'malformed' };
  if (!(await origins.isConsented(draft.origin))) return { skipped: 'not consented' };

  return store.withLock(async () => {
    const meta = await store.getMeta();
    if (!meta.recording) return { skipped: 'paused' };
    const tabs = await store.getTabs();
    const key = tabKey(tabId, frameId);
    const own = tabs[key];
    const top = tabs[tabKey(tabId, 0)];
    const stateIdAtTime = (own && own.lastStateId) || (top && top.lastStateId) || null;
    const saved = await store.addAction({ ...draft, at: isoOrNow(draft.at) }, tabId, frameId, stateIdAtTime);
    tabs[key] = { ...(own || blankTab(draft.origin)), lastActionId: saved.id, lastActionAt: saved.at };
    await store.setTabs(tabs);
    return { id: saved.id };
  });
}

/**
 * docs/12 B6: the latest createObjectURL or window.open seen in a document,
 * kept until the download or the tab it belongs to turns up.
 * @param {'blob'|'open'} kind
 * @param {Record<string, any>} msg
 * @param {chrome.runtime.MessageSender} sender
 */
async function onHint(kind, msg, sender) {
  const tabId = sender.tab?.id ?? -1;
  const frameId = sender.frameId ?? 0;
  const origin = frameOriginOf(sender);
  if (!origin || !(await origins.isConsented(origin))) return { skipped: 'not consented' };
  const src = msg && msg.hint && typeof msg.hint === 'object' ? msg.hint : msg || {};

  return store.withLock(async () => {
    const meta = await store.getMeta();
    if (!meta.recording) return { skipped: 'paused' };
    const tabs = await store.getTabs();
    const key = tabKey(tabId, frameId);
    const info = { ...(tabs[key] || blankTab(origin)) };
    if (kind === 'blob') {
      const size = Number(src.size);
      info.blobHint = { mime: String(src.mime || '').slice(0, 100), size: Number.isFinite(size) && size >= 0 ? size : -1, at: isoOrNow(src.at) };
    } else {
      info.openHint = {
        url: typeof src.url === 'string' ? scrubUrl(src.url, true) : null,
        target: src.target == null ? null : String(src.target).slice(0, 80),
        at: isoOrNow(src.at),
      };
    }
    tabs[key] = info;
    await store.setTabs(tabs);
    return { ok: true };
  });
}

/**
 * docs/12 B5: the last action in the tab in the window before the call began.
 * The tab bookkeeping answers almost always; the action log is read only
 * when a later action has already replaced the one that was current then.
 * @param {TabMap} tabs
 * @param {number} tabId
 * @param {string} startedAt
 * @returns {Promise<string|null>}
 */
async function actionBefore(tabs, tabId, startedAt) {
  const when = ms(startedAt);
  if (!Number.isFinite(when)) return null;
  /** @type {{ id: string, at: number }|null} */
  let best = null;
  let newer = false;
  for (const f of framesOf(tabs, tabId)) {
    const at = ms(f.info.lastActionAt);
    if (!f.info.lastActionId || !Number.isFinite(at)) continue;
    if (at > when) newer = true;
    else if (within(at, when, TIMING.ACTION_NET_WINDOW_MS) && (!best || at > best.at)) best = { id: f.info.lastActionId, at };
  }
  if (!newer) return best ? best.id : null;
  const log = (await store.getActions()).filter((a) => a.tabId === tabId && within(ms(a.at), when, TIMING.ACTION_NET_WINDOW_MS));
  return log.length ? log[log.length - 1].id : best ? best.id : null;
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
    const actionId = await actionBefore(tabs, tabId, entry.startedAt);
    const ext = typeof entry.dispositionExt === 'string' ? entry.dispositionExt.toLowerCase() : null;
    /** @type {NetDraft} */
    const clean = {
      ...entry,
      responseHeaders: withoutFileNames(entry.responseHeaders),
      dispositionExt: ext && KNOWN_EXTENSIONS.has(ext) ? ext : null,
    };
    // store.addNet keeps a full body only while the setting asks for one.
    const saved = await store.addNet(clean, tabId, frameId, info?.lastStateId ?? null, !own && !!topInfo, actionId);
    return { id: saved.id };
  });
}

// ------------------------------------------------------------- new tabs
// docs/12 B4. A click that opens a tab used to end the chain. The link is
// written into fp:tabs the moment the tab appears, under the new tab's top
// frame, so it is still there if the worker sleeps before the page loads.

/**
 * The document in the opener tab that most likely opened the new one: the
 * frame that just called window.open, else the frame that was just clicked,
 * else the top frame.
 * @param {TabMap} tabs
 * @param {number} openerTabId
 * @param {string[]} consented
 * @param {number} now
 * @returns {{ key: string, info: TabInfo }|null}
 */
function openerFrame(tabs, openerTabId, consented, now) {
  const frames = framesOf(tabs, openerTabId).filter((f) => f.info.lastStateId && f.info.origin && consented.includes(f.info.origin));
  if (!frames.length) return null;
  /** @param {(i: TabInfo) => number} when */
  const latest = (when) =>
    frames
      .filter((f) => within(when(f.info), now, TIMING.ACTION_NET_WINDOW_MS, OPEN_SLACK_MS))
      .sort((a, b) => when(b.info) - when(a.info))[0] || null;
  return latest((i) => ms(i.openHint ? i.openHint.at : null)) || latest((i) => ms(i.lastActionAt)) || frames.find((f) => f.frameId === 0) || frames[0];
}

/**
 * @param {chrome.tabs.Tab} tab
 */
async function onTabCreated(tab) {
  const tabId = tab.id;
  const openerTabId = tab.openerTabId;
  if (tabId == null || openerTabId == null) return;
  // A blank new-tab page also names the tab it was opened from. Only a tab
  // that starts on a web page, or empty for a script to fill, was opened by
  // the page.
  const start = tab.pendingUrl || tab.url || '';
  if (start && start !== 'about:blank' && !/^(https?|blob):/i.test(start)) return;

  const consented = await origins.listOrigins();
  if (!consented.length) return;
  await store.withLock(async () => {
    const meta = await store.getMeta();
    if (!meta.recording) return;
    const tabs = await store.getTabs();
    const from = openerFrame(tabs, openerTabId, consented, Date.now());
    if (!from) return;
    // `lastAt` holds the moment the tab appeared until its first state
    // replaces it; with no lastStateId nothing reads it as a state's time.
    tabs[tabKey(tabId, 0)] = {
      ...blankTab(null),
      lastAt: new Date().toISOString(),
      openedFrom: { tabId: openerTabId, stateId: from.info.lastStateId, actionId: null },
    };
    if (from.info.openHint) tabs[from.key] = { ...from.info, openHint: null };
    await store.setTabs(tabs);
  });
}

/**
 * @param {number} tabId
 */
async function onTabRemoved(tabId) {
  await store.withLock(async () => {
    const tabs = await store.getTabs();
    const gone = framesOf(tabs, tabId);
    if (!gone.length) return;
    for (const f of gone) delete tabs[f.key];
    await store.setTabs(tabs);
  });
}

// Registered at the top level so a sleeping worker is woken for them (A4).
chrome.tabs.onCreated.addListener((tab) => void onTabCreated(tab).catch(() => {}));
chrome.tabs.onRemoved.addListener((tabId) => void onTabRemoved(tabId).catch(() => {}));

// ------------------------------------------------------------ downloads
// docs/12 B6. Only what the browser reports about a download is recorded:
// where it came from, what type and size it is, and the shape of its name.
// The file itself is never opened, and its name and path are never stored.

/** Downloads the browser re-announces at start-up are older than any click that could explain them. */
const DOWNLOAD_STALE_MS = 60000;

/**
 * Documents in consented tabs where the user acted shortly before `when`,
 * most recent first.
 * @param {TabMap} tabs
 * @param {string[]} consented
 * @param {number} when
 * @returns {{ key: string, tabId: number, info: TabInfo, at: number }[]}
 */
function recentActors(tabs, consented, when) {
  return Object.keys(tabs)
    .map((key) => ({ key, tabId: Number(key.split(':')[0]), info: tabs[key], at: ms(tabs[key].lastActionAt) }))
    .filter((f) => f.info.lastActionId && f.info.origin && consented.includes(f.info.origin) && within(f.at, when, TIMING.ACTION_DOWNLOAD_WINDOW_MS, 1000))
    .sort((a, b) => b.at - a.at);
}

/**
 * The call that fetched the file: the latest one to the same address, or
 * for a blob, the latest one in that tab that came back as a download.
 * @param {NetEntry[]} net
 * @param {string} rawUrl
 * @param {'http'|'blob'|'data'} kind
 * @param {number} tabId
 * @param {number} when
 * @returns {string|null}
 */
function matchingCall(net, rawUrl, kind, tabId, when) {
  if (kind === 'http') {
    const plain = withoutQuery(rawUrl);
    const scrubbed = scrubUrl(rawUrl);
    for (let i = net.length - 1; i >= 0; i--) {
      // Stored addresses went through the redaction packs, so compare both ways.
      if (withoutQuery(net[i].url) === plain || (scrubbed && scrubUrl(net[i].url) === scrubbed)) return net[i].id;
    }
    return null;
  }
  if (kind !== 'blob' || tabId < 0) return null;
  for (let i = net.length - 1; i >= 0; i--) {
    const n = net[i];
    if (n.tabId === tabId && n.isDownload && within(ms(n.startedAt), when, TIMING.ACTION_DOWNLOAD_WINDOW_MS, 1000)) return n.id;
  }
  return null;
}

/**
 * The final values of a download as the browser reports them now. File name
 * becomes its shape; nothing else of the name is kept.
 * @param {chrome.downloads.DownloadItem} item
 * @param {DownloadEntry} entry   what is stored, so known values are not blanked
 * @returns {Partial<DownloadEntry>}
 */
function patchFromItem(item, entry) {
  /** @type {Partial<DownloadEntry>} */
  const patch = {};
  if (item.state === 'complete' || item.state === 'interrupted') patch.state = item.state;
  if (item.filename) {
    const named = nameShapeOf(item.filename);
    if (named.nameShape) patch.nameShape = named.nameShape;
    if (named.extension) patch.extension = named.extension;
  }
  if (item.mime && !entry.mime) patch.mime = String(item.mime).slice(0, 100);
  const bytes = item.fileSize > 0 ? item.fileSize : item.state === 'complete' && item.totalBytes > 0 ? item.totalBytes : 0;
  if (bytes > 0) patch.sizeBytes = bytes;
  return patch;
}

/**
 * @param {number} browserId
 * @returns {Promise<chrome.downloads.DownloadItem|null>}
 */
async function searchDownload(browserId) {
  try {
    const [item] = await chrome.downloads.search({ id: browserId });
    return item || null;
  } catch {
    return null;
  }
}

/** Upper bound on waiting for a blob hint that is still in flight. */
const BLOB_HINT_WAIT_MS = 1000;

/**
 * The createObjectURL hint and the download it belongs to race: the page
 * makes the blob, clicks, and the browser's onCreated can beat the hint's
 * message to the lock. Wait a little for it, outside the lock so the hint
 * can land. Read-only.
 * @param {string[]} consented
 * @param {number} when
 */
async function awaitBlobHint(consented, when) {
  const until = Date.now() + BLOB_HINT_WAIT_MS;
  for (;;) {
    const tabs = await store.getTabs();
    const hinted = Object.values(tabs).some(
      (i) => i && i.blobHint && i.origin && consented.includes(i.origin) && within(ms(i.blobHint.at), when, TIMING.ACTION_DOWNLOAD_WINDOW_MS, 1000),
    );
    if (hinted || Date.now() >= until) return;
    await sleep(100);
  }
}

/**
 * @param {chrome.downloads.DownloadItem} item
 */
async function onDownloadCreated(item) {
  if (!item || item.byExtensionId === chrome.runtime.id) return;
  const rawUrl = String(item.finalUrl || item.url || '');
  // The export zip is written from an extension page; belt and braces.
  if (rawUrl.includes(`chrome-extension://${chrome.runtime.id}`)) return;
  /** @type {'http'|'blob'|'data'|null} */
  const kind = /^https?:/i.test(rawUrl) ? 'http' : /^blob:/i.test(rawUrl) ? 'blob' : /^data:/i.test(rawUrl) ? 'data' : null;
  if (!kind) return;
  const started = ms(item.startTime);
  const when = Number.isFinite(started) ? started : Date.now();
  if (Date.now() - when > DOWNLOAD_STALE_MS) return;

  const consented = await origins.listOrigins();
  if (!consented.length) return;
  const urlOrigin = kind === 'http' ? origins.originOf(rawUrl) : null;
  const refOrigin = origins.originOf(item.referrer || '');
  // A blob address carries the origin of the document that made it.
  const blobOrigin = kind === 'blob' ? origins.originOf(rawUrl.slice(5)) : null;
  /** @param {string|null} o */
  const ok = (o) => !!o && consented.includes(o);

  if (kind === 'blob') await awaitBlobHint(consented, when);

  await store.withLock(async () => {
    const meta = await store.getMeta();
    if (!meta.recording) return;
    const tabs = await store.getTabs();
    const actors = recentActors(tabs, consented, when);

    // The rule in docs/12 B6. One thing is added for blobs: when the address
    // names an origin, that origin must itself be consented — a click on a
    // recorded site is no licence to log a file another site produced.
    const byAddress = ok(urlOrigin) || ok(refOrigin);
    const byAction = kind !== 'http' && actors.length > 0 && (!blobOrigin || ok(blobOrigin));
    if (!byAddress && !byAction) return;

    const preferred = [refOrigin, urlOrigin, blobOrigin].filter(ok);
    let actor = actors.find((f) => preferred.includes(f.info.origin)) || (byAction || !preferred.length ? actors[0] : null) || null;
    let actionId = actor ? actor.info.lastActionId || null : null;
    if (!actor && preferred.length) {
      // Nobody clicked in time. The tab on that origin with the latest
      // state is still the likeliest source, but no action is claimed.
      const idle = Object.keys(tabs)
        .map((key) => ({ key, tabId: Number(key.split(':')[0]), info: tabs[key], at: ms(tabs[key].lastAt) }))
        .filter((f) => f.info.lastStateId && preferred.includes(f.info.origin) && Number.isFinite(f.at))
        .sort((a, b) => b.at - a.at)[0];
      actor = idle || null;
      actionId = null;
    }
    const origin = (actor && actor.info.origin) || preferred[0] || null;
    if (!origin) return;

    const tabId = actor ? actor.tabId : -1;
    const topInfo = actor ? tabs[tabKey(tabId, 0)] : undefined;
    const stateIdAtTime = actor ? actor.info.lastStateId || (topInfo && topInfo.lastStateId) || null : null;
    const route = actor ? actor.info.lastRoute || (topInfo && topInfo.lastRoute) || null : null;

    /** @type {DownloadEntry['blob']} */
    let blob = null;
    if (kind === 'blob' && actor) {
      const hinted = framesOf(tabs, tabId)
        .filter((f) => f.info.blobHint && within(ms(f.info.blobHint.at), when, TIMING.ACTION_DOWNLOAD_WINDOW_MS, 1000))
        .sort((a, b) => ms(b.info.blobHint?.at) - ms(a.info.blobHint?.at))[0];
      if (hinted && hinted.info.blobHint) {
        blob = { mime: hinted.info.blobHint.mime, size: hinted.info.blobHint.size };
        tabs[hinted.key] = { ...hinted.info, blobHint: null };
        await store.setTabs(tabs);
      }
    }

    const named = item.filename ? nameShapeOf(item.filename) : { nameShape: '', extension: null };
    const fromUrl = kind === 'http' ? splitExtension(withoutQuery(rawUrl).split('/').pop() || '').ext : null;
    const size = item.totalBytes > 0 ? item.totalBytes : item.fileSize > 0 ? item.fileSize : blob && blob.size > 0 ? blob.size : -1;

    const saved = await store.addDownload({
      at: isoOrNow(item.startTime),
      origin,
      urlKind: kind,
      url: kind === 'http' ? scrubUrl(rawUrl) : null,
      queryKeys: kind === 'http' ? queryKeysOf(rawUrl) : [],
      mime: String(item.mime || (blob ? blob.mime : '') || '').slice(0, 100),
      extension: named.extension || fromUrl,
      nameShape: named.nameShape,
      sizeBytes: size,
      state: item.state === 'complete' || item.state === 'interrupted' ? item.state : 'in_progress',
      tabId,
      route,
      stateIdAtTime,
      actionId,
      netId: matchingCall(await store.getNet(), rawUrl, kind, tabId, when),
      blob,
    });

    if (saved.state !== 'in_progress') return;
    // Deltas that fired before this point found no map entry and were not
    // applied; the item as it stands now carries all of them.
    const now = await searchDownload(item.id);
    const patch = now ? patchFromItem(now, saved) : {};
    if (Object.keys(patch).length) await store.patchDownload(saved.id, patch);
    if (patch.state) return;
    const map = await store.getDownloadMap();
    map[String(item.id)] = saved.id;
    await store.setDownloadMap(map);
  });
}

/**
 * All of it runs under the lock: the map entry is written by onCreated under
 * the same lock, so reading it earlier would drop deltas for downloads that
 * finish fast. A delta that still finds no entry is not lost: onCreated reads
 * the item's current state after saving, which includes it.
 * @param {chrome.downloads.DownloadDelta} delta
 */
async function onDownloadChanged(delta) {
  if (!delta || typeof delta.id !== 'number') return;
  const consented = await origins.listOrigins();

  await store.withLock(async () => {
    const map = await store.getDownloadMap();
    const id = map[String(delta.id)];
    if (!id) return;
    const entry = (await store.getDownloads()).find((d) => d.id === id);
    const settled = !!delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted');
    /** Forget the link once nothing more can arrive for it. */
    const forget = async () => {
      delete map[String(delta.id)];
      await store.setDownloadMap(map);
    };
    if (!entry) return forget();

    // Paused means paused (Q18), and a removed origin stops at once.
    const meta = await store.getMeta();
    if (!meta.recording || !consented.includes(entry.origin)) {
      if (settled) await forget();
      return;
    }

    /** @type {Partial<DownloadEntry>} */
    let patch = {};
    if (delta.filename && delta.filename.current) {
      const named = nameShapeOf(delta.filename.current);
      patch.nameShape = named.nameShape;
      if (named.extension) patch.extension = named.extension;
    }
    if (delta.mime && delta.mime.current) patch.mime = String(delta.mime.current).slice(0, 100);
    const bytes = Math.max(Number(delta.fileSize?.current) || 0, Number(delta.totalBytes?.current) || 0);
    if (bytes > 0) patch.sizeBytes = bytes;
    if (settled && delta.state) {
      patch.state = /** @type {'complete'|'interrupted'} */ (delta.state.current);
      // The final size and name are on the item, not always in the delta.
      const item = await searchDownload(delta.id);
      if (item) patch = { ...patch, ...patchFromItem(item, entry), state: patch.state };
    }
    if (Object.keys(patch).length) await store.patchDownload(id, patch);
    if (settled) await forget();
  });
}

/**
 * Before an export: any entry still in progress is looked up by its browser
 * id and given its final state, size, type and name shape. Covers events the
 * worker slept through or missed.
 */
async function reconcileDownloads() {
  const consented = await origins.listOrigins();
  await store.withLock(async () => {
    const map = await store.getDownloadMap();
    const list = await store.getDownloads();
    /** @type {Map<string, string>} dl_ id → browser id */
    const browserIdOf = new Map(Object.keys(map).map((k) => [map[k], k]));
    let changed = false;
    for (const entry of list) {
      if (entry.state !== 'in_progress' || !consented.includes(entry.origin)) continue;
      const browserId = Number(browserIdOf.get(entry.id));
      if (!Number.isInteger(browserId)) continue;
      const item = await searchDownload(browserId);
      if (!item) continue;
      const patch = patchFromItem(item, entry);
      if (Object.keys(patch).length) await store.patchDownload(entry.id, patch);
      if (patch.state) {
        delete map[String(browserId)];
        changed = true;
      }
    }
    if (changed) await store.setDownloadMap(map);
  });
}

// Registered at the top level so a sleeping worker is woken for them (A4).
chrome.downloads.onCreated.addListener((item) => void onDownloadCreated(item).catch(() => {}));
chrome.downloads.onChanged.addListener((delta) => void onDownloadChanged(delta).catch(() => {}));

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
    actions: meta.actionCount,
    downloads: meta.downloadCount,
    keepBodies: meta.keepBodies,
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
      route: routeOf(s),
      viewKey: viewKeyOf(s),
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

/**
 * docs/12 B9: what the recording has and has not touched on one origin. The
 * panel renders the reply and computes nothing itself.
 *
 * The panel works out `route` from the tab's address and cannot run the
 * redaction packs, while recorded routes went through them, so the two can
 * differ. The route of the last state stored in that tab is therefore
 * preferred whenever the tab is known.
 * @param {{ origin?: string, route?: string, tabId?: number }} msg
 * @returns {Promise<CoverageReply>}
 */
async function onGetCoverage(msg) {
  try {
    const origin = origins.originOf((msg && msg.origin) || '') || String((msg && msg.origin) || '');
    if (!origin) return { ok: false, coverage: null, page: null };

    let route = msg && typeof msg.route === 'string' ? msg.route : '';
    if (msg && typeof msg.tabId === 'number') {
      const top = (await store.getTabs())[tabKey(msg.tabId, 0)];
      if (top && top.origin === origin && typeof top.lastRoute === 'string' && top.lastRoute) route = top.lastRoute;
    }

    const states = (await store.getStates()).filter((s) => s.origin === origin);
    const ids = new Set(states.map((s) => s.id));
    const actions = (await store.getActions()).filter((a) => a.origin === origin);
    const downloads = (await store.getDownloads()).filter((d) => d.origin === origin);
    const net = (await store.getNet()).filter((n) => origins.originOf(n.pageUrl || '') === origin);
    // Same split as the export: an edge belongs to the origin both its ends are on.
    const transitions = (await store.getTransitions()).filter((t) => ids.has(t.from) && ids.has(t.to));

    const siteMap = buildSiteMap(states, actions, transitions, downloads, net, origin);
    const coverage = buildCoverage(siteMap, states, actions, downloads, origin);
    const page = coverage.pages.find((p) => p.route === route) || null;
    return { ok: true, coverage, page };
  } catch (e) {
    console.warn('[flowprint] coverage failed:', e instanceof Error ? e.message : String(e));
    return { ok: false, coverage: null, page: null };
  }
}

/**
 * docs/12 B5: full bodies are opt-in. Anything but an explicit 'full' (or a
 * checked box) is the default.
 * @param {Record<string, unknown>} msg
 */
async function onSetKeepBodies(msg) {
  const asked = msg.keepBodies ?? msg.value ?? msg.mode ?? msg.on;
  /** @type {'shape'|'full'} */
  const keepBodies = asked === 'full' || asked === true ? 'full' : 'shape';
  const meta = await store.withLock(() => store.setMeta({ keepBodies }));
  return { ok: true, keepBodies: meta.keepBodies };
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
    case MSG.ACTION:
      return reply(onAction(msg.action || msg.draft || msg.entry, sender));
    case MSG.BLOB_HINT:
      return reply(onHint('blob', msg, sender));
    case MSG.WINDOW_OPEN:
      return reply(onHint('open', msg, sender));
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
    case MSG.SET_KEEP_BODIES:
      return reply(onSetKeepBodies(msg));
    case MSG.GET_COVERAGE:
      return reply(onGetCoverage(msg));
    case MSG.CAPTURE_NOW:
      return reply(onCaptureNow());
    case MSG.EXPORT:
      return reply(reconcileDownloads().catch(() => {}).then(() => runExport()));
    case MSG.CLEAR:
      return reply(store.withLock(() => store.clearAll()).then(() => ({ ok: true })));
    default:
      return false;
  }
});
