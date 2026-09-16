/* Orchestrator — docs/02, docs/05 rule 1, docs/10 A2/A3. Consent gate first:
   nothing below the gate runs, and no listener is installed, unless the
   worker says this origin is consented. Then: debounce triggers, rate-cap
   captures, build a StateDraft, dedupe by signature (+ errors), snapshot the
   DOM and hand everything to the worker.
   Loaded last; assumes every window.__FP lib is present. Classic script. */
(() => {
  const ns = /** @type {FPNamespace} */ (window.__FP);
  if (!ns || !ns.fields || !ns.observe || !ns.domSnapshot || !ns.redact || !ns.lists || !ns.framework) return;

  // Mirrors src/shared/constants.js — content scripts cannot import it.
  const MSG = {
    GATE_CHECK: 'fp:gate-check',
    STATE_CAPTURED: 'fp:state-captured',
    NET_ENTRY: 'fp:net-entry',
    FRAME_BLOCKED: 'fp:frame-blocked',
    THROTTLED: 'fp:throttled',
    CAPTURE_NOW: 'fp:capture-now',
  };
  const META_KEY = 'fp:meta';
  const ORIGINS_KEY = 'fp:origins';
  const DEBOUNCE_MS = 900;
  const MIN_STATE_GAP_MS = 2000;
  const CAPS = { HEADINGS: 40, STEPS: 40, BUTTONS: 60, ERRORS: 20, NOTICES: 10, TEXT: 120, BURST: 60 };

  const SEL = {
    headings: 'h1, h2, h3, h4, legend, [class*="title"], [class*="heading"]',
    steps: '[role="tab"], [role="tablist"] > *, .nav-tabs li, [class*="step"], [class*="wizard"], .breadcrumb li',
    buttons: 'button, input[type="submit"], input[type="button"], input[type="reset"], a.btn, [role="button"]',
    errors: '[class*="error"], [class*="invalid"], [class*="danger"], [role="alert"], mat-error',
    notices: '[class*="alert"], [class*="info"], [class*="note"]',
    auth: 'a[href], button, [role="button"]',
  };
  const LOGOUT_RE = /log.?out|sign.?out|logout|signout|abmelden|d[ée]connexion|cerrar sesi[oó]n|sair/i;
  const LOGIN_RE = /log.?in|sign.?in|login|signin|anmelden|connexion|iniciar sesi[oó]n|entrar/i;

  const origin = location.origin;
  const inIframe = window.top !== window.self;

  /** @type {string[]} */
  let dangerWords = ['submit', 'pay', 'confirm', 'delete', 'remove', 'final'];
  let dangerRe = /submit|pay|confirm|delete|remove|final/i;
  let recording = true;
  let consented = false;
  let lastSignature = '';
  let lastErrorsKey = '';
  let lastStoredAt = 0;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null;
  let pendingTrigger = '';
  let pendingAt = '';
  /** @type {Array<{ t: string, n: number }>} */
  let burst = [];
  let forceNext = false;
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
          void chrome.runtime.lastError;
          resolve(r);
        });
      } catch {
        resolve(undefined);
      }
    });

  /**
   * @param {string[]} words
   */
  const setDangerWords = (words) => {
    dangerWords = words.filter((w) => typeof w === 'string' && w.trim()).map((w) => w.trim());
    const esc = dangerWords.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    dangerRe = esc.length ? new RegExp(esc.join('|'), 'i') : /$^/;
  };

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
    for (const el of ns.fields.queryDeep(document, selector)) {
      if (visibleOnly && !ns.fields.isVisible(el)) continue;
      const t = ns.redact.scrubText(ns.labels.textOf(el, CAPS.TEXT));
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
    const seen = new Set();
    for (const el of ns.fields.queryDeep(document, SEL.steps)) {
      const text = ns.redact.scrubText(ns.labels.textOf(el, 80));
      if (!text || seen.has(text)) continue;
      seen.add(text);
      const cls = typeof el.className === 'string' ? el.className : '';
      const active =
        /(^|\s)(active|current|selected|mat-tab-label-active|is-active)(\s|$)/.test(cls) ||
        el.getAttribute('aria-selected') === 'true' ||
        el.getAttribute('aria-current') != null;
      out.push({ text, active });
      if (out.length >= CAPS.STEPS) break;
    }
    return out;
  };

  /**
   * A button is dangerous when it submits (by type or by being the default
   * button of a form), or its text matches the configurable word list.
   * @returns {ButtonRecord[]}
   */
  const collectButtons = () => {
    /** @type {ButtonRecord[]} */
    const out = [];
    for (const el of ns.fields.queryDeep(document, SEL.buttons)) {
      const b = /** @type {HTMLElement & { value?: string, disabled?: boolean }} */ (el);
      const text = ns.redact.scrubText(ns.labels.cleanText(b.innerText || b.value || b.getAttribute('aria-label') || b.getAttribute('title'), 60));
      if (!text) continue;
      const tag = b.tagName.toLowerCase();
      const typeAttr = (b.getAttribute('type') || '').toLowerCase();
      const type = typeAttr || (tag === 'button' ? 'submit' : tag === 'a' ? 'link' : 'button');
      const inForm = !!b.closest('form');
      const submits = type === 'submit' && (tag === 'input' || tag === 'button') && inForm;
      out.push({
        text,
        id: b.id || '',
        classes: (typeof b.className === 'string' ? b.className : '').slice(0, 120),
        type,
        disabled: !!b.disabled || b.getAttribute('aria-disabled') === 'true',
        visible: ns.fields.isVisible(b),
        danger: submits || dangerRe.test(text),
        selector: ns.selectors.forElement(b),
      });
      if (out.length >= CAPS.BUTTONS) break;
    }
    return out;
  };

  /**
   * Crude logged-in signal from affordance text and hrefs. Text only.
   * @returns {AuthHints}
   */
  const collectAuthHints = () => {
    let login = '';
    let logout = '';
    for (const el of ns.fields.queryDeep(document, SEL.auth)) {
      const probe = `${ns.labels.textOf(el, 60)} ${el.getAttribute('href') || ''}`;
      if (!logout && LOGOUT_RE.test(probe)) logout = ns.labels.textOf(el, 40) || el.getAttribute('href') || 'logout link';
      else if (!login && LOGIN_RE.test(probe)) login = ns.labels.textOf(el, 40) || el.getAttribute('href') || 'login link';
      if (login && logout) break;
    }
    if (logout && !login) return { loggedIn: true, evidence: `logout affordance: ${ns.redact.scrubText(logout)}` };
    if (login && !logout) return { loggedIn: false, evidence: `login affordance: ${ns.redact.scrubText(login)}` };
    if (login && logout) return { loggedIn: null, evidence: 'both login and logout affordances present' };
    return { loggedIn: null, evidence: 'no auth affordance found' };
  };

  /**
   * @param {string} trigger
   * @param {string} triggerAt
   * @param {string[]} triggers
   * @returns {StateDraft}
   */
  const buildDraft = (trigger, triggerAt, triggers) => {
    const framework = ns.framework.detect();
    const controls = ns.fields.collectControls(document).map((el, i) => ns.fields.describeControl(el, i, framework));
    const signature = [location.pathname, document.title, controls.map((c) => c.key).join('|')].join('::');
    return {
      capturedAt: new Date().toISOString(),
      trigger,
      triggerAt,
      triggers,
      origin,
      url: location.href.split('?')[0].split('#')[0],
      pathname: location.pathname,
      title: document.title,
      lang: document.documentElement.lang || '',
      inIframe,
      frameSrc: inIframe ? location.href.split('?')[0] : null,
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
      framework,
      signature,
      headings: textList(SEL.headings, CAPS.HEADINGS, false),
      steps: collectSteps(),
      buttons: collectButtons(),
      errors: textList(SEL.errors, CAPS.ERRORS, true),
      notices: textList(SEL.notices, CAPS.NOTICES, true),
      authHints: collectAuthHints(),
      controlCount: controls.length,
      controls,
      lists: ns.lists.collect(document),
      usesShadowDom: ns.fields.hasShadowRoots(document),
      opaqueRegions: ns.fields.findOpaque(document),
      captureDegraded: ns.observe.degraded(),
    };
  };

  // ---------------------------------------------------------------- capture

  const capture = async () => {
    if (!consented || !recording || !alive()) {
      pendingTrigger = '';
      pendingAt = '';
      burst = [];
      forceNext = false;
      return;
    }
    // A2 rate cap: one stored state per document per 2s; manual is exempt.
    const wait = MIN_STATE_GAP_MS - (Date.now() - lastStoredAt);
    if (wait > 0 && pendingTrigger !== 'manual') {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, wait);
      return;
    }

    const trigger = pendingTrigger || 'dom-change';
    const at = pendingAt || new Date().toISOString();
    const triggers = burst.map((b) => (b.n > 1 ? `${b.t} (x${b.n})` : b.t));
    const force = forceNext;
    pendingTrigger = '';
    pendingAt = '';
    burst = [];
    forceNext = false;

    /** @type {StateDraft} */
    let draft;
    try {
      draft = buildDraft(trigger, at, triggers);
    } catch {
      return;
    }

    const errorsKey = draft.errors.join(' | ');
    if (!force && draft.signature === lastSignature && errorsKey === lastErrorsKey) return;
    lastSignature = draft.signature;
    lastErrorsKey = errorsKey;
    lastStoredAt = Date.now();

    const dom = await ns.domSnapshot.snapshot();
    await send({ type: MSG.STATE_CAPTURED, draft, dom });
  };

  const fire = () => {
    timer = null;
    chain = chain.then(capture).catch(() => {});
  };

  /**
   * @param {string} trigger
   */
  const schedule = (trigger) => {
    if (!consented) return;
    // First user-originated trigger in a burst wins; dom-change only fills a gap.
    if (!pendingTrigger || pendingTrigger === 'dom-change') {
      pendingTrigger = trigger;
      pendingAt = new Date().toISOString();
    }
    const last = burst[burst.length - 1];
    if (last && last.t === trigger) last.n++;
    else if (burst.length < CAPS.BURST) burst.push({ t: trigger, n: 1 });
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, DEBOUNCE_MS);
  };

  // ------------------------------------------------------------- plumbing

  const installListeners = () => {
    // Net entries and framework answers from the MAIN-world hook.
    window.addEventListener('message', (ev) => {
      if (ev.source !== window || !ev.data || typeof ev.data.__fp !== 'string') return;
      if (ev.data.__fp === 'framework') {
        ns.framework.mergeMainWorld(ev.data.info || {});
        return;
      }
      if (ev.data.__fp !== 'net' || !recording) return;
      /** @type {NetDraft} */
      const entry = ev.data.entry;
      if (!entry || typeof entry.url !== 'string') return;
      entry.requestBody = ns.redact.scrubBody(entry.requestBody);
      entry.responseBody = ns.redact.scrubBody(entry.responseBody);
      entry.url = ns.redact.scrubText(entry.url);
      for (const h of entry.requestHeaders || []) h.value = ns.redact.scrubText(h.value);
      for (const h of entry.responseHeaders || []) h.value = ns.redact.scrubText(h.value);
      void send({ type: MSG.NET_ENTRY, entry });
    });

    // Manual capture from the side panel, relayed by the worker.
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

    // The worker owns the flags; we mirror them. Removing this origin from
    // the allow-list stops everything at once (docs/05 rule 1).
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes[META_KEY]) {
          const meta = changes[META_KEY].newValue;
          if (meta) {
            if (typeof meta.recording === 'boolean') recording = meta.recording;
            if (Array.isArray(meta.dangerWords)) setDangerWords(meta.dangerWords);
            if (Array.isArray(meta.packs)) ns.redact.setPacks(meta.packs);
          }
        }
        if (changes[ORIGINS_KEY]) {
          const list = changes[ORIGINS_KEY].newValue;
          if (!Array.isArray(list) || !list.includes(origin)) {
            consented = false;
            ns.observe.stop();
            if (timer) clearTimeout(timer);
            timer = null;
          }
        }
      });
    } catch {
      /* ignore */
    }

    ns.observe.start({
      onTrigger: schedule,
      onThrottle: (until) => void send({ type: MSG.THROTTLED, origin, until }),
    });
    // Ask the MAIN world what it can see; the answer merges in when it arrives.
    try {
      window.postMessage({ __fp: 'detect' }, location.origin);
    } catch {
      /* opaque origin */
    }
  };

  // ------------------------------------------------------------------ gate

  send({ type: MSG.GATE_CHECK, origin, inIframe }).then((r) => {
    if (!r || !r.consented) {
      // A3: tell the panel about a blind spot inside a consented page.
      if (r && r.topConsented && inIframe) void send({ type: MSG.FRAME_BLOCKED, origin });
      return;
    }
    consented = true;
    if (typeof r.recording === 'boolean') recording = r.recording;
    if (Array.isArray(r.dangerWords)) setDangerWords(r.dangerWords);
    if (Array.isArray(r.packs)) ns.redact.setPacks(r.packs);
    installListeners();
  });
})();
