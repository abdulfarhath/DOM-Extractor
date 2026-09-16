/* Form-control inventory — docs/02 "Field level". Builds one FieldRecord per
   control, or a bare RedactedFieldRecord for credential-shaped ones.
   Classic script: exposes window.__MCADC.fields. */
(() => {
  window.__MCADC = window.__MCADC || {};

  const MAX_OPTIONS = 60; // mirrors CAPS.OPTIONS_PER_SELECT in shared/constants.js
  const MAX_CLASSES = 120;
  const MAX_OPTION_TEXT = 80;
  const CONTROL_SEL = 'input, select, textarea, [contenteditable="true"]';

  /**
   * @param {Element} el
   * @returns {boolean}
   */
  const isVisible = (el) => {
    // checkVisibility covers display:none / visibility:hidden / content-visibility.
    // The rect check catches zero-size controls that Angular hides by collapsing.
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return false;
    const r = el.getBoundingClientRect();
    return !!(r.width || r.height);
  };

  /**
   * Every control except hidden inputs, in DOM order.
   * @param {Document|Element} root
   * @returns {ControlElement[]}
   */
  const collectControls = (root) =>
    /** @type {ControlElement[]} */ (
      Array.from(root.querySelectorAll(CONTROL_SEL)).filter(
        (el) => (el.getAttribute('type') || '').toLowerCase() !== 'hidden'
      )
    );

  /**
   * Type string per docs/03: the input type attribute, or the tag for
   * select/textarea, or 'contenteditable'.
   * @param {ControlElement} el
   * @param {string} tag
   * @returns {string}
   */
  const controlType = (el, tag) => {
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'input') return (el.getAttribute('type') || 'text').toLowerCase();
    return 'contenteditable';
  };

  /**
   * Live value for redaction. contenteditable has no .value, so its text is the
   * value. Never returned to the caller unredacted.
   * @param {ControlElement} el
   * @param {string} tag
   * @returns {string}
   */
  const rawValue = (el, tag) => {
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      return /** @type {HTMLInputElement} */ (el).value ?? '';
    }
    return el.textContent || '';
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
   * @param {ControlElement} el
   * @param {number} index
   * @returns {AnyFieldRecord}
   */
  const describeField = (el, index) => {
    const ns = /** @type {MCADCNamespace} */ (window.__MCADC);
    const tag = el.tagName.toLowerCase();
    const type = controlType(el, tag);
    const { label, labelSource } = ns.labels.resolveLabel(el);

    // Rule 2: credentials never produce a full record.
    if (ns.redact.isCredentialControl(el, label)) {
      return { index, tag, type, label: ns.redact.scrubText(label), labelSource, redactedEntirely: true };
    }

    const rect = el.getBoundingClientRect();
    const input = /** @type {HTMLInputElement} */ (el);
    const isCheckable = type === 'radio' || type === 'checkbox';

    /** @type {FieldRecord} */
    const out = {
      index,
      tag,
      type,
      id: el.id || '',
      name: el.getAttribute('name') || '',
      formControlName: el.getAttribute('formcontrolname') || el.getAttribute('ng-reflect-name') || '',
      label: ns.redact.scrubText(label),
      labelSource,
      placeholder: ns.labels.cleanText(el.getAttribute('placeholder')),
      ariaLabel: ns.labels.cleanText(el.getAttribute('aria-label')),
      title: ns.labels.cleanText(el.getAttribute('title')),
      required: !!input.required || el.getAttribute('aria-required') === 'true',
      maxLength: intOrNull(el.getAttribute('maxlength')),
      minLength: intOrNull(el.getAttribute('minlength')),
      pattern: el.getAttribute('pattern') || null,
      inputMode: el.getAttribute('inputmode') || null,
      disabled: !!input.disabled || el.getAttribute('aria-disabled') === 'true',
      readOnly: !!input.readOnly || el.getAttribute('aria-readonly') === 'true',
      visible: isVisible(el),
      boundingBox: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
      classes: (typeof el.className === 'string' ? el.className : '').slice(0, MAX_CLASSES),
      value: ns.redact.redactValue(rawValue(el, tag)),
      group: isCheckable ? el.getAttribute('name') || null : null,
      optionCount: null,
      options: null,
      checked: isCheckable ? !!input.checked : null,
      selectors: ns.selectors.buildSelectors(el, label),
    };

    if (tag === 'select') {
      const sel = /** @type {HTMLSelectElement} */ (el);
      out.optionCount = sel.options.length;
      out.options = Array.from(sel.options)
        .slice(0, MAX_OPTIONS)
        .map((o) => ({ v: o.value, t: ns.labels.cleanText(o.text, MAX_OPTION_TEXT) }));
    }

    return out;
  };

  /**
   * The identity used by the signature, transitions and the field map:
   * id || name || formControlName || label. Redacted records only have a label.
   * @param {AnyFieldRecord} f
   * @returns {string}
   */
  const fieldKey = (f) => {
    if ('redactedEntirely' in f) return f.label || `${f.type}@${f.index}`;
    return f.id || f.name || f.formControlName || f.label || `${f.type}@${f.index}`;
  };

  window.__MCADC.fields = { collectControls, describeField, fieldKey, isVisible };
})();
