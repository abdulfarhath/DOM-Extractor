/* List, table, pagination and download capture — docs/02 "List, table and
   pagination capture". What a scraper needs and a screenshot cannot give: the
   repeat container, the per-item slots, where "next" lives. Text samples are
   redacted to their length. Classic script: exposes window.__FP.lists. */
(() => {
  window.__FP = window.__FP || {};

  const MAX_TABLES = 20; // CAPS.TABLES
  const MAX_REPEATS = 20; // CAPS.REPEATS
  const MAX_SLOTS = 12; // CAPS.SLOTS
  const MAX_PAGINATION = 5; // CAPS.PAGINATION
  const MAX_DOWNLOADS = 40; // CAPS.DOWNLOADS
  const MAX_HEADERS = 40;
  const MIN_REPEAT = 3;
  const DOC_EXT_RE = /\.(pdf|docx?|xlsx?|csv|pptx?|zip|txt|json|xml|rtf|odt|ods)(?:[?#]|$)/i;

  /** Containers whose repeated children are never "items" in the scraping sense. */
  const SKIP_CONTAINER_SEL = 'table, thead, tbody, tfoot, tr, select, datalist, optgroup, [role="tablist"], [role="listbox"], [role="menu"], [role="menubar"], [role="radiogroup"], head, script, style, svg, nav';
  const PAGINATION_SEL = '[class*="pag"], [aria-label*="page" i], [rel="next"], [rel="prev"], [role="navigation"][aria-label*="pag" i]';

  /** @returns {FPNamespace} */
  const ns = () => /** @type {FPNamespace} */ (window.__FP);

  /**
   * @param {Element} el
   * @returns {string}
   */
  const sampleText = (el) => ns().redact.redactValue(ns().labels.textOf(el, 500));

  /**
   * Structural signature of an element: tag plus its stable classes, so
   * siblings rendered from the same template group together.
   * @param {Element} el
   * @returns {string}
   */
  const sig = (el) => {
    const raw = typeof el.className === 'string' ? el.className : '';
    const cls = raw
      .split(/\s+/)
      .filter((c) => c && !/\d{3,}|[0-9a-f]{5,}|active|selected|odd|even|first|last|hover|focus/i.test(c))
      .sort()
      .slice(0, 3)
      .join('.');
    return `${el.tagName}.${cls}`;
  };

  /**
   * @param {Element} el
   * @returns {boolean}
   */
  const hasContent = (el) => !!(el.textContent && el.textContent.trim()) || !!el.querySelector('a[href], img');

  // --------------------------------------------------------------- tables

  /**
   * @param {ParentNode} root
   * @returns {TablePattern[]}
   */
  const collectTables = (root) => {
    const f = ns().fields;
    const s = ns().selectors;
    /** @type {TablePattern[]} */
    const out = [];
    for (const t of f.queryDeep(root, 'table, [role="table"], [role="grid"], [role="treegrid"]')) {
      if (out.length >= MAX_TABLES) break;
      if (!f.isVisible(t)) continue;
      const isNative = t.tagName === 'TABLE';
      const headerCells = isNative
        ? Array.from(t.querySelectorAll('thead th, thead td, tr:first-child th'))
        : Array.from(t.querySelectorAll('[role="columnheader"]'));
      const headers = headerCells.map((h) => ns().redact.scrubText(ns().labels.textOf(h, 80))).filter(Boolean).slice(0, MAX_HEADERS);
      const rows = isNative
        ? Array.from(t.querySelectorAll('tbody tr, :scope > tr')).filter((r) => !r.querySelector('th') || !!r.querySelector('td'))
        : Array.from(t.querySelectorAll('[role="row"]')).filter((r) => !r.querySelector('[role="columnheader"]'));
      if (!rows.length && !headers.length) continue;
      const sample = rows.find((r) => f.isVisible(r)) || rows[0];
      const cells = sample ? Array.from(sample.querySelectorAll(isNative ? ':scope > td, :scope > th' : '[role="cell"], [role="gridcell"], [role="rowheader"]')) : [];
      out.push({
        containerSelector: s.forElement(t),
        shadowPath: s.hostPath(t),
        headers,
        rowCount: rows.length,
        rowSelector: isNative ? 'tbody tr' : '[role="row"]',
        sampleRow: cells.slice(0, MAX_HEADERS).map((c, i) => ({
          selector: isNative ? `${c.tagName.toLowerCase()}:nth-child(${i + 1})` : `[role="${c.getAttribute('role')}"]:nth-child(${i + 1})`,
          sample: sampleText(c),
        })),
      });
    }
    return out;
  };

  // -------------------------------------------------------------- repeats

  /**
   * Distinct text/link/image leaves inside the first item, as item-relative
   * selectors with redacted samples.
   * @param {Element} item
   * @returns {RepeatSlot[]}
   */
  const slotsOf = (item) => {
    const s = ns().selectors;
    /** @type {RepeatSlot[]} */
    const out = [];
    const seen = new Set();
    /** @param {Element} el @param {RepeatSlot['kind']} kind @param {string} sample @param {boolean} [download] */
    const add = (el, kind, sample, download) => {
      if (out.length >= MAX_SLOTS) return;
      const rel = el === item ? ':scope' : s.relativeSelector(el, item);
      const k = `${kind}|${rel}`;
      if (seen.has(k)) return;
      seen.add(k);
      /** @type {RepeatSlot} */
      const slot = { name: `slot_${out.length + 1}`, selector: rel, kind, sample };
      if (download) slot.download = true;
      out.push(slot);
    };
    for (const a of item.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      add(a, 'link', '<href>', a.hasAttribute('download') || DOC_EXT_RE.test(href));
    }
    for (const img of item.querySelectorAll('img, [role="img"]')) add(img, 'image', '<img>');
    // Text leaves: elements whose own text nodes carry content.
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const tn = walker.currentNode;
      if (!tn.nodeValue || !tn.nodeValue.trim()) continue;
      const parent = tn.parentElement;
      if (!parent || parent.closest('script, style, a[href]')) continue;
      add(parent, 'text', ns().redact.redactValue(tn.nodeValue.trim()));
    }
    return out;
  };

  /**
   * @param {ParentNode} root
   * @returns {RepeatPattern[]}
   */
  const collectRepeats = (root) => {
    const f = ns().fields;
    const s = ns().selectors;
    /** @type {RepeatPattern[]} */
    const found = [];
    /** @type {Set<Element>} */
    const claimed = new Set();

    /** @param {Element} container */
    const consider = (container) => {
      if (claimed.has(container) || container.matches(SKIP_CONTAINER_SEL) || container.closest(SKIP_CONTAINER_SEL)) return;
      const kids = Array.from(container.children).filter((k) => !/^(SCRIPT|STYLE|TEMPLATE|LINK|BR|HR)$/.test(k.tagName));
      if (kids.length < MIN_REPEAT) return;
      /** @type {Map<string, Element[]>} */
      const groups = new Map();
      for (const k of kids) {
        const g = sig(k);
        const arr = groups.get(g) || [];
        arr.push(k);
        groups.set(g, arr);
      }
      /** @type {Element[]|null} */
      let best = null;
      for (const arr of groups.values()) if (arr.length >= MIN_REPEAT && (!best || arr.length > best.length)) best = arr;
      if (!best) return;
      const items = best.filter(hasContent);
      if (items.length < MIN_REPEAT) return;
      const first = items[0];
      if (!f.isVisible(first)) return;
      // Nested repeats inside a claimed item are the item's own structure.
      for (const c of claimed) if (c.contains(container)) return;
      const containerSelector = s.forElement(container);
      const itemSeg = s.relativeSelector(first, container).replace(/:nth-of-type\(\d+\)$/, '');
      found.push({
        containerSelector,
        shadowPath: s.hostPath(container),
        itemSelector: `${containerSelector} > ${itemSeg}`,
        itemCount: items.length,
        slots: slotsOf(first),
      });
      claimed.add(container);
      for (const it of items) claimed.add(it);
    };

    // Deep walk; largest-first ordering comes from the final sort.
    const visit = (/** @type {ParentNode} */ r, /** @type {number} */ depth) => {
      for (const el of r.querySelectorAll('*')) {
        if (found.length >= MAX_REPEATS * 3) break;
        if (el.children.length >= MIN_REPEAT) consider(el);
        if (el.shadowRoot && depth < 10) visit(el.shadowRoot, depth + 1);
      }
    };
    visit(root, 0);
    return found.sort((a, b) => b.itemCount - a.itemCount).slice(0, MAX_REPEATS);
  };

  // ----------------------------------------------------------- pagination

  /**
   * @param {Element} scope
   * @param {string} selector
   * @returns {Element|null}
   */
  const firstIn = (scope, selector) => {
    try {
      return scope.querySelector(selector);
    } catch {
      return null;
    }
  };

  /**
   * @param {ParentNode} root
   * @returns {PaginationPattern[]}
   */
  const collectPagination = (root) => {
    const f = ns().fields;
    const s = ns().selectors;
    /** @type {PaginationPattern[]} */
    const out = [];
    /** @type {Set<Element>} */
    const seen = new Set();

    /** @type {Element[]} */
    const containers = [];
    for (const el of f.queryDeep(root, PAGINATION_SEL)) {
      // Climb to the pagination block, not the single link that matched.
      const block = el.closest('nav, ul, ol, [class*="pag"], [role="navigation"]') || el.parentElement || el;
      if (!seen.has(block) && f.isVisible(block)) {
        seen.add(block);
        containers.push(block);
      }
    }
    // Numbered runs: a parent whose child links read 1, 2, 3…
    for (const parent of f.queryDeep(root, 'ul, ol, nav, div')) {
      if (seen.has(parent) || containers.length + out.length > MAX_PAGINATION * 2) break;
      const nums = Array.from(parent.children)
        .map((c) => (c.textContent || '').trim())
        .filter((t) => /^\d{1,4}$/.test(t))
        .map(Number);
      if (nums.length >= 3 && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1)) {
        seen.add(parent);
        containers.push(parent);
      }
    }

    for (const block of containers.slice(0, MAX_PAGINATION)) {
      const next = firstIn(block, '[rel="next"], [aria-label*="next" i], [class*="next"], [data-testid*="next" i]');
      const prev = firstIn(block, '[rel="prev"], [rel="previous"], [aria-label*="prev" i], [class*="prev"], [data-testid*="prev" i]');
      const numbered = Array.from(block.querySelectorAll('a, button')).filter((c) => /^\d{1,4}$/.test((c.textContent || '').trim())).length >= 2;
      // A short "x / y"-shaped text anywhere in the block, whatever the language.
      const indicator = Array.from(block.querySelectorAll('span, div, li, p, em, strong')).find((el) => {
        const t = (el.textContent || '').trim();
        return t.length <= 40 && /^\D{0,12}\d+\D{1,12}\d+\D{0,12}$/.test(t) && !el.querySelector('a, button');
      });
      const loadMore = !next && !numbered && !!firstIn(block, 'button, [role="button"]');
      out.push({
        containerSelector: s.forElement(block),
        next: next ? s.forElement(next) : null,
        prev: prev ? s.forElement(prev) : null,
        pageIndicator: indicator ? s.forElement(indicator) : null,
        style: numbered ? 'numbered' : next || prev ? 'next-prev' : loadMore ? 'load-more' : 'unknown',
      });
    }
    return out;
  };

  // ------------------------------------------------------------ downloads

  /**
   * @param {ParentNode} root
   * @returns {DownloadPattern[]}
   */
  const collectDownloads = (root) => {
    const f = ns().fields;
    const s = ns().selectors;
    /** @type {DownloadPattern[]} */
    const out = [];
    for (const a of f.queryDeep(root, 'a[download], a[href]')) {
      if (out.length >= MAX_DOWNLOADS) break;
      const href = a.getAttribute('href') || '';
      const hasAttr = a.hasAttribute('download');
      const m = href.match(DOC_EXT_RE);
      if (!hasAttr && !m) continue;
      const script = /^(javascript:|#|$)/i.test(href.trim());
      out.push({
        selector: s.forElement(a),
        extension: m ? m[1].toLowerCase() : hasAttr ? (a.getAttribute('download') || '').split('.').pop() || null : null,
        href: script ? 'script' : 'direct',
        downloadAttr: hasAttr,
      });
    }
    return out;
  };

  /**
   * @param {ParentNode} root
   * @returns {ListPatterns}
   */
  const collect = (root) => ({
    tables: collectTables(root),
    repeats: collectRepeats(root),
    pagination: collectPagination(root),
    downloads: collectDownloads(root),
  });

  window.__FP.lists = { collect };
})();
