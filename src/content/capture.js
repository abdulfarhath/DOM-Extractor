/* Orchestrator — docs/02. Debounces triggers, builds a StateDraft, dedupes by
   signature, snapshots the DOM and hands everything to the service worker.
   Loaded last; assumes every window.__MCADC lib is present.
   Classic script: no imports. */
(() => {
  const ns = /** @type {MCADCNamespace} */ (window.__MCADC);
  if (!ns || !ns.fields || !ns.observe || !ns.domSnapshot || !ns.redact) return;

  // Mirrors src/shared/constants.js — content scripts cannot import it.
  const MSG = {
    STATE_CAPTURED: 'mcadc:state-captured',
    NET_ENTRY: 'mcadc:net-entry',
    GET_FLAGS: 'mcadc:get-flags',
    CAPTURE_NOW: 'mcadc:capture-now',
  };
  const META_KEY = 'dc:meta';
  const DEBOUNCE_MS = 900;
  const CAPS = { HEADINGS: 40, STEPS: 40, BUTTONS: 60, ERRORS: 20, NOTICES: 10, TEXT: 120 };
  const DANGER_RE = /submit|pay|confirm|delete|final/i;

  const SEL = {
    headings: 'h1, h2, h3, h4, legend, .panel-title, .section-title',
    steps: '[role="tab"], .nav-tabs li, .mat-tab-label, .step-title, .wizard-step, .breadcrumb li',
    buttons: 'button, input[type="submit"], input[type="button"], a.btn, [role="button"]',
    errors: '.error, .invalid-feedback, .text-danger, mat-error, .alert-danger, .validation-message',
    notices: '.alert, .info, .note',
  };

  /** Recording flag mirrored from dc:meta. The service worker owns it. */
  let recording = true;
  let lastSignature = '';
  let lastErrorsKey = '';
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null;
  /** @type {string} */
  let pendingTrigger = '';
  let pendingAt = '';
  /** Every trigger in the current burst, consecutive repeats collapsed (Q11). */
  /** @type {Array<{ t: string, n: number }>} */
  let burst = [];
  const BURST_MAX = 60;
  let forceNext = false;
  /** Serialises captures so a slow gzip never overlaps the next one. */
  let chain = Promise.resolve();

  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };

  /**
   * @param {unknown} msg
   * @returns {Promise<any>}
   */
  const send = (msg) =>
    new Promise((resolve) => {
      if (!alive()) return resolve(undefined);
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          void chrome.runtime.lastError; // extension reloaded mid-flight; nothing to do
          resolve(r);
        });
      } catch {
        resolve(undefined);
      }
    });

  // -------------------------------------------------------- page-level bits

  /**
   * @param {string} selector
   * @param {number} cap
   * @param {boolean} visibleOnly
   * @returns {string[]}
   */
  const textList = (selector, cap, visibleOnly) => {
    /** @type {string[]} */
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll(selector)) {
      if (visibleOnly && !ns.fields.isVisible(el)) continue;
      const t = ns.redact.scrubText(ns.labels.cleanText(/** @type {HTMLElement} */ (el).innerText, CAPS.TEXT));
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= cap) break;
    }
    return out;
  };

  /** @returns {StepRecord[]} */
  const collectSteps = () => {
    /** @type {StepRecord[]} */
    const out = [];
    for (const el of document.querySelectorAll(SEL.steps)) {
      const text = ns.labels.cleanText(/** @type {HTMLElement} */ (el).innerText, 80);
      if (!text) continue;
      const cls = typeof el.className === 'string' ? el.className : '';
      const active =
        /(^|\s)(active|current|selected|mat-tab-label-active)(\s|$)/.test(cls) ||
        el.getAttribute('aria-selected') === 'true' ||
        el.getAttribute('aria-current') != null;
      out.push({ text, active });
      if (out.length >= CAPS.STEPS) break;
    }
    return out;
  };

  /** @returns {ButtonRecord[]} */
  const collectButtons = () => {
    /** @type {ButtonRecord[]} */
    const out = [];
    for (const el of document.querySelectorAll(SEL.buttons)) {
      const b = /** @type {HTMLElement & { value?: string, disabled?: boolean }} */ (el);
      const text = ns.labels.cleanText(b.innerText || b.value || b.getAttribute('aria-label'), 60);
      if (!text) continue;
      out.push({
        text,
        id: b.id || '',
        classes: (typeof b.className === 'string' ? b.className : '').slice(0, 120),
        disabled: !!b.disabled || b.getAttribute('aria-disabled') === 'true',
        visible: ns.fields.isVisible(b),
        danger: DANGER_RE.test(text),
      });
      if (out.length >= CAPS.BUTTONS) break;
    }
    return out;
  };

  /**
   * @param {string} trigger
   * @param {string} triggerTimestamp
   * @param {string[]} triggers
   * @returns {StateDraft}
   */
  const buildDraft = (trigger, triggerTimestamp, triggers) => {
    const fields = ns.fields.collectControls(document).map((el, i) => ns.fields.describeField(el, i));
    const inIframe = window.top !== window.self;
    const signature = [location.pathname, document.title, fields.map(ns.fields.fieldKey).join('|')].join('::');
    return {
      capturedAt: new Date().toISOString(),
      trigger,
      triggerTimestamp,
      triggers,
      url: location.href.split('?')[0].split('#')[0],
      pathname: location.pathname,
      title: document.title,
      inIframe,
      frameSrc: inIframe ? location.href.split('?')[0] : null,
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
      signature,
      headings: textList(SEL.headings, CAPS.HEADINGS, false),
      steps: collectSteps(),
      buttons: collectButtons(),
      errors: textList(SEL.errors, CAPS.ERRORS, true),
      notices: textList(SEL.notices, CAPS.NOTICES, true),
      fieldCount: fields.length,
      fields,
    };
  };

  // ---------------------------------------------------------------- capture

  const capture = async () => {
    const trigger = pendingTrigger || 'dom-change';
    const at = pendingAt || new Date().toISOString();
    const triggers = burst.map((b) => (b.n > 1 ? `${b.t} (x${b.n})` : b.t));
    const force = forceNext;
    pendingTrigger = '';
    pendingAt = '';
    burst = [];
    forceNext = false;

    if (!recording || !alive()) return;

    /** @type {StateDraft} */
    let draft;
    try {
      draft = buildDraft(trigger, at, triggers);
    } catch {
      return;
    }

    // Errors are not in the signature by spec, but a validation failure that
    // adds no fields still deserves a state (docs/07 asks for it). See Q9.
    const errorsKey = draft.errors.join(' | ');
    if (!force && draft.signature === lastSignature && errorsKey === lastErrorsKey) return;
    lastSignature = draft.signature;
    lastErrorsKey = errorsKey;

    const dom = await ns.domSnapshot.snapshot();
    await send({ type: MSG.STATE_CAPTURED, draft, dom });
  };

  /**
   * @param {string} trigger
   */
  const schedule = (trigger) => {
    // First user-originated trigger in a burst wins; dom-change only fills a gap.
    if (!pendingTrigger || pendingTrigger === 'dom-change') {
      pendingTrigger = trigger;
      pendingAt = new Date().toISOString();
    }
    const last = burst[burst.length - 1];
    if (last && last.t === trigger) last.n++;
    else if (burst.length < BURST_MAX) burst.push({ t: trigger, n: 1 });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      chain = chain.then(capture).catch(() => {});
    }, DEBOUNCE_MS);
  };

  // ------------------------------------------------------------- plumbing

  // Net entries from the MAIN-world hook: scrub, then forward.
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.__mcadc !== 'net') return;
    if (!recording) return;
    /** @type {NetDraft} */
    const entry = ev.data.entry;
    if (!entry || typeof entry.url !== 'string') return;
    entry.requestBody = ns.redact.scrubBody(entry.requestBody);
    entry.responseBody = ns.redact.scrubBody(entry.responseBody);
    entry.url = ns.redact.scrubText(entry.url);
    void send({ type: MSG.NET_ENTRY, entry });
  });

  // Manual capture from the side panel, relayed by the service worker.
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === MSG.CAPTURE_NOW) {
        forceNext = true;
        schedule('manual');
        sendResponse({ ok: true });
      }
      return false;
    });
  } catch {
    /* context invalidated */
  }

  // Pause/resume: the worker writes dc:meta; we mirror the flag.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[META_KEY]) return;
      const meta = changes[META_KEY].newValue;
      if (meta && typeof meta.recording === 'boolean') recording = meta.recording;
    });
  } catch {
    /* ignore */
  }

  send({ type: MSG.GET_FLAGS }).then((flags) => {
    if (flags && typeof flags.recording === 'boolean') recording = flags.recording;
    ns.observe.start(schedule);
  });
})();
