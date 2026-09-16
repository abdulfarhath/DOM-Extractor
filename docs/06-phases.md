# 06 — Build phases

Build all of these in one run. After each: `npm run check` passes, append to
`TASKS.md`, append judgement calls to `QUESTIONS.md`. Each phase leaves the folder
loadable, so a failure at P8 still leaves P0–P7 usable.

## P0 — Scaffold
- `package.json` with `"check": "tsc --noEmit"`; devDependencies `typescript`,
  `@types/chrome`
- `jsconfig.json`: `checkJs`, `allowJs`, `strict`, `target: ES2022`,
  `lib: ["ES2022","DOM"]`, `types: ["chrome"]`
- `manifest.json`: MV3, name "Flowprint", permissions `storage`,
  `unlimitedStorage`, `downloads`, `sidePanel`, `tabs`; `host_permissions`
  `<all_urls>`; MAIN-world and isolated content scripts on `<all_urls>`; module
  service worker; side panel registered
- Delete prototype flat files once their logic has moved

## P1 — Shared foundations
- `shared/constants.js` — storage keys, caps, message types, debounce/throttle
  values, default danger words, default redaction packs
- `shared/schema.js` — JSDoc typedefs for every record in `docs/03`
- `content/lib/redact.js` — all of `docs/05`: value redaction, credential
  skipping, pack-based body scrubbing

## P2 — Consent gate
- `background/lib/origins.js` — allow-list CRUD
- Content-script early exit; tab reload on consent
- Panel origin bar wired enough to add and remove an origin

## P3 — Detection and identification
- `content/lib/framework.js`
- `content/lib/labels.js` — the eight strategies, language-agnostic
- `content/lib/selectors.js` — framework-aware ranking, generated-id rejection,
  uniqueness check

## P4 — Control inventory
- `content/lib/fields.js` — full ControlRecord including ARIA widgets

## P5 — Lists and structure
- `content/lib/lists.js` — tables, repeated items and slots, pagination, downloads

## P6 — Snapshot and network
- `content/lib/dom-snapshot.js` — sanitise, redact, gzip
- `main-world/hooks.js` — fetch/XHR wrap plus `history` patch, postMessage out

## P7 — Orchestration
- `content/lib/observe.js` — all six triggers, debounce, attribution rule
- `content/capture.js` — consent check, signature, dedupe, assembly, dispatch;
  shared `window.__FP` namespace

## P8 — Background store and analysis
- `background/lib/store.js` — serialised writes, caps, separate snapshot keys
- `background/lib/transitions.js` — edges keyed by `tabId:frameId`
- `background/lib/deps.js` — dependent-control detection including ARIA listboxes
- `background/service-worker.js` — router, screenshot throttle, pause enforcement

## P9 — Side panel
- `sidepanel/panel.html`, `panel.css`, `panel.js` per `docs/04`

## P10 — Export pipeline
- `har.js`, `flowmap.js`, `selectors.json` writer, `skeleton.js`, `summary.js`,
  `brief.js`, `export.js` with sequential downloads and progress messages
- `README.md` written for someone who has never loaded an unpacked extension
- Final `npm run check` clean; re-read `docs/02`, `03`, `08` and verify every named
  field is actually produced; note gaps in `QUESTIONS.md`
- Summarise the build at the end of `TASKS.md`
