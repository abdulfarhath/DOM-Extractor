#!/usr/bin/env node
/**
 * Flowprint end-to-end harness.
 *
 * Loads the extension in a real Chromium, plays a human using the fixture
 * portal (tools/e2e/fixture), exports, unzips, and runs tools/e2e/checks.mjs
 * over the result. The extension is never driven directly: the harness only
 * sends the messages the side panel sends, and clicks the fixture with real
 * input events.
 *
 *   node tools/e2e/run.mjs [--keep] [--headed] [--in-place] [--stub-missing]
 *                          [--pace <ms>] [--retry-load <n>] [--no-proxy]
 *                          [--checks-only <runDir>]
 *
 * See tools/e2e/README.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { startFixtureServer, FIXTURE, ledgerResponseBytes } from './fixture/server.mjs';
import { startEgressProxy } from './lib/proxy.mjs';
import { preflight } from './lib/preflight.mjs';
import { unzipTo } from './lib/unzip.mjs';
import { runChecks, printResults } from './checks.mjs';

// Service-worker network events are opt-in in Playwright; the egress check wants them.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS || '1';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SCRATCH = process.env.E2E_SCRATCH || path.join(os.tmpdir(), 'claude-1000', '-home-farhath', '2322fc6a-7563-40b7-9707-8928bff02097', 'scratchpad', 'e2e');

/** Human pacing: the recorder debounces at 900 ms and stores at most one state per 2 s per document. */
const PACE_MS = 2500;
/** Short pause between two inputs that belong to the same gesture (open a menu, then pick). */
const BREATH_MS = 600;
/**
 * A person looks at an opened menu before choosing. Long enough for the
 * recorder's debounce, so a state can be stored while an overlay panel exists.
 */
const MENU_LOOK_MS = 2500;

// ------------------------------------------------------------------ args

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : dflt;
};
const OPTS = {
  keep: flag('--keep'),
  headed: flag('--headed'),
  inPlace: flag('--in-place'),
  stubMissing: flag('--stub-missing'),
  noProxy: flag('--no-proxy'),
  pace: Number(value('--pace', PACE_MS)) || PACE_MS,
  retryLoad: Number(value('--retry-load', 0)) || 0,
  checksOnly: value('--checks-only', null),
};

const log = (...a) => console.log(`[e2e ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ playwright

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_CORE, '/home/farhath/Documents/vcfo-suite/node_modules/playwright-core/index.mjs', 'playwright-core'].filter(Boolean);
  const errors = [];
  for (const c of candidates) {
    try {
      const spec = c.startsWith('/') || c.startsWith('.') ? pathToFileURL(c).href : c;
      const mod = await import(spec);
      return { chromium: mod.chromium, from: c };
    } catch (e) {
      errors.push(`${c}: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    }
  }
  throw new Error(`playwright-core not found. Set PLAYWRIGHT_CORE to its index.mjs.\n  ${errors.join('\n  ')}`);
}

// ------------------------------------------------------------- extension

/**
 * Snapshot the extension into the run folder so a file another engineer is
 * saving mid-run cannot change what the browser loaded. --in-place loads the
 * repo folder itself.
 */
function prepareExtension(runDir) {
  if (OPTS.inPlace) return { dir: REPO, stubbed: [] };
  const dir = path.join(runDir, 'ext');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(REPO, 'manifest.json'), path.join(dir, 'manifest.json'));
  fs.cpSync(path.join(REPO, 'src'), path.join(dir, 'src'), { recursive: true });
  const stubbed = [];
  if (OPTS.stubMissing) {
    const pf = preflight(dir);
    for (const f of pf.missingContentScripts) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), '/* e2e harness stub: this file was missing in the repo when the run started */\n');
      stubbed.push(f);
    }
  }
  return { dir, stubbed };
}

/**
 * Chromium's own background traffic (component updates, time sync, password
 * leak checks, autofill, sign-in) would otherwise reach the egress proxy and
 * be indistinguishable from the extension phoning home.
 */
const QUIET_ARGS = [
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-sync',
  '--disable-default-apps',
  '--disable-domain-reliability',
  '--disable-client-side-phishing-detection',
  '--no-pings',
  '--no-first-run',
  '--no-default-browser-check',
  '--metrics-recording-only',
  '--password-store=basic',
  '--use-mock-keychain',
  '--disable-features=AutofillServerCommunication,PasswordLeakDetection,OptimizationHints,OptimizationGuideModelDownloading,MediaRouter,Translate,CertificateTransparencyComponentUpdater,NetworkTimeServiceQuerying,SafeBrowsingEnhancedProtection',
];

/**
 * A fresh profile whose download folder is the run's own. Without this,
 * chrome.downloads (the export zip) and page downloads land in the user's
 * real ~/Downloads, whatever Playwright's downloadsPath says.
 */
function seedProfile(profile, downloads) {
  fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
  const prefs = {
    download: { default_directory: downloads, prompt_for_download: false, directory_upgrade: true },
    savefile: { default_directory: downloads },
    credentials_enable_service: false,
    profile: { password_manager_enabled: false, password_manager_leak_detection: false },
    safebrowsing: { enabled: false },
    signin: { allowed: false },
    translate: { enabled: false },
  };
  fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify(prefs));
}

/**
 * Try the launch combinations in order until the extension's service worker
 * shows up. Returns the context plus which combination worked.
 */
async function launchWithExtension(chromium, extDir, runDir, proxy) {
  const combos = [];
  if (!OPTS.headed) combos.push({ name: 'channel=chromium headless=true', headless: true });
  const haveDisplay = !!process.env.DISPLAY;
  const xvfb = spawnSync('which', ['xvfb-run'], { encoding: 'utf8' }).status === 0;
  if (haveDisplay || OPTS.headed) combos.push({ name: `channel=chromium headless=false (DISPLAY=${process.env.DISPLAY || 'unset'})`, headless: false });
  if (!haveDisplay && xvfb) combos.push({ name: 'channel=chromium headless=false under xvfb-run (re-exec)', xvfb: true });

  let attempt = 0;
  for (const combo of combos) {
    if (combo.xvfb) {
      // Re-run this very script under xvfb-run with --headed so the rest of the code path is identical.
      log(`re-launching under xvfb-run: ${combo.name}`);
      const r = spawnSync('xvfb-run', ['-a', process.execPath, ...process.argv.slice(1), '--headed'], { stdio: 'inherit' });
      process.exit(r.status ?? 1);
    }
    attempt++;
    const profile = path.join(runDir, `profile-${attempt}`);
    const downloads = path.join(runDir, 'downloads');
    fs.mkdirSync(downloads, { recursive: true });
    seedProfile(profile, downloads);
    log(`launching: ${combo.name}`);
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: combo.headless,
      args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--window-size=1400,900', ...QUIET_ARGS],
      viewport: { width: 1280, height: 820 },
      acceptDownloads: true,
      downloadsPath: downloads,
      proxy: proxy ? { server: proxy.url } : undefined,
      locale: 'en-US',
    });
    let worker = context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);
    if (worker) return { context, worker, combo: combo.name, downloadsDir: downloads };
    log(`no service worker appeared with ${combo.name}`);
    await context.close().catch(() => {});
  }
  return null;
}

/**
 * The control browser for the egress check: same flags, same kind of fresh
 * profile, no extension. It signs in to the fixture the way the human does
 * (a password field is what wakes Chromium's leak check) and then sits idle.
 */
async function startBaseline(chromium, runDir, fixture) {
  const proxy = await startEgressProxy({ fixturePort: fixture.port });
  const profile = path.join(runDir, 'profile-baseline');
  const downloads = path.join(runDir, 'downloads-baseline');
  fs.mkdirSync(downloads, { recursive: true });
  seedProfile(profile, downloads);
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: QUIET_ARGS, proxy: { server: proxy.url } });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(`${fixture.origin}${FIXTURE.basePath}`);
  await page.locator('#userId').click();
  await page.keyboard.type('baseline-user', { delay: 20 });
  await page.locator('#password').click();
  await page.keyboard.type('Baseline-Pass-1234', { delay: 20 });
  await page.getByRole('button', { name: 'Sign in' }).click();
  return {
    proxy,
    close: async () => {
      await context.close().catch(() => {});
      await proxy.close();
    },
  };
}

// --------------------------------------------------------------- browser glue

/** Everything the harness watched while the browser ran. */
function makeLogs() {
  return { worker: [], pages: [], panel: [], requests: [], launch: [] };
}

function watchPage(page, logs, bucket, { skipExtensionPages = false } = {}) {
  const tag = () => page.url().slice(0, 120);
  const skip = () => skipExtensionPages && page.url().startsWith('chrome-extension://');
  page.on('console', (m) => {
    if (skip()) return;
    const type = m.type();
    if (type === 'error' || type === 'warning' || /\[flowprint\]|__FP|fp:/i.test(m.text())) {
      bucket.push({ at: new Date().toISOString(), page: tag(), type, text: m.text().slice(0, 600), location: m.location() ? `${m.location().url}:${m.location().lineNumber}` : '' });
    }
  });
  page.on('pageerror', (e) => !skip() && bucket.push({ at: new Date().toISOString(), page: tag(), type: 'pageerror', text: String(e && e.message ? e.message : e).slice(0, 600), stack: String(e && e.stack ? e.stack : '').slice(0, 800) }));
}

/**
 * The panel page: opened as an ordinary tab, it gives us chrome.runtime and
 * chrome.storage in the extension's own context. We send exactly the messages
 * panel.js sends.
 */
class Recorder {
  constructor(page, MSG) {
    this.page = page;
    this.MSG = MSG;
  }
  async send(type, payload = {}) {
    return this.page.evaluate(
      (msg) =>
        new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage(msg, (r) => {
              const err = chrome.runtime.lastError;
              resolve(err ? { __error: err.message } : r);
            });
          } catch (e) {
            resolve({ __error: String(e && e.message ? e.message : e) });
          }
        }),
      { type, ...payload }
    );
  }
  async stats() {
    return this.send(this.MSG.GET_STATS);
  }
  async storageKeys() {
    return this.page.evaluate(async () => {
      const all = await chrome.storage.local.get(null);
      return Object.keys(all);
    });
  }
  async storageGet(key) {
    return this.page.evaluate(async (k) => {
      const r = await chrome.storage.local.get(k);
      return r[k];
    }, key);
  }
  async fixtureTabId(origin) {
    return this.page.evaluate(async (o) => {
      const tabs = await chrome.tabs.query({ url: `${o}/*` });
      return tabs.length ? tabs[0].id : null;
    }, origin);
  }
}

// ------------------------------------------------------------------ run

async function main() {
  if (OPTS.checksOnly) return checksOnly(OPTS.checksOnly);

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const runDir = path.join(SCRATCH, `run-${stamp}`);
  fs.mkdirSync(runDir, { recursive: true });
  log(`run folder: ${runDir}`);

  const logs = makeLogs();
  /** Ground truth about what the human did, handed to the checks. */
  const session = {
    startedAt: new Date().toISOString(),
    paceMs: OPTS.pace,
    origin: null,
    clicks: [],
    typed: {},
    visitedByClick: [],
    neverClicked: { menu: FIXTURE.menus.neverClicked, tab: FIXTURE.views.tabNeverClicked, chip: FIXTURE.views.chipNeverClicked, danger: FIXTURE.dangerLabel },
    keepBodies: { fullFrom: null, fullTo: null, replies: [] },
    storageSamples: [],
    statsNoConsent: null,
    statsEnd: null,
    downloadsFromStorageAfterExport: null,
    exportProgress: null,
    panelText: null,
    actedUpon: [],
    trapHits: [],
    requests: [],
    proxySeen: [],
    detailIds: [],
    stubbedFiles: [],
    launch: null,
  };

  const homeDownloads = path.join(os.homedir(), 'Downloads');
  const listHome = () => {
    try {
      return fs.readdirSync(homeDownloads);
    } catch {
      return [];
    }
  };
  const homeBefore = new Set(listHome());

  const fixture = await startFixtureServer({ quiet: true });
  session.origin = fixture.origin;
  log(`fixture at ${fixture.origin}${FIXTURE.basePath} (large endpoint ${ledgerResponseBytes()} bytes)`);
  const proxy = OPTS.noProxy ? null : await startEgressProxy({ fixturePort: fixture.port });
  if (proxy) log(`egress proxy at ${proxy.url}`);

  const { chromium, from } = await loadPlaywright();
  log(`playwright-core from ${from}`);

  // Chromium contacts Google on its own whatever the flags (sign-in, GCM, time sync). A second
  // browser with the same flags and no extension runs alongside the session, through its own
  // proxy; hosts only it also reached are the browser's, not the extension's.
  const baseline = OPTS.noProxy ? null : await startBaseline(chromium, runDir, fixture).catch((e) => {
    log(`baseline browser could not start: ${e.message}`);
    return null;
  });

  // ---- launch, with retries for a mid-edit extension
  let launched = null;
  let ext = null;
  for (let attempt = 0; attempt <= OPTS.retryLoad; attempt++) {
    ext = prepareExtension(runDir);
    session.stubbedFiles = ext.stubbed;
    const pf = preflight(ext.dir);
    logs.launch.push({ attempt, preflight: pf });
    if (!pf.ok) {
      log(`preflight found ${pf.problems.length} problem(s):`);
      for (const p of pf.problems) log(`  - ${p}`);
    }
    launched = await launchWithExtension(chromium, ext.dir, runDir, proxy);
    if (launched) break;
    if (attempt < OPTS.retryLoad) {
      log(`extension did not load; waiting 60 s before retry ${attempt + 1}/${OPTS.retryLoad}`);
      await sleep(60000);
    }
  }
  if (!launched) {
    const pf = logs.launch[logs.launch.length - 1].preflight;
    const results = [{ name: 'extension loads in the browser', status: 'FAIL', expected: 'a service worker at chrome-extension://<id>/src/background/service-worker.js', found: pf.problems.length ? `no worker; preflight: ${pf.problems.join('; ')}` : 'no worker appeared with any launch combination and preflight found nothing wrong' }];
    finish(runDir, { results, session, logs, exportDir: null });
    if (baseline) await baseline.close();
    await fixture.close();
    if (proxy) await proxy.close();
    process.exit(2);
  }
  const { context, worker, combo, downloadsDir } = launched;
  session.launch = combo;
  log(`extension loaded with ${combo}`);
  const extensionId = new URL(worker.url()).host;

  worker.on('console', (m) => logs.worker.push({ at: new Date().toISOString(), type: m.type(), text: m.text().slice(0, 800) }));
  context.on('serviceworker', (w) => w.on('console', (m) => logs.worker.push({ at: new Date().toISOString(), type: m.type(), text: `(restarted worker) ${m.text().slice(0, 800)}` })));
  // Prove the worker-console pipe works, so "no worker errors" in the report means something.
  try {
    await worker.evaluate(() => console.warn('[e2e] worker console probe'));
    await sleep(300);
    session.workerConsoleWired = logs.worker.some((l) => l.text.includes('[e2e] worker console probe'));
  } catch (e) {
    session.workerConsoleWired = `probe failed: ${e.message}`;
  }
  log(`worker console capture: ${session.workerConsoleWired === true ? 'wired' : session.workerConsoleWired}`);
  context.on('weberror', (e) => logs.pages.push({ at: new Date().toISOString(), page: e.page() ? e.page().url() : '?', type: 'weberror', text: String(e.error() && e.error().message).slice(0, 600) }));
  context.on('request', (r) => {
    let host = '';
    let scheme = '';
    try {
      const u = new URL(r.url());
      host = u.host;
      scheme = u.protocol.replace(':', '');
    } catch {
      host = r.url().slice(0, 60);
    }
    logs.requests.push({ at: Date.now(), scheme, host, url: r.url().slice(0, 200), type: r.resourceType(), fromWorker: !!r.serviceWorker() });
  });
  // Extension pages (the panel tab) report into their own bucket; this one is for the fixture's tabs.
  context.on('page', (p) => watchPage(p, logs, logs.pages, { skipExtensionPages: true }));

  // Real file names on disk: Playwright's own download handling renames to GUIDs, which
  // would also feed the extension a GUID as the download's file name. 'default' hands
  // downloads back to Chrome, which then uses the folder seeded in the profile's Preferences.
  try {
    const cdp = await context.browser().newBrowserCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' });
    await cdp.detach();
  } catch (e) {
    log(`could not override download behaviour: ${e.message}`);
  }

  // ---- message names from the extension itself, at run time
  const panel = await context.newPage();
  watchPage(panel, logs, logs.panel);
  // The side panel cannot be attached by automation, so the panel page runs in a tab and
  // is told which tab is "active": the fixture's. Only the tab lookup is shimmed.
  await panel.addInitScript((origin) => {
    try {
      const orig = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = (q, cb) => {
        const wantsActive = q && q.active && (q.lastFocusedWindow || q.currentWindow);
        const p = wantsActive ? orig({ url: `${origin}/*` }).then((tabs) => tabs.slice(0, 1)) : orig(q);
        if (typeof cb === 'function') {
          p.then(cb, () => cb([]));
          return undefined;
        }
        return p;
      };
    } catch {
      /* leave the panel alone */
    }
  }, fixture.origin);
  await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/panel.html`);
  const consts = await panel.evaluate(async () => {
    const m = await import(chrome.runtime.getURL('src/shared/constants.js'));
    return { MSG: { ...m.MSG }, KEYS: { ...m.KEYS }, TIMING: { ...m.TIMING }, CAPS: { ...m.CAPS } };
  });
  const { MSG, KEYS } = consts;
  const rec = new Recorder(panel, MSG);
  const NETBODY_PREFIX = KEYS.NETBODY_PREFIX || 'fp:netbody:';

  const sampleStorage = async (label) => {
    try {
      const keys = await rec.storageKeys();
      const stats = await rec.stats();
      session.storageSamples.push({ at: new Date().toISOString(), label, keepBodies: stats && stats.keepBodies, netbodyKeys: keys.filter((k) => k.startsWith(NETBODY_PREFIX)), total: keys.length });
    } catch (e) {
      session.storageSamples.push({ at: new Date().toISOString(), label, error: String(e.message || e) });
    }
  };

  // ---- the human's browser tab
  const page = await context.newPage();
  const portal = `${fixture.origin}${FIXTURE.basePath}`;
  const routeOf = (p) => {
    const u = new URL(p.url());
    const m = /^#(\/[^?]*)/.exec(u.hash || '');
    return u.pathname + (m ? `#${m[1]}` : '');
  };

  let n = 0;
  /**
   * One human gesture. `incidental` clicks (into a text field, on a label) are
   * not something the recorder must turn into an action.
   */
  const act = async (label, fn, { kind = 'click', pace = OPTS.pace, incidental = false, names = [], expectRoute = null } = {}) => {
    n++;
    const before = routeOf(page);
    const at = new Date().toISOString();
    log(`  ${String(n).padStart(2)}. ${kind} ${label}`);
    await fn();
    await sleep(pace);
    let after = before;
    try {
      after = routeOf(page);
    } catch {
      /* page navigated away */
    }
    session.clicks.push({ n, kind, label, names: [label, ...names], routeBefore: before, routeAfter: after, at, incidental, expectRoute });
    if (!incidental && kind === 'click' && after !== before && !session.visitedByClick.includes(after)) session.visitedByClick.push(after);
    if (expectRoute && after !== expectRoute) log(`     ! expected route ${expectRoute}, page is at ${after}`);
    await sampleStorage(label);
  };
  const click = (locator, label, opts) => act(label, () => locator.click(), opts);

  // =========================================================== phase A: no consent
  log('phase A: browse without consent');
  await page.goto(portal);
  await page.waitForSelector('h1');
  await sleep(OPTS.pace);
  await page.getByRole('link', { name: 'Filing guide' }).click();
  await sleep(OPTS.pace);
  await page.getByRole('link', { name: 'Back to sign in' }).click();
  await sleep(OPTS.pace);
  session.statsNoConsent = await rec.stats();
  session.storageNoConsent = await rec.storageKeys();
  log(`  stats without consent: states=${session.statsNoConsent?.states} net=${session.statsNoConsent?.net} actions=${session.statsNoConsent?.actions} downloads=${session.statsNoConsent?.downloads}`);

  // =========================================================== phase B: consent
  log('phase B: consent, reload');
  // The india pack is what catches PAN-shaped strings; the fixture is on localhost, so a human would tick it in Advanced.
  await rec.send(MSG.SET_PACKS, { packs: ['india'] });
  const tabId = await rec.fixtureTabId(fixture.origin);
  const reloaded = page.waitForEvent('load', { timeout: 8000 }).then(() => true, () => false);
  const consent = await rec.send(MSG.ADD_ORIGIN, { origin: fixture.origin, tabId });
  session.consentReply = consent;
  if (!(await reloaded)) {
    log('  worker did not reload the tab; reloading it from the harness');
    await page.reload();
  }
  await page.waitForSelector('h1');
  await sleep(OPTS.pace);
  await sampleStorage('after consent');

  // =========================================================== phase C: the session
  log('phase C: scripted human session');
  const userId = 'TPR4471-login';
  const password = 'Vx7-Horse-Staple-Battery';
  const subjectText = 'Quarterly reconciliation memo 7Q';
  const fileName = 'bank-statement-8842-rao.pdf';
  const filePath = path.join(runDir, fileName);
  fs.writeFileSync(filePath, '%PDF-1.4\n% fixture attachment, not a real statement\n');
  session.typed = { userId, password, subjectText, fileName };

  // login
  await act('User id field', () => page.locator('#userId').click(), { incidental: true, pace: BREATH_MS });
  await page.keyboard.type(userId, { delay: 30 });
  await act('Password field', () => page.locator('#password').click(), { incidental: true, pace: BREATH_MS });
  await page.keyboard.type(password, { delay: 30 });
  await click(page.getByRole('button', { name: 'Sign in' }), 'Sign in', { expectRoute: FIXTURE.routes.dashboard });

  // menu (a): nested lists
  await click(page.getByRole('button', { name: 'Filing' }), 'Filing', { pace: MENU_LOOK_MS });
  await click(page.getByRole('link', { name: 'Returns' }), 'Returns', { expectRoute: FIXTURE.routes.returns });

  // paging
  await click(page.getByRole('button', { name: 'Next page' }), 'Next page', { names: ['Next'] });
  await click(page.getByRole('button', { name: 'Next page' }), 'Next page', { names: ['Next'] });
  await click(page.getByRole('button', { name: 'Previous page' }), 'Previous page', { names: ['Previous'] });

  // new tab
  const popupP = context.waitForEvent('page', { timeout: 10000 }).catch(() => null);
  await click(page.getByRole('link', { name: 'Open filing guide' }), 'Open filing guide');
  const popup = await popupP;
  if (popup) {
    await popup.waitForLoadState().catch(() => {});
    await sleep(OPTS.pace);
    session.visitedByClick.push(routeOf(popup));
    session.actedUpon.push(...(await popup.evaluate(() => (window.__fixtureActedUpon ? window.__fixtureActedUpon() : [])).catch(() => [])));
    await popup.close();
  } else {
    log('  ! no new tab opened');
  }
  await page.bringToFront();

  // menu (b): overlay panel, pushState link
  await click(page.getByRole('button', { name: 'Accounts' }), 'Accounts', { pace: MENU_LOOK_MS });
  await click(page.locator('#accounts-menu').getByText('Payments', { exact: true }), 'Payments', { expectRoute: FIXTURE.routes.payments });
  await page.waitForSelector('#ledger-table');
  await sleep(1000);

  // blob download
  await click(page.getByRole('button', { name: 'Export CSV' }), 'Export CSV');
  // Evidence for the blob-download check: is the MAIN-world hint in the worker's tab bookkeeping, and was it consumed?
  session.afterBlob = {
    tabs: await rec.storageGet(KEYS.TABS || 'fp:tabs').catch((e) => ({ error: String(e.message || e) })),
    downloads: await rec.storageGet(KEYS.DOWNLOADS || 'fp:downloads').catch(() => null),
  };

  // keep-bodies: full for a couple of calls
  session.keepBodies.fullFrom = new Date().toISOString();
  session.keepBodies.replies.push({ to: 'full', reply: await rec.send(MSG.SET_KEEP_BODIES, { value: 'full' }), stats: await rec.stats() });
  log(`  keep-bodies → full: ${JSON.stringify(session.keepBodies.replies[0].reply)}`);
  await sleep(BREATH_MS);

  await click(page.getByRole('button', { name: 'Accounts' }), 'Accounts', { pace: MENU_LOOK_MS });
  await click(page.locator('#accounts-menu').getByText('Demands', { exact: true }), 'Demands', { expectRoute: FIXTURE.routes.demands });
  await page.waitForSelector('#demands-table');

  // direct download (content-disposition: attachment)
  await click(page.getByRole('link', { name: 'Download notice' }), 'Download notice');

  // menu (c): ARIA menubar
  await click(page.getByRole('menuitem', { name: 'Compliance' }), 'Compliance', { pace: MENU_LOOK_MS });
  await click(page.getByRole('menuitem', { name: 'Proceedings' }), 'Proceedings', { expectRoute: FIXTURE.routes.proceedings });
  await page.waitForSelector('#proceedings-table');

  session.keepBodies.fullTo = new Date().toISOString();
  session.keepBodies.replies.push({ to: 'shape', reply: await rec.send(MSG.SET_KEEP_BODIES, { value: 'shape' }), stats: await rec.stats() });
  log(`  keep-bodies → shape: ${JSON.stringify(session.keepBodies.replies[1].reply)}`);
  await sleep(BREATH_MS);
  await sampleStorage('after keep-bodies back to shape');

  // row → detail → back
  await click(page.locator('#proceedings-table tbody tr a').first(), 'PR-1001', { names: ['PR-1001'] });
  session.detailIds.push('1001');
  await click(page.getByRole('link', { name: 'Back to proceedings' }), 'Back to proceedings', { expectRoute: FIXTURE.routes.proceedings });
  await page.waitForSelector('#proceedings-table');

  // view groups: one tab, one chip; "Closed" and "Last 12 months" stay unvisited
  await click(page.getByRole('tab', { name: 'Responded' }), 'Responded');
  await click(page.getByRole('button', { name: 'Last 30 days' }), 'Last 30 days');
  await page.waitForSelector('#proceedings-table');
  const secondRow = page.locator('#proceedings-table tbody tr a').first();
  const secondLabel = (await secondRow.innerText()).trim();
  await click(secondRow, secondLabel, { names: [secondLabel] });
  session.detailIds.push(secondLabel.replace(/^PR-/, ''));

  // menu (a), two levels deep → the form
  await click(page.getByRole('button', { name: 'Filing' }), 'Filing', { pace: MENU_LOOK_MS });
  await click(page.getByRole('button', { name: 'Applications' }), 'Applications', { pace: MENU_LOOK_MS });
  await click(page.getByRole('link', { name: 'New application' }), 'New application', { expectRoute: FIXTURE.routes.forms });

  // validation error without submitting: focus the required field, leave it empty, tab away
  await act('Subject field (leave empty)', () => page.locator('#subject').click(), { incidental: true, pace: BREATH_MS });
  await act('Tab away from empty Subject', () => page.keyboard.press('Tab'), { kind: 'key', incidental: true });
  session.validationErrorVisible = await page.locator('#subject-error').isVisible();

  await act('Subject field', () => page.locator('#subject').click(), { incidental: true, pace: BREATH_MS });
  await page.keyboard.type(subjectText, { delay: 25 });
  // native select, driven by keyboard like a person who never opens the popup
  await act('Category label', () => page.locator('label[for="category"]').click(), { incidental: true, pace: BREATH_MS });
  await act('Category → Income', () => page.keyboard.press('ArrowDown'), { kind: 'change', names: ['category', 'Income'] });
  await page.waitForFunction(() => document.querySelectorAll('#subcategory option').length > 1);
  await act('Sub-category label', () => page.locator('label[for="subcategory"]').click(), { incidental: true, pace: BREATH_MS });
  await act('Sub-category → first option', () => page.keyboard.press('ArrowDown'), { kind: 'change', names: ['subcategory'] });
  await act('Effective date field', () => page.locator('#effectiveDate').click(), { incidental: true, pace: BREATH_MS });
  await page.keyboard.type('03152026', { delay: 40 });
  await sleep(OPTS.pace);
  await act('Choose a file', async () => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#attachment').click()]);
    await page.evaluate(() => window.__fixtureDetector && window.__fixtureDetector.harnessSynthetic(true));
    await chooser.setFiles(filePath);
    await page.evaluate(() => window.__fixtureDetector && window.__fixtureDetector.harnessSynthetic(false));
  }, { kind: 'change', names: ['attachment'] });
  // Submit is never clicked.

  // dashboard → shadow DOM button → profile
  await click(page.getByRole('link', { name: 'Dashboard' }), 'Dashboard', { expectRoute: FIXTURE.routes.dashboard });
  await click(page.getByRole('button', { name: 'View profile' }), 'View profile', { expectRoute: FIXTURE.routes.profile });
  await page.waitForSelector('#profile-detail dd');
  await sleep(OPTS.pace);

  // =========================================================== phase D: coverage, stats, panel
  log('phase D: coverage and panel');
  // The panel sends tabId too, and the worker then prefers the route of the last state stored in that
  // tab. So the human goes back to Proceedings first, and the reply the checks read is the one the
  // panel itself would get there.
  await click(page.getByRole('menuitem', { name: 'Compliance' }), 'Compliance', { pace: MENU_LOOK_MS });
  await click(page.getByRole('menuitem', { name: 'Proceedings' }), 'Proceedings', { expectRoute: FIXTURE.routes.proceedings });
  await page.waitForSelector('#proceedings-table');
  const coverageReply = await rec.send(MSG.GET_COVERAGE, { origin: fixture.origin, route: FIXTURE.routes.proceedings, tabId });
  session.coverageWithoutTab = await rec.send(MSG.GET_COVERAGE, { origin: fixture.origin, route: FIXTURE.routes.proceedings });
  fs.writeFileSync(path.join(runDir, 'coverage-reply.json'), JSON.stringify(coverageReply, null, 2));
  try {
    await panel.bringToFront();
    await sleep(6500); // the panel refreshes coverage every 5 s
    session.panelText = await panel.evaluate(() => document.body.innerText);
    await page.bringToFront();
  } catch (e) {
    session.panelText = null;
    log(`  panel text unavailable: ${e.message}`);
  }
  session.statsEnd = await rec.stats();
  log(`  stats: ${JSON.stringify({ states: session.statsEnd?.states, net: session.statsEnd?.net, actions: session.statsEnd?.actions, downloads: session.statsEnd?.downloads, lists: session.statsEnd?.lists })}`);
  session.actedUpon.push(...(await page.evaluate(() => (window.__fixtureActedUpon ? window.__fixtureActedUpon() : [])).catch((e) => [{ kind: 'harness could not read detector', detail: String(e.message) }])));

  // =========================================================== phase E: export
  log('phase E: export');
  const before = new Set(fs.readdirSync(downloadsDir));
  const exportReply = await rec.send(MSG.EXPORT);
  log(`  export reply: ${JSON.stringify(exportReply)}`);
  let progress = null;
  const t0 = Date.now();
  let started = false;
  while (Date.now() - t0 < 180000) {
    const s = await rec.stats();
    progress = s && s.exportProgress;
    if (progress && progress.active) started = true;
    if (progress && (started || progress.folder || progress.error) && !progress.active && progress.phase === 'idle') break;
    if (!progress) break;
    await sleep(500);
  }
  session.exportProgress = progress;
  log(`  export progress: ${JSON.stringify(progress)}`);
  await sleep(1500);
  let zipPath = null;
  for (let i = 0; i < 20 && !zipPath; i++) {
    const now = fs.readdirSync(downloadsDir).filter((f) => !before.has(f) && !f.endsWith('.crdownload'));
    const zips = now.filter((f) => {
      try {
        const fd = fs.openSync(path.join(downloadsDir, f), 'r');
        const b = Buffer.alloc(2);
        fs.readSync(fd, b, 0, 2, 0);
        fs.closeSync(fd);
        return b.toString('latin1') === 'PK';
      } catch {
        return false;
      }
    });
    if (zips.length) zipPath = path.join(downloadsDir, zips.sort()[zips.length - 1]);
    else await sleep(500);
  }
  session.downloadsDirListing = fs.readdirSync(downloadsDir);
  // Only files this run can have made: its own zip (named after the fixture's port) and the fixture's two downloads.
  const ours = (f) => f.includes(`-${fixture.port}-`) || [FIXTURE.downloads.pdfFileName, FIXTURE.downloads.blobFileName].some((n) => f.startsWith(n.replace(/\.[a-z]+$/, '')));
  session.strayDownloads = listHome().filter((f) => !homeBefore.has(f) && ours(f));
  if (session.strayDownloads.length) log(`  ! ${session.strayDownloads.length} file(s) appeared in ${homeDownloads} during the run: ${session.strayDownloads.join(', ')}`);
  session.exportZip = zipPath;
  session.downloadsFromStorageAfterExport = await rec.storageGet(KEYS.DOWNLOADS || 'fp:downloads').catch(() => null);
  session.statsAfterExport = await rec.stats();

  // The panel's own Keep-full-responses box, driven through the panel page after the export so the
  // recording is not affected: does the panel accept the worker's reply?
  try {
    await panel.bringToFront();
    await panel.evaluate(() => {
      const d = document.getElementById('chkKeepBodies')?.closest('details');
      if (d) d.open = true;
    });
    const t0 = Date.now();
    await panel.evaluate(() => document.getElementById('chkKeepBodies').click());
    await sleep(400);
    session.panelKeepBodies = {
      flash: await panel.evaluate(() => { const f = document.getElementById('flash'); return f && !f.hidden ? f.textContent : null; }),
      checkedAfterClick: await panel.evaluate(() => document.getElementById('chkKeepBodies').checked),
      workerKeepBodies: (await rec.stats())?.keepBodies,
      ms: Date.now() - t0,
    };
    await rec.send(MSG.SET_KEEP_BODIES, { value: 'shape' });
    await page.bringToFront();
  } catch (e) {
    session.panelKeepBodies = { error: String(e.message || e) };
  }

  let exportDir = null;
  if (zipPath) {
    exportDir = path.join(runDir, 'export');
    const u = unzipTo(zipPath, exportDir);
    log(`  unzipped ${path.basename(zipPath)} → ${exportDir} (${u.method}, ${u.entries} files)`);
  } else {
    log('  ! no zip appeared in the download folder');
  }

  // =========================================================== wrap up
  session.trapHits = fixture.trapHits;
  session.requests = logs.requests;
  session.proxySeen = proxy ? proxy.seen : null;
  session.baselineSeen = baseline ? baseline.proxy.seen : null;
  if (baseline) await baseline.close();
  session.endedAt = new Date().toISOString();
  fs.writeFileSync(path.join(runDir, 'session.json'), JSON.stringify(session, null, 2));
  fs.writeFileSync(path.join(runDir, 'logs.json'), JSON.stringify(logs, null, 2));

  // =========================================================== checks
  log('running checks');
  const replayBrowser = await chromium.launch({ headless: !OPTS.headed, proxy: proxy ? { server: proxy.url } : undefined });
  let results;
  try {
    results = await runChecks({ exportDir, session, coverageReply, repoRoot: REPO, fixtureOrigin: fixture.origin, fixture: FIXTURE, runDir, browser: replayBrowser, log });
  } finally {
    await replayBrowser.close().catch(() => {});
  }

  await context.close().catch(() => {});
  await fixture.close();
  if (proxy) await proxy.close();

  const code = finish(runDir, { results, session, logs, exportDir });
  if (!OPTS.keep) {
    for (const d of fs.readdirSync(runDir)) if (/^profile-/.test(d)) fs.rmSync(path.join(runDir, d), { recursive: true, force: true });
    if (!OPTS.inPlace) fs.rmSync(path.join(runDir, 'ext'), { recursive: true, force: true });
    log(`browser profile removed; export and results kept in ${runDir} (use --keep to keep the profile too)`);
  }
  process.exit(code);
}

/** Re-run the checks over a kept run folder, e.g. after editing checks.mjs. */
async function checksOnly(runDir) {
  const session = JSON.parse(fs.readFileSync(path.join(runDir, 'session.json'), 'utf8'));
  const coverageReply = fs.existsSync(path.join(runDir, 'coverage-reply.json')) ? JSON.parse(fs.readFileSync(path.join(runDir, 'coverage-reply.json'), 'utf8')) : null;
  const logs = fs.existsSync(path.join(runDir, 'logs.json')) ? JSON.parse(fs.readFileSync(path.join(runDir, 'logs.json'), 'utf8')) : makeLogs();
  const exportDir = fs.existsSync(path.join(runDir, 'export')) ? path.join(runDir, 'export') : null;
  const fixture = await startFixtureServer({ quiet: true });
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: !OPTS.headed });
  let results;
  try {
    results = await runChecks({ exportDir, session, coverageReply, repoRoot: REPO, fixtureOrigin: fixture.origin, fixture: FIXTURE, runDir, browser, log, checksOnly: true });
  } finally {
    await browser.close();
    await fixture.close();
  }
  process.exit(finish(runDir, { results, session, logs, exportDir }));
}

function finish(runDir, { results, session, logs, exportDir }) {
  printResults(results);
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const passed = results.filter((r) => r.status === 'PASS').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  const out = {
    finishedAt: new Date().toISOString(),
    launch: session.launch,
    exportZip: session.exportZip || null,
    exportDir,
    summary: { passed, failed, skipped, total: results.length },
    results,
    workerConsole: logs.worker,
    pageConsole: logs.pages,
    panelConsole: logs.panel,
    stubbedFiles: session.stubbedFiles || [],
    workerConsoleWired: session.workerConsoleWired ?? null,
  };
  fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify(out, null, 2));
  console.log('');
  console.log(`${passed} passed, ${failed} failed, ${skipped} skipped — results.json in ${runDir}`);
  const noisy = [...logs.worker.filter((l) => (l.type === 'error' || l.type === 'warning') && !l.text.includes('[e2e] worker console probe')), ...logs.pages, ...logs.panel];
  console.log(`worker console capture: ${session.workerConsoleWired === true ? 'wired (probe line seen)' : `NOT verified (${session.workerConsoleWired})`}; worker lines ${logs.worker.length}, fixture-page lines ${logs.pages.length}, panel lines ${logs.panel.length}`);
  if (noisy.length) {
    console.log(`\n${noisy.length} console error/warning line(s) from the extension (first 12; all in logs.json):`);
    for (const l of noisy.slice(0, 12)) console.log(`  [${l.type}] ${l.page ? l.page + ' ' : ''}${l.text}`);
  }
  return failed ? 1 : 0;
}

main().catch((e) => {
  console.error('[e2e] harness error:', e && e.stack ? e.stack : e);
  process.exit(2);
});
