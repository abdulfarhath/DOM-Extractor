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
   * docs/11 F6 — one structural rule list across the enabled packs.
   * @template T
   * @param {'keys'|'labels'|'hints'} kind
   * @returns {T[]}
   */
  const structural = (kind) => {
    const packs = window.__FP.packs || {};
    /** @type {T[]} */
    const out = [];
    for (const n of enabledPacks) {
      const p = packs[n];
      const list = p && p[kind];
      if (Array.isArray(list)) out.push(.../** @type {T[]} */ (/** @type {unknown} */ (list)));
    }
    return out;
  };

  /**
   * Values already known to be a name or an address, learned from a key,
   * label or class hint, then scrubbed wherever else they turn up (a greeting,
   * a tooltip, a request body). Per document, memory only: the set dies with
   * the page and is never stored.
   */
  const LEARN_MIN = 4;
  const LEARN_MAX = 200;
  /** @type {Map<string, string>} */
  const learned = new Map();
  /** @type {RegExp|null} */
  let learnedRe = null;

  /**
   * @param {string} value
   * @param {string} replacement
   */
  const learn = (value, replacement) => {
    const v = String(value || '').replace(/\s+/g, ' ').trim();
    const k = v.toLowerCase();
    if (v.length < LEARN_MIN || learned.has(k) || v.startsWith('<')) return;
    // Numbers are the pattern rules' job; learning one would eat dates and counts.
    if (!/\p{L}/u.test(v)) return;
    // Icon ligatures and code tokens (`expand_more`) are interface, not people.
    if (/^[a-z0-9_-]+$/.test(v)) return;
    if (learned.size >= LEARN_MAX) learned.delete(learned.keys().next().value || '');
    learned.set(k, replacement);
    const alts = Array.from(learned.keys()).sort((x, y) => y.length - x.length).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));
    learnedRe = new RegExp(alts.join('|'), 'giu');
  };

  /**
   * @param {string} text
   * @returns {string}
   */
  const scrubLearned = (text) => {
    if (!learnedRe || !text) return text;
    return text.replace(learnedRe, (m) => learned.get(m.replace(/\s+/g, ' ').toLowerCase()) || '<NAME>');
  };

  /**
   * Rule 4 — pattern rules only.
   * @param {string} text
   * @returns {string}
   */
  const applyPatterns = (text) => {
    let out = scrubLearned(text);
    for (const r of activeRules()) {
      // A string replacement must not be interpreted as a $-pattern.
      out = typeof r.replacement === 'string' ? out.replace(r.pattern, () => /** @type {string} */ (r.replacement)) : out.replace(r.pattern, r.replacement);
    }
    return out;
  };

  /**
   * camelCase / snake_case / kebab-case key → lowercase tokens.
   * @param {string} key
   * @returns {string[]}
   */
  const keyTokens = (key) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[^A-Za-z]+/).filter(Boolean).map((t) => t.toLowerCase());

  /**
   * docs/11 F6 — the key rule for a JSON key, or null.
   * @param {string} key
   * @returns {FPKeyRule|null}
   */
  const keyRuleFor = (key) => {
    if (!key || /^\d+$/.test(key)) return null;
    for (const r of structural('keys')) {
      const rule = /** @type {FPKeyRule} */ (r);
      if (!rule.key.test(key)) continue;
      if (rule.notTokens && keyTokens(key).some((t) => /** @type {RegExp} */ (rule.notTokens).test(t))) continue;
      return rule;
    }
    return null;
  };

  const LABEL_MAX = 60;
  /**
   * docs/11 F6 — the label rule whose value follows this text, or null.
   * @param {string} text
   * @returns {FPLabelRule|null}
   */
  const labelRuleFor = (text) => {
    const t = String(text || '').replace(/\s+/g, ' ').replace(/[\s:*：]+$/u, '').replace(/^[\s*]+/, '').trim();
    if (!t || t.length > LABEL_MAX) return null;
    for (const r of structural('labels')) {
      const rule = /** @type {FPLabelRule} */ (r);
      if (rule.label.test(t)) return rule;
    }
    return null;
  };

  const HINT_TEXT_MAX = 200;
  const HINT_CHILDREN_MAX = 12;
  /**
   * docs/11 F6 — the hint rule an element's own class or id matches, or null.
   * @param {Element} el
   * @returns {FPHintRule|null}
   */
  const hintRuleFor = (el) => {
    // A hint names a value holder, not a region: `welcome-page` on a wrapper
    // must not blank the page under it.
    if ((el.textContent || '').length > HINT_TEXT_MAX || el.getElementsByTagName('*').length > HINT_CHILDREN_MAX) return null;
    const probe = `${el.id || ''} ${typeof el.className === 'string' ? el.className : el.getAttribute('class') || ''}`.trim();
    if (!probe) return null;
    for (const r of structural('hints')) {
      const rule = /** @type {FPHintRule} */ (r);
      if (rule.hint.test(probe)) return rule;
    }
    return null;
  };

  const CONTEXT_UP = 3;
  /**
   * The structural rule that makes an element's text a value to redact: a
   * class/id hint on it or on an ancestor close by, or a label rendered just
   * before it (the sibling before it, or before one of its near ancestors).
   * @param {Element} el
   * @returns {{ name: string, replacement: string }|null}
   */
  const contextRuleFor = (el) => {
    /** @type {Element|null} */
    let node = el;
    for (let i = 0; node && i <= CONTEXT_UP; i++, node = node.parentElement) {
      const h = hintRuleFor(node);
      if (h) return h;
    }
    node = el;
    for (let i = 0; node && i <= CONTEXT_UP; i++, node = node.parentElement) {
      const sib = node.previousElementSibling;
      if (sib) {
        const l = labelRuleFor(sib.textContent || '');
        return l || null;
      }
    }
    return null;
  };

  /**
   * Text of an element as the recording should keep it: the structural
   * replacement when the element holds a name or an address, the pattern
   * scrub otherwise. Learns what it redacts.
   * @param {Element} el
   * @param {string} text   already extracted by the caller
   * @returns {string}
   */
  const scrubElementText = (el, text) => {
    if (!text) return '';
    let rule = null;
    try {
      rule = contextRuleFor(el) || findHintInside(el);
    } catch {
      rule = null;
    }
    if (rule) {
      learn(text, rule.replacement);
      return rule.replacement;
    }
    return applyPatterns(text);
  };

  // Not [class*=icon]: an icon *button* wraps the very name we are after.
  const DECORATION_SEL = '[aria-hidden="true"], mat-icon, [class*="material-icons"], [class*="material-symbols"], i, svg';
  /**
   * Text a person does not read as content: icon ligatures, hidden glyphs.
   * @param {Node} n
   * @returns {boolean}
   */
  const isDecoration = (n) => !!(n.parentElement && n.parentElement.closest(DECORATION_SEL));

  const HINT_SCAN_MAX = 40;
  /**
   * A hint on a descendant (a profile button whose name sits in a span).
   * @param {Element} el
   * @returns {FPHintRule|null}
   */
  const findHintInside = (el) => {
    const all = el.querySelectorAll('[class], [id]');
    /** @type {FPHintRule|null} */
    let found = null;
    for (let i = 0; i < all.length && i < HINT_SCAN_MAX; i++) {
      const h = hintRuleFor(all[i]);
      if (!h) continue;
      found = found || h;
      // Each text node on its own: a truncated label and its full tooltip
      // are two values, and both must be learned.
      const walker = document.createTreeWalker(all[i], NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!isDecoration(n)) learn(n.nodeValue || '', h.replacement);
    }
    return found;
  };

  const TS_MS_MIN = 946684800000; // 2000-01-01
  const TS_MS_MAX = 4102444800000; // 2100-01-01
  const TS_S_MIN = 946684800;
  const TS_S_MAX = 4102444800;
  const DATE_KEY_RE = /date|time|(?:^|[a-z])(?:dt|ts|on|at)$/i;
  const NOT_TS_KEY_RE = /phone|mobile|card|acc(?:ou)?n?t|aadha?ar|uid|contact/i;

  /**
   * A timestamp is structure an automation needs (which field is the due
   * date, what unit it is in) and would otherwise be eaten by the phone and
   * card patterns. Milliseconds in 2000–2100 are kept whatever the key;
   * seconds only under a date-like key.
   * @param {string} key
   * @param {string} digits
   * @returns {boolean}
   */
  const isTimestamp = (key, digits) => {
    if (!/^\d{10}$|^\d{12,13}$/.test(digits) || NOT_TS_KEY_RE.test(key)) return false;
    const n = Number(digits);
    if (digits.length >= 12) return n >= TS_MS_MIN && n <= TS_MS_MAX;
    return DATE_KEY_RE.test(key) && n >= TS_S_MIN && n <= TS_S_MAX;
  };

  const FILE_EXT_RE = /((?:\.(?:pdf|zip|gz|tgz|xlsx?|csv|docx?|jpe?g|png|gif|webp|bmp|tiff?|xml|json|txt|pptx?|html?|rar|7z|tar|odt|ods|rtf|eml|msg|p7s|sig))+)$/i;
  /**
   * A string that is a file name: its stem is personal as often as not
   * (identifiers, names, dates), its extension is structure.
   * @param {string} v
   * @returns {string|null}
   */
  const fileNameOf = (v) => {
    if (v.length < 5 || v.length > 260 || /[\/\\<>\n]|:\/\//.test(v)) return null;
    const m = FILE_EXT_RE.exec(v);
    return m && m.index > 0 ? `<FILE>${m[1].toLowerCase()}` : null;
  };

  /**
   * @param {FPKeyRule} rule
   * @param {string} v
   * @returns {string}
   */
  const keyReplacement = (rule, v) => {
    if (rule.name === 'file-name') return fileNameOf(v) || rule.replacement;
    learn(v, rule.replacement);
    return rule.replacement;
  };

  const JSON_DEPTH = 64;
  /**
   * docs/11 F6 — structural scrub of parsed JSON. A value under a matched key
   * is replaced (every string beneath it, for an object); timestamps survive;
   * everything else gets the pattern rules.
   * @param {unknown} v
   * @param {string} key
   * @param {FPKeyRule|null} inherited
   * @param {number} depth
   * @returns {unknown}
   */
  const scrubJson = (v, key, inherited, depth) => {
    if (depth > JSON_DEPTH) return null;
    const rule = inherited || keyRuleFor(key);
    if (Array.isArray(v)) return v.map((x) => scrubJson(x, key, rule, depth + 1));
    if (v && typeof v === 'object') {
      /** @type {Record<string, unknown>} */
      const out = {};
      for (const [k, x] of Object.entries(v)) out[applyPatterns(k)] = scrubJson(x, k, rule, depth + 1);
      return out;
    }
    if (typeof v === 'number') {
      if (!Number.isInteger(v)) return v;
      const digits = String(Math.abs(v));
      if (rule && rule.name === 'birth') return rule.replacement;
      if (isTimestamp(key, digits)) return v;
      const s = String(v);
      const out = applyPatterns(s);
      return out === s ? v : out;
    }
    if (typeof v === 'string') {
      if (!v) return v;
      if (rule) return keyReplacement(rule, v);
      if (isTimestamp(key, v)) return v;
      return fileNameOf(v) || applyPatterns(v);
    }
    return v;
  };

  const JSON_PARSE_MAX = 4 * 1024 * 1024;
  const PAIR_RE = /"((?:[^"\\]|\\.){1,80})"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d{1,20})/g;
  /**
   * The same rules over text that is JSON-like but does not parse, as a
   * truncated body: `"key": value` pairs only. Protected values are swapped
   * for markers the pattern rules cannot match, then swapped back.
   * @param {string} text
   * @returns {string}
   */
  const scrubJsonLike = (text) => {
    /** @type {string[]} */
    const kept = [];
    /** @param {string} s */
    const mark = (s) => {
      kept.push(s);
      let n = kept.length - 1;
      let tag = '';
      do {
        tag = String.fromCharCode(97 + (n % 26)) + tag;
        n = Math.floor(n / 26);
      } while (n > 0);
      return `\u0000${tag}\u0000`;
    };
    const marked = text.replace(PAIR_RE, (all, key, raw) => {
      const isStr = raw.startsWith('"');
      const inner = isStr ? raw.slice(1, -1) : raw;
      const rule = keyRuleFor(key);
      if (rule && isStr && inner) return `"${key}":${mark(`"${keyReplacement(rule, inner)}"`)}`;
      if (rule && rule.name === 'birth' && !isStr) return `"${key}":${mark(`"${rule.replacement}"`)}`;
      if (isTimestamp(key, inner)) return `"${key}":${mark(raw)}`;
      const file = isStr && inner ? fileNameOf(inner) : null;
      if (file) return `"${key}":${mark(`"${file}"`)}`;
      return all;
    });
    return applyPatterns(marked).replace(/\u0000([a-z]+)\u0000/g, (_, tag) => {
      let n = 0;
      for (const c of tag) n = n * 26 + (c.charCodeAt(0) - 97);
      return kept[n] ?? '';
    });
  };

  /**
   * Rule 4 + docs/11 F6 — scrub a body. JSON is walked structurally, so
   * names and addresses under recognisable keys go and timestamps stay;
   * anything else gets the pattern rules. Null in, null out, so callers can
   * keep "no body" distinct from "empty body".
   * @param {string|null|undefined} text
   * @returns {string|null}
   */
  const scrubBody = (text) => {
    if (text == null) return null;
    const s = String(text);
    const lead = s.trimStart()[0];
    if ((lead === '{' || lead === '[') && s.length <= JSON_PARSE_MAX) {
      try {
        return JSON.stringify(scrubJson(JSON.parse(s), '', null, 0));
      } catch {
        return scrubJsonLike(s);
      }
    }
    return /"[^"]{1,80}"\s*:/.test(s) ? scrubJsonLike(s) : applyPatterns(s);
  };

  /**
   * Same pass for free text pulled from the page — labels, headings, option
   * text. Review pages routinely render identifiers as plain text.
   * @param {string} text
   * @returns {string}
   */
  const scrubText = (text) => (text == null ? '' : applyPatterns(String(text)));

  window.__FP.redact = { isDecoration, redactValue, isCredentialControl, scrubBody, scrubText, scrubElementText, labelRuleFor, hintRuleFor, learn, setPacks, getPacks, CREDENTIAL_RE };
})();
