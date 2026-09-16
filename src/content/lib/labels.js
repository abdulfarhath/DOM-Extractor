/* Label resolution — docs/02 "Label resolution". Eight strategies, in order,
   recording which one won so the summary can flag weak mappings.
   Classic script: exposes window.__MCADC.labels. */
(() => {
  window.__MCADC = window.__MCADC || {};

  const MAX_LABEL = 120;
  const MAX_SIBLING = 80;
  const CONTAINER_SEL = '.form-group, .field, mat-form-field, .col, .row';
  const LABEL_SEL = 'label, .label, .control-label, mat-label';

  /**
   * Collapse whitespace and cap length. innerText is preferred because it
   * respects CSS visibility, which matters for Angular's hidden helper labels.
   * @param {string|null|undefined} text
   * @param {number} [max]
   * @returns {string}
   */
  const cleanText = (text, max = MAX_LABEL) =>
    (text || '').replace(/\s+/g, ' ').trim().slice(0, max);

  /**
   * @param {Element|null} el
   * @returns {string}
   */
  const textOf = (el) => {
    if (!el) return '';
    const t = el instanceof HTMLElement ? el.innerText : el.textContent;
    return cleanText(t);
  };

  /**
   * Text of a label element minus any nested control's own value, so a
   * wrapping <label>PAN <input></label> reads as "PAN" not "PAN <10 chars>".
   * @param {Element} labelEl
   * @returns {string}
   */
  const labelText = (labelEl) => {
    const t = textOf(labelEl);
    // Strip trailing required-marker glyphs MCA uses (" *", "*:") for cleaner keys.
    return t.replace(/\s*[*:]+\s*$/, '').trim();
  };

  /**
   * @param {ControlElement} el
   * @returns {{ label: string, labelSource: LabelSource }}
   */
  const resolveLabel = (el) => {
    // 1. label[for]
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
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
      const t = cleanText(
        by.split(/\s+/).map((id) => textOf(document.getElementById(id))).filter(Boolean).join(' ')
      );
      if (t) return { label: t, labelSource: 'aria-labelledby' };
    }
    // 4. aria-label
    const aria = cleanText(el.getAttribute('aria-label'));
    if (aria) return { label: aria, labelSource: 'aria-label' };
    // 5. nearest label-ish element inside the closest container
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

  window.__MCADC.labels = { resolveLabel, cleanText };
})();
