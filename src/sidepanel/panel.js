/**
 * Side panel — docs/04. Polls the worker; never reads storage itself. The
 * panel only ever sees PanelRow shapes and counters, never selectors,
 * snapshots or bodies. Consent lives here: "Record this site" is the only
 * way an origin enters the allow-list.
 */
import { MSG, TIMING, TOOL_VERSION } from '../shared/constants.js';

/** @typedef {import('../shared/schema.js').Stats} Stats */
/** @typedef {import('../shared/schema.js').PanelRow} PanelRow */
/** @typedef {import('../shared/schema.js').OriginInfo} OriginInfo */

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`panel: missing #${id}`);
  return el;
};

const ui = {
  recDot: $('recDot'),
  recStatus: $('recStatus'),
  version: $('version'),
  originName: $('originName'),
  btnStop: /** @type {HTMLButtonElement} */ ($('btnStop')),
  consentBlock: $('consentBlock'),
  btnConsent: /** @type {HTMLButtonElement} */ ($('btnConsent')),
  otherOrigins: $('otherOrigins'),
  blockedFrames: $('blockedFrames'),
  cStates: $('cStates'),
  cNet: $('cNet'),
  cLists: $('cLists'),
  cShots: $('cShots'),
  btnToggle: /** @type {HTMLButtonElement} */ ($('btnToggle')),
  btnCapture: /** @type {HTMLButtonElement} */ ($('btnCapture')),
  chkShots: /** @type {HTMLInputElement} */ ($('chkShots')),
  dangerWords: /** @type {HTMLInputElement} */ ($('dangerWords')),
  packIndia: /** @type {HTMLInputElement} */ ($('packIndia')),
  flash: $('flash'),
  throttle: $('throttle'),
  degraded: $('degraded'),
  emptyNoConsent: $('emptyNoConsent'),
  emptyConsented: $('emptyConsented'),
  list: $('list'),
  btnExport: /** @type {HTMLButtonElement} */ ($('btnExport')),
  progress: $('progress'),
  btnClear: $('btnClear'),
  clearConfirm: $('clearConfirm'),
  btnClearYes: $('btnClearYes'),
  btnClearNo: $('btnClearNo'),
};

ui.version.textContent = `v${TOOL_VERSION}`;

/**
 * @param {Record<string, unknown>} msg
 * @returns {Promise<any>}
 */
const send = (msg) =>
  new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        void chrome.runtime.lastError;
        resolve(r);
      });
    } catch {
      resolve(undefined);
    }
  });

/** @type {ReturnType<typeof setTimeout>|null} */
let flashTimer = null;
/** @param {string} text */
const flash = (text) => {
  ui.flash.textContent = text;
  ui.flash.hidden = false;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    ui.flash.hidden = true;
  }, 3000);
};

/**
 * @param {string} tag
 * @param {string} [cls]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
const h = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

/**
 * @param {string} s
 * @param {number} n
 */
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// --------------------------------------------------------------- origin

/** @type {{ tabId: number|null, origin: string|null, consented: boolean }} */
const active = { tabId: null, origin: null, consented: false };

/**
 * @param {string|undefined} url
 * @returns {string|null}
 */
const originOf = (url) => {
  try {
    const u = new URL(url || '');
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
};

async function refreshOrigin() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  } catch {
    tab = undefined;
  }
  active.tabId = tab && tab.id != null ? tab.id : null;
  active.origin = tab ? originOf(tab.url) : null;

  if (!active.origin) {
    ui.originName.textContent = 'no http(s) page in this tab';
    ui.consentBlock.hidden = true;
    ui.btnStop.hidden = true;
    ui.blockedFrames.hidden = true;
    active.consented = false;
    return;
  }
  const info = /** @type {OriginInfo|undefined} */ (await send({ type: MSG.GET_ORIGIN_INFO, origin: active.origin, tabId: active.tabId }));
  if (!info) return;
  active.consented = info.consented;
  ui.originName.textContent = active.origin.replace(/^https?:\/\//, '');
  ui.consentBlock.hidden = info.consented;
  ui.btnStop.hidden = !info.consented;
  ui.otherOrigins.hidden = info.otherOrigins.length === 0;
  ui.otherOrigins.textContent = info.otherOrigins.length
    ? `Also recording ${info.otherOrigins.length} other site${info.otherOrigins.length === 1 ? '' : 's'} this session: ${info.otherOrigins.map((o) => o.replace(/^https?:\/\//, '')).join(', ')}`
    : '';

  ui.blockedFrames.replaceChildren();
  ui.blockedFrames.hidden = !info.consented || info.blockedFrames.length === 0;
  if (info.consented && info.blockedFrames.length) {
    const wrap = h('div', 'blocked');
    wrap.append(h('div', '', 'This page embeds frames from other sites — also record them?'));
    for (const o of info.blockedFrames) {
      const row = h('div', 'blocked-row');
      row.append(h('code', '', o.replace(/^https?:\/\//, '')));
      const btn = /** @type {HTMLButtonElement} */ (h('button', 'btn small', 'Record'));
      btn.type = 'button';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await send({ type: MSG.ADD_ORIGIN, origin: o, tabId: active.tabId });
        flash(`Recording ${o.replace(/^https?:\/\//, '')} — tab reloading`);
        void refreshOrigin();
      });
      row.append(btn);
      wrap.append(row);
    }
    ui.blockedFrames.append(wrap);
  }
}

ui.btnConsent.addEventListener('click', async () => {
  if (!active.origin) return;
  ui.btnConsent.disabled = true;
  const r = await send({ type: MSG.ADD_ORIGIN, origin: active.origin, tabId: active.tabId });
  ui.btnConsent.disabled = false;
  if (r && r.ok) flash('Recording started — tab reloading');
  else flash(`Could not start: ${(r && r.reason) || 'no reply'}`);
  lastStateCount = -1;
  void refreshOrigin();
  void poll();
});

ui.btnStop.addEventListener('click', async () => {
  if (!active.origin) return;
  await send({ type: MSG.REMOVE_ORIGIN, origin: active.origin });
  flash('Stopped recording this site');
  void refreshOrigin();
  void poll();
});

// ------------------------------------------------------------- rendering

let lastStateCount = -1;
/** @type {Set<string>} */
const expanded = new Set();
let exportWasActive = false;
let dangerWordsDirty = false;

/** @param {Stats} s */
function renderStats(s) {
  ui.cStates.textContent = String(s.states);
  ui.cNet.textContent = String(s.net);
  ui.cLists.textContent = String(s.lists);
  ui.cShots.textContent = String(s.screenshots);

  const live = s.recording && active.consented;
  ui.recDot.classList.toggle('on', live);
  ui.recStatus.textContent = !s.recording ? 'paused' : active.consented ? 'recording' : s.origins.length ? 'recording other sites' : 'not recording';
  ui.btnToggle.textContent = s.recording ? 'Pause recording' : 'Resume recording';
  ui.chkShots.checked = s.screenshotsEnabled;
  if (!dangerWordsDirty && document.activeElement !== ui.dangerWords) ui.dangerWords.value = s.dangerWords.join(', ');
  ui.packIndia.checked = s.packs.includes('india');

  ui.throttle.hidden = !s.throttled;
  const d = s.degraded;
  const degradedParts = [];
  if (d.screenshots) degradedParts.push('screenshots off');
  if (d.snapshots) degradedParts.push('DOM snapshots off');
  if (d.netTrimmed) degradedParts.push('network log trimmed');
  if (d.statesRefused) degradedParts.push('NEW STATES REFUSED — export and clear now');
  ui.degraded.hidden = degradedParts.length === 0;
  ui.degraded.textContent = degradedParts.length ? `storage nearly full: ${degradedParts.join(', ')}` : '';

  ui.emptyNoConsent.hidden = s.states > 0 || active.consented || s.origins.length > 0;
  ui.emptyConsented.hidden = s.states > 0 || !(active.consented || s.origins.length > 0);

  const p = s.exportProgress;
  if (p.active) {
    ui.btnExport.hidden = true;
    ui.progress.hidden = false;
    ui.progress.textContent = `Writing ${p.current} of ${p.total} files${p.warning ? ` — ${p.warning}` : ''}`;
  } else {
    ui.btnExport.hidden = false;
    ui.btnExport.disabled = false;
    if (exportWasActive || p.error || p.folder) {
      ui.progress.hidden = false;
      const done = p.error ? `Export finished with problems: ${p.error}` : p.folder ? `Exported to Downloads/${p.folder}` : 'Export finished';
      ui.progress.textContent = p.warning ? `${done} — ${p.warning}` : done;
    } else {
      ui.progress.hidden = true;
    }
  }
  exportWasActive = p.active;
}

/**
 * @param {PanelRow} row
 * @returns {HTMLElement}
 */
function renderRow(row) {
  const li = h('li', 'row');
  li.dataset.id = row.id;

  const head = h('div', 'row-head');
  head.append(h('span', 'row-seq', String(row.seq).padStart(4, '0')));
  head.append(h('span', 'row-title', row.title || row.pathname || '(untitled)'));
  li.append(head);

  const meta = h('div', 'row-meta');
  meta.append(h('span', '', `${row.controlCount} controls`));
  meta.append(h('span', '', trunc(row.trigger, 32)));
  if (row.inIframe) meta.append(h('span', '', 'iframe'));
  if (row.degraded) meta.append(h('span', '', 'throttled'));
  if (row.errorCount) meta.append(h('span', 'chip err', `${row.errorCount} error${row.errorCount === 1 ? '' : 's'}`));
  if (row.newControls) meta.append(h('span', 'chip new', 'new controls'));
  if (row.listCount) meta.append(h('span', 'chip list', `${row.listCount} list${row.listCount === 1 ? '' : 's'}`));
  if (row.duplicate) meta.append(h('span', 'chip dup', 'duplicate'));
  li.append(meta);

  if (expanded.has(row.id)) {
    const d = h('div', 'row-detail');
    d.append(h('div', 'mono', `${row.pathname}  ·  ${row.capturedAt.replace('T', ' ').slice(0, 19)}`));
    /** @param {string} title @param {string[]} items @param {(t: string, i: number) => string} [cls] */
    const section = (title, items, cls) => {
      if (!items.length) return;
      d.append(h('h4', '', title));
      const ul = h('ul');
      items.forEach((t, i) => ul.append(h('li', cls ? cls(t, i) : '', t)));
      d.append(ul);
    };
    section('Headings', row.headings);
    section(
      'Steps',
      row.steps.map((s) => s.text),
      (_, i) => (row.steps[i].active ? 'active' : '')
    );
    section(`Controls (first ${row.controlLabels.length})`, row.controlLabels);
    section('List patterns', row.listSummary);
    li.append(d);
  }

  li.addEventListener('click', () => {
    if (expanded.has(row.id)) expanded.delete(row.id);
    else expanded.add(row.id);
    li.replaceWith(renderRow(row));
  });
  return li;
}

/** @param {PanelRow[]} rows */
function renderList(rows) {
  const frag = document.createDocumentFragment();
  for (const row of [...rows].reverse()) frag.append(renderRow(row));
  ui.list.replaceChildren(frag);
}

// --------------------------------------------------------------- polling

async function poll() {
  const stats = /** @type {Stats|undefined} */ (await send({ type: MSG.GET_STATS }));
  if (!stats) return;
  renderStats(stats);
  if (stats.states !== lastStateCount) {
    lastStateCount = stats.states;
    const rows = /** @type {PanelRow[]|undefined} */ (await send({ type: MSG.GET_STATES }));
    if (rows) renderList(rows);
  }
}

// -------------------------------------------------------------- controls

ui.btnToggle.addEventListener('click', async () => {
  const on = ui.btnToggle.textContent?.startsWith('Resume');
  await send({ type: MSG.SET_RECORDING, on });
  void poll();
});

ui.btnCapture.addEventListener('click', async () => {
  const r = await send({ type: MSG.CAPTURE_NOW });
  flash(r && r.ok ? 'Capture requested' : `Could not capture: ${(r && r.reason) || 'no reply'}`);
});

ui.chkShots.addEventListener('change', async () => {
  await send({ type: MSG.SET_SCREENSHOTS, on: ui.chkShots.checked });
});

ui.dangerWords.addEventListener('input', () => {
  dangerWordsDirty = true;
});
ui.dangerWords.addEventListener('change', async () => {
  const words = ui.dangerWords.value.split(',').map((w) => w.trim()).filter(Boolean);
  await send({ type: MSG.SET_DANGER_WORDS, words });
  dangerWordsDirty = false;
  flash('Danger words saved');
});

ui.packIndia.addEventListener('change', async () => {
  await send({ type: MSG.SET_PACKS, packs: ui.packIndia.checked ? ['india'] : [] });
});

ui.btnExport.addEventListener('click', async () => {
  ui.btnExport.disabled = true;
  const r = await send({ type: MSG.EXPORT });
  if (!r || !r.started) {
    ui.btnExport.disabled = false;
    flash(`Export not started: ${(r && r.reason) || 'no reply'}`);
  }
  void poll();
});

ui.btnClear.addEventListener('click', () => {
  ui.btnClear.hidden = true;
  ui.clearConfirm.hidden = false;
});
ui.btnClearNo.addEventListener('click', () => {
  ui.clearConfirm.hidden = true;
  ui.btnClear.hidden = false;
});
ui.btnClearYes.addEventListener('click', async () => {
  ui.clearConfirm.hidden = true;
  ui.btnClear.hidden = false;
  await send({ type: MSG.CLEAR });
  expanded.clear();
  lastStateCount = -1;
  flash('Session cleared');
  void refreshOrigin();
  void poll();
});

// Origin bar follows the active tab.
try {
  chrome.tabs.onActivated.addListener(() => void refreshOrigin());
  chrome.tabs.onUpdated.addListener((_id, info) => {
    if (info.status === 'complete' || info.url) void refreshOrigin();
  });
} catch {
  /* tabs API unavailable */
}

void refreshOrigin().then(() => poll());
setInterval(() => void poll(), TIMING.PANEL_POLL_MS);
setInterval(() => void refreshOrigin(), TIMING.PANEL_POLL_MS * 2);
