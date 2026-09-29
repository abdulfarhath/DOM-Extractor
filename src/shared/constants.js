/**
 * Shared constants for the service worker, side panel and offscreen document.
 *
 * Content scripts cannot import this file (classic scripts, no modules), so the
 * few values they need — message types, the meta/origins keys, debounce — are
 * duplicated inline there with a comment pointing back here. Keep them in sync.
 */

export const TOOL_NAME = 'Flowprint';
export const TOOL_VERSION = '1.1.0';

/** Storage keys. Per-state keys take a suffix: `fp:dom:<stateId>`. */
export const KEYS = Object.freeze({
  ORIGINS: 'fp:origins',
  STATES: 'fp:states',
  NET: 'fp:net',
  META: 'fp:meta',
  TRANSITIONS: 'fp:transitions',
  DEPS: 'fp:deps',
  TABS: 'fp:tabs',
  ACTIONS: 'fp:actions',
  DOWNLOADS: 'fp:downloads',
  NETBODY_PREFIX: 'fp:netbody:',
  QUEUE: 'fp:queue',
  LOCK: 'fp:lock',
  DOM_PREFIX: 'fp:dom:',
  SHOT_PREFIX: 'fp:shots:',
  /** Every key we ever write starts with this; Clear session wipes by prefix. */
  PREFIX: 'fp:',
});

/** Hard caps from docs/01 and docs/02. Oldest entries drop past these. */
export const CAPS = Object.freeze({
  STATES: 500,
  NET: 2500,
  TRANSITIONS: 2500,
  DEPS: 500,
  OPTIONS_PER_SELECT: 60,
  HEADINGS: 40,
  STEPS: 40,
  BUTTONS: 60,
  ERRORS: 20,
  NOTICES: 10,
  TABLES: 20,
  REPEATS: 20,
  SLOTS: 12,
  PAGINATION: 5,
  DOWNLOADS: 40,
  SHADOW_DEPTH: 10,
  REQUEST_BODY_CHARS: 2000,
  RESPONSE_BODY_CHARS: 4000,
  PANEL_ROWS: 60,
  // docs/12
  ACTIONS: 3000,
  DOWNLOAD_LOG: 500,
  MENU_ITEMS: 300,
  VIEW_GROUPS: 30,
  VIEW_OPTIONS: 40,
  NAV_TEXT: 80,
  RESPONSE_READ_CHARS: 2000000,
  FULL_BODY_CHARS: 1000000,
  SHAPE_CHARS: 12000,
  SHAPE_DEPTH: 8,
  SHAPE_KEYS: 80,
  SHAPE_ARRAY_SAMPLE: 25,
  ENUM_MIN_SEEN: 5,
  ENUM_MAX_DISTINCT: 8,
  ENUM_VALUE_CHARS: 40,
  HINTS: 30,
  TIMELINE: 200,
});

export const TIMING = Object.freeze({
  /** Capture debounce after any trigger, ms. */
  CAPTURE_DEBOUNCE_MS: 900,
  /** A2: at most one stored state per document per this many ms (manual exempt). */
  MIN_STATE_GAP_MS: 2000,
  /** A2: mutation records per rolling second before dom-change triggers are cut. */
  MUTATION_BREAKER_PER_SEC: 500,
  /** A2: how long dom-change stays cut once the breaker trips. */
  MUTATION_BREAKER_COOLDOWN_MS: 10000,
  /** Minimum spacing between captureVisibleTab calls, ms. */
  SCREENSHOT_THROTTLE_MS: 600,
  /** Max pending screenshot requests; extras are dropped, never queued. */
  SCREENSHOT_QUEUE_MAX: 3,
  /** A4: queue entries older than this are dropped on worker start. */
  SCREENSHOT_QUEUE_STALE_MS: 30000,
  /** A4: a write lock older than this is considered abandoned. */
  LOCK_STALE_MS: 5000,
  /** Window after a change:<key> trigger in which a follow-on counts as a dependency. */
  DEPENDENCY_WINDOW_MS: 2500,
  /** docs/12 B5: a call belongs to the last action in its tab when it starts within this window. */
  ACTION_NET_WINDOW_MS: 5000,
  /** docs/12 B6: a blob/data download belongs to a consented tab that acted within this window. */
  ACTION_DOWNLOAD_WINDOW_MS: 15000,
  /** docs/12 B9: coverage refresh interval in the panel. */
  COVERAGE_POLL_MS: 5000,
  /** Side panel poll interval. */
  PANEL_POLL_MS: 1500,
  /** Q15: the zip download taking longer than this means a Save dialog is waiting. */
  PROMPT_SUSPECT_MS: 5000,
  /** How long export waits for the zip download to settle. */
  DOWNLOAD_WAIT_MS: 300000,
});

/**
 * Message types. Mirrored inline in src/content/capture.js.
 */
export const MSG = Object.freeze({
  // content → worker
  GATE_CHECK: 'fp:gate-check',
  STATE_CAPTURED: 'fp:state-captured',
  NET_ENTRY: 'fp:net-entry',
  FRAME_BLOCKED: 'fp:frame-blocked',
  THROTTLED: 'fp:throttled',
  ACTION: 'fp:action',
  BLOB_HINT: 'fp:blob-hint',
  WINDOW_OPEN: 'fp:window-open',
  // worker → content
  CAPTURE_NOW: 'fp:capture-now',
  // panel → worker
  GET_STATS: 'fp:get-stats',
  GET_STATES: 'fp:get-states',
  GET_ORIGIN_INFO: 'fp:get-origin-info',
  ADD_ORIGIN: 'fp:add-origin',
  REMOVE_ORIGIN: 'fp:remove-origin',
  SET_RECORDING: 'fp:set-recording',
  SET_SCREENSHOTS: 'fp:set-screenshots',
  SET_DANGER_WORDS: 'fp:set-danger-words',
  SET_PACKS: 'fp:set-packs',
  SET_KEEP_BODIES: 'fp:set-keep-bodies',
  GET_COVERAGE: 'fp:get-coverage',
  EXPORT: 'fp:export',
  CLEAR: 'fp:clear',
  // worker ↔ offscreen (export zip)
  OFFSCREEN_ZIP_RESET: 'fp:offscreen-zip-reset',
  OFFSCREEN_ZIP_ADD: 'fp:offscreen-zip-add',
  OFFSCREEN_ZIP_FINISH: 'fp:offscreen-zip-finish',
  OFFSCREEN_REVOKE: 'fp:offscreen-revoke',
});

/** Default danger words; user-editable in the panel's Advanced block. */
export const DEFAULT_DANGER_WORDS = Object.freeze(['submit', 'pay', 'confirm', 'delete', 'remove', 'final']);

/** Redaction packs. `generic` is always on; `india` auto-enables on `.in` hosts. */
export const PACKS = Object.freeze({
  ALWAYS_ON: Object.freeze(['generic']),
  /** host suffix → pack name */
  AUTO_BY_HOST: Object.freeze({ '.in': 'india' }),
  ALL: Object.freeze(['generic', 'india']),
});

/** Anchors whose href ends in one of these are recorded as downloads. */
export const DOCUMENT_EXTENSIONS = Object.freeze([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'zip', 'txt', 'json', 'xml', 'rtf', 'odt', 'ods',
]);
