/* Redaction — docs/05 rules 2–4. Loaded after the packs so it can index them.
   Classic script: exposes window.__FP.redact. */
(() => {
  window.__FP = window.__FP || {};

  /**
   * Rule 3 — control shapes whose content never reaches storage (docs/11 F1).
   *
   * `pin` may not be preceded or followed by a letter, and may not be followed
   * by "code". The lookbehind is case-insensitive, so `LLPIN`, `spinner`,
   * `pinned` never match; but that same lookbehind also rejects camel-case
   * `userPin`, which docs/11 lists as a credential — hence the second,
   * case-sensitive pattern for a lowercase letter followed by `Pin`.
   *
   * These cases are the specification; an edit that breaks one is a regression:
   *
   *   credential = no
   *     LLPIN · "User ID, CIN, LLPIN, FCRN or Email ID"
   *     pinCode · "Pin code" · Pincode · pin-code · "PIN Code"
   *     spinner · shipping · pinned · userPinned · address1
   *   credential = yes
   *     PIN · Pin · userPin · txnPin · user_pin · "login PIN" · PIN2
   *     mpin · MPIN
   *     otp · "Enter the OTP" · captcha · cvv · Password · passcode
   */
  const CREDENTIAL_RE = /captcha|otp|passw|passcode|mpin|secret|token|cvv|(?<![a-z])pin(?![a-z]|[\s_-]*code)/i;
  const CAMEL_PIN_RE = /[a-z]Pin(?![A-Za-z]|[\s_-]*[Cc]ode)/;

  /** Packs enabled for this document; the worker decides, the flags message tells us. */
  /** @type {string[]} */
  let enabledPacks = ['generic'];

  /**
   * Rule 2 — keep the length, drop the content.
   * @param {unknown} value
   * @returns {string}
   */
  const redactValue = (value) => {
    if (value == null) return '';
    const s = String(value);
    return s.length ? `<${s.length} chars>` : '';
  };

  /**
   * Rule 3 — true when the control's content must never be recorded. The
   * control itself is still recorded in full (docs/11 F2); only `value` goes.
   * @param {Element} el
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
      el.getAttribute('autocomplete'),
      el.getAttribute('v-model'),
      label,
    ];
    return probes.some((p) => p && (CREDENTIAL_RE.test(p) || CAMEL_PIN_RE.test(p)));
  };

  /**
   * @param {string[]} names
   */
  const setPacks = (names) => {
    const packs = window.__FP.packs || {};
    enabledPacks = ['generic', ...names.filter((n) => n !== 'generic' && packs[n])];
  };

  /** @returns {string[]} */
  const getPacks = () => enabledPacks.slice();

  /**
   * Rule 4 — every enabled pack's rules, in pack order then rule order.
   * @returns {Array<{ name: string, pattern: RegExp, replacement: string | ((m: string) => string) }>}
   */
  const activeRules = () => {
    const packs = window.__FP.packs || {};
    /** @type {Array<{ name: string, pattern: RegExp, replacement: string | ((m: string) => string) }>} */
    const out = [];
    for (const n of enabledPacks) {
      const p = packs[n];
      if (p) out.push(...p.rules);
    }
    return out;
  };

  /**
   * Rule 4 — pattern scrub. Null in, null out, so callers can keep "no body"
   * distinct from "empty body".
   * @param {string|null|undefined} text
   * @returns {string|null}
   */
  const scrubBody = (text) => {
    if (text == null) return null;
    let out = String(text);
    for (const r of activeRules()) {
      // A string replacement must not be interpreted as a $-pattern.
      out = typeof r.replacement === 'string' ? out.replace(r.pattern, () => /** @type {string} */ (r.replacement)) : out.replace(r.pattern, r.replacement);
    }
    return out;
  };

  /**
   * Same pass for free text pulled from the page — labels, headings, option
   * text. Review pages routinely render identifiers as plain text.
   * @param {string} text
   * @returns {string}
   */
  const scrubText = (text) => scrubBody(text) || '';

  window.__FP.redact = { redactValue, isCredentialControl, scrubBody, scrubText, setPacks, getPacks, CREDENTIAL_RE };
})();
