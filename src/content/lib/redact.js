/* Redaction — docs/05. Loaded first so every other content lib can rely on it.
   Classic script: no imports. Exposes window.__MCADC.redact. */
(() => {
  window.__MCADC = window.__MCADC || {};

  /**
   * Rule 2 — id / name / formcontrolname / label shapes that are never captured.
   * `pin` must not be part of another word (spinner, shipping) and must not be
   * followed by "code": postal PIN code fields on the address blocks are
   * structure we need (Q3). Camel-case `userPin` is caught by the second,
   * case-sensitive pattern.
   */
  const CREDENTIAL_RE = /captcha|otp|passw|secret|token|mpin|(?:^|[^a-z])pin(?![\s_-]*code)/i;
  const CAMEL_PIN_RE = /[a-z]Pin(?![\s_-]*[Cc]ode)/;

  /**
   * Rule 3 — body scrub patterns, applied in this order. PAN and passport run
   * before DIN so a mixed alnum token is not partially eaten by the digit rules.
   * @type {Array<[RegExp, string]>}
   */
  const BODY_PATTERNS = [
    [/[A-Z]{5}[0-9]{4}[A-Z]/g, '<PAN>'],
    [/[A-Z]{1}[0-9]{7}/g, '<PASSPORT>'],
    [/[\w.+-]+@[\w-]+\.[\w.]+/g, '<EMAIL>'],
    [/\b\d{4}\s?\d{4}\s?\d{4}\b/g, '<AADHAAR>'],
    [/\b(?:\+91[-\s]?)?[6-9]\d{9}\b/g, '<PHONE>'],
    [/\b\d{8}\b/g, '<DIN>'],
  ];

  /**
   * Rule 1 — keep the length, drop the content.
   * @param {unknown} value
   * @returns {string}
   */
  const redactValue = (value) => {
    if (value == null) return '';
    const s = String(value);
    return s.length ? `<${s.length} chars>` : '';
  };

  /**
   * Rule 2 — true when the control must be recorded only as redactedEntirely.
   * @param {ControlElement} el
   * @param {string} label
   * @returns {boolean}
   */
  const isCredentialControl = (el, label) => {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'password') return true;
    const probes = [
      el.id,
      el.getAttribute('name'),
      el.getAttribute('formcontrolname'),
      el.getAttribute('ng-reflect-name'),
      label,
    ];
    return probes.some((p) => p && (CREDENTIAL_RE.test(p) || CAMEL_PIN_RE.test(p)));
  };

  /**
   * Rule 3 — pattern scrub. Returns null for null input so callers can keep
   * "no body" distinct from "empty body".
   * @param {string|null|undefined} text
   * @returns {string|null}
   */
  const scrubBody = (text) => {
    if (text == null) return null;
    let out = String(text);
    for (const [re, rep] of BODY_PATTERNS) out = out.replace(re, rep);
    return out;
  };

  /**
   * Same pass for free text pulled from the page. Labels rarely carry PII, but
   * MCA renders "PAN: ABCDE1234F" style summaries as plain text on review pages.
   * @param {string} text
   * @returns {string}
   */
  const scrubText = (text) => scrubBody(text) || '';

  window.__MCADC.redact = { redactValue, isCredentialControl, scrubBody, scrubText, CREDENTIAL_RE };
})();
