# TASKS

Append-only build log. One entry per phase. Newest at the bottom.

Format:

## <date> — P<n> <phase name>
- Built: <what>
- Files: <paths created or changed>
- Left out: <anything deliberately deferred, and why>
- `npm run check`: pass / fail

---

## 2026-09-16 — P0 Scaffold
- Built: `package.json` (typescript + @types/chrome as the only devDependencies,
  `npm run check`), `jsconfig.json` (checkJs/strict/ES2022/DOM/chrome types),
  MV3 `manifest.json` renamed to **MCA DOM Capturer** with sidePanel, module
  service worker, MAIN-world + isolated content script entries, `.gitignore`,
  empty `src/` tree.
- Files: `package.json`, `jsconfig.json`, `manifest.json`, `.gitignore`,
  `src/types/globals.d.ts` (type-only namespace for the content world; never
  loaded by Chrome).
- Left out: prototype flat files not yet deleted — they stay as reference until
  their logic is fully moved (deleted in P9). `check` script is
  `tsc -p jsconfig.json --noEmit` rather than bare `tsc --noEmit`: tsc ignores
  `jsconfig.json` unless told, so the bare form checked nothing.
- `npm run check`: pass

## 2026-09-16 — P1 Shared foundations
- Built: `shared/constants.js` (storage keys, caps, timings, message types,
  danger regex), `shared/schema.js` (JSDoc typedefs for StateDraft/StateRecord,
  FieldRecord, RedactedFieldRecord, NetDraft/NetEntry, Transition, Dependency,
  SessionMeta, ExportManifest, FieldMapDraft, Stats, ExportProgress),
  `content/lib/redact.js` (rule 1 value redaction, rule 2 credential detection,
  rule 3 body scrub).
- Files: `src/shared/constants.js`, `src/shared/schema.js`,
  `src/content/lib/redact.js`.
- Left out: nothing.
- `npm run check`: pass

## 2026-09-16 — P2 Field extraction
- Built: `labels.js` (eight-strategy resolver returning `{label, labelSource}`,
  strips trailing `*`/`:` markers), `selectors.js` (five candidate ranks,
  auto-generated-id rejection with reason in `notes`, uniqueness via
  `querySelectorAll` / `document.evaluate`, stability ranking, structural path
  up to nearest `<form>`), `fields.js` (full FieldRecord, bare
  RedactedFieldRecord for credentials, `fieldKey` shared by signature +
  transitions + field map, `isVisible` via `checkVisibility` + rect).
- Files: `src/content/lib/labels.js`, `src/content/lib/selectors.js`,
  `src/content/lib/fields.js`, `src/types/globals.d.ts` (extended).
- Left out: `minLength`/`maxLength` read from attributes rather than the DOM
  properties, so `-1` defaults never leak in as real limits.
- `npm run check`: pass

## 2026-09-16 — P3 DOM snapshot
- Built: `dom-snapshot.js` — clones `documentElement`, redacts every control by
  pairing live and cloned controls by index (cloneNode drops live `.value`),
  hollows `script/style/noscript/svg` (tags kept), strips comments, truncates
  attributes >300 chars and `data:` URIs to 64, gzips via `CompressionStream`,
  returns base64. Hidden inputs become `value="<hidden>"`; credential controls
  become `<redacted>` with no length; selected `<option>` flags are removed.
- Files: `src/content/lib/dom-snapshot.js`.
- Left out: no size cap on the snapshot itself — gzip keeps SPICe+ pages in the
  low hundreds of KB. Left a note in Q6.
- `npm run check`: pass

## 2026-09-16 — P4 Network capture
- Built: `main-world/net-hook.js` — wraps `fetch` (returns the original
  Response untouched, reads a clone in the background, rethrows the original
  error on failure), `XMLHttpRequest.open/setRequestHeader/send` (per-instance
  meta in a WeakMap, `loadend` listener), serialises request bodies of every
  BodyInit shape without consuming them, skips non-text or >2MB responses,
  guards against double-injection. Also patches `history.pushState/replaceState`
  here and forwards them as `nav` messages — see Q7.
- Files: `src/main-world/net-hook.js`.
- Left out: Beacon / WebSocket / EventSource traffic — not in the spec, and
  unlikely to carry form data on MCA.
- `npm run check`: pass

## 2026-09-16 — P5 Orchestration
- Built: `observe.js` (MutationObserver with attribute filter, capture-phase
  click/change, popstate/hashchange, nav messages from the MAIN-world hook,
  `load`), `capture.js` (900ms debounce with first-user-trigger-wins, pause
  flag mirrored from `dc:meta` via `chrome.storage.onChanged` plus an initial
  `GET_FLAGS` ask, StateDraft assembly for headings/steps/buttons/errors/
  notices/fields, signature dedupe, serialised DOM snapshot, `STATE_CAPTURED`
  and scrubbed `NET_ENTRY` dispatch, `CAPTURE_NOW` listener).
- Files: `src/content/lib/observe.js`, `src/content/capture.js`.
- Left out: no per-frame throttling beyond the debounce; iframes each run the
  full pipeline independently.
- `npm run check`: pass

## 2026-09-16 — P6 Background store and analysis
- Built: `store.js` (single promise-chain `enqueue`, meta with counters so the
  panel never loads `dc:states`, `addState` assigns `st_NNNN`, writes
  `dc:dom:<id>` separately, enforces the 400 cap and removes capped states'
  side keys, `addNet` with `net_NNNN` and the 2000 cap, transitions/deps lists,
  `putScreenshot`, `clearAll` via `getKeys()` when available),
  `transitions.js` (`buildTransition` with fieldsAdded/Removed,
  optionsChanged, errorsAppeared, netCallsBetween via `stateIdAtTime`),
  `deps.js` (`detectDependency` within the 2500ms window, duplicate check),
  `service-worker.js` (router for all ten message types, per `tab:frame`
  last-state tracking in `dc:tabs`, screenshot queue throttled to 600ms / max
  3 / drop, pause flag ownership, `CAPTURE_NOW` relay to the active MCA tab,
  side panel opens on action click).
- Files: `src/background/lib/store.js`, `src/background/lib/transitions.js`,
  `src/background/lib/deps.js`, `src/background/service-worker.js`,
  `src/background/lib/export.js` (stub until P8), `src/shared/schema.js`
  (+PanelRow).
- Left out: `netRefs` on a state lists only the calls attributed to the
  previous state (i.e. the calls that led here); calls made *after* a state
  are on the next state's edge. Screenshots are dropped when the SW is asleep
  during the throttle wait — acceptable per docs/01.
- `npm run check`: pass

## 2026-09-16 — P7 Side panel
- Built: `panel.html` (header with pulsing dot, counters, controls, empty
  state, live feed, pinned export block with inline two-step clear, footer),
  `panel.css` (docs/04 tokens inlined, dark mode in the same slate family,
  14px body / 12px mono metadata, white-on-blue primary), `panel.js` (ES module
  importing shared constants; polls `GET_STATS` every 1500ms, refetches
  `GET_STATES` only when the state count changes, expandable rows showing
  headings / steps / first ten field labels, error and new-fields chips,
  export progress line, clear confirm step, capture-now feedback).
- Files: `src/sidepanel/panel.html`, `src/sidepanel/panel.css`,
  `src/sidepanel/panel.js`.
- Left out: no per-row screenshot thumbnail (panel never loads `dc:shots:*`).
- `npm run check`: pass

## 2026-09-16 — P8 Export pipeline
- Built: `har.js` (HAR 1.2 `log` with creator, one page per distinct
  `pageUrl`, entries with queryString/postData/content, unknown timing phases
  `-1`, `wait` = `durationMs`), `fieldmap.js` (unique fields keyed
  formControlName → authored id → name → label, merges the strongest label /
  longest options / best selector across states, dependsOn/affects from
  dependencies, `vcfoField: null`), `selector-hints.js` (background copy of the
  auto-generated-id regexes), `naming.js` (file stems, folder name),
  `summary.js` (session header, inventory table with file stems, flow
  narrative, dependency table, attention list: fragile selectors, weak label
  sources, non-unique selectors, duplicate ids incl. buttons, credential
  controls, danger buttons; sharing reminders), `export.js` (sequential
  `chrome.downloads.download` data-URL writes with a 150ms gap, per-file
  failure counting, gunzip via `DecompressionStream`, progress in memory).
- Files: `src/background/lib/har.js`, `src/background/lib/fieldmap.js`,
  `src/background/lib/selector-hints.js`, `src/background/lib/naming.js`,
  `src/background/lib/summary.js`, `src/background/lib/export.js`.
- Left out: no ZIP — docs/03 asks for a folder of files. No retry on a failed
  download; the panel reports the count of failures.
- `npm run check`: pass

## 2026-09-16 — P9 Finish
- Built: `README.md` rewritten for someone who has never loaded an unpacked
  extension (load, disable per-file save prompts, record, export, review,
  delete). Deleted the prototype's `content.js`, `net-hook.js`,
  `background.js`, `popup.html`, `popup.js`; its label resolution, field
  description, MAIN/isolated split and `enqueue` pattern live on in `src/`.
- Files: `README.md`; removed the five flat files above.
- Verification against docs/02 and docs/03: every page-level, field-level,
  selector, snapshot, screenshot, network, transition and dependency field
  named there is produced. Extras beyond the spec: `triggerTimestamp` is on
  StateRecord (docs/02 asks for it, docs/03's example omits it), `tabId` /
  `frameId` on StateRecord and NetEntry, `error` and `seq` on NetEntry,
  `stateId` on Dependency, `unique` on SelectorSet (docs/03 has it, docs/02
  does not name it). Gaps and deviations are all in QUESTIONS.md (Q1–Q18).
- Static safety check: `grep` over `src/` for `.click(`, `.submit(`,
  `.value =`, `fetch(`, `XMLHttpRequest(`, `sendBeacon`, `WebSocket`,
  `importScripts` and `http(s)://` finds only the wrapped page `fetch`
  pass-through and the allowed-origins constant.
- `npm run check`: pass

---

## Build summary (2026-09-16)

**MCA DOM Capturer v1.0.0** — Chrome MV3, unpacked, zero runtime dependencies,
`typescript` + `@types/chrome` as the only devDependencies.

```
manifest.json                       MV3; sidePanel; module SW; MAIN + isolated content scripts
src/shared/constants.js             keys, caps, timings, message types
src/shared/schema.js                JSDoc typedefs for every record
src/types/globals.d.ts              type-only namespace for the content world
src/main-world/net-hook.js          fetch/XHR/history wrappers → postMessage
src/content/lib/redact.js           docs/05 rules 1–3
src/content/lib/labels.js           eight-strategy label resolver
src/content/lib/selectors.js        candidates, autogen-id rejection, uniqueness, stability
src/content/lib/fields.js           FieldRecord / RedactedFieldRecord
src/content/lib/dom-snapshot.js     sanitise + redact + gzip + base64
src/content/lib/observe.js          six triggers
src/content/capture.js              debounce, signature dedupe, dispatch
src/background/service-worker.js    router, screenshot throttle, pause flag
src/background/lib/store.js         serialised chrome.storage.local access
src/background/lib/transitions.js   state-graph edges
src/background/lib/deps.js          dependent-dropdown detection
src/background/lib/har.js           HAR 1.2
src/background/lib/fieldmap.js      field-map-draft.json
src/background/lib/summary.js       SUMMARY.md
src/background/lib/naming.js        file stems / folder name
src/background/lib/selector-hints.js background copy of the autogen-id regexes
src/background/lib/export.js        sequential chrome.downloads writes
src/sidepanel/panel.{html,css,js}   live panel per docs/04
```

Not built, by instruction: tests, any run of the extension. Next step is the
human working through `docs/07-acceptance.md` and answering `QUESTIONS.md`.

## 2026-09-16 — Revision 1 (answers to Q1–Q17)
- Built:
  - Q1 iframe states are screenshotted; `screenshotOf: 'page'|'parent-frame'`
    on StateRecord (`store.putScreenshot`, `service-worker.js`).
  - Q2 `fieldmap.js` `findVaryingIds` — same path + formControlName/name/label
    with different ids across captures demotes the id from key and primary
    selector, with a note; new SUMMARY.md section "Ids that changed between
    captures".
  - Q3 credential regex no longer matches postal PIN code:
    `/captcha|otp|passw|secret|token|mpin|(?:^|[^a-z])pin(?![\s_-]*code)/i` +
    case-sensitive `/[a-z]Pin(?![\s_-]*[Cc]ode)/` (`redact.js`, docs/05).
  - Q4 `scroll: {x, y}` on StateDraft (`capture.js`).
  - Q5 `selectors.uniqueInForm` (`selectors.js`); summary notes "unique within
    its form" on non-unique entries.
  - Q7 `main-world/nav-hook.js` — history patch moved out of `net-hook.js`;
    manifest and docs/01 updated.
  - Q8 fetch body read races a 5s timeout; exactly one message per call.
  - Q10 `duplicateOf` on StateRecord for identical manual captures; `TabInfo`
    gains `lastErrorsKey`; panel shows a muted "duplicate" chip.
  - Q11 `triggers: string[]` — full burst, consecutive repeats collapsed
    (`dom-change (x12)`), cap 60.
  - Q12 `stateIdInferred` on NetEntry when an iframe call falls back to the
    top frame's state; shown in the HAR comment.
  - Q14 `dom/*.html.gz` written as stored (`application/gzip`); gunzip code
    removed; manifest warnings, README, SUMMARY.md, docs/03 updated.
  - Q15 export detects a >5s download and sets `exportProgress.warning`
    (per-file save prompt); panel shows it; never aborts.
  - Q16 `altKeys` on FieldMapEntry.
  - Q17 clicks on `[role=option]` / `.mat-option` / `.mat-mdc-option` /
    `.ng-option` / `.dropdown-item` / `.select2-results__option` become
    `change:<owner key>` (owner via aria-owns/aria-controls → field wrapper →
    listbox id) and suppress the `click:` trigger for that click (`observe.js`).
  - Q6, Q9, Q13 confirmed, no change. Q18 still unanswered.
- Files: `src/content/lib/redact.js`, `src/content/lib/selectors.js`,
  `src/content/lib/observe.js`, `src/content/capture.js`,
  `src/main-world/net-hook.js`, `src/main-world/nav-hook.js` (new),
  `src/shared/schema.js`, `src/types/globals.d.ts`, `manifest.json`,
  `src/background/lib/store.js`, `src/background/service-worker.js`,
  `src/background/lib/fieldmap.js`, `src/background/lib/export.js`,
  `src/background/lib/summary.js`, `src/background/lib/har.js`,
  `src/sidepanel/panel.js`, `src/sidepanel/panel.css`, `README.md`,
  `docs/01-architecture.md`, `docs/02-capture-spec.md`,
  `docs/03-output-schema.md`, `docs/05-privacy.md`, `QUESTIONS.md` (answers
  filled in, nothing removed).
- Left out: Q2 variance is only detectable when the same logical field is
  captured at least twice on the same path; a single visit cannot flag it.
- `npm run check`: pass
