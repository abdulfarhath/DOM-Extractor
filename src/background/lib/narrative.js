/**
 * Shared prose builders for SUMMARY.md and AUTOMATION-BRIEF.md: the flow
 * narrated from the transition graph with pause gaps rendered inline (A8),
 * and the attention list. Everything here is derived from already-redacted
 * records.
 */

/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */
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
 * @param {number} ms
 * @returns {string}
 */
export function humanDuration(ms) {
  if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))} seconds`;
  if (ms < 3600000) return `${Math.round(ms / 60000)} minutes`;
  return `${(ms / 3600000).toFixed(1)} hours`;
}

/**
 * @param {StateRecord} s
 * @returns {string}
 */
export const stateName = (s) => `**${s.seq} ${cell(trunc(s.title || s.pathname, 48))}**`;

/**
 * The flow as prose, one bullet per edge, with pause/resume gaps inserted
 * where they fall in time and chain breaks called out.
 * @param {StateRecord[]} states
 * @param {Transition[]} transitions
 * @param {TimelineEvent[]} timeline
 * @returns {string[]}   markdown lines
 */
export function flowNarrative(states, transitions, timeline) {
  const byId = new Map(states.map((s) => [s.id, s]));
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
    if (t.urlChanged) parts.push(`navigated to \`${cell(to.pathname)}\``);
    if (t.fieldsAdded.length) parts.push(`added ${t.fieldsAdded.length} control${t.fieldsAdded.length === 1 ? '' : 's'} (${t.fieldsAdded.slice(0, 6).map((k) => `\`${cell(k)}\``).join(', ')}${t.fieldsAdded.length > 6 ? ', …' : ''})`);
    if (t.fieldsRemoved.length) parts.push(`removed ${t.fieldsRemoved.length}`);
    if (t.optionsChanged.length) parts.push(`changed options on ${t.optionsChanged.map((c) => `\`${cell(c.key)}\``).join(', ')}`);
    if (t.listCountsChanged.length) parts.push(`list counts changed: ${t.listCountsChanged.map((c) => `\`${cell(c.selector)}\` ${c.before}→${c.after}`).join(', ')}`);
    if (t.errorsAppeared.length) parts.push(`surfaced ${t.errorsAppeared.length} error${t.errorsAppeared.length === 1 ? '' : 's'}: ${t.errorsAppeared.slice(0, 2).map((e) => `"${cell(trunc(e, 80))}"`).join(', ')}`);
    if (t.netCallsBetween.length) parts.push(`${t.netCallsBetween.length} network call${t.netCallsBetween.length === 1 ? '' : 's'} in between`);
    const what = parts.length ? parts.join('; ') : 'no structural change';
    items.push({ at: Date.parse(to.capturedAt) || 0, line: `- From ${stateName(from)}, \`${cell(t.trigger)}\` led to ${stateName(to)} — ${what}.` });
  }
  // States with no inbound edge start a chain (first state, new tab, after a gap).
  const hasInbound = new Set(transitions.map((t) => t.to));
  for (const s of states) {
    if (hasInbound.has(s.id)) continue;
    const why = s.seq === 1 ? 'session start' : s.trigger === 'load' ? 'fresh load (new tab, reload, or after a pause)' : 'chain start';
    items.push({ at: (Date.parse(s.capturedAt) || 0) - 1, line: `- ${stateName(s)} begins a chain — ${why}; \`${cell(s.pathname)}\`${s.inIframe ? ' (iframe)' : ''}, ${s.controlCount} controls.` });
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
      if ('redactedEntirely' in c) {
        redacted.push(`state ${s.seq}: ${c.type}${c.label ? ` "${cell(c.label)}"` : ''}`);
        continue;
      }
      if (c.id) idCounts.set(c.id, (idCounts.get(c.id) || 0) + 1);
      if (!c.selectors.unique) nonUnique.push(`state ${s.seq}: \`${cell(c.key)}\` — \`${cell(c.selectors.primary)}\`${c.selectors.uniqueInForm ? ' (unique within its form)' : ''}`);
    }
    for (const b of s.buttons) if (b.id) idCounts.set(b.id, (idCounts.get(b.id) || 0) + 1);
    for (const [id, n] of idCounts) if (n > 1) dupIds.push(`state ${s.seq} (\`${cell(s.pathname)}\`): \`#${cell(id)}\` appears ${n} times`);
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
  out.push({ title: 'Credential-shaped controls, structure only', items: dedupe(redacted) });

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
