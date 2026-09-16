/**
 * Dependent-control detection — docs/02. A `change:<key>` trigger followed
 * within the window by a network call or an options change on another
 * control. Custom listboxes already arrive as `change:` (observe.js, Q17).
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
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * @param {StateRecord} state       the state carrying the change trigger
 * @param {Transition} transition   edge into `state`
 * @param {NetEntry[]} netBetween   entries between the previous state and this one
 * @returns {Dependency|null}
 */
export function detectDependency(state, transition, netBetween) {
  if (!state.trigger.startsWith('change:')) return null;
  const sourceKey = state.trigger.slice('change:'.length);
  if (!sourceKey) return null;

  const t0 = Date.parse(state.triggerAt);
  const t1 = t0 + TIMING.DEPENDENCY_WINDOW_MS;
  const netInWindow = Number.isFinite(t0)
    ? netBetween.filter((n) => {
        const t = Date.parse(n.startedAt);
        return Number.isFinite(t) && t >= t0 - 50 && t <= t1;
      })
    : netBetween;

  const targetKeys = transition.optionsChanged.map((c) => c.key).filter((k) => k !== sourceKey);
  if (!netInWindow.length && !targetKeys.length) return null;

  /** @type {Dependency} */
  const dep = {
    sourceKey,
    targetKeys,
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
  const key = (x) => `${x.sourceKey}|${[...x.targetKeys].sort().join(',')}|${x.endpoint || ''}`;
  const k = key(d);
  return existing.some((e) => key(e) === k);
}
