# 01 — Architecture

## Three execution contexts

| Context | Runs in | Can do | Cannot do |
|---|---|---|---|
| MAIN world | The page's own JS realm | Wrap `fetch`/XHR, patch `history` | Use `chrome.*` |
| Content script | Isolated world | Read the DOM, `chrome.runtime` | See page globals |
| Service worker | Extension | `chrome.storage`, `chrome.downloads`, `chrome.tabs` | Touch the DOM |

MAIN world talks to the content script via `window.postMessage` with a namespaced
envelope. The content script talks to the worker via `chrome.runtime.sendMessage`.
This separation is why the network and navigation hooks work at all — keep it.

## File layout

```
manifest.json  jsconfig.json  package.json
CLAUDE.md  TASKS.md  QUESTIONS.md  README.md
docs/
src/
  shared/
    constants.js      # storage keys, caps, message types, defaults
    schema.js         # JSDoc typedefs for every stored record
  main-world/
    hooks.js          # fetch + XHR wrap, history patch, postMessage out
  content/
    capture.js        # orchestrator: consent check, triggers, assembly
    lib/
      framework.js    # detect Angular / React / Vue / Svelte / plain
      redact.js       # value redaction, credential skipping, body scrubbing
      labels.js       # language-agnostic label resolution
      selectors.js    # framework-aware candidates + stability ranking
      fields.js       # form-control inventory
      lists.js        # tables, repeated items, pagination, downloads
      dom-snapshot.js # sanitised outerHTML + gzip
      observe.js      # triggers and debounce
  background/
    service-worker.js # router, write queue, screenshot throttle, consent state
    lib/
      store.js        # storage access, dedupe, caps
      origins.js      # consent allow-list
      transitions.js  # state-graph edges
      deps.js         # dependent-control detection
      har.js          # HAR 1.2 assembly
      flowmap.js      # cross-state roll-up
      brief.js        # AUTOMATION-BRIEF.md generation
      skeleton.js     # playwright-skeleton.ts generation
      summary.js      # SUMMARY.md generation
      export.js       # chrome.downloads multi-file write
  sidepanel/
    panel.html  panel.css  panel.js
```

## Data flow

```
page activity
   ├─ fetch / XHR / pushState ─► main-world/hooks.js ──postMessage──┐
   └─ DOM change / click / change / popstate ─► observe.js ─────────┤
                                                                    ▼
                                              capture.js → StateRecord
                                                                    │
                                                    chrome.runtime.sendMessage
                                                                    ▼
                                              service-worker.js → store.js
                                    ┌───────────────┬───────────────┬──────────┐
                              transitions.js     deps.js         har.js    side panel
                                                                    │
                                          export.js → flowmap → brief → skeleton → disk
```

## Consent model

`origins.js` owns an allow-list in `chrome.storage.local`. Content scripts are
declared for `<all_urls>` but **exit immediately** unless the current origin is on
the list. The side panel shows "Record this site" for the active tab's origin;
clicking it adds the origin and reloads the tab so the hooks install from
`document_start`. Removing an origin stops capture immediately.

Nothing is captured before that click. This is what makes `<all_urls>` acceptable.

## Storage model

All under `chrome.storage.local`:

- `fp:origins` — consented origins
- `fp:states` — StateRecord array, metadata plus fields and list patterns, cap 500
- `fp:dom:<stateId>` — gzipped base64 snapshot, stored separately
- `fp:shots:<stateId>` — base64 PNG, stored separately
- `fp:net` — NetEntry array, cap 2500
- `fp:transitions`, `fp:deps`, `fp:tabs`, `fp:meta`

Never load all snapshots at once. The panel reads only `fp:states` and `fp:meta`.
Export streams snapshot keys one at a time.

## Concurrency

Pages contain iframes, so several content-script instances post at once. The
worker serialises every write through a single promise chain. Content scripts
never write to storage directly.

## Key decisions and trade-offs

- **No bundler.** Some duplication between content-script modules; buys a folder
  that loads unpacked with zero build.
- **JSDoc plus `tsc --noEmit`.** A real type gate for the unattended build with no
  compile step before the extension can load.
- **Gzip snapshots via `CompressionStream`.** Modern app pages are large; raw
  storage hits quota within an hour.
- **HAR is reconstructed, not intercepted.** Wrapping `fetch`/XHR yields URLs,
  methods, statuses, bodies and response headers, but not wire timings or
  browser-added request headers. The file is valid HAR 1.2 with unknown timing
  phases set to `-1`. Say so in the export manifest; never invent values.
- **Framework detection drives selector ranking** rather than a fixed order, so
  the same tool produces good selectors on an Angular portal and a React app.
