/* Sanitised DOM snapshot — docs/02 "DOM snapshot", docs/10 A1. Clone, redact, scrub page text,
   hollow, strip, truncate, gzip, base64. Open shadow roots are serialised as
   declarative `<template shadowrootmode="open">` so the file re-renders them.
   Never touches the live document. Classic script: exposes window.__FP.domSnapshot. */
(() => {
  window.__FP = window.__FP || {};

  const MAX_ATTR = 300;
  const MAX_DATA_URI = 64;
  const SHADOW_DEPTH = 10; // CAPS.SHADOW_DEPTH
  const HOLLOW_TAGS = 'script, style, noscript, svg';
  const CONTROL_SEL = 'input, select, textarea, [contenteditable="true"]';
  /** Attributes whose value is text a person reads. */
  const TEXT_ATTRS = ['title', 'alt', 'aria-label', 'placeholder'];
  const TEXT_ATTR_SEL = TEXT_ATTRS.map((a) => `[${a}]`).join(', ');
  const NON_BLANK_RE = /\S/;

  /** @returns {FPNamespace} */
  const ns = () => /** @type {FPNamespace} */ (window.__FP);

  /**
   * @param {Node} root
   */
  const stripComments = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    /** @type {Node[]} */
    const doomed = [];
    while (walker.nextNode()) doomed.push(walker.currentNode);
    for (const n of doomed) n.parentNode?.removeChild(n);
  };

  const VALUE_MAX = 200;
  const HEADER_CELL_SEL = 'th, [role="columnheader"]';
  /**
   * @param {Text} n
   * @param {string} replacement
   */
  const replaceText = (n, replacement) => {
    const v = n.nodeValue || '';
    const lead = /^\s*/.exec(v)?.[0] || '';
    const trail = /\s*$/.exec(v)?.[0] || '';
    n.nodeValue = lead + replacement + trail;
  };

  /**
   * docs/11 F6 — names and addresses that no pattern can see. An element
   * whose class or id names what it holds (`userNameVal`) loses its text; a
   * text node right after a label such as "Name of Assessee" becomes the
   * label's replacement. Each redacted value is learned, so the pattern pass
   * that follows also removes it where it recurs (a greeting, a tooltip).
   * @param {ParentNode & Node} root
   */
  const scrubStructural = (root) => {
    const r = ns().redact;
    for (const el of root.querySelectorAll('[class], [id]')) {
      const h = r.hintRuleFor(el);
      if (!h) continue;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let first = true;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const v = n.nodeValue || '';
        if (!NON_BLANK_RE.test(v) || v.trim().startsWith('<') || r.isDecoration(n)) continue;
        r.learn(v, h.replacement);
        if (first) replaceText(/** @type {Text} */ (n), h.replacement);
        else n.nodeValue = '';
        first = false;
      }
    }
    /** @type {{ replacement: string }|null} */
    let pending = null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const v = n.nodeValue || '';
      if (!NON_BLANK_RE.test(v)) continue;
      const t = v.trim();
      // A separator between label and value is not the value.
      if (/^[:\-–—|*]$/.test(t)) continue;
      const label = r.labelRuleFor(t);
      if (label) {
        const cell = n.parentElement && n.parentElement.closest(HEADER_CELL_SEL);
        // A column header labels a whole column, not the next text node.
        pending = cell ? null : label;
        continue;
      }
      if (pending && t.length <= VALUE_MAX && !t.startsWith('<')) {
        r.learn(t, pending.replacement);
        replaceText(/** @type {Text} */ (n), pending.replacement);
      }
      pending = null;
    }
  };

  /**
   * Rule 4 on page text: every text node and every attribute that carries
   * human-readable text goes through the redaction packs, so identifiers a
   * page renders as plain text (table cells, tooltips) never reach the file.
   * Runs on the clone only. One pass over text nodes, one over elements.
   * @param {ParentNode & Node} root
   */
  const scrubPageText = (root) => {
    const r = ns().redact;
    scrubStructural(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const v = n.nodeValue;
      if (!v || !NON_BLANK_RE.test(v)) continue;
      const out = r.scrubText(v);
      if (out !== v) n.nodeValue = out;
    }
    for (const el of root.querySelectorAll(TEXT_ATTR_SEL)) {
      for (const name of TEXT_ATTRS) {
        const v = el.getAttribute(name);
        if (!v) continue;
        const out = r.scrubText(v);
        if (out !== v) el.setAttribute(name, out);
      }
    }
  };

  /**
   * @param {ParentNode} root
   */
  const truncateAttributes = (root) => {
    for (const el of root.querySelectorAll('*')) {
      for (const attr of Array.from(el.attributes)) {
        const v = attr.value;
        if (/^\s*data:/i.test(v)) {
          if (v.length > MAX_DATA_URI) el.setAttribute(attr.name, v.slice(0, MAX_DATA_URI) + '…');
        } else if (v.length > MAX_ATTR) {
          el.setAttribute(attr.name, v.slice(0, MAX_ATTR) + '…');
        }
      }
    }
  };

  /**
   * Rewrites one cloned control. Option lists are structure and stay; only
   * the selection state and typed content are values.
   * @param {Element} el   the cloned control
   * @param {string} replacement
   */
  const hollowControl = (el, replacement) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') {
      el.textContent = replacement;
      el.removeAttribute('value');
    } else if (tag === 'select') {
      for (const o of el.querySelectorAll('option[selected]')) o.removeAttribute('selected');
    } else if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'radio' || type === 'checkbox' || type === 'submit' || type === 'button' || type === 'reset') return;
      if (replacement) el.setAttribute('value', replacement);
      else el.removeAttribute('value');
    } else {
      el.textContent = replacement;
    }
  };

  /**
   * Rule 2 applied to the clone of one root. The live root and its clone
   * yield controls in the same order, so they pair by index; cloneNode copies
   * the `value` attribute but not the live `.value` property.
   * @param {ParentNode} liveRoot
   * @param {ParentNode} cloneRoot
   */
  const redactControls = (liveRoot, cloneRoot) => {
    const live = Array.from(liveRoot.querySelectorAll(CONTROL_SEL));
    const cloned = Array.from(cloneRoot.querySelectorAll(CONTROL_SEL));
    if (live.length !== cloned.length) {
      for (const el of cloned) hollowControl(el, '<redacted>');
      return;
    }
    for (let i = 0; i < cloned.length; i++) {
      const src = /** @type {HTMLElement} */ (live[i]);
      const dst = cloned[i];
      const tag = src.tagName.toLowerCase();
      const type = (src.getAttribute('type') || '').toLowerCase();
      if (type === 'hidden') {
        dst.setAttribute('value', '<hidden>');
        continue;
      }
      if (type === 'file') {
        dst.removeAttribute('value');
        continue;
      }
      const label = ns().labels.resolveLabel(src).label;
      if (ns().redact.isCredentialControl(src, label)) {
        hollowControl(dst, '<redacted>');
        continue;
      }
      const v = tag === 'input' || tag === 'select' || tag === 'textarea' ? /** @type {HTMLInputElement} */ (src).value : src.textContent || '';
      hollowControl(dst, ns().redact.redactValue(v));
    }
  };

  /**
   * A1 — serialise each open shadow root beneath liveRoot into the matching
   * clone host as a declarative shadow template, recursively.
   * @param {ParentNode} liveRoot
   * @param {ParentNode} cloneRoot
   * @param {number} depth
   */
  const inlineShadowRoots = (liveRoot, cloneRoot, depth) => {
    if (depth >= SHADOW_DEPTH) return;
    const live = liveRoot.querySelectorAll('*');
    const cloned = cloneRoot.querySelectorAll('*');
    if (live.length !== cloned.length) return;
    for (let i = 0; i < live.length; i++) {
      const sr = live[i].shadowRoot;
      if (!sr) continue;
      const tpl = document.createElement('template');
      tpl.setAttribute('shadowrootmode', 'open');
      const frag = tpl.content;
      for (const child of sr.childNodes) frag.appendChild(child.cloneNode(true));
      redactControls(sr, frag);
      inlineShadowRoots(sr, frag, depth + 1);
      cloned[i].insertBefore(tpl, cloned[i].firstChild);
    }
  };

  /**
   * Hollow, strip, pattern-scrub and truncate one tree, then each inlined shadow template's
   * content (a separate fragment that querySelectorAll does not enter).
   * @param {ParentNode & Node} root
   * @param {number} depth
   */
  const sanitise = (root, depth) => {
    for (const el of root.querySelectorAll(HOLLOW_TAGS)) el.textContent = '';
    stripComments(root);
    scrubPageText(root);
    truncateAttributes(root);
    if (depth >= SHADOW_DEPTH) return;
    for (const tpl of root.querySelectorAll('template[shadowrootmode]')) {
      sanitise(/** @type {HTMLTemplateElement} */ (tpl).content, depth + 1);
    }
  };

  /**
   * @param {Uint8Array} bytes
   * @returns {string}
   */
  const toBase64 = (bytes) => {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
    }
    return btoa(bin);
  };

  /**
   * @param {string} text
   * @returns {Promise<string>}
   */
  const gzipBase64 = async (text) => {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    return toBase64(new Uint8Array(buf));
  };

  /**
   * @returns {Promise<string|null>}
   */
  const snapshot = async () => {
    try {
      const clone = /** @type {HTMLElement} */ (document.documentElement.cloneNode(true));
      // Redact and inline shadow roots before hollowing: both pair live and
      // clone elements by index, and hollowing changes nothing structural
      // but removing nodes would.
      redactControls(document, clone);
      // The live root must be the element that was cloned: querySelectorAll
      // on the document also yields <html>, on the clone it does not, and
      // the two lists would never pair up.
      inlineShadowRoots(document.documentElement, clone, 0);
      sanitise(clone, 0);
      const html = '<!DOCTYPE html>\n' + clone.outerHTML;
      return await gzipBase64(html);
    } catch {
      return null;
    }
  };

  window.__FP.domSnapshot = { snapshot };
})();
