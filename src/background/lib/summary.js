/**
 * SUMMARY.md — docs/03. Written for a developer who has never seen the portal.
 * Everything here is derived; nothing is captured content beyond labels,
 * titles and paths, which were scrubbed at capture time.
 */
import { stemFor } from './naming.js';
import { mapKey } from './fieldmap.js';

/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../../shared/schema.js').FieldRecord} FieldRecord */
/** @typedef {import('../../shared/schema.js').Transition} Transition */
/** @typedef {import('../../shared/schema.js').Dependency} Dependency */
/** @typedef {import('../../shared/schema.js').FieldMapDraft} FieldMapDraft */
/** @typedef {import('../../shared/schema.js').SessionMeta} SessionMeta */

const WEAK_LABEL_SOURCES = new Set(['none', 'sibling', 'container', 'placeholder']);

/**
 * @param {string} s
 * @returns {string}
 */
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/**
 * @param {string} s
 * @param {number} n
 */
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/**
 * @param {StateRecord[]} states
 * @param {Transition[]} transitions
 * @param {Dependency[]} deps
 * @param {FieldMapDraft} fieldMap
 * @param {SessionMeta} meta
 * @param {number} netCount
 * @returns {string}
 */
export function buildSummary(states, transitions, deps, fieldMap, meta, netCount) {
  const byId = new Map(states.map((s) => [s.id, s]));
  /** @type {string[]} */
  const out = [];

  // ---- header
  out.push('# MCA DOM Capture — summary');
  out.push('');
  out.push(`Generated ${new Date().toISOString()} by MCA DOM Capturer. Session started ${meta.sessionStartedAt}.`);
  out.push('');
  const distinctPaths = new Set(states.map((s) => s.pathname));
  out.push(`- **${states.length}** page states across **${distinctPaths.size}** distinct paths`);
  out.push(`- **${fieldMap.fields.length}** unique fields, **${transitions.length}** transitions, **${deps.length}** dependency findings`);
  out.push(`- **${netCount}** network calls in \`network.har\``);
  out.push('');
  out.push('Field values were replaced with `<n chars>` at capture time. Passwords, OTPs and captcha inputs were never recorded, only noted as `redactedEntirely`.');
  out.push('');

  if (!states.length) {
    out.push('_No states were captured in this session._');
    out.push('');
    return out.join('\n');
  }

  // ---- page inventory
  out.push('## Page inventory');
  out.push('');
  out.push('| seq | title | path | fields | errors | reached by | files | notes |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const s of states) {
    const notes = [];
    if (s.inIframe) notes.push('iframe');
    if (s.duplicateOf) notes.push(`manual duplicate of ${s.duplicateOf}`);
    if (s.screenshotOf === 'parent-frame') notes.push('screenshot shows parent frame');
    out.push(
      `| ${s.seq} | ${cell(trunc(s.title || '(untitled)', 60))} | \`${cell(s.pathname)}\` | ${s.fieldCount} | ${s.errors.length} | \`${cell(trunc(s.trigger, 40))}\` | \`${stemFor(s)}\` | ${notes.join('; ')} |`
    );
  }
  out.push('');

  // ---- flow narrative
  out.push('## Flow');
  out.push('');
  if (!transitions.length) {
    out.push('_Only one state per document was captured; no transitions to describe._');
  } else {
    for (const t of transitions) {
      const from = byId.get(t.from);
      const to = byId.get(t.to);
      if (!from || !to) continue;
      const parts = [];
      if (t.urlChanged) parts.push(`navigated to \`${to.pathname}\``);
      if (t.fieldsAdded.length) parts.push(`added ${t.fieldsAdded.length} field${t.fieldsAdded.length === 1 ? '' : 's'} (${t.fieldsAdded.slice(0, 6).map((k) => `\`${cell(k)}\``).join(', ')}${t.fieldsAdded.length > 6 ? ', …' : ''})`);
      if (t.fieldsRemoved.length) parts.push(`removed ${t.fieldsRemoved.length}`);
      if (t.optionsChanged.length) parts.push(`changed options on ${t.optionsChanged.map((c) => `\`${cell(c.fieldId)}\``).join(', ')}`);
      if (t.errorsAppeared.length) parts.push(`surfaced ${t.errorsAppeared.length} error${t.errorsAppeared.length === 1 ? '' : 's'}`);
      if (t.netCallsBetween.length) parts.push(`${t.netCallsBetween.length} network call${t.netCallsBetween.length === 1 ? '' : 's'} in between`);
      const what = parts.length ? parts.join('; ') : 'no structural change';
      out.push(`- From **${from.seq} ${cell(trunc(from.title || from.pathname, 40))}**, \`${cell(t.trigger)}\` led to **${to.seq} ${cell(trunc(to.title || to.pathname, 40))}** — ${what}.`);
    }
  }
  out.push('');

  // ---- dependencies
  out.push('## Dependent fields');
  out.push('');
  if (!deps.length) {
    out.push('_No dependent-dropdown behaviour was detected. If you changed State/District style fields, check that the change fired before the capture debounce._');
  } else {
    out.push('| source | targets | via network | endpoint | confidence |');
    out.push('|---|---|---|---|---|');
    for (const d of deps) {
      out.push(`| \`${cell(d.sourceField)}\` | ${d.targetFields.length ? d.targetFields.map((t) => `\`${cell(t)}\``).join(', ') : '_(none observed)_'} | ${d.viaNetwork ? 'yes' : 'no'} | ${d.endpoint ? `\`${cell(d.endpoint)}\`` : ''} | ${d.confidence} |`);
    }
  }
  out.push('');

  // ---- attention list
  out.push('## Attention list');
  out.push('');
  out.push('Things a human should look at before trusting the field map.');
  out.push('');

  const fragile = fieldMap.fields.filter((f) => f.selectors.stability === 'fragile');
  const varying = fieldMap.fields.filter((f) => f.notes.includes('id varies across captures'));
  const weakLabel = fieldMap.fields.filter((f) => WEAK_LABEL_SOURCES.has(f.labelSource));
  section(out, `Fragile selectors (${fragile.length})`, fragile.map((f) => `\`${cell(f.key)}\` → \`${cell(f.selectors.primary)}\`${f.notes ? ` — ${cell(f.notes)}` : ''}`));
  section(out, `Ids that changed between captures (${varying.length})`, varying.map((f) => `\`${cell(f.key)}\` — ${cell(f.notes)}`));
  section(out, `Weak label sources (${weakLabel.length})`, weakLabel.map((f) => `\`${cell(f.key)}\` — labelSource \`${f.labelSource}\`${f.label ? `: "${cell(f.label)}"` : ''}`));

  /** @type {string[]} */
  const nonUnique = [];
  /** @type {string[]} */
  const dupIds = [];
  /** @type {string[]} */
  const redacted = [];
  for (const s of states) {
    /** @type {Map<string, number>} */
    const idCounts = new Map();
    for (const f of s.fields) {
      if ('redactedEntirely' in f) {
        redacted.push(`state ${s.seq}: ${f.type}${f.label ? ` "${cell(f.label)}"` : ''}`);
        continue;
      }
      if (f.id) idCounts.set(f.id, (idCounts.get(f.id) || 0) + 1);
      if (!f.selectors.unique) {
        nonUnique.push(`state ${s.seq}: \`${cell(mapKey(f))}\` — \`${cell(f.selectors.primary)}\`${f.selectors.uniqueInForm ? ' (unique within its form)' : ''}`);
      }
    }
    for (const b of s.buttons) if (b.id) idCounts.set(b.id, (idCounts.get(b.id) || 0) + 1);
    for (const [id, n] of idCounts) if (n > 1) dupIds.push(`state ${s.seq} (\`${cell(s.pathname)}\`): \`#${cell(id)}\` appears ${n} times`);
  }
  section(out, `Non-unique primary selectors (${nonUnique.length})`, dedupe(nonUnique));
  section(out, `Duplicate ids on a page (${dedupe(dupIds).length})`, dedupe(dupIds));
  section(out, `Credential-shaped controls, structure only (${dedupe(redacted).length})`, dedupe(redacted));

  const dangerButtons = new Set();
  for (const s of states) for (const b of s.buttons) if (b.danger) dangerButtons.add(b.text);
  section(out, `Buttons the downstream tool must never activate (${dangerButtons.size})`, Array.from(dangerButtons).map((t) => `"${cell(t)}"`));

  // ---- reminders
  out.push('## Before this leaves the machine');
  out.push('');
  out.push('- `network.har` keeps response bodies because dropdown data, NIC lookups and name checks live in them. They were regex-scrubbed for PAN / DIN / Aadhaar / email / phone / passport shapes only. **Names and addresses are not scrubbed. Read the bodies before sharing.**');
  out.push('- `field-map-draft.json` has `vcfoField: null` on every entry. Filling that column is the human step that turns this capture into the VCFO Assist field map. `altKeys` lists every other identifier the field was seen with.');
  out.push('- `dom/*.html.gz` are gzipped snapshots with values stripped; `gunzip` one to view it in a browser.');
  out.push('- Screenshots of iframe states show the whole tab, not the frame (`screenshotOf: parent-frame` in the state JSON).');
  out.push('- HAR timings are approximate and browser-added request headers are absent; the file is HAR 1.2 shaped for DevTools import, not a wire capture.');
  out.push('');
  return out.join('\n');
}

/**
 * @param {string[]} out
 * @param {string} title
 * @param {string[]} items
 */
function section(out, title, items) {
  out.push(`### ${title}`);
  out.push('');
  if (!items.length) out.push('_none_');
  else for (const it of items.slice(0, 200)) out.push(`- ${it}`);
  if (items.length > 200) out.push(`- … and ${items.length - 200} more`);
  out.push('');
}

/**
 * @param {string[]} items
 * @returns {string[]}
 */
function dedupe(items) {
  return Array.from(new Set(items));
}
