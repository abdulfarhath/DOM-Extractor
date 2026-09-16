# 01 — Architecture

## Three execution contexts

| Context | Runs in | Can do | Cannot do |
|---|---|---|---|
| MAIN world script | The page's own JS realm | Wrap `fetch` / `XMLHttpRequest` | Use `chrome.*` APIs |
| Content script | Isolated world | Read the DOM, use `chrome.runtime` | See the page's own globals |
| Service worker | Extension | `chrome.storage`, `chrome.downloads`, `chrome.tabs` | Touch the DOM |

The MAIN-world script talks to the content script via `window.postMessage`. The
content script talks to the service worker via `chrome.runtime.sendMessage`. Keep
this separation strict — it is the only reason the network hook works at all.

## File layout

```
manifest.json
jsconfig.json
package.json
CLAUDE.md  TASKS.md  QUESTIONS.md  README.md
docs/
src/
  shared/
    constants.js        # storage keys, limits, message types
    schema.js           # JSDoc typedefs for every stored record
  main-world/
    net-hook.js         # wraps fetch + XHR, posts HAR-ish entries
    nav-hook.js         # wraps history.pushState/replaceState, posts nav events (Q7)
  content/
    capture.js          # orchestrator: triggers, debounce, assembly
    lib/
      redact.js         # value redaction + PII scrubbing
      fields.js         # form-control inventory
      labels.js         # label resolution strategies
      selectors.js      # selector candidates + stability ranking
      dom-snapshot.js   # sanitised outerHTML + gzip
      observe.js        # mutation / click / change / history triggers
  background/
    service-worker.js   # message router, write queue
    lib/
      store.js          # chrome.storage.local access, dedupe
      transitions.js    # state-graph edges between captures
      deps.js           # dependent-dropdown detection
      har.js            # HAR 1.2 assembly
      fieldmap.js       # draft field map across all states
      summary.js        # SUMMARY.md generation
      export.js         # chrome.downloads multi-file write
  sidepanel/
    panel.html
    panel.css
    panel.js
```

Content scripts cannot use ES imports, so `src/content/lib/*.js` are listed as
separate entries in the manifest's `content_scripts.js` array and communicate
through a single namespaced global, `window.__MCADC`. The service worker is
`"type": "module"` and uses real imports.

## Data flow

```
page activity
   │
   ├─ fetch/XHR ──► net-hook.js ──postMessage──► capture.js ──┐
   │                                                          │
   └─ DOM change / click / change / navigation ──► observe.js ─┤
                                                               ▼
                                              capture.js builds a StateRecord
                                                               │
                                                  chrome.runtime.sendMessage
                                                               ▼
                                              service-worker.js → store.js
                                                               │
                                          ┌────────────────────┼────────────────┐
                                     transitions.js        deps.js         har.js
                                                               │
                                                        side panel (live)
                                                               │
                                                          export.js → disk
```

## Storage model

All in `chrome.storage.local`, under keys from `shared/constants.js`:

- `dc:states` — array of StateRecord (metadata + fields), capped at 400
- `dc:dom:<stateId>` — gzipped base64 DOM snapshot, written separately so the
  states array stays small enough to read cheaply
- `dc:shots:<stateId>` — base64 PNG, same reason
- `dc:net` — array of NetEntry, capped at 2000
- `dc:meta` — session info: started, recording on/off, screenshot toggle

Never load all DOM snapshots at once. The side panel reads only `dc:states` and
`dc:meta`. The export path streams each snapshot key one at a time.

## Concurrency

MCA pages can contain iframes, so several content-script instances may post at
once. The service worker serialises every write through a single promise chain
(the prototype's `enqueue` pattern). Do not write to storage from a content
script.

## Key decisions and trade-offs

- **No bundler.** Costs some duplication between content-script modules; buys a
  folder that loads unpacked with zero build, which matters for a tool whose
  whole life is one afternoon.
- **JSDoc + `tsc --noEmit` instead of TypeScript.** Gives a real type gate for
  the unattended build without introducing a compile step before the extension
  can be loaded.
- **Gzip DOM snapshots via `CompressionStream`.** Full SPICe+ pages are large;
  storing them raw will hit quota inside an hour.
- **Screenshots via `chrome.tabs.captureVisibleTab`.** Chrome rate-limits this,
  so the service worker queues and throttles to one every 600ms and drops rather
  than blocks if the queue backs up.
- **HAR is reconstructed, not intercepted.** Wrapping `fetch`/XHR gives URLs,
  methods, statuses, bodies and response headers, but not real wire timings or
  request headers the browser adds. The output is HAR 1.2 *shaped* and valid, but
  timing fields are approximations. Say so in the export manifest.
