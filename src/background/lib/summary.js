/**
 * SUMMARY.md — docs/03, docs/12. The human read: session header, page
 * inventory, the flow narrated from the graph with the actions behind each
 * edge, dependency and list findings, coverage, the attention list,
 * degradation notes and the sharing reminder.
 */
import { TOOL_NAME, TOOL_VERSION } from '../../shared/constants.js';
import { stemFor, routeOf, viewKeyOf } from './naming.js';
import { flowNarrative, attentionList, renderSection, coverageLines, cell, trunc, code, codeCell } from './narrative.js';

/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../../shared/schema.js').FlowMap} FlowMap */
/** @typedef {import('../../shared/schema.js').SessionMeta} SessionMeta */
/** @typedef {import('../../shared/schema.js').RepeatPattern} RepeatPattern */
/** @typedef {import('../../shared/schema.js').TablePattern} TablePattern */
/** @typedef {import('../../shared/schema.js').PaginationPattern} PaginationPattern */

/**
 * docs/12 additions; every field optional so a 1.0.0 session still summarises.
 * @typedef {Object} SummaryExtras
 * @property {import('../../shared/schema.js').SiteMap} [siteMap]
 * @property {import('../../shared/schema.js').ApiCatalog} [catalog]
 * @property {import('../../shared/schema.js').Coverage} [coverage]
 * @property {import('../../shared/schema.js').ActionEntry[]} [actions]
 * @property {import('../../shared/schema.js').DownloadEntry[]} [downloads]
 */

/**
 * @param {StateRecord[]} states
 * @param {FlowMap} map
 * @param {SessionMeta} meta
 * @param {number} netCount
 * @param {SummaryExtras} [extras]
 * @returns {string}
 */
export function buildSummary(states, map, meta, netCount, extras = {}) {
  /** @type {string[]} */
  const out = [];
  const actions = extras.actions || [];
  const downloads = extras.downloads || [];
  const endpoints = extras.catalog ? extras.catalog.endpoints.length : 0;
  out.push(`# ${TOOL_NAME} capture — ${map.origin}`);
  out.push('');
  out.push(`Generated ${new Date().toISOString()} by ${TOOL_NAME} ${TOOL_VERSION}. Session started ${meta.sessionStartedAt}.`);
  out.push('');
  const distinctRoutes = new Set(states.map(routeOf));
  const loggedIn = states.filter((s) => s.authHints && s.authHints.loggedIn === true).length;
  out.push(`- Framework: **${map.framework}**${states[0] && states[0].framework.version ? ` ${states[0].framework.version}` : ''}${states.some((s) => s.usesShadowDom) ? ', uses shadow DOM' : ''}`);
  const humanOnly = map.controls.filter((c) => c.redactedEntirely).length;
  out.push(`- **${states.length}** page states across **${distinctRoutes.size}** distinct routes (pages); **${map.controls.length}** unique controls, of which **${humanOnly}** redacted (human-only); **${map.lists.length}** list patterns`);
  out.push(`- **${map.transitions.length}** transitions, **${actions.length}** recorded actions (clicks and changes), **${map.dependencies.length}** dependency findings`);
  out.push(`- **${netCount}** network calls in \`network.har\`, **${endpoints}** distinct endpoints in \`api-catalog.json\`, **${downloads.length}** downloads in \`downloads.json\`${meta.keepBodies === 'full' ? ', full API bodies kept under `api/bodies/`' : ''}`);
  out.push(`- Logged-in signal on ${loggedIn} of ${states.length} states (password fields, autocomplete tokens and login/logout paths; English text only at low confidence)`);
  out.push(`- Redaction packs: ${meta.packs.join(', ')}`);
  out.push('');
  out.push('Control values were replaced with `<n chars>` at capture time. Passwords, OTPs, captcha and similar keep their identity, position and selectors but carry no value at all (`redactedEntirely`); they are for a human to fill. Download file names were never stored; only their shape was.');
  out.push('');

  const d = meta.degraded;
  if (d.screenshots || d.snapshots || d.netTrimmed || d.statesRefused || d.bodiesDropped) {
    out.push('> **Storage degradation during this session.** This export is thinner than the site, not the other way round:');
    if (d.screenshots) out.push('> - screenshots were switched off part-way');
    if (d.snapshots) out.push('> - DOM snapshots were switched off part-way');
    if (d.bodiesDropped) out.push('> - full API bodies were dropped; shapes remain');
    if (d.netTrimmed) out.push('> - the network log was trimmed to a quarter of its cap');
    if (d.statesRefused) out.push('> - new states were refused at the end');
    out.push('');
  }

  if (!states.length) {
    out.push('_No states were captured for this origin._');
    out.push('');
    return out.join('\n');
  }

  // ---- page inventory
  out.push('## Page inventory');
  out.push('');
  out.push('| seq | title | route | view | controls | lists | errors | reached by | files | notes |');
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const s of states) {
    const l = s.lists || { tables: [], repeats: [], pagination: [], downloads: [] };
    const lists = l.tables.length + l.repeats.length + l.pagination.length + l.downloads.length;
    const notes = [];
    if (s.inIframe) notes.push('iframe');
    if (s.duplicateOf) notes.push(`manual duplicate of ${s.duplicateOf}`);
    if (s.captureDegraded) notes.push('DOM triggers throttled');
    if (s.usesShadowDom) notes.push('shadow DOM');
    if (s.opaqueRegions && s.opaqueRegions.length) notes.push(`${s.opaqueRegions.length} opaque region(s)`);
    if (s.blockedFrames && s.blockedFrames.length) notes.push(`${s.blockedFrames.length} unrecorded frame(s)`);
    if (s.authHints && s.authHints.loggedIn === true) notes.push(`logged in (${s.authHints.confidence})`);
    if (s.orderApproximate) notes.push('control order approximate');
    if (s.openedFrom) notes.push(`opened in a new tab${s.openedFrom.actionId ? ` by ${s.openedFrom.actionId}` : ''}`);
    out.push(`| ${s.seq} | ${cell(trunc(s.title || '(untitled)', 60))} | ${codeCell(routeOf(s))} | ${viewKeyOf(s) ? codeCell(trunc(viewKeyOf(s), 40)) : ''} | ${s.controlCount} | ${lists} | ${s.errors.length} | \`${cell(trunc(s.trigger, 40))}\` | \`${stemFor(s)}\` | ${notes.join('; ')} |`);
  }
  out.push('');

  // ---- flow
  out.push('## Flow');
  out.push('');
  out.push(...flowNarrative(states, map.transitions, map.timeline, actions));
  out.push('');

  // ---- dependencies
  out.push('## Dependent controls');
  out.push('');
  if (!map.dependencies.length) {
    out.push('_No dependent-control behaviour was detected. If cascading dropdowns exist, check that the change fired before the capture debounce, or that the widget emits a change we can see (custom listboxes are handled by option clicks)._');
  } else {
    out.push('| source | targets | via network | endpoint | confidence | seen on |');
    out.push('|---|---|---|---|---|---|');
    for (const dep of map.dependencies) {
      out.push(`| \`${cell(dep.sourceKey)}\` | ${dep.targetKeys.length ? dep.targetKeys.map((t) => `\`${cell(t)}\``).join(', ') : '_(none observed)_'} | ${dep.viaNetwork ? 'yes' : 'no'} | ${dep.endpoint ? `\`${cell(dep.endpoint)}\`` : ''} | ${dep.confidence} | ${dep.stateId} |`);
    }
  }
  out.push('');

  // ---- lists
  out.push('## List patterns');
  out.push('');
  if (!map.lists.length) out.push('_No tables, repeated items, pagination or download links were detected._');
  for (const l of map.lists) {
    if (l.kind === 'table') {
      const t = /** @type {TablePattern} */ (l.pattern);
      out.push(`- **Table** ${code(t.containerSelector)} — ${t.headers.length} columns${t.headers.length ? ` (${t.headers.slice(0, 8).map((h) => `"${cell(h)}"`).join(', ')}${t.headers.length > 8 ? ', …' : ''})` : ''}, ${t.rowCount} rows, row selector ${code(t.rowSelector)}${t.shadowPath.length ? `, inside shadow hosts ${t.shadowPath.map((h) => code(h)).join(' → ')}` : ''}; seen on ${l.seenOnStates.join(', ')}`);
    } else if (l.kind === 'repeat') {
      const r = /** @type {RepeatPattern} */ (l.pattern);
      out.push(`- **Repeated items** ${r.itemCount} × ${code(r.itemSelector)} — slots: ${r.slots.map((s) => `${s.kind} ${code(s.selector)}${s.download ? ' (download)' : ''}`).join(', ') || 'none'}; seen on ${l.seenOnStates.join(', ')}`);
    } else if (l.kind === 'pagination') {
      const p = /** @type {PaginationPattern} */ (l.pattern);
      out.push(`- **Pagination** (${p.style}) ${code(p.containerSelector)} — next ${p.next ? code(p.next) : '_none_'}, prev ${p.prev ? code(p.prev) : '_none_'}, indicator ${p.pageIndicator ? code(p.pageIndicator) : '_none_'}${p.current ? `, read "${cell(p.current)}"` : ''}; seen on ${l.seenOnStates.join(', ')}`);
    } else {
      out.push(`- **Download link** ${code(l.selector)} — ${JSON.stringify(l.pattern).replace(/"/g, '')}; seen on ${l.seenOnStates.join(', ')}`);
    }
  }
  out.push('');

  // ---- coverage (docs/12)
  out.push('## Coverage');
  out.push('');
  out.push('What the recording saw and did not exercise. Each line is something to click in a further recording if it matters; `coverage.json` has the same per page.');
  out.push('');
  out.push(...coverageLines(extras.coverage, 30));
  out.push('');

  // ---- attention
  out.push('## Attention list');
  out.push('');
  out.push('Things a human should look at before trusting the flow map.');
  out.push('');
  for (const section of attentionList(states, map)) renderSection(out, section);

  // ---- reminders
  out.push('## Before this leaves the machine');
  out.push('');
  out.push('- `network.har` keeps response bodies because option lists, lookups and list data live in them. They were regex-scrubbed with the packs above (emails, phones, cards, tokens, plus country packs) only. **Names, addresses and free text are not scrubbed. Read the bodies before sharing.**');
  if (meta.keepBodies === 'full') out.push('- `api/bodies/` holds **full** API responses (up to 1 MB each) because "Keep full API responses" was on. The same scrubbing applies and the same warning, more so: names, addresses and free text in them cannot be scrubbed automatically.');
  out.push('- `api-catalog.json` holds shapes (key names, types, lengths, enum-like values) rather than data; key names and enum values were scrubbed, but a key that is itself a name or a number is still visible.');
  out.push('- `downloads.json` never holds a file name, only its shape (`A{n}` letters, `9{n}` digits), and never a file\'s contents.');
  out.push('- `flow-map.json` has `sourceField: null` on every control. Filling that column binds the site to your own data model.');
  out.push('- `playwright-skeleton.ts` has live navigation and reading helpers built from recorded clicks and commented-out fills; nothing in it has been executed.');
  out.push('- HAR timings are approximate and browser-added request headers are absent; the file is HAR 1.2 shaped for DevTools import, not a wire capture.');
  out.push('');
  return out.join('\n');
}
