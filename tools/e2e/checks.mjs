/**
 * Assertions over an unzipped Flowprint export.
 *
 * Every check is a small function that returns PASS / FAIL / SKIP with what
 * it expected and what it found. A missing file or field is a FAIL with a
 * message, never an exception that stops the run; a check that cannot be
 * decided from what the export contains is a SKIP that says why.
 *
 * runChecks(ctx) needs:
 *   exportDir       the unzipped folder (null when no zip arrived)
 *   session         ground truth written by run.mjs (what the human did)
 *   coverageReply   the reply to fp:get-coverage for the proceedings route
 *   repoRoot        for `npm run check`, tsc and the domain grep
 *   fixtureOrigin   a live fixture, for the route replay
 *   fixture         the FIXTURE constants from fixture/server.mjs
 *   browser         an extension-free Playwright browser (replay, snapshots)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

const PASS = 'PASS';
const FAIL = 'FAIL';
const SKIP = 'SKIP';

// ----------------------------------------------------------------- utils

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
const same = (a, b) => norm(a) === norm(b);
const get = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const uniq = (arr) => Array.from(new Set(arr));
const short = (v, n = 160) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s == null ? '' : s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
/** `/portal/#/proceedings/detail/1002` → `/portal/#/proceedings/detail/{id}` */
const templ = (route) => String(route || '').replace(/\/\d+(?=\/|$)/g, '/{id}').replace(/\/\{[a-z]+\}(?=\/|$)/gi, '/{id}');

/** Read the package: every file, JSON parsed lazily and once. */
function openExport(exportDir) {
  const files = new Map();
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else files.set(r, abs);
    }
  };
  if (exportDir && fs.existsSync(exportDir)) walk(exportDir, '');
  // The package root is the folder holding flow-map.json (one origin → one package).
  let root = null;
  for (const [rel] of files) {
    if (rel.endsWith('flow-map.json')) {
      const dir = rel.slice(0, -'flow-map.json'.length);
      if (root == null || dir.length < root.length) root = dir;
    }
  }
  if (root == null) root = '';
  const pkg = new Map();
  for (const [rel, abs] of files) if (rel.startsWith(root)) pkg.set(rel.slice(root.length), abs);
  const jsonCache = new Map();
  return {
    dir: exportDir,
    root,
    files: pkg,
    has: (rel) => pkg.has(rel),
    list: (prefix) => Array.from(pkg.keys()).filter((k) => k.startsWith(prefix)),
    text: (rel) => (pkg.has(rel) ? readText(pkg.get(rel)) : null),
    json: (rel) => {
      if (jsonCache.has(rel)) return jsonCache.get(rel);
      let out;
      if (!pkg.has(rel)) out = { ok: false, error: `${rel} is missing` };
      else {
        try {
          out = { ok: true, value: JSON.parse(readText(pkg.get(rel))) };
        } catch (e) {
          out = { ok: false, error: `${rel} does not parse: ${e.message}` };
        }
      }
      jsonCache.set(rel, out);
      return out;
    },
  };
}

function readText(abs) {
  const buf = fs.readFileSync(abs);
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf).toString('utf8');
  return buf.toString('utf8');
}

/** All states, sorted by seq, with the stem the export named their files by. */
function loadStates(x) {
  const out = [];
  for (const rel of x.list('states/')) {
    if (!rel.endsWith('.json')) continue;
    const j = x.json(rel);
    if (j.ok && j.value && typeof j.value === 'object') out.push({ ...j.value, __file: rel, __stem: path.basename(rel, '.json') });
  }
  return out.sort((a, b) => (a.seq || 0) - (b.seq || 0));
}

// ------------------------------------------------------------- reporting

export function printResults(results) {
  for (const r of results) {
    if (r.status === PASS) console.log(`PASS  ${r.name}${r.note ? `  (${r.note})` : ''}`);
    else if (r.status === SKIP) console.log(`SKIP  ${r.name} — ${r.note || r.found || ''}`);
    else {
      console.log(`FAIL  ${r.name}`);
      if (r.expected != null) console.log(`        expected: ${short(r.expected, 400)}`);
      if (r.found != null) console.log(`        found:    ${short(r.found, 600)}`);
      if (r.note) console.log(`        note:     ${short(r.note, 400)}`);
    }
  }
}

// ---------------------------------------------------------------- runner

/**
 * @param {object} ctx
 * @returns {Promise<Array<{name: string, status: string, expected?: any, found?: any, note?: string}>>}
 */
export async function runChecks(ctx) {
  const results = [];
  const x = ctx.exportDir ? openExport(ctx.exportDir) : null;
  const S = ctx.session || {};
  const F = ctx.fixture;
  const log = ctx.log || (() => {});

  const run = async (name, fn) => {
    let r;
    try {
      r = await fn();
    } catch (e) {
      r = { status: FAIL, expected: 'the check to complete', found: `check threw: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}` };
    }
    if (!r) r = { status: PASS };
    results.push({ name, ...r });
    log(`  ${r.status} ${name}`);
  };
  const pass = (note) => ({ status: PASS, note });
  const fail = (expected, found, note) => ({ status: FAIL, expected, found, note });
  const skip = (note) => ({ status: SKIP, note });
  const need = (rel) => {
    if (!x) return { ok: false, error: 'no export was unzipped (no zip arrived)' };
    return x.json(rel);
  };

  // =============================================================== A. harness-level facts
  await run('extension loaded and a recording session ran', () => {
    if (!S.launch) return fail('a launch combination that loads the extension', 'none');
    if (!S.statsEnd) return fail('get-stats to answer at the end of the session', 'no reply');
    return pass(`${S.launch}; states=${S.statsEnd.states} net=${S.statsEnd.net} actions=${S.statsEnd.actions} downloads=${S.statsEnd.downloads}`);
  });

  await run('without consent nothing is stored', () => {
    const s = S.statsNoConsent;
    if (!s) return fail('get-stats reply after browsing two pages without consent', 'no reply');
    const counters = { states: s.states, net: s.net, actions: s.actions, downloads: s.downloads, lists: s.lists, screenshots: s.screenshots };
    const nonZero = Object.entries(counters).filter(([, v]) => v);
    const keys = (S.storageNoConsent || []).filter((k) => /^fp:(states|net|actions|downloads|dom:|shots:|netbody:)/.test(k));
    if (nonZero.length || keys.length) return fail('all counters 0 and no capture keys in storage', { nonZero: Object.fromEntries(nonZero), storageKeys: keys });
    return pass(`counters ${JSON.stringify(counters)}`);
  });

  await run('export zip arrived and unzipped', () => {
    if (!S.exportZip) return fail('a zip in the download folder after fp:export', { exportProgress: S.exportProgress, downloadFolder: S.downloadsDirListing });
    if (!x || !x.files.size) return fail('files inside the zip', 'nothing unzipped');
    const p = S.exportProgress || {};
    return pass(`${path.basename(S.exportZip)}, ${x.files.size} files${p.warning ? `; warning: ${p.warning}` : ''}${p.error ? `; error: ${p.error}` : ''}`);
  });

  await run('every download stayed inside the run folder', () => {
    if (!Array.isArray(S.strayDownloads)) return skip('not recorded (checks-only run of an older session)');
    if (S.strayDownloads.length) return fail('nothing new in ~/Downloads', S.strayDownloads, 'the profile Preferences seeding in run.mjs did not take');
    return pass(`${(S.downloadsDirListing || []).length} file(s) in the run's downloads folder`);
  });

  await run('export finished without error or skipped entries', () => {
    const p = S.exportProgress;
    if (!p) return skip('no export progress recorded');
    if (p.error) return fail('exportProgress.error null', p.error);
    if (p.warning) return fail('exportProgress.warning null', p.warning);
    return pass(`${p.current}/${p.total} entries`);
  });

  // =============================================================== B. files and structure
  const REQUIRED_FILES = ['manifest.json', 'AUTOMATION-BRIEF.md', 'SUMMARY.md', 'flow-map.json', 'selectors.json', 'playwright-skeleton.ts', 'network.har', 'site-map.json', 'routes.json', 'api-catalog.json', 'actions.json', 'downloads.json', 'coverage.json', 'RECIPES.md'];
  const REQUIRED_DIRS = ['states/', 'dom/', 'screens/'];

  await run('every file named in docs/03 and spec B8 exists', () => {
    if (!x) return fail(REQUIRED_FILES.join(', '), 'no export');
    const missing = REQUIRED_FILES.filter((f) => !x.has(f));
    const emptyDirs = REQUIRED_DIRS.filter((d) => x.list(d).length === 0);
    const bodiesExpected = (S.keepBodies && S.keepBodies.replies || []).some((r) => r.to === 'full' && r.stats && r.stats.keepBodies === 'full');
    if (bodiesExpected && x.list('api/bodies/').length === 0) emptyDirs.push('api/bodies/ (keepBodies was full for part of the session)');
    if (missing.length || emptyDirs.length) return fail('all files present and folders non-empty', { missing, emptyDirs });
    return pass(`${x.files.size} files`);
  });

  await run('every .json (and network.har) parses', () => {
    if (!x) return fail('parseable JSON', 'no export');
    const bad = [];
    for (const rel of x.files.keys()) {
      if (!/\.(json|har)$/.test(rel)) continue;
      const j = x.json(rel);
      if (!j.ok) bad.push(j.error);
    }
    if (bad.length) return fail('no parse errors', bad.slice(0, 10));
    return pass();
  });

  const states = x ? loadStates(x) : [];
  const actionsJ = need('actions.json');
  const actions = actionsJ.ok && Array.isArray(actionsJ.value) ? actionsJ.value : actionsJ.ok && Array.isArray(get(actionsJ.value, 'actions')) ? actionsJ.value.actions : [];
  const siteMapJ = need('site-map.json');
  const siteMap = siteMapJ.ok ? siteMapJ.value : null;
  const routesJ = need('routes.json');
  const routes = routesJ.ok ? routesJ.value : null;
  const catalogJ = need('api-catalog.json');
  const catalog = catalogJ.ok ? catalogJ.value : null;
  const downloadsJ = need('downloads.json');
  const downloads = downloadsJ.ok && Array.isArray(downloadsJ.value) ? downloadsJ.value : downloadsJ.ok && Array.isArray(get(downloadsJ.value, 'downloads')) ? downloadsJ.value.downloads : [];
  const coverageJ = need('coverage.json');
  const coverage = coverageJ.ok ? coverageJ.value : null;
  const harJ = need('network.har');
  const har = harJ.ok ? harJ.value : null;
  const manifestJ = need('manifest.json');
  const flowJ = need('flow-map.json');

  await run('ids referenced across files resolve', () => {
    if (!x) return fail('resolvable ids', 'no export');
    const sets = {
      st: new Set(states.map((s) => s.id)),
      act: new Set(actions.map((a) => a.id)),
      pg: new Set(((siteMap && siteMap.pages) || []).map((p) => p.id)),
      api: new Set(((catalog && catalog.endpoints) || []).map((e) => e.id)),
      dl: new Set(downloads.map((d) => d.id)),
      net: new Set(),
    };
    for (const e of (har && har.log && har.log.entries) || []) {
      const m = /internal id (net_\d+)/.exec(e.comment || '');
      if (m) sets.net.add(m[1]);
    }
    const ID_RE = /^(st|act|pg|api|dl|net)_\d+$/;
    const missing = [];
    const seen = { total: 0 };
    const visit = (v, where) => {
      if (typeof v === 'string') {
        const m = ID_RE.exec(v);
        if (m) {
          seen.total++;
          if (!sets[m[1]].has(v)) missing.push(`${where}: ${v}`);
        }
      } else if (Array.isArray(v)) v.forEach((item, i) => visit(item, `${where}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, val] of Object.entries(v)) visit(val, `${where}.${k}`);
    };
    for (const rel of ['flow-map.json', 'site-map.json', 'routes.json', 'api-catalog.json', 'actions.json', 'downloads.json', 'coverage.json']) {
      const j = x.json(rel);
      if (j.ok) visit(j.value, rel);
    }
    for (const s of states) visit(s, s.__file);
    if (!sets.net.size && (har && har.log && har.log.entries || []).length) missing.unshift('network.har entries carry no "internal id net_…" comment, so net ids could not be indexed');
    if (missing.length) return fail('every st_/act_/pg_/api_/dl_/net_ reference points at an existing record', { count: missing.length, first: missing.slice(0, 12) });
    return pass(`${seen.total} references over ${Object.values(sets).reduce((a, s) => a + s.size, 0)} ids`);
  });

  await run('manifest.json counts and redaction fields (spec B8)', () => {
    if (!manifestJ.ok) return fail('manifest.json', manifestJ.error);
    const m = manifestJ.value;
    const missing = ['actions', 'downloads', 'pages', 'endpoints'].filter((k) => typeof get(m, `counts.${k}`) !== 'number');
    const missingRed = ['apiShapes', 'downloads'].filter((k) => typeof get(m, `redaction.${k}`) !== 'string');
    if (missing.length || missingRed.length) return fail('counts.{actions,downloads,pages,endpoints} numbers and redaction.{apiShapes,downloads} strings', { missingCounts: missing, missingRedaction: missingRed, counts: m.counts });
    if (m.counts.actions !== actions.length) return fail(`counts.actions === actions.json length (${actions.length})`, m.counts.actions);
    if (m.counts.downloads !== downloads.length) return fail(`counts.downloads === downloads.json length (${downloads.length})`, m.counts.downloads);
    return pass(short(m.counts));
  });

  // =============================================================== C. acceptance additions (docs/12)
  await run('B1 fragment routes: same pathname, different route per page', () => {
    if (!states.length) return fail('states/*.json', 'no states');
    const noRoute = states.filter((s) => typeof s.route !== 'string');
    if (noRoute.length) return fail('every state has a string `route`', `${noRoute.length} states without route, e.g. ${noRoute[0].__file}`);
    const byPath = new Map();
    for (const s of states) byPath.set(s.pathname, (byPath.get(s.pathname) || new Set()).add(s.route));
    const portal = byPath.get(F.basePath) || new Set();
    const expected = uniq(S.visitedByClick || []).filter((r) => r.startsWith(F.basePath));
    const missing = expected.filter((r) => !portal.has(r));
    if (portal.size < 2) return fail(`≥2 distinct routes for pathname ${F.basePath}`, Array.from(portal));
    if (missing.length) return fail('a state for every route the human reached', { missingRoutes: missing, routesSeen: Array.from(portal) });
    const withQuery = states.filter((s) => /\?/.test(s.route));
    if (withQuery.length) return fail('no query string in route', withQuery.map((s) => s.route).slice(0, 5));
    return pass(`${portal.size} routes under ${F.basePath}`);
  });

  await run('B2 switching a tab / chip that changes only rows produces a new state', () => {
    const proc = states.filter((s) => s.route === F.routes.proceedings);
    if (!proc.length) return fail(`states on ${F.routes.proceedings}`, 'none');
    const keys = uniq(proc.map((s) => get(s, 'view.key')));
    const active = proc.flatMap((s) => (get(s, 'view.active') || []).map((a) => a.option));
    const tabSeen = active.some((o) => same(o, 'Responded'));
    const chipSeen = active.some((o) => same(o, 'Last 30 days'));
    if (keys.length < 3) return fail('≥3 distinct view.key values on the proceedings route (Pending/All, Responded/All, Responded/Last 30 days)', keys);
    if (!tabSeen || !chipSeen) return fail('view.active names the clicked tab "Responded" and chip "Last 30 days"', uniq(active));
    return pass(`${keys.length} view keys: ${short(keys, 200)}`);
  });

  await run('B2/B4 paging: "next page" makes a new state and a pagination action', () => {
    const ret = states.filter((s) => s.route === F.routes.returns);
    const keys = uniq(ret.map((s) => get(s, 'view.key')));
    const pageKeys = keys.filter((k) => /page/i.test(String(k)));
    const nextActions = actions.filter((a) => a.pagination === true && a.paginationRole === 'next');
    const prevActions = actions.filter((a) => a.pagination === true && a.paginationRole === 'prev');
    const problems = [];
    if (keys.length < 3) problems.push(`expected ≥3 view keys on ${F.routes.returns} (pages 1, 2, 3), found ${JSON.stringify(keys)}`);
    if (!pageKeys.length) problems.push('no view.key mentions the page indicator');
    if (nextActions.length < 2) problems.push(`expected 2 actions with pagination:true paginationRole:"next", found ${nextActions.length}`);
    if (prevActions.length < 1) problems.push(`expected 1 action with paginationRole:"prev", found ${prevActions.length}`);
    const current = ret.flatMap((s) => (get(s, 'lists.pagination') || []).map((p) => p.current)).filter((c) => c != null);
    if (!current.length) problems.push('no PaginationPattern.current on the returns states');
    if (problems.length) return fail('paging recorded as states and actions', problems);
    return pass(`view keys ${short(keys, 120)}; current ${short(uniq(current), 80)}`);
  });

  await run('B4 every human click appears in actions.json', () => {
    if (!actionsJ.ok) return fail('actions.json', actionsJ.error);
    const wanted = (S.clicks || []).filter((c) => !c.incidental && c.kind === 'click');
    const pool = actions.filter((a) => a.kind === 'click').map((a) => ({ a, used: false, t: Date.parse(a.at) }));
    const missing = [];
    const byTime = [];
    const REDACTED = /^<\d+ chars>$/;
    // A click is found by its label, or — when the recorder replaced the label with a length —
    // by being the one click action recorded in the moments after the harness clicked.
    for (const c of wanted) {
      const t = Date.parse(c.at);
      const inWindow = (p) => Number.isFinite(p.t) && p.t >= t - 500 && p.t <= t + (S.paceMs || 2500) + 1500;
      let hit = pool.find((p) => !p.used && inWindow(p) && c.names.some((nm) => same(p.a.label, nm) || same(get(p.a, 'selectors.name'), nm)));
      if (!hit) hit = pool.find((p) => !p.used && c.names.some((nm) => same(p.a.label, nm) || same(get(p.a, 'selectors.name'), nm)));
      if (!hit) {
        hit = pool.find((p) => !p.used && inWindow(p) && (REDACTED.test(String(p.a.label)) || !p.a.label));
        if (hit) byTime.push(`#${c.n} "${c.label}" → ${hit.a.id} labelled ${JSON.stringify(hit.a.label)}`);
      }
      if (hit) hit.used = true;
      else {
        const other = actions.find((a) => a.kind !== 'click' && c.names.some((nm) => same(a.label, nm)));
        missing.push(`#${c.n} ${c.label}${other ? ` (recorded as ${other.kind} ${other.id}, controlKey ${JSON.stringify(other.controlKey)})` : ''}`);
      }
    }
    const changes = (S.clicks || []).filter((c) => c.kind === 'change');
    const changeActions = actions.filter((a) => a.kind === 'change');
    const changeMissing = changes.filter((c) => !changeActions.some((a) => c.names.some((nm) => same(a.controlKey, nm) || same(a.chosen, nm) || same(a.label, nm))));
    if (missing.length || changeMissing.length) return fail(`${wanted.length} clicks and ${changes.length} changes present`, { missingClicks: missing, missingChanges: changeMissing.map((c) => c.label), actionLabels: actions.map((a) => `${a.kind}:${a.label}`).slice(0, 60) });
    return pass(`${wanted.length} clicks, ${changes.length} changes, ${actions.length} actions in all${byTime.length ? `; ${byTime.length} matched by time only (label redacted)` : ''}`);
  });

  await run('B4 action labels and accessible names name what was clicked (view options, menu items, buttons)', () => {
    if (!actionsJ.ok) return fail('actions.json', actionsJ.error);
    // Row contents are data and may be redacted; the text of a tab, a filter chip, a menu item or a
    // button is interface, and the spec keeps it (scrubbed, not replaced by a length).
    const ui = [F.views.tabs, F.views.chips, F.menus.all.map((p) => p[p.length - 1]), ['Sign in', 'Next page', 'Previous page', 'Export CSV', 'View profile']].flat();
    const clickedUi = uniq((S.clicks || []).filter((c) => !c.incidental && c.kind === 'click' && ui.some((u) => same(u, c.label))).map((c) => c.label));
    const bad = [];
    for (const label of clickedUi) {
      const named = actions.some((a) => same(a.label, label) && same(get(a, 'selectors.name'), label));
      if (!named) {
        const near = actions.filter((a) => /^<\d+ chars>$/.test(String(a.label)) || !get(a, 'selectors.name')).map((a) => `${a.id} label=${JSON.stringify(a.label)} name=${JSON.stringify(get(a, 'selectors.name'))} ${get(a, 'selectors.primary')}`);
        bad.push({ clicked: label, candidates: near.slice(0, 4) });
      }
    }
    if (bad.length) return fail('label and selectors.name equal to the visible text for every interface control clicked', bad);
    return pass(`${clickedUi.length} interface controls named`);
  });

  await run('B4 every action selector matches exactly one element in the dom/ snapshot of stateIdAtTime', async () => {
    if (!actions.length) return fail('actions.json with entries', 'none');
    if (!ctx.browser) return skip('no browser handed to the checks');
    const byId = new Map(states.map((s) => [s.id, s]));
    const groups = new Map();
    const unchecked = [];
    for (const a of actions) {
      if (!a.selectors || !a.selectors.primary) {
        unchecked.push(`${a.id}: no selectors`);
        continue;
      }
      if (!a.stateIdAtTime) {
        unchecked.push(`${a.id}: stateIdAtTime null`);
        continue;
      }
      const st = byId.get(a.stateIdAtTime);
      const dom = st ? `dom/${st.__stem}.html` : null;
      if (!st || !x.has(dom)) {
        unchecked.push(`${a.id}: no dom snapshot for ${a.stateIdAtTime}`);
        continue;
      }
      if (!groups.has(dom)) groups.set(dom, []);
      groups.get(dom).push(a);
    }
    if (!groups.size) return fail('actions whose stateIdAtTime has a dom snapshot', { unchecked: unchecked.slice(0, 10) });
    const context = await ctx.browser.newContext({ javaScriptEnabled: false });
    const mismatches = [];
    let checked = 0;
    try {
      await context.route('**/*', (route) => {
        const u = route.request().url();
        const m = /^http:\/\/snapshot\.invalid\/(.+)$/.exec(u);
        if (m && x.has(decodeURIComponent(m[1]))) route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: x.text(decodeURIComponent(m[1])) });
        else route.abort();
      });
      const page = await context.newPage();
      for (const [dom, list] of groups) {
        await page.goto(`http://snapshot.invalid/${encodeURI(dom)}`, { waitUntil: 'domcontentloaded' });
        for (const a of list) {
          const r = await page.evaluate(({ primary, shadowPath }) => {
            try {
              let root = document;
              for (const host of shadowPath || []) {
                const hosts = root.querySelectorAll(host);
                if (hosts.length !== 1) return { error: `shadow host ${host} matched ${hosts.length}` };
                if (!hosts[0].shadowRoot) return { skip: `host ${host} has no shadow root in the snapshot (declarative shadow root not serialised)` };
                root = hosts[0].shadowRoot;
              }
              return { count: root.querySelectorAll(primary).length };
            } catch (e) {
              return { error: `invalid selector: ${e.message}` };
            }
          }, { primary: a.selectors.primary, shadowPath: a.selectors.shadowPath || [] });
          checked++;
          if (r.skip) unchecked.push(`${a.id}: ${r.skip}`);
          else if (r.error) mismatches.push(`${a.id} "${a.label}" ${a.selectors.primary} → ${r.error}`);
          else if (r.count !== 1) mismatches.push(`${a.id} "${a.label}" ${a.selectors.primary} → ${r.count} matches in ${dom}`);
        }
      }
    } finally {
      await context.close();
    }
    if (mismatches.length) return fail(`${checked} selectors each matching one element`, { mismatches: mismatches.slice(0, 20), total: mismatches.length, unchecked: unchecked.slice(0, 8) }, 'a menu item clicked while its panel was open only matches if a state was stored with the panel open');
    return pass(`${checked} selectors checked${unchecked.length ? `, ${unchecked.length} not checkable` : ''}`);
  });

  await run('B3/B8 collapsed menu items in site-map.json, visited:false until clicked', () => {
    if (!siteMap) return fail('site-map.json', siteMapJ.error);
    const menu = Array.isArray(siteMap.menu) ? siteMap.menu : [];
    if (!menu.length) return fail('site-map.menu entries', 'empty');
    const find = (label) => menu.filter((n) => same(n.text, label) || same((n.path || [])[(n.path || []).length - 1], label));
    const problems = [];
    for (const label of F.menus.neverClicked) {
      const nodes = find(label);
      if (!nodes.length) problems.push(`"${label}" (never clicked, collapsed in the DOM) is not in the menu`);
      else if (nodes.some((n) => n.visited)) problems.push(`"${label}" is marked visited but was never clicked`);
    }
    const clicked = uniq((S.clicks || []).filter((c) => !c.incidental).map((c) => c.label)).filter((l) => F.menus.all.some((p) => same(p[p.length - 1], l)));
    for (const label of clicked) {
      const nodes = find(label);
      if (!nodes.length) problems.push(`clicked menu item "${label}" is not in the menu`);
      else if (!nodes.some((n) => n.visited)) problems.push(`clicked menu item "${label}" is not marked visited`);
    }
    // Paths must follow the fixture's own menus: a menubar item is not a child of the Accounts button beside it.
    for (const want of F.menus.all) {
      const leaf = want[want.length - 1];
      const nodes = find(leaf);
      if (nodes.length && !nodes.some((n) => (n.path || []).map(norm).join(' > ') === want.map(norm).join(' > '))) problems.push(`"${leaf}" has path ${nodes.map((n) => JSON.stringify(n.path)).join(' / ')}, expected ${JSON.stringify(want)}`);
    }
    const nested = menu.filter((n) => (n.path || []).length >= 3);
    if (!nested.length) problems.push('no menu node with a 3-deep path (Filing > Applications > …, Compliance > Reports > …)');
    if (problems.length) return fail('never-clicked items present with visited:false, clicked items visited:true', problems);
    return pass(`${menu.length} menu nodes, ${menu.filter((n) => n.visited).length} visited`);
  });

  const ledgerEndpoint = () => (catalog && Array.isArray(catalog.endpoints) ? catalog.endpoints.find((e) => String(e.urlTemplate || '').includes(F.ledger.path)) : null);
  const rowShapeOf = (shape, listPath) => {
    if (!shape) return null;
    let cur = shape;
    if (listPath) {
      for (const k of String(listPath).replace(/^\$\.?/, '').replace(/\[\*?\]/g, '').split('.').filter(Boolean)) {
        if (cur && cur.t === 'array') cur = cur.item;
        if (!cur || !cur.keys || !cur.keys[k]) {
          cur = null;
          break;
        }
        cur = cur.keys[k];
      }
      if (cur && cur.t === 'array' && cur.item && cur.item.t === 'object') return cur.item;
    }
    // fallback: the largest array of objects anywhere in the shape
    let best = null;
    const walk = (s) => {
      if (!s || typeof s !== 'object') return;
      if (s.t === 'array' && s.item && s.item.t === 'object' && (!best || (s.len || 0) > (best.len || 0))) best = s;
      if (s.keys) Object.values(s.keys).forEach(walk);
      if (s.item) walk(s.item);
    };
    walk(shape);
    return best ? best.item : null;
  };

  await run('B5 300 KB response: responseShape names every row key; network.har keeps 4000 chars', () => {
    const ep = ledgerEndpoint();
    if (!catalog) return fail('api-catalog.json', catalogJ.error);
    if (!ep) return fail(`an endpoint for ${F.ledger.path}`, (catalog.endpoints || []).map((e) => e.urlTemplate));
    const row = rowShapeOf(ep.responseShape, (ep.listPaths || [])[0] && ep.listPaths[0].path);
    if (!row) return fail('responseShape with an array of row objects', short(ep.responseShape, 300));
    const keys = Object.keys(row.keys || {});
    const missing = F.ledger.rowKeys.filter((k) => !keys.includes(k));
    const problems = [];
    if (missing.length) problems.push(`row keys missing from responseShape: ${missing.join(', ')}`);
    const entries = (har && har.log && har.log.entries) || [];
    const harEntry = entries.find((e) => String(get(e, 'request.url')).includes(F.ledger.path));
    if (!harEntry) problems.push('no network.har entry for the ledger call');
    else {
      const text = String(get(harEntry, 'response.content.text') || '');
      if (text.length < 2000 || text.length > 4200) problems.push(`network.har body is ${text.length} chars; expected ~4000 (truncated) — full response is ${F.ledger.minBytes}+ bytes`);
    }
    if (problems.length) return fail('all 12 row keys in the shape and a 4000-char HAR body', problems);
    return pass(`${keys.length} row keys; HAR body ${String(get(harEntry, 'response.content.text') || '').length} chars`);
  });

  await run('B8 catalog entry: status enum-like with 4 values, listPath and paging params', () => {
    const ep = ledgerEndpoint();
    if (!ep) return fail(`api-catalog entry for ${F.ledger.path}`, 'none');
    const problems = [];
    const row = rowShapeOf(ep.responseShape, (ep.listPaths || [])[0] && ep.listPaths[0].path);
    const status = row && row.keys && row.keys.status;
    if (!status) problems.push('row shape has no `status`');
    else {
      const values = Array.isArray(status.values) ? [...status.values].sort() : null;
      if (!values) problems.push(`status has no enum values: ${short(status)}`);
      else if (values.join(',') !== [...F.ledger.statusValues].sort().join(',')) problems.push(`status values ${JSON.stringify(values)} ≠ ${JSON.stringify([...F.ledger.statusValues].sort())}`);
    }
    const lp = Array.isArray(ep.listPaths) ? ep.listPaths.map((l) => l.path) : [];
    // `$.data.items`, `data.items[]` and `data.items` all name the same array.
    const plainPath = (p) => String(p).replace(/^\$\.?/, '').replace(/\[\*?\]/g, '');
    if (!lp.some((p) => plainPath(p) === F.ledger.listPath)) problems.push(`listPaths ${JSON.stringify(lp)} does not name ${F.ledger.listPath}`);
    const pp = Array.isArray(ep.pagingParams) ? ep.pagingParams : [];
    const missingPp = F.ledger.pagingParams.filter((p) => !pp.includes(p));
    if (missingPp.length) problems.push(`pagingParams ${JSON.stringify(pp)} missing ${missingPp.join(', ')}`);
    const free = row && row.keys && row.keys.narration;
    if (free && Array.isArray(free.values)) problems.push('free-text `narration` was marked enum-like');
    if (problems.length) return fail('status enum {posted,pending,reversed,failed}, listPath data.items, pagingParams page,size', problems);
    return pass(`listPaths ${short(lp, 60)}, pagingParams ${pp.join(',')}`);
  });

  await run('B8 endpoint template folds the varying id (/api/proceedings/{id})', () => {
    if (!catalog) return fail('api-catalog.json', catalogJ.error);
    const eps = (catalog.endpoints || []).filter((e) => /\/api\/proceedings\/[^/?]+$/.test(String(e.urlTemplate || '')));
    if (!eps.length) return fail('an endpoint whose template is /api/proceedings/{id}', (catalog.endpoints || []).map((e) => e.urlTemplate));
    const folded = eps.filter((e) => /\{id\}|\{[a-z]+\}/i.test(e.urlTemplate));
    if (folded.length !== 1 || eps.length !== 1) return fail('one template /api/proceedings/{id} with count 2', eps.map((e) => `${e.urlTemplate} ×${e.count}`));
    if ((folded[0].count || 0) < 2) return fail('count ≥ 2 (ids 1001 and 1002)', folded[0].count);
    return pass(`${folded[0].urlTemplate} ×${folded[0].count}`);
  });

  await run('B5 keep-bodies off: no fp:netbody: key is ever written', () => {
    const samples = S.storageSamples || [];
    if (!samples.length) return skip('no storage samples recorded');
    const fullFrom = S.keepBodies && S.keepBodies.fullFrom;
    const fullTo = S.keepBodies && S.keepBodies.fullTo;
    const before = samples.filter((s) => !fullFrom || s.at < fullFrom);
    const leaked = before.filter((s) => (s.netbodyKeys || []).length);
    if (leaked.length) return fail('no fp:netbody: keys before keep-bodies was switched on', leaked.map((s) => `${s.label}: ${s.netbodyKeys.length} keys`));
    // After switching back, the set must not grow (allow the sample taken at the switch itself).
    const after = samples.filter((s) => fullTo && s.at > fullTo);
    if (after.length >= 2) {
      const base = new Set(after[0].netbodyKeys || []);
      const grew = after.slice(1).filter((s) => (s.netbodyKeys || []).some((k) => !base.has(k)));
      if (grew.length) return fail('no new fp:netbody: keys after keep-bodies went back to shape', grew.map((s) => `${s.label}: +${(s.netbodyKeys || []).filter((k) => !base.has(k)).length}`));
    }
    return pass(`${before.length} samples clean before; ${after.length} samples after`);
  });

  await run('B5 keep-bodies on: full bodies stored and exported to api/bodies/', () => {
    const replies = (S.keepBodies && S.keepBodies.replies) || [];
    const on = replies.find((r) => r.to === 'full');
    if (!on) return fail('fp:set-keep-bodies {value:"full"} sent', 'not sent');
    if (!on.stats || on.stats.keepBodies !== 'full') return fail('get-stats.keepBodies "full" after the switch', on.stats && on.stats.keepBodies);
    const during = (S.storageSamples || []).filter((s) => s.keepBodies === 'full' && (s.netbodyKeys || []).length);
    const bodies = x ? x.list('api/bodies/') : [];
    const full = catalog ? (catalog.endpoints || []).filter((e) => e.hasFullBody) : [];
    const problems = [];
    if (!during.length) problems.push('no fp:netbody: key appeared while keepBodies was full (demands and proceedings calls happened then)');
    if (!bodies.length) problems.push('api/bodies/ is empty or missing');
    if (!full.length) problems.push('no api-catalog endpoint has hasFullBody:true');
    if (problems.length) return fail('bodies stored for the calls made in full mode', problems);
    return pass(`${bodies.length} body files; endpoints with full body: ${full.map((e) => e.urlTemplate).join(', ')}`);
  });

  await run('B6 blob download in downloads.json: extension, nameShape, actionId, no file name', () => {
    if (!downloadsJ.ok) return fail('downloads.json', downloadsJ.error);
    const blob = downloads.filter((d) => d.urlKind === 'blob');
    if (!blob.length) return fail('one entry with urlKind "blob"', downloads.map((d) => `${d.urlKind} ${d.extension} ${d.nameShape}`));
    const d = blob[0];
    const problems = [];
    if (d.extension !== 'csv') problems.push(`extension ${JSON.stringify(d.extension)} ≠ "csv"`);
    if (!/^A\{\d+\}(_A\{\d+\}|_9\{\d+\}|_[A9]\{\d+\}[A9]\{\d+\})*\.csv$/.test(String(d.nameShape))) problems.push(`nameShape ${JSON.stringify(d.nameShape)} is not letters→A{n}, digits→9{n} for ${F.downloads.blobFileName}`);
    if (!d.actionId) problems.push('actionId null');
    else {
      const a = actions.find((a) => a.id === d.actionId);
      if (!a) problems.push(`actionId ${d.actionId} not in actions.json`);
      else if (!same(a.label, 'Export CSV')) problems.push(`actionId points at "${a.label}", not "Export CSV"`);
    }
    if (d.state !== 'complete') problems.push(`state ${JSON.stringify(d.state)} ≠ "complete" (the file finished on disk)`);
    if (d.url !== null) problems.push(`url should be null for blob, got ${short(d.url)}`);
    if (!d.blob || typeof d.blob.size !== 'number') problems.push('no MAIN-world blob hint {mime,size}');
    if (JSON.stringify(d).includes(F.downloads.blobFileName)) problems.push('the file name is in the entry');
    if (problems.length) return fail('blob entry with extension csv, nameShape, state complete, actionId → Export CSV, url null, blob hint', problems, S.afterBlob ? `2.5 s after the click the worker had: ${short((S.afterBlob.downloads || []).map((x) => ({ state: x.state, nameShape: x.nameShape, extension: x.extension, blob: x.blob })), 300)}` : undefined);
    return pass(`${d.nameShape} ${d.mime || ''} ${d.sizeBytes} bytes`);
  });

  await run('B6 direct download (content-disposition attachment) in downloads.json', () => {
    if (!downloadsJ.ok) return fail('downloads.json', downloadsJ.error);
    const http = downloads.filter((d) => d.urlKind === 'http');
    if (!http.length) return fail('one entry with urlKind "http"', downloads.map((d) => d.urlKind));
    const d = http[0];
    const problems = [];
    if (d.extension !== 'pdf') problems.push(`extension ${JSON.stringify(d.extension)} ≠ "pdf"`);
    if (!/^A\{\d+\}.*\.pdf$/.test(String(d.nameShape))) problems.push(`nameShape ${JSON.stringify(d.nameShape)} is not the shape of ${F.downloads.pdfFileName}`);
    if (d.state !== 'complete') problems.push(`state ${JSON.stringify(d.state)} ≠ "complete" (the file finished on disk)`);
    if (!String(d.url || '').includes(F.downloads.pdfHref)) problems.push(`url ${short(d.url)} does not carry ${F.downloads.pdfHref}`);
    if (!d.actionId) problems.push('actionId null (the "Download notice" click)');
    if (JSON.stringify(d).includes(F.downloads.pdfFileName)) problems.push('the file name is in the entry');
    if (problems.length) return fail('http entry with extension pdf, a nameShape, state complete, the scrubbed url and an actionId', problems);
    return pass(`${d.nameShape} netId=${d.netId}`);
  });

  await run("B6 Flowprint's own export zip is not in downloads.json", () => {
    if (!downloadsJ.ok) return fail('downloads.json', downloadsJ.error);
    const zips = downloads.filter((d) => d.extension === 'zip' || /zip/i.test(String(d.mime)) || /flowprint/i.test(JSON.stringify(d)));
    const after = Array.isArray(S.downloadsFromStorageAfterExport) ? S.downloadsFromStorageAfterExport : null;
    const problems = [];
    if (zips.length) problems.push(`downloads.json has ${zips.length} zip-like entry`);
    if (after) {
      const zipsAfter = after.filter((d) => d.extension === 'zip' || /zip/i.test(String(d.mime)));
      if (zipsAfter.length) problems.push(`fp:downloads gained a zip entry after the export: ${short(zipsAfter[0])}`);
      if (after.length !== downloads.length) problems.push(`fp:downloads has ${after.length} entries after export, downloads.json has ${downloads.length}`);
    } else problems.push('could not read fp:downloads after the export (checked downloads.json only)');
    if (problems.some((p) => !p.startsWith('could not'))) return fail('no zip entry in downloads.json or in fp:downloads after the export', problems);
    return pass(`${downloads.length} downloads, none a zip${after ? '' : ' (storage not re-read)'}`);
  });

  const expectedPages = () => {
    const visited = uniq(S.visitedByClick || []).filter((r) => r.startsWith(F.basePath) && r !== F.routes.login);
    return visited;
  };

  await run('B8 routes.json reaches every page reached by clicking; no step is a danger action', () => {
    if (!routes) return fail('routes.json', routesJ.error);
    const recipes = Array.isArray(routes.recipes) ? routes.recipes : [];
    if (!recipes.length) return fail('recipes', 'none');
    const byId = new Map(actions.map((a) => [a.id, a]));
    const problems = [];
    for (const route of expectedPages()) {
      const hits = recipes.filter((r) => r.route === route || templ(r.route) === templ(route));
      if (!hits.length) problems.push(`no recipe for ${route}`);
      else if (!hits.some((r) => r.reachable)) problems.push(`${route}: recipe(s) not reachable — ${hits.map((r) => r.note).join(' / ')}`);
    }
    for (const r of recipes) {
      for (const s of r.steps || []) {
        const a = byId.get(s.actionId);
        if (a && a.danger) problems.push(`${r.route} step ${s.n} uses danger action ${s.actionId} "${a.label}"`);
        if (same(s.label, F.dangerLabel)) problems.push(`${r.route} step ${s.n} is "${s.label}"`);
      }
    }
    if (!routes.entryRoute) problems.push('entryRoute missing');
    if (problems.length) return fail('a reachable recipe for each visited page, danger-free steps', problems);
    return pass(`${recipes.filter((r) => r.reachable).length}/${recipes.length} recipes reachable; entry ${routes.entryRoute}`);
  });

  await run('B8 REPLAY: every reachable recipe navigates a fresh browser from the export alone', async () => {
    if (!routes) return fail('routes.json', routesJ.error);
    if (!ctx.browser || !ctx.fixtureOrigin) return skip('no browser or fixture for the replay');
    const recipes = (routes.recipes || []).filter((r) => r.reachable);
    if (!recipes.length) return fail('reachable recipes', 'none');
    const entryRoute = routes.entryRoute || F.routes.dashboard;
    const context = await ctx.browser.newContext({ viewport: { width: 1280, height: 820 } });
    const outcomes = [];
    try {
      const page = await context.newPage();
      // Login is the human's job: do it once, then every recipe starts at the entry route.
      await page.goto(`${ctx.fixtureOrigin}${F.routes.login}`);
      await page.locator('#userId').click();
      await page.keyboard.type('replay-user');
      await page.locator('#password').click();
      await page.keyboard.type('replay-pass');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.waitForSelector('h1');

      for (const r of recipes) {
        const outcome = { route: r.route, viewKey: r.viewKey, steps: (r.steps || []).length, ok: false, detail: '' };
        outcomes.push(outcome);
        let active = page;
        try {
          await page.goto('about:blank');
          await page.goto(`${ctx.fixtureOrigin}${entryRoute}`);
          await page.waitForSelector('h1');
          for (const step of r.steps || []) {
            const { locator, via } = await resolveStep(active, step);
            if (!locator) throw new Error(`step ${step.n} "${step.label}": no selector matched exactly one visible element (${via})`);
            const popupP = step.opensNewTab ? active.context().waitForEvent('page', { timeout: 5000 }).catch(() => null) : null;
            if (step.kind === 'change' && step.chosen) {
              await locator.selectOption({ label: step.chosen }).catch(() => locator.click());
            } else await locator.click({ timeout: 4000 });
            if (popupP) {
              const popup = await popupP;
              if (!popup) throw new Error(`step ${step.n}: expected a new tab`);
              await popup.waitForLoadState().catch(() => {});
              active = popup;
            }
            const okRoute = await waitForRoute(active, step.expectRoute, 4000);
            if (!okRoute) throw new Error(`step ${step.n} "${step.label}" via ${via}: expected route ${step.expectRoute}, page is at ${await routeOfPage(active)}`);
            if (step.expectHeading) {
              const okHeading = await waitForHeading(active, step.expectHeading, 3000);
              if (!okHeading) throw new Error(`step ${step.n}: expected heading "${step.expectHeading}", headings are ${JSON.stringify(await headingsOf(active))}`);
            }
          }
          if (!(r.steps || []).length) {
            const at = await routeOfPage(active);
            if (at !== r.route) throw new Error(`no steps, but the entry page is ${at}, not ${r.route}`);
          }
          outcome.ok = true;
        } catch (e) {
          outcome.detail = String(e.message || e);
        } finally {
          if (active !== page) await active.close().catch(() => {});
        }
      }
    } finally {
      await context.close();
    }
    const failed = outcomes.filter((o) => !o.ok);
    // The pages the human reached must be among the replayed ones.
    const covered = expectedPages().filter((route) => outcomes.some((o) => o.ok && (o.route === route || templ(o.route) === templ(route))));
    const uncovered = expectedPages().filter((route) => !covered.includes(route));
    if (failed.length || uncovered.length) return fail(`${outcomes.length} recipes replay to their route and heading`, { failed: failed.map((o) => `${o.route} [${o.viewKey}]: ${o.detail}`), pagesWithoutWorkingRecipe: uncovered });
    return pass(`${outcomes.length} recipes replayed, ${covered.length} visited pages covered`);
  });

  await run('B9 coverage names the unclicked menu items, tab and chip (coverage.json + get-coverage reply)', () => {
    const problems = [];
    const sources = [
      ['coverage.json', coverage],
      ['fp:get-coverage reply', ctx.coverageReply && (ctx.coverageReply.coverage || null)],
    ];
    for (const [name, cov] of sources) {
      if (!cov) {
        problems.push(`${name}: missing (${name === 'coverage.json' ? coverageJ.error : short(ctx.coverageReply)})`);
        continue;
      }
      const unvisited = Array.isArray(cov.unvisitedMenu) ? cov.unvisitedMenu : [];
      const texts = unvisited.map((u) => (u.path || [])[(u.path || []).length - 1] || u.id);
      for (const label of F.menus.neverClicked) if (!texts.some((t) => same(t, label))) problems.push(`${name}: unvisitedMenu lacks "${label}"`);
      const clickedMenu = uniq((S.clicks || []).filter((c) => !c.incidental).map((c) => c.label)).filter((l) => F.menus.all.some((p) => same(p[p.length - 1], l)));
      for (const label of clickedMenu) if (texts.some((t) => same(t, label))) problems.push(`${name}: "${label}" was clicked but is listed unvisited`);
      const pages = Array.isArray(cov.pages) ? cov.pages : [];
      const proc = pages.find((p) => p.route === F.routes.proceedings);
      if (!proc) problems.push(`${name}: no page entry for ${F.routes.proceedings}`);
      else {
        const opts = (proc.viewGroups || []).flatMap((g) => g.options || []);
        const unv = opts.filter((o) => !o.visited).map((o) => o.text);
        const vis = opts.filter((o) => o.visited).map((o) => o.text);
        if (!unv.some((t) => same(t, F.views.tabNeverClicked))) problems.push(`${name}: tab "${F.views.tabNeverClicked}" not listed unvisited (unvisited: ${JSON.stringify(unv)})`);
        if (!unv.some((t) => same(t, F.views.chipNeverClicked))) problems.push(`${name}: chip "${F.views.chipNeverClicked}" not listed unvisited`);
        for (const t of ['Responded', 'Last 30 days', 'Pending', 'All periods']) if (unv.some((u) => same(u, t))) problems.push(`${name}: "${t}" was active or clicked but is listed unvisited`);
        if (!vis.some((t) => same(t, 'Responded'))) problems.push(`${name}: "Responded" not marked visited`);
      }
      if (!Array.isArray(cov.hints) || !cov.hints.length) problems.push(`${name}: no hints`);
    }
    if (ctx.coverageReply && ctx.coverageReply.page && ctx.coverageReply.page.route !== F.routes.proceedings) problems.push(`reply.page.route is ${ctx.coverageReply.page.route}`);
    if (problems.length) return fail('both sources list exactly the unclicked items', problems);
    return pass(`${(coverage.unvisitedMenu || []).length} unvisited menu items, ${(coverage.hints || []).length} hints`);
  });

  await run('B9 the panel\'s Coverage block names a menu item that exists and was not clicked', () => {
    const text = S.panelText;
    if (!text) return skip('panel text was not captured');
    if (!/coverage/i.test(text)) return fail('a Coverage block in the panel', short(text, 300));
    const named = F.menus.neverClicked.filter((l) => text.includes(l));
    if (!named.length) return fail(`one of ${F.menus.neverClicked.join(', ')} in the panel text`, short(text.replace(/\n+/g, ' | '), 500), 'the panel page runs in a tab with chrome.tabs.query shimmed to the fixture tab; it may have been hidden');
    return pass(`panel names ${named.join(', ')}`);
  });

  await run('new tab: the state opened by target=_blank carries openedFrom and a viaNewTab edge', () => {
    const help = states.filter((s) => s.route === F.routes.help && s.openedFrom);
    const edges = (flowJ.ok && Array.isArray(get(flowJ.value, 'transitions')) ? flowJ.value.transitions : []).filter((t) => t.viaNewTab);
    if (!help.length) return fail(`a state on ${F.routes.help} with openedFrom`, states.filter((s) => s.route === F.routes.help).map((s) => `${s.id} openedFrom=${JSON.stringify(s.openedFrom)}`));
    if (!edges.length) return fail('a flow-map transition with viaNewTab:true', 'none');
    return pass(`${help[0].id} opened from ${short(help[0].openedFrom)}`);
  });

  await run('validation error captured as a state with errors', () => {
    const forms = states.filter((s) => s.route === F.routes.forms);
    if (!forms.length) return fail(`states on ${F.routes.forms}`, 'none');
    const withErr = forms.filter((s) => (s.errors || []).some((e) => /required/i.test(e)));
    if (!withErr.length) return fail('a forms state whose errors[] holds "Subject is required"', forms.map((s) => s.errors));
    if (S.validationErrorVisible === false) return fail('the fixture showed the error', 'harness saw no error message');
    return pass(short(withErr[0].errors));
  });

  await run('danger: the Submit button is recorded as danger and was never acted on', () => {
    const forms = states.filter((s) => s.route === F.routes.forms);
    const btn = forms.flatMap((s) => s.buttons || []).find((b) => same(b.text, F.dangerLabel));
    if (!btn) return fail('a "Submit" button record on the forms states', forms.flatMap((s) => (s.buttons || []).map((b) => b.text)));
    if (!btn.danger) return fail('danger:true on Submit', btn);
    const clicked = actions.filter((a) => same(a.label, F.dangerLabel));
    if (clicked.length) return fail('no action on Submit', clicked.map((a) => a.id));
    if ((S.trapHits || []).length) return fail('form never submitted', S.trapHits);
    return pass();
  });

  await run('dependent select: category change recorded as an action, XHR call in the HAR', () => {
    const change = actions.filter((a) => a.kind === 'change' && (same(a.controlKey, 'category') || same(a.chosen, 'Income')));
    const xhr = ((har && har.log && har.log.entries) || []).filter((e) => String(get(e, 'request.url')).includes('/api/subcategories'));
    const problems = [];
    if (!change.length) problems.push('no change action for the category select');
    else if (change.some((a) => a.chosen && !same(a.chosen, 'Income'))) problems.push(`chosen is ${change.map((a) => a.chosen)}`);
    if (!xhr.length) problems.push('no /api/subcategories entry in network.har');
    else if (!/xhr/i.test(String(xhr[0].comment))) problems.push(`HAR comment does not say xhr: ${short(xhr[0].comment)}`);
    if (problems.length) return fail('change action {controlKey:"category", chosen:"Income"} and an xhr HAR entry', problems);
    return pass();
  });

  // =============================================================== D. skeleton
  await run('playwright-skeleton.ts is syntactically valid (tsc)', () => {
    if (!x || !x.has('playwright-skeleton.ts')) return fail('playwright-skeleton.ts', 'missing');
    const tsc = path.join(ctx.repoRoot, 'node_modules', '.bin', 'tsc');
    if (!fs.existsSync(tsc)) return skip('node_modules/.bin/tsc not installed in the repo (npm install)');
    const dir = path.join(ctx.runDir || path.dirname(x.dir), 'skeleton-check');
    fs.mkdirSync(dir, { recursive: true });
    const copy = path.join(dir, 'playwright-skeleton.ts');
    fs.copyFileSync(x.files.get('playwright-skeleton.ts'), copy);
    const r = spawnSync(tsc, ['--noEmit', '--skipLibCheck', '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'Bundler', '--lib', 'ES2022,DOM', copy], { cwd: ctx.repoRoot, encoding: 'utf8' });
    const lines = `${r.stdout || ''}\n${r.stderr || ''}`.split('\n').filter((l) => /error TS\d+/.test(l));
    const acceptable = (l) => /TS2307/.test(l) && /@playwright\/test/.test(l);
    const real = lines.filter((l) => !acceptable(l));
    if (real.length) return fail('no TypeScript errors (an unresolved @playwright/test import is fine)', real.slice(0, 8).map((l) => l.replace(dir + '/', '')));
    const live = (x.text('playwright-skeleton.ts') || '').split('\n').filter((l) => /^\s*await .*(click|goto|waitFor)/.test(l) && !/^\s*\/\//.test(l)).length;
    return pass(`tsc clean; ${live} live navigation lines`);
  });

  await run('A1 DOM snapshots carry open shadow roots as declarative templates', () => {
    if (!x) return fail('dom snapshots', 'no export');
    const dash = states.filter((s) => s.route === F.routes.dashboard && x.has(`dom/${s.__stem}.html`));
    if (!dash.length) return fail(`a dom/ snapshot for a ${F.routes.dashboard} state (the page with <quick-links>)`, 'none');
    const withTpl = dash.filter((s) => /<quick-links[^>]*>\s*<template shadowrootmode="open">/.test(x.text(`dom/${s.__stem}.html`) || ''));
    if (!withTpl.length) {
      const sample = (x.text(`dom/${dash[0].__stem}.html`) || '').match(/<quick-links[^>]*>[\s\S]{0,80}/);
      return fail('<quick-links><template shadowrootmode="open">…View profile…</template>', sample ? sample[0] : 'no <quick-links> in the snapshot', 'without it no action inside a shadow root can be checked against a snapshot');
    }
    return pass(`${withTpl.length}/${dash.length} dashboard snapshots`);
  });

  await run("panel: ticking Keep full API responses is accepted (no false 'Could not change this')", () => {
    const k = S.panelKeepBodies;
    if (!k) return skip('the panel checkbox was not exercised');
    if (k.error) return skip(`panel probe failed: ${k.error}`);
    if (k.flash && /could not/i.test(k.flash)) return fail('a confirmation flash and the box left ticked', { flash: k.flash, boxTickedAfterClick: k.checkedAfterClick, workerKeepBodies: k.workerKeepBodies }, 'the worker did switch; the panel judged its reply as a failure');
    if (k.checkedAfterClick !== true || k.workerKeepBodies !== 'full') return fail('box ticked and worker keepBodies "full"', k);
    return pass(k.flash || 'no flash');
  });

  // =============================================================== E. redaction
  await run('redaction: no fixture secret, typed value or file name anywhere in the export', () => {
    if (!x) return fail('an export to grep', 'none');
    const T = S.typed || {};
    const probes = [
      ['email', new RegExp(F.secrets.emailRe, 'g')],
      ['phone', new RegExp(F.secrets.phoneRe, 'g')],
      ['tax id (PAN-shaped)', new RegExp(F.secrets.taxIdRe, 'g')],
      ['password typed at login', T.password],
      ['user id typed at login', T.userId],
      ['text typed into the form', T.subjectText],
      ['selected file name', T.fileName && T.fileName.replace(/\.[a-z]+$/i, '')],
      ['PDF download file name', F.downloads.pdfFileName.replace(/\.[a-z]+$/i, '')],
      ['blob download file name', F.downloads.blobFileName.replace(/\.[a-z]+$/i, '')],
    ].filter(([, p]) => p);
    const hits = {};
    let scanned = 0;
    for (const [rel, abs] of x.files) {
      if (/\.(png|jpe?g|webp)$/i.test(rel)) continue;
      let text;
      try {
        text = readText(abs);
      } catch {
        continue;
      }
      scanned++;
      for (const [name, probe] of probes) {
        const re = probe instanceof RegExp ? probe : new RegExp(probe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        re.lastIndex = 0;
        let m;
        let count = 0;
        while ((m = re.exec(text)) && count < 3) {
          count++;
          const ctxText = text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).replace(/\s+/g, ' ');
          (hits[name] = hits[name] || []).push(`${rel}: …${ctxText}…`);
        }
      }
    }
    const names = Object.keys(hits);
    if (names.length) {
      const found = {};
      for (const nme of names) {
        const files = uniq(hits[nme].map((h) => h.split(':')[0]));
        found[nme] = { files: files.length, folders: uniq(files.map((f) => (f.includes('/') ? `${f.split('/')[0]}/` : f))), examples: hits[nme].slice(0, 2) };
      }
      return fail('zero occurrences in every text file and dom snapshot', found, `${scanned} files scanned`);
    }
    return pass(`${scanned} files scanned for ${probes.length} probes`);
  });

  // =============================================================== F. behaviour of the extension itself
  await run('the extension never acted on the page (fixture detector empty, form never submitted)', () => {
    const acted = S.actedUpon || [];
    const trap = S.trapHits || [];
    if (acted.length || trap.length) return fail('empty detector array and no hits on the form action', { acted: acted.slice(0, 10).map((a) => `${a.kind} on ${a.target} at ${a.route}${a.stack ? ` — ${a.stack.slice(0, 200)}` : ''}`), trapHits: trap });
    return pass();
  });

  await run('no request left the browser for any host but the fixture', () => {
    const origin = S.origin || ctx.fixtureOrigin;
    const allowedHost = origin ? new URL(origin).host : '';
    const altHost = allowedHost.replace('localhost', '127.0.0.1');
    const reqs = S.requests || [];
    const other = reqs.filter((r) => ['http', 'https', 'ws', 'wss'].includes(r.scheme) && r.host !== allowedHost && r.host !== altHost);
    // The proxy sees the whole browser process. Hosts the extension-free baseline browser also
    // reached are Chromium's own (sign-in, GCM, time sync) and are reported, not failed.
    const browserOwn = new Set((S.baselineSeen || []).filter((r) => !r.allowed).map((r) => r.host));
    // Chromium's own service hosts (sign-in, GCM, component updater), which fire on timers and so
    // do not always show up in the baseline's shorter life. Nothing in src/ names them (see the
    // domain check), and the page- and worker-level request log above is held to the fixture alone.
    const CHROMIUM_INFRA = /(^|\.)(google\.com|googleapis\.com|gvt1\.com|gvt2\.com|gstatic\.com)(:\d+)?$/;
    const infraSeen = uniq((S.proxySeen || []).filter((r) => !r.allowed && !browserOwn.has(r.host) && CHROMIUM_INFRA.test(r.host)).map((r) => r.host));
    infraSeen.forEach((h) => browserOwn.add(h));
    const proxyOther = (S.proxySeen || []).filter((r) => !r.allowed && !browserOwn.has(r.host));
    const hosts = uniq(other.map((r) => r.host));
    const proxyHosts = uniq(proxyOther.map((r) => r.host));
    if (hosts.length || proxyHosts.length) return fail(`only ${allowedHost} (beyond what an extension-free browser with the same flags contacts)`, { pageLevelHosts: hosts, proxyHostsNotInBaseline: proxyHosts, baselineHosts: Array.from(browserOwn), examples: [...other, ...proxyOther].slice(0, 8).map((r) => `${r.method || r.type || ''} ${r.url}`) });
    const fromWorker = reqs.filter((r) => r.fromWorker).length;
    const note = S.baselineSeen ? `; Chromium's own, seen in the baseline too: ${Array.from(browserOwn).join(' ') || 'none'}` : '; no baseline browser ran';
    return pass(`${reqs.length} page-level requests${S.proxySeen ? `, ${S.proxySeen.length} through the proxy` : ''}, ${fromWorker} from the worker; hosts: ${uniq(reqs.map((r) => `${r.scheme}://${r.host}`)).join(' ')}${note}`);
  });

  await run('nothing in src/ names a domain, and npm run check passes', () => {
    const src = path.join(ctx.repoRoot, 'src');
    // A domain in code lives in a string, a template or a comment; `KEYS.NET` and `f.info` are property access.
    const ALLOW = /(^|[.-])example\.(com|org|net)$|(^|\.)(w3\.org|localhost|schema\.org|mozilla\.org|chromium\.org|chrome\.com|typescriptlang\.org)$/;
    const DOMAIN_RE = /\b(?:[a-z0-9-]+\.)+(?:com|org|net|in|gov|io|co|edu|uk|de|us|info|biz|app|dev)\b/g;
    const LITERAL_RE = /(['"`])(?:\\[\s\S]|(?!\1)[^\\])*?\1|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
    const hits = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) walk(abs);
        else if (/\.(js|html|css|json|ts)$/.test(e.name)) {
          const text = fs.readFileSync(abs, 'utf8');
          const segments = /\.(js|ts)$/.test(e.name) ? Array.from(text.matchAll(LITERAL_RE), (m) => ({ s: m[0], at: m.index })) : [{ s: text, at: 0 }];
          for (const seg of segments) {
            for (const m of seg.s.matchAll(DOMAIN_RE)) {
              if (ALLOW.test(m[0])) continue;
              const line = text.slice(0, seg.at + m.index).split('\n').length;
              hits.push(`${path.relative(ctx.repoRoot, abs)}:${line}: ${m[0]}`);
            }
          }
        }
      }
    };
    walk(src);
    const r = spawnSync('npm', ['run', 'check', '--silent'], { cwd: ctx.repoRoot, encoding: 'utf8' });
    const tscOk = r.status === 0;
    const problems = [];
    if (hits.length) problems.push(`domain-like literals: ${hits.slice(0, 8).join('; ')}${hits.length > 8 ? ` (+${hits.length - 8})` : ''}`);
    if (!tscOk) problems.push(`npm run check exit ${r.status}: ${`${r.stdout}\n${r.stderr}`.split('\n').filter((l) => /error TS/.test(l)).slice(0, 5).join(' | ') || short(r.stderr, 300)}`);
    if (problems.length) return fail('no domain literals in src/ and a clean type gate', problems);
    return pass('no domain literals; tsc clean');
  });

  return results;
}

// ------------------------------------------------------------- replay helpers

async function routeOfPage(page) {
  try {
    return await page.evaluate(() => {
      const m = /^#(\/[^?]*)/.exec(location.hash || '');
      return location.pathname + (m ? `#${m[1]}` : '');
    });
  } catch {
    return '(unavailable)';
  }
}

async function waitForRoute(page, expected, timeout) {
  if (!expected) return true;
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const at = await routeOfPage(page);
    if (at === expected || templ(at) === templ(expected)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function headingsOf(page) {
  try {
    return await page.evaluate(() => {
      const out = [];
      const walk = (root) => {
        root.querySelectorAll('h1, h2, h3, h4, [role="heading"]').forEach((h) => out.push((h.textContent || '').replace(/\s+/g, ' ').trim()));
        root.querySelectorAll('*').forEach((el) => el.shadowRoot && walk(el.shadowRoot));
      };
      walk(document);
      return out;
    });
  } catch {
    return [];
  }
}

async function waitForHeading(page, expected, timeout) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const hs = await headingsOf(page);
    if (hs.some((h) => same(h, expected))) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

/**
 * Turn a RouteStep's selectors into one Playwright locator that matches
 * exactly one visible element: role+name first, then primary (through the
 * shadow path), then each fallback.
 */
async function resolveStep(page, step) {
  const sel = step.selectors || {};
  const tried = [];
  const candidates = [];
  if (sel.role && sel.name) candidates.push({ via: `role=${sel.role} name="${sel.name}"`, make: () => page.getByRole(sel.role, { name: sel.name, exact: true }) });
  const chain = (css) => {
    let loc = page;
    for (const host of sel.shadowPath || []) loc = loc.locator(host);
    return loc === page ? page.locator(css) : loc.locator(css);
  };
  if (sel.primary) candidates.push({ via: `primary ${sel.primary}`, make: () => chain(sel.primary) });
  for (const fb of sel.fallbacks || []) candidates.push({ via: `fallback ${fb}`, make: () => chain(fb) });
  if (!candidates.length && step.href) candidates.push({ via: `href ${step.href}`, make: () => page.locator(`a[href$="${step.href.replace(/^.*#/, '#')}"]`) });
  for (const c of candidates) {
    let loc;
    try {
      loc = c.make();
      await loc.first().waitFor({ state: 'attached', timeout: 1500 }).catch(() => {});
      const count = await loc.count();
      if (count !== 1) {
        tried.push(`${c.via} → ${count} matches`);
        continue;
      }
      if (!(await loc.isVisible())) {
        tried.push(`${c.via} → not visible`);
        continue;
      }
      return { locator: loc, via: c.via };
    } catch (e) {
      tried.push(`${c.via} → ${String(e.message || e).split('\n')[0].slice(0, 100)}`);
    }
  }
  return { locator: null, via: tried.join('; ') || 'no selectors on the step' };
}
