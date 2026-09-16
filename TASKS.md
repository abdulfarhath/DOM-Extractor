# TASKS

Append-only build log. One entry per phase. Newest at the bottom.

## <date> — P<n> <phase name>
- Built:
- Files:
- Left out:
- `npm run check`: pass / fail

---

## 2026-09-16 — P0 Scaffold
- Built: rebuilt from the MCA DOM Capturer pass as **Flowprint**. `package.json`
  (`typescript` + `@types/chrome` only), `jsconfig.json` unchanged, MV3
  `manifest.json` on `<all_urls>` with `storage`, `unlimitedStorage`,
  `downloads`, `sidePanel`, `tabs` and — per docs/09 Q14 — `offscreen`; MAIN-
  world `hooks.js` at `document_start`, isolated classic scripts (packs first,
  then libs, then `capture.js`) at `document_idle`, module service worker,
  side panel registered.
- Files: `package.json`, `manifest.json`, `src/types/globals.d.ts`. The old
  `src/` tree and README were removed wholesale; logic is re-homed under the
  new layout in the phases below. The prototype flat files named in CLAUDE.md
  were already deleted in the first build; their field-extraction and label
  logic lives on in `fields.js` / `labels.js`.
- Left out: nothing. `check` stays `tsc -p jsconfig.json --noEmit` (bare `tsc`
  ignores `jsconfig.json`).
- `npm run check`: pass

## 2026-09-16 — P1 Shared foundations
- Built: `shared/constants.js` (`fp:` keys incl. `fp:queue`/`fp:lock` for A4,
  caps 500/2500, timings incl. A2 breaker values, message types, default
  danger words, pack registry), `shared/schema.js` (typedefs for every record
  in docs/03 plus A1 `shadowPath`/`opaqueRegions`, A2 `captureDegraded`, A3
  `blockedFrames`, A5 `degraded`, A6 `entry`/`file`, A7 `collidesWith`, A8
  `timeline`), `content/packs/generic.js` (email, phone, Luhn-checked card,
  JWT, bearer/sk-/AIza tokens, IBAN), `content/packs/india.js` (GSTIN, PAN,
  IFSC, passport, Aadhaar, phone, DIN), `content/lib/redact.js` (rule 2 value
  redaction, rule 3 credential regex from docs/05 incl. `autocomplete`, rule 4
  pack-driven scrub with runtime pack toggling).
- Files: `src/shared/constants.js`, `src/shared/schema.js`,
  `src/content/packs/generic.js`, `src/content/packs/india.js`,
  `src/content/lib/redact.js`.
- Left out: packs are classic scripts registering on `window.__FP.packs`
  rather than ES exports (content scripts cannot import) — see Q1.
- `npm run check`: pass

## 2026-09-16 — P2 Consent gate
- Built: `background/lib/origins.js` — `originOf`, `listOrigins`,
  `isConsented`, `addOrigin`, `removeOrigin`, `autoPacks` (host-suffix pack
  auto-enable). The content-script early exit is the first thing
  `content/capture.js` does (P7): a `GATE_CHECK` round-trip, no listeners
  installed unless consented, `chrome.storage.onChanged` on `fp:origins` to
  stop at once when removed. Tab reload on consent and the panel origin bar
  land in `service-worker.js` (P8) and `panel.js` (P9) — built in one run, so
  the wiring is described here and delivered there.
- Files: `src/background/lib/origins.js`.
- Left out: nothing.
- `npm run check`: pass

## 2026-09-16 — P3 Detection and identification
- Built: `framework.js` (DOM-attribute detection for Angular/React/Vue/Svelte
  with confidence, merged with the MAIN-world globals answer from `hooks.js`;
  `webComponents` from shadow roots), `labels.js` (eight strategies, root-aware
  so `label[for]` resolves inside shadow roots, language-free container and
  label selectors from docs/02), `selectors.js` (seven candidate ranks with
  automation attributes first, Angular binding promoted above id, React/Vue
  suspicious ids demoted below name, generated-id rejection incl. `radix-`,
  uniqueness against the element's own root and its closest
  `form`/`[role=form]` with the Q5 `likely` rule, `shadowPath` host chain,
  plus the general `forElement`/`relativeSelector` builders the list and
  button code uses).
- Files: `src/content/lib/framework.js`, `src/content/lib/labels.js`,
  `src/content/lib/selectors.js`.
- Left out: XPath candidates are skipped inside shadow roots (XPath cannot
  traverse them).
- `npm run check`: pass

## 2026-09-16 — P4 Control inventory
- Built: `fields.js` — deep-DOM helpers (`walk`, `queryDeep`,
  `hasShadowRoots`, `findOpaque` for A1 closed roots), `collectControls` over
  native controls plus the five ARIA widget roles, `describeControl` producing
  the full ControlRecord: `key` in Q16 order (automation attr → Angular
  binding → authored id → name → label → aria-label → positional), all
  `data-*` attrs, `ariaDescribedByText`, `step/min/max`, ARIA-aware
  disabled/readonly/checked, listbox options, A6 `entry` heuristics
  (file/select/checkable/native date/combobox/listbox/aria-popup/readonly-
  enabled/adjacent icon/mask/unknown) and `file` hints with the value never
  recorded for file inputs.
- Files: `src/content/lib/fields.js`.
- Left out: the A6 "overlay appears in the next state after a click" signal
  needs two states, so it is applied at export in `flowmap.js` (P10).
- `npm run check`: pass

## 2026-09-16 — P5 Lists and structure
- Built: `lists.js` — tables (native and ARIA grid: container selector,
  headers, row count, row selector, sample row with redacted cells), repeated
  items (siblings grouped by tag + stable-class signature, ≥3 with content,
  nested repeats folded into their parent item, container/item selectors and
  up to 12 text/link/image slots with item-relative selectors and redacted
  samples; `download: true` on document links), pagination (class/aria/rel
  matches plus consecutive-integer runs; next/prev/page-indicator selectors
  and style numbered / next-prev / load-more / unknown, language-free), and
  downloads (`a[download]` or document extension; direct vs script href).
  All deep through open shadow roots with `shadowPath` on containers.
- Files: `src/content/lib/lists.js`.
- Left out: virtualised lists report only the rendered items; the count is
  what is in the DOM, not the dataset.
- `npm run check`: pass

## 2026-09-16 — P6 Snapshot and network
- Built: `dom-snapshot.js` (clone → pair-by-index redaction per root → open
  shadow roots inlined as `<template shadowrootmode="open">` recursively →
  hollow script/style/noscript/svg → strip comments → truncate attributes /
  data: URIs → gzip → base64; hidden inputs `<hidden>`, credentials
  `<redacted>`, file inputs value removed), `main-world/hooks.js` (fetch
  wrapper returning the original Response and rethrowing original errors,
  clone body read raced against a 5s timeout, one message per call; XHR
  open/setRequestHeader/send with per-instance WeakMap meta; history
  pushState/replaceState patch folded in per Q7; MAIN-world framework
  detection answered on a `detect` request — Angular/React/Vue/jQuery globals
  and expandos, custom-element / shadow-root presence).
- Files: `src/content/lib/dom-snapshot.js`, `src/main-world/hooks.js`.
- Left out: WebSocket / EventSource / sendBeacon traffic — not in docs/02.
- `npm run check`: pass

## 2026-09-16 — P7 Orchestration
- Built: `observe.js` (MutationObserver with the A2 volume breaker — >500
  records/s cuts `dom-change` for 10s and reports `onThrottle`; cheap filter
  drops characterData, class/style-only and decoration-region mutations;
  capture-phase click with Q17 listbox→`change:<owner key>`; `change` for
  select/radio/checkbox/file/ARIA widgets; popstate/hashchange; MAIN-world
  nav messages; `load`), `capture.js` (GATE_CHECK first and nothing installed
  unless consented; A3 `FRAME_BLOCKED` when an iframe is refused inside a
  consented page; flags mirrored from `fp:meta`, immediate stop when the
  origin leaves `fp:origins`; 900ms debounce, first-non-dom-change
  attribution with full burst list, A2 2s rate cap with manual exempt,
  signature + errors dedupe, StateDraft with headings/steps/buttons (danger =
  submit type in a form or danger-word match, selectors on buttons)/errors/
  notices/authHints/controls/lists/shadow flags/opaque regions/
  captureDegraded, DOM snapshot, scrubbed net forwarding incl. header
  values, THROTTLED reporting, MAIN-world framework detect request).
- Files: `src/content/lib/observe.js`, `src/content/capture.js`.
- Left out: nothing.
- `npm run check`: pass

## 2026-09-16 — P8 Background store and analysis
- Built: `store.js` (`withLock` = in-worker promise chain + stored `fp:lock`
  with stale-steal (A4); `reconcile` on every worker start drops queue
  entries >30s and locks >5s and never relies on `onStartup`; meta with
  danger words, packs, timeline, degraded flags, blocked frames, throttle
  map; `addState` with the 500 cap, per-state `fp:dom:` key, quota check
  via `navigator.storage.estimate()` and the A5 degradation ladder
  screenshots → snapshots → net trim → refuse, retry-without-snapshot on a
  failed write; `addNet` with `stateIdInferred`; persisted screenshot queue;
  `clearAll` incl. origins), `transitions.js` (edges with `listCountsChanged`;
  `gapBetween` for A8 pause/resume/clear boundaries), `deps.js`
  (`sourceKey`/`targetKeys`), `service-worker.js` (gate check with
  `topConsented`, consent add → pack recompute + tab reload, remove, origin
  info with blocked frames, state capture re-checking consent and pause, A8
  chain break across gaps / tabs / origins, screenshot queue throttled 600ms
  / max 3 / drop and skipped for iframes (Q1), pause writes timeline events,
  danger-word and pack setters, throttle reporting, capture-now relay).
- Files: `src/background/lib/store.js`, `src/background/lib/transitions.js`,
  `src/background/lib/deps.js`, `src/background/service-worker.js`,
  `src/background/lib/export.js` (stub until P10).
- Left out: `fp:tabs` entries are never pruned when a tab closes; harmless
  and bounded by tab churn.
- `npm run check`: pass

## 2026-09-16 — P9 Side panel
- Built: `panel.html` / `panel.css` / `panel.js` per docs/04 — header with
  pulsing dot (grey when paused or not consented), origin bar following the
  active tab with "Record this site" + explanation when not consented, origin
  + Stop + other-origin count when consented, A3 blocked-frame offers with
  per-origin Record buttons; four counters; Pause/Resume, Capture now,
  Screenshots, collapsed Advanced block with the danger-word list and the
  india pack toggle; A2 throttle line and A5 degradation line; live feed with
  error / new-controls / list / duplicate chips and inline expansion
  (headings, steps, first ten control labels, list patterns); export block
  with progress + Q15 warning; two-step Clear that also wipes consent; footer.
  Polls stats every 1500ms, refetches rows only when the count changes.
- Files: `src/sidepanel/panel.html`, `src/sidepanel/panel.css`,
  `src/sidepanel/panel.js`.
- Left out: no screenshot thumbnails (panel never loads `fp:shots:*`).
- `npm run check`: pass

## 2026-09-16 — P10 Export pipeline and finish
- Built: `har.js` (HAR 1.2, tab/frame/state in comments), `flowmap.js`
  (pages with `reachedBy`, A7 collision-aware control merge on key + label +
  type with `collidesWith`, Q2 id-variance demotion, `altKeys`, A6 click-
  opened-controls widget signal, dependsOn/affects, deduped list patterns,
  `selectors.json` builder), `skeleton.js` (`playwright-skeleton.ts` with a
  local structural `Page` type, `SELECTORS`/`FALLBACKS`/`SHADOW_PATHS`
  constants, one function per state with every fill/click line commented,
  DANGER and TODO-transition comments, commented `flow()`), `narrative.js`
  (flow prose with A8 pause gaps and chain starts; the attention list incl.
  fragile/weak/non-unique/duplicate-id/seen-once/collisions/varying ids/
  widgets/unknown entry/opaque regions/credentials/danger buttons/blind
  spots/throttled states), `summary.js`, `brief.js` (docs/08 §1–§10 with the
  constraints block verbatim and the shadow-DOM explanation), `naming.js`,
  `offscreen/offscreen.{html,js}` (blob URLs, gunzip for DOM files),
  `export.js` (per-origin bundles, single or multi-origin layout, offscreen
  lifecycle, sequential downloads waited to completion, Q15 prompt warning,
  per-file failure counting, empty-but-valid manifest for an empty session).
  `README.md` rewritten for the consent flow and the agent handoff.
  docs/07 gained the addendum checks as docs/10 instructs.
- Files: `src/background/lib/{har,flowmap,skeleton,narrative,summary,brief,
  naming,export}.js`, `src/offscreen/offscreen.html`,
  `src/offscreen/offscreen.js`, `README.md`, `docs/07-acceptance.md`.
- Verification: docs/02, 03 and 08 re-read; every named field is produced
  (Q15 lists the additive extras and the one naming choice). Static grep over
  `src/` for `.click()`, `.submit()`, form-value assignment, `sendBeacon`,
  `WebSocket`, `importScripts` and `http(s)://` finds only the panel writing
  its own text box and header-object scrubbing — nothing that acts on a page
  or leaves the machine. No domain literal anywhere in `src/`.
- Left out: no ZIP (docs/03 asks for a folder); no retry on a failed
  download beyond counting it.
- `npm run check`: pass

---

## Build summary (2026-09-16, Flowprint)

**Flowprint v1.0.0** — Chrome MV3, unpacked, zero runtime dependencies,
`typescript` + `@types/chrome` as the only devDependencies. Consent-gated,
site-agnostic, observes only, no egress.

```
manifest.json                        MV3; <all_urls> + gate; offscreen; sidePanel; module SW
src/shared/constants.js              fp: keys, caps, timings, messages, defaults
src/shared/schema.js                 JSDoc typedefs for every record
src/types/globals.d.ts               type-only namespace for the content world
src/main-world/hooks.js              fetch/XHR/history wrappers + framework detect
src/content/packs/{generic,india}.js redaction packs
src/content/lib/redact.js            rules 2–4
src/content/lib/framework.js         DOM + MAIN-world framework detection
src/content/lib/labels.js            eight language-free label strategies
src/content/lib/selectors.js         framework-aware ranking, shadowPath, form scope
src/content/lib/fields.js            ControlRecord incl. ARIA widgets, entry/file hints
src/content/lib/lists.js             tables, repeats, pagination, downloads
src/content/lib/dom-snapshot.js      sanitise + redact + shadow inline + gzip
src/content/lib/observe.js           six triggers, A2 breaker, Q17 listboxes
src/content/capture.js               consent gate, debounce, rate cap, dedupe, dispatch
src/background/service-worker.js     router, consent, screenshot queue, pause
src/background/lib/store.js          locked writes, caps, A4/A5
src/background/lib/origins.js        allow-list
src/background/lib/transitions.js    edges + A8 gaps
src/background/lib/deps.js           dependent controls
src/background/lib/flowmap.js        flow-map.json + selectors.json
src/background/lib/skeleton.js       playwright-skeleton.ts
src/background/lib/narrative.js      flow prose + attention list
src/background/lib/summary.js        SUMMARY.md
src/background/lib/brief.js          AUTOMATION-BRIEF.md
src/background/lib/har.js            network.har
src/background/lib/export.js         offscreen blob downloads
src/offscreen/offscreen.{html,js}    blob URL helper
src/sidepanel/panel.{html,css,js}    consent bar, counters, feed, export
```

Not built, by instruction: tests, any run of the extension. Next: the human
works through `docs/07-acceptance.md` and answers `QUESTIONS.md` (Q1–Q15).
