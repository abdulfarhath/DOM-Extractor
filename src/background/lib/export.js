/**
 * Export pipeline — docs/03. Sequential chrome.downloads writes into one
 * timestamped folder under Downloads. Snapshots are streamed one key at a
 * time; the states array is the only thing held whole. Progress lives in
 * module memory and is read by the panel through GET_STATS.
 *
 * Service workers have no URL.createObjectURL, so every file is a data: URL.
 * DOM snapshots are written as they are stored — gzipped, `.html.gz` — which
 * keeps every data: URL small (Q14).
 */
import { TOOL_NAME, TOOL_VERSION, TIMING, ALLOWED_ORIGINS } from '../../shared/constants.js';
import * as store from './store.js';
import { buildHar } from './har.js';
import { buildFieldMap } from './fieldmap.js';
import { buildSummary } from './summary.js';
import { stemFor, exportFolderName } from './naming.js';

/** @typedef {import('../../shared/schema.js').ExportProgress} ExportProgress */
/** @typedef {import('../../shared/schema.js').ExportManifest} ExportManifest */
/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */

/** @type {ExportProgress} */
let progress = { active: false, current: 0, total: 0, error: null, warning: null, folder: null };

/** @returns {ExportProgress} */
export function getExportProgress() {
  return { ...progress };
}

/** @returns {Promise<{ started: boolean, reason?: string }>} */
export async function runExport() {
  if (progress.active) return { started: false, reason: 'an export is already running' };
  progress = { active: true, current: 0, total: 0, error: null, warning: null, folder: null };
  void doExport();
  return { started: true };
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {unknown} e
 * @returns {string}
 */
const errText = (e) => (e instanceof Error ? e.message : String(e));

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

/**
 * @param {string} text
 * @param {string} mime
 * @returns {string}
 */
const textDataUrl = (text, mime) => `data:${mime};base64,${bytesToBase64(new TextEncoder().encode(text))}`;

/** Q15: a single download taking this long means Chrome is prompting per file. */
const PROMPT_SUSPECT_MS = 5000;

/**
 * One file. Failures are counted, not fatal — a bad snapshot must not stop the
 * field map from landing on disk.
 * @param {string} folder
 * @param {string} path
 * @param {string} dataUrl
 * @returns {Promise<boolean>}
 */
async function writeFile(folder, path, dataUrl) {
  const t0 = Date.now();
  try {
    await chrome.downloads.download({
      url: dataUrl,
      filename: `${folder}/${path}`,
      conflictAction: 'uniquify',
      saveAs: false,
    });
    if (!progress.warning && Date.now() - t0 > PROMPT_SUSPECT_MS) {
      progress.warning =
        'Chrome seems to be asking where to save each file. Turn off "Ask where to save each file before downloading" in chrome://settings/downloads. The export continues either way.';
    }
    return true;
  } catch (e) {
    console.warn('[mcadc] export write failed:', path, errText(e));
    return false;
  } finally {
    progress.current++;
    await sleep(TIMING.EXPORT_FILE_GAP_MS);
  }
}

async function doExport() {
  let failed = 0;
  try {
    // Read the small lists in one serialised step so they are mutually consistent.
    const { meta, states, net, transitions, deps } = await store.enqueue(async () => ({
      meta: await store.getMeta(),
      states: await store.getStates(),
      net: await store.getNet(),
      transitions: await store.getTransitions(),
      deps: await store.getDeps(),
    }));

    const folder = exportFolderName(new Date());
    progress.folder = folder;
    const withDom = states.filter((s) => s.domRef);
    const withShot = states.filter((s) => s.screenshotRef);
    progress.total = 4 + states.length + withDom.length + withShot.length;

    /** @type {ExportManifest} */
    const manifest = {
      tool: TOOL_NAME,
      version: TOOL_VERSION,
      exportedAt: new Date().toISOString(),
      sessionStartedAt: meta.sessionStartedAt,
      counts: {
        states: states.length,
        domSnapshots: withDom.length,
        screenshots: withShot.length,
        netEntries: net.length,
      },
      origins: [...ALLOWED_ORIGINS],
      redaction: {
        fieldValues: 'redacted at capture',
        domValues: 'redacted at capture',
        bodies: 'pattern-scrubbed, NOT guaranteed clean',
      },
      warnings: [
        'Network response bodies are kept for dropdown data. Review before sharing.',
        'dom/*.html.gz are gzipped HTML snapshots; gunzip to view.',
        'Screenshots of iframe states show the whole tab (screenshotOf: parent-frame).',
      ],
      harNote:
        'HAR 1.2 shaped, reconstructed from fetch/XHR wrappers. Timings are approximate and browser-added request headers are absent.',
    };

    const fieldMap = buildFieldMap(states, deps, transitions);
    const har = buildHar(net);
    const summary = buildSummary(states, transitions, deps, fieldMap, meta, net.length);

    if (!(await writeFile(folder, 'manifest.json', textDataUrl(JSON.stringify(manifest, null, 2), 'application/json')))) failed++;
    if (!(await writeFile(folder, 'SUMMARY.md', textDataUrl(summary, 'text/markdown')))) failed++;
    if (!(await writeFile(folder, 'field-map-draft.json', textDataUrl(JSON.stringify(fieldMap, null, 2), 'application/json')))) failed++;
    if (!(await writeFile(folder, 'network.har', textDataUrl(JSON.stringify(har, null, 2), 'application/json')))) failed++;

    for (const s of states) {
      if (!(await writeFile(folder, `states/${stemFor(s)}.json`, textDataUrl(JSON.stringify(s, null, 2), 'application/json')))) failed++;
    }

    for (const s of withDom) {
      const gz = await store.getDom(s.id);
      if (!gz) {
        progress.current++;
        failed++;
        continue;
      }
      if (!(await writeFile(folder, `dom/${stemFor(s)}.html.gz`, `data:application/gzip;base64,${gz}`))) failed++;
    }

    for (const s of withShot) {
      const png = await store.getScreenshot(s.id);
      if (!png) {
        progress.current++;
        failed++;
        continue;
      }
      if (!(await writeFile(folder, `screens/${stemFor(s)}.png`, `data:image/png;base64,${png}`))) failed++;
    }

    if (failed) progress.error = `${failed} of ${progress.total} files failed to write`;
  } catch (e) {
    progress.error = errText(e);
  } finally {
    progress.active = false;
  }
}
