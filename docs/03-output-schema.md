# 03 — Output schema

## Export layout

One zip written via a single `chrome.downloads.download`, `saveAs: false`. The
archive is built in the offscreen document (`src/background/lib/zip.js`:
deflate for text-like files, store for PNGs) and unpacks to one timestamped
folder. Grouped by origin when a session spans more than one: the zip is then
`flowprint-<stamp>.zip` and holds one `<host>/` package per origin plus a root
`manifest.json` listing them.

```
flowprint-<host>-2026-09-16T1430.zip
└─ flowprint-<host>-2026-09-16T1430/
  manifest.json
  AUTOMATION-BRIEF.md
  RECIPES.md            page-by-page guide for a reader (docs/12 B8)
  SUMMARY.md
  site-map.json         menu tree and pages, with visited flags
  routes.json           how to reach every page and view, step by step
  api-catalog.json      one entry per endpoint: template, shapes, callers
  actions.json          the full action log
  downloads.json        the download log
  coverage.json         what was visited, what was not, what is incomplete
  flow-map.json
  selectors.json
  playwright-skeleton.ts
  network.har
  states/   0001-<slug>.json …
  dom/      0001-<slug>.html …
  screens/  0001-<slug>.png …
  api/bodies/<netId>.json …   only when full API bodies were kept
```

Every file is always written, even when empty (`[]`, no pages, no endpoints),
so a reader never has to guess whether a file is missing or the session had
nothing to put in it. `api/bodies/` is the exception: it exists only when
"Keep full API responses" was on for at least part of the session and at
least one body was still in storage at export.

**Ids are shared across files.** A page is `pg_001`, numbered by route in
order of first appearance; the same id appears in `site-map.json`,
`routes.json`, `coverage.json` and `flow-map.json` pages. An endpoint is
`api_001`, numbered by templated URL in order of first call; the same id is
used in `site-map.json` (page and list `apiEndpoints`) and `api-catalog.json`.
Actions (`act_0001`), downloads (`dl_0001`), states (`st_0001`) and network
calls (`net_0001`) keep the ids they were stored with.

Stem = zero-padded sequence + slug of title or pathname, lowercased,
non-alphanumerics collapsed to `-`, truncated to 40 chars, identical across the
three subfolders so files line up.

Report progress to the panel as entries are packed, then as the single
download. One file means Chrome's "Ask where to save" setting costs at most one
dialog, so the README no longer asks the user to change it.

## manifest.json

```json
{
  "tool": "Flowprint",
  "version": "1.1.0",
  "exportedAt": "ISO-8601",
  "sessionStartedAt": "ISO-8601",
  "origins": ["https://example.com"],
  "frameworks": [{ "origin": "https://example.com", "framework": "angular", "version": "16" }],
  "counts": { "states": 0, "domSnapshots": 0, "screenshots": 0, "netEntries": 0,
              "listPatterns": 0, "transitions": 0, "dependencies": 0,
              "actions": 0, "downloads": 0, "pages": 0, "endpoints": 0 },
  "redaction": {
    "packs": ["generic", "india"],
    "fieldValues": "redacted at capture",
    "domValues": "redacted at capture",
    "bodies": "pattern-scrubbed, NOT guaranteed clean",
    "apiShapes": "shapes only (key names, types, lengths, enum-like values); key names and enum values scrubbed at capture",
    "downloads": "file names never stored (nameShape only); URLs scrubbed without query values; file contents never read"
  },
  "keepBodies": "shape",
  "blockedFrames": [],
  "degraded": { "screenshots": false, "snapshots": false, "bodiesDropped": false,
                "netTrimmed": false, "statesRefused": false },
  "warnings": ["Network response bodies are kept for reference data. Review before sharing."],
  "harNote": "HAR 1.2 shaped, reconstructed from fetch/XHR wrappers. Timings approximate; browser-added request headers absent."
}
```

`counts.pages` is the number of distinct routes, `counts.endpoints` the
number of entries in `api-catalog.json`. `keepBodies` is `"full"` when the
package holds `api/bodies/` or the switch was on at export, else `"shape"`.
A body that was flagged but is no longer in storage is left out, its entry's
`hasFullBody` is `false` in every file, and a warning says how many.

## StateRecord

```jsonc
{
  "id": "st_0007", "seq": 7, "capturedAt": "ISO-8601",
  "trigger": "click:Next", "triggerAt": "ISO-8601",
  "origin": "https://example.com", "url": "…", "pathname": "/…",
  "title": "Step 2", "lang": "en",
  "inIframe": false, "frameSrc": null, "tabId": 12, "frameId": 0,
  "viewport": { "w": 1512, "h": 860, "dpr": 2 },
  "framework": { "framework": "angular", "version": "16", "confidence": "high" },
  "signature": "…",
  "headings": ["…"],
  "steps": [{ "text": "Step 2", "active": true }],
  "buttons": [{ "text": "Next", "id": "btnNext", "type": "button",
                "disabled": false, "visible": true, "danger": false }],
  "errors": [], "notices": [], "authHints": { "loggedIn": true, "evidence": "logout affordance" },
  "controlCount": 34,
  "controls": [ /* ControlRecord */ ],
  "lists": { "tables": [], "repeats": [], "pagination": [], "downloads": [] },
  "domRef": "fp:dom:st_0007",
  "screenshotRef": "fp:shots:st_0007",
  "netRefs": ["net_0031"],
  // docs/12 — always present; states stored by 1.0.0 are completed on read
  "route": "/app/#/orders",          // pathname + fragment path; the page identity
  "queryKeys": ["status"],           // names only
  "view": { "key": "Status=Open|page=2", "active": [{ "group": "Status", "option": "Open" }] },
  "nav": { "menus": [ /* NavItem */ ], "viewGroups": [ /* ViewGroup */ ], "breadcrumbs": [] },
  "actionIds": ["act_0012"],         // actions between the previous state and this one
  "openedFrom": null                 // { tabId, stateId, actionId } for the first state of a new tab
}
```

"Which page" means `route` everywhere in the export, never `pathname`: a
fragment-routed app has one pathname for every page.

## ControlRecord

Per `docs/02`. `key` is the identity used in signatures and edges. `value` is
always redacted, and **absent** when `redactedEntirely: true` (docs/11 F2):
credential-shaped controls keep every structural field — id, selectors,
`visible`, `boundingBox`, constraints — and carry no value, not even a length.
`selectors` always present. Flow-map controls carry the same flag so nothing
binds a data source to them.

## List structures

```jsonc
"repeats": [{
  "containerSelector": "[data-testid=\"results\"]",
  "itemSelector": "[data-testid=\"results\"] > div.card",
  "itemCount": 24,
  "slots": [
    { "name": "slot_1", "selector": ".card .title", "kind": "text",  "sample": "<28 chars>" },
    { "name": "slot_2", "selector": ".card a.dl",   "kind": "link",  "sample": "<href>", "download": true }
  ]
}],
"pagination": [{ "next": "[rel=\"next\"]", "prev": "[rel=\"prev\"]",
                 "pageIndicator": ".pager .count", "style": "numbered" }]
```

## flow-map.json

The roll-up across all states — the file automation is written from.

```jsonc
{
  "generatedAt": "ISO-8601",
  "origin": "https://example.com",
  "framework": "angular",
  "pages": [{ "stateId": "st_0007", "pathname": "/step2", "title": "Step 2",
              "reachedBy": "click:Next from st_0006",
              "route": "/step2", "viewKey": "", "pageId": "pg_004" }],
  "controls": [{
    "key": "panNumber",
    "seenOnStates": ["st_0007"],
    "label": "…", "labelSource": "for", "type": "text",
    "required": true, "maxLength": 10, "pattern": "…",
    "selectors": { "primary": "…", "fallbacks": ["…"], "stability": "stable" },
    "options": null, "dependsOn": [], "affects": [],
    "sourceField": null,        // human fills: where the value comes from
    "notes": ""
  }],
  "lists": [ /* deduped list patterns with the states they appeared on */ ],
  "dependencies": [ /* from deps.js */ ],
  "transitions": [ /* the state graph */ ]
}
```

`sourceField` is always `null` on export — it's the column a human fills to bind
the site to their own data model.

## selectors.json

A flat `{ key: primarySelector }` map plus a `fallbacks` sibling object. Exists so
generated code can import selectors without parsing the whole flow map.

## site-map.json — `SiteMap`

```jsonc
{
  "generatedAt": "ISO-8601", "origin": "https://example.com",
  "entryStateId": "st_0001",          // first logged-in state, else the first state
  "menu": [{                          // parents before children, in the site's order
    "id": "reports > monthly", "text": "Monthly", "path": ["Reports", "Monthly"], "depth": 1,
    "selector": "…", "shadowPath": [], "href": "/app/#/reports/monthly", "hasChildren": false,
    "seenOnStates": ["st_0001"],
    "visited": true,                  // clicked (menuPath or selector match), or its href was recorded as a route
    "visitedBy": ["act_0007"], "leadsTo": ["pg_005"]
  }],
  "pages": [{
    "id": "pg_002", "route": "/app/#/orders", "title": "…", "headings": ["Orders"],
    "stateIds": ["st_0002", "st_0003"],
    "views": [{ "key": "Status=Open|page=1", "stateIds": ["st_0002"] }],
    "viewGroups": [{ "name": "Status", "label": "Status", "kind": "tabs", "containerSelector": "…", "shadowPath": [],
                     "options": [{ "text": "Closed", "selector": "…", "visited": false }] }],
    "lists": [{ "kind": "table", "selector": "…", "headers": ["…"], "hasPagination": true,
                "paged": true, "itemOpened": true, "downloadSeen": false, "apiEndpoints": ["api_002"] }],
    "apiEndpoints": ["api_002"], "downloadIds": [], "loggedIn": true
  }]
}
```

A page is a distinct `route`; its views are the distinct `view.key` values
seen on it. Menu items are merged across every state by `path`, so a
collapsed submenu's items appear with `visited: false` until one is clicked.
A branch heading with no `href` counts as covered once everything under it is.

## routes.json — `RoutesFile`

```jsonc
{
  "generatedAt": "ISO-8601", "origin": "…", "entryStateId": "st_0001", "entryRoute": "/app/#/dashboard",
  "recipes": [{
    "pageId": "pg_003", "route": "/app/#/orders/1043", "viewKey": "", "targetStateId": "st_0004",
    "reachable": true,
    "directUrl": null,                // origin + route, only when that route was itself a page load
    "steps": [{
      "n": 1, "actionId": "act_0001", "kind": "click", "label": "Orders",
      "selectors": { /* ActionSelectors: primary, fallbacks, shadowPath, stability, unique, role, name */ },
      "menuPath": ["Orders"], "href": "/app/#/orders", "chosen": null,
      "fromStateId": "st_0001", "toStateId": "st_0002",
      "expectRoute": "/app/#/orders", "expectViewKey": "Status=Open|page=1", "expectHeading": "Orders",
      "opensNewTab": false
    }],
    "note": "plain sentences: why a page is unreachable, redacted segments, loose matching after a list item …"
  }]
}
```

One recipe per distinct (route, view key). Paths are found breadth-first from
the entry state over edges that name an `actionId`: fewest steps, then the
most stable selectors. **No step is ever an action flagged `danger`, and no
path crosses an edge on which one was pressed**; a page reached only that way
is `reachable: false`, with a note naming the action. A step whose
`toStateId` equals its `fromStateId` opens a collapsed menu branch for the
step after it. A step that opens a list item (a row click, label
`<n chars>`) stands for "any item": the route and heading after it belong to
the item that was clicked, so compare them loosely.

## api-catalog.json — `ApiCatalog`

```jsonc
{
  "generatedAt": "ISO-8601", "origin": "…",
  "endpoints": [{
    "id": "api_002", "method": "GET", "urlTemplate": "https://example.com/api/tenants/{id}/orders",
    "host": "example.com", "queryKeys": ["page", "size"], "count": 2, "statuses": [200],
    "mimeType": "application/json",
    "requestShape": null,
    "responseShape": { "t": "object", "keys": { "items": { "t": "array", "len": 20, "item": { "t": "object", "keys": {} } } } },
    "listPaths": [{ "path": "$.items", "len": 20 }],   // arrays of objects with more than one item
    "pagingParams": ["page", "size"],                   // judged on the name only
    "calledFromRoutes": ["/app/#/orders"], "stateIds": ["st_0002"], "actionIds": ["act_0001"],
    "netIds": ["net_0002", "net_0003"], "isDownload": false, "hasFullBody": true
  }]
}
```

Scripts, styles, images, fonts and source maps are left out. A path segment
becomes `{id}` when it varies between calls that otherwise look like one
endpoint, or when it looks like an identifier (digits, UUID, hash, token, a
redaction placeholder). A `JsonShape` holds structure only: key names, types,
array lengths, longest string length, a format guess, and `values` only for
enum-like strings. The shape of error responses is used only for an endpoint
that never succeeded.

## actions.json — `ActionEntry[]`

Every click and change as recorded (docs/12 B4): selectors with ARIA role and
accessible name, label, `href`, `target`, `menuPath`, `viewGroup`,
`pagination` and `paginationRole`, `listSelector`, `danger`, `download`, the
state it was made on (`stateIdAtTime`) and the next state in the same tab
(`resultStateId`). Values are never part of an action; a change on a
non-credential select, radio or checkbox carries the chosen option's text in
`chosen`. Labels of table rows and list items are `<n chars>`: their text is
record data and only its length was kept.

## downloads.json — `DownloadEntry[]`

Every download attributed to the origin (docs/12 B6): `urlKind` (`http`,
`blob`, `data`), the scrubbed `url` without query values (`null` for blob and
data), `queryKeys`, `mime`, `extension`, `sizeBytes`, `state`, the tab, the
route, `stateIdAtTime`, `actionId` and the matching `netId`. **The file name
is never stored**; `nameShape` gives its structure (letters → `A{n}`, digits →
`9{n}`). The file's contents are never read.

## coverage.json — `Coverage`

```jsonc
{
  "generatedAt": "ISO-8601", "origin": "…",
  "totals": { "menuItems": 6, "menuVisited": 4, "pages": 7, "viewOptions": 2, "viewOptionsVisited": 1,
              "lists": 1, "listsPaged": 1, "downloads": 1 },
  "unvisitedMenu": [{ "id": "settings", "path": ["Settings"], "selector": "…" }],
  "pages": [{ "pageId": "pg_002", "route": "…", "title": "…",
              "viewGroups": [{ "name": "Status", "options": [{ "text": "Closed", "visited": false }] }],
              "lists": [{ "selector": "…", "kind": "table", "hasPagination": true, "paged": true, "itemOpened": true, "downloadSeen": false }],
              "downloads": 0, "apiCalls": 2, "complete": false,
              "missing": ["On \"Orders\", the tab \"Closed\" of \"Status\" was never opened."] }],
  "hints": ["Menu item \"Settings\" was seen but never opened."]   // most valuable first, at most 30
}
```

Logout items are left out of the menu totals. Options that were disabled
every time they were seen are not reported as missed. The side panel shows
the same data live while recording.

## RECIPES.md

The site page by page, in the order its own menu lists them, written for a
reader who has never seen it: the menu with visited marks, then per page how
to reach it (every step with its locators, best first, and what to expect
after it), what to verify on arrival, the views to iterate, the lists with
row, cell and pagination selectors, the endpoints that most likely feed them
with row fields and paging parameters, the downloads seen, and what the
recording did not cover there. It is derived entirely from the JSON files
above; when prose and JSON disagree, the JSON wins.

## api/bodies/

Only when "Keep full API responses" was on (docs/12 B5): one file per network
call that kept a body, named `<netId>.json`, holding the body text exactly as
stored (up to 1 000 000 characters, pattern-scrubbed). The name says JSON
because that is what list endpoints return; a non-JSON body is written as is.
Names, addresses and free text in these bodies cannot be scrubbed
automatically.

## playwright-skeleton.ts

Generated and never executed. Live only where replaying the recording is
safe (docs/12 B8, "The skeleton"):

- A header comment stating that nothing here has been executed, that login is
  the human's job, and that every selector must be verified at run time
- **Live** helpers: `locate()` (role + name, then the primary selector, then
  fallbacks; fails unless exactly one element matches), `arrived()` (waits
  for the expected route and heading), `startAtEntry()`, `clickStep()`,
  `readTable()`, `readRepeat()`, `paginate()`, `forEachView()` and
  `captureDownload()`
- `LISTS`, `PAGINATION` and `VIEW_GROUPS` constants with the recorded selectors
- **Live** `goTo_<page>()` functions, one per recipe in `routes.json`: each
  recorded step as a locator click followed by a wait for the expected route
  (and heading). A page with no recorded path throws, or opens its `directUrl`
- A `SELECTORS` constant from `selectors.json`, plus `FALLBACKS` and
  `SHADOW_PATHS`
- One `async function` stub per page state, named from the slug, with the controls
  of that page listed as commented `// await page.fill(SELECTORS.x, data.x)` lines
  — commented, never live
- A `// TODO` comment at every transition describing what the edge observed

Fills, and every click on a control flagged `danger`, stay commented out.
Controls marked `redactedEntirely` appear only as `// HUMAN:` lines. The
point is still a correct shape to start from, not finished automation.

## SUMMARY.md and AUTOMATION-BRIEF.md

`SUMMARY.md` is the human read: session header, page inventory table (with
route and view key), the flow narrated from the transition edges and the
actions behind them, dependency findings, list-pattern findings, coverage, and
an **attention list** — fragile selectors, weak label sources, non-unique
selectors, duplicate ids, controls that appeared only once.

`AUTOMATION-BRIEF.md` is the agent handoff. See `docs/08-consuming-output.md`.
