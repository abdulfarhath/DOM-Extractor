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

## 2026-09-16 — Revision 1 (answers to Q1–Q15)
- Built:
  - Q2 credential regex replaced with the validated pair (`redact.js`,
    docs/05). Verified: `pinCode`/`Pin code`/`pin_code`/`Pincode` pass,
    `PIN`/`userPin`/`txnPin`/`mpin`/`cvv`/`passcode` redact, `spinner`/
    `shipping`/`address1` untouched.
  - Q3 React/Vue id demotion narrowed to `looksRandomAlnum` (8+ chars, mixed
    letters/digits, digits not only trailing) — `selectors.js`.
  - Q5 `orderApproximate` on StateDraft when shadow roots present; brief §2
    and summary inventory say so — `schema.js`, `capture.js`, `brief.js`,
    `summary.js`.
  - Q7 auth hints rebuilt on language-independent signals with a
    `confidence` field; English text last at `low` — `capture.js`,
    `schema.js`, `brief.js`, `summary.js`.
  - Q10 storage estimate dropped; `setOrDegrade` retries any failed write
    once after stepping the ladder, used by net/transitions/deps as well as
    states — `store.js`, `constants.js`.
  - Q14 docs/06 permission list gains `offscreen`; Q15 docs/02 says
    `triggerAt`.
  - Q6 verified present (numeric sibling run in `collectPagination`).
  - Q1, Q4, Q8, Q9, Q11, Q12, Q13 confirmed, no change.
- Files: `src/content/lib/redact.js`, `src/content/lib/selectors.js`,
  `src/content/capture.js`, `src/shared/schema.js`, `src/shared/constants.js`,
  `src/background/lib/store.js`, `src/background/lib/brief.js`,
  `src/background/lib/summary.js`, `docs/02-capture-spec.md`,
  `docs/05-privacy.md`, `docs/06-phases.md`, `QUESTIONS.md` (answers filled).
- Left out: nothing.
- `npm run check`: pass

## 2026-09-16 — Revision 2 (single zip export)
- Built: `background/lib/zip.js` — dependency-free ZIP writer: generated
  CRC-32 table, local headers + central directory + EOCD, UTF-8 names (flag
  bit 11), method 8 via `CompressionStream('deflate-raw')` for text-like
  entries, method 0 for `.png`/`.gz`/`.zip`/`.jpg`/`.webp` and entries under
  64 bytes, duplicate paths suffixed `(2)`; incremental `createZip` /
  `addEntry` / `finishZip` plus one-shot `buildZip(entries)`. Verified in a
  scratch run: Python `zipfile.testzip()` and `unzip -t` both clean.
  `offscreen/offscreen.js` is now an ES module importing `zip.js`: it takes
  entries one message at a time (`OFFSCREEN_ZIP_ADD`, gunzipping stored DOM
  snapshots on the way in), finishes the archive (`OFFSCREEN_ZIP_FINISH`)
  into a blob: URL, and revokes on request. `export.js` builds every
  artifact exactly as before but streams each into the archive under the
  unchanged internal layout (timestamped root folder, Q11 `<host>/` packages
  when multi-origin), then issues one `chrome.downloads.download` for
  `flowprint-<host>-<stamp>.zip` / `flowprint-<stamp>.zip`, waits for it to
  settle (up to 5 min), revokes the URL and closes the offscreen document.
  `ExportProgress` gained `phase` (`packing` | `downloading` | `idle`);
  `current`/`total` count entries. The Q15 warning now fires when the single
  download sits longer than 5s ("if Chrome opened a Save dialog, pick a
  location"). Panel shows "Packing n of m files" → "Downloading …zip" →
  "Saved Downloads/….zip". README drops the "Ask where to save" step; docs/03
  export layout, docs/04 export block and the docs/07 export check updated.
  `TIMING.EXPORT_FILE_GAP_MS` and `OFFSCREEN_MAKE_BLOB` removed.
- Files: `src/background/lib/zip.js` (new), `src/background/lib/export.js`,
  `src/offscreen/offscreen.html`, `src/offscreen/offscreen.js`,
  `src/shared/constants.js`, `src/shared/schema.js`, `src/sidepanel/panel.js`,
  `README.md`, `docs/03-output-schema.md`, `docs/04-ui-spec.md`,
  `docs/07-acceptance.md`.
- Left out: DOM snapshots are still written inflated as `dom/*.html` and
  deflated into the archive (the `.html.gz` store rule in `zip.js` is there
  for a future switch); no zip64.
- `npm run check`: pass

## 2026-09-16 — Revision 3 (docs/11 redaction fixes)
- Built:
  - F1 credential pattern replaced: `(?<![a-z])pin(?![a-z]|[\s_-]*code)` with
    the docs/11 alternations, plus the case-sensitive camel-case rule that the
    doc's own table still needs (Q16). The 27-row case table is a comment
    above the constant in `redact.js` and every row was checked in a scratch
    run. `LLPIN`, `CIN`-style labels, `pinned`, `spinner` and every PIN-code
    spelling pass; `PIN`, `userPin`, `user_pin`, `mpin`, `otp`, `cvv`,
    `Password` redact.
  - F2 credential controls now emit the full ControlRecord — id, name,
    binding, data attrs, label, constraints, `visible`, `boundingBox`,
    `classes`, `selectors`, `entry`, `group` — with `redactedEntirely: true`
    and **no `value` key**; credential selects also drop `options` /
    `optionCount`. `RedactedControlRecord` removed; `ControlRecord.value` is
    optional and `redactedEntirely` is a boolean on every control.
  - F3 follows: `visible` and `boundingBox` are computed for them like any
    other control.
  - Downstream: flow-map includes redacted controls with
    `redactedEntirely: true` and a note (never downgraded on merge);
    `selectors.json` carries their selectors; skeleton emits a `// HUMAN:`
    line instead of a fill; brief constraints block gains the human-only
    sentence (docs/08 updated to keep it verbatim), §1 counts human-only
    controls, §4 marks them **HUMAN**; summary header reports the redacted
    count and the attention list section is now "Redacted controls —
    human-only" with selectors.
  - Docs: docs/05 rule 3 rewritten (regex + keep/drop lists), docs/09 Q2/Q3
    annotated as superseded, docs/03 ControlRecord note, docs/07 redaction
    checks appended.
- Files: `src/content/lib/redact.js`, `src/content/lib/fields.js`,
  `src/shared/schema.js`, `src/background/lib/{flowmap,transitions,narrative,
  skeleton,brief,summary}.js`, `docs/03-output-schema.md`,
  `docs/05-privacy.md`, `docs/07-acceptance.md`, `docs/08-consuming-output.md`,
  `docs/09-resolved.md`, `QUESTIONS.md` (+Q16).
- Left out: nothing.
- `npm run check`: pass

## 2026-09-29 — docs/12: navigation, actions, API shapes, downloads, coverage, routes (1.1.0)

- Built: route identity for fragment-routed apps (B1); view identity for tabs,
  filters and pagination (B2); navigation inventory with collapsed and overlay
  menus (B3, new `src/content/lib/nav.js`); an action log with replayable
  selectors, menu paths and new-tab links (B4); JSON request/response shapes
  and opt-in full bodies (B5); download logging without file names or
  contents (B6); storage keys and messages (B7); seven new export files —
  site-map, routes, api-catalog, actions, downloads, coverage, RECIPES.md — and
  live navigation/table helpers in the skeleton (B8); the side panel's
  Coverage block, Actions/Downloads counters and "Keep full API responses"
  switch (B9).
- Also: DOM snapshots now pattern-scrub page text and attribute text, not
  only control values; open shadow roots at the top level are serialised;
  danger words match whole words only ("Pay" yes, "Payments" no).
- Files: `src/content/{capture.js,lib/nav.js,lib/observe.js,lib/lists.js,
  lib/labels.js,lib/dom-snapshot.js}`, `src/main-world/hooks.js`,
  `src/background/{service-worker.js,lib/store.js,lib/transitions.js,
  lib/har.js,lib/export.js,lib/sitemap.js,lib/routes.js,lib/apicatalog.js,
  lib/coverage.js,lib/recipes.js,lib/brief.js,lib/summary.js,lib/skeleton.js,
  lib/narrative.js,lib/naming.js,lib/flowmap.js}`, `src/sidepanel/*`,
  `src/shared/{schema,constants}.js`, `src/types/globals.d.ts`, docs 02, 03,
  04, 05, 08, 12, `docs/ITR-RECORDING-CHECKLIST.md`, README.
- Verification: `tools/e2e/` loads the unpacked extension in headless
  Chromium, records a fixture portal with trusted input, exports, and checks
  the zip, including replaying every route in a clean browser. 39 of 39
  checks pass. This supersedes CLAUDE.md's "do not write tests" for this
  phase; the harness lives outside `src/` and ships nothing.
- Left out: live testing against a real portal; the fixture is generic.
- `npm run check`: pass
