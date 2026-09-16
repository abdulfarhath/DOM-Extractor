/**
 * Shared constants for the service worker and side panel.
 *
 * Content scripts cannot import this file (classic scripts, no modules), so the
 * handful of values they need — message types, the meta key, debounce — are
 * duplicated inline there. Keep the two in sync; the content-side copies are
 * marked with a comment pointing back here.
 */

export const TOOL_NAME = 'MCA DOM Capturer';
export const TOOL_VERSION = '1.0.0';

/** Storage keys. Per-state keys take a suffix: `dc:dom:<stateId>`. */
export const KEYS = Object.freeze({
  STATES: 'dc:states',
  NET: 'dc:net',
  META: 'dc:meta',
  TRANSITIONS: 'dc:transitions',
  DEPS: 'dc:deps',
  TABS: 'dc:tabs',
  DOM_PREFIX: 'dc:dom:',
  SHOT_PREFIX: 'dc:shots:',
  /** Every key we ever write starts with this; Clear session wipes by prefix. */
  PREFIX: 'dc:',
});

/** Hard caps from docs/01 and docs/02. Oldest entries are dropped past these. */
export const CAPS = Object.freeze({
  STATES: 400,
  NET: 2000,
  TRANSITIONS: 2000,
  DEPS: 500,
  OPTIONS_PER_SELECT: 60,
  HEADINGS: 40,
  STEPS: 40,
  BUTTONS: 60,
  ERRORS: 20,
  NOTICES: 10,
  REQUEST_BODY_CHARS: 2000,
  RESPONSE_BODY_CHARS: 4000,
  PANEL_ROWS: 60,
});

export const TIMING = Object.freeze({
  /** Capture debounce after any trigger, ms. */
  CAPTURE_DEBOUNCE_MS: 900,
  /** Minimum spacing between captureVisibleTab calls, ms. */
  SCREENSHOT_THROTTLE_MS: 600,
  /** Max pending screenshot requests; extras are dropped, never queued. */
  SCREENSHOT_QUEUE_MAX: 3,
  /** Window after a change:<field> trigger in which a follow-on counts as a dependency. */
  DEPENDENCY_WINDOW_MS: 2500,
  /** Side panel poll interval. */
  PANEL_POLL_MS: 1500,
  /** Gap between sequential chrome.downloads calls during export. */
  EXPORT_FILE_GAP_MS: 150,
});

/**
 * Message types. Content → SW, panel → SW, and SW → content (CAPTURE_NOW).
 * Mirrored inline in src/content/capture.js.
 */
export const MSG = Object.freeze({
  STATE_CAPTURED: 'mcadc:state-captured',
  NET_ENTRY: 'mcadc:net-entry',
  GET_FLAGS: 'mcadc:get-flags',
  CAPTURE_NOW: 'mcadc:capture-now',
  GET_STATS: 'mcadc:get-stats',
  GET_STATES: 'mcadc:get-states',
  SET_RECORDING: 'mcadc:set-recording',
  SET_SCREENSHOTS: 'mcadc:set-screenshots',
  EXPORT: 'mcadc:export',
  CLEAR: 'mcadc:clear',
});

/** Button text that the downstream tool must never activate. */
export const DANGER_BUTTON_RE = /submit|pay|confirm|delete|final/i;

/** Origins the extension is allowed to run on. Mirrors manifest host_permissions. */
export const ALLOWED_ORIGINS = Object.freeze(['https://www.mca.gov.in', 'https://mca.gov.in']);
