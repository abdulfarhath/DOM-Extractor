/**
 * AUTOMATION-BRIEF.md — docs/08. The agent handoff: written for someone who
 * has never seen the site. Ten sections, in the order docs/08 lists them; the
 * constraints block is included verbatim.
 */
import { TOOL_NAME, TOOL_VERSION } from '../../shared/constants.js';
import { stemFor } from './naming.js';
import { flowNarrative, attentionList, renderSection, cell, trunc, stateName } from './narrative.js';

/** @typedef {import('../../shared/schema.js').StateRecord} StateRecord */
/** @typedef {import('../../shared/schema.js').FlowMap} FlowMap */
/** @typedef {import('../../shared/schema.js').SessionMeta} SessionMeta */
/** @typedef {import('../../shared/schema.js').NetEntry} NetEntry */
/** @typedef {import('../../shared/schema.js').RepeatPattern} RepeatPattern */
/** @typedef {import('../../shared/schema.js').TablePattern} TablePattern */
/** @typedef {import('../../shared/schema.js').PaginationPattern} PaginationPattern */
/** @typedef {import('../../shared/schema.js').DownloadPattern} DownloadPattern */

const CONSTRAINTS = [
  '> This capture is a description of a site, not permission to act on it.',
  '> Automation written from it must: use the user\'s own authenticated session',
  '> rather than storing credentials; leave login, OTP, captcha, payment,',
  '> signing and final submission to the human; never bypass a security control;',
  '> verify each selector at runtime and fail loudly rather than silently filling',
  '> the wrong field; and respect the site\'s terms of use. Controls marked',
  '> `redactedEntirely` in flow-map.json are for the human to fill and must never',
  '> be automated.',
];

/**
 * @param {StateRecord[]} states
 * @param {FlowMap} map
 * @param {SessionMeta} meta
 * @param {NetEntry[]} net
 * @returns {string}
 */
export function buildBrief(states, map, meta, net) {
  /** @type {string[]} */
  const out = [];
  const fw = states.find((s) => s.framework && s.framework.framework !== 'plain') || states[0];
  const loggedIn = states.filter((s) => s.authHints && s.authHints.loggedIn === true).length;
  const loggedOut = states.filter((s) => s.authHints && s.authHints.loggedIn === false).length;
  const usesShadow = states.some((s) => s.usesShadowDom);

  // 1. Header
  out.push(`# Automation brief — ${map.origin}`);
  out.push('');
  out.push(`Captured with ${TOOL_NAME} ${TOOL_VERSION}; session ${meta.sessionStartedAt}, exported ${new Date().toISOString()}.`);
  out.push('');
  out.push(`- **Origin:** \`${map.origin}\``);
  out.push(`- **Framework:** ${map.framework}${fw && fw.framework.version ? ` ${fw.framework.version}` : ''} (${fw ? fw.framework.confidence : 'unknown'} confidence)${usesShadow ? ' — uses shadow DOM, see §2' : ''}`);
  const humanOnly = map.controls.filter((c) => c.redactedEntirely).length;
  out.push(`- **States:** ${states.length} across ${new Set(states.map((s) => s.pathname)).size} paths; **controls:** ${map.controls.length}${humanOnly ? ` (${humanOnly} human-only, \`redactedEntirely\`)` : ''}; **list patterns:** ${map.lists.length}`);
  const authConf = states.map((s) => (s.authHints ? s.authHints.confidence : 'low'));
  const bestConf = authConf.includes('high') ? 'high' : authConf.includes('medium') ? 'medium' : 'low';
  out.push(`- **Session auth:** ${loggedIn && !loggedOut ? 'looked logged in throughout' : loggedIn ? `logged in on ${loggedIn} states, logged out on ${loggedOut}` : loggedOut ? 'looked logged out' : 'unknown (no auth signal seen)'} — ${bestConf} confidence, from password fields / autocomplete tokens / login-logout paths${bestConf === 'low' ? ' / English button text' : ''}`);
  out.push(`- **Language hint:** ${states[0] && states[0].lang ? `\`<html lang="${cell(states[0].lang)}">\`` : 'none declared'}`);
  out.push('');

  // 2. How to read
  out.push('## 2. How to read this package');
  out.push('');
  out.push('- **`flow-map.json`** — ground truth. Every unique control with its selector, fallbacks, stability, validation hints, options, entry mode, and the state graph. Reach for this first.');
  out.push('- **`selectors.json`** — the same selectors as a flat `{ key: selector }` map, plus `fallbacks` and `shadowPaths`, for importing into code.');
  out.push('- **`states/`** — one JSON per captured page state: the full control inventory, buttons, errors, list patterns, viewport and scroll at that moment. Ground truth for a single page.');
  out.push('- **`dom/`** — sanitised HTML per state, values stripped, open shadow roots inlined as `<template shadowrootmode="open">`. Open in a browser to see structure.');
  out.push('- **`screens/`** — PNG per state (top-frame only). **Orientation only** — never derive selectors from a picture.');
  out.push('- **`network.har`** — every fetch/XHR the page made, with scrubbed bodies. Reference data and cascade endpoints live here. Timings are approximate.');
  out.push('- **`playwright-skeleton.ts`** — a commented-out shape with one function per state. Not runnable; nothing in it was executed.');
  out.push('- **`SUMMARY.md`** — the human-readable overview with the attention list.');
  out.push('');
  if (usesShadow) {
    out.push('**Shadow DOM.** Some controls live inside open shadow roots. Their `selectors.shadowPath` lists the host elements to traverse, in order, before the `primary` selector applies inside the last root. Playwright\'s CSS engine pierces open shadow roots automatically; Selenium, Puppeteer `$` and plain `querySelector` do not — query each host, then its `shadowRoot`. Ignoring `shadowPath` produces code that silently matches nothing.');
    out.push('');
    out.push('**Control order is approximate on these states** (`orderApproximate: true`). Controls inside shadow roots are listed after the light-DOM controls of their document, not at the host\'s position, so `index` does not reflect visual or tab order. Use `boundingBox` (with `scroll`) when order matters.');
    out.push('');
  }
  const opaqueCount = states.reduce((n, s) => n + ((s.opaqueRegions && s.opaqueRegions.length) || 0), 0);
  if (opaqueCount) {
    out.push(`**Blind spots.** ${opaqueCount} region(s) were closed shadow roots the capture could not see into; they are listed in §8. Treat anything inside them as unknown.`);
    out.push('');
  }

  // 3. Flow
  out.push('## 3. The flow');
  out.push('');
  out.push(...flowNarrative(states, map.transitions, map.timeline));
  out.push('');

  // 4. Pages and controls
  out.push('## 4. Pages and their controls');
  out.push('');
  const controlsOn = new Map();
  for (const c of map.controls) for (const sid of c.seenOnStates) {
    const arr = controlsOn.get(sid) || [];
    arr.push(c);
    controlsOn.set(sid, arr);
  }
  for (const s of states) {
    const controls = controlsOn.get(s.id) || [];
    out.push(`### ${s.seq}. ${cell(trunc(s.title || s.pathname, 70))} — \`${cell(s.pathname)}\`${s.inIframe ? ' (iframe)' : ''}`);
    out.push('');
    out.push(`State \`${s.id}\`, files \`${stemFor(s)}.*\`. ${s.headings.length ? `Headings: ${s.headings.slice(0, 5).map((h) => `"${cell(trunc(h, 50))}"`).join(', ')}.` : ''}${s.steps.length ? ` Steps: ${s.steps.map((st) => (st.active ? `**${cell(st.text)}**` : cell(st.text))).join(' › ')}.` : ''}`);
    if (s.errors.length) out.push(`Visible errors at capture: ${s.errors.slice(0, 4).map((e) => `"${cell(trunc(e, 80))}"`).join('; ')}.`);
    const danger = s.buttons.filter((b) => b.danger);
    if (danger.length) out.push(`Buttons not to press: ${danger.map((b) => `"${cell(b.text)}" (\`${cell(b.selector)}\`)`).join(', ')}.`);
    out.push('');
    if (!controls.length) {
      out.push('_No form controls on this state._');
      out.push('');
      continue;
    }
    out.push('| key | label | type | required | entry | primary selector | stability |');
    out.push('|---|---|---|---|---|---|---|');
    for (const c of controls) {
      const entry = c.redactedEntirely ? '**HUMAN** (redacted)' : c.entry ? (c.entry.mode === 'widget' ? `widget: ${c.entry.widgetKind || '?'}` : c.entry.mode) : '';
      out.push(`| \`${cell(c.key)}\` | ${cell(trunc(c.label, 50))} | ${c.type} | ${c.required ? 'yes' : ''} | ${entry} | \`${cell(c.selectors.primary)}\`${c.selectors.shadowPath.length ? ' ⧉' : ''} | ${c.selectors.stability} |`);
    }
    out.push('');
    out.push('⧉ = inside shadow roots; see `shadowPath` in `flow-map.json`. **HUMAN** = `redactedEntirely`: the selector is here so the automation can wait on it, never fill it.');
    out.push('');
  }

  // 5. Reference data
  out.push('## 5. Reference data');
  out.push('');
  const withOptions = map.controls.filter((c) => c.options && c.options.length);
  if (!withOptions.length) out.push('_No option lists were captured._');
  for (const c of withOptions) {
    const opts = c.options || [];
    out.push(`- \`${cell(c.key)}\` (${cell(trunc(c.label, 40))}) — ${opts.length} option${opts.length === 1 ? '' : 's'}${opts.length >= 60 ? ' (capped at 60)' : ''}: ${opts.slice(0, 12).map((o) => `\`${cell(o.v)}\`=${cell(trunc(o.t, 30))}`).join(', ')}${opts.length > 12 ? ', …' : ''}`);
  }
  const endpoints = new Map();
  for (const n of net) {
    if (!n.mimeType || !/json|xml/i.test(n.mimeType) || !n.responseBody) continue;
    let path;
    try {
      path = `${n.method} ${new URL(n.url).pathname}`;
    } catch {
      path = `${n.method} ${n.url}`;
    }
    endpoints.set(path, (endpoints.get(path) || 0) + 1);
  }
  if (endpoints.size) {
    out.push('');
    out.push('Endpoints that returned structured data (see `network.har` for bodies):');
    out.push('');
    for (const [p, n] of Array.from(endpoints.entries()).sort((a, b) => b[1] - a[1]).slice(0, 40)) out.push(`- \`${cell(p)}\` × ${n}`);
  }
  out.push('');

  // 6. Dependencies
  out.push('## 6. Dependencies');
  out.push('');
  if (!map.dependencies.length) out.push('_No dependent-control behaviour was observed._');
  for (const d of map.dependencies) {
    out.push(`- Changing \`${cell(d.sourceKey)}\` ${d.targetKeys.length ? `reloads ${d.targetKeys.map((t) => `\`${cell(t)}\``).join(', ')}` : 'triggers a request'}${d.viaNetwork && d.endpoint ? ` via \`${cell(d.endpoint)}\`` : ''} (${d.confidence} confidence, seen on ${d.stateId}). Wait for the ${d.viaNetwork ? 'response' : 'options'} before continuing.`);
  }
  out.push('');

  // 7. List patterns
  out.push('## 7. List patterns');
  out.push('');
  if (!map.lists.length) out.push('_No tables, repeated items, pagination or download links were detected._');
  for (const l of map.lists) {
    if (l.kind === 'table') {
      const t = /** @type {TablePattern} */ (l.pattern);
      out.push(`- **Table** \`${cell(t.containerSelector)}\`${t.shadowPath.length ? ` (shadow hosts: ${t.shadowPath.map((h) => `\`${cell(h)}\``).join(' → ')})` : ''}: columns ${t.headers.map((h) => `"${cell(h)}"`).join(', ') || '(no headers found)'}; ${t.rowCount} rows via \`${cell(t.rowSelector)}\`; cells ${t.sampleRow.map((c) => `\`${cell(c.selector)}\` ${c.sample}`).join(', ')}. Seen on ${l.seenOnStates.join(', ')}.`);
    } else if (l.kind === 'repeat') {
      const r = /** @type {RepeatPattern} */ (l.pattern);
      out.push(`- **Repeated items** \`${cell(r.itemSelector)}\` (${r.itemCount} rendered)${r.shadowPath.length ? ` inside shadow hosts ${r.shadowPath.map((h) => `\`${cell(h)}\``).join(' → ')}` : ''}. Per-item slots: ${r.slots.map((s) => `${s.name} ${s.kind} \`${cell(s.selector)}\` ${s.sample}${s.download ? ' **download**' : ''}`).join('; ') || 'none'}. Seen on ${l.seenOnStates.join(', ')}.`);
    } else if (l.kind === 'pagination') {
      const p = /** @type {PaginationPattern} */ (l.pattern);
      out.push(`- **Pagination** (${p.style}) in \`${cell(p.containerSelector)}\`: next ${p.next ? `\`${cell(p.next)}\`` : 'not found'}, prev ${p.prev ? `\`${cell(p.prev)}\`` : 'not found'}, page indicator ${p.pageIndicator ? `\`${cell(p.pageIndicator)}\`` : 'not found'}. Seen on ${l.seenOnStates.join(', ')}.`);
    } else {
      const d = /** @type {DownloadPattern} */ (l.pattern);
      out.push(`- **Download** \`${cell(d.selector)}\` — ${d.extension ? `.${d.extension}` : 'unknown type'}, ${d.href === 'direct' ? 'direct URL' : 'script-driven (expect a download event, not a URL)'}${d.downloadAttr ? ', has download attribute' : ''}. Seen on ${l.seenOnStates.join(', ')}.`);
    }
  }
  out.push('');

  // 8. Weak points
  out.push('## 8. Known weak points');
  out.push('');
  for (const section of attentionList(states, map)) renderSection(out, section, 60);

  // 9. Constraints
  out.push('## 9. Constraints for whoever writes the automation');
  out.push('');
  out.push(...CONSTRAINTS);
  out.push('');

  // 10. What I want automated
  out.push('## 10. What I want automated');
  out.push('');
  out.push('_Fill this in before handing the folder over. Say which pages, which controls get values from where, what "done" looks like, and what must stay manual._');
  out.push('');
  out.push('> ');
  out.push('');
  out.push(`Then tell the agent: "Read AUTOMATION-BRIEF.md, then flow-map.json. Build <what you wrote>." Starting point: ${states.length ? stateName(states[0]) : 'the first state'}.`);
  out.push('');
  return out.join('\n');
}
