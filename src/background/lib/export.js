/**
 * Export pipeline — docs/03, docs/09 Q14/Q15. One zip under Downloads holding
 * the timestamped folder layout, one package per consented origin. Every
 * artifact is built here and streamed entry by entry to the offscreen
 * document, which compresses it into the archive and mints the single blob:
 * URL for one chrome.downloads call. The states array is the only thing held
 * whole; snapshots stream one key at a time. Progress lives in module memory
 * and reaches the panel via GET_STATS.
 */
import { TOOL_NAME, TOOL_VERSION, TIMING, MSG } from '../../shared/constants.js';
import * as store from './store.js';
import * as origins from './origins.js';
import { buildHar } from './har.js';
import { buildFlowMap, buildSelectorsFile } from './flowmap.js';
import { buildSummary } from './summary.js';
import { buildBrief } from './brief.js';
import { buildSkeleton } from './skeleton.js';
import { stemFor, exportFolderName, hostSlug } from './naming.js';

/** @typedef {import('../../shared/schema.js').ExportProgress} ExportProgress */
/** @typedef {import('../../shared/schema.js').ExportManifest} ExportManifest */
/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../../shared/schema.js').NetEntry} NetEntry */
/** @typedef {import('../../shared/schema.js').Transition} Transition */
/** @typedef {import('../../shared/schema.js').Dependency} Dependency */
/** @typedef {import('../../shared/schema.js').SessionMeta} SessionMeta */

const OFFSCREEN_URL = 'src/offscreen/offscreen.html';

/** @type {ExportProgress} */
let progress = { active: false, phase: 'idle', current: 0, total: 0, error: null, warning: null, folder: null };

/** @returns {ExportProgress} */
export function getExportProgress() {
  return { ...progress };
}

/** @returns {Promise<{ started: boolean, reason?: string }>} */
export async function runExport() {
  if (progress.active) return { started: false, reason: 'an export is already running' };
  progress = { active: true, phase: 'packing', current: 0, total: 0, error: null, warning: null, folder: null };
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

// ------------------------------------------------------------ offscreen

async function hasOffscreen() {
  try {
    const ctxs = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
    return ctxs.length > 0;
  } catch {
    return false;
  }
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: 'Build the export zip and its blob URL; service workers cannot mint object URLs.',
    });
  } catch (e) {
    // A racing create from a previous export is fine; anything else is not.
    if (!/already exists|single offscreen/i.test(errText(e))) throw e;
  }
}

async function closeOffscreen() {
  try {
    if (await hasOffscreen()) await chrome.offscreen.closeDocument();
  } catch {
    /* already closed */
  }
}

/**
 * @param {Record<string, unknown>} msg
 * @returns {Promise<any>}
 */
async function askOffscreen(msg) {
  const r = await chrome.runtime.sendMessage({ target: 'offscreen', ...msg });
  if (!r) throw new Error('offscreen document did not answer');
  if (r.error) throw new Error(String(r.error));
  return r;
}

/** @param {string} url */
async function revokeBlobUrl(url) {
  try {
    await askOffscreen({ type: MSG.OFFSCREEN_REVOKE, url });
  } catch {
    /* document gone */
  }
}

// ---------------------------------------------------------------- entries

/**
 * One archive entry. A failure is counted, not fatal — a bad snapshot must
 * not stop the flow map from landing on disk.
 * @param {string} path   inside the zip, folder included
 * @param {{ text?: string, base64?: string, gzipBase64?: string, mime: string }} payload
 * @returns {Promise<boolean>}
 */
async function addFile(path, payload) {
  try {
    await askOffscreen({ type: MSG.OFFSCREEN_ZIP_ADD, path, text: payload.text, base64: payload.base64, gzipBase64: payload.gzipBase64 });
    return true;
  } catch (e) {
    console.warn('[flowprint] export entry failed:', path, errText(e));
    return false;
  } finally {
    progress.current++;
  }
}

// ------------------------------------------------------------- download

/**
 * @param {number} id
 * @param {number} timeoutMs
 * @returns {Promise<'complete'|'interrupted'|'gone'|'timeout'>}
 */
async function waitForDownload(id, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    let item;
    try {
      [item] = await chrome.downloads.search({ id });
    } catch {
      return 'gone';
    }
    if (!item) return 'gone';
    if (item.state === 'complete') return 'complete';
    if (item.state === 'interrupted') return 'interrupted';
    if (!progress.warning && Date.now() - t0 > TIMING.PROMPT_SUSPECT_MS) {
      progress.warning = 'The download is waiting — if Chrome opened a Save dialog, pick a location to finish.';
    }
    await sleep(250);
  }
  return 'timeout';
}

/**
 * Finish the archive in the offscreen document and download it once.
 * @param {string} fileName
 * @returns {Promise<boolean>}
 */
async function downloadZip(fileName) {
  progress.phase = 'downloading';
  let url = '';
  try {
    const r = await askOffscreen({ type: MSG.OFFSCREEN_ZIP_FINISH });
    url = String(r.url);
    const id = await chrome.downloads.download({ url, filename: fileName, conflictAction: 'uniquify', saveAs: false });
    const state = await waitForDownload(id, TIMING.DOWNLOAD_WAIT_MS);
    if (state !== 'complete') {
      progress.error = `zip download ${state}`;
      return false;
    }
    return true;
  } catch (e) {
    progress.error = `zip download failed: ${errText(e)}`;
    return false;
  } finally {
    if (url) await revokeBlobUrl(url);
  }
}

/**
 * @param {unknown} obj
 * @returns {{ text: string, mime: string }}
 */
const json = (obj) => ({ text: JSON.stringify(obj, null, 2), mime: 'application/json' });

/**
 * @param {string} text
 * @param {string} [mime]
 */
const textFile = (text, mime = 'text/markdown') => ({ text, mime });

// --------------------------------------------------------------- export

/**
 * @typedef {Object} OriginBundle
 * @property {string} origin
 * @property {StateRecord[]} states
 * @property {NetEntry[]} net
 * @property {Transition[]} transitions
 * @property {Dependency[]} deps
 */

/**
 * Split the session by origin. States carry their origin; net entries are
 * attributed by the page that made the call; edges and deps follow states.
 * @param {string[]} consented
 * @param {StateRecord[]} states
 * @param {NetEntry[]} net
 * @param {Transition[]} transitions
 * @param {Dependency[]} deps
 * @returns {OriginBundle[]}
 */
function splitByOrigin(consented, states, net, transitions, deps) {
  const all = Array.from(new Set([...consented, ...states.map((s) => s.origin)]));
  return all.map((origin) => {
    const own = states.filter((s) => s.origin === origin);
    const ids = new Set(own.map((s) => s.id));
    return {
      origin,
      states: own,
      net: net.filter((n) => origins.originOf(n.pageUrl || '') === origin),
      transitions: transitions.filter((t) => ids.has(t.from) && ids.has(t.to)),
      deps: deps.filter((d) => ids.has(d.stateId)),
    };
  });
}

/**
 * @param {OriginBundle} b
 * @param {SessionMeta} meta
 * @param {string[]} allOrigins
 * @param {number} listPatterns
 * @returns {ExportManifest}
 */
function manifestFor(b, meta, allOrigins, listPatterns) {
  /** @type {Map<string, { origin: string, framework: string, version: string|null }>} */
  const fws = new Map();
  for (const s of b.states) {
    if (!fws.has(s.origin) || (s.framework.framework !== 'plain' && fws.get(s.origin)?.framework === 'plain')) {
      fws.set(s.origin, { origin: s.origin, framework: s.framework.framework, version: s.framework.version });
    }
  }
  const blocked = new Set();
  for (const s of b.states) for (const o of s.blockedFrames || []) blocked.add(o);
  return {
    tool: TOOL_NAME,
    version: TOOL_VERSION,
    exportedAt: new Date().toISOString(),
    sessionStartedAt: meta.sessionStartedAt,
    origins: allOrigins,
    frameworks: Array.from(fws.values()),
    counts: {
      states: b.states.length,
      domSnapshots: b.states.filter((s) => s.domRef).length,
      screenshots: b.states.filter((s) => s.screenshotRef).length,
      netEntries: b.net.length,
      listPatterns,
      transitions: b.transitions.length,
      dependencies: b.deps.length,
    },
    redaction: {
      packs: meta.packs,
      fieldValues: 'redacted at capture',
      domValues: 'redacted at capture',
      bodies: 'pattern-scrubbed, NOT guaranteed clean',
    },
    blockedFrames: Array.from(blocked),
    degraded: meta.degraded,
    warnings: [
      'Network response bodies are kept for reference data. Review before sharing.',
      'Screenshots are orientation only; selectors come from states/ and flow-map.json.',
      ...(blocked.size ? ['Some embedded frames were not recorded (blockedFrames). The capture has known blind spots.'] : []),
      ...(meta.degraded.screenshots || meta.degraded.snapshots || meta.degraded.netTrimmed || meta.degraded.statesRefused ? ['Storage degradation occurred during the session; see degraded.'] : []),
    ],
    harNote: 'HAR 1.2 shaped, reconstructed from fetch/XHR wrappers. Timings approximate; browser-added request headers absent.',
  };
}

async function doExport() {
  let failed = 0;
  try {
    const { meta, states, net, transitions, deps, consented } = await store.enqueue(async () => ({
      meta: await store.getMeta(),
      states: await store.getStates(),
      net: await store.getNet(),
      transitions: await store.getTransitions(),
      deps: await store.getDeps(),
      consented: await origins.listOrigins(),
    }));

    const bundles = splitByOrigin(consented, states, net, transitions, deps);
    const now = new Date();
    const multi = bundles.length > 1;
    // The zip unpacks to the same timestamped folder the files used to be written into.
    const root = exportFolderName(bundles.length === 1 ? hostSlug(bundles[0].origin) : null, now);
    progress.folder = `${root}.zip`;

    // Plan the entry count up front so the progress line is honest.
    let total = bundles.length ? 0 : 1;
    for (const b of bundles) total += 7 + b.states.length + b.states.filter((s) => s.domRef).length + b.states.filter((s) => s.screenshotRef).length;
    if (multi) total += 1;
    progress.total = total;

    await ensureOffscreen();
    await askOffscreen({ type: MSG.OFFSCREEN_ZIP_RESET });

    if (!bundles.length) {
      // Empty session: still a valid package.
      const empty = manifestFor({ origin: '', states: [], net: [], transitions: [], deps: [] }, meta, [], 0);
      if (!(await addFile(`${root}/manifest.json`, json(empty)))) failed++;
    }

    if (multi) {
      const combined = { tool: TOOL_NAME, version: TOOL_VERSION, exportedAt: now.toISOString(), origins: bundles.map((b) => b.origin), folders: bundles.map((b) => hostSlug(b.origin)) };
      if (!(await addFile(`${root}/manifest.json`, json(combined)))) failed++;
    }

    for (const b of bundles) {
      const dir = multi ? `${root}/${hostSlug(b.origin)}` : root;
      const map = buildFlowMap(b.states, b.deps, b.transitions, meta.timeline, b.origin);
      const selectors = buildSelectorsFile(map);
      const manifest = manifestFor(b, meta, bundles.map((x) => x.origin), map.lists.length);

      if (!(await addFile(`${dir}/manifest.json`, json(manifest)))) failed++;
      if (!(await addFile(`${dir}/AUTOMATION-BRIEF.md`, textFile(buildBrief(b.states, map, meta, b.net))))) failed++;
      if (!(await addFile(`${dir}/SUMMARY.md`, textFile(buildSummary(b.states, map, meta, b.net.length))))) failed++;
      if (!(await addFile(`${dir}/flow-map.json`, json(map)))) failed++;
      if (!(await addFile(`${dir}/selectors.json`, json(selectors)))) failed++;
      if (!(await addFile(`${dir}/playwright-skeleton.ts`, textFile(buildSkeleton(b.states, map, selectors), 'text/plain')))) failed++;
      if (!(await addFile(`${dir}/network.har`, json(buildHar(b.net))))) failed++;

      for (const s of b.states) {
        if (!(await addFile(`${dir}/states/${stemFor(s)}.json`, json(s)))) failed++;
      }
      for (const s of b.states) {
        if (!s.domRef) continue;
        const gz = await store.getDom(s.id);
        if (!gz) {
          progress.current++;
          failed++;
          continue;
        }
        if (!(await addFile(`${dir}/dom/${stemFor(s)}.html`, { gzipBase64: gz, mime: 'text/html' }))) failed++;
      }
      for (const s of b.states) {
        if (!s.screenshotRef) continue;
        const png = await store.getScreenshot(s.id);
        if (!png) {
          progress.current++;
          failed++;
          continue;
        }
        if (!(await addFile(`${dir}/screens/${stemFor(s)}.png`, { base64: png, mime: 'image/png' }))) failed++;
      }
    }

    if (failed) progress.warning = `${failed} of ${progress.total} entries could not be packed and were skipped`;
    await downloadZip(`${root}.zip`);
  } catch (e) {
    progress.error = errText(e);
  } finally {
    await closeOffscreen();
    progress.phase = 'idle';
    progress.active = false;
  }
}
