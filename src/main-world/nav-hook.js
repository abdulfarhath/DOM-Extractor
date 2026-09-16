/* MAIN-world navigation hook (Q7). history.pushState/replaceState patched in the
   isolated world only see the isolated world's own calls; the page's Angular
   router lives here. Forwards each call as a nav message that observe.js turns
   into a `nav:<kind>` trigger. popstate/hashchange are real DOM events and are
   handled in the isolated world directly. */
(() => {
  if (window.__mcadcNavHooked) return;
  window.__mcadcNavHooked = true;

  /**
   * @param {string} kind
   */
  const post = (kind) => {
    try {
      window.postMessage({ __mcadc: 'nav', kind }, location.origin);
    } catch {
      /* never throw into the page */
    }
  };

  for (const fn of /** @type {const} */ (['pushState', 'replaceState'])) {
    const orig = history[fn];
    if (typeof orig !== 'function') continue;
    history[fn] = function (...args) {
      // @ts-ignore — forwarding the overloaded signature verbatim
      const r = orig.apply(this, args);
      post(fn);
      return r;
    };
  }
})();
