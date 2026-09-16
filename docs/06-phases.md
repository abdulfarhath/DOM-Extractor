# 06 — Build phases

Build all of these in one run. After each phase: `npm run check` must pass,
append to `TASKS.md`, append any judgement calls to `QUESTIONS.md`.

Each phase is sized to leave the folder in a loadable state, so a failure in
phase 7 still leaves phases 1–6 usable.

---

## P0 — Scaffold

- `package.json` with `"scripts": { "check": "tsc --noEmit" }` and `typescript`
  as the only devDependency
- `jsconfig.json`: `checkJs: true`, `allowJs: true`, `strict: true`,
  `target: ES2022`, `lib: ["ES2022", "DOM"]`, `types: ["chrome"]`
- Add `@types/chrome` as a devDependency — needed for `tsc` to know `chrome.*`
- `manifest.json` per `docs/01`: MV3, name "MCA DOM Capturer", permissions
  `storage`, `unlimitedStorage`, `downloads`, `sidePanel`, `tabs`; host
  permissions for `mca.gov.in`; MAIN-world and isolated content scripts; service
  worker as module; side panel registered
- Delete the prototype's flat files once their logic has been moved

## P1 — Shared foundations

- `shared/constants.js` — storage keys, caps, message type strings, debounce and
  throttle values, danger-button regex
- `shared/schema.js` — JSDoc typedefs for StateRecord, FieldRecord, NetEntry,
  Transition, Dependency, ExportManifest
- `content/lib/redact.js` — all of `docs/05`: value redaction, credential
  skipping, body scrubbing

## P2 — Field extraction

- `content/lib/labels.js` — the eight-strategy resolver, returning
  `{ label, labelSource }`
- `content/lib/selectors.js` — candidate generation, auto-generated-id detection,
  uniqueness check, stability ranking
- `content/lib/fields.js` — full FieldRecord assembly per `docs/02`

## P3 — DOM snapshot

- `content/lib/dom-snapshot.js` — sanitise, strip, truncate, redact, gzip via
  `CompressionStream`, return base64

## P4 — Network capture

- `main-world/net-hook.js` — wrap `fetch` and XHR, emit NetEntry shapes,
  postMessage to the isolated world
- Preserve original behaviour exactly: never swallow errors, always return the
  original response, rethrow what the page would have seen

## P5 — Orchestration

- `content/lib/observe.js` — all six triggers from `docs/02`, debounced
- `content/capture.js` — signature computation, dedupe against the previous
  state, assembly, pause-flag check, `chrome.runtime.sendMessage` dispatch
- Namespaced global `window.__MCADC` so the non-module content scripts can share

## P6 — Background store and analysis

- `background/lib/store.js` — serialised write queue, caps, per-state DOM and
  screenshot keys
- `background/lib/transitions.js` — edges between consecutive states per tab
- `background/lib/deps.js` — dependent-dropdown detection
- `background/service-worker.js` — message router, screenshot throttle queue,
  pause flag ownership

## P7 — Side panel

- `sidepanel/panel.html`, `panel.css`, `panel.js` per `docs/04`
- Counters, controls, live state list, expandable rows, export block

## P8 — Export pipeline

- `background/lib/har.js` — HAR 1.2 assembly
- `background/lib/fieldmap.js` — cross-state unique field roll-up with
  dependencies and transitions
- `background/lib/summary.js` — `SUMMARY.md` generation including the attention
  list
- `background/lib/export.js` — sequential `chrome.downloads` writes with progress
  messages back to the panel

## P9 — Finish

- `README.md` — load, record, export, review, delete. Written for someone who has
  never loaded an unpacked extension
- Final `npm run check` clean
- Re-read `docs/02` and `docs/03` and verify every field named there is actually
  produced; note any gaps in `QUESTIONS.md`
- Summarise the whole build at the end of `TASKS.md`
