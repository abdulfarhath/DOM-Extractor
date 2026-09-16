/**
 * SUMMARY.md — docs/03. The human read: session header, page inventory, the
 * flow narrated from the graph, dependency and list findings, the attention
 * list, degradation notes and the sharing reminder.
 */
import { TOOL_NAME, TOOL_VERSION } from '../../shared/constants.js';
import { stemFor } from './naming.js';
import { flowNarrative, attentionList, renderSection, cell, trunc } from './narrative.js';

/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../../shared/schema.js').FlowMap} FlowMap */
/** @typedef {import('../../shared/schema.js').SessionMeta} SessionMeta */
/** @typedef {import('../../shared/schema.js').RepeatPattern} RepeatPattern */
/** @typedef {import('../../shared/schema.js').TablePattern} TablePattern */
/** @typedef {import('../../shared/schema.js').PaginationPattern} PaginationPattern */

/**
 * @param {StateRecord[]} states
 * @param {FlowMap} map
 * @param {SessionMeta} meta
 * @param {number} netCount
 * @returns {string}
 */
export function buildSummary(states, map, meta, netCount) {
  /** @type {string[]} */
  const out = [];
  out.push(`# ${TOOL_NAME} capture — ${map.origin}`);
  out.push('');
  out.push(`Generated ${new Date().toISOString()} by ${TOOL_NAME} ${TOOL_VERSION}. Session started ${meta.sessionStartedAt}.`);
  out.push('');
  const distinctPaths = new Set(states.map((s) => s.pathname));
  const loggedIn = states.filter((s) => s.authHints && s.authHints.loggedIn === true).length;
  out.push(`- Framework: **${map.framework}**${states[0] && states[0].framework.version ? ` ${states[0].framework.version}` : ''}${states.some((s) => s.usesShadowDom) ? ', uses shadow DOM' : ''}`);
  out.push(`- **${states.length}** page states across **${distinctPaths.size}** distinct paths; **${map.controls.length}** unique controls; **${map.lists.length}** list patterns`);
  out.push(`- **${map.transitions.length}** transitions, **${map.dependencies.length}** dependency findings, **${netCount}** network calls in \`network.har\``);
  out.push(`- Logged-in signal on ${loggedIn} of ${states.length} states (from logout/login affordances only)`);
  out.push(`- Redaction packs: ${meta.packs.join(', ')}`);
  out.push('');
  out.push('Control values were replaced with `<n chars>` at capture time. Passwords, OTPs, captcha and similar were never recorded beyond their existence (`redactedEntirely`).');
  out.push('');

  const d = meta.degraded;
  if (d.screenshots || d.snapshots || d.netTrimmed || d.statesRefused) {
    out.push('> **Storage degradation during this session.** This export is thinner than the site, not the other way round:');
    if (d.screenshots) out.push('> - screenshots were switched off part-way');
    if (d.snapshots) out.push('> - DOM snapshots were switched off part-way');
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
  out.push('| seq | title | path | controls | lists | errors | reached by | files | notes |');
  out.push('|---|---|---|---|---|---|---|---|---|');
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
    if (s.authHints && s.authHints.loggedIn === true) notes.push('logged in');
    out.push(`| ${s.seq} | ${cell(trunc(s.title || '(untitled)', 60))} | \`${cell(s.pathname)}\` | ${s.controlCount} | ${lists} | ${s.errors.length} | \`${cell(trunc(s.trigger, 40))}\` | \`${stemFor(s)}\` | ${notes.join('; ')} |`);
  }
  out.push('');

  // ---- flow
  out.push('## Flow');
  out.push('');
  out.push(...flowNarrative(states, map.transitions, map.timeline));
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
      out.push(`- **Table** \`${cell(t.containerSelector)}\` — ${t.headers.length} columns${t.headers.length ? ` (${t.headers.slice(0, 8).map((h) => `"${cell(h)}"`).join(', ')}${t.headers.length > 8 ? ', …' : ''})` : ''}, ${t.rowCount} rows, row selector \`${cell(t.rowSelector)}\`${t.shadowPath.length ? `, inside shadow hosts ${t.shadowPath.map((h) => `\`${cell(h)}\``).join(' → ')}` : ''}; seen on ${l.seenOnStates.join(', ')}`);
    } else if (l.kind === 'repeat') {
      const r = /** @type {RepeatPattern} */ (l.pattern);
      out.push(`- **Repeated items** ${r.itemCount} × \`${cell(r.itemSelector)}\` — slots: ${r.slots.map((s) => `${s.kind} \`${cell(s.selector)}\`${s.download ? ' (download)' : ''}`).join(', ') || 'none'}; seen on ${l.seenOnStates.join(', ')}`);
    } else if (l.kind === 'pagination') {
      const p = /** @type {PaginationPattern} */ (l.pattern);
      out.push(`- **Pagination** (${p.style}) \`${cell(p.containerSelector)}\` — next ${p.next ? `\`${cell(p.next)}\`` : '_none_'}, prev ${p.prev ? `\`${cell(p.prev)}\`` : '_none_'}, indicator ${p.pageIndicator ? `\`${cell(p.pageIndicator)}\`` : '_none_'}; seen on ${l.seenOnStates.join(', ')}`);
    } else {
      out.push(`- **Download link** \`${cell(l.selector)}\` — ${JSON.stringify(l.pattern).replace(/"/g, '')}; seen on ${l.seenOnStates.join(', ')}`);
    }
  }
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
  out.push('- `flow-map.json` has `sourceField: null` on every control. Filling that column binds the site to your own data model.');
  out.push('- `playwright-skeleton.ts` is commented out on purpose; nothing in it has been executed.');
  out.push('- HAR timings are approximate and browser-added request headers are absent; the file is HAR 1.2 shaped for DevTools import, not a wire capture.');
  out.push('');
  return out.join('\n');
}
