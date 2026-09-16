# 10 — Addendum

Additions to `docs/02`, `03` and `05`, written after the first build pass. Where
this conflicts with an earlier doc, this wins. Apply these before the acceptance
run.

---

## A1 — Shadow DOM

Web components hide their internals from `document.querySelectorAll`, so on any
site using them the control inventory comes back empty or partial and every
generated selector silently matches nothing. This is the single most likely way
Flowprint produces a confident, useless export.

**Traversal.** Walk open shadow roots recursively when collecting controls, lists
and buttons. From each element, `el.shadowRoot` when non-null; descend. Cap depth
at 10 to avoid pathological trees.

**Selector shape.** A control inside a shadow root cannot be expressed as one CSS
string. Store a path:

```jsonc
"selectors": {
  "primary": "input[name=\"email\"]",
  "shadowPath": ["my-app", "sign-in-form", "ui-input"],
  "stability": "likely",
  "notes": "inside open shadow roots; query each host in order"
}
```

`shadowPath` is the ordered list of host-element selectors to traverse before the
primary applies. Empty array means light DOM. `AUTOMATION-BRIEF.md` must explain
this, since a consumer that ignores `shadowPath` will write code that fails.

**Closed roots.** Not traversable. When a host element has no accessible
`shadowRoot` but renders visible content, record it as
`{ tag, selector, opaque: true, reason: "closed shadow root" }` in a new
`state.opaqueRegions` array, and flag it in the summary's attention list. Better
to say "there is a region here I could not see" than to omit it.

**Detection flag.** Set `state.usesShadowDom: true` when any open root was found.
Framework detection should also check for `customElements` registrations.

---

## A2 — Mutation circuit breaker

On a live SPA a MutationObserver over `documentElement` fires continuously —
animations, polling, virtual scrolling. Unthrottled, the observer callback plus
debounce resets will make the page visibly slow, and the user will blame the site.

- **Rate cap:** at most one stored state per 2000ms per document, regardless of
  triggers. `manual` is exempt.
- **Volume breaker:** count mutation records per rolling second. Above 500, stop
  scheduling captures from `dom-change` for 10 seconds, keep click/change/nav
  triggers live, and set `state.captureDegraded: true` on the next state.
- **Cheap filter first:** ignore mutation records whose only changes are
  `characterData`, attribute changes to `class`/`style` alone, or additions inside
  an element already marked as a known animation container. Structural changes and
  new form controls are what matter.
- **Panel signal:** show a muted "high page activity — DOM triggers throttled"
  line so the user knows why states stopped appearing and can hit Capture now.

---

## A3 — Cross-origin iframes

Consent is per-origin, but a page can embed frames from other origins. Today those
frames' content scripts exit at the gate and nothing explains the hole.

- When a content script exits on consent, and it is in an iframe whose top frame
  **is** consented, send a one-off `frameBlocked` message with the frame origin.
- The panel lists blocked frame origins under the origin bar: "This page embeds
  `payments.example.com` — also record it?" with an add button.
- Record blocked frames in `state.blockedFrames[]` and in the export manifest, so
  a consumer knows the capture has known blind spots rather than assuming
  completeness.
- Never auto-consent a child origin. The user clicks.

---

## A4 — Service-worker restart durability

MV3 workers terminate after roughly 30 seconds idle. Anything held in a module-
level variable — last state per tab, pending screenshot queue, burst bookkeeping,
the recording flag — is gone on the next message.

- Every piece of cross-message state lives in `chrome.storage.local`, read at the
  top of each handler. `fp:tabs`, `fp:meta` already exist; add `fp:queue` for the
  screenshot queue.
- The write queue promise chain is per-invocation, not global. That is fine, but
  it means two rapid invocations can interleave — guard with a stored
  `fp:lock` timestamp and retry, rather than assuming a single chain survives.
- On worker startup, reconcile: drop screenshot queue entries older than 30s, and
  clear any `fp:lock` older than 5s.
- Never rely on `chrome.runtime.onStartup` — it doesn't fire for unpacked reloads.

---

## A5 — Quota degradation

`unlimitedStorage` raises the ceiling but writes can still fail on a full disk or
a very long session. A failed write must never lose a state.

Degradation order, applied when a write fails or estimated usage passes 80%:

1. Stop taking screenshots; set `fp:meta.degraded.screenshots = true`
2. Stop storing DOM snapshots; set `degraded.snapshots = true`
3. Drop the oldest network entries beyond the cap
4. Only then refuse new states, and surface a blocking panel warning

States, transitions and dependencies are never dropped — they are the irreplaceable
part. Record every degradation in `fp:meta.degraded` and print it in both
`manifest.json` and `SUMMARY.md`, so nobody reads a thin export as a thin site.

---

## A6 — Widget-backed and file inputs

Automation that types into a field the site expects to be set by a widget fails
silently, and this is invisible in a plain control record.

Add to ControlRecord:

```jsonc
"entry": {
  "mode": "typed" | "widget" | "unknown",
  "evidence": "readonly + click opens overlay",
  "widgetKind": "datepicker" | "listbox" | "autocomplete" | "mask" | null,
  "mask": "__/__/____"
}
```

Heuristics: `readOnly` yet not `disabled` and visible; an `aria-haspopup`,
`aria-expanded` or `aria-controls` attribute; a sibling calendar/search icon
button; a `pattern` or `data-mask` attribute; or an overlay appearing in the next
state after a `click:` on that control. `unknown` is an acceptable answer — say so
rather than guessing `typed`.

File inputs: record `accept`, `multiple`, and `capture`. **Never record the
selected filename or path** — filenames routinely contain names, client codes and
case numbers. Treat `input.files` as credential-class data: existence only.

---

## A7 — Key collisions across pages

`flow-map.json` merges controls by key across the whole session. Two unrelated
pages with a control keyed `email` become one entry with contradictory labels and
a selector that only works on one of them.

- Merge only when key **and** normalised label **and** type all match. Normalise by
  lowercasing and collapsing whitespace.
- Otherwise emit separate entries keyed `<pathname>::<key>`, and record
  `collidesWith: []` on each so the consumer can see the relationship.
- List every collision in the summary's attention list. A collision usually means
  the site reuses a component, which is useful to know when writing automation.

---

## A8 — Pause boundaries in the timeline

Following Q18. Pausing creates a gap that the transition graph will otherwise
paper over with an edge describing a transition that never occurred.

- Append `{ type: "paused" | "resumed", at }` to `fp:meta.timeline`.
- `transitions.js` must not create an edge whose `from` and `to` straddle a pause
  or a resume event. Start a fresh chain after each resume.
- `SUMMARY.md` and `AUTOMATION-BRIEF.md` render the gap inline in the narrated
  flow: "— capture paused for 4 minutes —".
- Same rule for a tab being closed and a new one opened on the same origin: a new
  `tabId` starts a new chain, never an edge.

---

## Acceptance additions

Add to `docs/07-acceptance.md`:

- [ ] On a site using web components, controls inside open shadow roots appear
      with a populated `shadowPath`
- [ ] A closed shadow root produces an `opaqueRegions` entry, not silence
- [ ] On a busy SPA the page stays responsive and the panel shows the throttle line
- [ ] A page with a cross-origin iframe offers to record that origin too
- [ ] Leaving the browser idle for a minute then clicking does not lose the tab's
      transition chain
- [ ] A date-picker field reports `entry.mode: "widget"`
- [ ] Selecting a file records `accept` and `multiple` but no filename anywhere
- [ ] Pausing, browsing, then resuming produces no transition edge across the gap
