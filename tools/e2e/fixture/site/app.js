/* Harbourline Filing Portal — fixture single-page app.
 *
 * Plain JavaScript, no build step, no dependencies. Every page lives under
 * one pathname (/portal/) and is told apart by the URL fragment only, the way
 * many real portals are built. Some links move with location.hash, others
 * with history.pushState, so both styles are exercised.
 */
(function () {
  'use strict';

  var detector = window.__fixtureDetector;
  var BLOB_FILE_NAME = 'ledger_export_AC90417_2026.csv';
  var SESSION_KEY = 'fixture.session';
  var app = document.getElementById('app');
  var renderToken = 0;

  // ------------------------------------------------------------- helpers

  /** h('div', {class: 'x', onclick: fn}, child, 'text', [more]) */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) return child.forEach(function (c) { append(el, c); });
    el.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }

  function api(path) {
    return fetch(path, { headers: { accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /** The one XMLHttpRequest call in the fixture. */
  function apiXhr(path) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('GET', path);
      x.setRequestHeader('accept', 'application/json');
      x.onload = function () {
        try { resolve(JSON.parse(x.responseText)); } catch (e) { reject(e); }
      };
      x.onerror = function () { reject(new Error('network')); };
      x.send();
    });
  }

  function money(n) {
    return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function table(id, columns, rows) {
    return h('table', { id: id, class: 'data-table' },
      h('thead', null, h('tr', null, columns.map(function (c) { return h('th', { scope: 'col' }, c.label); }))),
      h('tbody', null, rows.map(function (r) {
        return h('tr', null, columns.map(function (c) {
          var v = c.render ? c.render(r) : r[c.key];
          return h('td', { 'data-col': c.key }, v);
        }));
      })));
  }

  function breadcrumb(parts) {
    return h('ol', { class: 'breadcrumb', 'aria-label': 'Breadcrumb' }, parts.map(function (p) { return h('li', null, p); }));
  }

  // -------------------------------------------------------------- routing

  function currentRoute() {
    var m = /^#\/([^?]*)/.exec(location.hash || '');
    return m ? '/' + m[1].replace(/\/+$/, '') : '';
  }
  function loggedIn() {
    try { return localStorage.getItem(SESSION_KEY) === '1'; } catch (e) { return false; }
  }
  /** Fragment navigation, the location.hash way. Fires hashchange. */
  function goHash(route) { location.hash = '#' + route; }
  /** Fragment navigation, the history.pushState way. Fires nothing; we render ourselves. */
  function goPush(route) {
    history.pushState({ route: route }, '', '/portal/#' + route);
    render();
  }

  window.addEventListener('hashchange', render);
  window.addEventListener('popstate', render);

  // ---------------------------------------------------------------- shell

  var shell = null;
  var view = null;
  var overlay = null;

  function closeMenus() {
    if (!shell) return;
    shell.querySelectorAll('#primary-nav li.open').forEach(function (li) {
      li.classList.remove('open');
      var t = li.querySelector(':scope > .menu-toggle');
      if (t) t.setAttribute('aria-expanded', 'false');
    });
    shell.querySelectorAll('[role="menubar"] [role="menu"]').forEach(function (m) { m.hidden = true; });
    shell.querySelectorAll('[role="menubar"] [aria-expanded]').forEach(function (m) { m.setAttribute('aria-expanded', 'false'); });
    closeOverlay();
  }

  function closeOverlay() {
    if (overlay) overlay.remove();
    overlay = null;
    var t = document.getElementById('accounts-trigger');
    if (t) t.setAttribute('aria-expanded', 'false');
  }

  function openOverlay(trigger) {
    var r = trigger.getBoundingClientRect();
    var pushLink = h('a', { class: 'dropdown-item', href: '/portal/#/payments', 'data-nav': 'push' }, 'Payments');
    pushLink.addEventListener('click', function (e) {
      e.preventDefault();
      closeMenus();
      goPush('/payments');
    });
    var menu = h('div', { id: 'accounts-menu', class: 'dropdown-menu show', 'aria-labelledby': 'accounts-trigger' },
      pushLink,
      h('a', { class: 'dropdown-item', href: '#/demands' }, 'Demands'),
      h('a', { class: 'dropdown-item', href: '#/refunds' }, 'Refund status'));
    menu.style.left = Math.round(r.left) + 'px';
    menu.style.top = Math.round(r.bottom + 2) + 'px';
    overlay = h('div', { class: 'overlay-container' }, menu);
    document.body.appendChild(overlay);
    trigger.setAttribute('aria-expanded', 'true');
  }

  function toggleListMenu(e) {
    var li = e.currentTarget.parentElement;
    var open = !li.classList.contains('open');
    // Opening a top-level menu closes the others; a nested one leaves its parent open.
    if (li.parentElement.classList.contains('menu')) closeMenus();
    li.classList.toggle('open', open);
    e.currentTarget.setAttribute('aria-expanded', String(open));
    e.stopPropagation();
  }

  function toggleAriaMenu(e) {
    var item = e.currentTarget;
    var sub = item.parentElement.querySelector(':scope > [role="menu"]');
    var open = sub.hidden;
    if (item.parentElement.parentElement.getAttribute('role') === 'menubar') closeMenus();
    sub.hidden = !open;
    item.setAttribute('aria-expanded', String(open));
    e.stopPropagation();
  }

  function buildShell() {
    // (a) nested ul/li. Submenus are in the DOM from the start and hidden by CSS.
    var nav = h('nav', { id: 'primary-nav', 'aria-label': 'Primary' },
      h('ul', { class: 'menu' },
        h('li', null, h('a', { href: '#/dashboard' }, 'Dashboard')),
        h('li', { class: 'has-sub' },
          h('button', { type: 'button', class: 'menu-toggle', 'aria-expanded': 'false', onclick: toggleListMenu }, 'Filing'),
          h('ul', { class: 'submenu' },
            h('li', null, h('a', { href: '#/returns' }, 'Returns')),
            h('li', { class: 'has-sub' },
              h('button', { type: 'button', class: 'menu-toggle', 'aria-expanded': 'false', onclick: toggleListMenu }, 'Applications'),
              h('ul', { class: 'submenu' },
                h('li', null, h('a', { href: '#/forms' }, 'New application')),
                h('li', null, h('a', { href: '#/drafts' }, 'Draft applications')))),
            h('li', null, h('a', { href: '#/annual' }, 'Annual statement'))))));

    // (b) overlay panel: exists in the DOM only while open, appended to <body>.
    var trigger = h('button', {
      type: 'button', id: 'accounts-trigger', class: 'menu-trigger',
      'aria-haspopup': 'true', 'aria-controls': 'accounts-menu', 'aria-expanded': 'false',
      onclick: function (e) {
        var wasOpen = !!overlay;
        closeMenus();
        if (!wasOpen) openOverlay(e.currentTarget);
        e.stopPropagation();
      },
    }, 'Accounts');

    // (c) ARIA menubar / menu / menuitem.
    var audit = h('span', { role: 'menuitem', tabindex: '-1' }, 'Audit trail');
    audit.addEventListener('click', function () { closeMenus(); goPush('/audit'); });
    var menubar = h('ul', { role: 'menubar', 'aria-label': 'Compliance' },
      h('li', { role: 'none' },
        h('span', { role: 'menuitem', tabindex: '0', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: toggleAriaMenu }, 'Compliance'),
        h('ul', { role: 'menu', 'aria-label': 'Compliance', hidden: true },
          h('li', { role: 'none' }, h('a', { role: 'menuitem', href: '#/proceedings' }, 'Proceedings')),
          h('li', { role: 'none' }, h('a', { role: 'menuitem', href: '#/notices' }, 'Notices')),
          h('li', { role: 'none' },
            h('span', { role: 'menuitem', tabindex: '-1', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: toggleAriaMenu }, 'Reports'),
            h('ul', { role: 'menu', 'aria-label': 'Reports', hidden: true },
              h('li', { role: 'none' }, audit))))));

    view = h('main', { id: 'view' });
    shell = h('div', { id: 'shell' },
      h('header', { class: 'site-header' },
        h('span', { class: 'brand' }, 'Harbourline Filing Portal'),
        nav, trigger, menubar,
        h('span', { class: 'spacer' }),
        h('a', { class: 'logout', href: '/portal/logout' }, 'Log out')),
      view);

    // Following a link inside any menu closes the menus.
    shell.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#/"]');
      if (a) closeMenus();
    });
    return shell;
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.closest) return;
    if (t.closest('#primary-nav, [role="menubar"], .overlay-container, #accounts-trigger')) {
      // Let the link's own navigation run before its panel leaves the DOM.
      if (t.closest('.overlay-container a[href^="#/"]')) setTimeout(closeMenus, 0);
      return;
    }
    closeMenus();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMenus();
  });

  // ------------------------------------------------------ web component

  class QuickLinks extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) return;
      var root = this.attachShadow({ mode: 'open' });
      var style = document.createElement('style');
      style.textContent = ':host{display:block;background:#fff;border:1px solid #d6dde6;border-radius:6px;padding:14px;margin-top:16px}' +
        'h2{font-size:15px;margin:0 0 8px}button{padding:6px 14px;border:1px solid #0b4f8a;border-radius:4px;background:#fff;color:#0b4f8a;cursor:pointer;font:inherit}';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'open-profile';
      btn.textContent = 'View profile';
      btn.addEventListener('click', function () { goHash('/profile'); });
      var title = document.createElement('h2');
      title.textContent = 'Quick links';
      root.appendChild(style);
      root.appendChild(title);
      root.appendChild(btn);
    }
  }
  customElements.define('quick-links', QuickLinks);

  // ---------------------------------------------------------------- pages

  var pages = {};

  pages['/login'] = function () {
    var error = h('div', { class: 'field-error', role: 'alert', hidden: true }, 'Enter your user id and password');
    var form = h('form', { id: 'login-form', novalidate: true, autocomplete: 'off' },
      h('div', { class: 'field' },
        h('label', { for: 'userId' }, 'User id'),
        h('input', { type: 'text', id: 'userId', name: 'userId', autocomplete: 'username', required: true })),
      h('div', { class: 'field' },
        h('label', { for: 'password' }, 'Password'),
        h('input', { type: 'password', id: 'password', name: 'password', autocomplete: 'current-password', required: true })),
      error,
      h('button', { type: 'submit', class: 'primary', id: 'btn-sign-in' }, 'Sign in'));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var u = form.querySelector('#userId').value;
      var p = form.querySelector('#password').value;
      if (!u || !p) {
        error.hidden = false;
        return;
      }
      try { localStorage.setItem(SESSION_KEY, '1'); } catch (err) {}
      goHash('/dashboard');
    });
    return h('div', { class: 'login-box panel' },
      h('h1', null, 'Sign in'),
      form,
      h('p', null, h('a', { href: '#/help' }, 'Filing guide')));
  };

  pages['/help'] = function () {
    return h('div', null,
      h('h1', null, 'Filing guide'),
      h('div', { class: 'panel' },
        h('p', null, 'Returns are filed once per quarter. Applications may be saved as drafts before they are sent.'),
        h('p', null, 'Proceedings list every notice issued to you, grouped by status.')),
      h('p', null, h('a', { href: loggedIn() ? '#/dashboard' : '#/login' }, loggedIn() ? 'Back to dashboard' : 'Back to sign in')));
  };

  pages['/dashboard'] = function () {
    var cards = h('div', { class: 'cards' });
    api('/api/summary').then(function (r) {
      var d = r.data;
      [['Returns filed', d.returnsFiled], ['Open proceedings', d.openProceedings], ['Outstanding demands', d.outstandingDemands], ['Ledger entries', d.ledgerEntries]].forEach(function (c) {
        cards.appendChild(h('div', { class: 'card' }, h('div', { class: 'n' }, c[1]), h('div', null, c[0])));
      });
    });
    return h('div', null,
      breadcrumb(['Home']),
      h('h1', null, 'Dashboard'),
      cards,
      h('quick-links'));
  };

  pages['/returns'] = function () {
    var state = { page: 1, size: 10, pages: 1 };
    var holder = h('div', { id: 'returns-holder' });
    var indicator = h('span', { class: 'page-indicator', 'aria-live': 'off' }, 'Page 1 of 1');
    var prev = h('button', { type: 'button', class: 'prev', 'aria-label': 'Previous page', disabled: true }, 'Previous');
    var next = h('button', { type: 'button', class: 'next', 'aria-label': 'Next page' }, 'Next');
    var columns = [
      { key: 'returnId', label: 'Return' },
      { key: 'period', label: 'Period' },
      { key: 'formType', label: 'Form' },
      { key: 'filedOn', label: 'Filed on' },
      { key: 'status', label: 'Status' },
      { key: 'amount', label: 'Tax paid', render: function (r) { return money(r.amount); } },
      { key: 'contactEmail', label: 'Contact email' },
      { key: 'contactPhone', label: 'Contact phone' },
      { key: 'taxId', label: 'Tax id' },
    ];
    function load() {
      return api('/api/returns?page=' + state.page + '&size=' + state.size).then(function (r) {
        state.pages = Math.max(1, Math.ceil(r.data.total / state.size));
        holder.replaceChildren(table('returns-table', columns, r.data.items));
        indicator.textContent = 'Page ' + state.page + ' of ' + state.pages;
        prev.disabled = state.page <= 1;
        next.disabled = state.page >= state.pages;
      });
    }
    prev.addEventListener('click', function () { if (state.page > 1) { state.page--; load(); } });
    next.addEventListener('click', function () { if (state.page < state.pages) { state.page++; load(); } });
    load();
    return h('div', null,
      breadcrumb(['Home', 'Filing', 'Returns']),
      h('h1', null, 'Returns'),
      h('div', { class: 'toolbar' },
        h('a', { class: 'action', id: 'open-guide', href: '/portal/#/help', target: '_blank' }, 'Open filing guide')),
      holder,
      h('div', { class: 'pagination', role: 'navigation', 'aria-label': 'Returns pages' }, prev, indicator, next));
  };

  pages['/payments'] = function () {
    var holder = h('div', { id: 'ledger-holder' }, h('p', null, 'Loading ledger…'));
    var count = h('span', { class: 'count' }, '');
    var rows = [];
    var columns = [
      { key: 'entryId', label: 'Entry' },
      { key: 'postedOn', label: 'Posted on' },
      { key: 'amount', label: 'Amount', render: function (r) { return money(r.amount); } },
      { key: 'status', label: 'Status' },
      { key: 'headCode', label: 'Head' },
      { key: 'counterparty', label: 'Counterparty' },
      { key: 'narration', label: 'Narration' },
      { key: 'contactEmail', label: 'Contact email' },
      { key: 'contactPhone', label: 'Contact phone' },
      { key: 'taxId', label: 'Tax id' },
    ];
    var exportBtn = h('button', { type: 'button', class: 'action', id: 'export-ledger', disabled: true }, 'Export CSV');
    exportBtn.addEventListener('click', function () {
      var lines = [columns.map(function (c) { return c.key; }).join(',')];
      rows.forEach(function (r) {
        lines.push(columns.map(function (c) { return '"' + String(r[c.key]).replace(/"/g, '""') + '"'; }).join(','));
      });
      var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = BLOB_FILE_NAME;
      a.style.display = 'none';
      document.body.appendChild(a);
      // The page's own scripted click: the ordinary way a Blob is saved.
      detector.selfAct(function () { a.click(); });
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });
    // One large call: the whole ledger, a few hundred KB of JSON.
    api('/api/ledger?page=1&size=2000').then(function (r) {
      rows = r.data.items;
      count.textContent = 'Showing 40 of ' + r.data.total + ' entries';
      holder.replaceChildren(table('ledger-table', columns, rows.slice(0, 40)));
      exportBtn.disabled = false;
    });
    return h('div', null,
      breadcrumb(['Home', 'Accounts', 'Payments']),
      h('h1', null, 'Payments ledger'),
      h('div', { class: 'toolbar' }, exportBtn, count),
      holder);
  };

  pages['/demands'] = function () {
    var holder = h('div', { id: 'demands-holder' });
    api('/api/demands').then(function (r) {
      holder.replaceChildren(table('demands-table', [
        { key: 'demandId', label: 'Demand' },
        { key: 'raisedOn', label: 'Raised on' },
        { key: 'amount', label: 'Amount', render: function (x) { return money(x.amount); } },
        { key: 'status', label: 'Status' },
      ], r.data.items));
    });
    return h('div', null,
      breadcrumb(['Home', 'Accounts', 'Demands']),
      h('h1', null, 'Demands'),
      h('div', { class: 'toolbar' },
        h('a', { class: 'action', id: 'download-notice', href: '/files/demand-notice.pdf' }, 'Download notice')),
      holder);
  };

  pages['/proceedings'] = function () {
    var state = { status: 'pending', period: 'all' };
    var holder = h('div', { id: 'proc-panel', role: 'tabpanel', 'aria-labelledby': 'tab-pending' });
    var tabs = [['pending', 'Pending'], ['responded', 'Responded'], ['closed', 'Closed']].map(function (t) {
      return h('button', { type: 'button', role: 'tab', id: 'tab-' + t[0], 'data-status': t[0], 'aria-selected': String(t[0] === state.status), 'aria-controls': 'proc-panel' }, t[1]);
    });
    var chips = [['all', 'All periods'], ['30d', 'Last 30 days'], ['12m', 'Last 12 months']].map(function (c) {
      return h('button', { type: 'button', class: 'chip', 'data-period': c[0], 'aria-pressed': String(c[0] === state.period) }, c[1]);
    });
    var columns = [
      { key: 'caseRef', label: 'Case', render: function (r) { return h('a', { href: '#/proceedings/detail/' + r.id }, r.caseRef); } },
      { key: 'section', label: 'Section' },
      { key: 'issuedOn', label: 'Issued on' },
      { key: 'officer', label: 'Officer' },
      { key: 'contactEmail', label: 'Officer email' },
      { key: 'taxId', label: 'Tax id' },
    ];
    function load() {
      // Only the rows change: same route, same controls.
      return api('/api/proceedings?status=' + state.status + '&period=' + state.period).then(function (r) {
        holder.replaceChildren(r.data.items.length ? table('proceedings-table', columns, r.data.items) : h('p', { class: 'empty' }, 'No proceedings match.'));
      });
    }
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        state.status = tab.getAttribute('data-status');
        tabs.forEach(function (t) { t.setAttribute('aria-selected', String(t === tab)); });
        holder.setAttribute('aria-labelledby', tab.id);
        load();
      });
    });
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        state.period = chip.getAttribute('data-period');
        chips.forEach(function (c) { c.setAttribute('aria-pressed', String(c === chip)); });
        load();
      });
    });
    load();
    return h('div', null,
      breadcrumb(['Home', 'Compliance', 'Proceedings']),
      h('h1', null, 'Proceedings'),
      h('div', { role: 'tablist', 'aria-label': 'Status' }, tabs),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Period' }, chips),
      holder);
  };

  function proceedingDetail(id) {
    var body = h('dl', { class: 'detail', id: 'proceeding-detail' });
    api('/api/proceedings/' + encodeURIComponent(id)).then(function (r) {
      var d = r.data;
      [['Case', d.caseRef], ['Section', d.section], ['Status', d.status], ['Issued on', d.issuedOn], ['Officer', d.officer], ['Officer email', d.contactEmail], ['Officer phone', d.contactPhone], ['Tax id', d.taxId]].forEach(function (p) {
        body.appendChild(h('dt', null, p[0]));
        body.appendChild(h('dd', null, p[1]));
      });
    }, function () {
      body.appendChild(h('dt', null, 'Error'));
      body.appendChild(h('dd', null, 'This proceeding could not be loaded.'));
    });
    return h('div', null,
      breadcrumb(['Home', 'Compliance', 'Proceedings', 'Detail']),
      h('h1', null, 'Proceeding detail'),
      h('div', { class: 'panel' }, body),
      h('p', null, h('a', { id: 'back-to-proceedings', href: '#/proceedings' }, 'Back to proceedings')));
  }

  pages['/forms'] = function () {
    var subjectError = h('div', { class: 'field-error', role: 'alert', id: 'subject-error', hidden: true }, 'Subject is required');
    var subject = h('input', { type: 'text', id: 'subject', name: 'subject', required: true, maxlength: '80', 'aria-describedby': 'subject-error' });
    subject.addEventListener('blur', function () { subjectError.hidden = subject.value.trim() !== ''; });
    subject.addEventListener('input', function () { if (subject.value.trim() !== '') subjectError.hidden = true; });

    var category = h('select', { id: 'category', name: 'category' },
      h('option', { value: '' }, 'Select a category'),
      h('option', { value: 'income' }, 'Income'),
      h('option', { value: 'deductions' }, 'Deductions'),
      h('option', { value: 'refunds' }, 'Refunds'));
    var sub = h('select', { id: 'subcategory', name: 'subcategory', disabled: true }, h('option', { value: '' }, 'Select a category first'));
    category.addEventListener('change', function () {
      var chosen = category.value;
      if (!chosen) {
        detector.selfAct(function () {
          sub.replaceChildren(h('option', { value: '' }, 'Select a category first'));
          sub.disabled = true;
        });
        return;
      }
      apiXhr('/api/subcategories?category=' + encodeURIComponent(chosen)).then(function (r) {
        detector.selfAct(function () {
          sub.replaceChildren(h('option', { value: '' }, 'Select a sub-category'));
          r.data.items.forEach(function (o) { sub.appendChild(h('option', { value: o.code }, o.label)); });
          sub.disabled = false;
        });
      });
    });

    var notice = h('div', { class: 'notice', hidden: true }, 'Application received.');
    var form = h('form', { id: 'application-form', action: '/api/submit-trap', method: 'post', novalidate: true },
      h('div', { class: 'field' }, h('label', { for: 'subject' }, 'Subject'), subject, subjectError),
      h('div', { class: 'field' }, h('label', { for: 'category' }, 'Category'), category),
      h('div', { class: 'field' }, h('label', { for: 'subcategory' }, 'Sub-category'), sub),
      h('div', { class: 'field' }, h('label', { for: 'effectiveDate' }, 'Effective date'), h('input', { type: 'date', id: 'effectiveDate', name: 'effectiveDate' })),
      h('div', { class: 'field' }, h('label', { for: 'attachment' }, 'Supporting document'), h('input', { type: 'file', id: 'attachment', name: 'attachment', accept: '.pdf,.txt' })),
      h('button', { type: 'submit', class: 'primary', id: 'btn-submit' }, 'Submit'),
      notice);
    form.addEventListener('submit', function (e) {
      // A real submit is irreversible on a real portal. Nothing in the harness ever gets here.
      e.preventDefault();
      notice.hidden = false;
      try { navigator.sendBeacon('/api/submit-trap?via=submit-event'); } catch (err) {}
    });
    return h('div', null,
      breadcrumb(['Home', 'Filing', 'Applications', 'New application']),
      h('h1', null, 'New application'),
      h('div', { class: 'panel' }, form));
  };

  pages['/profile'] = function () {
    var body = h('dl', { class: 'detail', id: 'profile-detail' });
    api('/api/profile').then(function (r) {
      var d = r.data;
      [['Name', d.displayName], ['Email', d.contactEmail], ['Phone', d.contactPhone], ['Tax id', d.taxId], ['Registered on', d.registeredOn], ['Category', d.category]].forEach(function (p) {
        body.appendChild(h('dt', null, p[0]));
        body.appendChild(h('dd', null, p[1]));
      });
    });
    return h('div', null,
      breadcrumb(['Home', 'Profile']),
      h('h1', null, 'Taxpayer profile'),
      h('div', { class: 'panel' }, body));
  };

  function placeholder(title, crumbs) {
    return function () {
      return h('div', null, breadcrumb(crumbs), h('h1', null, title), h('div', { class: 'panel' }, h('p', null, 'Nothing to show yet.')));
    };
  }
  pages['/drafts'] = placeholder('Draft applications', ['Home', 'Filing', 'Applications', 'Drafts']);
  pages['/annual'] = placeholder('Annual statement', ['Home', 'Filing', 'Annual statement']);
  pages['/refunds'] = placeholder('Refund status', ['Home', 'Accounts', 'Refund status']);
  pages['/notices'] = placeholder('Notices', ['Home', 'Compliance', 'Notices']);
  pages['/audit'] = placeholder('Audit trail', ['Home', 'Compliance', 'Reports', 'Audit trail']);

  // --------------------------------------------------------------- render

  var PUBLIC = { '/login': true, '/help': true };

  function render() {
    renderToken++;
    if (detector) detector.sweep();
    var route = currentRoute();
    if (!route) {
      location.replace('/portal/#' + (loggedIn() ? '/dashboard' : '/login'));
      return;
    }
    if (!loggedIn() && !PUBLIC[route]) {
      location.replace('/portal/#/login');
      return;
    }
    if (loggedIn() && route === '/login') {
      location.replace('/portal/#/dashboard');
      return;
    }

    var page;
    var detail = /^\/proceedings\/detail\/([^/]+)$/.exec(route);
    if (detail) page = proceedingDetail(detail[1]);
    else if (pages[route]) page = pages[route]();
    else page = h('div', null, h('h1', null, 'Page not found'), h('p', null, h('a', { href: '#/dashboard' }, 'Go to dashboard')));

    if (loggedIn()) {
      if (!shell || !shell.isConnected) {
        app.replaceChildren(buildShell());
      }
      closeMenus();
      view.replaceChildren(page);
    } else {
      shell = null;
      view = null;
      closeOverlay();
      app.replaceChildren(h('main', { id: 'view' }, page));
    }
    window.scrollTo(0, 0);
    if (detector) detector.rebaseAll();
  }

  render();
})();
