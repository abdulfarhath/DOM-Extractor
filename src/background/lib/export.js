/**
 * Export pipeline — docs/03, docs/09 Q14/Q15, docs/12 B8. One zip under
 * Downloads holding the timestamped folder layout, one package per consented
 * origin. Every artifact is built here and streamed entry by entry to the
 * offscreen document, which compresses it into the archive and mints the
 * single blob: URL for one chrome.downloads call. The record logs (states,
 * actions, downloads, net) are held whole; snapshots, screenshots and full
 * API bodies stream one key at a time. Progress lives in module memory
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
import { buildSiteMap } from './sitemap.js';
import { buildRoutes } from './routes.js';
import { buildApiCatalog } from './apicatalog.js';
import { buildCoverage } from './coverage.js';
import { buildRecipes } from './recipes.js';
import { stemFor, exportFolderName, hostSlug } from './naming.js';

/** @typedef {import('../../shared/schema.js').ExportProgress} ExportProgress */
/** @typedef {import('../../shared/schema.js').ExportManifest} ExportManifest */
/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../../shared/schema.js').NetEntry} NetEntry */
/** @typedef {import('../../shared/schema.js').Transition} Transition */
/** @typedef {import('../../shared/schema.js').Dependency} Dependency */
/** @typedef {import('../../shared/schema.js').SessionMeta} SessionMeta */
/** @typedef {import('../../shared/schema.js').ActionEntry} ActionEntry */
/** @typedef {import('../../shared/schema.js').DownloadEntry} DownloadEntry */
/** @typedef {import('../../shared/schema.js').SiteMap} SiteMap */
/** @typedef {import('../../shared/schema.js').RoutesFile} RoutesFile */
/** @typedef {import('../../shared/schema.js').ApiCatalog} ApiCatalog */
/** @typedef {import('../../shared/schema.js').Coverage} Coverage */

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
 * @property {ActionEntry[]} actions
 * @property {DownloadEntry[]} downloads
 */

/**
 * Split the session by origin. States, actions and downloads carry their
 * origin; net entries are attributed by the page that made the call; edges
 * and deps follow states.
 * @param {string[]} consented
 * @param {StateRecord[]} states
 * @param {NetEntry[]} net
 * @param {Transition[]} transitions
 * @param {Dependency[]} deps
 * @param {ActionEntry[]} actions
 * @param {DownloadEntry[]} downloads
 * @returns {OriginBundle[]}
 */
function splitByOrigin(consented, states, net, transitions, deps, actions, downloads) {
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
      actions: actions.filter((a) => a && a.origin === origin),
      downloads: downloads.filter((d) => d && d.origin === origin),
    };
  });
}

/**
 * The derived files of one package. Built before anything is packed so the
 * manifest can count them.
 * @typedef {Object} Derived
 * @property {SiteMap} siteMap
 * @property {RoutesFile} routes
 * @property {ApiCatalog} catalog
 * @property {Coverage} coverage
 */

/**
 * @param {OriginBundle} b
 * @param {SessionMeta} meta
 * @param {string[]} allOrigins
 * @param {number} listPatterns
 * @param {Derived|null} derived
 * @param {{ written: number, missing: number }} bodies   full bodies packed and not found
 * @returns {ExportManifest}
 */
function manifestFor(b, meta, allOrigins, listPatterns, derived, bodies) {
  /** @type {Map<string, { origin: string, framework: string, version: string|null }>} */
  const fws = new Map();
  for (const s of b.states) {
    if (!fws.has(s.origin) || (s.framework.framework !== 'plain' && fws.get(s.origin)?.framework === 'plain')) {
      fws.set(s.origin, { origin: s.origin, framework: s.framework.framework, version: s.framework.version });
    }
  }
  const blocked = new Set();
  for (const s of b.states) for (const o of s.blockedFrames || []) blocked.add(o);
  const d = meta.degraded;
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
      actions: b.actions.length,
      downloads: b.downloads.length,
      pages: derived ? derived.siteMap.pages.length : 0,
      endpoints: derived ? derived.catalog.endpoints.length : 0,
    },
    redaction: {
      packs: meta.packs,
      fieldValues: 'redacted at capture',
      domValues: 'redacted at capture',
      bodies: bodies.written
        ? 'pattern-scrubbed, NOT guaranteed clean; network.har holds 4000 characters per body, api/bodies/ holds full bodies'
        : 'pattern-scrubbed, NOT guaranteed clean',
      apiShapes: 'shapes only (key names, types, lengths, enum-like values); key names and enum values scrubbed at capture',
      downloads: 'file names never stored (nameShape only); URLs scrubbed without query values; file contents never read',
    },
    // What this package holds, not only what the switch said at the end:
    // bodies kept before it was switched off are still exported.
    keepBodies: meta.keepBodies === 'full' || bodies.written > 0 ? 'full' : 'shape',
    blockedFrames: Array.from(blocked),
    degraded: meta.degraded,
    warnings: [
      'Network response bodies are kept for reference data. Review before sharing.',
      ...(bodies.written ? [`api/bodies/ holds ${bodies.written} full API response bodies. Names, addresses and free text in them cannot be scrubbed automatically. Read them before sharing.`] : []),
      ...(bodies.missing ? [`${bodies.missing} full bodies were flagged but no longer in storage; their hasFullBody is false in this export.`] : []),
      'Screenshots are orientation only; selectors come from states/ and flow-map.json.',
      ...(blocked.size ? ['Some embedded frames were not recorded (blockedFrames). The capture has known blind spots.'] : []),
      ...(d.screenshots || d.snapshots || d.bodiesDropped || d.netTrimmed || d.statesRefused ? ['Storage degradation occurred during the session; see degraded.'] : []),
    ],
    harNote: 'HAR 1.2 shaped, reconstructed from fetch/XHR wrappers. Timings approximate; browser-added request headers absent.',
  };
}

/**
 * Builders are pure and written not to throw, but one that does must cost
 * its own file, not the user's whole export.
 * @template T
 * @param {string} what
 * @param {() => T} build
 * @param {() => T} fallback
 * @param {string[]} problems   collects what went wrong, for the warning line
 * @returns {T}
 */
function attempt(what, build, fallback, problems) {
  try {
    return build();
  } catch (e) {
    console.warn('[flowprint] export builder failed:', what, errText(e));
    problems.push(what);
    return fallback();
  }
}

/**
 * @param {OriginBundle} b
 * @param {string[]} problems
 * @returns {Derived}
 */
function deriveFiles(b, problems) {
  const now = () => new Date().toISOString();
  // Order matters: the site map names the pages and endpoints every later file refers to.
  const catalog = attempt('api-catalog.json', () => buildApiCatalog(b.net, b.states, b.actions, b.origin), () => ({ generatedAt: now(), origin: b.origin, endpoints: [] }), problems);
  const siteMap = attempt(
    'site-map.json',
    () => buildSiteMap(b.states, b.actions, b.transitions, b.downloads, b.net, b.origin),
    () => ({ generatedAt: now(), origin: b.origin, entryStateId: null, menu: [], pages: [] }),
    problems,
  );
  const routes = attempt(
    'routes.json',
    () => buildRoutes(b.states, b.actions, b.transitions, siteMap, b.origin),
    () => ({ generatedAt: now(), origin: b.origin, entryStateId: null, entryRoute: null, recipes: [] }),
    problems,
  );
  const coverage = attempt(
    'coverage.json',
    () => buildCoverage(siteMap, b.states, b.actions, b.downloads, b.origin),
    () => ({
      generatedAt: now(),
      origin: b.origin,
      totals: { menuItems: 0, menuVisited: 0, pages: 0, viewOptions: 0, viewOptionsVisited: 0, lists: 0, listsPaged: 0, downloads: 0 },
      unvisitedMenu: [],
      pages: [],
      hints: [],
    }),
    problems,
  );
  return { siteMap, routes, catalog, coverage };
}

/** Entries every per-origin package holds besides states, dom, screens and bodies. */
const FIXED_FILES = 14;

async function doExport() {
  let failed = 0;
  /** @type {string[]} */
  const problems = [];
  try {
    const { meta, states, net, transitions, deps, actions, downloads, consented } = await store.enqueue(async () => ({
      meta: await store.getMeta(),
      states: await store.getStates(),
      net: await store.getNet(),
      transitions: await store.getTransitions(),
      deps: await store.getDeps(),
      actions: await store.getActions(),
      downloads: await store.getDownloads(),
      consented: await origins.listOrigins(),
    }));

    const bundles = splitByOrigin(consented, states, net, transitions, deps, actions, downloads);
    const now = new Date();
    const multi = bundles.length > 1;
    // The zip unpacks to the same timestamped folder the files used to be written into.
    const root = exportFolderName(bundles.length === 1 ? hostSlug(bundles[0].origin) : null, now);
    progress.folder = `${root}.zip`;

    // Plan the entry count up front so the progress line is honest.
    let total = bundles.length ? 0 : 1;
    for (const b of bundles) {
      total += FIXED_FILES + b.states.length + b.states.filter((s) => s.domRef).length + b.states.filter((s) => s.screenshotRef).length;
      total += b.net.filter((n) => n.hasFullBody).length;
    }
    if (multi) total += 1;
    progress.total = total;

    await ensureOffscreen();
    await askOffscreen({ type: MSG.OFFSCREEN_ZIP_RESET });

    if (!bundles.length) {
      // Empty session: still a valid package.
      const empty = manifestFor({ origin: '', states: [], net: [], transitions: [], deps: [], actions: [], downloads: [] }, meta, [], 0, null, { written: 0, missing: 0 });
      if (!(await addFile(`${root}/manifest.json`, json(empty)))) failed++;
    }

    if (multi) {
      const combined = { tool: TOOL_NAME, version: TOOL_VERSION, exportedAt: now.toISOString(), origins: bundles.map((b) => b.origin), folders: bundles.map((b) => hostSlug(b.origin)) };
      if (!(await addFile(`${root}/manifest.json`, json(combined)))) failed++;
    }

    for (const b of bundles) {
      const dir = multi ? `${root}/${hostSlug(b.origin)}` : root;

      // ---- full bodies first, one at a time: a flag with no body behind it
      // is cleared before any file says hasFullBody, so every file agrees.
      /** @type {string[]} */
      const bodyIds = [];
      /** @type {Set<string>} */
      const missing = new Set();
      for (const n of b.net) {
        if (!n.hasFullBody) continue;
        const body = await store.getNetBody(n.id);
        if (body == null) {
          missing.add(n.id);
          progress.current++;
          continue;
        }
        if (await addFile(`${dir}/api/bodies/${n.id}.json`, { text: body, mime: 'application/json' })) bodyIds.push(n.id);
        else {
          missing.add(n.id);
          failed++;
        }
      }
      if (missing.size) b.net = b.net.map((n) => (missing.has(n.id) ? { ...n, hasFullBody: false } : n));
      // The prose describes what is in the folder, not what the switch said.
      /** @type {SessionMeta} */
      const bundleMeta = { ...meta, keepBodies: bodyIds.length ? 'full' : 'shape' };

      const map = attempt('flow-map.json', () => buildFlowMap(b.states, b.deps, b.transitions, meta.timeline, b.origin), () => ({ generatedAt: now.toISOString(), origin: b.origin, framework: 'plain', pages: [], controls: [], lists: [], dependencies: [], transitions: b.transitions, timeline: meta.timeline }), problems);
      const selectors = attempt('selectors.json', () => buildSelectorsFile(map), () => ({ selectors: {}, fallbacks: {}, shadowPaths: {} }), problems);
      const derived = deriveFiles(b, problems);
      const { siteMap, routes, catalog, coverage } = derived;
      const manifest = manifestFor(b, meta, bundles.map((x) => x.origin), map.lists.length, derived, { written: bodyIds.length, missing: missing.size });
      const extras = { siteMap, routes, catalog, coverage, actions: b.actions, downloads: b.downloads };

      /** @type {[string, () => { text: string, mime: string }][]} */
      const files = [
        ['manifest.json', () => json(manifest)],
        ['AUTOMATION-BRIEF.md', () => textFile(buildBrief(b.states, map, bundleMeta, b.net, extras))],
        ['RECIPES.md', () => textFile(buildRecipes(siteMap, routes, catalog, coverage, b.downloads, { actions: b.actions, lists: map.lists, fullBodies: bodyIds }))],
        ['SUMMARY.md', () => textFile(buildSummary(b.states, map, bundleMeta, b.net.length, extras))],
        ['site-map.json', () => json(siteMap)],
        ['routes.json', () => json(routes)],
        ['api-catalog.json', () => json(catalog)],
        ['coverage.json', () => json(coverage)],
        ['actions.json', () => json(b.actions)],
        ['downloads.json', () => json(b.downloads)],
        ['flow-map.json', () => json(map)],
        ['selectors.json', () => json(selectors)],
        ['playwright-skeleton.ts', () => textFile(buildSkeleton(b.states, map, selectors, { siteMap, routes, actions: b.actions }), 'text/plain')],
        ['network.har', () => json(buildHar(b.net))],
      ];
      for (const [name, build] of files) {
        const payload = attempt(name, build, () => null, problems);
        if (!payload) {
          progress.current++;
          failed++;
          continue;
        }
        if (!(await addFile(`${dir}/${name}`, payload))) failed++;
      }

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

    /** @type {string[]} */
    const notes = [];
    if (failed) notes.push(`${failed} of ${progress.total} entries could not be packed and were skipped`);
    if (problems.length) notes.push(`could not build ${Array.from(new Set(problems)).join(', ')}`);
    if (notes.length) progress.warning = notes.join('; ');
    await downloadZip(`${root}.zip`);
  } catch (e) {
    progress.error = errText(e);
  } finally {
    await closeOffscreen();
    progress.phase = 'idle';
    progress.active = false;
  }
}
