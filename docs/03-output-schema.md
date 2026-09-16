# 03 — Output schema

## Export layout

Export writes a folder via `chrome.downloads.download`, one call per file, all
under a single timestamped directory in the user's Downloads:

```
mca-capture-2026-09-16T1430/
  manifest.json
  SUMMARY.md
  field-map-draft.json
  network.har
  states/
    0001-home.json
    0002-spice-part-a.json
    ...
  dom/
    0001-home.html.gz        # gzipped as stored; gunzip to view (Q14)
    0002-spice-part-a.html.gz
    ...
  screens/
    0001-home.png
    ...
```

File stem = zero-padded sequence + slug of the page title or pathname, lowercased,
non-alphanumerics collapsed to `-`, truncated to 40 chars. The same stem across
`states/`, `dom/` and `screens/` so files line up.

Chrome will prompt once per file unless the user has "ask where to save" off.
Write files sequentially with a small delay so the queue doesn't get throttled,
and show progress in the side panel.

## manifest.json

```json
{
  "tool": "MCA DOM Capturer",
  "version": "1.0.0",
  "exportedAt": "ISO-8601",
  "sessionStartedAt": "ISO-8601",
  "counts": { "states": 0, "domSnapshots": 0, "screenshots": 0, "netEntries": 0 },
  "origins": ["https://www.mca.gov.in"],
  "redaction": {
    "fieldValues": "redacted at capture",
    "domValues": "redacted at capture",
    "bodies": "pattern-scrubbed, NOT guaranteed clean"
  },
  "warnings": [
    "Network response bodies are kept for dropdown data. Review before sharing."
  ],
  "harNote": "HAR 1.2 shaped, reconstructed from fetch/XHR wrappers. Timings are approximate and browser-added request headers are absent."
}
```

## StateRecord

```jsonc
{
  "id": "st_0007",
  "seq": 7,
  "capturedAt": "ISO-8601",
  "trigger": "click:Next",
  "triggerTimestamp": "ISO-8601",
  "triggers": ["click:Next", "dom-change (x12)"],
  "tabId": 123,
  "frameId": 0,
  "url": "https://www.mca.gov.in/...",
  "pathname": "/...",
  "title": "SPICe+ Part A",
  "inIframe": false,
  "frameSrc": null,
  "viewport": { "w": 1512, "h": 860, "dpr": 2 },
  "scroll": { "x": 0, "y": 340 },
  "signature": "…",
  "headings": ["…"],
  "steps": [{ "text": "Part A", "active": true }],
  "buttons": [
    { "text": "Next", "id": "btnNext", "classes": "btn btn-primary",
      "disabled": false, "visible": true, "danger": false }
  ],
  "errors": ["Please enter a valid PAN"],
  "notices": [],
  "fieldCount": 34,
  "fields": [ /* FieldRecord */ ],
  "domRef": "dc:dom:st_0007",
  "screenshotRef": "dc:shots:st_0007",
  "screenshotOf": "page",          // "parent-frame" for iframe states (Q1)
  "duplicateOf": null,             // previous state id when a manual capture changed nothing (Q10)
  "netRefs": ["net_0031", "net_0032"]
}
```

## FieldRecord

```jsonc
{
  "index": 12,
  "tag": "input",
  "type": "text",
  "id": "panNumber",
  "name": "pan",
  "formControlName": "panNumber",
  "label": "PAN of the applicant",
  "labelSource": "for",
  "placeholder": "ABCDE1234F",
  "ariaLabel": "",
  "title": "",
  "required": true,
  "maxLength": 10,
  "minLength": null,
  "pattern": "[A-Z]{5}[0-9]{4}[A-Z]",
  "inputMode": null,
  "disabled": false,
  "readOnly": false,
  "visible": true,
  "boundingBox": { "x": 240, "y": 612, "w": 280, "h": 38 },
  "classes": "form-control ng-untouched",
  "value": "<10 chars>",
  "group": null,
  "optionCount": null,
  "options": null,
  "checked": null,
  "selectors": {
    "primary": "#panNumber",
    "fallbacks": ["[formcontrolname=\"panNumber\"]", "[name=\"pan\"]"],
    "stability": "stable",
    "unique": true,
    "uniqueInForm": true,           // null when there is no enclosing <form> (Q5)
    "notes": ""
  }
}
```

## NetEntry (internal) and network.har

Internal entries hold what the hooks captured. `har.js` converts them into a
HAR 1.2 `log` with `creator`, `pages` (one per distinct pageUrl) and `entries`.
Fill `time` from `durationMs`; set unknown timing phases to `-1`, which is legal
HAR. Do not invent values.

## field-map-draft.json

The deliverable that feeds VCFO Assist. One entry per **unique field across all
states**, keyed by the most stable identifier available:

```jsonc
{
  "generatedAt": "ISO-8601",
  "fields": [
    {
      "key": "panNumber",
      "altKeys": ["pan"],          // every other identifier seen for the field (Q16)
      "seenOnStates": ["st_0007", "st_0011"],
      "label": "PAN of the applicant",
      "labelSource": "for",
      "type": "text",
      "required": true,
      "maxLength": 10,
      "pattern": "[A-Z]{5}[0-9]{4}[A-Z]",
      "selectors": { "primary": "#panNumber", "fallbacks": ["…"], "stability": "stable" },
      "options": null,
      "dependsOn": [],
      "affects": [],
      "vcfoField": null,          // human fills this in later
      "notes": ""
    }
  ],
  "dependencies": [
    { "sourceField": "state", "targetFields": ["district"], "viaNetwork": true,
      "endpoint": "/api/…", "confidence": "high" }
  ],
  "transitions": [ /* the state graph edges */ ]
}
```

`vcfoField` is always `null` on export. It is the column a human fills in to turn
a capture into a real field map — say so in `SUMMARY.md`.

## SUMMARY.md

Human-readable, generated, roughly:

- Session header: when, how many states, which pages
- Page inventory table: seq, title, path, field count, trigger that reached it
- Flow narrative: the transition edges rendered as "from X, clicking Y led to Z,
  adding N fields"
- Dependency findings
- **Attention list**: fields with `fragile` selectors, fields with
  `labelSource: none | sibling | container`, non-unique selectors, duplicate ids
  on the page (the prototype already found three buttons sharing
  `btnPaymentStatus` — exactly this class of problem)
- Reminder to review network bodies before sharing
