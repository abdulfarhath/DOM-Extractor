/**
 * Export pipeline — docs/03, docs/09 Q14/Q15. One timestamped folder under
 * Downloads, one package per consented origin, written sequentially through
 * chrome.downloads from blob: URLs minted by the offscreen document. The
 * states array is the only thing held whole; snapshots stream one key at a
 * time. Progress lives in module memory and reaches the panel via GET_STATS.
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
      justification: 'Create blob URLs for export files; service workers cannot.',
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
 * @param {{ text?: string, base64?: string, gzipBase64?: string, mime: string }} payload
 * @returns {Promise<string>}   blob: URL
 */
async function makeBlobUrl(payload) {
  const r = await chrome.runtime.sendMessage({ target: 'offscreen', type: MSG.OFFSCREEN_MAKE_BLOB, ...payload });
  if (!r || typeof r.url !== 'string') throw new Error((r && r.error) || 'offscreen document did not answer');
  return r.url;
}

/** @param {string} url */
async function revokeBlobUrl(url) {
  try {
    await chrome.runtime.sendMessage({ target: 'offscreen', type: MSG.OFFSCREEN_REVOKE, url });
  } catch {
    /* document gone */
  }
}

// ------------------------------------------------------------- downloads

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
    await sleep(150);
  }
  return 'timeout';
}

/**
 * One file. Failures are counted, not fatal — a bad snapshot must not stop
 * the flow map from landing on disk.
 * @param {string} path   relative to Downloads, folder included
 * @param {{ text?: string, base64?: string, gzipBase64?: string, mime: string }} payload
 * @returns {Promise<boolean>}
 */
async function writeFile(path, payload) {
  const t0 = Date.now();
  let url = '';
  try {
    url = await makeBlobUrl(payload);
    const id = await chrome.downloads.download({ url, filename: path, conflictAction: 'uniquify', saveAs: false });
    const state = await waitForDownload(id, TIMING.DOWNLOAD_WAIT_MS);
    if (!progress.warning && Date.now() - t0 > TIMING.PROMPT_SUSPECT_MS) {
      progress.warning =
        'Chrome seems to be asking where to save each file. Turn off "Ask where to save each file before downloading" in chrome://settings/downloads. The export continues either way.';
    }
    if (state !== 'complete') console.warn('[flowprint] download', path, state);
    return state === 'complete';
  } catch (e) {
    console.warn('[flowprint] export write failed:', path, errText(e));
    return false;
  } finally {
    if (url) await revokeBlobUrl(url);
    progress.current++;
    await sleep(TIMING.EXPORT_FILE_GAP_MS);
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
    const root = exportFolderName(bundles.length === 1 ? hostSlug(bundles[0].origin) : null, now);
    progress.folder = root;

    // Plan the file count up front so the progress line is honest.
    let total = bundles.length ? 0 : 1;
    for (const b of bundles) total += 7 + b.states.length + b.states.filter((s) => s.domRef).length + b.states.filter((s) => s.screenshotRef).length;
    if (multi) total += 1;
    progress.total = total;

    await ensureOffscreen();

    if (!bundles.length) {
      // Empty session: still a valid package.
      const empty = manifestFor({ origin: '', states: [], net: [], transitions: [], deps: [] }, meta, [], 0);
      if (!(await writeFile(`${root}/manifest.json`, json(empty)))) failed++;
    }

    if (multi) {
      const combined = { tool: TOOL_NAME, version: TOOL_VERSION, exportedAt: now.toISOString(), origins: bundles.map((b) => b.origin), folders: bundles.map((b) => hostSlug(b.origin)) };
      if (!(await writeFile(`${root}/manifest.json`, json(combined)))) failed++;
    }

    for (const b of bundles) {
      const dir = multi ? `${root}/${hostSlug(b.origin)}` : root;
      const map = buildFlowMap(b.states, b.deps, b.transitions, meta.timeline, b.origin);
      const selectors = buildSelectorsFile(map);
      const manifest = manifestFor(b, meta, bundles.map((x) => x.origin), map.lists.length);

      if (!(await writeFile(`${dir}/manifest.json`, json(manifest)))) failed++;
      if (!(await writeFile(`${dir}/AUTOMATION-BRIEF.md`, textFile(buildBrief(b.states, map, meta, b.net))))) failed++;
      if (!(await writeFile(`${dir}/SUMMARY.md`, textFile(buildSummary(b.states, map, meta, b.net.length))))) failed++;
      if (!(await writeFile(`${dir}/flow-map.json`, json(map)))) failed++;
      if (!(await writeFile(`${dir}/selectors.json`, json(selectors)))) failed++;
      if (!(await writeFile(`${dir}/playwright-skeleton.ts`, textFile(buildSkeleton(b.states, map, selectors), 'text/plain')))) failed++;
      if (!(await writeFile(`${dir}/network.har`, json(buildHar(b.net))))) failed++;

      for (const s of b.states) {
        if (!(await writeFile(`${dir}/states/${stemFor(s)}.json`, json(s)))) failed++;
      }
      for (const s of b.states) {
        if (!s.domRef) continue;
        const gz = await store.getDom(s.id);
        if (!gz) {
          progress.current++;
          failed++;
          continue;
        }
        if (!(await writeFile(`${dir}/dom/${stemFor(s)}.html`, { gzipBase64: gz, mime: 'text/html' }))) failed++;
      }
      for (const s of b.states) {
        if (!s.screenshotRef) continue;
        const png = await store.getScreenshot(s.id);
        if (!png) {
          progress.current++;
          failed++;
          continue;
        }
        if (!(await writeFile(`${dir}/screens/${stemFor(s)}.png`, { base64: png, mime: 'image/png' }))) failed++;
      }
    }

    if (failed) progress.error = `${failed} of ${progress.total} files failed to write`;
  } catch (e) {
    progress.error = errText(e);
  } finally {
    await closeOffscreen();
    progress.active = false;
  }
}
