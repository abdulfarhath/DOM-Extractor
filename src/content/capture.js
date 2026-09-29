/* Orchestrator — docs/02, docs/05 rule 1, docs/10 A2/A3, docs/12. Consent gate
   first: nothing below the gate runs, and no listener is installed, unless the
   worker says this origin is consented. Then: debounce triggers, rate-cap
   captures, build a StateDraft, dedupe by signature (+ errors), snapshot the
   DOM and hand everything to the worker. Actions (B4) bypass the debounce:
   they go to the worker the moment they happen. Net entries, blob and
   window-open hints from the MAIN world are scrubbed here and relayed.
   Loaded last; assumes every window.__FP lib is present. Classic script. */
(() => {
  const ns = /** @type {FPNamespace} */ (window.__FP);
  if (!ns || !ns.fields || !ns.observe || !ns.domSnapshot || !ns.redact || !ns.lists || !ns.framework || !ns.nav) return;

  // Mirrors src/shared/constants.js — content scripts cannot import it.
  const MSG = {
    GATE_CHECK: 'fp:gate-check',
    STATE_CAPTURED: 'fp:state-captured',
    NET_ENTRY: 'fp:net-entry',
    FRAME_BLOCKED: 'fp:frame-blocked',
    THROTTLED: 'fp:throttled',
    ACTION: 'fp:action',
    BLOB_HINT: 'fp:blob-hint',
    WINDOW_OPEN: 'fp:window-open',
    CAPTURE_NOW: 'fp:capture-now',
  };
  const META_KEY = 'fp:meta';
  const ORIGINS_KEY = 'fp:origins';
  const DEBOUNCE_MS = 900;
  const MIN_STATE_GAP_MS = 2000;
  /**
   * The debounce restarts on every trigger, and some pages never stop
   * mutating (spinners, carousels, polling widgets). Without a ceiling one
   * burst swallowed a 34-second walk through four pages. A burst fires at
   * most this long after it began, or after the route last changed.
   */
  const MAX_BURST_MS = 3000;
  const CAPS = { HEADINGS: 40, STEPS: 40, BUTTONS: 60, ERRORS: 20, NOTICES: 10, TEXT: 120, BURST: 60, SHAPE_DEPTH: 8, SHAPE_KEYS: 80, ENUM_VALUES: 8, MIME: 120 };
  const MEDIA_MIME_RE = /^(image|video|audio)\//i;
  const SHAPE_TYPES = new Set(['object', 'array', 'string', 'number', 'boolean', 'null', 'mixed', 'truncated']);
  const SHAPE_FORMATS = new Set(['date', 'datetime', 'numeric', 'url', 'email', 'uuid', 'boolean', 'text']);

  const SEL = {
    headings: 'h1, h2, h3, h4, legend, [class*="title"], [class*="heading"]',
    steps: '[role="tab"], [role="tablist"] > *, .nav-tabs li, [class*="step"], [class*="wizard"], .breadcrumb li',
    buttons: 'button, input[type="submit"], input[type="button"], input[type="reset"], a.btn, [role="button"]',
    errors: '[class*="error"], [class*="invalid"], [class*="danger"], [role="alert"], mat-error',
    notices: '[class*="alert"], [class*="info"], [class*="note"]',
    auth: 'a[href], button, [role="button"]',
  };
  /** Path-segment conventions; code, not UI language. */
  const LOGOUT_PATH_RE = /(^|[/?#_-])(logout|signout|sign-out|log-out)([/?#_-]|$)/i;
  const LOGIN_PATH_RE = /(^|[/?#_-])(login|signin|sign-in|log-in|auth)([/?#_-]|$)/i;
  /** English affordance text — last resort, low confidence. */
  const LOGOUT_TEXT_RE = /\b(log ?out|sign ?out)\b/i;
  const LOGIN_TEXT_RE = /\b(log ?in|sign ?in)\b/i;

  const origin = location.origin;
  const inIframe = window.top !== window.self;

  /** @type {string[]} */
  let dangerWords = ['submit', 'pay', 'confirm', 'delete', 'remove', 'final'];
  /**
   * Whole words only, in any script: "Pay" and "Pay now" match, "Payments"
   * and "Submitted" do not. \b is ASCII-only, so the boundaries are
   * Unicode-aware lookarounds on letters and digits.
   * @param {string[]} words
   * @returns {RegExp}
   */
  const wordRe = (words) => {
    const esc = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return esc.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${esc.join('|')})(?![\\p{L}\\p{N}])`, 'iu') : /$^/;
  };
  let dangerRe = wordRe(dangerWords);
  let recording = true;
  let consented = false;
  /** @type {'shape'|'full'} */
  let keepBodies = 'shape';
  let lastSignature = '';
  let lastViewKey = '';
  let lastErrorsKey = '';
  let lastStoredAt = 0;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null;
  let pendingTrigger = '';
  let pendingAt = '';
  let burstStartedAt = 0;
  let burstRoute = '';
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
    dangerRe = wordRe(dangerWords);
  };

  /**
   * One rule for buttons in a state and for actions (docs/12 B4): dangerous
   * when it submits a form — by type, or by being a form's default button —
   * or when its text matches the configurable word list.
   * @param {string} text
   * @param {Element} el
   * @returns {boolean}
   */
  const isDanger = (text, el) => {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase() || (tag === 'button' ? 'submit' : '');
    const submits = type === 'submit' && (tag === 'input' || tag === 'button') && !!el.closest('form');
    return submits || dangerRe.test(text);
  };

  /**
   * docs/12 B5: the MAIN world reads bodies only as far as the user allowed.
   * Sent after the gate and again whenever the setting changes.
   */
  const postConfig = () => {
    try {
      window.postMessage({ __fp: 'config', keepBodies }, location.origin);
    } catch {
      /* opaque origin */
    }
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
      const t = ns.redact.scrubElementText(el, ns.labels.textOf(el, CAPS.TEXT));
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
      const text = ns.redact.scrubElementText(b, ns.labels.cleanText(b.innerText || b.value || b.getAttribute('aria-label') || b.getAttribute('title'), 60));
      if (!text) continue;
      const tag = b.tagName.toLowerCase();
      const typeAttr = (b.getAttribute('type') || '').toLowerCase();
      const type = typeAttr || (tag === 'button' ? 'submit' : tag === 'a' ? 'link' : 'button');
      out.push({
        text,
        id: b.id || '',
        classes: (typeof b.className === 'string' ? b.className : '').slice(0, 120),
        type,
        disabled: !!b.disabled || b.getAttribute('aria-disabled') === 'true',
        visible: ns.fields.isVisible(b),
        danger: isDanger(text, b),
        selector: ns.selectors.forElement(b),
      });
      if (out.length >= CAPS.BUTTONS) break;
    }
    return out;
  };

  /**
   * Q7 — logged-in signal from language-independent evidence first: a
   * password field or credential autocomplete tokens mean a login form is on
   * screen; login/logout segments in the page path or link hrefs point either
   * way; English button text is the last resort at low confidence.
   * @returns {AuthHints}
   */
  const collectAuthHints = () => {
    if (ns.fields.queryDeep(document, 'input[type="password"]').length) {
      return { loggedIn: false, evidence: 'password field present', confidence: 'high' };
    }
    if (ns.fields.queryDeep(document, '[autocomplete="current-password"], [autocomplete="username"], [autocomplete="one-time-code"]').length) {
      return { loggedIn: false, evidence: 'credential autocomplete token present', confidence: 'high' };
    }
    if (LOGOUT_PATH_RE.test(location.pathname)) return { loggedIn: null, evidence: 'page path is a logout route', confidence: 'medium' };
    if (LOGIN_PATH_RE.test(location.pathname)) return { loggedIn: false, evidence: `page path matches login (${location.pathname})`, confidence: 'medium' };

    let loginHref = '';
    let logoutHref = '';
    let loginText = '';
    let logoutText = '';
    for (const el of ns.fields.queryDeep(document, SEL.auth)) {
      const href = el.getAttribute('href') || '';
      let path = '';
      try {
        path = href ? new URL(href, location.href).pathname : '';
      } catch {
        path = href;
      }
      if (!logoutHref && LOGOUT_PATH_RE.test(path)) logoutHref = path;
      else if (!loginHref && LOGIN_PATH_RE.test(path)) loginHref = path;
      if (!logoutText || !loginText) {
        const text = ns.labels.textOf(el, 40);
        if (!logoutText && LOGOUT_TEXT_RE.test(text)) logoutText = text;
        else if (!loginText && LOGIN_TEXT_RE.test(text)) loginText = text;
      }
    }
    if (logoutHref && !loginHref) return { loggedIn: true, evidence: `logout href: ${ns.redact.scrubText(logoutHref)}`, confidence: 'medium' };
    if (loginHref && !logoutHref) return { loggedIn: false, evidence: `login href: ${ns.redact.scrubText(loginHref)}`, confidence: 'medium' };
    if (loginHref && logoutHref) return { loggedIn: null, evidence: 'both login and logout hrefs present', confidence: 'medium' };
    if (logoutText && !loginText) return { loggedIn: true, evidence: `English logout text: "${ns.redact.scrubText(logoutText)}"`, confidence: 'low' };
    if (loginText && !logoutText) return { loggedIn: false, evidence: `English login text: "${ns.redact.scrubText(loginText)}"`, confidence: 'low' };
    if (loginText && logoutText) return { loggedIn: null, evidence: 'both login and logout text present', confidence: 'low' };
    return { loggedIn: null, evidence: 'no auth signal found', confidence: 'low' };
  };

  /**
   * @param {string} trigger
   * @param {string} triggerAt
   * @param {string[]} triggers
   * @returns {StateDraft}
   */
  const buildDraft = (trigger, triggerAt, triggers) => {
    const framework = ns.framework.detect();
    const usesShadowDom = ns.fields.hasShadowRoots(document);
    const controls = ns.fields.collectControls(document).map((el, i) => ns.fields.describeControl(el, i, framework));
    const lists = ns.lists.collect(document);
    const nav = ns.nav.collect(document);
    const view = ns.nav.viewState(nav, lists);
    const route = ns.nav.route();
    // docs/12 B2: the route tells fragment-routed pages apart, the view key
    // tells a paged or re-tabbed list apart from the one before it.
    // docs/12 B3: an open popup menu is a state of its own, so its items —
    // which may exist only while it is open — are stored with it. The part is
    // left off when nothing is open, so ordinary signatures are unchanged.
    const open = ns.nav.openKey();
    const signature = [route, document.title, controls.map((c) => c.key).join('|'), view.key].join('::') + (open ? `::open=${open}` : '');
    lastViewKey = view.key;
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
      lists,
      usesShadowDom,
      orderApproximate: usesShadowDom,
      opaqueRegions: ns.fields.findOpaque(document),
      captureDegraded: ns.observe.degraded(),
      route,
      queryKeys: ns.nav.queryKeys(),
      nav,
      view,
    };
  };

  // ---------------------------------------------------------------- capture

  const capture = async () => {
    if (!consented || !recording || !alive()) {
      pendingTrigger = '';
      pendingAt = '';
      burst = [];
      burstStartedAt = 0;
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
    burstStartedAt = 0;
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
   * @param {ActionDraft} [action]
   */
  const schedule = (trigger, action) => {
    if (!consented) return;
    // docs/12 B4: an action is a fact about the user, not about the page, so
    // it goes out now — whether or not the state it leads to survives dedupe.
    if (action && recording) void send({ type: MSG.ACTION, action });
    // First user-originated trigger in a burst wins; dom-change only fills a gap.
    if (!pendingTrigger || pendingTrigger === 'dom-change') {
      pendingTrigger = trigger;
      pendingAt = new Date().toISOString();
    }
    const last = burst[burst.length - 1];
    if (last && last.t === trigger) last.n++;
    else if (burst.length < CAPS.BURST) burst.push({ t: trigger, n: 1 });
    const now = Date.now();
    let route = '';
    try {
      route = ns.nav.route();
    } catch {
      route = '';
    }
    // A new route is a new page: give it its own settle time, once.
    if (!burstStartedAt || route !== burstRoute) {
      burstStartedAt = now;
      burstRoute = route;
    }
    const delay = Math.max(0, Math.min(DEBOUNCE_MS, burstStartedAt + MAX_BURST_MS - now));
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, delay);
  };

  // -------------------------------------------------- MAIN-world relays
  // Everything the hook posts is page-controllable data: fields are checked
  // for type, scrubbed, and defaulted when an older hook leaves them out.

  /**
   * docs/12 B5. Key names and enum values are the only text in a shape, and
   * both come from the site. Keys are rebuilt because scrubbing can change
   * them; two keys scrubbing to the same name keep a suffix apart.
   * @param {unknown} shape
   * @param {number} depth
   * @returns {JsonShape|null}
   */
  const scrubShape = (shape, depth) => {
    if (!shape || typeof shape !== 'object' || Array.isArray(shape)) return null;
    if (depth > CAPS.SHAPE_DEPTH + 1) return { t: 'truncated' };
    const raw = /** @type {Record<string, unknown>} */ (shape);
    /** @type {JsonShape} */
    const out = { t: SHAPE_TYPES.has(String(raw.t)) ? /** @type {JsonShape['t']} */ (raw.t) : 'mixed' };
    if (raw.nullable === true) out.nullable = true;
    if (typeof raw.len === 'number' && Number.isFinite(raw.len)) out.len = raw.len;
    if (typeof raw.format === 'string' && SHAPE_FORMATS.has(raw.format)) out.format = /** @type {NonNullable<JsonShape['format']>} */ (raw.format);
    if (Array.isArray(raw.values)) {
      /** @type {string[]} */
      const values = [];
      for (const v of raw.values) {
        if (values.length >= CAPS.ENUM_VALUES) break;
        const t = ns.redact.scrubText(String(v));
        if (!values.includes(t)) values.push(t);
      }
      out.values = values;
    }
    if ('item' in raw) out.item = scrubShape(raw.item, depth + 1);
    if (raw.keys && typeof raw.keys === 'object') {
      /** @type {Record<string, JsonShape>} */
      const keys = {};
      /** @type {Map<string, string>} */
      const renamed = new Map();
      let n = 0;
      for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (raw.keys))) {
        if (n++ >= CAPS.SHAPE_KEYS) break;
        const child = scrubShape(v, depth + 1);
        if (!child) continue;
        let name = ns.redact.scrubText(k);
        for (let i = 2; Object.prototype.hasOwnProperty.call(keys, name); i++) name = `${ns.redact.scrubText(k)}#${i}`;
        renamed.set(k, name);
        // defineProperty so a key called `__proto__` stays a key.
        Object.defineProperty(keys, name, { value: child, enumerable: true, writable: true, configurable: true });
      }
      out.keys = keys;
      if (Array.isArray(raw.optional)) out.optional = raw.optional.map((k) => renamed.get(String(k)) || ns.redact.scrubText(String(k))).filter((k, i, a) => a.indexOf(k) === i);
    }
    return out;
  };

  /**
   * @param {NetDraft} entry
   */
  const relayNet = (entry) => {
    if (!entry || typeof entry.url !== 'string') return;
    entry.requestBody = ns.redact.scrubBody(entry.requestBody);
    entry.responseBody = ns.redact.scrubBody(entry.responseBody);
    entry.url = ns.redact.scrubText(entry.url);
    for (const h of entry.requestHeaders || []) h.value = ns.redact.scrubText(h.value);
    for (const h of entry.responseHeaders || []) h.value = ns.redact.scrubText(h.value);
    // docs/12 B5/B6 fields; an older hook sends none of them.
    entry.requestShape = scrubShape(entry.requestShape, 1);
    entry.responseShape = scrubShape(entry.responseShape, 1);
    entry.responseSize = typeof entry.responseSize === 'number' && Number.isFinite(entry.responseSize) ? entry.responseSize : -1;
    entry.bodyTruncated = entry.bodyTruncated === true;
    entry.disposition = entry.disposition === 'attachment' || entry.disposition === 'inline' ? entry.disposition : null;
    entry.dispositionExt = typeof entry.dispositionExt === 'string' && /^[a-z0-9]{1,8}$/i.test(entry.dispositionExt) ? entry.dispositionExt.toLowerCase() : null;
    entry.isDownload = entry.isDownload === true;
    // The worker decides whether a full body is kept; here it is only scrubbed.
    if (typeof entry.responseFull === 'string') entry.responseFull = ns.redact.scrubBody(entry.responseFull) || '';
    else delete entry.responseFull;
    void send({ type: MSG.NET_ENTRY, entry });
  };

  /**
   * @param {unknown} v
   * @returns {string}
   */
  const isoOf = (v) => (typeof v === 'string' && v.length <= 40 ? v : new Date().toISOString());

  /**
   * docs/12 B6: a createObjectURL happened — type and size, nothing of the content.
   * @param {Record<string, unknown>} data
   */
  const relayBlob = (data) => {
    const mime = typeof data.mime === 'string' ? ns.redact.scrubText(data.mime).slice(0, CAPS.MIME) : '';
    // Pages mint object URLs for media by the dozen; none of those is a
    // download the user asked for, and each hint costs the worker a write.
    if (MEDIA_MIME_RE.test(mime)) return;
    const size = typeof data.size === 'number' && Number.isFinite(data.size) ? data.size : -1;
    void send({ type: MSG.BLOB_HINT, origin, mime, size, at: isoOf(data.at) });
  };

  /**
   * A URL with its query values taken out: origin, path, fragment path, and
   * the parameter names alone. Null for anything that is not http(s).
   * @param {unknown} url
   * @returns {string|null}
   */
  const cleanUrl = (url) => {
    if (typeof url !== 'string' || !url.trim()) return null;
    /** @type {URL} */
    let u;
    try {
      u = new URL(url, location.href);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(u.protocol)) return null;
    const path = ns.nav.cleanHref(u.origin + u.pathname + u.hash);
    if (path === null) return null;
    const keys = Array.from(new Set(Array.from(u.searchParams.keys()).map((k) => ns.redact.scrubText(k)).filter(Boolean))).sort();
    return (path.startsWith('/') ? u.origin + path : path) + (keys.length ? `?${keys.map((k) => `${k}=`).join('&')}` : '');
  };

  /**
   * docs/12 B6: window.open was called.
   * @param {Record<string, unknown>} data
   */
  const relayOpen = (data) => {
    const target = typeof data.target === 'string' ? ns.redact.scrubText(data.target).slice(0, 40) : null;
    void send({ type: MSG.WINDOW_OPEN, origin, url: cleanUrl(data.url), target, at: isoOf(data.at) });
  };

  // ------------------------------------------------------------- plumbing

  const installListeners = () => {
    // Net entries, hints and framework answers from the MAIN-world hook.
    window.addEventListener('message', (ev) => {
      if (ev.source !== window || !ev.data || typeof ev.data.__fp !== 'string') return;
      const data = /** @type {{ __fp: string } & Record<string, unknown>} */ (ev.data);
      if (data.__fp === 'framework') {
        ns.framework.mergeMainWorld(/** @type {Partial<FrameworkInfo>} */ (data.info) || {});
        return;
      }
      if (!consented || !recording) return;
      if (data.__fp === 'net') relayNet(/** @type {NetDraft} */ (data.entry));
      else if (data.__fp === 'blob') relayBlob(data);
      else if (data.__fp === 'open') relayOpen(data);
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
            const kb = meta.keepBodies === 'full' ? 'full' : 'shape';
            if (kb !== keepBodies) {
              keepBodies = kb;
              postConfig();
            }
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
      isDanger,
      viewKey: () => lastViewKey,
    });
    // Ask the MAIN world what it can see; the answer merges in when it arrives.
    try {
      window.postMessage({ __fp: 'detect' }, location.origin);
    } catch {
      /* opaque origin */
    }
    postConfig();
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
    keepBodies = r.keepBodies === 'full' ? 'full' : 'shape';
    installListeners();
  });
})();
