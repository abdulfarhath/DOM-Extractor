/**
 * Side panel — docs/04. Polls the service worker; never reads storage itself.
 * Everything rendered here is already redacted; the panel only ever sees
 * PanelRow shapes, never selectors, snapshots or bodies.
 */
import { MSG, TIMING, TOOL_VERSION } from '../shared/constants.js';

/** @typedef {import('../shared/schema.js').Stats} Stats */
/** @typedef {import('../shared/schema.js').PanelRow} PanelRow */

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
  cStates: $('cStates'),
  cNet: $('cNet'),
  cShots: $('cShots'),
  btnToggle: /** @type {HTMLButtonElement} */ ($('btnToggle')),
  btnCapture: /** @type {HTMLButtonElement} */ ($('btnCapture')),
  chkShots: /** @type {HTMLInputElement} */ ($('chkShots')),
  flash: $('flash'),
  empty: $('empty'),
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
  }, 2500);
};

// ------------------------------------------------------------- rendering

let lastStateCount = -1;
/** @type {Set<string>} */
const expanded = new Set();
let exportWasActive = false;

/** @param {Stats} s */
function renderStats(s) {
  ui.cStates.textContent = String(s.states);
  ui.cNet.textContent = String(s.net);
  ui.cShots.textContent = String(s.screenshots);

  ui.recDot.classList.toggle('on', s.recording);
  ui.recStatus.textContent = s.recording ? 'recording' : 'paused';
  ui.btnToggle.textContent = s.recording ? 'Pause recording' : 'Resume recording';
  ui.chkShots.checked = s.screenshotsEnabled;

  const p = s.exportProgress;
  if (p.active) {
    ui.btnExport.hidden = true;
    ui.progress.hidden = false;
    ui.progress.textContent = `Writing ${p.current} of ${p.total} files${p.warning ? ` — ${p.warning}` : ''}`;
  } else {
    ui.btnExport.hidden = false;
    ui.btnExport.disabled = false;
    if (exportWasActive) {
      ui.progress.hidden = false;
      const done = p.error ? `Export failed: ${p.error}` : p.folder ? `Exported to Downloads/${p.folder}` : 'Export finished';
      ui.progress.textContent = p.warning ? `${done} — ${p.warning}` : done;
    } else {
      ui.progress.hidden = true;
    }
  }
  exportWasActive = p.active;
}

/**
 * @param {string} s
 * @param {number} n
 */
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

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
  meta.append(h('span', '', `${row.fieldCount} fields`));
  meta.append(h('span', '', trunc(row.trigger, 32)));
  if (row.inIframe) meta.append(h('span', '', 'iframe'));
  if (row.errorCount) meta.append(h('span', 'chip err', `${row.errorCount} error${row.errorCount === 1 ? '' : 's'}`));
  if (row.newFields) meta.append(h('span', 'chip new', 'new fields'));
  if (row.duplicate) meta.append(h('span', 'chip dup', 'duplicate'));
  li.append(meta);

  if (expanded.has(row.id)) {
    const d = h('div', 'row-detail');
    d.append(h('div', 'mono', `${row.pathname}  ·  ${row.capturedAt.replace('T', ' ').slice(0, 19)}`));
    if (row.headings.length) {
      d.append(h('h4', '', 'Headings'));
      const ul = h('ul');
      for (const t of row.headings) ul.append(h('li', '', t));
      d.append(ul);
    }
    if (row.steps.length) {
      d.append(h('h4', '', 'Steps'));
      const ul = h('ul');
      for (const s of row.steps) ul.append(h('li', s.active ? 'active' : '', s.text));
      d.append(ul);
    }
    if (row.fieldLabels.length) {
      d.append(h('h4', '', `Fields (first ${row.fieldLabels.length})`));
      const ul = h('ul');
      for (const t of row.fieldLabels) ul.append(h('li', '', t));
      d.append(ul);
    }
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
  ui.empty.hidden = rows.length > 0;
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
  void poll();
});

void poll();
setInterval(() => void poll(), TIMING.PANEL_POLL_MS);
