/**
 * State-graph edges — docs/02 "Transitions". Pure functions; the service
 * worker decides what counts as the previous state (same tab, same frame).
 */

/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../../shared/schema.js').AnyFieldRecord} AnyFieldRecord */
/** @typedef {import('../../shared/schema.js').NetEntry} NetEntry */
/** @typedef {import('../../shared/schema.js').Transition} Transition */
/** @typedef {import('../../shared/schema.js').OptionsChange} OptionsChange */

/**
 * Same identity rule as content/lib/fields.js `fieldKey` — duplicated because
 * the content world cannot export it.
 * @param {AnyFieldRecord} f
 * @returns {string}
 */
export function fieldKey(f) {
  if ('redactedEntirely' in f) return f.label || `${f.type}@${f.index}`;
  return f.id || f.name || f.formControlName || f.label || `${f.type}@${f.index}`;
}

/**
 * Fields keyed by identity. Duplicate keys (three buttons sharing an id is the
 * documented example) keep the first occurrence.
 * @param {StateRecord} s
 * @returns {Map<string, AnyFieldRecord>}
 */
export function fieldIndex(s) {
  const m = new Map();
  for (const f of s.fields) {
    const k = fieldKey(f);
    if (!m.has(k)) m.set(k, f);
  }
  return m;
}

/**
 * @param {StateRecord} from
 * @param {StateRecord} to
 * @param {NetEntry[]} netBetween   entries attributed to `from` before `to` landed
 * @returns {Transition}
 */
export function buildTransition(from, to, netBetween) {
  const a = fieldIndex(from);
  const b = fieldIndex(to);

  /** @type {string[]} */
  const fieldsAdded = [];
  /** @type {string[]} */
  const fieldsRemoved = [];
  /** @type {OptionsChange[]} */
  const optionsChanged = [];

  for (const k of b.keys()) if (!a.has(k)) fieldsAdded.push(k);
  for (const k of a.keys()) if (!b.has(k)) fieldsRemoved.push(k);

  for (const [k, fb] of b) {
    const fa = a.get(k);
    if (!fa || 'redactedEntirely' in fa || 'redactedEntirely' in fb) continue;
    if (!fa.options && !fb.options) continue;
    if (JSON.stringify(fa.options) !== JSON.stringify(fb.options)) {
      optionsChanged.push({ fieldId: k, before: fa.options, after: fb.options });
    }
  }

  const prevErrors = new Set(from.errors);
  const errorsAppeared = to.errors.filter((e) => !prevErrors.has(e));

  return {
    from: from.id,
    to: to.id,
    trigger: to.trigger,
    urlChanged: from.url !== to.url,
    fieldsAdded,
    fieldsRemoved,
    optionsChanged,
    netCallsBetween: netBetween.map((n) => n.id),
    errorsAppeared,
  };
}
