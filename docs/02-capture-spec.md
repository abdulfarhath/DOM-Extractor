# 02 — Capture specification

This is the contract. Everything else in the extension exists to produce what's
described here.

## When to capture

Capture is triggered by, and debounced 900ms after, any of:

| Trigger | Source | `trigger` value |
|---|---|---|
| Initial page load | `document_idle` | `load` |
| DOM subtree change | MutationObserver on `documentElement` | `dom-change` |
| Click anywhere | capture-phase listener | `click:<text or id, 40 chars>` |
| Select / radio / checkbox change | capture-phase listener | `change:<id or name>` |
| Click on an option in a custom listbox (`[role=option]`, `mat-option`, `ng-option`) | capture-phase click, owner resolved via aria-owns/aria-controls (Q17) | `change:<owner id or name>` |
| SPA navigation | patched `pushState`/`replaceState`, `popstate`, `hashchange` | `nav:<kind>` |
| Manual | side panel "Capture now" | `manual` |

After the debounce, build a StateRecord and compute its signature. If the
signature matches the previous capture, discard it. Clicking around a stable page
must not produce dozens of near-identical records.

**Signature** = `pathname` + `title` + the ordered list of every field's
`id || name || formControlName || label`. Deliberately excludes values and
visibility so that typing doesn't create states but revealing a conditional field
does.

## What to capture per state

### Page level
- `url` (query string stripped), `pathname`, `title`
- `inIframe`, and if so the frame's `src`
- `viewport` — width, height, devicePixelRatio
- `trigger` and `triggerTimestamp`; `triggers` — every trigger in the debounce
  burst, consecutive repeats collapsed (Q11)
- `scroll` — window scroll offset; bounding boxes are viewport-relative (Q4)
- `headings` — `h1..h4, legend, .panel-title, .section-title`, max 40
- `steps` — wizard/tab labels from `[role="tab"], .nav-tabs li, .mat-tab-label,
  .step-title, .wizard-step, .breadcrumb li`, in DOM order, with which is active
- `buttons` — text, id, classes, `disabled`, `visible`, and whether the text
  matches a danger pattern (`submit|pay|confirm|delete|final`) so the downstream
  tool knows what never to touch
- `errors` — visible text from `.error, .invalid-feedback, .text-danger,
  mat-error, .alert-danger, .validation-message`
- `notices` — visible text from `.alert, .info, .note`, max 10

### Field level

For every `input` (excluding `type=hidden`), `select`, `textarea`, and
`[contenteditable="true"]`:

```
index, tag, type,
id, name, formControlName,        // formcontrolname || ng-reflect-name
label, labelSource,               // how the label was found — see below
placeholder, ariaLabel, title,
required, maxLength, minLength, pattern, inputMode,
disabled, readOnly, visible,
boundingBox: {x, y, w, h},
classes (120 chars),
value                              // ALWAYS redacted, see docs/05
group                              // radio/checkbox: shared name attribute
optionCount, options[{v, t}]       // selects only, first 60
checked                            // radio/checkbox only
selectors: {...}                   // see below
```

### Label resolution

Try in order and record which one worked in `labelSource`:

1. `label[for="<id>"]` → `for`
2. Wrapping `<label>` → `wrap`
3. `aria-labelledby` target's text → `aria-labelledby`
4. `aria-label` → `aria-label`
5. Nearest `label, .label, .control-label, mat-label` inside the closest
   `.form-group, .field, mat-form-field, .col, .row` → `container`
6. Previous sibling element's text if under 80 chars → `sibling`
7. `placeholder` → `placeholder`
8. Empty → `none`

`labelSource` matters downstream: a field labelled only by `container` or
`sibling` is a weaker mapping target and the summary should flag it.

### Selector candidates

For each field produce:

```
selectors: {
  primary: "#panNumber",
  fallbacks: ["[formcontrolname=\"panNumber\"]", "[name=\"pan\"]", "<xpath>"],
  stability: "stable" | "likely" | "fragile",
  notes: "id looks auto-generated"
}
```

Ranking, best first:

1. `#id` — **only if the id looks authored.** Reject as auto-generated if it
   matches `/^(mat-|cdk-|ng-|ember|react-|:r)/i`, or ends in a bare number that
   varies, or is a UUID/hash shape. Record the rejection in `notes`.
2. `[formcontrolname="x"]` — the most reliable thing on an Angular form.
3. `[name="x"]`.
4. Label-anchored XPath: `//label[normalize-space()="X"]/following::input[1]`.
5. Structural path: `form > div:nth-of-type(3) input:nth-of-type(2)`.

`stability` = `stable` if 1 or 2 produced the primary, `likely` if 3, `fragile`
if 4 or 5. Also mark `fragile` if the primary selector matches more than one
element on the page — always verify uniqueness with `querySelectorAll().length`.
Record `uniqueInForm` as well: the same check scoped to the enclosing `<form>`,
`null` when there is none (Q5). At export, an id seen to differ between
captures of the same logical field is demoted regardless of shape (Q2).

### DOM snapshot

One per state, stored separately. Before storing:

- Remove `<script>`, `<style>`, `<noscript>`, `<svg>` inner content (keep the
  tags so structure is legible)
- Remove HTML comments
- Truncate any attribute over 300 chars, and any `data:` URI to 64 chars
- Replace every `value`, `<textarea>` content, and `contenteditable` text per the
  redaction rules
- Gzip via `CompressionStream('gzip')`, store base64

### Screenshot

`chrome.tabs.captureVisibleTab` at capture time, PNG, throttled in the service
worker to one per 600ms with a max queue of 3 — drop, never block. Toggleable
from the side panel, default on. Iframe captures get one too, labelled
`screenshotOf: "parent-frame"` because the image is the whole tab (Q1).

## Network capture

Wrap `fetch` and `XMLHttpRequest` in the MAIN world. For every call record:

```
id, kind: "fetch"|"xhr", method, url, status, statusText,
requestHeaders (only those explicitly set by the caller),
requestBody (truncated 2000, scrubbed),
responseHeaders, responseBody (truncated 4000, scrubbed),
mimeType, startedAt, durationMs,
pageUrl, stateIdAtTime
```

Response bodies matter more than usual here: dropdown option lists, NIC code
lookups, name-availability checks and state/district cascades all live in them.
Keep them, scrub them, and note in the export manifest that they need a human
read before sharing.

## Transitions — the state graph

Whenever a new state is stored and a previous state exists for the same tab,
record an edge:

```
{ from, to, trigger, urlChanged, fieldsAdded[], fieldsRemoved[],
  optionsChanged[{fieldId, before, after}], netCallsBetween[ids],
  errorsAppeared[] }
```

This is the single most valuable artifact for building the automation, because it
answers "what actually happens when I click Next" without anyone describing it.

## Dependent-dropdown detection

When a `change:<field>` trigger is followed, within 2500ms, by either a network
call or an `optionsChanged` entry on a different field, record:

```
{ sourceField, targetFields[], viaNetwork: true|false, endpoint?, confidence }
```

`confidence` is `high` if a network call sits between them, `medium` otherwise.
These become the dependency notes in `SUMMARY.md`.

## Explicitly out of scope

- Computed styles, CSS, fonts, layout metrics beyond the bounding box.
- Anything on a non-MCA origin.
- Replaying, re-executing, or diffing captures across sessions.
