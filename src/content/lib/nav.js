/* Navigation inventory — docs/12 B1 (route), B2 (view state), B3 (menus, view
   groups, breadcrumbs). What a page offers for getting somewhere else, whether
   or not the user ever opened it: a collapsed menu item is recorded with
   visible:false, because an item nobody clicked is what coverage is about.
   Matching is by ARIA role first and by framework class shape second, never by
   the words on the page. Reads only. Classic script: exposes window.__FP.nav. */
(() => {
  window.__FP = window.__FP || {};

  const MAX_MENU_ITEMS = 300; // CAPS.MENU_ITEMS
  const MAX_VIEW_GROUPS = 30; // CAPS.VIEW_GROUPS
  const MAX_VIEW_OPTIONS = 40; // CAPS.VIEW_OPTIONS
  const MAX_TEXT = 80; // CAPS.NAV_TEXT
  const MAX_BREADCRUMBS = 12;
  const MAX_QUERY_KEYS = 40;
  const MAX_PATH_DEPTH = 8;
  const MAX_CLIMB = 60;
  const MAX_NAME = 60;
  const MAX_SELECTOR_NAME = 40;
  const MAX_LIST_ANCHORS = 200;
  const SHADOW_DEPTH = 10; // CAPS.SHADOW_DEPTH
  const OPTION_CLIMB = 5;
  /** Menu items remembered across states of one document (overlay menus). */
  const MAX_REMEMBERED = 1000;
  /** Mutation records probed for a navigation change, per batch. */
  const MAX_PROBED_RECORDS = 50;
  /** Menus are re-read on navigation mutations at most this often (trailing read after). */
  const NOTE_GAP_MS = 250;
  /** A click may look the view groups up again at most this often. */
  const VIEW_REFRESH_MS = 1500;

  // ------------------------------------------------------------ selectors

  /** Regions that say "navigation" by element, role or framework class. */
  const SEMANTIC_REGION_SEL = 'nav, [role="navigation"], [role="menubar"], [role="tree"], header, aside, mat-sidenav, mat-nav-list, .navbar, .sidebar, .sidenav, .p-menubar, .p-panelmenu, .p-megamenu';
  /** Menu panels; frameworks often render these detached from their trigger. */
  const PANEL_SEL = '[role="menu"], .dropdown-menu, .mat-menu-panel, .mat-mdc-menu-panel, .p-menu, .p-tieredmenu, .p-slidemenu, .p-contextmenu';
  const REGION_SEL = `${SEMANTIC_REGION_SEL}, ${PANEL_SEL}`;
  /** Regions that hold more than navigation; only links and menu triggers count inside them. */
  const LOOSE_REGION_SEL = 'header, aside, mat-sidenav, .sidebar';
  const STRICT_REGION_SEL = `nav, [role="navigation"], [role="menubar"], [role="tree"], mat-nav-list, .navbar, .sidenav, .p-menubar, .p-panelmenu, .p-megamenu, ${PANEL_SEL}`;
  /** A header or aside in here belongs to a piece of content, not to the site; a sidebar may still live in <main>. */
  const CONTENT_SEL = 'article, dialog, [role="dialog"], form, table, li';
  const HEADER_CONTENT_SEL = `${CONTENT_SEL}, section, main`;

  const ROLE_ITEM_SEL = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="treeitem"], [role="link"]';
  const FRAMEWORK_ITEM_SEL = '[mat-menu-item], [mat-list-item], .dropdown-item, .nav-link, .p-menuitem-link';
  const ITEM_SEL = `a, button, summary, [role="button"], ${ROLE_ITEM_SEL}, ${FRAMEWORK_ITEM_SEL}`;
  const LOOSE_ITEM_SEL = `a[href], summary, ${ROLE_ITEM_SEL}, ${FRAMEWORK_ITEM_SEL}`;
  const EXPANDER_SEL = '[aria-haspopup]:not([aria-haspopup="false"]), [aria-expanded], [data-bs-toggle], [data-toggle], [mat-menu-trigger-for], [matmenutriggerfor], .mat-menu-trigger, .mat-mdc-menu-trigger, .dropdown-toggle';
  const SUBMENU_SEL = 'ul, ol, menu, [role="menu"], [role="group"], [role="tree"], .dropdown-menu, .collapse, [class*="submenu"], [class*="sub-menu"], .mat-menu-panel, .mat-mdc-menu-panel';
  const WRAPPER_SEL = 'li, [role="treeitem"], [role="menuitem"], [role="none"], [role="presentation"], .dropdown, .dropup, .dropend, .dropstart, .btn-group, .nav-item';
  /** Lists that are the root of a menu, never a submenu of their neighbour. */
  const ROOT_LIST_SEL = '[role="menubar"], [role="navigation"], nav';
  /** A plain list directly inside one of these is that navigation's top level. */
  const ROOT_PARENT_SEL = 'nav, [role="navigation"]';
  /** An open popup that is a menu, a dialog or a tree — a select's listbox is a control, not a place. */
  const OPEN_POPUP_SEL = '[aria-expanded="true"][aria-haspopup]:not([aria-haspopup="false"]):not([aria-haspopup="listbox"]):not([aria-haspopup="grid"])';
  /** aria-controls on these names a tab panel or a listbox, not a submenu. */
  const NOT_AN_OWNER_SEL = '[role="tab"], [role="combobox"], input, select, textarea';

  const PAGER_SEL = '[class*="pagina"], [class*="pager"], [class*="paging"], mat-paginator';
  const BREADCRUMB_SEL = '[class*="breadcrumb"], [itemtype*="BreadcrumbList"], [aria-label*="breadcrumb" i]';
  const TABLE_SEL = 'table, [role="table"], [role="grid"], [role="treegrid"]';
  /** Menu items never come from inside these. */
  const NOT_MENU_SEL = `[role="tablist"], .nav-tabs, [role="listbox"], ${TABLE_SEL}, ${PAGER_SEL}, ${BREADCRUMB_SEL}`;

  const TABLIST_SEL = '[role="tablist"], .nav-tabs, .nav-pills, .mat-tab-nav-bar, .mat-mdc-tab-nav-bar, .p-tabmenu-nav, .p-tabview-nav';
  const TAB_OPTION_SEL = '[role="tab"], .nav-link, .mat-tab-link, .mat-mdc-tab-link, .p-tabmenuitem, .p-tabview-nav-link, li > a, li > button';
  const CHIPS_SEL = '[role="listbox"], mat-chip-listbox, mat-chip-list, mat-chip-set, .mat-chip-list, .mat-mdc-chip-set, .p-chips, [class*="chip-list"], [class*="chip-group"], [class*="chips"], [class*="pill-group"]';
  const CHIP_OPTION_SEL = '[role="option"], mat-chip-option, mat-chip, .mat-chip, .mat-mdc-chip, [class*="chip"], [class*="pill"]';
  const CHIP_SHAPE_RE = /chip|pill/i;
  const SEGMENT_SEL = '[role="group"], [role="toolbar"], .btn-group, mat-button-toggle-group, .p-selectbutton, [class*="button-group"], [class*="btn-group"], [class*="segmented"], [class*="toggle-group"]';
  const SEGMENT_OPTION_SEL = 'button, [role="button"], mat-button-toggle, a.btn, label.btn';
  /** Buttons the site marks as the chosen one; their parent may be a group no class names. */
  const MARKED_BUTTON_SEL =
    'button[aria-pressed="true"], [role="button"][aria-pressed="true"], button[aria-selected="true"], button[aria-checked="true"], button[aria-current]:not([aria-current="false"]), button.active, button.selected, button.current, button.checked, [role="button"].active, [role="button"].selected';
  const SEGMENT_AVOID_SEL = `${NOT_MENU_SEL}, [role="menu"], [role="menubar"], [role="radiogroup"], .nav-pills`;
  const SUBMIT_SEL = 'button:not([type]), button[type="submit"], input[type="submit"], input[type="image"]';
  const LIST_ANCHOR_SEL = `${TABLE_SEL}, [role="list"], [role="feed"], mat-table, cdk-table, cdk-virtual-scroll-viewport, .mat-table, .mat-mdc-table, [class*="datatable"], [class*="data-table"], [class*="datagrid"], [class*="data-grid"]`;
  const NOT_A_LIST_SEL = `${REGION_SEL}, footer, ${PAGER_SEL}, ${BREADCRUMB_SEL}`;

  const ACTIVE_ATTR_SEL = '[aria-selected="true"], [aria-pressed="true"], [aria-checked="true"], [aria-current]:not([aria-current="false"])';
  /**
   * @param {string} list   comma-separated selectors
   * @returns {string} the same selectors, each limited to direct children
   */
  const direct = (list) =>
    list
      .split(', ')
      .map((s) => `:scope > ${s}`)
      .join(', ');
  const DIRECT_ACTIVE_SEL = direct(ACTIVE_ATTR_SEL);
  const DIRECT_SUBMENU_SEL = direct(SUBMENU_SEL);
  /** State class tokens: `active`, `is-active`, `router-link-active`, `tab--selected`. Never `inactive`. */
  const ACTIVE_CLASS_RE = /(?:^|[\s_-])(?:active|activated|selected|current|checked|highlight)(?:\s|$)/;
  const DISABLED_CLASS_RE = /(?:^|[\s_-])disabled(?:\s|$)/;
  const SCRIPTED_HREF_RE = /^(?:javascript|data|blob|mailto|tel|sms|about|vbscript):/i;
  const ROUTED_FRAGMENT_RE = /^#!?\//;

  /** @returns {FPNamespace} */
  const ns = () => /** @type {FPNamespace} */ (window.__FP);

  /**
   * Which group each option element belongs to, from the last collect. Lets a
   * click be placed without walking the document. Weak: re-rendered options
   * drop out and viewGroupOf() looks again.
   * @type {WeakMap<Element, string>}
   */
  let groupOfOption = new WeakMap();
  let viewsCollectedAt = 0;

  // -------------------------------------------------------------- helpers

  /**
   * @param {string|null|undefined} text
   * @param {number} [max]
   * @returns {string}
   */
  const scrub = (text, max = MAX_TEXT) => (text ? ns().redact.scrubText(text).slice(0, max) : '');

  /**
   * @param {Element} el
   * @returns {string}
   */
  const nameOf = (el) => scrub(ns().labels.accessibleName(el, MAX_TEXT));

  /**
   * Parent across a shadow boundary.
   * @param {Element} el
   * @returns {Element|null}
   */
  const parentDeep = (el) => {
    if (el.parentElement) return el.parentElement;
    const p = el.parentNode;
    return p instanceof ShadowRoot ? p.host : null;
  };

  /**
   * closest() that keeps going through shadow hosts.
   * @param {Element|null} el
   * @param {string} selector
   * @returns {Element|null}
   */
  const closestDeep = (el, selector) => {
    /** @type {Element|null} */
    let cur = el;
    for (let depth = 0; cur && depth <= SHADOW_DEPTH; depth++) {
      const hit = cur.closest(selector);
      if (hit) return hit;
      const root = cur.getRootNode();
      cur = root instanceof ShadowRoot ? root.host : null;
    }
    return null;
  };

  /**
   * @param {Element} el
   * @returns {boolean}
   */
  const isRegion = (el) => {
    if (!el.matches('header, aside') || el.matches(STRICT_REGION_SEL)) return true;
    const parent = parentDeep(el);
    return !closestDeep(parent, el.tagName === 'HEADER' ? HEADER_CONTENT_SEL : CONTENT_SEL);
  };

  /**
   * Nearest navigation or menu region around `el`, or null.
   * @param {Element|null} el
   * @returns {Element|null}
   */
  const regionOf = (el) => {
    /** @type {Element|null} */
    let cur = el;
    for (let i = 0; cur && i < MAX_PATH_DEPTH; i++) {
      const hit = closestDeep(cur, REGION_SEL);
      if (!hit) return null;
      if (isRegion(hit)) return hit;
      cur = parentDeep(hit);
    }
    return null;
  };

  /**
   * @param {Element} el
   * @returns {boolean}
   */
  const isActive = (el) => {
    if (el.matches(ACTIVE_ATTR_SEL)) return true;
    if (typeof el.className === 'string' && ACTIVE_CLASS_RE.test(el.className)) return true;
    if (el instanceof HTMLInputElement) return el.checked;
    if (el instanceof HTMLOptionElement) return el.selected;
    // Bootstrap 3 and its descendants mark the <li>, not the link.
    const p = el.parentElement;
    return !!p && p.tagName === 'LI' && typeof p.className === 'string' && ACTIVE_CLASS_RE.test(p.className);
  };

  /**
   * An option is active when it says so itself or when the one thing inside it does.
   * @param {Element} el
   * @returns {boolean}
   */
  const isActiveOption = (el) => isActive(el) || !!el.querySelector(DIRECT_ACTIVE_SEL);

  /**
   * @param {Element} el
   * @returns {boolean}
   */
  const isDisabled = (el) =>
    el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' || (typeof el.className === 'string' && DISABLED_CLASS_RE.test(el.className));

  /**
   * True for an href that loads or routes to a page, as opposed to `#`, `#tab-2` or a script.
   * @param {Element} el
   * @returns {boolean}
   */
  const hasRealHref = (el) => {
    const raw = (el.getAttribute('href') || '').trim();
    if (!raw || SCRIPTED_HREF_RE.test(raw)) return false;
    return raw[0] !== '#' || ROUTED_FRAGMENT_RE.test(raw);
  };

  /**
   * @param {Element[]} options
   * @returns {boolean}
   */
  const mostlyLinks = (options) => options.filter(hasRealHref).length * 2 > options.length;

  /**
   * Keep the elements that are not inside another element of the same list.
   * @param {Element[]} els
   * @returns {Element[]}
   */
  const outermost = (els) => {
    const set = new Set(els);
    return els.filter((el) => {
      for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false;
      return true;
    });
  };

  // ------------------------------------------------------- B1: route, href

  /**
   * A fragment split the way a fragment router reads it. `path` is kept as
   * written, hashbang included, so origin + route is still a usable URL; it is
   * empty for a plain `#section` anchor.
   * @param {string} hash   with its leading `#`, or ''
   * @returns {{ path: string, query: string }}
   */
  const fragmentOf = (hash) => {
    const q = hash.indexOf('?');
    const before = q === -1 ? hash : hash.slice(0, q);
    return { path: ROUTED_FRAGMENT_RE.test(hash) ? before : '', query: q === -1 ? '' : hash.slice(q + 1) };
  };

  /**
   * docs/12 B1.
   * @returns {string}
   */
  const route = () => ns().redact.scrubText(location.pathname + fragmentOf(location.hash).path);

  /**
   * docs/12 B1: names only, from the query string and the fragment's query.
   * @returns {string[]}
   */
  const queryKeys = () => {
    /** @type {Set<string>} */
    const out = new Set();
    for (const q of [location.search, fragmentOf(location.hash).query]) {
      if (!q) continue;
      try {
        for (const k of new URLSearchParams(q).keys()) {
          const name = scrub(k);
          if (name) out.add(name);
        }
      } catch {
        /* malformed query; its names are lost, nothing else is */
      }
    }
    return Array.from(out).sort().slice(0, MAX_QUERY_KEYS);
  };

  /**
   * Same rule as route(), so a menu item's href equals the route of the page
   * it leads to. Another origin keeps its origin in front, so it can never be
   * mistaken for a route of this one.
   * @param {string|null} href
   * @returns {string|null}
   */
  const cleanHref = (href) => {
    if (href == null) return null;
    const raw = String(href).trim();
    if (!raw || SCRIPTED_HREF_RE.test(raw)) return null;
    // `#` and `#section` stay on the page; what they do is up to a script.
    if (raw[0] === '#' && !ROUTED_FRAGMENT_RE.test(raw)) return null;
    /** @type {URL} */
    let u;
    try {
      u = new URL(raw, location.href);
    } catch {
      return null;
    }
    if (u.protocol !== location.protocol && !/^https?:$/.test(u.protocol)) return null;
    const path = u.pathname + fragmentOf(u.hash).path;
    return ns().redact.scrubText((u.origin === location.origin ? '' : u.origin) + path);
  };

  // ------------------------------------------------------------ B3: menus

  /**
   * Shared by every item of one collect (or one click): who controls which
   * panel, which triggers are open, and names and visibility already worked
   * out. All lazy — a page without menus pays nothing.
   * @typedef {Object} PathContext
   * @property {Map<string, Element>|null} owners
   * @property {Element[]|null} open
   * @property {Map<Element, string>} names
   * @property {Map<Element, boolean>} visible
   */

  /** @returns {PathContext} */
  const newContext = () => ({ owners: null, open: null, names: new Map(), visible: new Map() });

  /**
   * @param {Element} el
   * @param {PathContext} ctx
   * @returns {string}
   */
  const cachedName = (el, ctx) => {
    let n = ctx.names.get(el);
    if (n === undefined) {
      n = nameOf(el);
      ctx.names.set(el, n);
    }
    return n;
  };

  /**
   * @param {Element} el
   * @param {PathContext} ctx
   * @returns {boolean}
   */
  const cachedVisible = (el, ctx) => {
    let v = ctx.visible.get(el);
    if (v === undefined) {
      v = ns().fields.isVisible(el);
      ctx.visible.set(el, v);
    }
    return v;
  };

  /**
   * The element that names `panel` as the thing it opens, through
   * aria-controls / aria-owns on the trigger or aria-labelledby on the panel.
   * @param {Element} panel
   * @param {PathContext} ctx
   * @returns {Element|null}
   */
  const ownerOf = (panel, ctx) => {
    if (panel.id) {
      if (!ctx.owners) {
        ctx.owners = new Map();
        for (const o of ns().fields.queryDeep(document, '[aria-controls], [aria-owns]')) {
          if (o.matches(NOT_AN_OWNER_SEL)) continue;
          const ids = `${o.getAttribute('aria-controls') || ''} ${o.getAttribute('aria-owns') || ''}`.split(/\s+/);
          for (const id of ids) if (id && !ctx.owners.has(id)) ctx.owners.set(id, o);
        }
      }
      const owner = ctx.owners.get(panel.id);
      if (owner) return owner;
    }
    if (!panel.matches(SUBMENU_SEL)) return null;
    const by = (panel.getAttribute('aria-labelledby') || '').split(/\s+/)[0];
    return by ? ns().selectors.rootOf(panel).getElementById(by) : null;
  };

  /**
   * Overlay panels exist only while open and sit far from what opened them.
   * With no id to follow, the trigger is the one expanded popup trigger inside
   * a navigation region — if there is exactly one.
   * @param {Element} panel
   * @param {PathContext} ctx
   * @returns {Element|null}
   */
  const soleOpenTrigger = (panel, ctx) => {
    if (!ctx.open) {
      ctx.open = ns()
        .fields.queryDeep(document, '[aria-expanded="true"][aria-haspopup]:not([aria-haspopup="false"])')
        .filter((t) => !t.matches(NOT_AN_OWNER_SEL) && !!regionOf(t));
    }
    const candidates = ctx.open.filter((t) => !panel.contains(t));
    return candidates.length === 1 ? candidates[0] : null;
  };

  /**
   * True when `trigger` says, through aria-controls / aria-owns, that what it
   * opens is something other than `panel`: it is then a neighbour's trigger.
   * @param {Element} trigger
   * @param {Element} panel
   * @returns {boolean}
   */
  const controlsElse = (trigger, panel) => {
    const ids = `${trigger.getAttribute('aria-controls') || ''} ${trigger.getAttribute('aria-owns') || ''}`.split(/\s+/).filter(Boolean);
    if (!ids.length) return false;
    return !(panel.id && ids.includes(panel.id));
  };

  /**
   * The element that labels the level `child` sits on, seen from `parent`.
   * @param {Element} parent
   * @param {Element} child   the child of `parent` on the way down to `el`
   * @param {Element} el
   * @returns {Element|null}
   */
  const levelTrigger = (parent, child, el) => {
    if (parent.tagName === 'DETAILS') {
      const s = parent.querySelector(':scope > summary');
      return s && s !== child && !s.contains(el) ? s : null;
    }
    if (child === el) return null;
    // A menubar or a navigation region's own list is the top of its menu;
    // whatever stands beside it is a neighbour, never its parent level.
    if (child.matches(ROOT_LIST_SEL) || (child.matches('ul, ol, menu') && parent.matches(ROOT_PARENT_SEL))) return null;
    if (child.matches(SUBMENU_SEL)) {
      // A bare region holds its items side by side; a sibling there is a
      // neighbour unless it says it opens something.
      const wrapped = parent.matches(WRAPPER_SEL) || parent.children.length <= 3;
      let sib = child.previousElementSibling;
      for (let i = 0; sib && i < 3; i++, sib = sib.previousElementSibling) {
        if (sib.matches(SUBMENU_SEL)) break;
        const t = sib.matches(`${ITEM_SEL}, ${EXPANDER_SEL}`) ? sib : sib.querySelector(`${ITEM_SEL}, ${EXPANDER_SEL}`);
        if (t && (wrapped || t.matches(EXPANDER_SEL)) && !controlsElse(t, child)) return t;
      }
      // `<li>Reports<ul>…</ul></li>`: the wrapper's own text is the label.
      return parent.matches(WRAPPER_SEL) ? parent : null;
    }
    if (child.tagName !== 'LI' && !child.matches(ITEM_SEL)) {
      const prev = child.previousElementSibling;
      if (prev && prev.tagName !== 'LI' && prev.matches(EXPANDER_SEL) && !prev.matches(NOT_AN_OWNER_SEL) && !controlsElse(prev, child)) return prev;
    }
    return null;
  };

  /**
   * Labels of the levels above `el`, outermost first. Nesting comes from DOM
   * ancestry; a panel that names its trigger continues from that trigger,
   * wherever it sits.
   * @param {Element} el
   * @param {PathContext} ctx
   * @returns {string[]}
   */
  const ancestorsOf = (el, ctx) => {
    /** @type {string[]} */
    const labels = [];
    /** @type {Set<Element>} */
    const seen = new Set([el]);

    /**
     * @param {Element} trigger
     * @param {Element} opens   what the trigger opens, as far as we can tell
     * @returns {boolean} whether a level was added
     */
    const push = (trigger, opens) => {
      if (seen.has(trigger)) return false;
      seen.add(trigger);
      // A trigger that is hidden while its panel shows is not on the way to
      // the items: a collapsed-layout toggle on a wide screen.
      if (!cachedVisible(trigger, ctx) && cachedVisible(opens, ctx)) return false;
      const name = cachedName(trigger, ctx);
      if (!name || labels[labels.length - 1] === name) return false;
      labels.push(name);
      return true;
    };

    /** @type {Element|null} */
    let child = el;
    /** @type {Element|null} */
    let loosePanel = null;
    let semantic = false;
    for (let hops = 0; child && hops < MAX_CLIMB && labels.length < MAX_PATH_DEPTH; hops++) {
      if (child !== el) {
        const owner = ownerOf(child, ctx);
        // Carry on from the trigger only when it counts as a level; a
        // refused one leaves the climb where the markup puts it.
        if (owner && !child.contains(owner) && push(owner, child)) {
          loosePanel = null;
          child = owner;
          continue;
        }
        if (child.matches(PANEL_SEL)) loosePanel = child;
        if (child.matches(SEMANTIC_REGION_SEL)) semantic = true;
      }
      /** @type {Element|null} */
      const parent = parentDeep(child);
      if (!parent || parent === document.body || parent === document.documentElement) {
        // Top of the tree inside a panel nothing claimed: a detached overlay.
        if (!loosePanel || semantic) break;
        const trigger = soleOpenTrigger(loosePanel, ctx);
        if (!trigger || !push(trigger, loosePanel)) break;
        loosePanel = null;
        child = trigger;
        continue;
      }
      const trigger = levelTrigger(parent, child, el);
      if (trigger) push(trigger, child);
      child = parent;
    }
    return labels.reverse();
  };

  /**
   * @param {Element} el
   * @returns {boolean}
   */
  const hasSubmenu = (el) => {
    if (el.matches(EXPANDER_SEL) || el.tagName === 'SUMMARY' || el.hasAttribute('aria-controls') || el.hasAttribute('aria-owns')) return true;
    const next = el.nextElementSibling;
    if (next && next.matches(SUBMENU_SEL)) return true;
    if (el.querySelector(DIRECT_SUBMENU_SEL)) return true;
    const p = el.parentElement;
    return !!p && p.matches(WRAPPER_SEL) && !!p.querySelector(DIRECT_SUBMENU_SEL);
  };

  /**
   * @param {Element} el
   * @returns {boolean|null}
   */
  const expandedOf = (el) => {
    const v = el.getAttribute('aria-expanded');
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (el.tagName === 'SUMMARY' && el.parentElement instanceof HTMLDetailsElement) return el.parentElement.open;
    return null;
  };

  /**
   * Whether `el` counts as a menu item where it sits. `region` is its nearest
   * navigation region.
   * @param {Element} el
   * @param {Element} region
   * @returns {boolean}
   */
  const isMenuItem = (el, region) => {
    if (el.getAttribute('role') === 'option' || el.matches(NOT_AN_OWNER_SEL)) return false;
    if (groupOfOption.has(el)) return false;
    if (closestDeep(el, NOT_MENU_SEL)) return false;
    const loose = region.matches(LOOSE_REGION_SEL) && !region.matches(STRICT_REGION_SEL);
    if (loose && !el.matches(LOOSE_ITEM_SEL) && !el.matches(EXPANDER_SEL)) return false;
    return true;
  };

  /**
   * @param {ParentNode} root
   * @returns {NavItem[]}
   */
  const collectMenus = (root) => {
    const f = ns().fields;
    const s = ns().selectors;
    const ctx = newContext();
    /** @type {NavItem[]} */
    const out = [];
    /** @type {Map<string, number>} */
    const byKey = new Map();
    /** @type {Set<Element>} */
    const done = new Set();

    // Outermost regions only, so nothing is walked twice.
    const regions = f.queryDeep(root, REGION_SEL).filter((r) => isRegion(r) && !regionOf(parentDeep(r)));
    for (const region of regions) {
      for (const el of f.queryDeep(region, ITEM_SEL)) {
        if (out.length >= MAX_MENU_ITEMS) return out;
        if (done.has(el)) continue;
        done.add(el);
        const near = regionOf(el);
        if (!near || !isMenuItem(el, near)) continue;
        const text = cachedName(el, ctx);
        if (!text) continue;
        // `<li role="menuitem"><a>`: the link is the item, the wrapper repeats it.
        const inner = el.querySelector(ITEM_SEL);
        if (inner && cachedName(inner, ctx) === text) continue;

        const path = ancestorsOf(el, ctx).concat(text);
        const href = el.matches('a[href]') ? cleanHref(el.getAttribute('href')) : null;
        const visible = cachedVisible(el, ctx);
        /** @type {NavItem} */
        const item = {
          text,
          path,
          depth: path.length - 1,
          selector: s.forElement(el),
          shadowPath: s.hostPath(el),
          href,
          visible,
          expanded: expandedOf(el),
          hasChildren: hasSubmenu(el),
          current: isActive(el),
        };
        // Wide-screen and narrow-screen copies of one menu: keep one, the visible one.
        const key = `${path.join('\u0001')}\u0002${href || ''}`;
        const at = byKey.get(key);
        if (at === undefined) {
          byKey.set(key, out.length);
          out.push(item);
        } else if (visible && !out[at].visible) out[at] = item;
      }
    }
    return out;
  };

  /**
   * Whether `el` would be listed by collectMenus, and as which element.
   * @param {Element} el
   * @returns {Element|null}
   */
  const menuItemFor = (el) => {
    /** @type {Element|null} */
    let item = closestDeep(el, ITEM_SEL);
    if (!item) {
      // A click on the wrapper's padding: the wrapper holds exactly one item.
      const inside = el.querySelectorAll(ITEM_SEL);
      item = inside.length === 1 ? inside[0] : null;
    }
    if (!item) return null;
    const region = regionOf(item);
    return region && isMenuItem(item, region) ? item : null;
  };

  /**
   * @param {Element} el
   * @returns {string[]}
   */
  const menuPathOf = (el) => {
    try {
      const item = menuItemFor(el);
      if (!item) return [];
      const text = nameOf(item);
      if (!text) return [];
      return ancestorsOf(item, newContext()).concat(text);
    } catch {
      return [];
    }
  };

  /**
   * @param {Element} el
   * @returns {boolean}
   */
  const inNav = (el) => {
    try {
      return !!regionOf(el) && !closestDeep(el, PAGER_SEL);
    } catch {
      return false;
    }
  };

  // ------------------------------------------------------ B3: view groups

  /**
   * @param {Element} el
   * @returns {boolean}
   */
  const inSubmittingForm = (el) => {
    const form = el.closest('form');
    return !!form && !!form.querySelector(SUBMIT_SEL);
  };

  /**
   * Stand-in for `el` in the light DOM, so document order can be compared
   * across shadow roots.
   * @param {Element} el
   * @returns {Element}
   */
  const lift = (el) => {
    let cur = el;
    for (let depth = 0; depth <= SHADOW_DEPTH; depth++) {
      const root = cur.getRootNode();
      if (!(root instanceof ShadowRoot)) break;
      cur = root.host;
    }
    return cur;
  };

  /**
   * The list or table that comes last in the document; a control sits "above
   * a list" when it comes before this one.
   * @param {ParentNode} root
   * @returns {Element|null}
   */
  const lastListAnchor = (root) => {
    const f = ns().fields;
    /** @type {Element|null} */
    let last = null;
    /** @param {Element} el */
    const consider = (el) => {
      const a = lift(el);
      if (!last || last.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) last = a;
    };
    for (const el of f.queryDeep(root, LIST_ANCHOR_SEL).slice(0, MAX_LIST_ANCHORS)) consider(el);
    // Plain lists count when they hold items and are not a menu or a footer.
    for (const el of f.queryDeep(root, 'ul, ol').slice(0, MAX_LIST_ANCHORS)) {
      if (el.children.length >= 3 && !closestDeep(el, NOT_A_LIST_SEL)) consider(el);
    }
    return last;
  };

  /**
   * @param {Element} el
   * @param {Element|null} anchor
   * @returns {boolean}
   */
  const sitsAboveList = (el, anchor) => {
    if (!anchor || closestDeep(el, TABLE_SEL)) return false;
    const a = lift(el);
    if (a === anchor || a.contains(anchor)) return false;
    return !!(a.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING);
  };

  /**
   * Label of a group container, from what names it and nothing nearby.
   * @param {Element} container
   * @returns {string}
   */
  const groupLabel = (container) => {
    const l = ns().labels;
    if (container.tagName === 'SELECT') {
      const r = l.resolveLabel(container);
      // A neighbour's text is whatever happens to stand there.
      return r.labelSource === 'sibling' || r.labelSource === 'placeholder' ? '' : scrub(r.label);
    }
    const by = container.getAttribute('aria-labelledby');
    if (by) {
      const root = ns().selectors.rootOf(container);
      const t = by
        .split(/\s+/)
        .map((id) => (id ? l.textOf(root.getElementById(id), MAX_TEXT) : ''))
        .filter(Boolean)
        .join(' ');
      if (t) return scrub(t);
    }
    const aria = l.cleanText(container.getAttribute('aria-label'), MAX_TEXT);
    if (aria) return scrub(aria);
    const legend = container.tagName === 'FIELDSET' ? container.querySelector(':scope > legend') : null;
    return legend ? scrub(l.textOf(legend, MAX_TEXT)) : '';
  };

  /**
   * `=` and `|` build the view key, so neither may appear inside a part of it.
   * @param {string} text
   * @returns {string}
   */
  const keySafe = (text) => text.replace(/[|=]/g, ' ').replace(/\s+/g, ' ').trim();

  /**
   * Name for a group nothing labels: its kind plus the tail of its selector.
   * Both come from the markup, so the same page gives the same name.
   * @param {ViewGroup['kind']} kind
   * @param {string} selector
   * @returns {string}
   */
  const nameFromSelector = (kind, selector) => {
    const attr = /^\[[\w-]+="(.+)"\]$/.exec(selector);
    const tail = attr ? attr[1] : selector.split(' > ').slice(-2).join('>');
    return `${kind}:${keySafe(tail.replace(/^#/, '').replace(/"/g, '')).slice(0, MAX_SELECTOR_NAME)}`;
  };

  /**
   * Collector for one pass. Groups are added in discovery order, which is
   * fixed by the markup, so the `#2` a repeated name gets is stable too.
   * @param {WeakMap<Element, string>} owners
   */
  const groupBuilder = (owners) => {
    const s = ns().selectors;
    const f = ns().fields;
    /** @type {ViewGroup[]} */
    const groups = [];
    /** @type {Set<Element>} */
    const taken = new Set();
    /** @type {Map<string, number>} */
    const names = new Map();

    /**
     * @param {ViewGroup['kind']} kind
     * @param {Element} container
     * @param {Element[]} options
     * @param {(el: Element) => string} [textOf]
     * @returns {boolean}
     */
    const add = (kind, container, options, textOf) => {
      if (groups.length >= MAX_VIEW_GROUPS || taken.has(container)) return false;
      const fresh = options.filter((o) => !taken.has(o) && !owners.has(o)).slice(0, MAX_VIEW_OPTIONS);
      if (fresh.length < 2) return false;
      /** @type {{ el: Element, option: ViewOption }[]} */
      const built = [];
      for (const el of fresh) {
        const text = textOf ? textOf(el) : nameOf(el);
        if (!text) continue;
        built.push({
          el,
          option: { text, selector: s.forElement(el), active: isActiveOption(el), disabled: isDisabled(el), visible: f.isVisible(el) },
        });
      }
      if (built.length < 2) return false;

      const containerSelector = s.forElement(container);
      const label = groupLabel(container);
      const base = keySafe(label).slice(0, MAX_NAME) || nameFromSelector(kind, containerSelector);
      const n = (names.get(base) || 0) + 1;
      names.set(base, n);
      const name = n === 1 ? base : `${base}#${n}`;

      taken.add(container);
      owners.set(container, name);
      for (const b of built) {
        taken.add(b.el);
        owners.set(b.el, name);
      }
      groups.push({ kind, label, name, containerSelector, shadowPath: s.hostPath(container), options: built.map((b) => b.option) });
      return true;
    };

    return { groups, add, full: () => groups.length >= MAX_VIEW_GROUPS };
  };

  /**
   * Lowest element that contains every one of `els`.
   * @param {Element[]} els
   * @returns {Element|null}
   */
  const commonAncestor = (els) => {
    /** @type {Element|null} */
    let cur = els[0].parentElement;
    while (cur && !els.every((e) => cur !== null && cur.contains(e))) cur = cur.parentElement;
    return cur;
  };

  /**
   * @param {Element} el
   * @returns {string}
   */
  const controlText = (el) => scrub(ns().labels.resolveLabel(el).label) || nameOf(el);

  /**
   * @param {ParentNode} root
   * @returns {ViewGroup[]}
   */
  const collectViewGroups = (root) => {
    const f = ns().fields;
    const r = ns().redact;
    /** @type {WeakMap<Element, string>} */
    const owners = new WeakMap();
    const b = groupBuilder(owners);

    /**
     * Links to other pages inside a navigation region are a menu, whatever
     * the strip looks like.
     * @param {Element} container
     * @param {Element[]} options
     */
    const isMenu = (container, options) => mostlyLinks(options) && !!regionOf(container);

    // Tabs: by role, then by the class shapes frameworks give a tab strip.
    for (const c of f.queryDeep(root, TABLIST_SEL)) {
      if (b.full()) break;
      const byRole = c.matches('[role="tablist"]');
      const options = outermost(Array.from(c.querySelectorAll(TAB_OPTION_SEL))).filter((o) => o.closest(TABLIST_SEL) === c);
      if (!byRole && !c.matches('.nav-tabs') && isMenu(c, options)) continue;
      b.add('tabs', c, options);
    }

    // Chips: a listbox only when its options are chip-shaped — any other
    // listbox is a form control's dropdown.
    for (const c of f.queryDeep(root, CHIPS_SEL)) {
      if (b.full()) break;
      if (inSubmittingForm(c)) continue;
      // An inner wrapper can be chip-shaped by class and still be a container.
      const options = outermost(Array.from(c.querySelectorAll(CHIP_OPTION_SEL)).filter((o) => !o.matches(CHIPS_SEL)));
      if (!options.length) continue;
      if (c.matches('[role="listbox"]')) {
        const probe = `${c.tagName} ${c.getAttribute('class') || ''} ${options[0].tagName} ${options[0].getAttribute('class') || ''}`;
        if (!CHIP_SHAPE_RE.test(probe)) continue;
      }
      b.add('chips', c, options);
    }

    // Segmented buttons: named containers, plus the parent of any button the
    // site marks as chosen. Either way exactly one option is the chosen one.
    /** @type {Set<Element>} */
    const candidates = new Set(f.queryDeep(root, SEGMENT_SEL));
    for (const m of f.queryDeep(root, MARKED_BUTTON_SEL)) {
      const p = m.parentElement;
      if (!p) continue;
      // One wrapper per button is common; the group is then one level up.
      candidates.add(p.children.length === 1 && p.parentElement ? p.parentElement : p);
    }
    for (const c of candidates) {
      if (b.full()) break;
      if (c === document.body || closestDeep(c, SEGMENT_AVOID_SEL)) continue;
      // Buttons in a navigation region are its menu, one of them being current.
      const region = regionOf(c);
      if (region && region.matches(STRICT_REGION_SEL)) continue;
      const options = outermost(Array.from(c.querySelectorAll(SEGMENT_OPTION_SEL)));
      if (options.length < 2 || options.length > MAX_VIEW_OPTIONS) continue;
      if (options.some((o) => o.matches('[type="submit"]'))) continue;
      if (options.filter(isActiveOption).length !== 1) continue;
      if (isMenu(c, options)) continue;
      b.add('segmented', c, options);
    }

    // Radios and selects switch a view only outside a form that submits and
    // above a list; anywhere else they are data entry.
    const anchor = lastListAnchor(root);
    if (anchor) {
      /** @param {Element} el */
      const switchesView = (el) => !inSubmittingForm(el) && sitsAboveList(el, anchor) && !closestDeep(el, PAGER_SEL);

      for (const c of f.queryDeep(root, '[role="radiogroup"]')) {
        if (b.full()) break;
        if (!switchesView(c)) continue;
        const options = Array.from(c.querySelectorAll('[role="radio"], input[type="radio"]'));
        if (options.some((o) => r.isCredentialControl(o, ''))) continue;
        b.add('radio', c, options, controlText);
      }

      /** @type {Map<string, Element[]>} */
      const byName = new Map();
      for (const el of f.queryDeep(root, 'input[type="radio"][name]')) {
        if (owners.has(el)) continue;
        const name = el.getAttribute('name') || '';
        const arr = byName.get(name) || [];
        arr.push(el);
        byName.set(name, arr);
      }
      for (const [name, radios] of byName) {
        if (b.full()) break;
        if (radios.length < 2 || !radios.every(switchesView)) continue;
        if (radios.some((o) => r.isCredentialControl(o, name))) continue;
        const container = radios[0].closest('fieldset') || commonAncestor(radios);
        if (container && container !== document.body) b.add('radio', container, radios, controlText);
      }

      for (const c of f.queryDeep(root, 'select')) {
        if (b.full()) break;
        if (!(c instanceof HTMLSelectElement) || c.multiple || !switchesView(c)) continue;
        if (r.isCredentialControl(c, ns().labels.resolveLabel(c).label)) continue;
        b.add('select', c, Array.from(c.options), (o) => scrub(ns().labels.cleanText(/** @type {HTMLOptionElement} */ (o).text, MAX_TEXT)));
      }
    }

    groupOfOption = owners;
    viewsCollectedAt = Date.now();
    return b.groups;
  };

  /**
   * @param {Element} el
   * @returns {string|null}
   */
  const knownGroupOf = (el) => {
    /** @type {Element|null} */
    let cur = el;
    for (let i = 0; cur && i < OPTION_CLIMB; i++, cur = parentDeep(cur)) {
      const name = groupOfOption.get(cur);
      if (name) return name;
    }
    return null;
  };

  /**
   * @param {Element} el
   * @param {NavInventory} [inventory]
   * @returns {string|null}
   */
  const viewGroupOf = (el, inventory) => {
    try {
      let name = knownGroupOf(el);
      // Not among the options last seen: the strip may have been rendered
      // since. Looking again costs a document walk, so not on every click.
      if (!name && Date.now() - viewsCollectedAt > VIEW_REFRESH_MS) {
        collectViewGroups(document);
        name = knownGroupOf(el);
      }
      if (!name) return null;
      if (inventory && !inventory.viewGroups.some((g) => g.name === name)) return null;
      return name;
    } catch {
      return null;
    }
  };

  /**
   * docs/12 B2. Pairs are sorted by group name, the page indicator comes
   * last, so the key of an unchanged view never changes.
   * @param {NavInventory} inventory
   * @param {ListPatterns} lists
   * @returns {ViewState}
   */
  const viewState = (inventory, lists) => {
    /** @type {{ group: string, option: string }[]} */
    const active = [];
    /** @type {Map<string, string[]>} */
    const byGroup = new Map();
    for (const g of inventory.viewGroups) {
      for (const o of g.options) {
        if (!o.active) continue;
        active.push({ group: g.name, option: o.text });
        const arr = byGroup.get(g.name) || [];
        arr.push(keySafe(o.text));
        byGroup.set(g.name, arr);
      }
    }
    const parts = Array.from(byGroup.keys())
      .sort()
      .map((name) => `${name}=${(byGroup.get(name) || []).join('+')}`);
    /** @type {string[]} */
    const pages = [];
    for (const p of lists.pagination) {
      const cur = p.current ? keySafe(p.current) : '';
      if (cur && !pages.includes(cur)) pages.push(cur);
    }
    if (pages.length) parts.push(`page=${pages.join(',')}`);
    return { key: parts.join('|'), active };
  };

  // ------------------------------------------------------ B3: breadcrumbs

  /**
   * @param {ParentNode} root
   * @returns {string[]}
   */
  const collectBreadcrumbs = (root) => {
    const f = ns().fields;
    const trail = outermost(f.queryDeep(root, BREADCRUMB_SEL)).find((c) => f.isVisible(c));
    if (!trail) return [];
    const items = trail.querySelectorAll('li').length ? Array.from(trail.querySelectorAll('li')) : Array.from(trail.querySelectorAll('a, span, [itemprop="name"]'));
    /** @type {string[]} */
    const out = [];
    for (const el of outermost(items)) {
      if (out.length >= MAX_BREADCRUMBS) break;
      const text = nameOf(el);
      if (text && out[out.length - 1] !== text) out.push(text);
    }
    return out;
  };

  /**
   * View groups first: what they claim is a view switch, not a menu item.
   * @param {ParentNode} root
   * @returns {NavInventory}
   */
  const collect = (root) => {
    const viewGroups = collectViewGroups(root);
    const menus = collectMenus(root);
    if (root !== document) return { menus, viewGroups, breadcrumbs: collectBreadcrumbs(root) };
    remember(menus);
    return { menus: withRemembered(menus), viewGroups, breadcrumbs: collectBreadcrumbs(root) };
  };

  // ------------------------------------------------- B3: overlay menu memory
  // An overlay menu exists only while it is open, and a user who opens one
  // and clicks straight through never leaves it open for a state to see.
  // Every item seen in this document is remembered, and an item no longer in
  // the DOM is reported with visible:false on the next state.

  /** @type {Map<string, NavItem>} */
  const seenItems = new Map();
  let menusNotedAt = 0;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let noteTimer = null;

  /**
   * @param {NavItem} item
   * @returns {string}
   */
  const pathKey = (item) => `${item.path.join('\u0001')}\u0002${item.href || ''}`;

  /**
   * @param {NavItem[]} items
   */
  const remember = (items) => {
    for (const item of items) {
      const key = `${item.path.join('\u0001')}\u0002${item.selector}`;
      // Re-inserted so the map's order is least recently seen first.
      seenItems.delete(key);
      seenItems.set(key, item);
    }
    while (seenItems.size > MAX_REMEMBERED) {
      const oldest = seenItems.keys().next().value;
      if (oldest === undefined) break;
      seenItems.delete(oldest);
    }
  };

  /**
   * Current items first, then remembered ones not among them, within the cap.
   * @param {NavItem[]} current
   * @returns {NavItem[]}
   */
  const withRemembered = (current) => {
    const out = current.slice(0, MAX_MENU_ITEMS);
    const have = new Set(current.map(pathKey));
    const recent = Array.from(seenItems.values()).reverse();
    for (const item of recent) {
      if (out.length >= MAX_MENU_ITEMS) break;
      const key = pathKey(item);
      if (have.has(key)) continue;
      have.add(key);
      out.push({ ...item, visible: false, expanded: item.expanded === null ? null : false, current: false });
    }
    return out;
  };

  /**
   * Whether a batch of mutations touched a navigation region or added one.
   * @param {MutationRecord[]} records
   * @returns {boolean}
   */
  const touchesNav = (records) => {
    const n = Math.min(records.length, MAX_PROBED_RECORDS);
    for (let i = 0; i < n; i++) {
      const r = records[i];
      const t = r.target instanceof Element ? r.target : r.target.parentElement;
      if (t && regionOf(t)) return true;
      for (const added of Array.from(r.addedNodes).slice(0, MAX_PROBED_RECORDS)) {
        if (added instanceof Element && (added.matches(REGION_SEL) || added.querySelector(REGION_SEL))) return true;
      }
    }
    return false;
  };

  const noteNow = () => {
    noteTimer = null;
    menusNotedAt = Date.now();
    try {
      remember(collectMenus(document));
    } catch {
      /* the next draft build tries again */
    }
  };

  /**
   * Called on structural mutations: when navigation changed, remember what
   * its menus hold now. The first change after a quiet spell is read at
   * once — an overlay may be gone by the next event — and a burst is read
   * again once it settles.
   * @param {MutationRecord[]} records
   */
  const noteMutations = (records) => {
    try {
      if (!touchesNav(records)) return;
    } catch {
      return;
    }
    const since = Date.now() - menusNotedAt;
    if (since >= NOTE_GAP_MS && !noteTimer) return noteNow();
    if (!noteTimer) noteTimer = setTimeout(noteNow, Math.max(0, NOTE_GAP_MS - since));
  };

  /**
   * docs/12 B2/B3: which popup menus stand open right now — expanded popup
   * triggers (not a select's listbox) and open <details> inside navigation.
   * Part of the state signature, so opening a menu and pausing is a state.
   * @returns {string}
   */
  const openKey = () => {
    const f = ns().fields;
    const s = ns().selectors;
    /** @type {string[]} */
    const out = [];
    for (const t of f.queryDeep(document, OPEN_POPUP_SEL)) {
      if (t.matches(NOT_AN_OWNER_SEL)) continue;
      out.push(s.forElement(t));
    }
    for (const d of f.queryDeep(document, 'details[open]')) {
      if (regionOf(d)) out.push(s.forElement(d));
    }
    return Array.from(new Set(out)).sort().join(',');
  };

  window.__FP.nav = { collect, menuPathOf, inNav, viewGroupOf, viewState, route, queryKeys, cleanHref, noteMutations, openKey };
})();
