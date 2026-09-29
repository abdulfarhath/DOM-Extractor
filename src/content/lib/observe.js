/* Capture triggers — docs/02 "When to capture", docs/10 A2 (mutation circuit
   breaker), docs/09 Q17 (custom listboxes), docs/12 B4 (actions). Listens
   only; every handler ends in a trigger callback. A user click or change also
   yields an ActionDraft — what was acted on, precisely enough to repeat it —
   built in the capture phase, before the page reacts to the event. Nothing
   here reads a typed value or touches the page.
   Classic script: exposes window.__FP.observe. */
(() => {
  window.__FP = window.__FP || {};

  const CLICK_LABEL_MAX = 40;
  const ACTION_TEXT_MAX = 80; // CAPS.NAV_TEXT
  const BREAKER_PER_SEC = 500; // TIMING.MUTATION_BREAKER_PER_SEC
  const BREAKER_COOLDOWN_MS = 10000; // TIMING.MUTATION_BREAKER_COOLDOWN_MS
  const POINTER_ANCESTORS = 3;
  const CLICKABLE_SEL = 'button, a, [role="tab"], [role="button"], [role="menuitem"], input[type="submit"], input[type="button"], summary, li, label';
  const OPTION_SEL = '[role="option"], [role="listbox"] *, .mat-option, .mat-mdc-option, .ng-option, .dropdown-item, .select2-results__option';
  const LISTBOX_SEL = '[role="listbox"], .mat-select-panel, .mat-mdc-select-panel, .ng-dropdown-panel, .dropdown-menu, .select2-results';
  /** Class-shaped dropdowns that are as often a menu of links or actions as a select. */
  const AMBIGUOUS_OPTION_SEL = '.dropdown-item';
  const AMBIGUOUS_BOX_SEL = '.dropdown-menu';
  /** A click on one of these goes somewhere or does something; it never picks a value. */
  const NOT_A_CHOICE_SEL = 'a[href], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';
  const FIELD_WRAP_SEL = 'mat-form-field, ng-select, [class*="form-group"], [class*="form-field"], [class*="field"], [role="combobox"]';
  const CONTROL_ID_SEL = '[data-testid], [data-test], [data-cy], [data-qa], [formcontrolname], [name], [id]';
  /** Regions that mutate for decoration, not structure. */
  const ANIM_SEL = '[class*="anim"], [class*="spinner"], [class*="loader"], [class*="loading"], [class*="carousel"], [class*="ticker"], [class*="marquee"], [class*="progress"], [class*="skeleton"], canvas, video, [aria-live]';

  // docs/12 B4 — target resolution. Things that act on their own, then things
  // that only sometimes do; the nearest of the first kind wins.
  const STRONG_SEL =
    'a, button, summary, input[type="submit"], input[type="button"], input[type="reset"], input[type="image"], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="treeitem"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"]';
  const WEAK_SEL = 'li, label, tr, [role="row"], [tabindex]';
  /** Inside these, text is a record's data. */
  const ROW_DATA_SEL = 'tr, td, [role="row"], [role="gridcell"], [role="cell"]';
  const ROW_SEL = 'tr, [role="row"], li, [role="listitem"], article, [role="article"]';
  /** Content here is a value, never a label. */
  const EDITABLE_SEL = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"]';
  /** Mirrors lists.js: anchors whose href ends in one of these are downloads. */
  const DOC_EXT_RE = /\.(pdf|docx?|xlsx?|csv|pptx?|zip|txt|json|xml|rtf|odt|ods)(?:[?#]|$)/i;

  /** Implied ARIA roles of the elements a click usually lands on. */
  const IMPLIED_ROLE = /** @type {Record<string, string>} */ ({
    a: 'link',
    button: 'button',
    summary: 'button',
    tr: 'row',
    td: 'cell',
    th: 'columnheader',
    li: 'listitem',
    option: 'option',
    select: 'combobox',
    textarea: 'textbox',
    img: 'img',
    nav: 'navigation',
  });
  const INPUT_ROLE = /** @type {Record<string, string>} */ ({
    checkbox: 'checkbox',
    radio: 'radio',
    button: 'button',
    submit: 'button',
    reset: 'button',
    image: 'button',
    range: 'slider',
    number: 'spinbutton',
    search: 'searchbox',
  });

  /** @type {MutationObserver|null} */
  let mo = null;
  /** @type {Array<() => void>} */
  let teardown = [];
  let tripped = false;
  let windowStart = 0;
  let windowCount = 0;

  /** @returns {FPNamespace} */
  const ns = () => /** @type {FPNamespace} */ (window.__FP);

  /**
   * @param {Element|null} t
   * @returns {string}
   */
  const clickLabel = (t) => {
    if (!t) return '';
    const el = /** @type {HTMLElement & { value?: string }} */ (t);
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.id || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    // Row text is record data (names, account numbers); the trigger string is
    // exported verbatim, so keep only its length. The action keeps UI captions.
    if (el.closest(ROW_DATA_SEL)) return `<${text.length} chars>`;
    return ns().redact.scrubText(text.slice(0, CLICK_LABEL_MAX));
  };

  /**
   * @param {Element|null} el
   * @returns {string}
   */
  const keyOf = (el) =>
    el
      ? el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy') || el.getAttribute('data-qa') || el.getAttribute('formcontrolname') || el.getAttribute('name') || el.id || el.getAttribute('aria-label') || ''
      : '';

  /**
   * Q17: a click on an option in a custom listbox is a change on the control
   * that owns the listbox. Overlay panels are detached from the field, so the
   * owner is found through aria-owns / aria-controls first, then the field
   * wrapper for inline dropdowns, then the listbox's own identity.
   * @param {Element|null} target
   * @returns {{ key: string, option: Element, owner: Element|null }|null}
   */
  const listboxChange = (target) => {
    if (!target) return null;
    let opt = null;
    try {
      opt = target.closest(OPTION_SEL);
    } catch {
      return null;
    }
    if (!opt) return null;
    // A link or a menu item inside an option-shaped wrapper is navigation.
    const act = target.closest(NOT_A_CHOICE_SEL);
    if (act && (act === opt || opt.contains(act) || act.contains(opt))) return null;
    const box = opt.closest(LISTBOX_SEL);
    if (box && box.closest('[role="menu"], [role="menubar"]') && !opt.matches('[role="option"]')) return null;
    /** @type {Element|null} */
    let owner = null;
    let key = '';
    if (box && box.id) {
      const id = CSS.escape(box.id);
      owner = document.querySelector(`[aria-owns~="${id}"], [aria-controls~="${id}"]`);
    }
    if (!owner && box) {
      const by = (box.getAttribute('aria-labelledby') || '').split(/\s+/)[0];
      owner = by ? document.getElementById(by) : null;
    }
    const byRole = opt.matches('[role="option"]') || !!opt.closest('[role="listbox"]');
    const popup = owner ? (owner.getAttribute('aria-haspopup') || '').toLowerCase() : '';
    // aria-haspopup="true" means "menu" (WAI-ARIA 1.2); a menu's items are clicks.
    if (!byRole && (popup === 'true' || popup === 'menu')) return null;
    if (!byRole && opt.matches(AMBIGUOUS_OPTION_SEL) && (!box || box.matches(AMBIGUOUS_BOX_SEL))) {
      // Bootstrap-style dropdowns are selects only when they say so, or when
      // they live inside a form field.
      const selectLike =
        popup === 'listbox' || (!!owner && owner.matches('[role="combobox"]')) || !!(owner || opt).closest(FIELD_WRAP_SEL);
      if (!selectLike) return null;
    }
    if (owner) {
      key = keyOf(owner);
      if (!key && owner) {
        const wrap = owner.closest(FIELD_WRAP_SEL);
        key = keyOf(wrap ? wrap.querySelector(CONTROL_ID_SEL) : null);
      }
    }
    if (!key) {
      const wrap = opt.closest(FIELD_WRAP_SEL);
      const idEl = wrap && wrap.matches('[role="combobox"]') ? wrap : wrap ? wrap.querySelector(CONTROL_ID_SEL) : null;
      key = keyOf(idEl);
      if (key && !owner) owner = idEl;
    }
    if (!key) key = keyOf(box) || 'listbox';
    return { key, option: opt, owner: owner || box };
  };

  // ------------------------------------------------------------- actions

  /**
   * @param {Element} el
   * @returns {string|null}
   */
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.split(/\s+/)[0] || null;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      return INPUT_ROLE[type] || 'textbox';
    }
    if (tag === 'a' && !el.hasAttribute('href')) return null;
    if (tag === 'select') return el.hasAttribute('multiple') || Number(el.getAttribute('size')) > 1 ? 'listbox' : 'combobox';
    return IMPLIED_ROLE[tag] || null;
  };

  /**
   * @param {Element} el
   * @param {string|null} role
   * @returns {ActionTargetType}
   */
  const targetTypeOf = (el, role) => {
    const tag = el.tagName.toLowerCase();
    switch (role) {
      case 'link':
        return 'link';
      case 'button':
        return 'button';
      case 'tab':
        return 'tab';
      case 'menuitem':
      case 'menuitemradio':
      case 'menuitemcheckbox':
      case 'treeitem':
        return 'menuitem';
      case 'option':
        return 'option';
      case 'checkbox':
      case 'switch':
        return 'checkbox';
      case 'radio':
        return 'radio';
      case 'combobox':
      case 'listbox':
        return tag === 'select' ? 'select' : 'other';
      case 'row':
        return 'row';
      default:
        return tag === 'summary' ? 'summary' : 'other';
    }
  };

  /** How a click target was found; `none` means the raw event target. */
  /** @typedef {'strong'|'weak'|'pointer'|'none'} ResolvedBy */

  /**
   * The element the user meant, from the one the event landed on. Ancestors
   * that act on their own win; a row, list item or focusable wrapper counts
   * when nothing stronger is around it, and so does an element styled as
   * clickable within three ancestors — checked last, because computed style
   * is the expensive question.
   * @param {Element} el
   * @returns {{ target: Element, how: ResolvedBy }}
   */
  const resolveTarget = (el) => {
    const strong = el.closest(STRONG_SEL);
    if (strong) return { target: strong, how: 'strong' };
    const weak = el.closest(WEAK_SEL);
    /** @type {Element|null} */
    let pointer = null;
    /** @type {Element|null} */
    let cur = el;
    for (let i = 0; cur && i <= POINTER_ANCESTORS; i++, cur = cur.parentElement) {
      if (weak && cur === weak) break;
      if (cur === document.body || cur === document.documentElement) break;
      if (getComputedStyle(cur).cursor === 'pointer') pointer = cur;
      else if (pointer) break; // the pointer style started on the previous one
    }
    // The pointer element is nearer than the weak one when it sits inside it.
    if (pointer && (!weak || weak.contains(pointer))) return { target: pointer, how: 'pointer' };
    return weak ? { target: weak, how: 'weak' } : { target: el, how: 'none' };
  };

  /**
   * docs/12 B4 — the selector set for an arbitrary element. Primary is the
   * one selector builder every inventory uses, so an action's primary equals
   * the `selector` of the menu item or view option it was; the control-style
   * candidates ride along as fallbacks.
   * @param {Element} el
   * @param {string|null} role
   * @param {string} name
   * @returns {ActionSelectors}
   */
  const selectorsFor = (el, role, name) => {
    const s = ns().selectors;
    const set = s.buildSelectors(el, '', ns().framework.detect());
    const primary = s.forElement(el);
    const fallbacks = [set.primary, ...set.fallbacks].filter((x, i, arr) => x !== primary && arr.indexOf(x) === i);
    let count = 0;
    try {
      count = s.rootOf(el).querySelectorAll(primary).length;
    } catch {
      count = 0;
    }
    /** @type {SelectorStability} */
    let stability = 'fragile';
    if (primary === set.primary) stability = set.stability;
    else if (/^(#|\[data-)/.test(primary)) stability = 'stable';
    else if (!/ > |:nth-of-type/.test(primary)) stability = 'likely';
    if (count !== 1) stability = 'fragile';
    return { primary, fallbacks, shadowPath: set.shadowPath, stability, unique: count === 1, role, name };
  };

  /**
   * Whether the same text stands at the same place in a neighbouring row.
   * A label repeats ("Edit", "View"); a record's own text does not.
   * @param {Element} el
   * @param {Element} row
   * @param {string} text
   * @returns {boolean}
   */
  const repeatsAcrossRows = (el, row, text) => {
    const rel = el === row ? ':scope' : ns().selectors.relativeSelector(el, row);
    for (const sib of [row.nextElementSibling, row.previousElementSibling]) {
      if (!sib || sib.tagName !== row.tagName) continue;
      let twin = null;
      try {
        twin = rel === ':scope' ? sib : sib.querySelector(`:scope > ${rel}`);
      } catch {
        twin = null;
      }
      if (twin && ns().labels.accessibleName(twin, ACTION_TEXT_MAX) === text) return true;
    }
    return false;
  };

  /**
   * Label of the target. Inside a list, text that does not repeat across
   * rows is a record's own data and is kept as its length only; an element
   * with no interactive role has content, not a caption.
   * @param {Element} target
   * @param {ResolvedBy} how
   * @param {ActionTargetType} type
   * @param {string|null} listSelector
   * @param {boolean} ui   a view option, a menu item or something inside
   *   navigation: interface text, never record data, even when the group it
   *   sits in also looks like a repeating list
   * @returns {string}
   */
  const labelFor = (target, how, type, listSelector, ui) => {
    const r = ns().redact;
    const l = ns().labels;
    const editable = target.closest(EDITABLE_SEL);
    if (editable) return r.scrubText(l.accessibleName(editable, ACTION_TEXT_MAX)).slice(0, ACTION_TEXT_MAX);
    if (how === 'none') return '';
    const raw = l.accessibleName(target, ACTION_TEXT_MAX);
    if (!raw) return '';
    if (ui) return r.scrubText(raw).slice(0, ACTION_TEXT_MAX);
    if (type === 'row') return r.redactValue(raw);
    if (listSelector) {
      const row = target.closest(ROW_SEL);
      if (!row || !repeatsAcrossRows(target, row, raw)) return r.redactValue(raw);
    }
    return r.scrubText(raw).slice(0, ACTION_TEXT_MAX);
  };

  /**
   * The chosen option's visible text, for controls whose content is a choice
   * rather than something typed. Credential-shaped controls give nothing.
   * @param {Element} control
   * @returns {string|null}
   */
  const chosenOf = (control) => {
    const r = ns().redact;
    const l = ns().labels;
    if (r.isCredentialControl(control, l.resolveLabel(control).label)) return null;
    if (control instanceof HTMLSelectElement) {
      const texts = Array.from(control.selectedOptions).map((o) => l.cleanText(o.text, ACTION_TEXT_MAX));
      return texts.length ? r.scrubText(texts.join(', ')).slice(0, ACTION_TEXT_MAX) : null;
    }
    if (control instanceof HTMLInputElement) {
      if (control.type !== 'radio' && control.type !== 'checkbox') return null;
      const t = l.resolveLabel(control).label;
      return t ? r.scrubText(t).slice(0, ACTION_TEXT_MAX) : null;
    }
    const role = control.getAttribute('role');
    if (role === 'radio' || role === 'checkbox' || role === 'switch') {
      const t = l.accessibleName(control, ACTION_TEXT_MAX);
      return t ? r.scrubText(t).slice(0, ACTION_TEXT_MAX) : null;
    }
    return null;
  };

  /**
   * @param {'click'|'change'} kind
   * @param {string} trigger
   * @param {Element} target
   * @param {ResolvedBy} how
   * @param {FPObserveOptions} opts
   * @param {{ controlKey?: string|null, chosen?: string|null }} [change]
   * @returns {ActionDraft}
   */
  const buildAction = (kind, trigger, target, how, opts, change) => {
    const nav = ns().nav;
    const lists = ns().lists;
    const r = ns().redact;
    const role = roleOf(target);
    const type = targetTypeOf(target, role);
    const menuPath = nav.menuPathOf(target);
    const paginationRole = lists.paginationRoleOf(target);
    const listSelector = paginationRole || menuPath.length ? null : lists.listContainerOf(target);
    const viewGroup = nav.viewGroupOf(target);
    const inNav = nav.inNav(target);
    // A table that happens to sit in a sidebar still holds records.
    const navUi = inNav && !target.closest(ROW_DATA_SEL);
    const label = labelFor(target, how, type, listSelector, !!viewGroup || menuPath.length > 0 || navUi);
    // A length-only label names nothing a locator could use.
    const name = /^<\d+ chars>$/.test(label) ? '' : label;
    const anchor = target.closest('a[href]');
    const rawHref = anchor ? anchor.getAttribute('href') || '' : '';
    return {
      kind,
      trigger,
      at: new Date().toISOString(),
      origin: location.origin,
      route: nav.route(),
      viewKey: opts.viewKey ? opts.viewKey() : '',
      label,
      tag: target.tagName.toLowerCase(),
      targetType: type,
      selectors: target === document.body || target === document.documentElement ? null : selectorsFor(target, role, name),
      href: anchor ? nav.cleanHref(rawHref) : null,
      target: anchor ? anchor.getAttribute('target') : null,
      menuPath,
      inNav,
      viewGroup,
      pagination: paginationRole !== null,
      paginationRole,
      listSelector,
      danger: opts.isDanger ? opts.isDanger(label, target) : false,
      download: !!anchor && (anchor.hasAttribute('download') || DOC_EXT_RE.test(rawHref)),
      controlKey: change && change.controlKey ? change.controlKey : null,
      chosen: change && change.chosen ? r.scrubText(change.chosen).slice(0, ACTION_TEXT_MAX) : null,
      inIframe: window.top !== window.self,
    };
  };

  /**
   * @param {Event} e
   * @returns {Element|null} the real target, inside open shadow roots too
   */
  const deepTarget = (e) => {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const first = path.length ? path[0] : e.target;
    return first instanceof Element ? first : e.target instanceof Element ? e.target : null;
  };

  /**
   * @param {FPObserveOptions} opts
   */
  const start = (opts) => {
    stop();
    const { onTrigger, onThrottle } = opts;

    /**
     * The trigger always goes out; the action only when it could be built.
     * A page never sees an exception from here.
     * @param {string} trigger
     * @param {() => ActionDraft} build
     */
    const emit = (trigger, build) => {
      /** @type {ActionDraft|undefined} */
      let action;
      try {
        action = build();
      } catch {
        action = undefined;
      }
      onTrigger(trigger, action);
    };

    mo = new MutationObserver((records) => {
      // A2 volume breaker: records per rolling second.
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        windowCount = 0;
      }
      windowCount += records.length;
      if (!tripped && windowCount > BREAKER_PER_SEC) {
        tripped = true;
        const until = now + BREAKER_COOLDOWN_MS;
        onThrottle(until);
        setTimeout(() => {
          tripped = false;
          windowCount = 0;
        }, BREAKER_COOLDOWN_MS);
      }
      if (tripped) return;

      // A2 cheap filter: only structural changes outside decoration regions.
      let structural = false;
      for (const r of records) {
        if (r.type === 'characterData') continue;
        const t = r.target instanceof Element ? r.target : r.target.parentElement;
        if (t && t.closest(ANIM_SEL)) continue;
        if (r.type === 'attributes' || r.addedNodes.length || r.removedNodes.length) {
          structural = true;
          break;
        }
      }
      if (!structural) return;
      // docs/12 B3: an overlay menu may be gone before the next state.
      try {
        ns().nav.noteMutations(records);
      } catch {
        /* never let the page see an exception */
      }
      onTrigger('dom-change');
    });
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'disabled', 'readonly', 'required', 'aria-hidden', 'aria-expanded', 'open'],
    });

    /** @param {Event} e */
    const onClick = (e) => {
      // The trigger string is built as it always was, from the retargeted
      // event target; the action looks deeper.
      const el = e.target instanceof Element ? e.target : null;
      const deep = deepTarget(e);
      const box = listboxChange(el);
      if (box) {
        const trigger = `change:${box.key}`;
        if (!e.isTrusted) return onTrigger(trigger);
        return emit(trigger, () => {
          const owner = box.owner;
          const credential = owner ? ns().redact.isCredentialControl(owner, box.key) : ns().redact.CREDENTIAL_RE.test(box.key);
          const chosen = credential ? null : ns().labels.accessibleName(box.option, ACTION_TEXT_MAX) || null;
          return buildAction('change', trigger, box.option, 'strong', opts, { controlKey: box.key, chosen });
        });
      }
      const target = el ? el.closest(CLICKABLE_SEL) : null;
      const label = clickLabel(target);
      const trigger = label ? `click:${label}` : 'click';
      // A click the page dispatched itself is the page acting, not the user.
      if (!e.isTrusted || !deep) return onTrigger(trigger);
      emit(trigger, () => {
        const resolved = resolveTarget(deep);
        return buildAction('click', trigger, resolved.target, resolved.how, opts);
      });
    };
    document.addEventListener('click', onClick, true);
    teardown.push(() => document.removeEventListener('click', onClick, true));

    /** @param {Event} e */
    const onChange = (e) => {
      const t = deepTarget(e);
      if (!t) return;
      const tag = t.tagName;
      const type = (t.getAttribute('type') || '').toLowerCase();
      // Text inputs fire change on blur; that is typing, not a state change.
      if (tag !== 'SELECT' && type !== 'radio' && type !== 'checkbox' && type !== 'file' && !t.hasAttribute('role')) return;
      const key = keyOf(t) || tag.toLowerCase();
      const trigger = `change:${key}`;
      if (!e.isTrusted) return onTrigger(trigger);
      emit(trigger, () => buildAction('change', trigger, t, 'strong', opts, { controlKey: key, chosen: type === 'file' ? null : chosenOf(t) }));
    };
    document.addEventListener('change', onChange, true);
    teardown.push(() => document.removeEventListener('change', onChange, true));

    const onPop = () => onTrigger('nav:popstate');
    const onHash = () => onTrigger('nav:hashchange');
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onHash);
    teardown.push(() => window.removeEventListener('popstate', onPop));
    teardown.push(() => window.removeEventListener('hashchange', onHash));

    /** @param {MessageEvent} ev */
    const onMessage = (ev) => {
      if (ev.source !== window || !ev.data || ev.data.__fp !== 'nav') return;
      onTrigger(`nav:${String(ev.data.kind || 'unknown').slice(0, 20)}`);
    };
    window.addEventListener('message', onMessage);
    teardown.push(() => window.removeEventListener('message', onMessage));

    onTrigger('load');
  };

  const stop = () => {
    if (mo) mo.disconnect();
    mo = null;
    for (const fn of teardown) fn();
    teardown = [];
    tripped = false;
  };

  window.__FP.observe = { start, stop, degraded: () => tripped };
})();
