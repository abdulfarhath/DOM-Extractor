/* Control inventory — docs/02 "Control-level capture", docs/10 A1 (shadow DOM)
   and A6 (entry hints, file inputs), docs/11 F2. One full ControlRecord per
   native control or ARIA widget; credential-shaped ones keep every structural
   field and lose only their value.
   Also the deep-DOM helpers every other lib uses to see through open shadow
   roots. Classic script: exposes window.__FP.fields. */
(() => {
  window.__FP = window.__FP || {};

  const MAX_OPTIONS = 60; // CAPS.OPTIONS_PER_SELECT
  const MAX_CLASSES = 120;
  const MAX_OPTION_TEXT = 80;
  const MAX_DATA_ATTRS = 20;
  const MAX_DATA_VALUE = 80;
  const MAX_DESCRIBED = 200;
  const SHADOW_DEPTH = 10; // CAPS.SHADOW_DEPTH
  const TESTID_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-qa', 'data-test-id', 'data-automation-id'];

  const NATIVE_SEL = 'input, select, textarea, [contenteditable="true"]';
  const ARIA_SEL = '[role="combobox"], [role="listbox"], [role="checkbox"], [role="radio"], [role="switch"]';
  const CONTROL_SEL = `${NATIVE_SEL}, ${ARIA_SEL}`;
  const NATIVE_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

  const DATE_RE = /date|calendar|picker|datepicker|dob/i;
  const SEARCH_RE = /search|lookup|autocomplete|typeahead|suggest/i;
  const ICON_RE = /calendar|date|search|clear|arrow|chevron|caret|dropdown|expand/i;
  const MASK_RE = /^[#_\-\/\s.()X9AN*]{4,}$/;

  // ------------------------------------------------------------ deep DOM

  /**
   * Visit every element beneath root, descending into open shadow roots.
   * @param {ParentNode} root
   * @param {(el: Element, root: ParentNode) => void} visit
   * @param {number} [depth]
   */
  const walk = (root, visit, depth = 0) => {
    for (const el of root.querySelectorAll('*')) {
      visit(el, root);
      if (el.shadowRoot && depth < SHADOW_DEPTH) walk(el.shadowRoot, visit, depth + 1);
    }
  };

  /**
   * querySelectorAll across the root and every open shadow root beneath it.
   * Light-DOM matches come first, then each host's shadow matches in host order.
   * @param {ParentNode} root
   * @param {string} selector
   * @param {number} [depth]
   * @returns {Element[]}
   */
  const queryDeep = (root, selector, depth = 0) => {
    /** @type {Element[]} */
    let out = [];
    try {
      out = Array.from(root.querySelectorAll(selector));
    } catch {
      return out;
    }
    if (depth >= SHADOW_DEPTH) return out;
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) out = out.concat(queryDeep(el.shadowRoot, selector, depth + 1));
    }
    return out;
  };

  /**
   * @param {ParentNode} root
   * @returns {boolean}
   */
  const hasShadowRoots = (root) => {
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) return true;
    return false;
  };

  /**
   * A1 — custom elements that render visible content we cannot see into:
   * a closed shadow root leaves `shadowRoot` null but the host still has size.
   * @param {ParentNode} root
   * @returns {OpaqueRegion[]}
   */
  const findOpaque = (root) => {
    const ns = /** @type {FPNamespace} */ (window.__FP);
    /** @type {OpaqueRegion[]} */
    const out = [];
    walk(root, (el) => {
      if (!el.tagName.includes('-') || el.shadowRoot || el.children.length) return;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return;
      if (out.length >= 40) return;
      out.push({ tag: el.tagName.toLowerCase(), selector: ns.selectors.forElement(el), opaque: true, reason: 'closed shadow root' });
    });
    return out;
  };

  // ------------------------------------------------------------ controls

  /**
   * @param {Element} el
   * @returns {boolean}
   */
  const isVisible = (el) => {
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return false;
    const r = el.getBoundingClientRect();
    return !!(r.width || r.height);
  };

  /**
   * Every control in DOM order, descending into open shadow roots. Hidden
   * inputs are structure without a value and are left to the snapshot.
   * @param {ParentNode} root
   * @returns {ControlElement[]}
   */
  const collectControls = (root) =>
    /** @type {ControlElement[]} */ (
      queryDeep(root, CONTROL_SEL).filter((el) => {
        if (!(el instanceof HTMLElement)) return false;
        if (el.tagName === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() === 'hidden') return false;
        return true;
      })
    );

  /**
   * @param {ControlElement} el
   * @param {string} tag
   * @param {string|null} role
   * @returns {string}
   */
  const controlType = (el, tag, role) => {
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'input') return (el.getAttribute('type') || 'text').toLowerCase();
    if (el.getAttribute('contenteditable') === 'true') return 'contenteditable';
    return role || tag;
  };

  /**
   * Live value for redaction. Never returned to the caller unredacted.
   * @param {ControlElement} el
   * @param {string} tag
   * @returns {string}
   */
  const rawValue = (el, tag) => {
    if (NATIVE_TAGS.has(el.tagName)) return /** @type {HTMLInputElement} */ (el).value ?? '';
    if (el.getAttribute('contenteditable') === 'true') return el.textContent || '';
    // ARIA widgets: the visible selection text is the value.
    return el.getAttribute('aria-valuetext') || el.textContent || '';
  };

  /**
   * @param {string|null} v
   * @returns {number|null}
   */
  const intOrNull = (v) => {
    if (v == null || v === '') return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  /**
   * @param {Element} el
   * @returns {Record<string, string>}
   */
  const dataAttrs = (el) => {
    /** @type {Record<string, string>} */
    const out = {};
    let n = 0;
    for (const a of el.attributes) {
      if (!a.name.startsWith('data-')) continue;
      if (n++ >= MAX_DATA_ATTRS) break;
      out[a.name.slice(5)] = a.value.slice(0, MAX_DATA_VALUE);
    }
    return out;
  };

  /**
   * @param {Element} el
   * @returns {string}
   */
  const testId = (el) => {
    for (const a of TESTID_ATTRS) {
      const v = el.getAttribute(a);
      if (v) return v;
    }
    return '';
  };

  /**
   * Identity used everywhere (docs/09 Q16 order): automation attribute →
   * framework binding → authored id → name → label → positional fallback.
   * @param {Element} el
   * @param {string} label
   * @param {string} type
   * @param {number} index
   * @param {FrameworkInfo} framework
   * @returns {string}
   */
  const keyFor = (el, label, type, index, framework) => {
    const ns = /** @type {FPNamespace} */ (window.__FP);
    const tid = testId(el);
    if (tid) return tid;
    const fcn = el.getAttribute('formcontrolname') || el.getAttribute('ng-reflect-name') || '';
    if (framework.framework === 'angular' && fcn) return fcn;
    if (el.id && !ns.selectors.looksAutoGenerated(el.id)) return el.id;
    const name = el.getAttribute('name') || '';
    if (name) return name;
    if (fcn) return fcn;
    if (label) return label;
    const aria = el.getAttribute('aria-label') || '';
    if (aria) return aria;
    return `${type}@${index}`;
  };

  /**
   * @param {Element} el
   * @returns {string}
   */
  const describedBy = (el) => {
    const ns = /** @type {FPNamespace} */ (window.__FP);
    const ids = el.getAttribute('aria-describedby');
    if (!ids) return '';
    const root = ns.selectors.rootOf(el);
    return ns.redact.scrubText(
      ns.labels.cleanText(ids.split(/\s+/).map((id) => ns.labels.textOf(root.getElementById(id), MAX_DESCRIBED)).filter(Boolean).join(' '), MAX_DESCRIBED)
    );
  };

  /**
   * A6 — how a value gets in. `unknown` is an honest answer, not a failure.
   * @param {ControlElement} el
   * @param {string} tag
   * @param {string} type
   * @param {string|null} role
   * @param {boolean} readOnly
   * @param {boolean} disabled
   * @param {boolean} visible
   * @returns {EntryHint}
   */
  const entryHint = (el, tag, type, role, readOnly, disabled, visible) => {
    const attrs = `${el.id} ${el.className} ${el.getAttribute('name') || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('autocomplete') || ''}`;
    const mask = el.getAttribute('data-mask') || el.getAttribute('mask') || el.getAttribute('data-inputmask') || '';
    const placeholder = el.getAttribute('placeholder') || '';
    const maskShape = mask || (MASK_RE.test(placeholder) && /[_#9X]/.test(placeholder) ? placeholder : '');
    /** @param {EntryHint['widgetKind']} k */
    const guessKind = (k) => k || (DATE_RE.test(attrs) ? 'datepicker' : SEARCH_RE.test(attrs) ? 'autocomplete' : null);

    if (type === 'file') return { mode: 'widget', evidence: 'file input (setInputFiles)', widgetKind: null, mask: null };
    if (tag === 'select') return { mode: 'typed', evidence: 'native select (selectOption)', widgetKind: null, mask: null };
    if (type === 'checkbox' || type === 'radio') return { mode: 'typed', evidence: 'native checkable (check/click)', widgetKind: null, mask: null };
    if (/^(date|datetime-local|time|month|week)$/.test(type)) return { mode: 'typed', evidence: 'native date/time input', widgetKind: 'datepicker', mask: null };
    if (role === 'combobox') {
      const kind = el.getAttribute('aria-autocomplete') && el.getAttribute('aria-autocomplete') !== 'none' ? 'autocomplete' : 'listbox';
      return { mode: 'widget', evidence: 'role=combobox', widgetKind: kind, mask: null };
    }
    if (role === 'listbox') return { mode: 'widget', evidence: 'role=listbox', widgetKind: 'listbox', mask: null };
    if (role === 'checkbox' || role === 'radio' || role === 'switch') return { mode: 'widget', evidence: `role=${role} (click)`, widgetKind: null, mask: null };

    const haspopup = el.getAttribute('aria-haspopup');
    const popupish = !!(haspopup && haspopup !== 'false') || el.hasAttribute('aria-expanded') || el.hasAttribute('aria-controls') || (el.hasAttribute('aria-autocomplete') && el.getAttribute('aria-autocomplete') !== 'none');
    if (popupish) {
      const kind = el.hasAttribute('aria-autocomplete') ? 'autocomplete' : haspopup === 'listbox' || haspopup === 'menu' ? 'listbox' : guessKind(null);
      return { mode: 'widget', evidence: 'aria-haspopup / aria-expanded / aria-controls present', widgetKind: kind, mask: maskShape || null };
    }
    if (readOnly && !disabled && visible) {
      return { mode: 'widget', evidence: 'readonly but enabled; expects a widget to set it', widgetKind: guessKind(null), mask: maskShape || null };
    }
    const sib = iconSibling(el);
    if (sib) return { mode: 'widget', evidence: `adjacent icon control (${sib})`, widgetKind: guessKind(null), mask: maskShape || null };
    if (maskShape) return { mode: 'typed', evidence: 'input mask present', widgetKind: 'mask', mask: maskShape };
    if (readOnly && disabled) return { mode: 'unknown', evidence: 'readonly and disabled at capture time', widgetKind: null, mask: null };
    if (tag === 'input' || tag === 'textarea' || type === 'contenteditable') {
      return { mode: 'typed', evidence: `plain ${type}`, widgetKind: DATE_RE.test(attrs) ? 'datepicker' : null, mask: null };
    }
    return { mode: 'unknown', evidence: `unfamiliar ${tag}${role ? ` role=${role}` : ''}`, widgetKind: null, mask: null };
  };

  /**
   * A calendar/search/clear icon next to the control, by class or label only.
   * @param {Element} el
   * @returns {string|null}
   */
  const iconSibling = (el) => {
    for (const s of [el.nextElementSibling, el.previousElementSibling, el.parentElement?.nextElementSibling]) {
      if (!s) continue;
      const probe = `${s.className} ${s.getAttribute('aria-label') || ''} ${s.getAttribute('title') || ''} ${s.tagName}`;
      if (/^(BUTTON|I|SVG|SPAN|MAT-ICON|MAT-DATEPICKER-TOGGLE)$/.test(s.tagName) || s.getAttribute('role') === 'button') {
        if (ICON_RE.test(probe)) return s.tagName.toLowerCase();
      }
    }
    return null;
  };

  /**
   * @param {ControlElement} el
   * @param {number} index
   * @param {FrameworkInfo} framework
   * @returns {AnyControlRecord}
   */
  const describeControl = (el, index, framework) => {
    const ns = /** @type {FPNamespace} */ (window.__FP);
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || null;
    const type = controlType(el, tag, role);
    const { label, labelSource } = ns.labels.resolveLabel(el);
    const key = keyFor(el, label, type, index, framework);
    // Rule 3 / docs/11 F2: a credential keeps its identity, position and
    // selectors; only its content (value, and options for a select) goes.
    const credential = ns.redact.isCredentialControl(el, label);

    const rect = el.getBoundingClientRect();
    const input = /** @type {HTMLInputElement} */ (el);
    const native = NATIVE_TAGS.has(el.tagName);
    const isCheckable = type === 'checkbox' || type === 'radio' || role === 'checkbox' || role === 'radio' || role === 'switch';
    const disabled = (native && !!input.disabled) || el.getAttribute('aria-disabled') === 'true';
    const readOnly = (native && !!input.readOnly) || el.getAttribute('aria-readonly') === 'true';
    const visible = isVisible(el);
    const isFile = type === 'file';

    /** @type {boolean|null} */
    let checked = null;
    if (isCheckable) checked = native ? !!input.checked : el.getAttribute('aria-checked') === 'true';

    /** @type {ControlRecord} */
    const out = {
      index,
      tag,
      type,
      role,
      key,
      id: el.id || '',
      name: el.getAttribute('name') || '',
      formControlName: el.getAttribute('formcontrolname') || el.getAttribute('ng-reflect-name') || '',
      dataAttrs: dataAttrs(el),
      label: ns.redact.scrubText(label),
      labelSource,
      placeholder: ns.labels.cleanText(el.getAttribute('placeholder')),
      ariaLabel: ns.labels.cleanText(el.getAttribute('aria-label')),
      ariaDescribedByText: describedBy(el),
      title: ns.labels.cleanText(el.getAttribute('title')),
      required: (native && !!input.required) || el.getAttribute('aria-required') === 'true',
      maxLength: intOrNull(el.getAttribute('maxlength')),
      minLength: intOrNull(el.getAttribute('minlength')),
      pattern: el.getAttribute('pattern') || null,
      inputMode: el.getAttribute('inputmode') || null,
      step: el.getAttribute('step') || null,
      min: el.getAttribute('min') || el.getAttribute('aria-valuemin') || null,
      max: el.getAttribute('max') || el.getAttribute('aria-valuemax') || null,
      disabled,
      readOnly,
      visible,
      boundingBox: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      classes: (typeof el.className === 'string' ? el.className : '').slice(0, MAX_CLASSES),
      redactedEntirely: credential,
      group: isCheckable ? el.getAttribute('name') || el.getAttribute('aria-labelledby') || null : null,
      optionCount: null,
      options: null,
      checked,
      entry: entryHint(el, tag, type, role, readOnly, disabled, visible),
      file: isFile ? { accept: el.getAttribute('accept'), multiple: el.hasAttribute('multiple'), capture: el.getAttribute('capture') } : null,
      selectors: ns.selectors.buildSelectors(el, label, framework),
    };

    // `value` is set only for non-credential controls, so a redacted record has
    // no value key at all — not even a length. A file input's value is a path
    // (A6): existence only, recorded as ''.
    if (!credential) out.value = isFile ? '' : ns.redact.redactValue(rawValue(el, tag));

    if (credential) {
      // Option text on a credential select could carry the secret.
      out.optionCount = null;
      out.options = null;
    } else if (tag === 'select') {
      const sel = /** @type {HTMLSelectElement} */ (el);
      out.optionCount = sel.options.length;
      out.options = Array.from(sel.options)
        .slice(0, MAX_OPTIONS)
        .map((o) => ({ v: ns.redact.scrubText(o.value), t: ns.redact.scrubText(ns.labels.cleanText(o.text, MAX_OPTION_TEXT)) }));
    } else if (role === 'listbox') {
      const opts = Array.from(el.querySelectorAll('[role="option"]'));
      out.optionCount = opts.length;
      out.options = opts.slice(0, MAX_OPTIONS).map((o) => ({
        v: ns.redact.scrubText(o.getAttribute('data-value') || o.getAttribute('value') || o.id || ''),
        t: ns.redact.scrubText(ns.labels.textOf(o, MAX_OPTION_TEXT)),
      }));
    }

    return out;
  };

  window.__FP.fields = { collectControls, describeControl, isVisible, queryDeep, findOpaque, hasShadowRoots };
})();
