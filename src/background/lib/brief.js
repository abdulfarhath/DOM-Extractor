/**
 * AUTOMATION-BRIEF.md — docs/08, docs/12 B8. The agent handoff: written for
 * someone who has never seen the site. Fifteen sections, in the order
 * docs/08 lists them with the docs/12 additions slotted in; the constraints
 * block is included verbatim.
 */
import { TOOL_NAME, TOOL_VERSION } from '../../shared/constants.js';
import { stemFor, routeOf, viewKeyOf, PLACEHOLDER_RE } from './naming.js';
import { flowNarrative, attentionList, renderSection, coverageLines, locatorsFor, actionPhrase, cell, trunc, code, codeCell, quoted, stateName, isLengthOnly } from './narrative.js';
import { arr, pageLabels, pagesInMenuOrder } from './sitemap.js';

/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../../shared/schema.js').FlowMap} FlowMap */
/** @typedef {import('../../shared/schema.js').SessionMeta} SessionMeta */
/** @typedef {import('../../shared/schema.js').NetEntry} NetEntry */
/** @typedef {import('../../shared/schema.js').RepeatPattern} RepeatPattern */
/** @typedef {import('../../shared/schema.js').TablePattern} TablePattern */
/** @typedef {import('../../shared/schema.js').PaginationPattern} PaginationPattern */
/** @typedef {import('../../shared/schema.js').DownloadPattern} DownloadPattern */
/** @typedef {import('../../shared/schema.js').ActionEntry} ActionEntry */

/**
 * docs/12 additions; every field optional so a 1.0.0 session still briefs.
 * @typedef {Object} BriefExtras
 * @property {import('../../shared/schema.js').SiteMap} [siteMap]
 * @property {import('../../shared/schema.js').RoutesFile} [routes]
 * @property {import('../../shared/schema.js').ApiCatalog} [catalog]
 * @property {import('../../shared/schema.js').Coverage} [coverage]
 * @property {ActionEntry[]} [actions]
 * @property {import('../../shared/schema.js').DownloadEntry[]} [downloads]
 */

const CONSTRAINTS = [
  '> This capture is a description of a site, not permission to act on it.',
  '> Automation written from it must: use the user\'s own authenticated session',
  '> rather than storing credentials; leave login, OTP, captcha, payment,',
  '> signing and final submission to the human; never bypass a security control;',
  '> verify each selector at runtime and fail loudly rather than silently filling',
  '> the wrong field; and respect the site\'s terms of use. Controls marked',
  '> `redactedEntirely` in flow-map.json are for the human to fill and must never',
  '> be automated.',
];

/**
 * docs/12 additions to the constraints. Kept outside the block above, which
 * docs/08 fixes word for word.
 */
const CONSTRAINTS_ADDED = [
  'Downloads and API reads must run inside the user\'s own logged-in session and must respect the site\'s rate limits. Never replay a click flagged `danger`; routes never contain one.',
];

/**
 * @param {StateRecord[]} states
 * @param {FlowMap} map
 * @param {SessionMeta} meta
 * @param {NetEntry[]} net
 * @param {BriefExtras} [extras]
 * @returns {string}
 */
export function buildBrief(states, map, meta, net, extras = {}) {
  /** @type {string[]} */
  const out = [];
  const fw = states.find((s) => s.framework && s.framework.framework !== 'plain') || states[0];
  const loggedIn = states.filter((s) => s.authHints && s.authHints.loggedIn === true).length;
  const loggedOut = states.filter((s) => s.authHints && s.authHints.loggedIn === false).length;
  const usesShadow = states.some((s) => s.usesShadowDom);
  const siteMap = extras.siteMap;
  const routes = extras.routes;
  const catalog = extras.catalog;
  const coverage = extras.coverage;
  const actions = extras.actions || [];
  const downloads = extras.downloads || [];
  const labels = siteMap ? pageLabels(siteMap) : new Map();
  /** @type {Map<string, ActionEntry>} */
  const actionById = new Map();
  for (const a of actions) if (a && a.id) actionById.set(a.id, a);
  const pageName = (/** @type {string} */ id, /** @type {string} */ route) => labels.get(id) || route;

  // 1. Header
  out.push(`# Automation brief — ${map.origin}`);
  out.push('');
  out.push(`Captured with ${TOOL_NAME} ${TOOL_VERSION}; session ${meta.sessionStartedAt}, exported ${new Date().toISOString()}.`);
  out.push('');
  out.push(`- **Origin:** \`${map.origin}\``);
  out.push(`- **Framework:** ${map.framework}${fw && fw.framework.version ? ` ${fw.framework.version}` : ''} (${fw ? fw.framework.confidence : 'unknown'} confidence)${usesShadow ? ' — uses shadow DOM, see §2' : ''}`);
  const humanOnly = map.controls.filter((c) => c.redactedEntirely).length;
  out.push(`- **States:** ${states.length} across ${new Set(states.map(routeOf)).size} pages (distinct routes); **controls:** ${map.controls.length}${humanOnly ? ` (${humanOnly} human-only, \`redactedEntirely\`)` : ''}; **list patterns:** ${map.lists.length}`);
  out.push(`- **Recorded actions:** ${actions.length}; **endpoints:** ${catalog ? catalog.endpoints.length : 0}; **downloads:** ${downloads.length}${meta.keepBodies === 'full' ? '; full API bodies kept in `api/bodies/`' : ''}`);
  const authConf = states.map((s) => (s.authHints ? s.authHints.confidence : 'low'));
  const bestConf = authConf.includes('high') ? 'high' : authConf.includes('medium') ? 'medium' : 'low';
  out.push(`- **Session auth:** ${loggedIn && !loggedOut ? 'looked logged in throughout' : loggedIn ? `logged in on ${loggedIn} states, logged out on ${loggedOut}` : loggedOut ? 'looked logged out' : 'unknown (no auth signal seen)'} — ${bestConf} confidence, from password fields / autocomplete tokens / login-logout paths${bestConf === 'low' ? ' / English button text' : ''}`);
  out.push(`- **Language hint:** ${states[0] && states[0].lang ? `\`<html lang="${cell(states[0].lang)}">\`` : 'none declared'}`);
  if (coverage) out.push(`- **Coverage:** ${coverage.totals.menuVisited} of ${coverage.totals.menuItems} menu items opened, ${coverage.totals.viewOptionsVisited} of ${coverage.totals.viewOptions} view options tried, ${coverage.totals.listsPaged} of ${coverage.totals.lists} lists paged — see §12`);
  out.push('');

  // 2. How to read
  out.push('## 2. How to read this package');
  out.push('');
  out.push('**For a scraping or navigation task, read `RECIPES.md` first, then `routes.json` and `api-catalog.json`.** For a form-filling task, start with `flow-map.json`. `states/` and `flow-map.json` are ground truth; `screens/` is orientation only.');
  out.push('');
  out.push('- **`RECIPES.md`** — the site page by page, for a reader who has never seen it: how to reach each page step by step with the locator to use, what to verify on arrival, the views to iterate, the lists and their selectors, the endpoints that feed them, the downloads seen, and what the recording never touched.');
  out.push('- **`site-map.json`** — the merged menu tree (every item seen, `visited` or not, and which page it leads to) and one entry per page: its views, view groups, lists and endpoints. Page ids (`pg_001`) are shared by every file.');
  out.push('- **`routes.json`** — for every page and view, the recorded clicks that reach it from the entry state, each step with selectors, role and accessible name, menu path, and the route, view key and heading to expect afterwards. `reachable: false` means no recorded click path; `directUrl` is set only when the route was itself loaded as a page.');
  out.push('- **`api-catalog.json`** — one entry per endpoint (`api_001`): method, URL template with `{id}` where segments vary, merged request and response shapes (keys, types, optional keys, enum-like values — never data), `listPaths` naming the arrays that look like rows, `pagingParams`, and the pages, states and actions behind each call.');
  out.push('- **`actions.json`** — every recorded click and change with its selectors, label, menu path, view group, pagination role, list container, and the state it was made on and led to. Values are never part of an action.');
  out.push('- **`downloads.json`** — every download seen: kind (http, blob, data), scrubbed URL without query values, MIME type, extension, size, the file name\'s *shape* (never the name), and the action and state behind it.');
  out.push('- **`coverage.json`** — what was visited, what was seen and never opened, which lists were never paged or had no item opened, as counts, per page, and as plain-sentence `hints`.');
  out.push('- **`flow-map.json`** — every unique control with its selector, fallbacks, stability, validation hints, options, entry mode, the list patterns with row and cell selectors, and the state graph. Pages carry `route`, `viewKey` and `pageId`.');
  out.push('- **`selectors.json`** — the same control selectors as a flat `{ key: selector }` map, plus `fallbacks` and `shadowPaths`, for importing into code.');
  out.push('- **`states/`** — one JSON per captured page state: the full control inventory, buttons, errors, list patterns, navigation inventory, view state, viewport and scroll at that moment. Ground truth for a single page.');
  out.push('- **`dom/`** — sanitised HTML per state, values stripped, open shadow roots inlined as `<template shadowrootmode="open">`. Open in a browser to see structure.');
  out.push('- **`screens/`** — PNG per state (top-frame only). **Orientation only** — never derive selectors from a picture.');
  out.push('- **`network.har`** — every fetch/XHR the page made, with scrubbed bodies capped at 4000 characters. Timings are approximate.');
  out.push(`- **\`api/bodies/\`** — ${meta.keepBodies === 'full' ? 'full scrubbed response bodies, one file per call that kept one (`<netId>.json`). Names, addresses and free text in them cannot be scrubbed automatically.' : 'absent: "Keep full API responses" was off, so only shapes were kept.'}`);
  out.push('- **`playwright-skeleton.ts`** — live `goTo_<page>()` functions built from `routes.json`, live `readTable`, `readRepeat`, `paginate`, `forEachView` and `captureDownload` helpers, and one commented-out stub per state. Nothing in it has been executed.');
  out.push('- **`SUMMARY.md`** — the human-readable overview with the attention list.');
  out.push('');
  out.push('`<UPPERCASE>` placeholders such as `<PHONE>` or `<PAN>` anywhere in the package are values a redaction pack removed at capture; match them as wildcards, never as literal text.');
  out.push('');
  if (usesShadow) {
    out.push('**Shadow DOM.** Some controls live inside open shadow roots. Their `selectors.shadowPath` lists the host elements to traverse, in order, before the `primary` selector applies inside the last root. Playwright\'s CSS engine pierces open shadow roots automatically; Selenium, Puppeteer `$` and plain `querySelector` do not — query each host, then its `shadowRoot`. Ignoring `shadowPath` produces code that silently matches nothing.');
    out.push('');
    out.push('**Control order is approximate on these states** (`orderApproximate: true`). Controls inside shadow roots are listed after the light-DOM controls of their document, not at the host\'s position, so `index` does not reflect visual or tab order. Use `boundingBox` (with `scroll`) when order matters.');
    out.push('');
  }
  const opaqueCount = states.reduce((n, s) => n + ((s.opaqueRegions && s.opaqueRegions.length) || 0), 0);
  if (opaqueCount) {
    out.push(`**Blind spots.** ${opaqueCount} region(s) were closed shadow roots the capture could not see into; they are listed in §13. Treat anything inside them as unknown.`);
    out.push('');
  }

  // 3. Flow
  out.push('## 3. The flow');
  out.push('');
  out.push(...flowNarrative(states, map.transitions, map.timeline, actions));
  out.push('');

  // 4. Site map
  out.push('## 4. Site map');
  out.push('');
  if (!siteMap) out.push('_Not available for this export._');
  else {
    const pages = pagesInMenuOrder(siteMap);
    out.push(`${pages.length} page${pages.length === 1 ? '' : 's'} (distinct routes) and ${siteMap.menu.length} menu item${siteMap.menu.length === 1 ? '' : 's'}. Entry state: ${siteMap.entryStateId || 'none'}.`);
    out.push('');
    if (siteMap.menu.length) {
      out.push('Menu, as the site presents it (▸ has children; items never opened are marked):');
      out.push('');
      for (const node of siteMap.menu) {
        const indent = '  '.repeat(Math.min(node.depth || 0, 8));
        const leads = arr(node.leadsTo).map((id) => `→ ${quoted(pageName(id, id), 40)}`).join(' ');
        out.push(`${indent}- ${cell(trunc(node.text, 60))}${node.hasChildren ? ' ▸' : ''}${node.visited ? '' : ' — **never opened**'}${leads ? ` ${leads}` : ''}${node.href ? ` ${code(node.href)}` : ''}`);
      }
      out.push('');
    }
    out.push('| page | route | states | views | view groups | lists | endpoints | downloads | logged in |');
    out.push('|---|---|---|---|---|---|---|---|---|');
    for (const p of pages) {
      out.push(`| ${codeCell(p.id)} ${cell(trunc(pageName(p.id, p.route), 40))} | ${codeCell(p.route)} | ${p.stateIds.length} | ${p.views.length} | ${p.viewGroups.map((g) => `${cell(trunc(g.label || g.name, 20))} (${g.options.filter((o) => o.visited).length}/${g.options.length})`).join(', ')} | ${p.lists.length} | ${p.apiEndpoints.length} | ${p.downloadIds.length} | ${p.loggedIn ? 'yes' : ''} |`);
    }
    out.push('');
    out.push('View groups read "tried/total": a tab strip with 1/3 means two tabs were never opened and their content is unknown.');
  }
  out.push('');

  // 5. How to reach each page
  out.push('## 5. How to reach each page');
  out.push('');
  if (!routes) out.push('_Not available for this export._');
  else {
    out.push(`Every path starts from the entry state ${routes.entryStateId ? `${routes.entryStateId} (${code(routes.entryRoute || '')})` : '(none)'}, after the human has logged in. Steps are recorded clicks; none is flagged \`danger\`. A step whose \`toStateId\` equals its \`fromStateId\` opens a collapsed menu branch for the step after it. Full detail, including fallbacks and what to verify after each step, is in \`RECIPES.md\` and \`routes.json\`.`);
    out.push('');
    for (const r of routes.recipes) {
      const title = `${cell(trunc(pageName(r.pageId, r.route), 50))} — ${code(r.route)}${r.viewKey ? ` view ${code(r.viewKey)}` : ''}`;
      if (!r.reachable) {
        out.push(`- **${title}**: not reachable by recorded clicks${r.directUrl ? `; direct URL ${code(r.directUrl)}` : ''}. ${cell(r.note)}`);
        continue;
      }
      if (!r.steps.length) {
        out.push(`- **${title}**: the entry state${r.directUrl ? `; direct URL ${code(r.directUrl)}` : ''}.`);
        continue;
      }
      const steps = r.steps.map((s) => {
        const loc = locatorsFor(s.selectors);
        const a = actionById.get(s.actionId);
        const what =
          s.kind === 'change'
            ? `choose ${quoted(s.chosen || '?', 30)}`
            : a && a.listSelector && isLengthOnly(s.label)
              ? `open an item of ${code(a.listSelector)} (any item; the recorded one's text was withheld)`
              : `click ${quoted(isLengthOnly(s.label) ? s.actionId : s.label || s.actionId, 40)}`;
        return `${s.n}. ${what}${s.menuPath.length ? ` (menu ${s.menuPath.map((m) => cell(m)).join(' > ')})` : ''}${s.fromStateId === s.toStateId ? ' [opens branch]' : ''}${s.opensNewTab ? ' [new tab]' : ''} ${loc.best ? code(loc.best) : '_no selector_'}`;
      });
      out.push(`- **${title}** (${r.steps.length} step${r.steps.length === 1 ? '' : 's'}${r.directUrl ? `; direct URL ${code(r.directUrl)}` : ''}): ${steps.join('; ')}${r.note ? ` _${cell(r.note)}_` : ''}`);
    }
  }
  out.push('');

  // 6. API catalog
  out.push('## 6. API catalog');
  out.push('');
  if (!catalog) out.push('_Not available for this export._');
  else if (!catalog.endpoints.length) out.push('_No fetch/XHR endpoints were recorded (static assets are left out)._');
  else {
    out.push('Reading list data from the API the page itself calls — `page.waitForResponse()` while the page loads, or `page.request` inside the same session — is usually sturdier than parsing the DOM. `{id}` marks a segment that varied between calls or looks like an identifier. Shapes are in `api-catalog.json`; the first 4000 characters of each body are in `network.har`.');
    out.push('');
    out.push('| id | method | template | calls | status | type | rows at | paging | called from |');
    out.push('|---|---|---|---|---|---|---|---|---|');
    for (const e of catalog.endpoints) {
      out.push(`| ${codeCell(e.id)} | ${e.method} | ${codeCell(trunc(e.urlTemplate, 90))} | ${e.count} | ${e.statuses.join('/')} | ${cell(e.mimeType)}${e.isDownload ? ' (file)' : ''} | ${e.listPaths.map((l) => `${codeCell(l.path)} ×${l.len}`).join(', ')} | ${e.pagingParams.map(codeCell).join(', ')} | ${e.calledFromRoutes.slice(0, 3).map((r) => codeCell(trunc(r, 40))).join(', ')}${e.calledFromRoutes.length > 3 ? ', …' : ''} |`);
    }
  }
  out.push('');

  // 7. Downloads
  out.push('## 7. Downloads');
  out.push('');
  if (!downloads.length) out.push('_No downloads were recorded._');
  else {
    out.push('File names were never stored; `nameShape` gives their structure (`A{n}` letters, `9{n}` digits). Arm `page.waitForEvent(\'download\')` before the trigger click; blob downloads have no URL to fetch.');
    out.push('');
    out.push('| id | kind | extension | MIME | size | name shape | URL (no query values) | trigger | state |');
    out.push('|---|---|---|---|---|---|---|---|---|');
    for (const d of downloads) {
      const a = d.actionId ? actionById.get(d.actionId) : undefined;
      out.push(`| ${codeCell(d.id)} | ${d.urlKind} | ${d.extension || ''} | ${cell(d.mime)} | ${d.sizeBytes >= 0 ? d.sizeBytes : '?'} | ${codeCell(d.nameShape)} | ${d.url ? codeCell(trunc(d.url, 80)) : 'generated in the page (blob)'} | ${a ? `${actionPhrase(a)} (${a.id})` : d.actionId ? codeCell(d.actionId) : ''} | ${d.stateIdAtTime || ''} |`);
    }
  }
  out.push('');

  // 8. Pages and controls
  out.push('## 8. Pages and their controls');
  out.push('');
  const controlsOn = new Map();
  for (const c of map.controls) for (const sid of c.seenOnStates) {
    const arr2 = controlsOn.get(sid) || [];
    arr2.push(c);
    controlsOn.set(sid, arr2);
  }
  for (const s of states) {
    const controls = controlsOn.get(s.id) || [];
    out.push(`### ${s.seq}. ${cell(trunc(s.title || routeOf(s), 70))} — ${code(routeOf(s))}${viewKeyOf(s) ? ` (view ${code(viewKeyOf(s))})` : ''}${s.inIframe ? ' (iframe)' : ''}`);
    out.push('');
    out.push(`State \`${s.id}\`, files \`${stemFor(s)}.*\`. ${s.headings.length ? `Headings: ${s.headings.slice(0, 5).map((h) => `"${cell(trunc(h, 50))}"`).join(', ')}.` : ''}${s.steps.length ? ` Steps: ${s.steps.map((st) => (st.active ? `**${cell(st.text)}**` : cell(st.text))).join(' › ')}.` : ''}`);
    if (s.errors.length) out.push(`Visible errors at capture: ${s.errors.slice(0, 4).map((e) => `"${cell(trunc(e, 80))}"`).join('; ')}.`);
    const danger = s.buttons.filter((b) => b.danger);
    if (danger.length) out.push(`Buttons not to press: ${danger.map((b) => `"${cell(b.text)}" (\`${cell(b.selector)}\`)`).join(', ')}.`);
    out.push('');
    if (!controls.length) {
      out.push('_No form controls on this state._');
      out.push('');
      continue;
    }
    out.push('| key | label | type | required | entry | primary selector | stability |');
    out.push('|---|---|---|---|---|---|---|');
    for (const c of controls) {
      const entry = c.redactedEntirely ? '**HUMAN** (redacted)' : c.entry ? (c.entry.mode === 'widget' ? `widget: ${c.entry.widgetKind || '?'}` : c.entry.mode) : '';
      out.push(`| \`${cell(c.key)}\` | ${cell(trunc(c.label, 50))} | ${c.type} | ${c.required ? 'yes' : ''} | ${entry} | \`${cell(c.selectors.primary)}\`${c.selectors.shadowPath.length ? ' ⧉' : ''} | ${c.selectors.stability} |`);
    }
    out.push('');
    out.push('⧉ = inside shadow roots; see `shadowPath` in `flow-map.json`. **HUMAN** = `redactedEntirely`: the selector is here so the automation can wait on it, never fill it.');
    out.push('');
  }

  // 9. Reference data
  out.push('## 9. Reference data');
  out.push('');
  const withOptions = map.controls.filter((c) => c.options && c.options.length);
  if (!withOptions.length) out.push('_No option lists were captured._');
  for (const c of withOptions) {
    const opts = c.options || [];
    out.push(`- \`${cell(c.key)}\` (${cell(trunc(c.label, 40))}) — ${opts.length} option${opts.length === 1 ? '' : 's'}${opts.length >= 60 ? ' (capped at 60)' : ''}: ${opts.slice(0, 12).map((o) => `\`${cell(o.v)}\`=${cell(trunc(o.t, 30))}`).join(', ')}${opts.length > 12 ? ', …' : ''}`);
  }
  const endpoints = new Map();
  for (const n of net) {
    if (!n.mimeType || !/json|xml/i.test(n.mimeType) || !n.responseBody) continue;
    let path;
    try {
      path = `${n.method} ${new URL(n.url).pathname}`;
    } catch {
      path = `${n.method} ${n.url}`;
    }
    endpoints.set(path, (endpoints.get(path) || 0) + 1);
  }
  if (endpoints.size) {
    out.push('');
    out.push('Endpoints that returned structured data (see `network.har` for bodies and §6 for templates and shapes):');
    out.push('');
    for (const [p, n] of Array.from(endpoints.entries()).sort((a, b) => b[1] - a[1]).slice(0, 40)) out.push(`- \`${cell(p)}\` × ${n}`);
  }
  out.push('');

  // 10. Dependencies
  out.push('## 10. Dependencies');
  out.push('');
  if (!map.dependencies.length) out.push('_No dependent-control behaviour was observed._');
  for (const d of map.dependencies) {
    out.push(`- Changing \`${cell(d.sourceKey)}\` ${d.targetKeys.length ? `reloads ${d.targetKeys.map((t) => `\`${cell(t)}\``).join(', ')}` : 'triggers a request'}${d.viaNetwork && d.endpoint ? ` via \`${cell(d.endpoint)}\`` : ''} (${d.confidence} confidence, seen on ${d.stateId}). Wait for the ${d.viaNetwork ? 'response' : 'options'} before continuing.`);
  }
  out.push('');

  // 11. List patterns
  out.push('## 11. List patterns');
  out.push('');
  if (!map.lists.length) out.push('_No tables, repeated items, pagination or download links were detected._');
  for (const l of map.lists) {
    if (l.kind === 'table') {
      const t = /** @type {TablePattern} */ (l.pattern);
      out.push(`- **Table** ${code(t.containerSelector)}${t.shadowPath.length ? ` (shadow hosts: ${t.shadowPath.map((h) => code(h)).join(' → ')})` : ''}: columns ${t.headers.map((h) => `"${cell(h)}"`).join(', ') || '(no headers found)'}; ${t.rowCount} rows via ${code(t.rowSelector)}; cells ${t.sampleRow.map((c) => `${code(c.selector)} ${c.sample}`).join(', ')}. Seen on ${l.seenOnStates.join(', ')}.`);
    } else if (l.kind === 'repeat') {
      const r = /** @type {RepeatPattern} */ (l.pattern);
      out.push(`- **Repeated items** ${code(r.itemSelector)} (${r.itemCount} rendered)${r.shadowPath.length ? ` inside shadow hosts ${r.shadowPath.map((h) => code(h)).join(' → ')}` : ''}. Per-item slots: ${r.slots.map((s) => `${s.name} ${s.kind} ${code(s.selector)} ${s.sample}${s.download ? ' **download**' : ''}`).join('; ') || 'none'}. Seen on ${l.seenOnStates.join(', ')}.`);
    } else if (l.kind === 'pagination') {
      const p = /** @type {PaginationPattern} */ (l.pattern);
      out.push(`- **Pagination** (${p.style}) in ${code(p.containerSelector)}: next ${p.next ? code(p.next) : 'not found'}, prev ${p.prev ? code(p.prev) : 'not found'}, page indicator ${p.pageIndicator ? code(p.pageIndicator) : 'not found'}${p.current ? `, read "${cell(p.current)}" when recorded` : ''}. Seen on ${l.seenOnStates.join(', ')}.`);
    } else {
      const d = /** @type {DownloadPattern} */ (l.pattern);
      out.push(`- **Download** ${code(d.selector)} — ${d.extension ? `.${d.extension}` : 'unknown type'}, ${d.href === 'direct' ? 'direct URL' : 'script-driven (expect a download event, not a URL)'}${d.downloadAttr ? ', has download attribute' : ''}. Seen on ${l.seenOnStates.join(', ')}.`);
    }
  }
  out.push('');

  // 12. Coverage
  out.push('## 12. Coverage');
  out.push('');
  out.push('What the recording saw and never exercised. Anything listed here is unknown territory: a page behind an unopened menu item has no states, no selectors and no endpoints in this package. Ask for another recording rather than guessing.');
  out.push('');
  out.push(...coverageLines(coverage, 30));
  if (coverage && coverage.unvisitedMenu.length) {
    out.push('');
    out.push(`Menu items never opened (${coverage.unvisitedMenu.length}): ${coverage.unvisitedMenu.slice(0, 20).map((u) => quoted(u.path.join(' > '), 50)).join(', ')}${coverage.unvisitedMenu.length > 20 ? ', …' : ''}.`);
  }
  out.push('');

  // 13. Weak points
  out.push('## 13. Known weak points');
  out.push('');
  const weak = attentionList(states, map);
  const redactedRoutes = states.map(routeOf).filter((r) => PLACEHOLDER_RE.test(r));
  if (redactedRoutes.length) weak.unshift({ title: 'Routes with redacted segments (compare as wildcards; no direct URL)', items: Array.from(new Set(redactedRoutes)).map((r) => code(r)) });
  for (const section of weak) renderSection(out, section, 60);

  // 14. Constraints
  out.push('## 14. Constraints for whoever writes the automation');
  out.push('');
  out.push(...CONSTRAINTS);
  out.push('');
  out.push(...CONSTRAINTS_ADDED);
  out.push('');

  // 15. What I want automated
  out.push('## 15. What I want automated');
  out.push('');
  out.push('_Fill this in before handing the folder over. Say which pages, which lists or controls, where values come from, what "done" looks like, and what must stay manual. Two examples of how to ask for a scrape:_');
  out.push('');
  out.push('> Scrape every row of <list> on <page>, for every option of <view group>, all pages, and download each row\'s file.');
  out.push('>');
  out.push('> Read <endpoint> through the page\'s own session for every <option> of <view group>, walking <paging parameter> until a page comes back short, and save the rows as CSV.');
  out.push('');
  out.push('> ');
  out.push('');
  out.push(`Then tell the agent: "Read AUTOMATION-BRIEF.md, then RECIPES.md, routes.json and api-catalog.json (or flow-map.json for forms). Build <what you wrote>." Starting point: ${states.length ? stateName(states[0]) : 'the first state'}.`);
  out.push('');
  return out.join('\n');
}
