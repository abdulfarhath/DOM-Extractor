/* Framework detection — docs/02. Two sources: DOM attributes visible from the
   isolated world (this file) and page globals visible only from the MAIN world
   (hooks.js answers a `detect` request). The MAIN-world answer wins when it is
   more confident. Result drives selector ranking.
   Classic script: exposes window.__FP.framework. */
(() => {
  window.__FP = window.__FP || {};

  /** @type {FrameworkInfo|null} */
  let mainWorld = null;
  /** @type {FrameworkInfo|null} */
  let cached = null;

  const RANK = { high: 3, medium: 2, low: 1 };

  /**
   * DOM-only evidence. Attributes survive world isolation; expando properties
   * and globals do not.
   * @returns {FrameworkInfo}
   */
  const detectFromDom = () => {
    const d = document;
    const ng = d.querySelector('[ng-version]');
    if (ng) return info('angular', ng.getAttribute('ng-version'), 'high');
    if (d.querySelector('[ng-reflect-name], [_nghost-ng-c0], [ng-reflect-form]') || hasAttrPrefix('_ngcontent-', '_nghost-', 'ng-reflect-')) {
      return info('angular', null, 'medium');
    }
    if (d.querySelector('[data-reactroot], [data-reactid]')) return info('react', null, 'high');
    if (d.querySelector('#__next, #__nuxt, [data-v-app]')) {
      return d.querySelector('#__next') ? info('react', null, 'medium') : info('vue', null, 'medium');
    }
    if (hasAttrPrefix('data-v-')) return info('vue', null, 'medium');
    if (d.querySelector('[class*="svelte-"]')) return info('svelte', null, 'medium');
    return info('plain', null, 'low');
  };

  /**
   * Scans a bounded sample of elements for attribute-name prefixes.
   * @param {...string} prefixes
   * @returns {boolean}
   */
  const hasAttrPrefix = (...prefixes) => {
    const els = document.querySelectorAll('body *');
    const limit = Math.min(els.length, 400);
    for (let i = 0; i < limit; i++) {
      for (const a of els[i].attributes) {
        for (const p of prefixes) if (a.name.startsWith(p)) return true;
      }
    }
    return false;
  };

  /**
   * @param {FrameworkInfo['framework']} framework
   * @param {string|null} version
   * @param {FrameworkInfo['confidence']} confidence
   * @returns {FrameworkInfo}
   */
  const info = (framework, version, confidence) => ({
    framework,
    version: version || null,
    confidence,
    webComponents: false,
  });

  /**
   * @param {Partial<FrameworkInfo>} partial
   */
  const mergeMainWorld = (partial) => {
    if (!partial || !partial.framework) return;
    mainWorld = {
      framework: partial.framework,
      version: partial.version ?? null,
      confidence: partial.confidence || 'medium',
      webComponents: !!partial.webComponents,
    };
    cached = null;
  };

  /** @returns {FrameworkInfo} */
  const detect = () => {
    if (cached) return cached;
    const dom = detectFromDom();
    const ns = /** @type {FPNamespace} */ (window.__FP);
    const shadow = ns.fields ? ns.fields.hasShadowRoots(document) : false;
    let best = dom;
    if (mainWorld && (mainWorld.framework !== 'plain') && (dom.framework === 'plain' || RANK[mainWorld.confidence] >= RANK[dom.confidence])) {
      best = { ...mainWorld };
      if (!best.version && dom.framework === best.framework) best.version = dom.version;
    }
    cached = { ...best, webComponents: shadow || !!(mainWorld && mainWorld.webComponents) };
    return cached;
  };

  window.__FP.framework = { detect, mergeMainWorld, current: () => cached };
})();
