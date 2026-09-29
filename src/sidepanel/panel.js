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
/** @typedef {import('../shared/schema.js').CoveragePage} CoveragePage */
/** @typedef {import('../shared/schema.js').CoverageReply} CoverageReply */

/**
 * One list inside a Coverage section.
 * @typedef {Object} CoverageList
 * @property {string} label     '' when the section heading already says what the list is
 * @property {boolean} ordered  true when the order carries meaning (hints: most valuable first)
 * @property {string[]} items
 * @property {string} more      '' or "and N more"
 */

/**
 * The Coverage block as plain data. Serialised, it is the key that decides
 * whether the DOM is touched at all.
 * @typedef {Object} CoverageSection
 * @property {string} heading   '' for the summary at the top
 * @property {string[]} lines
 * @property {CoverageList[]} lists
 */

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
  cActions: $('cActions'),
  cDownloads: $('cDownloads'),
  btnToggle: /** @type {HTMLButtonElement} */ ($('btnToggle')),
  btnCapture: /** @type {HTMLButtonElement} */ ($('btnCapture')),
  chkShots: /** @type {HTMLInputElement} */ ($('chkShots')),
  dangerWords: /** @type {HTMLInputElement} */ ($('dangerWords')),
  packIndia: /** @type {HTMLInputElement} */ ($('packIndia')),
  chkKeepBodies: /** @type {HTMLInputElement} */ ($('chkKeepBodies')),
  flash: $('flash'),
  throttle: $('throttle'),
  degraded: $('degraded'),
  scroll: $('scroll'),
  coverage: $('coverage'),
  coverageToggle: /** @type {HTMLButtonElement} */ ($('coverageToggle')),
  coverageState: $('coverageState'),
  coverageBody: $('coverageBody'),
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

/** @type {{ tabId: number|null, origin: string|null, route: string|null, consented: boolean }} */
const active = { tabId: null, origin: null, route: null, consented: false };

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

/**
 * docs/12 B1, mirrored: pathname plus the fragment's path part when the app
 * routes through the fragment. The worker matches this against the routes it
 * recorded, so it has to be built the same way. Query strings never enter it.
 * @param {string|undefined} url
 * @returns {string|null}
 */
const routeOf = (url) => {
  try {
    const u = new URL(url || '');
    return u.pathname + (/^#!?\//.test(u.hash) ? u.hash.split('?')[0] : '');
  } catch {
    return null;
  }
};

/** What the Coverage block is about. A change means what is shown is about somewhere else. */
const coverageTarget = () => `${active.consented ? active.origin : null}\n${active.route}`;

async function refreshOrigin() {
  const before = coverageTarget();
  await readActiveTab();
  // Do not leave the previous page's findings up for a poll interval after the user has moved on.
  if (coverageTarget() !== before) void refreshCoverage();
}

async function readActiveTab() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  } catch {
    tab = undefined;
  }
  active.tabId = tab && tab.id != null ? tab.id : null;
  active.origin = tab ? originOf(tab.url) : null;
  active.route = tab && active.origin ? routeOf(tab.url) : null;

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
/** True while a change to "Keep full API responses" is on its way to the worker, so a poll that left earlier cannot flip the box back. */
let keepBodiesPending = false;

/** @param {Stats} s */
function renderStats(s) {
  ui.cStates.textContent = String(s.states);
  ui.cNet.textContent = String(s.net);
  ui.cLists.textContent = String(s.lists);
  ui.cShots.textContent = String(s.screenshots);
  // A worker from before docs/12 does not send these three.
  ui.cActions.textContent = String(s.actions ?? 0);
  ui.cDownloads.textContent = String(s.downloads ?? 0);
  if (!keepBodiesPending) ui.chkKeepBodies.checked = s.keepBodies === 'full';

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
  if (d.bodiesDropped) degradedParts.push('full API responses dropped');
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
    const line = p.phase === 'downloading' ? `Downloading ${p.folder || 'zip'}…` : `Packing ${p.current} of ${p.total} files`;
    ui.progress.textContent = `${line}${p.warning ? ` — ${p.warning}` : ''}`;
  } else {
    ui.btnExport.hidden = false;
    ui.btnExport.disabled = false;
    if (exportWasActive || p.error || p.folder) {
      ui.progress.hidden = false;
      const done = p.error ? `Export failed: ${p.error}` : p.folder ? `Saved Downloads/${p.folder}` : 'Export finished';
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
  const open = expanded.has(row.id);
  const li = h('li', open ? 'row open' : 'row');
  li.dataset.id = row.id;
  // route tells fragment-routed pages apart; rows stored before docs/12 only have pathname.
  const where = row.route || row.pathname || '';

  const head = h('div', 'row-head');
  head.append(h('span', 'row-seq', String(row.seq).padStart(4, '0')));
  head.append(h('span', 'row-title', row.title || where || '(untitled)'));
  li.append(head);
  // Two states of one page differ only by this, so it has to be visible without expanding.
  if (row.viewKey) li.append(h('div', 'row-view', row.viewKey.split('|').join(' · ')));

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

  if (open) {
    const d = h('div', 'row-detail');
    d.append(h('div', 'mono row-where', `${where}  ·  ${row.capturedAt.replace('T', ' ').slice(0, 19)}`));
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

// -------------------------------------------------------------- coverage

const COVERAGE_MENU_MAX = 12;
const COVERAGE_LIST_MAX = 12;
const COVERAGE_OPTIONS_MAX = 8;
const COVERAGE_HINTS_MAX = 5;

/** Remembered for the panel's lifetime only; a reopened panel starts open again. */
let coverageOpen = true;
/** Serialised sections currently in the DOM. */
let coverageKey = '';
/** The target the shown sections belong to. */
let coverageShownFor = '';

/**
 * The reply is built by the worker from recorded pages, and may come from a
 * worker that is older or half-restarted. Nothing in it is trusted to be there.
 * @param {unknown} v
 * @returns {any[]}
 */
const arr = (v) => (Array.isArray(v) ? v : []);
/** @param {unknown} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** @param {unknown} v */
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * @param {number} n
 * @param {string} one
 * @param {string} [many]
 */
const count = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

/**
 * @param {string} label
 * @param {string[]} items
 * @param {number} max
 * @param {boolean} [ordered]
 * @returns {CoverageList}
 */
const capped = (label, items, max, ordered = false) => ({
  label,
  ordered,
  items: items.slice(0, max),
  more: items.length > max ? `and ${items.length - max} more` : '',
});

/**
 * @param {CoveragePage|null|undefined} page
 * @returns {{ section: CoverageSection, open: number }} open = findings still to act on
 */
function coveragePageSection(page) {
  /** @type {CoverageSection} */
  const section = { heading: 'On this page', lines: [], lists: [] };
  if (!page) {
    section.lines.push('This page has not been recorded yet. Click Capture now, above, to record it.');
    return { section, open: 1 };
  }

  const options = [];
  for (const g of arr(page.viewGroups)) {
    const left = arr(g && g.options).filter((o) => o && !o.visited).map((o) => str(o.text)).filter(Boolean);
    if (!left.length) continue;
    const shown = left.slice(0, COVERAGE_OPTIONS_MAX).join(', ');
    const rest = left.length > COVERAGE_OPTIONS_MAX ? `, and ${left.length - COVERAGE_OPTIONS_MAX} more` : '';
    options.push(`${str(g.name) || 'Options'}: ${shown}${rest}`);
  }

  // The selector is the only name a list has. It is not pretty, but with two
  // tables on a page it is what tells them apart.
  /** @param {{ kind?: string, selector?: string }} l */
  const listName = (l) => `${l.kind === 'table' ? 'Table' : 'List'}${str(l.selector) ? ` — ${str(l.selector)}` : ''}`;
  const lists = arr(page.lists).filter(Boolean);
  // A list without a pager cannot be paged; asking for it would send the user looking for a control that is not there.
  const notPaged = lists.filter((l) => l.hasPagination && !l.paged).map(listName);
  const notOpened = lists.filter((l) => !l.itemOpened).map(listName);

  if (options.length) section.lists.push(capped('Options not selected yet', options, COVERAGE_LIST_MAX));
  if (notPaged.length) section.lists.push(capped('Lists not paged yet', notPaged, COVERAGE_LIST_MAX));
  if (notOpened.length) section.lists.push(capped('Lists where no item was opened', notOpened, COVERAGE_LIST_MAX));
  if (!section.lists.length) section.lines.push('Nothing left to select, page or open on this page.');

  const downloads = num(page.downloads);
  section.lines.push(
    downloads > 1
      ? `${downloads} downloads were recorded on this page.`
      : downloads === 1 || lists.some((l) => l.downloadSeen)
        ? 'A download was recorded on this page.'
        : 'No download has been recorded on this page.'
  );
  return { section, open: section.lists.length };
}

/**
 * Turns the worker's reply into what the block says. Pure: the same reply
 * always gives the same sections, which is what makes the key comparison work.
 * @param {CoverageReply|null|undefined} reply
 * @returns {CoverageSection[]}
 */
function coverageSections(reply) {
  const cov = reply && reply.ok && reply.coverage ? reply.coverage : null;
  const t = cov && cov.totals;
  if (!cov || !t || !num(t.pages)) {
    return [{ heading: '', lines: ['Nothing to show yet. Use the site normally — this fills in as pages are recorded.'], lists: [] }];
  }

  const summary = [
    num(t.menuItems) ? `${num(t.menuVisited)} of ${count(num(t.menuItems), 'menu item')} visited` : 'no menu items seen yet',
    `${count(num(t.pages), 'page')} recorded`,
    num(t.lists) ? `${num(t.listsPaged)} of ${count(num(t.lists), 'list')} paged` : 'no lists seen yet',
    `${count(num(t.downloads), 'download')} recorded`,
  ].join(' · ');

  const menu = arr(cov.unvisitedMenu)
    .map((m) => arr(m && m.path).map(str).filter(Boolean).join(' › '))
    .filter(Boolean);
  const hints = arr(cov.hints).map(str).filter(Boolean);
  const page = coveragePageSection(reply && reply.page);

  if (!menu.length && !hints.length && !page.open) {
    return [{ heading: '', lines: [summary, 'Everything seen on this site so far has been covered.'], lists: [] }];
  }

  /** @type {CoverageSection[]} */
  const sections = [{ heading: '', lines: [summary], lists: [] }, page.section];
  if (menu.length) sections.push({ heading: 'Not visited yet', lines: [], lists: [capped('', menu, COVERAGE_MENU_MAX)] });
  if (hints.length) sections.push({ heading: 'Next steps', lines: [], lists: [capped('', hints.slice(0, COVERAGE_HINTS_MAX), COVERAGE_HINTS_MAX, true)] });
  return sections;
}

/** @param {CoverageSection[]} sections */
function renderCoverage(sections) {
  // Every five seconds the answer is usually the same. Leaving the DOM alone
  // then keeps the scroll position, the text selection and the screen reader's place.
  const key = JSON.stringify(sections);
  if (key === coverageKey) return;
  coverageKey = key;

  const frag = document.createDocumentFragment();
  sections.forEach((s, i) => {
    const wrap = h('div', 'cov-section');
    if (s.heading) wrap.append(h('h3', 'cov-h', s.heading));
    // Lists first: what is still to do on a page reads before the remark about its downloads.
    for (const l of s.lists) {
      if (l.label) wrap.append(h('h4', 'cov-label', l.label));
      const list = h(l.ordered ? 'ol' : 'ul', 'cov-list');
      for (const item of l.items) list.append(h('li', '', item));
      wrap.append(list);
      if (l.more) wrap.append(h('p', 'cov-more', l.more));
    }
    s.lines.forEach((line, j) => wrap.append(h('p', i === 0 && j === 0 ? 'cov-line cov-summary' : 'cov-line', line)));
    frag.append(wrap);
  });
  const top = ui.scroll.scrollTop;
  ui.coverageBody.replaceChildren(frag);
  ui.scroll.scrollTop = top;
}

function renderCoverageOpen() {
  ui.coverageToggle.setAttribute('aria-expanded', String(coverageOpen));
  ui.coverageState.textContent = coverageOpen ? 'Hide' : 'Show';
  ui.coverageBody.hidden = !coverageOpen;
}

async function refreshCoverage() {
  const on = Boolean(active.origin && active.consented);
  ui.coverage.hidden = !on;
  if (!on || document.hidden) return;
  const target = coverageTarget();
  let reply;
  try {
    reply = /** @type {CoverageReply|undefined} */ (await send({ type: MSG.GET_COVERAGE, origin: active.origin, route: active.route, tabId: active.tabId }));
  } catch {
    reply = undefined;
  }
  // The user moved to another page or site while the worker was answering.
  if (target !== coverageTarget()) return;
  // A message lost to a restarting worker is no reason to blank findings that are still true.
  if (!reply && coverageShownFor === target && coverageKey) return;
  coverageShownFor = target;
  try {
    renderCoverage(coverageSections(reply));
  } catch {
    // A malformed reply must never take the rest of the panel down with it.
    renderCoverage(coverageSections(undefined));
  }
}

ui.coverageToggle.addEventListener('click', () => {
  coverageOpen = !coverageOpen;
  renderCoverageOpen();
});
renderCoverageOpen();

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refreshCoverage();
});

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

ui.chkKeepBodies.addEventListener('change', async () => {
  const want = ui.chkKeepBodies.checked;
  keepBodiesPending = true;
  const asked = want ? 'full' : 'shape';
  const r = await send({ type: MSG.SET_KEEP_BODIES, value: asked });
  keepBodiesPending = false;
  // A worker that echoes the mode it now holds has confirmed it, with or without `ok`.
  const confirmed = !!r && (r.keepBodies !== undefined ? r.keepBodies === asked : r.ok === true);
  if (!confirmed) {
    // Showing the box ticked while the worker still keeps shapes only would be a false promise, and the reverse a false comfort.
    ui.chkKeepBodies.checked = !want;
    flash(`Could not change this: ${(r && (r.reason || (r.keepBodies && `the worker kept "${r.keepBodies}"`))) || 'no reply'}`);
    return;
  }
  flash(want ? 'Full API responses will be kept from now on' : 'Only the shape of API responses will be kept');
  void poll();
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
setInterval(() => void refreshCoverage(), TIMING.COVERAGE_POLL_MS);
