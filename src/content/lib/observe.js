/* Capture triggers — docs/02 "When to capture", docs/10 A2 (mutation circuit
   breaker), docs/09 Q17 (custom listboxes). Listens only; every handler ends
   in a trigger callback. Nothing here reads values or touches the page.
   Classic script: exposes window.__FP.observe. */
(() => {
  window.__FP = window.__FP || {};

  const CLICK_LABEL_MAX = 40;
  const BREAKER_PER_SEC = 500; // TIMING.MUTATION_BREAKER_PER_SEC
  const BREAKER_COOLDOWN_MS = 10000; // TIMING.MUTATION_BREAKER_COOLDOWN_MS
  const CLICKABLE_SEL = 'button, a, [role="tab"], [role="button"], [role="menuitem"], input[type="submit"], input[type="button"], summary, li, label';
  const OPTION_SEL = '[role="option"], [role="listbox"] *, .mat-option, .mat-mdc-option, .ng-option, .dropdown-item, .select2-results__option';
  const LISTBOX_SEL = '[role="listbox"], .mat-select-panel, .mat-mdc-select-panel, .ng-dropdown-panel, .dropdown-menu, .select2-results';
  const FIELD_WRAP_SEL = 'mat-form-field, ng-select, [class*="form-group"], [class*="form-field"], [class*="field"], [role="combobox"]';
  const CONTROL_ID_SEL = '[data-testid], [data-test], [data-cy], [data-qa], [formcontrolname], [name], [id]';
  /** Regions that mutate for decoration, not structure. */
  const ANIM_SEL = '[class*="anim"], [class*="spinner"], [class*="loader"], [class*="loading"], [class*="carousel"], [class*="ticker"], [class*="marquee"], [class*="progress"], [class*="skeleton"], canvas, video, [aria-live]';

  /** @type {MutationObserver|null} */
  let mo = null;
  /** @type {Array<() => void>} */
  let teardown = [];
  let tripped = false;
  let windowStart = 0;
  let windowCount = 0;

  /**
   * @param {Element|null} t
   * @returns {string}
   */
  const clickLabel = (t) => {
    if (!t) return '';
    const el = /** @type {HTMLElement & { value?: string }} */ (t);
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.id || '').replace(/\s+/g, ' ').trim();
    return text.slice(0, CLICK_LABEL_MAX);
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
   * @returns {string|null}
   */
  const listboxChangeKey = (target) => {
    if (!target) return null;
    let opt = null;
    try {
      opt = target.closest(OPTION_SEL);
    } catch {
      return null;
    }
    if (!opt) return null;
    const box = opt.closest(LISTBOX_SEL);
    let key = '';
    if (box && box.id) {
      const id = CSS.escape(box.id);
      const owner = document.querySelector(`[aria-owns~="${id}"], [aria-controls~="${id}"]`);
      key = keyOf(owner);
      if (!key && owner) {
        const wrap = owner.closest(FIELD_WRAP_SEL);
        key = keyOf(wrap ? wrap.querySelector(CONTROL_ID_SEL) : null);
      }
    }
    if (!key) {
      const wrap = opt.closest(FIELD_WRAP_SEL);
      key = keyOf(wrap && wrap.matches('[role="combobox"]') ? wrap : wrap ? wrap.querySelector(CONTROL_ID_SEL) : null);
    }
    if (!key) key = keyOf(box) || 'listbox';
    return key;
  };

  /**
   * @param {FPObserveOptions} opts
   */
  const start = (opts) => {
    stop();
    const { onTrigger, onThrottle } = opts;

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
      if (structural) onTrigger('dom-change');
    });
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'disabled', 'readonly', 'required', 'aria-hidden', 'aria-expanded', 'open'],
    });

    /** @param {Event} e */
    const onClick = (e) => {
      const el = e.target instanceof Element ? e.target : null;
      const changeKey = listboxChangeKey(el);
      if (changeKey) {
        onTrigger(`change:${changeKey}`);
        return;
      }
      const target = el ? el.closest(CLICKABLE_SEL) : null;
      const label = clickLabel(target);
      onTrigger(label ? `click:${label}` : 'click');
    };
    document.addEventListener('click', onClick, true);
    teardown.push(() => document.removeEventListener('click', onClick, true));

    /** @param {Event} e */
    const onChange = (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const tag = t.tagName;
      const type = (t.getAttribute('type') || '').toLowerCase();
      // Text inputs fire change on blur; that is typing, not a state change.
      if (tag !== 'SELECT' && type !== 'radio' && type !== 'checkbox' && type !== 'file' && !t.hasAttribute('role')) return;
      onTrigger(`change:${keyOf(t) || tag.toLowerCase()}`);
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
