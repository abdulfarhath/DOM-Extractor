/**
 * playwright-skeleton.ts — docs/03, docs/08, docs/12 B8 "The skeleton". A
 * correct shape for a coding agent to start from. Navigation and reading are
 * live code: a `locate()` helper, one `goTo_<page>()` per recorded route,
 * `readTable()`, `readRepeat()`, `paginate()`, `forEachView()` and
 * `captureDownload()`. Every fill, and every click on a control flagged
 * danger, stays commented out. Nothing in the file has been executed.
 *
 * Every string that reaches the generated file goes through JSON.stringify:
 * page text carries quotes, backticks, comment closers and newlines.
 */
import { TOOL_NAME, TOOL_VERSION } from '../../shared/constants.js';
import { stemFor, identifier, routeOf, viewKeyOf, uniqueName, PLACEHOLDER_RE } from './naming.js';
import { arr, pageLabels } from './sitemap.js';
import { looksLikeId } from './apicatalog.js';

/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../../shared/schema.js').FlowMap} FlowMap */
/** @typedef {import('../../shared/schema.js').FlowMapControl} FlowMapControl */
/** @typedef {import('../../shared/schema.js').FlowMapList} FlowMapList */
/** @typedef {import('../../shared/schema.js').SelectorsFile} SelectorsFile */
/** @typedef {import('../../shared/schema.js').Transition} Transition */
/** @typedef {import('../../shared/schema.js').SiteMap} SiteMap */
/** @typedef {import('../../shared/schema.js').RoutesFile} RoutesFile */
/** @typedef {import('../../shared/schema.js').RouteStep} RouteStep */
/** @typedef {import('../../shared/schema.js').ActionEntry} ActionEntry */
/** @typedef {import('../../shared/schema.js').ActionSelectors} ActionSelectors */
/** @typedef {import('../../shared/schema.js').TablePattern} TablePattern */
/** @typedef {import('../../shared/schema.js').RepeatPattern} RepeatPattern */
/** @typedef {import('../../shared/schema.js').PaginationPattern} PaginationPattern */

/**
 * docs/12: what the route and reading helpers are generated from. Every
 * field is optional so the skeleton still builds from a 1.0.0 session.
 * @typedef {Object} SkeletonExtras
 * @property {SiteMap} [siteMap]
 * @property {RoutesFile} [routes]
 * @property {ActionEntry[]} [actions]
 */

/**
 * @param {unknown} s
 * @returns {string}   a TypeScript string literal
 */
const tsString = (s) => JSON.stringify(String(s ?? ''));

/**
 * @param {string} s
 * @returns {string}   safe inside a // comment
 */
const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/\*\//g, '* /');

/**
 * @param {string} s
 * @returns {string}   safe inside a /* block comment
 */
const inBlock = (s) => String(s ?? '').replace(/\*\//g, '* /');

/**
 * @param {ActionSelectors|null|undefined} sel
 * @returns {string}   a `Sel` object literal
 */
function selLiteral(sel) {
  if (!sel) return '{ primary: "" }';
  /** @type {string[]} */
  const parts = [`primary: ${tsString(sel.primary || '')}`];
  const fallbacks = arr(sel.fallbacks).filter(Boolean);
  if (fallbacks.length) parts.push(`fallbacks: ${JSON.stringify(fallbacks)}`);
  const hosts = arr(sel.shadowPath).filter(Boolean);
  if (hosts.length) parts.push(`shadowPath: ${JSON.stringify(hosts)}`);
  // A redacted accessible name is not what the page shows; the role locator would never match.
  if (sel.role && sel.name && !PLACEHOLDER_RE.test(sel.name)) {
    parts.push(`role: ${tsString(sel.role)}`);
    parts.push(`name: ${tsString(sel.name)}`);
  }
  return `{ ${parts.join(', ')} }`;
}

/**
 * The Playwright call that fits a control, as a commented line.
 * @param {FlowMapControl} c
 * @param {string} keyExpr
 * @returns {string}
 */
function callFor(c, keyExpr) {
  const data = `data[${tsString(c.key)}]`;
  const meta = [c.type, c.required ? 'required' : '', c.maxLength != null ? `maxLength ${c.maxLength}` : '', c.options ? `${c.options.length} options` : '', c.entry && c.entry.mode === 'widget' ? `WIDGET: ${c.entry.widgetKind || c.entry.evidence}` : '']
    .filter(Boolean)
    .join(', ');
  if (c.redactedEntirely) {
    return `  // HUMAN: ${keyExpr} is redactedEntirely${c.label ? ` — "${oneLine(c.label)}"` : ''} (${c.type}). Never fill this; wait for the human, then continue.`;
  }
  let call;
  if (c.type === 'select') call = `await page.selectOption(${keyExpr}, ${data});`;
  else if (c.type === 'checkbox' || c.type === 'radio' || c.type === 'switch') call = `await page.check(${keyExpr});`;
  else if (c.type === 'file') call = `await page.setInputFiles(${keyExpr}, ${data});`;
  else if (c.entry && c.entry.mode === 'widget') call = `await page.click(${keyExpr}); // then drive the ${c.entry.widgetKind || 'widget'}`;
  else call = `await page.fill(${keyExpr}, ${data});`;
  return `  // ${call} // ${oneLine(meta)}${c.label ? ` — "${oneLine(c.label)}"` : ''}`;
}

/**
 * The helpers, verbatim TypeScript. Kept as one template so the generated
 * file reads as one piece of code; nothing from the capture is interpolated
 * into it.
 * @param {string} origin
 * @param {string|null} entryRoute
 * @returns {string[]}
 */
function runtime(origin, entryRoute) {
  return [
    `export const ORIGIN = ${tsString(origin)};`,
    `export const ENTRY_ROUTE: string | null = ${entryRoute == null ? 'null' : tsString(entryRoute)};`,
    '',
    '/** How long locate() and arrived() keep trying before they fail loudly. */',
    'export const LOCATE_TIMEOUT_MS = 15000;',
    '/** paginate() never turns more pages than this, whatever the indicator says. */',
    'export const MAX_PAGES = 200;',
    '',
    'export type Data = Record<string, string>;',
    '',
    '/** One recorded target: CSS first, ARIA role and accessible name when both were recorded. */',
    'export type Sel = {',
    '  primary: string;',
    '  fallbacks?: readonly string[];',
    '  /** Shadow hosts to enter, outermost first, before the CSS applies. */',
    '  shadowPath?: readonly string[];',
    '  role?: string | null;',
    '  name?: string;',
    '};',
    '',
    '/**',
    ' * What a step should land on. viewKey is informational: arrived() checks the route and heading.',
    ' * anyId: identifier-like segments of the route (digits, UUIDs, long hex) match any value,',
    ' * because the step opened one particular list item and another run opens another.',
    ' */',
    'export type Expect = { route: string; viewKey?: string; heading?: string | null; anyId?: boolean };',
    '',
    'export type TableList = {',
    '  kind: "table";',
    '  selector: string;',
    '  shadowPath: readonly string[];',
    '  headers: readonly string[];',
    '  /** Relative to the table. */',
    '  rowSelector: string;',
    '  /** Relative to a row, in column order. */',
    '  cells: readonly string[];',
    '};',
    '',
    'export type RepeatList = {',
    '  kind: "repeat";',
    '  selector: string;',
    '  shadowPath: readonly string[];',
    '  /** Absolute: container plus the item segment. */',
    '  itemSelector: string;',
    '  /** Relative to an item; `:scope` is the item itself. */',
    '  slots: readonly { name: string; selector: string; kind: "text" | "link" | "image"; download?: boolean }[];',
    '};',
    '',
    'export type Pagination = {',
    '  container: string;',
    '  next: string | null;',
    '  prev: string | null;',
    '  pageIndicator: string | null;',
    '  style: "numbered" | "next-prev" | "load-more" | "unknown";',
    '};',
    '',
    'export type ViewGroup = {',
    '  name: string;',
    '  kind: "tabs" | "segmented" | "chips" | "radio" | "select";',
    '  container: string;',
    '  shadowPath: readonly string[];',
    '  options: readonly { text: string; selector: string; visited: boolean }[];',
    '};',
    '',
    '/** Redaction placeholders such as `<PHONE>` stand for values that were removed; match them as wildcards. */',
    'const PLACEHOLDER = /<[A-Z][A-Z0-9_]*>/;',
    '',
    'function escapeRegExp(s: string): string {',
    '  return s.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");',
    '}',
    '',
    '/** The route of a URL the way the recording wrote it: pathname plus the fragment path, no query. */',
    'export function routeOfUrl(url: string): string {',
    '  try {',
    '    const u = new URL(url);',
    '    const frag = u.hash.startsWith("#/") || u.hash.startsWith("#!/") ? u.hash.split("?")[0] : "";',
    '    return u.pathname + frag;',
    '  } catch {',
    '    return url;',
    '  }',
    '}',
    '',
    '/** A path segment that names one record rather than a kind of page. */',
    'const ID_SEGMENT = /^(\\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,})$/i;',
    '',
    'export function routeMatches(actualUrl: string, expectedRoute: string, anyId = false): boolean {',
    '  const actual = routeOfUrl(actualUrl).replace(/\\/+$/, "") || "/";',
    '  const expected = expectedRoute.replace(/\\/+$/, "") || "/";',
    '  if (actual === expected) return true;',
    '  const pattern = expected',
    '    .split("/")',
    '    .map((seg) => (anyId && ID_SEGMENT.test(seg) ? "[^/]+" : seg.split(new RegExp(PLACEHOLDER.source, "g")).map(escapeRegExp).join("[^/]+")))',
    '    .join("/");',
    '  return new RegExp("^" + pattern + "$").test(actual);',
    '}',
    '',
    '/** Enter the recorded shadow hosts, outermost first. Playwright pierces open shadow roots, so this is belt and braces. */',
    'function scope(page: Page, shadowPath?: readonly string[]): Page | Locator {',
    '  let s: Page | Locator = page;',
    '  for (const host of shadowPath ?? []) s = s.locator(host);',
    '  return s;',
    '}',
    '',
    '/**',
    ' * The first locator that resolves to exactly one element: role + name when both were',
    ' * recorded, then the primary selector, then each fallback. Throws, naming the step,',
    ' * when none does within LOCATE_TIMEOUT_MS. A selector that matches two elements is a',
    ' * failure, not a first-match guess.',
    ' */',
    'export async function locate(page: Page, sel: Sel, step = "element"): Promise<Locator> {',
    '  const candidates: { how: string; loc: Locator }[] = [];',
    '  if (sel.role && sel.name) {',
    '    candidates.push({',
    '      how: `role=${sel.role} name=${JSON.stringify(sel.name)}`,',
    '      loc: page.getByRole(sel.role as Parameters<Page["getByRole"]>[0], { name: sel.name, exact: true }),',
    '    });',
    '  }',
    '  for (const css of [sel.primary, ...(sel.fallbacks ?? [])]) {',
    '    if (css) candidates.push({ how: css, loc: scope(page, sel.shadowPath).locator(css) });',
    '  }',
    '  if (!candidates.length) throw new Error(`${step}: no selector was recorded for this target`);',
    '  const deadline = Date.now() + LOCATE_TIMEOUT_MS;',
    '  const counts: string[] = [];',
    '  do {',
    '    counts.length = 0;',
    '    for (const c of candidates) {',
    '      // An invalid selector string throws; treat it as matching nothing.',
    '      const n = await c.loc.count().catch(() => -1);',
    '      if (n === 1) return c.loc;',
    '      counts.push(`${c.how} → ${n < 0 ? "invalid" : n}`);',
    '    }',
    '    await page.waitForTimeout(250);',
    '  } while (Date.now() < deadline);',
    '  throw new Error(`${step}: no locator resolved to exactly one element. Tried: ${counts.join("; ")}`);',
    '}',
    '',
    '/** Wait until the page shows the recorded route (and heading, when one was recorded and is not redacted). */',
    'export async function arrived(page: Page, expect: Expect, step = "step"): Promise<void> {',
    '  await page.waitForLoadState("domcontentloaded").catch(() => undefined);',
    '  const heading = expect.heading && !PLACEHOLDER.test(expect.heading) ? expect.heading : null;',
    '  const deadline = Date.now() + LOCATE_TIMEOUT_MS;',
    '  let lastUrl = page.url();',
    '  do {',
    '    lastUrl = page.url();',
    '    const routeOk = routeMatches(lastUrl, expect.route, expect.anyId ?? false);',
    '    const headingOk = heading ? (await page.getByRole("heading", { name: heading }).first().isVisible().catch(() => false)) : true;',
    '    if (routeOk && headingOk) {',
    '      // Give the page its network round-trip; never wait forever on a site that polls.',
    '      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => undefined);',
    '      return;',
    '    }',
    '    await page.waitForTimeout(250);',
    '  } while (Date.now() < deadline);',
    '  throw new Error(`${step}: expected route ${expect.route}${heading ? ` with heading ${JSON.stringify(heading)}` : ""}, but the page is at ${lastUrl}`);',
    '}',
    '',
    '/** Go to the entry state the recording started from, unless the page is already there. */',
    'export async function startAtEntry(page: Page): Promise<void> {',
    '  if (ENTRY_ROUTE === null) return;',
    '  if (routeMatches(page.url(), ENTRY_ROUTE)) return;',
    '  await page.goto(ORIGIN + ENTRY_ROUTE);',
    '  await arrived(page, { route: ENTRY_ROUTE }, "startAtEntry");',
    '}',
    '',
    '/** Click a step target and, when the recording saw a new tab open, return that tab. */',
    'export async function clickStep(page: Page, sel: Sel, step: string, opensNewTab = false): Promise<Page> {',
    '  const target = await locate(page, sel, step);',
    '  if (!opensNewTab) {',
    '    await target.click();',
    '    return page;',
    '  }',
    '  const [popup] = await Promise.all([page.context().waitForEvent("page"), target.click()]);',
    '  await popup.waitForLoadState("domcontentloaded").catch(() => undefined);',
    '  return popup;',
    '}',
    '',
    '/** Every row of a table as header → cell text. Rows without the recorded cells are kept as positional columns. */',
    'export async function readTable(page: Page, list: TableList): Promise<Record<string, string>[]> {',
    '  const table = await locate(page, { primary: list.selector, shadowPath: list.shadowPath }, `readTable ${list.selector}`);',
    '  const rows = table.locator(list.rowSelector);',
    '  const out: Record<string, string>[] = [];',
    '  const n = await rows.count();',
    '  for (let i = 0; i < n; i++) {',
    '    const row = rows.nth(i);',
    '    const cells = list.cells;',
    '    const texts = cells.length',
    '      ? await Promise.all(cells.map((c) => row.locator(c).first().innerText().catch(() => "")))',
    '      : await row.locator("td, th, [role=cell], [role=gridcell], [role=rowheader]").allInnerTexts();',
    '    const record: Record<string, string> = {};',
    '    texts.forEach((t, k) => {',
    '      record[list.headers[k] ?? `col${k + 1}`] = t.trim();',
    '    });',
    '    out.push(record);',
    '  }',
    '  return out;',
    '}',
    '',
    '/** Every item of a repeated block as slot name → text (links: href, images: src). */',
    'export async function readRepeat(page: Page, list: RepeatList): Promise<Record<string, string>[]> {',
    '  const items = scope(page, list.shadowPath).locator(list.itemSelector);',
    '  const out: Record<string, string>[] = [];',
    '  const n = await items.count();',
    '  for (let i = 0; i < n; i++) {',
    '    const item = items.nth(i);',
    '    const record: Record<string, string> = {};',
    '    for (const slot of list.slots) {',
    '      const el = item.locator(slot.selector).first();',
    '      if (slot.kind === "link") record[slot.name] = (await el.getAttribute("href").catch(() => null)) ?? "";',
    '      else if (slot.kind === "image") record[slot.name] = (await el.getAttribute("src").catch(() => null)) ?? "";',
    '      else record[slot.name] = (await el.innerText().catch(() => "")).trim();',
    '    }',
    '    if (!list.slots.length) record.text = (await item.innerText().catch(() => "")).trim();',
    '    out.push(record);',
    '  }',
    '  return out;',
    '}',
    '',
    '/**',
    ' * Call onPage for the current page, then press "next" and repeat. Stops when "next" is',
    ' * missing or disabled, when the page indicator (or, failing that, the page text) does not',
    ' * change after a click, or at MAX_PAGES. Returns the number of pages read.',
    ' */',
    'export async function paginate(page: Page, pagination: Pagination, onPage: (pageNo: number) => Promise<void>, maxPages = MAX_PAGES): Promise<number> {',
    '  const marker = async (): Promise<string> => {',
    '    if (pagination.pageIndicator) {',
    '      const t = await page.locator(pagination.pageIndicator).first().innerText().catch(() => "");',
    '      if (t.trim()) return t.trim();',
    '    }',
    '    return page.locator("body").innerText().catch(() => String(Date.now()));',
    '  };',
    '  let pageNo = 1;',
    '  for (;;) {',
    '    await onPage(pageNo);',
    '    if (pageNo >= maxPages || !pagination.next) return pageNo;',
    '    const next = page.locator(pagination.next).first();',
    '    if (!(await next.count()) || !(await next.isVisible().catch(() => false)) || !(await next.isEnabled().catch(() => false))) return pageNo;',
    '    const aria = await next.getAttribute("aria-disabled").catch(() => null);',
    '    if (aria === "true") return pageNo;',
    '    const before = await marker();',
    '    await next.click();',
    '    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);',
    '    let changed = false;',
    '    for (let waited = 0; waited < LOCATE_TIMEOUT_MS && !changed; waited += 250) {',
    '      if ((await marker()) !== before) changed = true;',
    '      else await page.waitForTimeout(250);',
    '    }',
    '    if (!changed) return pageNo;',
    '    pageNo++;',
    '  }',
    '}',
    '',
    '/** Select each option of a view group in turn and run fn on it. Options that cannot be located are reported, not skipped silently. */',
    'export async function forEachView(page: Page, group: ViewGroup, fn: (option: { text: string; selector: string }) => Promise<void>): Promise<void> {',
    '  for (const option of group.options) {',
    '    const target = await locate(page, { primary: option.selector, shadowPath: group.shadowPath }, `forEachView ${group.name} ${JSON.stringify(option.text)}`);',
    '    if (group.kind === "select") await page.locator(group.container).first().selectOption({ label: option.text });',
    '    else await target.click();',
    '    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);',
    '    await fn(option);',
    '  }',
    '}',
    '',
    '/** Arm the download event, run the click, hand back the Download. Save it with download.saveAs(path). */',
    'export async function captureDownload(page: Page, clickFn: () => Promise<void>): Promise<Download> {',
    '  const [download] = await Promise.all([page.waitForEvent("download"), clickFn()]);',
    '  return download;',
    '}',
    '',
  ];
}

/**
 * @param {StateRecord[]} states
 * @param {FlowMap} map
 * @param {SelectorsFile} selectors
 * @param {SkeletonExtras} [extras]
 * @returns {string}
 */
export function buildSkeleton(states, map, selectors, extras = {}) {
  const siteMap = extras.siteMap;
  const routes = extras.routes;
  /** @type {Map<string, ActionEntry>} */
  const actionById = new Map();
  for (const a of arr(extras.actions)) if (a && a.id) actionById.set(a.id, a);
  const labels = siteMap ? pageLabels(siteMap) : new Map();
  /** @type {Set<string>} */
  const names = new Set();

  /** @type {string[]} */
  const out = [];
  out.push('/**');
  out.push(` * playwright-skeleton.ts — generated by ${TOOL_NAME} ${TOOL_VERSION} on ${new Date().toISOString()}`);
  out.push(` * for ${inBlock(map.origin)} (${map.framework}).`);
  out.push(' *');
  out.push(' * NOTHING HERE HAS BEEN EXECUTED. A capture describes what a site looked like once; it');
  out.push(' * is not validated automation. Navigation (goTo_*) and reading (readTable, readRepeat,');
  out.push(' * paginate, forEachView, captureDownload) are live code built from recorded clicks, and');
  out.push(' * every selector in them must be verified at run time: locate() fails loudly when a');
  out.push(' * selector does not resolve to exactly one element. Fills, and every click on a control');
  out.push(' * flagged danger, are commented out and stay so until a human decides otherwise.');
  out.push(' *');
  out.push(' * Login, OTP, captcha, payment, signing and final submission are the human\'s job: start');
  out.push(' * these functions on a page that is already logged in, inside the user\'s own session.');
  out.push(' * Downloads and API reads must run inside that session and respect the site\'s rate');
  out.push(' * limits. Controls marked HUMAN are redactedEntirely and must never be automated.');
  out.push(' *');
  out.push(' * Controls inside shadow roots need SHADOW_PATHS: query each host in order, then the');
  out.push(' * selector inside the last root. Playwright pierces open shadow roots for CSS selectors');
  out.push(' * automatically; other tools may not.');
  out.push(' */');
  out.push('');
  out.push("import type { Page, Locator, Download } from '@playwright/test';");
  out.push('');
  out.push(...runtime(map.origin, routes ? routes.entryRoute : null));

  // ---- selectors of form controls (docs/03), unchanged
  out.push('export const SELECTORS = {');
  for (const [k, v] of Object.entries(selectors.selectors)) out.push(`  ${tsString(k)}: ${tsString(v)},`);
  out.push('} as const;');
  out.push('');
  out.push('export const FALLBACKS: Record<string, readonly string[]> = {');
  for (const [k, v] of Object.entries(selectors.fallbacks)) out.push(`  ${tsString(k)}: ${JSON.stringify(v)},`);
  out.push('};');
  out.push('');
  out.push('export const SHADOW_PATHS: Record<string, readonly string[]> = {');
  for (const [k, v] of Object.entries(selectors.shadowPaths)) out.push(`  ${tsString(k)}: ${JSON.stringify(v)},`);
  out.push('};');
  out.push('');

  // ---- lists, view groups, pagination: data for the reading helpers
  const pageOf = (/** @type {string} */ sid) => {
    const p = siteMap ? siteMap.pages.find((x) => x.stateIds.includes(sid)) : undefined;
    return p ? `${labels.get(p.id) || p.route} (${p.id})` : sid;
  };
  out.push('/** Tables and repeated items seen in the recording, keyed by a name derived from the page and selector. */');
  out.push('export const LISTS: Record<string, TableList | RepeatList> = {');
  /** @type {Set<string>} */
  const listNames = new Set();
  for (const l of map.lists) {
    if (l.kind !== 'table' && l.kind !== 'repeat') continue;
    const where = l.seenOnStates[0] ? pageOf(l.seenOnStates[0]) : '';
    const base = identifier(`${where.replace(/\(pg_\d+\)/, '')} ${l.kind} ${l.selector.split(/\s*>\s*/).pop() || ''}`);
    const name = uniqueName(base, listNames);
    if (l.kind === 'table') {
      const t = /** @type {TablePattern} */ (l.pattern);
      out.push(`  // ${oneLine(where)} — seen on ${l.seenOnStates.join(', ')}`);
      out.push(`  ${tsString(name)}: { kind: "table", selector: ${tsString(t.containerSelector)}, shadowPath: ${JSON.stringify(arr(t.shadowPath))}, headers: ${JSON.stringify(arr(t.headers))}, rowSelector: ${tsString(t.rowSelector || 'tbody tr')}, cells: ${JSON.stringify(arr(t.sampleRow).map((c) => c.selector))} },`);
    } else {
      const r = /** @type {RepeatPattern} */ (l.pattern);
      out.push(`  // ${oneLine(where)} — seen on ${l.seenOnStates.join(', ')}`);
      out.push(`  ${tsString(name)}: { kind: "repeat", selector: ${tsString(r.containerSelector)}, shadowPath: ${JSON.stringify(arr(r.shadowPath))}, itemSelector: ${tsString(r.itemSelector)}, slots: ${JSON.stringify(arr(r.slots).map((s) => ({ name: s.name, selector: s.selector, kind: s.kind, ...(s.download ? { download: true } : {}) })))} },`);
    }
  }
  out.push('};');
  out.push('');
  out.push('/** Pagination blocks seen in the recording. Pair each with the list it sits next to. */');
  out.push('export const PAGINATION: Record<string, Pagination> = {');
  /** @type {Set<string>} */
  const pagerNames = new Set();
  for (const l of map.lists) {
    if (l.kind !== 'pagination') continue;
    const p = /** @type {PaginationPattern} */ (l.pattern);
    if (!p.next && !p.prev && !p.pageIndicator) continue;
    const where = l.seenOnStates[0] ? pageOf(l.seenOnStates[0]) : '';
    const name = uniqueName(identifier(`${where.replace(/\(pg_\d+\)/, '')} pager ${p.style}`), pagerNames);
    out.push(`  // ${oneLine(where)} — seen on ${l.seenOnStates.join(', ')}`);
    out.push(`  ${tsString(name)}: { container: ${tsString(p.containerSelector)}, next: ${p.next ? tsString(p.next) : 'null'}, prev: ${p.prev ? tsString(p.prev) : 'null'}, pageIndicator: ${p.pageIndicator ? tsString(p.pageIndicator) : 'null'}, style: ${tsString(p.style || 'unknown')} },`);
  }
  out.push('};');
  out.push('');
  out.push('/** Tabs, chips, radios and selects that change what a page shows, per page. */');
  out.push('export const VIEW_GROUPS: Record<string, ViewGroup> = {');
  /** @type {Set<string>} */
  const groupNames = new Set();
  for (const p of siteMap ? siteMap.pages : []) {
    for (const g of p.viewGroups) {
      const name = uniqueName(identifier(`${labels.get(p.id) || p.route} ${g.label || g.name}`), groupNames);
      out.push(`  // ${oneLine(labels.get(p.id) || p.route)} (${p.id}) — ${g.options.filter((o) => o.visited).length} of ${g.options.length} options tried in the recording`);
      out.push(`  ${tsString(name)}: { name: ${tsString(g.name)}, kind: ${tsString(g.kind)}, container: ${tsString(g.containerSelector)}, shadowPath: ${JSON.stringify(arr(g.shadowPath))}, options: ${JSON.stringify(g.options.map((o) => ({ text: o.text, selector: o.selector, visited: !!o.visited })))} },`);
    }
  }
  out.push('};');
  out.push('');

  // ---- goTo_<page>() per recipe: live navigation
  /** @type {string[]} */
  const goToNames = [];
  if (routes && routes.recipes.length) {
    out.push('// ---------------------------------------------------------------- routes');
    out.push('// One function per recorded page and view. Each starts from the entry state, replays the');
    out.push('// recorded clicks, and checks the route (and heading) after every step. A function returns');
    out.push('// the Page the destination lives on: the same page, or the tab a step opened.');
    out.push('');
  }
  for (const r of routes ? routes.recipes : []) {
    const label = labels.get(r.pageId) || r.route;
    const fn = uniqueName(`goTo_${identifier(`${label}${r.viewKey ? ` ${r.viewKey}` : ''}`)}`, names);
    goToNames.push(fn);
    out.push(`/** ${inBlock(label)} — ${inBlock(r.route)}${r.viewKey ? ` view ${inBlock(r.viewKey)}` : ''} (${r.pageId || 'no page id'}, target state ${r.targetStateId}). */`);
    if (r.directUrl) out.push(`// Observed as a page load; page.goto(${tsString(r.directUrl)}) inside the logged-in session is the alternative.`);
    if (r.note) out.push(`// ${oneLine(r.note)}`);
    if (!r.reachable) {
      out.push(`export async function ${fn}(page: Page): Promise<Page> {`);
      if (r.directUrl) {
        out.push(`  await page.goto(${tsString(r.directUrl)});`);
        out.push(`  await arrived(page, { route: ${tsString(r.route)} }, ${tsString(fn)});`);
        out.push('  return page;');
      } else {
        out.push(`  throw new Error(${tsString(`${fn}: no recorded click path leads to ${r.route}; see routes.json`)});`);
      }
      out.push('}');
      out.push('');
      continue;
    }
    out.push(`export async function ${fn}(page: Page): Promise<Page> {`);
    out.push('  let p = page;');
    out.push('  await startAtEntry(p);');
    const steps = r.steps;
    let afterItem = false;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepName = `${fn} step ${step.n}${step.label && !/^<\d+ chars>$/.test(step.label) ? ` ${JSON.stringify(step.label)}` : ''}`;
      const prep = step.toStateId === step.fromStateId;
      const action = actionById.get(step.actionId);
      const next = steps[i + 1];
      // Opening a list item lands on that item's page: its id is in the route and its name in the heading.
      const itemOpen = !!action && !!action.listSelector && !action.pagination && !action.viewGroup && step.kind === 'click';
      if (itemOpen) out.push('  // Opens one particular list item (the row the person clicked). Any row gives the same kind of page, so the route is matched with its ids as wildcards and the heading is not checked.');
      if (itemOpen) afterItem = true;
      const loose = afterItem && step.expectRoute.split('/').some(looksLikeId);
      out.push(`  // ${step.n}. ${itemOpen ? `open an item of ${oneLine(JSON.stringify((action && action.listSelector) || ''))}` : `${oneLine(step.kind === 'change' ? `choose ${JSON.stringify(step.chosen || '?')} in` : 'click')} ${oneLine(JSON.stringify(step.label || step.actionId))}`}${step.menuPath.length ? ` (menu: ${oneLine(step.menuPath.join(' > '))})` : ''} — ${step.actionId}, ${step.fromStateId} → ${step.toStateId}${step.opensNewTab ? ', opens a new tab' : ''}`);
      if (action && action.danger) {
        // Never generated by routes.js; kept as a guard so a hand edit cannot turn it live by accident.
        out.push(`  // DANGER: ${oneLine(JSON.stringify(step.label))} is flagged danger and is never replayed. A human takes this step.`);
        out.push(`  throw new Error(${tsString(`${stepName}: flagged danger; a human must do this`)});`);
        continue;
      }
      if (prep && next) {
        out.push('  // Opens a collapsed menu branch; pressed only when the next step\'s target is not visible yet.');
        out.push(`  if (!(await scope(p, ${JSON.stringify(arr(next.selectors && next.selectors.shadowPath))}).locator(${tsString((next.selectors && next.selectors.primary) || '__none__')}).first().isVisible().catch(() => false))) {`);
        out.push(`    await (await locate(p, ${selLiteral(step.selectors)}, ${tsString(stepName)})).click();`);
        out.push('  }');
        continue;
      }
      if (step.kind === 'change') {
        const tag = action ? action.targetType : 'other';
        if (!step.chosen) {
          out.push(`  // HUMAN: the value chosen here was not recorded (credential-shaped or free text). Make the choice in ${oneLine(JSON.stringify((step.selectors && step.selectors.primary) || ''))}, then continue.`);
        } else if (tag === 'select' || tag === 'option') {
          out.push(`  await (await locate(p, ${selLiteral(step.selectors)}, ${tsString(stepName)})).selectOption({ label: ${tsString(step.chosen)} });`);
        } else if (tag === 'checkbox' || tag === 'radio') {
          out.push(`  await (await locate(p, ${selLiteral(step.selectors)}, ${tsString(stepName)})).check();`);
        } else {
          out.push(`  await (await locate(p, ${selLiteral(step.selectors)}, ${tsString(stepName)})).click(); // recorded as a change to ${oneLine(JSON.stringify(step.chosen))}`);
        }
      } else {
        out.push(`  p = await clickStep(p, ${selLiteral(step.selectors)}, ${tsString(stepName)}, ${step.opensNewTab ? 'true' : 'false'});`);
      }
      out.push(`  await arrived(p, { route: ${tsString(step.expectRoute)}, viewKey: ${tsString(step.expectViewKey)}, heading: ${step.expectHeading && !loose && !itemOpen ? tsString(step.expectHeading) : 'null'}${loose ? ', anyId: true' : ''} }, ${tsString(stepName)});`);
    }
    out.push('  return p;');
    out.push('}');
    out.push('');
  }

  // ---- one commented stub per state (docs/03), unchanged in spirit
  const edgesFrom = new Map();
  for (const t of map.transitions) {
    const arr2 = edgesFrom.get(t.from) || [];
    arr2.push(t);
    edgesFrom.set(t.from, arr2);
  }
  const byId = new Map(states.map((s) => [s.id, s]));
  const controlsOnState = new Map();
  for (const c of map.controls) for (const sid of c.seenOnStates) {
    const arr2 = controlsOnState.get(sid) || [];
    arr2.push(c);
    controlsOnState.set(sid, arr2);
  }

  out.push('// ---------------------------------------------------------------- states');
  out.push('// One stub per captured state with its controls as commented fill lines. Fills stay');
  out.push('// commented until a human has bound data[] to the site and verified each selector.');
  out.push('');
  /** @type {string[]} */
  const fnNames = [];
  for (const s of states) {
    const fn = uniqueName(`${identifier(stemFor(s).replace(/^\d+-/, ''))}_${s.seq}`, names);
    fnNames.push(fn);
    const page = map.pages.find((p) => p.stateId === s.id);
    out.push(`// ${s.id} — ${tsString(s.title || routeOf(s))} (${oneLine(routeOf(s))}${viewKeyOf(s) ? `, view ${oneLine(viewKeyOf(s))}` : ''})${page ? `, reached by ${oneLine(page.reachedBy)}` : ''}`);
    if (s.errors.length) out.push(`// errors visible at capture: ${oneLine(s.errors.slice(0, 3).join(' | '))}`);
    out.push(`export async function ${fn}(page: Page, data: Data): Promise<void> {`);
    const controls = /** @type {FlowMapControl[]} */ (controlsOnState.get(s.id) || []);
    if (!controls.length) out.push('  // no controls on this state');
    for (const c of controls) out.push(callFor(c, `SELECTORS[${tsString(c.key)}]`));
    const dangerous = s.buttons.filter((b) => b.danger && b.visible);
    for (const b of dangerous) out.push(`  // DANGER: "${oneLine(b.text)}" (${oneLine(b.selector)}) — leave to the human`);
    for (const t of /** @type {Transition[]} */ (edgesFrom.get(s.id) || [])) {
      const to = byId.get(t.to);
      const action = t.actionId ? actionById.get(t.actionId) : undefined;
      const what = [
        to && routeOf(to) !== routeOf(s) ? `navigated to ${routeOf(to)}` : '',
        to && viewKeyOf(to) !== viewKeyOf(s) ? `view became ${viewKeyOf(to) || '(default)'}` : '',
        t.fieldsAdded.length ? `added ${t.fieldsAdded.length} control(s): ${t.fieldsAdded.slice(0, 5).join(', ')}${t.fieldsAdded.length > 5 ? '…' : ''}` : '',
        t.fieldsRemoved.length ? `removed ${t.fieldsRemoved.length}` : '',
        t.optionsChanged.length ? `options changed on ${t.optionsChanged.map((o) => o.key).join(', ')}` : '',
        t.listCountsChanged.length ? `list counts changed` : '',
        t.errorsAppeared.length ? `${t.errorsAppeared.length} error(s) appeared` : '',
        t.netCallsBetween.length ? `${t.netCallsBetween.length} network call(s)` : '',
      ]
        .filter(Boolean)
        .join('; ');
      const did = action ? `${action.kind} ${JSON.stringify(action.label || '')}${action.menuPath && action.menuPath.length ? ` (menu: ${action.menuPath.join(' > ')})` : ''}${action.danger ? ' [DANGER — never replay]' : ''} (${action.id})` : t.trigger;
      out.push(`  // TODO transition: ${oneLine(did)} → ${t.to}${what ? ` — ${oneLine(what)}` : ''}`);
    }
    out.push('  void page;');
    out.push('  void data;');
    out.push('}');
    out.push('');
  }

  out.push('// The captured order. Uncomment and add waits between steps once verified.');
  out.push('export async function flow(page: Page, data: Data): Promise<void> {');
  out.push(`  // await page.goto(${tsString(map.origin)});`);
  for (const fn of fnNames) out.push(`  // await ${fn}(page, data);`);
  if (goToNames.length) {
    out.push('  // Navigation helpers generated from routes.json:');
    for (const fn of goToNames) out.push(`  // await ${fn}(page);`);
  }
  out.push('  void page;');
  out.push('  void data;');
  out.push('}');
  out.push('');
  return out.join('\n');
}
