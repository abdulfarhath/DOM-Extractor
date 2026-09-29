/* Label resolution — docs/02. Eight strategies in order; none depends on a
   language. Records which strategy won so the summary can flag weak targets.
   Classic script: exposes window.__FP.labels. */
(() => {
  window.__FP = window.__FP || {};

  const MAX_LABEL = 120;
  const MAX_SIBLING = 80;
  const CONTAINER_SEL = '[class*="form-group"], [class*="form-field"], [class*="field"], mat-form-field, [class*="control"], [class*="input-group"]';
  const LABEL_SEL = 'label, [class*="label"], mat-label, legend';
  const MAX_NAME = 80; // CAPS.NAV_TEXT
  const NAME_MAX_NODES = 300;
  const BUTTON_INPUT_RE = /^(button|submit|reset)$/;
  /** Elements whose content is a value, not a caption. */
  const VALUE_HOLDER_SEL = 'input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"], [role="spinbutton"]';
  /** Subtrees that never contribute to an element's name. */
  const NAME_SKIP_SEL = `script, style, template, [aria-hidden="true"], ul, ol, menu, [role="menu"], [role="group"], [role="tree"], .dropdown-menu, mat-icon, .material-icons, [class*="material-symbols"], [class*="badge"], ${VALUE_HOLDER_SEL}`;

  /**
   * Collapse whitespace and cap length.
   * @param {string|null|undefined} text
   * @param {number} [max]
   * @returns {string}
   */
  const cleanText = (text, max = MAX_LABEL) => (text || '').replace(/\s+/g, ' ').trim().slice(0, max);

  /**
   * innerText respects CSS visibility, which matters for hidden helper labels;
   * textContent is the fallback for nodes without layout.
   * @param {Element|null} el
   * @param {number} [max]
   * @returns {string}
   */
  const textOf = (el, max = MAX_LABEL) => {
    if (!el) return '';
    const t = el instanceof HTMLElement ? el.innerText : el.textContent;
    return cleanText(t, max);
  };

  /**
   * Label text minus trailing required markers (`*`, `:`) — punctuation, not
   * language, so safe to strip everywhere.
   * @param {Element} labelEl
   * @returns {string}
   */
  const labelText = (labelEl) => textOf(labelEl).replace(/\s*[*:：]+\s*$/, '').trim();

  /**
   * The root to resolve ids against — a shadow root scopes its own ids.
   * @param {Element} el
   * @returns {Document|ShadowRoot}
   */
  const rootOf = (el) => {
    const r = el.getRootNode();
    return r instanceof ShadowRoot ? r : document;
  };

  /**
   * @param {Element} el
   * @returns {{ label: string, labelSource: LabelSource }}
   */
  const resolveLabel = (el) => {
    const root = rootOf(el);
    // 1. label[for]
    if (el.id) {
      const l = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const t = l ? labelText(l) : '';
      if (t) return { label: t, labelSource: 'for' };
    }
    // 2. wrapping <label>
    const wrap = el.closest('label');
    if (wrap) {
      const t = labelText(wrap);
      if (t) return { label: t, labelSource: 'wrap' };
    }
    // 3. aria-labelledby — may reference several ids
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = cleanText(by.split(/\s+/).map((id) => textOf(root.getElementById(id))).filter(Boolean).join(' '));
      if (t) return { label: t, labelSource: 'aria-labelledby' };
    }
    // 4. aria-label
    const aria = cleanText(el.getAttribute('aria-label'));
    if (aria) return { label: aria, labelSource: 'aria-label' };
    // 5. label-ish element inside the closest form-field container
    const box = el.closest(CONTAINER_SEL);
    if (box) {
      const lab = box.querySelector(LABEL_SEL);
      const t = lab ? labelText(lab) : '';
      if (t) return { label: t, labelSource: 'container' };
    }
    // 6. previous sibling element, short text only
    const prev = el.previousElementSibling;
    if (prev) {
      const t = textOf(prev);
      if (t && t.length < MAX_SIBLING) return { label: t, labelSource: 'sibling' };
    }
    // 7. placeholder
    const ph = cleanText(el.getAttribute('placeholder'));
    if (ph) return { label: ph, labelSource: 'placeholder' };
    // 8. nothing
    return { label: '', labelSource: 'none' };
  };

  /**
   * Text nodes beneath `el`, leaving out what is not part of its name: nested
   * menus, decorative icons, counters, and anything that holds a value.
   * Reads textContent, not innerText, so the result does not follow CSS — a
   * collapsed item is named the same as an open one, whatever text-transform
   * or display say.
   * @param {Element} el
   * @param {number} max
   * @returns {string}
   */
  const ownText = (el, max) => {
    let out = '';
    let visited = 0;
    /** @type {Node|null} */
    let lastParent = null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node instanceof Element && node.matches(NAME_SKIP_SEL) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    while (visited++ < NAME_MAX_NODES && out.length < max * 2 && walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType !== Node.TEXT_NODE || !node.nodeValue) continue;
      // Frameworks strip the whitespace between elements; put it back.
      out += (node.parentNode !== lastParent ? ' ' : '') + node.nodeValue;
      lastParent = node.parentNode;
    }
    return cleanText(out, max);
  };

  /**
   * Accessible name, in the order role-based locators resolve it:
   * aria-labelledby, aria-label, own text, title, an inner image's alt.
   * Anything that holds a value — inputs, selects, editable regions — is
   * named by its label only; its content never becomes a name.
   * @param {Element} el
   * @param {number} [max]
   * @returns {string}
   */
  const accessibleName = (el, max = MAX_NAME) => {
    const root = rootOf(el);
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const parts = by.split(/\s+/).map((id) => {
        const ref = id ? root.getElementById(id) : null;
        return ref ? ownText(ref, max) : '';
      });
      const t = cleanText(parts.filter(Boolean).join(' '), max);
      if (t) return t;
    }
    const aria = cleanText(el.getAttribute('aria-label'), max);
    if (aria) return aria;
    const tag = el.tagName;
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || '').toLowerCase();
      // A button-type input's value attribute is its caption, written in the markup.
      const caption = BUTTON_INPUT_RE.test(type) ? cleanText(el.getAttribute('value'), max) : type === 'image' ? cleanText(el.getAttribute('alt'), max) : '';
      if (caption) return caption;
    }
    if (el.matches(VALUE_HOLDER_SEL)) return cleanText(resolveLabel(el).label || el.getAttribute('title'), max);
    if (tag === 'IMG') return cleanText(el.getAttribute('alt') || el.getAttribute('title'), max);
    const text = ownText(el, max);
    if (text) return text;
    const title = cleanText(el.getAttribute('title'), max);
    if (title) return title;
    const inner = el.querySelector('img[alt], [aria-label], [title], svg > title');
    if (!inner) return '';
    return cleanText(inner.getAttribute('alt') || inner.getAttribute('aria-label') || inner.getAttribute('title') || inner.textContent, max);
  };

  window.__FP.labels = { resolveLabel, cleanText, textOf, accessibleName };
})();
