/**
 * RECIPES.md — docs/12 B8. The site, page by page, written for someone who
 * has never seen it and has to write the automation from this file alone:
 * how to reach each page, what to check on arrival, which views to iterate,
 * which lists to read and how, which endpoints feed them, which downloads
 * were seen, and what the recording never touched.
 *
 * Pure: no chrome.*, no storage.
 */
import { TOOL_NAME, TOOL_VERSION } from '../../shared/constants.js';
import { PLACEHOLDER_RE } from './naming.js';
import { arr, pageLabels, pagesInMenuOrder } from './sitemap.js';
import { templateUrl, looksLikeId } from './apicatalog.js';
import { cell, trunc, code, quoted, locatorsFor, actionPhrase, isLengthOnly } from './narrative.js';

/** @typedef {import('../../shared/schema.js').SiteMap} SiteMap */
/** @typedef {import('../../shared/schema.js').SitePage} SitePage */
/** @typedef {import('../../shared/schema.js').RoutesFile} RoutesFile */
/** @typedef {import('../../shared/schema.js').RouteRecipe} RouteRecipe */
/** @typedef {import('../../shared/schema.js').RouteStep} RouteStep */
/** @typedef {import('../../shared/schema.js').ApiCatalog} ApiCatalog */
/** @typedef {import('../../shared/schema.js').ApiEndpoint} ApiEndpoint */
/** @typedef {import('../../shared/schema.js').Coverage} Coverage */
/** @typedef {import('../../shared/schema.js').DownloadEntry} DownloadEntry */
/** @typedef {import('../../shared/schema.js').ActionEntry} ActionEntry */
/** @typedef {import('../../shared/schema.js').FlowMapList} FlowMapList */
/** @typedef {import('../../shared/schema.js').TablePattern} TablePattern */
/** @typedef {import('../../shared/schema.js').RepeatPattern} RepeatPattern */
/** @typedef {import('../../shared/schema.js').PaginationPattern} PaginationPattern */
/** @typedef {import('../../shared/schema.js').JsonShape} JsonShape */

/**
 * What the fixed builder signature cannot carry but a reader needs: the
 * actions behind downloads, and the list patterns with their row, cell and
 * pagination selectors (flow-map.json `lists`).
 * @typedef {Object} RecipeDetail
 * @property {ActionEntry[]} [actions]
 * @property {FlowMapList[]} [lists]
 * @property {string[]} [fullBodies]   net ids whose full body is in `api/bodies/`
 */

const MAX_FIELDS = 30;

/**
 * Parameters that choose where a page starts. The rest of `pagingParams`
 * (`size`, `limit`, `perPage`…) choose how many rows a page holds.
 */
const POSITION_WORD_RE = /page(?!\s*size)|offset|start|skip|cursor|token|after|before|from/i;
const SIZE_WORD_RE = /size|limit|per\s*page|top|count|max|rows/i;

/**
 * @param {string} name
 * @returns {boolean}
 */
function isPositionParam(name) {
  const words = String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[^A-Za-z0-9]+/g, ' ');
  return POSITION_WORD_RE.test(words) && !SIZE_WORD_RE.test(words);
}

/**
 * @param {number} n
 * @returns {string}
 */
function bytes(n) {
  if (!(n >= 0)) return 'size unknown';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Follow a `$.a.b[].c` path into a shape.
 * @param {JsonShape|null} shape
 * @param {string} path
 * @returns {JsonShape|null}
 */
function shapeAt(shape, path) {
  let cur = shape;
  const tokens = path.replace(/^\$/, '').match(/\.[A-Za-z_$][\w$]*|\[\]|\[("(?:[^"\\]|\\.)*")\]/g) || [];
  for (const tok of tokens) {
    if (!cur) return null;
    if (tok === '[]') cur = cur.t === 'array' && cur.item ? cur.item : null;
    else if (tok.startsWith('.')) cur = cur.t === 'object' && cur.keys ? cur.keys[tok.slice(1)] || null : null;
    else {
      try {
        const key = JSON.parse(tok.slice(1, -1));
        cur = cur.t === 'object' && cur.keys ? cur.keys[key] || null : null;
      } catch {
        return null;
      }
    }
  }
  return cur;
}

/**
 * @param {JsonShape} s
 * @returns {string}
 */
function typeWord(s) {
  if (s.t === 'string') {
    if (s.values && s.values.length) return `one of ${s.values.map((v) => quoted(v, 30)).join(', ')}`;
    return s.format && s.format !== 'text' ? `string (${s.format})` : 'string';
  }
  if (s.t === 'array') return `array of ${s.item ? typeWord(s.item) : 'unknown'}`;
  if (s.t === 'object') return `object${s.keys ? ` {${Object.keys(s.keys).slice(0, 6).join(', ')}${Object.keys(s.keys).length > 6 ? ', …' : ''}}` : ''}`;
  return s.t;
}

/**
 * @param {JsonShape|null} item
 * @returns {string}
 */
function fieldList(item) {
  if (!item || item.t !== 'object' || !item.keys) return '';
  const optional = new Set(item.optional || []);
  const keys = Object.keys(item.keys);
  const parts = keys.slice(0, MAX_FIELDS).map((k) => `${code(k)}${optional.has(k) ? '?' : ''} ${typeWord(item.keys ? item.keys[k] : { t: 'mixed' })}${item.keys && item.keys[k].nullable ? ', nullable' : ''}`);
  return parts.join('; ') + (keys.length > MAX_FIELDS ? `; … ${keys.length - MAX_FIELDS} more` : '');
}

/**
 * @param {string[]} out
 * @param {import('../../shared/schema.js').ActionSelectors|null|undefined} sel
 * @param {string} indent
 */
function pushLocators(out, sel, indent) {
  const loc = locatorsFor(sel);
  if (loc.best) out.push(`${indent}- locator: ${code(loc.best)}`);
  for (const o of loc.others) out.push(`${indent}- else: ${code(o)}`);
  for (const n of loc.notes) out.push(`${indent}- note: ${n}`);
}

/**
 * @param {string[]} out
 * @param {RouteStep} step
 * @param {boolean} prep   opens a menu branch for the step after it
 * @param {ActionEntry|undefined} action
 * @param {boolean} afterItem   an earlier step opened one particular list item
 * @returns {boolean}   whether this step opened a list item
 */
function pushStep(out, step, prep, action, afterItem) {
  const itemOpen = !!action && !!action.listSelector && !action.pagination && !action.viewGroup && step.kind === 'click';
  const label = step.label && !isLengthOnly(step.label) ? quoted(step.label) : 'the recorded element';
  const verb = step.kind === 'change' ? (step.chosen ? `Choose ${quoted(step.chosen)} in` : 'Change') : 'Click';
  const where = step.menuPath.length ? ` (menu: ${step.menuPath.map((m) => cell(m)).join(' > ')})` : step.href ? ` (link to ${code(step.href)})` : '';
  const what =
    itemOpen && action
      ? `**Open an item of the list ${code(action.listSelector)}**${isLengthOnly(step.label) ? ` — the row's text was withheld at capture (${step.label} is only its length); the locator below is the row the person clicked, and any row leads to the same kind of page` : ` — the person clicked ${quoted(step.label)}; any item leads to the same kind of page`}`
      : `**${verb} ${label}**${where}`;
  out.push(`${step.n}. ${what}${prep ? ' — opens the menu branch for the next step; skip it when that target is already visible' : ''}${step.opensNewTab ? ' — **opens a new tab**; continue there' : ''}. _${step.actionId}, ${step.fromStateId} → ${step.toStateId}_`);
  pushLocators(out, step.selectors, '   ');
  if (!prep) {
    // Once a step has opened one particular item, identifiers in the route are that item's.
    const looseRoute = (itemOpen || afterItem) && step.expectRoute.split('/').some(looksLikeId);
    const checks = [`route ${code(step.expectRoute)}${looseRoute ? ' (identifier segments in it belong to the item that was opened; match them as wildcards)' : ''}`];
    if (step.expectViewKey) checks.push(`view ${code(step.expectViewKey)}`);
    // A heading on an item page names the item; it cannot be expected verbatim for another one.
    if (step.expectHeading && !PLACEHOLDER_RE.test(step.expectHeading) && !itemOpen && !looseRoute) checks.push(`heading ${quoted(step.expectHeading, 60)} visible`);
    out.push(`   - then expect: ${checks.join(', ')}`);
  }
  return itemOpen;
}

/**
 * @param {SiteMap} siteMap
 * @param {RoutesFile} routes
 * @param {ApiCatalog} catalog
 * @param {Coverage} coverage
 * @param {DownloadEntry[]} downloads
 * @param {RecipeDetail} [detail]
 * @returns {string}
 */
export function buildRecipes(siteMap, routes, catalog, coverage, downloads, detail) {
  const more = detail || {};
  const pages = pagesInMenuOrder(siteMap);
  const labels = pageLabels(siteMap);
  const menu = arr(siteMap && siteMap.menu);
  const recipes = arr(routes && routes.recipes);
  const endpoints = arr(catalog && catalog.endpoints);
  /** @type {Map<string, ApiEndpoint>} */
  const endpointById = new Map(endpoints.map((e) => [e.id, e]));
  /** @type {Map<string, DownloadEntry>} */
  const downloadById = new Map(arr(downloads).filter((d) => d && d.id).map((d) => [d.id, d]));
  /** @type {Map<string, ActionEntry>} */
  const actionById = new Map(arr(more.actions).filter((a) => a && a.id).map((a) => [a.id, a]));
  /** @type {Map<string, import('../../shared/schema.js').CoveragePage>} */
  const coverageByPage = new Map(arr(coverage && coverage.pages).map((p) => [p.pageId, p]));
  /** @type {Map<string, FlowMapList>} kind|selector → pattern */
  const patternByKey = new Map();
  for (const l of arr(more.lists)) if (l && l.selector) patternByKey.set(`${l.kind}|${l.selector}`, l);
  const origin = String((siteMap && siteMap.origin) || (routes && routes.origin) || '');
  const withBody = new Set(arr(more.fullBodies));

  /** @type {string[]} */
  const out = [];
  const name = (/** @type {SitePage} */ p) => labels.get(p.id) || p.route;

  // ---- header
  out.push(`# Recipes — ${origin}`);
  out.push('');
  out.push(`Written by ${TOOL_NAME} ${TOOL_VERSION} on ${new Date().toISOString()} from a recording of a person using the site. ${pages.length} page${pages.length === 1 ? '' : 's'}, ${endpoints.length} endpoint${endpoints.length === 1 ? '' : 's'}, ${arr(downloads).length} download${arr(downloads).length === 1 ? '' : 's'}.`);
  out.push('');
  out.push('**How to use this file.** One section per page. Each says how to get there by clicking from the entry state, what to check on arrival, which views (tabs, filters) exist and which were tried, which lists to read and with which selectors, which API responses carry the same data, which downloads were seen, and what the recording never exercised. Everything here was observed once; verify each locator at run time and fail loudly when it does not match exactly one element.');
  out.push('');
  out.push('- **Locators** are listed best first: role plus accessible name, then the primary CSS selector, then fallbacks. Use the first that resolves to exactly one element.');
  out.push('- **Start** at the entry state after the human has logged in. Login, OTP, captcha, payment and final submission are never automated.');
  out.push('- **`<UPPERCASE>` placeholders** (`<PHONE>`, `<PAN>`, …) are values a redaction pack removed at capture. Treat them as wildcards, never as literal text.');
  out.push('- **`<n chars>` labels** (`<14 chars>`) are the text of a table row or list item, withheld at capture because it is record data; only its length was kept. Never search for that text.');
  out.push('- **Steps marked "opens the menu branch"** change nothing on the page but reveal the next step\'s target. Skip them when it is already visible.');
  out.push('- **Nothing here is permission to act.** Read the constraints block in `AUTOMATION-BRIEF.md` before writing anything. Downloads and API reads must run inside the user\'s own logged-in session and must respect the site\'s rate limits.');
  out.push('');

  const entry = routes && routes.entryRoute ? routes.entryRoute : null;
  if (entry) out.push(`**Entry state:** ${code(entry)} (${routes.entryStateId}). Every "reach it" path below starts here.`);
  else out.push('**Entry state:** none — no states were recorded for this origin.');
  out.push('');

  // ---- menu
  out.push('## Site menu');
  out.push('');
  if (!menu.length) out.push('_No navigation menu was recognised. Pages were reached by other means; see each section._');
  for (const node of menu) {
    const indent = '  '.repeat(Math.min(node.depth || 0, 8));
    const leads = arr(node.leadsTo).map((id) => {
      const p = pages.find((x) => x.id === id);
      return p ? `→ §${pages.indexOf(p) + 1} ${quoted(name(p), 40)}` : `→ ${id}`;
    });
    const bits = [node.visited ? 'visited' : '**never opened**', ...leads, node.href ? code(node.href) : '', node.selector ? `selector ${code(node.selector)}` : ''].filter(Boolean);
    out.push(`${indent}- ${cell(trunc(node.text, 60))}${node.hasChildren ? ' ▸' : ''} — ${bits.join(', ')}`);
  }
  out.push('');

  // ---- contents
  out.push('## Pages');
  out.push('');
  pages.forEach((p, i) => out.push(`${i + 1}. ${cell(name(p))} — ${code(p.route)} (${p.id}${arr(p.views).length > 1 ? `, ${p.views.length} views` : ''})`));
  if (!pages.length) out.push('_No pages were recorded._');
  out.push('');

  // ---- one section per page
  pages.forEach((p, i) => {
    const cov = coverageByPage.get(p.id);
    const pageRecipes = recipes.filter((r) => r.pageId === p.id || (!r.pageId && r.route === p.route));
    out.push(`## ${i + 1}. ${cell(name(p))} — ${code(p.route)}`);
    out.push('');
    out.push(`Page ${code(p.id)}; ${p.stateIds.length} recorded state${p.stateIds.length === 1 ? '' : 's'} (${p.stateIds.slice(0, 8).join(', ')}${p.stateIds.length > 8 ? ', …' : ''}); ${p.loggedIn ? 'seen while logged in' : 'no logged-in signal'}.${p.title ? ` Document title ${quoted(p.title, 60)}.` : ''}${p.headings.length ? ` Headings: ${p.headings.map((h) => quoted(h, 50)).join(', ')}.` : ''}`);
    out.push('');

    // reach it
    out.push('### Reach it');
    out.push('');
    // The shortest way onto the page, whichever view it lands on; the other views follow below.
    const main = pageRecipes.slice().sort((a, b) => Number(b.reachable) - Number(a.reachable) || a.steps.length - b.steps.length || Number(!!a.viewKey) - Number(!!b.viewKey))[0];
    if (!main) out.push('_No route was computed for this page._');
    else {
      if (main.directUrl) out.push(`Direct URL: ${code(main.directUrl)} — this route was observed as a page load, so opening it inside the logged-in session should work.`);
      if (!main.reachable) out.push(`**Not reachable by recorded clicks.** ${cell(main.note)}`);
      else if (!main.steps.length) out.push(`This is the entry state (${main.targetStateId}): the recording starts here, after the human has logged in.`);
      else {
        out.push(`From the entry state${entry ? ` ${code(entry)}` : ''}, ${main.steps.length} step${main.steps.length === 1 ? '' : 's'} (target state ${main.targetStateId}):`);
        out.push('');
        let afterItem = false;
        for (const step of main.steps) if (pushStep(out, step, step.fromStateId === step.toStateId, actionById.get(step.actionId), afterItem)) afterItem = true;
        if (main.note) {
          out.push('');
          out.push(`_${cell(main.note)}_`);
        }
      }
    }
    out.push('');

    // verify
    out.push('### Verify on arrival');
    out.push('');
    out.push(`- The route is ${code(p.route)}${PLACEHOLDER_RE.test(p.route) ? ' (a redacted segment: compare with the placeholder as a wildcard)' : ''}.`);
    const heading = p.headings.find((h) => h && !PLACEHOLDER_RE.test(h));
    if (heading) out.push(`- A heading reading ${quoted(heading, 60)} is visible.`);
    if (p.title) out.push(`- The document title is ${quoted(p.title, 60)}${pages.filter((x) => x.title === p.title).length > 1 ? ' (shared with other pages; not a distinguishing check)' : ''}.`);
    for (const l of p.lists) out.push(`- The ${l.kind === 'table' ? 'table' : 'list'} ${code(l.selector)} is present.`);
    out.push('');

    // views
    out.push('### Views to iterate');
    out.push('');
    if (!p.viewGroups.length) out.push('_No tabs, filter chips or view switches were seen on this page._');
    for (const g of p.viewGroups) {
      out.push(`- **${cell(g.label || g.name)}** (${g.kind}, container ${code(g.containerSelector)}${g.shadowPath.length ? `, inside shadow root(s) ${g.shadowPath.map((h) => code(h)).join(' → ')}` : ''}) — ${g.options.length} option${g.options.length === 1 ? '' : 's'}, ${g.options.filter((o) => o.visited).length} tried:`);
      for (const o of g.options) out.push(`  - ${quoted(o.text, 60)} — ${code(o.selector)}${o.visited ? '' : ' — **never selected**; its content is unknown'}`);
    }
    const views = arr(p.views).filter((v) => v.key);
    if (views.length) {
      out.push('');
      out.push(`Recorded view keys on this page: ${views.map((v) => `${code(v.key)} (${v.stateIds.join(', ')})`).join('; ')}. Each key names the option selected per group, plus the page number when the list was paged.`);
      const viewRecipes = pageRecipes.filter((r) => r.viewKey && r.reachable && r.steps.length);
      for (const r of viewRecipes) {
        const last = r.steps[r.steps.length - 1];
        out.push(`- View ${code(r.viewKey)}: ${r.steps.length} step${r.steps.length === 1 ? '' : 's'} from the entry state; the last is ${actionPhrase({ kind: last.kind, label: last.label, menuPath: last.menuPath, chosen: last.chosen })} (${last.actionId}). Full steps in \`routes.json\`.`);
      }
    }
    out.push('');

    // lists
    out.push('### Lists');
    out.push('');
    if (!p.lists.length) out.push('_No tables or repeated items were detected on this page._');
    for (const l of p.lists) {
      const pat = patternByKey.get(`${l.kind}|${l.selector}`);
      out.push(`- **${l.kind === 'table' ? 'Table' : 'Repeated items'}** ${code(l.selector)}`);
      if (l.kind === 'table') {
        const t = pat && pat.kind === 'table' ? /** @type {TablePattern} */ (pat.pattern) : null;
        out.push(`  - columns: ${l.headers.length ? l.headers.map((h) => quoted(h, 40)).join(', ') : '(no header text found)'}`);
        if (t) {
          out.push(`  - rows: ${code(t.rowSelector)} relative to the table (${t.rowCount} when recorded)${t.shadowPath.length ? `; table sits inside shadow root(s) ${t.shadowPath.map((h) => code(h)).join(' → ')}` : ''}`);
          if (t.sampleRow.length) out.push(`  - cells, relative to a row: ${t.sampleRow.map((c, k) => `${l.headers[k] ? quoted(l.headers[k], 30) + ' ' : ''}${code(c.selector)}`).join(', ')}`);
        } else out.push('  - row and cell selectors: see this table in `flow-map.json` → `lists`');
      } else {
        const r = pat && pat.kind === 'repeat' ? /** @type {RepeatPattern} */ (pat.pattern) : null;
        if (r) {
          out.push(`  - items: ${code(r.itemSelector)} (${r.itemCount} when recorded)${r.shadowPath.length ? `; inside shadow root(s) ${r.shadowPath.map((h) => code(h)).join(' → ')}` : ''}`);
          out.push(`  - per item: ${r.slots.length ? r.slots.map((s) => `${s.name} ${s.kind} ${code(s.selector)}${s.download ? ' **(download link)**' : ''}`).join('; ') : 'no text, link or image slots were found'}`);
        } else out.push('  - item and slot selectors: see this list in `flow-map.json` → `lists`');
      }
      if (l.hasPagination) {
        const pagers = arr(more.lists).filter((x) => x.kind === 'pagination' && x.seenOnStates.some((sid) => p.stateIds.includes(sid)));
        out.push(`  - pagination: yes${l.paged ? ', and the recording paged through it' : ', **never paged in the recording** — later pages are unknown'}`);
        for (const pg of pagers) {
          const pp = /** @type {PaginationPattern} */ (pg.pattern);
          if (!pp.next && !pp.prev && !pp.pageIndicator) continue;
          out.push(`    - controls in ${code(pp.containerSelector)} (${pp.style}): next ${pp.next ? code(pp.next) : '—'}, prev ${pp.prev ? code(pp.prev) : '—'}, indicator ${pp.pageIndicator ? code(pp.pageIndicator) : '—'}${pp.current ? `, read ${quoted(pp.current, 40)} when recorded` : ''}`);
        }
        if (!pagers.length) out.push('    - controls: see the `pagination` entries for this page in `flow-map.json`');
      } else out.push('  - pagination: none seen');
      out.push(`  - item opened in the recording: ${l.itemOpened ? 'yes' : 'no — what an item leads to is unknown'}; download from an item: ${l.downloadSeen ? 'yes' : 'no'}`);
      if (l.apiEndpoints.length) out.push(`  - data most likely comes from: ${l.apiEndpoints.map((id) => code(id)).join(', ')} (below)`);
    }
    out.push('');

    // api
    out.push('### API endpoints behind this page');
    out.push('');
    const ids = Array.from(new Set([...arr(p.apiEndpoints), ...p.lists.flatMap((l) => l.apiEndpoints)])).sort();
    if (!ids.length) out.push('_No fetch/XHR call was attributed to this page._');
    else {
      out.push('Reading the API response through the page\'s own session — `page.waitForResponse()` while the page makes the call, or `page.request` which carries the page\'s cookies — is usually sturdier than parsing the DOM, and gives every field, not only the visible columns.');
      out.push('');
    }
    for (const id of ids) {
      const e = endpointById.get(id);
      if (!e) {
        out.push(`- ${code(id)} — not in \`api-catalog.json\``);
        continue;
      }
      out.push(`- ${code(e.id)} **${e.method}** ${code(e.urlTemplate)} — ${e.count} call${e.count === 1 ? '' : 's'}, status ${e.statuses.join('/') || '?'}, ${e.mimeType || 'unknown type'}${e.isDownload ? ', **serves a file**' : ''}`);
      if (e.queryKeys.length) out.push(`  - query parameters: ${e.queryKeys.map((k) => code(k)).join(', ')}`);
      if (e.pagingParams.length) {
        const position = e.pagingParams.filter(isPositionParam);
        const size = e.pagingParams.filter((k) => !isPositionParam(k));
        /** @type {string[]} */
        const parts = [];
        if (position.length) parts.push(`${position.map((k) => code(k)).join(', ')} choose${position.length === 1 ? 's' : ''} which page (step ${position.length === 1 ? 'it' : 'them'} until a page comes back short or empty)`);
        if (size.length) parts.push(`${size.map((k) => code(k)).join(', ')} set${size.length === 1 ? 's' : ''} how many rows a page holds`);
        out.push(`  - paging parameters: ${parts.join('; ')}. Judged by name only; check against a real response.`);
      }
      if (e.requestShape && e.requestShape.t === 'object' && e.requestShape.keys) out.push(`  - request body keys: ${Object.keys(e.requestShape.keys).slice(0, 20).map((k) => code(k)).join(', ')}`);
      for (const lp of e.listPaths) {
        out.push(`  - rows at ${code(lp.path)} (${lp.len} per call when recorded)`);
        const fields = fieldList(shapeAt(e.responseShape, `${lp.path}[]`));
        if (fields) out.push(`    - row fields: ${fields}`);
      }
      if (!e.listPaths.length && e.responseShape && e.responseShape.t === 'object' && e.responseShape.keys) out.push(`  - response keys: ${Object.keys(e.responseShape.keys).slice(0, 20).map((k) => code(k)).join(', ')}`);
      if (e.actionIds.length) out.push(`  - triggered after: ${e.actionIds.slice(0, 5).map((a) => (actionById.has(a) ? `${actionPhrase(/** @type {ActionEntry} */ (actionById.get(a)))} (${a})` : a)).join('; ')}`);
      const bodies = e.netIds.filter((n) => withBody.has(n));
      if (bodies.length) out.push(`  - full scrubbed response${bodies.length === 1 ? '' : 's'} kept: ${bodies.slice(0, 5).map((n) => code(`api/bodies/${n}.json`)).join(', ')}${bodies.length > 5 ? `, and ${bodies.length - 5} more` : ''}`);
      else if (e.hasFullBody) out.push('  - full scrubbed responses were kept for some calls: see `hasFullBody` and `netIds` in `api-catalog.json`, files under `api/bodies/`');
    }
    out.push('');

    // downloads
    out.push('### Downloads seen here');
    out.push('');
    if (!p.downloadIds.length) out.push(cov && cov.missing.some((m) => /download/i.test(m)) ? '_None recorded, although the page shows download links. See coverage below._' : '_None recorded._');
    for (const id of p.downloadIds) {
      const d = downloadById.get(id);
      if (!d) continue;
      const how = d.urlKind === 'http' && d.url ? `URL ${code(templateUrl(d.url, origin))}${d.queryKeys.length ? ` with query parameters ${d.queryKeys.map((k) => code(k)).join(', ')}` : ''}` : 'generated in the page (blob), no URL to fetch';
      out.push(`- ${code(d.id)} — ${d.extension ? `.${d.extension}` : 'unknown extension'}, ${d.mime || 'unknown MIME type'}, ${bytes(d.sizeBytes)}, ${d.state}; ${how}. File name shape ${code(d.nameShape)} (letters → \`A{n}\`, digits → \`9{n}\`; the name itself was never stored).`);
      const a = d.actionId ? actionById.get(d.actionId) : undefined;
      if (a) {
        out.push(`  - trigger: ${actionPhrase(a)} (${a.id})`);
        pushLocators(out, a.selectors, '  ');
      } else if (d.actionId) out.push(`  - trigger: action ${code(d.actionId)} (see \`actions.json\`)`);
      else out.push('  - trigger: no action was attributed to this download');
      if (d.netId) out.push(`  - the same URL was captured as network call ${code(d.netId)}`);
      out.push(`  - capture it with \`page.waitForEvent('download')\` armed before the click${d.urlKind === 'http' ? ', or fetch the URL inside the same session' : ''}.`);
    }
    out.push('');

    // coverage
    out.push('### What the recording did not cover here');
    out.push('');
    if (!cov) out.push('_No coverage entry._');
    else if (cov.complete) out.push('_Nothing the recording could detect: no unselected view option, no unpaged list, no list without an opened item, no unrecorded download._');
    else for (const m of cov.missing) out.push(`- ${cell(m)}`);
    out.push('');
  });

  // ---- what was never opened
  const unvisited = arr(coverage && coverage.unvisitedMenu);
  out.push('## Not covered');
  out.push('');
  if (!unvisited.length) out.push('_Every menu item that was seen was also opened._');
  else {
    out.push(`${unvisited.length} menu item${unvisited.length === 1 ? ' was' : 's were'} seen and never opened. What lies behind them is unknown; record another session that opens them if they matter.`);
    out.push('');
    for (const u of unvisited.slice(0, 100)) out.push(`- ${cell(u.path.join(' > '))} — ${code(u.selector)}`);
    if (unvisited.length > 100) out.push(`- … and ${unvisited.length - 100} more in \`coverage.json\``);
  }
  out.push('');
  return out.join('\n');
}
