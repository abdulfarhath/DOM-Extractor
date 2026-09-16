/* Label resolution — docs/02. Eight strategies in order; none depends on a
   language. Records which strategy won so the summary can flag weak targets.
   Classic script: exposes window.__FP.labels. */
(() => {
  window.__FP = window.__FP || {};

  const MAX_LABEL = 120;
  const MAX_SIBLING = 80;
  const CONTAINER_SEL = '[class*="form-group"], [class*="form-field"], [class*="field"], mat-form-field, [class*="control"], [class*="input-group"]';
  const LABEL_SEL = 'label, [class*="label"], mat-label, legend';

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

  window.__FP.labels = { resolveLabel, cleanText, textOf };
})();
