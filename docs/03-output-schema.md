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
  SUMMARY.md
  flow-map.json
  selectors.json
  playwright-skeleton.ts
  network.har
  states/   0001-<slug>.json …
  dom/      0001-<slug>.html …
  screens/  0001-<slug>.png …
```

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
  "version": "1.0.0",
  "exportedAt": "ISO-8601",
  "sessionStartedAt": "ISO-8601",
  "origins": ["https://example.com"],
  "frameworks": [{ "origin": "https://example.com", "framework": "angular", "version": "16" }],
  "counts": { "states": 0, "domSnapshots": 0, "screenshots": 0, "netEntries": 0,
              "listPatterns": 0, "transitions": 0, "dependencies": 0 },
  "redaction": {
    "packs": ["generic", "india"],
    "fieldValues": "redacted at capture",
    "domValues": "redacted at capture",
    "bodies": "pattern-scrubbed, NOT guaranteed clean"
  },
  "warnings": ["Network response bodies are kept for reference data. Review before sharing."],
  "harNote": "HAR 1.2 shaped, reconstructed from fetch/XHR wrappers. Timings approximate; browser-added request headers absent."
}
```

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
  "netRefs": ["net_0031"]
}
```

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
              "reachedBy": "click:Next from st_0006" }],
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

## playwright-skeleton.ts

Generated, commented, and deliberately incomplete:

- A `SELECTORS` constant from `selectors.json`
- One `async function` stub per page state, named from the slug, with the controls
  of that page listed as commented `// await page.fill(SELECTORS.x, data.x)` lines
  — commented, never live
- A `// TODO` block at every transition describing what the edge observed
- A header comment stating that credentials, waits, and error handling are absent
  by design and that nothing here has been executed

The point is to give a coding agent a correct shape to start from, not runnable
code.

## SUMMARY.md and AUTOMATION-BRIEF.md

`SUMMARY.md` is the human read: session header, page inventory table, the flow
narrated from the transition edges, dependency findings, list-pattern findings,
and an **attention list** — fragile selectors, weak label sources, non-unique
selectors, duplicate ids, controls that appeared only once.

`AUTOMATION-BRIEF.md` is the agent handoff. See `docs/08-consuming-output.md`.
