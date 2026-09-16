/**
 * Dependent-dropdown detection — docs/02. A `change:<field>` trigger followed
 * within the window by a network call or an options change on another field.
 */
import { TIMING } from '../../shared/constants.js';

/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../../shared/schema.js').NetEntry} NetEntry */
/** @typedef {import('../../shared/schema.js').Transition} Transition */
/** @typedef {import('../../shared/schema.js').Dependency} Dependency */

/**
 * @param {string} url
 * @returns {string}
 */
function endpointOf(url) {
  try {
    const u = new URL(url);
    return u.pathname;
  } catch {
    return url;
  }
}

/**
 * @param {StateRecord} state       the state that carries the change trigger
 * @param {Transition} transition   edge into `state`
 * @param {NetEntry[]} netBetween   entries between the previous state and this one
 * @returns {Dependency|null}
 */
export function detectDependency(state, transition, netBetween) {
  if (!state.trigger.startsWith('change:')) return null;
  const sourceField = state.trigger.slice('change:'.length);
  if (!sourceField) return null;

  const t0 = Date.parse(state.triggerTimestamp);
  const t1 = t0 + TIMING.DEPENDENCY_WINDOW_MS;
  const netInWindow = Number.isFinite(t0)
    ? netBetween.filter((n) => {
        const t = Date.parse(n.startedAt);
        return Number.isFinite(t) && t >= t0 - 50 && t <= t1;
      })
    : netBetween;

  const targetFields = transition.optionsChanged.map((c) => c.fieldId).filter((k) => k !== sourceField);
  if (!netInWindow.length && !targetFields.length) return null;

  /** @type {Dependency} */
  const dep = {
    sourceField,
    targetFields,
    viaNetwork: netInWindow.length > 0,
    confidence: netInWindow.length > 0 ? 'high' : 'medium',
    stateId: state.id,
  };
  if (netInWindow.length) dep.endpoint = endpointOf(netInWindow[0].url);
  return dep;
}

/**
 * @param {Dependency[]} existing
 * @param {Dependency} d
 * @returns {boolean}
 */
export function isDuplicateDependency(existing, d) {
  /** @param {Dependency} x */
  const key = (x) => `${x.sourceField}|${[...x.targetFields].sort().join(',')}|${x.endpoint || ''}`;
  const k = key(d);
  return existing.some((e) => key(e) === k);
}
