/**
 * Shared prose builders for SUMMARY.md, AUTOMATION-BRIEF.md and RECIPES.md:
 * the flow narrated from the transition graph with pause gaps rendered
 * inline (A8), actions and locators put into words (docs/12), and the
 * attention list. Everything here is derived from already-redacted records.
 */
import { routeOf, viewKeyOf, PLACEHOLDER_RE } from './naming.js';

/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../../shared/schema.js').ActionEntry} ActionEntry */
/** @typedef {import('../../shared/schema.js').ActionSelectors} ActionSelectors */
/** @typedef {import('../../shared/schema.js').RouteStep} RouteStep */
/** @typedef {import('../../shared/schema.js').Coverage} Coverage */
/** @typedef {import('../../shared/schema.js').Transition} Transition */
/** @typedef {import('../../shared/schema.js').TimelineEvent} TimelineEvent */
/** @typedef {import('../../shared/schema.js').FlowMap} FlowMap */

const WEAK_LABEL_SOURCES = new Set(['none', 'sibling', 'container', 'placeholder']);

/**
 * @param {string} s
 * @returns {string}
 */
export const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/**
 * @param {string} s
 * @param {number} n
 */
export const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/**
 * A markdown code span that survives whatever the page put in the text:
 * backticks widen the fence, newlines go. Pipes stay as they are: the reader
 * is an agent reading the raw file, and a view key such as `a=1|page=2` must
 * reach it exactly. Inside a table row use `codeCell`.
 * @param {unknown} s
 * @returns {string}
 */
export function code(s) {
  const text = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '``';
  const runs = text.match(/`+/g) || [];
  const fence = '`'.repeat(runs.reduce((n, r) => Math.max(n, r.length), 0) + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/**
 * `code` for a markdown table cell, where an unescaped pipe would end the cell.
 * @param {unknown} s
 * @returns {string}
 */
export const codeCell = (s) => code(s).replace(/\|/g, '\\|');

/**
 * Row labels are record data, so capture keeps only their length
 * (`<14 chars>`). Such a label names nothing a reader can look for.
 * @param {unknown} label
 * @returns {boolean}
 */
export const isLengthOnly = (label) => /^<\d+ chars>$/.test(String(label ?? '').trim());

/**
 * Text from the page between double quotes, inside a sentence.
 * @param {unknown} s
 * @param {number} [max]
 * @returns {string}
 */
export const quoted = (s, max = 80) => `"${cell(trunc(String(s ?? ''), max)).replace(/"/g, "'")}"`;

/**
 * What the user did, in words: the label and where it sits, not only the
 * 40-character trigger string.
 * @param {Pick<ActionEntry, 'kind'|'label'|'menuPath'|'chosen'> & Partial<ActionEntry>} a
 * @returns {string}
 */
export function actionPhrase(a) {
  const label = String(a.label || '').trim();
  const menu = Array.isArray(a.menuPath) ? a.menuPath : [];
  // A row click with its text withheld is "open an item", not a click on a name.
  const itemOpen = !!a.listSelector && isLengthOnly(label) && !a.pagination && !a.viewGroup;
  /** @type {string[]} */
  const where = [];
  if (menu.length) where.push(`menu: ${menu.map((m) => cell(String(m))).join(' > ')}`);
  if (a.viewGroup) where.push(`view group ${quoted(a.viewGroup, 40)}`);
  if (a.pagination) where.push(`pagination${a.paginationRole ? `: ${a.paginationRole}` : ''}`);
  if (a.listSelector && !itemOpen) where.push(`inside list ${code(a.listSelector)}`);
  if (a.download) where.push('download link');
  if (a.target === '_blank') where.push('opens a new tab');
  if (a.danger) where.push('**flagged danger**');
  const tail = where.length ? ` (${where.join('; ')})` : '';
  if (a.kind === 'change') {
    const what = a.controlKey ? code(a.controlKey) : label ? quoted(label) : 'a control';
    return `changing ${what}${a.chosen ? ` to ${quoted(a.chosen)}` : ''}${tail}`;
  }
  if (itemOpen) return `opening an item of the list ${code(a.listSelector)} (its text was withheld; ${label} is only its length)${tail}`;
  return `clicking ${label && !isLengthOnly(label) ? quoted(label) : a.selectors && a.selectors.primary ? code(a.selectors.primary) : 'an unlabelled element'}${tail}`;
}

/**
 * The locators for one target, best first, as the Playwright expressions a
 * reader can paste. Role plus accessible name survives a redesign that
 * rewrites every class; CSS comes after it.
 * @param {ActionSelectors|null|undefined} sel
 * @returns {{ best: string, others: string[], notes: string[] }}
 */
export function locatorsFor(sel) {
  /** @type {string[]} */
  const all = [];
  /** @type {string[]} */
  const notes = [];
  if (!sel) return { best: '', others: [], notes: ['no selector was recorded for this target; find it by its label'] };
  const name = String(sel.name || '').trim();
  if (sel.role && name) {
    // A redacted name is not the text on the page, so it cannot be matched.
    if (PLACEHOLDER_RE.test(name)) notes.push('the accessible name holds redacted text, so the role locator is left out');
    else all.push(`page.getByRole(${JSON.stringify(sel.role)}, { name: ${JSON.stringify(name)}, exact: true })`);
  }
  const hosts = Array.isArray(sel.shadowPath) ? sel.shadowPath.filter(Boolean) : [];
  const chain = hosts.map((h) => `.locator(${JSON.stringify(h)})`).join('');
  for (const css of [sel.primary, ...(Array.isArray(sel.fallbacks) ? sel.fallbacks : [])]) {
    if (!css) continue;
    if (PLACEHOLDER_RE.test(css)) {
      notes.push(`${code(css)} holds a redacted segment and will not match as written`);
      continue;
    }
    const expr = `page${chain}.locator(${JSON.stringify(css)})`;
    if (!all.includes(expr)) all.push(expr);
  }
  if (hosts.length) notes.push(`inside shadow root(s): ${hosts.map((h) => code(h)).join(' → ')}`);
  if (sel.stability) notes.push(`primary selector stability: ${sel.stability}${sel.unique === false ? ', NOT unique on the page when recorded' : ''}`);
  return { best: all[0] || '', others: all.slice(1), notes };
}

/**
 * The coverage findings as a markdown block, shared by the summary and the
 * brief so both say the same thing.
 * @param {Coverage|null|undefined} coverage
 * @param {number} [cap]
 * @returns {string[]}
 */
export function coverageLines(coverage, cap = 30) {
  if (!coverage) return ['_Coverage was not computed for this export._'];
  const t = coverage.totals;
  /** @type {string[]} */
  const out = [];
  out.push(`- Menu items opened: **${t.menuVisited} of ${t.menuItems}** seen`);
  out.push(`- View options (tabs, filters) selected: **${t.viewOptionsVisited} of ${t.viewOptions}**`);
  out.push(`- Lists: **${t.lists}**, of which paged: **${t.listsPaged}**`);
  out.push(`- Pages: **${t.pages}**, complete: **${coverage.pages.filter((p) => p.complete).length}**; downloads recorded: **${t.downloads}**`);
  out.push('');
  if (!coverage.hints.length) {
    out.push('_Nothing the recording saw was left unopened._');
    return out;
  }
  out.push('What was seen and not exercised, most valuable first:');
  out.push('');
  for (const h of coverage.hints.slice(0, cap)) out.push(`- ${cell(h)}`);
  if (coverage.hints.length > cap) out.push(`- … and ${coverage.hints.length - cap} more in \`coverage.json\``);
  return out;
}

/**
 * @param {number} ms
 * @returns {string}
 */
export function humanDuration(ms) {
  if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))} seconds`;
  if (ms < 3600000) return `${Math.round(ms / 60000)} minutes`;
  return `${(ms / 3600000).toFixed(1)} hours`;
}

/**
 * Single-page apps keep one title for every route, so the route follows it.
 * @param {StateRecord} s
 * @returns {string}
 */
export const stateName = (s) => `**${s.seq} ${cell(trunc(s.title || routeOf(s), 48))}**${s.title ? ` ${code(routeOf(s))}` : ''}`;

/**
 * The flow as prose, one bullet per edge, with pause/resume gaps inserted
 * where they fall in time and chain breaks called out.
 * @param {StateRecord[]} states
 * @param {Transition[]} transitions
 * @param {TimelineEvent[]} timeline
 * @param {ActionEntry[]} [actions]   docs/12: edges that name an action are narrated with it
 * @returns {string[]}   markdown lines
 */
export function flowNarrative(states, transitions, timeline, actions = []) {
  const byId = new Map(states.map((s) => [s.id, s]));
  /** @type {Map<string, ActionEntry>} */
  const actionById = new Map();
  for (const a of actions || []) if (a && a.id) actionById.set(a.id, a);
  /** @type {string[]} */
  const out = [];
  if (!states.length) return ['_No states were captured._'];

  // Interleave edges and pause events by the time of the destination state.
  /** @type {Array<{ at: number, line: string }>} */
  const items = [];
  for (const t of transitions) {
    const from = byId.get(t.from);
    const to = byId.get(t.to);
    if (!from || !to) continue;
    const parts = [];
    const moved = routeOf(from) !== routeOf(to);
    if (moved) parts.push(`navigated to ${code(routeOf(to))}${t.viaNewTab ? ' in a new tab' : ''}`);
    else if (t.urlChanged) parts.push('the URL changed within the same route');
    // On a new route the old view key means nothing; only a view it opened with is news.
    if (viewKeyOf(from) !== viewKeyOf(to) && (!moved || viewKeyOf(to))) parts.push(`the view became ${code(viewKeyOf(to) || '(default)')}`);
    if (t.fieldsAdded.length) parts.push(`added ${t.fieldsAdded.length} control${t.fieldsAdded.length === 1 ? '' : 's'} (${t.fieldsAdded.slice(0, 6).map((k) => `\`${cell(k)}\``).join(', ')}${t.fieldsAdded.length > 6 ? ', …' : ''})`);
    if (t.fieldsRemoved.length) parts.push(`removed ${t.fieldsRemoved.length}`);
    if (t.optionsChanged.length) parts.push(`changed options on ${t.optionsChanged.map((c) => `\`${cell(c.key)}\``).join(', ')}`);
    if (t.listCountsChanged.length) parts.push(`list counts changed: ${t.listCountsChanged.map((c) => `\`${cell(c.selector)}\` ${c.before}→${c.after}`).join(', ')}`);
    if (t.errorsAppeared.length) parts.push(`surfaced ${t.errorsAppeared.length} error${t.errorsAppeared.length === 1 ? '' : 's'}: ${t.errorsAppeared.slice(0, 2).map((e) => `"${cell(trunc(e, 80))}"`).join(', ')}`);
    if (t.netCallsBetween.length) parts.push(`${t.netCallsBetween.length} network call${t.netCallsBetween.length === 1 ? '' : 's'} in between`);
    const what = parts.length ? parts.join('; ') : 'no structural change';

    const cause = t.actionId ? actionById.get(t.actionId) : undefined;
    const before = (Array.isArray(t.actionIds) ? t.actionIds : [])
      .filter((id) => id !== t.actionId)
      .map((id) => actionById.get(id))
      .filter((a) => !!a);
    const did = cause ? `${actionPhrase(cause)} (\`${cause.id}\`)` : `\`${cell(t.trigger)}\``;
    // Everything the person did on the way, in order, the click held responsible last.
    const lead = before.length ? `${before.slice(0, 4).map((a) => (a ? `${actionPhrase(a)} (\`${a.id}\`)` : '')).join(', then ')}${before.length > 4 ? `, and ${before.length - 4} more` : ''}, then ` : '';
    items.push({ at: Date.parse(to.capturedAt) || 0, line: `- From ${stateName(from)}, ${lead}${did} led to ${stateName(to)} — ${what}.` });
  }
  // States with no inbound edge start a chain (first state, new tab, after a gap).
  const hasInbound = new Set(transitions.map((t) => t.to));
  for (const s of states) {
    if (hasInbound.has(s.id)) continue;
    const why = s.seq === 1 ? 'session start' : s.trigger === 'load' ? 'fresh load (new tab, reload, or after a pause)' : 'chain start';
    items.push({ at: (Date.parse(s.capturedAt) || 0) - 1, line: `- ${stateName(s)} begins a chain — ${why}${s.title ? '' : `; ${code(routeOf(s))}`}${s.inIframe ? ' (iframe)' : ''}; ${s.controlCount} controls.` });
  }
  let pausedAt = 0;
  for (const ev of timeline) {
    const at = Date.parse(ev.at) || 0;
    if (ev.type === 'paused') pausedAt = at;
    else if (ev.type === 'resumed' && pausedAt) {
      items.push({ at, line: `- — capture paused for ${humanDuration(at - pausedAt)} —` });
      pausedAt = 0;
    } else if (ev.type === 'cleared') items.push({ at, line: '- — session cleared —' });
  }
  items.sort((a, b) => a.at - b.at);
  for (const it of items) out.push(it.line);
  return out;
}

/**
 * @typedef {Object} AttentionSection
 * @property {string} title
 * @property {string[]} items
 */

/**
 * The attention list: what a human should check before trusting the map.
 * @param {StateRecord[]} states
 * @param {FlowMap} map
 * @returns {AttentionSection[]}
 */
export function attentionList(states, map) {
  /** @type {AttentionSection[]} */
  const out = [];
  const dedupe = (/** @type {string[]} */ items) => Array.from(new Set(items));

  out.push({
    title: 'Fragile selectors',
    items: map.controls.filter((c) => c.selectors.stability === 'fragile').map((c) => `\`${cell(c.key)}\` → \`${cell(c.selectors.primary)}\`${c.notes ? ` — ${cell(c.notes)}` : ''}`),
  });
  out.push({
    title: 'Weak label sources',
    items: map.controls.filter((c) => WEAK_LABEL_SOURCES.has(c.labelSource)).map((c) => `\`${cell(c.key)}\` — labelSource \`${c.labelSource}\`${c.label ? `: "${cell(c.label)}"` : ''}`),
  });

  /** @type {string[]} */
  const nonUnique = [];
  /** @type {string[]} */
  const dupIds = [];
  /** @type {string[]} */
  const redacted = [];
  /** @type {string[]} */
  const opaque = [];
  for (const s of states) {
    /** @type {Map<string, number>} */
    const idCounts = new Map();
    for (const c of s.controls) {
      if (c.redactedEntirely) redacted.push(`state ${s.seq}: \`${cell(c.key)}\` (${c.type}${c.label ? `, "${cell(c.label)}"` : ''}) — \`${cell(c.selectors.primary)}\``);
      if (c.id) idCounts.set(c.id, (idCounts.get(c.id) || 0) + 1);
      if (!c.selectors.unique) nonUnique.push(`state ${s.seq}: \`${cell(c.key)}\` — \`${cell(c.selectors.primary)}\`${c.selectors.uniqueInForm ? ' (unique within its form)' : ''}`);
    }
    for (const b of s.buttons) if (b.id) idCounts.set(b.id, (idCounts.get(b.id) || 0) + 1);
    for (const [id, n] of idCounts) if (n > 1) dupIds.push(`state ${s.seq} (${code(routeOf(s))}): \`#${cell(id)}\` appears ${n} times`);
    for (const o of s.opaqueRegions || []) opaque.push(`state ${s.seq}: \`${cell(o.selector)}\` (${o.tag}) — ${o.reason}`);
  }
  out.push({ title: 'Non-unique primary selectors', items: dedupe(nonUnique) });
  out.push({ title: 'Duplicate ids on a page', items: dedupe(dupIds) });
  out.push({ title: 'Controls seen only once', items: map.controls.filter((c) => c.seenOnStates.length === 1 && states.length > 1).map((c) => `\`${cell(c.key)}\` on ${c.seenOnStates[0]}`) });
  out.push({ title: 'Key collisions across pages (A7)', items: map.controls.filter((c) => c.collidesWith.length).map((c) => `\`${cell(c.key)}\` ↔ ${c.collidesWith.map((k) => `\`${cell(k)}\``).join(', ')}`) });
  out.push({ title: 'Ids that changed between captures', items: map.controls.filter((c) => c.notes.includes('id varies')).map((c) => `\`${cell(c.key)}\` — ${cell(c.notes)}`) });
  out.push({ title: 'Widget-backed controls (do not type into these)', items: map.controls.filter((c) => c.entry && c.entry.mode === 'widget').map((c) => `\`${cell(c.key)}\` — ${c.entry ? `${c.entry.widgetKind || 'widget'}: ${cell(c.entry.evidence)}` : ''}`) });
  out.push({ title: 'Entry mode unknown', items: map.controls.filter((c) => c.entry && c.entry.mode === 'unknown').map((c) => `\`${cell(c.key)}\` — ${c.entry ? cell(c.entry.evidence) : ''}`) });
  out.push({ title: 'Regions the capture could not see into (closed shadow roots)', items: dedupe(opaque) });
  out.push({ title: 'Redacted controls — human-only, never automate (redactedEntirely)', items: dedupe(redacted) });

  const dangerButtons = new Set();
  for (const s of states) for (const b of s.buttons) if (b.danger) dangerButtons.add(`"${cell(b.text)}" — \`${cell(b.selector)}\``);
  out.push({ title: 'Buttons the automation must never activate', items: Array.from(dangerButtons) });

  const blocked = new Set();
  for (const s of states) for (const o of s.blockedFrames || []) blocked.add(o);
  out.push({ title: 'Embedded frames that were not recorded (blind spots)', items: Array.from(blocked).map((o) => `\`${cell(o)}\``) });

  const degradedStates = states.filter((s) => s.captureDegraded).map((s) => `state ${s.seq}`);
  out.push({ title: 'States captured while DOM triggers were throttled', items: degradedStates });
  return out;
}

/**
 * @param {string[]} out
 * @param {AttentionSection} section
 * @param {number} [cap]
 */
export function renderSection(out, section, cap = 200) {
  out.push(`### ${section.title} (${section.items.length})`);
  out.push('');
  if (!section.items.length) out.push('_none_');
  else for (const it of section.items.slice(0, cap)) out.push(`- ${it}`);
  if (section.items.length > cap) out.push(`- … and ${section.items.length - cap} more`);
  out.push('');
}
