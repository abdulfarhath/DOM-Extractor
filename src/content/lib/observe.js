/* Capture triggers — docs/02 "When to capture". Listens only; every handler
   ends in a call to the orchestrator's schedule function. Nothing here reads
   values or touches the page.
   Classic script: exposes window.__MCADC.observe. */
(() => {
  window.__MCADC = window.__MCADC || {};

  const CLICK_LABEL_MAX = 40;
  const CLICKABLE_SEL = 'button, a, [role="tab"], [role="button"], input[type="submit"], input[type="button"], li, label';
  /** Options inside custom (non-native) dropdowns — Angular Material, ng-select, ARIA listboxes. */
  const OPTION_SEL = '[role="option"], .mat-option, .mat-mdc-option, .ng-option, .dropdown-item, .select2-results__option';
  const LISTBOX_SEL = '[role="listbox"], .mat-select-panel, .mat-mdc-select-panel, .ng-dropdown-panel, .dropdown-menu, .select2-results';
  const FIELD_WRAP_SEL = 'mat-form-field, ng-select, .form-group, .field, [role="combobox"]';
  const CONTROL_ID_SEL = '[formcontrolname], [name], [id]';

  /** @type {MutationObserver|null} */
  let mo = null;
  /** @type {Array<() => void>} */
  let teardown = [];

  /**
   * @param {Element|null} t
   * @returns {string}
   */
  const clickLabel = (t) => {
    if (!t) return '';
    const el = /** @type {HTMLElement & { value?: string }} */ (t);
    const text = (el.innerText || el.value || el.id || el.getAttribute('aria-label') || '')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, CLICK_LABEL_MAX);
  };

  /**
   * Q17: a click on an option in a custom listbox is a change on the field
   * that owns the listbox. Returns the field's key, or null when the click was
   * not on an option. Overlay panels are usually detached from the field, so
   * the owner is found through aria-owns / aria-controls first, then by
   * walking up to the field wrapper for inline dropdowns.
   * @param {Element|null} target
   * @returns {string|null}
   */
  const listboxChangeKey = (target) => {
    const opt = target ? target.closest(OPTION_SEL) : null;
    if (!opt) return null;
    const box = opt.closest(LISTBOX_SEL);
    /** @param {Element|null} el */
    const keyOf = (el) =>
      el ? el.getAttribute('formcontrolname') || el.getAttribute('name') || el.id || '' : '';
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
      key = keyOf(wrap ? wrap.querySelector(CONTROL_ID_SEL) : null);
    }
    if (!key) key = (box && box.id) || 'listbox';
    return key;
  };

  /**
   * @param {(trigger: string) => void} onTrigger
   */
  const start = (onTrigger) => {
    stop();

    // Structural changes. Attribute filter catches class/style toggles that
    // reveal conditional sections without adding nodes.
    mo = new MutationObserver(() => onTrigger('dom-change'));
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'disabled', 'readonly', 'required', 'aria-hidden'],
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
      if (!(t instanceof HTMLElement)) return;
      const tag = t.tagName;
      const type = (t.getAttribute('type') || '').toLowerCase();
      if (tag !== 'SELECT' && type !== 'radio' && type !== 'checkbox') return;
      const key = t.id || t.getAttribute('name') || t.getAttribute('formcontrolname') || tag.toLowerCase();
      onTrigger(`change:${key}`);
    };
    document.addEventListener('change', onChange, true);
    teardown.push(() => document.removeEventListener('change', onChange, true));

    // SPA navigation. pushState/replaceState arrive from the MAIN-world hook
    // (see net-hook.js); popstate/hashchange are ordinary events.
    const onPop = () => onTrigger('nav:popstate');
    const onHash = () => onTrigger('nav:hashchange');
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onHash);
    teardown.push(() => window.removeEventListener('popstate', onPop));
    teardown.push(() => window.removeEventListener('hashchange', onHash));

    /** @param {MessageEvent} ev */
    const onMessage = (ev) => {
      if (ev.source !== window || !ev.data || ev.data.__mcadc !== 'nav') return;
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
  };

  window.__MCADC.observe = { start, stop };
})();
