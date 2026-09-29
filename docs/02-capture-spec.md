# 02 — Capture specification

The contract. Everything else exists to produce what's described here.

## Gate

Before anything: if the current origin is not in `fp:origins`, the content script
returns immediately and installs no listeners. No exceptions.

## When to capture

Debounced 900ms after any of:

| Trigger | Source | `trigger` value |
|---|---|---|
| Page load | `document_idle` | `load` |
| DOM subtree change | MutationObserver on `documentElement` | `dom-change` |
| Click | capture-phase listener | `click:<text or id, 40 chars>` |
| Value change | capture-phase `change` listener | `change:<key>` |
| SPA navigation | MAIN-world `history` patch, `popstate`, `hashchange` | `nav:<kind>` |
| Manual | side panel "Capture now" | `manual` |

**Trigger attribution:** within one debounce burst, record the first
non-`dom-change` trigger with its own timestamp. `dom-change` is used only when
nothing else fired.

**Dedupe:** compute a signature; discard if it matches the previous state for the
same document. `manual` always stores, even when identical.

**Signature** = `pathname` + `title` + ordered list of each control's key. Excludes
values and visibility. Dedupe additionally compares the joined visible `errors`
list, so a validation message that adds no fields still produces a state.

## Framework detection

Run once per document, store on the state and use it to rank selectors:

- Angular: `[ng-version]`, `window.ng`, `ng-reflect-*` attributes
- React: `__REACT_DEVTOOLS_GLOBAL_HOOK__`, `__reactFiber$` keys, `[data-reactroot]`
- Vue: `window.__VUE__`, `[data-v-]` attributes
- Svelte: `svelte-` class hashes
- jQuery: `window.jQuery`
- otherwise `plain`

Record as `{ framework, version, confidence }`.

## Page-level capture

- `url` (query stripped), `pathname`, `title`, `lang` (`<html lang>`)
- `origin`, `inIframe`, `frameSrc`
- `viewport` — width, height, devicePixelRatio
- `framework`
- `trigger`, `triggerAt` (named as in docs/03)
- `headings` — `h1..h4, legend, [class*="title"], [class*="heading"]`, max 40
- `steps` — `[role="tab"], [role="tablist"] > *, .nav-tabs li, [class*="step"],
  [class*="wizard"], .breadcrumb li` in DOM order, with which is active
- `buttons` — text, id, classes, `type`, `disabled`, `visible`, plus `danger`
  when `type="submit"`, or the element sits inside a `<form>` that would submit,
  or its text matches the configurable danger word list (default English:
  submit, pay, confirm, delete, remove, final; user-editable in the panel)
- `errors` — `[class*="error"], [class*="invalid"], [class*="danger"], [role="alert"],
  mat-error`
- `notices` — `[class*="alert"], [class*="info"], [class*="note"]`, max 10
- `authHints` — presence of elements whose text or href matches login/logout/sign
  affordances, as a crude logged-in/out signal. Text only, never credentials.

## Control-level capture

For every `input` (excluding `type=hidden`), `select`, `textarea`,
`[contenteditable="true"]`, and ARIA widgets (`[role="combobox"]`,
`[role="listbox"]`, `[role="checkbox"]`, `[role="radio"]`, `[role="switch"]`):

```
index, tag, type, role,
key,                              // the identity used in signatures
id, name, formControlName,        // formcontrolname || ng-reflect-name
dataAttrs: { testid, test, cy, qa, ... all data-* },
label, labelSource,
placeholder, ariaLabel, ariaDescribedByText, title,
required, maxLength, minLength, pattern, inputMode, step, min, max,
disabled, readOnly, visible,
boundingBox: {x, y, w, h},        // viewport coordinates, matches the screenshot
classes (120 chars),
value,                            // ALWAYS redacted
group,                            // radio/checkbox shared name
optionCount, options[{v, t}],     // native selects, first 60
checked,
selectors: {...}
```

### Label resolution — language-agnostic

Order, recording which worked in `labelSource`. No strategy may depend on English:

1. `label[for="<id>"]` → `for`
2. Wrapping `<label>` → `wrap`
3. `aria-labelledby` target text → `aria-labelledby`
4. `aria-label` → `aria-label`
5. Nearest label-ish element inside the closest form-field container
   (`[class*="form-group"], [class*="field"], mat-form-field, [class*="control"]`) → `container`
6. Previous sibling element's text if under 80 chars → `sibling`
7. `placeholder` → `placeholder`
8. Empty → `none`

`labelSource` of `container`, `sibling` or `none` marks a weak mapping target and
must be flagged in the summary.

### Selector candidates — framework-aware

```
selectors: {
  primary: "[data-testid=\"pan\"]",
  fallbacks: ["#panNumber", "[formcontrolname=\"panNumber\"]", "<xpath>"],
  stability: "stable" | "likely" | "fragile",
  unique: true,
  notes: ""
}
```

Base ranking:

1. Automation attributes — `data-testid`, `data-test`, `data-cy`, `data-qa`
2. Authored `#id`
3. Framework binding — `[formcontrolname]` on Angular, `[name]` elsewhere
4. `[name]`
5. Accessible name — `[aria-label="…"]` or `[role=…][aria-label=…]`
6. Label-anchored XPath — `//label[normalize-space()="X"]/following::input[1]`
7. Structural — `form > div:nth-of-type(3) input:nth-of-type(2)`

On Angular, promote 3 above 2. On React or Vue, demote `#id` if it looks
generated. `stability` is `stable` for 1–2, `likely` for 3–5, `fragile` for 6–7,
and always `fragile` when the primary matches more than one element — verify with
`querySelectorAll().length`.

**Auto-generated id rejection:** reject ids matching `/^(mat-|cdk-|ng-|ember|react-|:r|radix-)/i`,
or `/[-_:.]\d+$/` (separator then digits), or a UUID/hash shape. A plain trailing
digit like `address1` is authored — keep it. Record rejections in `notes`.

## List, table and pagination capture

This is what makes the tool useful for scraping, not just filling.

- **Tables** — for each `table`, `[role="table"]`, `[role="grid"]`: the container
  selector, column headers in order, row count, and one sample row's cell
  structure with text redacted to `<n chars>`.
- **Repeated items** — find containers with three or more structurally similar
  element children (same tag and similar class signature). For each: the container
  selector, the item selector, item count, and per-item sub-selectors for the
  distinct text/link/image slots found inside the first item, each with its
  redacted sample shape. This is exactly what a card parser needs and exactly what
  a screenshot cannot give.
- **Pagination** — controls matching `[class*="pag"]`, `[aria-label*="page" i]`,
  `[rel="next"]`, `[rel="prev"]`, or a run of sibling links whose text is
  consecutive integers. Record the next/prev selectors and, when present, the
  total-pages text location.
- **Downloads** — anchors with a `download` attribute or an href ending in a
  document extension; record selector, extension, and whether the href is a
  direct URL or a script-driven handler.

## DOM snapshot

One per state, stored separately. Before gzipping: strip `<script>`, `<style>`,
`<noscript>` and `<svg>` inner content (keep the tags), remove comments, truncate
attributes over 300 chars and `data:` URIs to 64 chars, and apply redaction —
`value="<n chars>"`, hidden inputs `value="<hidden>"`, credential controls
`value="<redacted>"` with no length. Text nodes and `title`/`alt`/`aria-label`/
`placeholder` values are pattern-scrubbed with the enabled packs (docs/05 rule 4).

## Screenshot

`chrome.tabs.captureVisibleTab` at capture time, PNG, throttled in the worker to
one per 600ms with a max queue of 3 — drop, never block. Toggleable, default on.
Skipped for iframe states, since the capture would be the parent page.

## Network capture

Wrap `fetch` and `XMLHttpRequest` in the MAIN world. Per call record `id`, `kind`,
`method`, `url`, `status`, `statusText`, caller-set request headers, request body
(truncated 2000, scrubbed), response headers, response body (truncated 4000,
scrubbed), `mimeType`, `startedAt`, `durationMs`, `pageUrl`, `stateIdAtTime`,
`tabId`, `frameId`.

Post one message per call, after the body is read from a clone, so the page is
never delayed. Never swallow errors; always return what the page expected.

Response bodies matter: option lists, lookups, cascade payloads and list data all
live there. Keep them, scrub them, and state plainly that a human must read them
before the export is shared.

## Transitions — the state graph

On each new state, if a previous state exists **for the same `tabId:frameId`**:

```
{ from, to, trigger, urlChanged, fieldsAdded[], fieldsRemoved[],
  optionsChanged[{key, before, after}], listCountsChanged[{selector, before, after}],
  netCallsBetween[ids], errorsAppeared[] }
```

Edges never join states from different documents. This graph is the most valuable
artifact in the export: it answers "what happens when I click Next" without anyone
describing it.

## Dependent-control detection

When a `change:<key>` trigger is followed within 2500ms by a network call or an
`optionsChanged` entry on a different control, record
`{ sourceKey, targetKeys[], viaNetwork, endpoint?, confidence }` — `high` when a
network call sits between, `medium` otherwise.

Non-native dropdowns (`mat-select`, custom listboxes) never emit `change`. Treat a
`click` on an element inside `[role="listbox"]` or `[role="option"]` as
`change:<closest control key>` so those cascades are caught too.

## Out of scope

- Computed styles, CSS, fonts, layout beyond the bounding box
- Replay, diffing across sessions, scheduling
- Any origin not explicitly consented
