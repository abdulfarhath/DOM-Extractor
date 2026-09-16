# QUESTIONS

Append-only. Every judgement call the spec didn't cover. Do not block on these —
pick the default, record it, keep building. The human answers them all after the
build and you revise.

Format:

## Q<n> — <short title>
- **Context:** where this came up
- **Default chosen:** what you did
- **Alternative:** what else was reasonable
- **Answer:** _(left blank for the human)_

---

## Q1 — Screenshot capture on iframes
- **Context:** `captureVisibleTab` grabs the whole tab, so an iframe state's
  screenshot is really the parent page.
- **Default chosen:** skip screenshots for iframe states, per docs/02.
- **Alternative:** capture anyway and mark it as parent-frame imagery.
- **Answer:** Changed — capture iframe screenshots, label them parent-frame. Done: `screenshotOf: 'page'|'parent-frame'` on StateRecord; noted in SUMMARY.md and manifest warnings.

## Q2 — What counts as "ends in a bare number that varies"
- **Context:** `selectors.js` id rejection. A single capture cannot observe
  variance, so the rule needs a static approximation.
- **Default chosen:** reject ids matching `/[-_:.]\d+$/` (separator then
  digits, e.g. `input-12`, `ctl_3`). Plain `panNumber1` is kept as authored.
- **Alternative:** reject any id ending in a digit; or compare ids across
  captures of the same pathname at export time and demote the ones that differ.
- **Answer:** Extended — keep regex, add cross-state id variance check at export. Done: `findVaryingIds` in fieldmap.js groups by path+formControlName+name+label; varying ids drop out of the key and `#id` primaries are demoted to the best non-id fallback with a note; SUMMARY.md lists them.

## Q3 — `pin` in the credential regex also hits postal PIN code fields
- **Context:** docs/05 rule 2 regex `/captcha|otp|passw|pin|secret|token/i`.
  SPICe+ address blocks label the postal code "Pin code" / `pinCode`, so those
  fields are recorded as `redactedEntirely` and lose their selectors and
  maxlength.
- **Default chosen:** followed the spec literally. Over-redaction is the safe
  failure.
- **Alternative:** `\bpin\b(?!\s*code)` or an explicit allow-list for
  `pincode|pin code|pin_code`.
- **Answer:** Changed — fix the regex, pincode must survive. Done: `/captcha|otp|passw|secret|token|mpin|(?:^|[^a-z])pin(?![\s_-]*code)/i` plus case-sensitive `/[a-z]Pin(?![\s_-]*[Cc]ode)/`; docs/05 updated.

## Q4 — Bounding boxes are viewport-relative
- **Context:** `boundingBox` in FieldRecord; spec gives `{x,y,w,h}` without a
  frame of reference.
- **Default chosen:** `getBoundingClientRect()` as-is (viewport coordinates), so
  boxes line up with the screenshot taken at the same moment.
- **Alternative:** add `scrollX/scrollY` for document coordinates.
- **Answer:** Extended — viewport rects, plus scroll offset on the state. Done: `scroll: {x, y}` on StateDraft.

## Q5 — Selector uniqueness uses the whole document, not the frame's form
- **Context:** `unique` flag and `fragile` demotion.
- **Default chosen:** `document.querySelectorAll(primary).length === 1` per
  content-script document (each iframe checks its own document).
- **Alternative:** scope to the closest `<form>` so duplicated ids in unrelated
  panels do not demote an otherwise-good selector.
- **Answer:** Extended — document scope stays, add form-scoped uniqueness too. Done: `selectors.uniqueInForm` (null without a form); note added when unique only within the form.

## Q6 — Hidden inputs and credentials in the DOM snapshot
- **Context:** docs/05 rule 1 rewrites `value` to `<n chars>`; rule 2 says
  credentials never reach storage. Neither says what the snapshot should show
  for `type=hidden` (CSRF tokens, session ids) or for credential controls.
- **Default chosen:** hidden inputs get `value="<hidden>"`; credential controls
  get `value="<redacted>"` with no length; everything else `<n chars>`.
- **Alternative:** drop hidden inputs from the snapshot entirely; or keep the
  `<n chars>` length for credentials too.
- **Answer:** Confirmed.

## Q7 — `pushState` patch lives in the MAIN-world hook, not the content script
- **Context:** docs/02 lists patched `pushState`/`replaceState` as a trigger
  and docs/01 puts triggers in `content/lib/observe.js`. The prototype patched
  `history` from the isolated world, which only intercepts the isolated world's
  own calls — the page's Angular router never went through it.
- **Default chosen:** patch in `net-hook.js` (MAIN world) and post a
  `{__mcadc:'nav', kind}` message that `observe.js` turns into `nav:pushState`.
  `popstate`/`hashchange` are real DOM events and stay in `observe.js`.
- **Alternative:** a second MAIN-world file (`main-world/nav-hook.js`) to keep
  `net-hook.js` single-purpose.
- **Answer:** Changed — own file `main-world/nav-hook.js`. Done; registered in the manifest after net-hook.js; docs/01 layout updated.

## Q8 — Net entries are posted after the response body is read
- **Context:** `fetch` bodies are read from a clone asynchronously so the page
  is never delayed. The NetDraft is therefore posted once the body arrives, not
  at response-headers time.
- **Default chosen:** one message per call, after the body. `startedAt` and
  `durationMs` are still measured from the call, so ordering can be recovered.
- **Alternative:** two messages (headers, then body) merged in the service
  worker.
- **Answer:** Extended — one message, plus a 5s body-read timeout. Done: `BODY_READ_TIMEOUT_MS = 5000`, body becomes `<body read timed out after 5000ms>`.

## Q9 — Visible errors participate in dedupe
- **Context:** docs/02 defines the signature as pathname + title + field keys
  and says a matching signature is discarded. docs/07 expects a deliberately
  triggered validation error to be captured in `errors`. On MCA the error
  appears without adding fields, so a literal reading would never capture it.
- **Default chosen:** the signature is exactly as specified (and exported), but
  dedupe also compares the joined visible `errors` list; a change in either
  produces a state.
- **Alternative:** fold errors into the signature string itself; or accept that
  errors are only seen when they coincide with a field change.
- **Answer:** Confirmed.

## Q10 — "Capture now" bypasses dedupe
- **Context:** the side panel's manual trigger exists for moments a trigger
  did not fire. If the signature is unchanged, dedupe would silently drop it
  and the user would see nothing happen.
- **Default chosen:** `manual` always stores a state, even if identical.
- **Alternative:** respect dedupe and show a "no change" toast in the panel.
- **Answer:** Extended — manual always stores, flagged as duplicate. Done: `duplicateOf: <previous state id>` on StateRecord, `duplicate` chip in the panel, noted in SUMMARY.md inventory. Worker tracks `lastErrorsKey` per tab:frame for the comparison.

## Q11 — Trigger attribution within a debounce burst
- **Context:** a click is followed by dozens of `dom-change` mutations before
  the 900ms debounce fires. Only one `trigger` string is stored.
- **Default chosen:** the first non-`dom-change` trigger in the burst is
  recorded with its own timestamp; `dom-change` is used only when nothing else
  fired.
- **Alternative:** the last trigger; or a list of all triggers in the burst.
- **Answer:** Extended — first non-dom-change, plus the full burst list. Done: `triggers: string[]` on StateDraft, consecutive repeats collapsed as `dom-change (x12)`, capped at 60 entries.

## Q12 — Transitions are tracked per tab *and* frame
- **Context:** docs/02 says "a previous state exists for the same tab". MCA
  embeds iframes, each with its own content script and document, so an edge
  from a top-frame state to an iframe state would compare unrelated field sets.
- **Default chosen:** last-state bookkeeping keyed by `tabId:frameId`; edges
  only join states from the same document. Net entries from an iframe fall
  back to the top frame's last state for `stateIdAtTime` if the iframe has none.
- **Alternative:** key by tab only and accept cross-frame edges.
- **Answer:** Confirmed — inferred links flagged. Done: `stateIdInferred: true` on NetEntry when an iframe's call was attributed to the top frame's state; shown in the HAR entry comment.

## Q13 — Extra bookkeeping keys and fields beyond docs/01
- **Context:** transitions and dependencies need a home, and the worker needs
  the last state per tab across restarts.
- **Default chosen:** `dc:transitions`, `dc:deps`, `dc:tabs` keys; `tabId` and
  `frameId` fields on StateRecord and NetEntry (kept in the export since they
  help correlate frames); counters in `dc:meta`.
- **Alternative:** fold transitions/deps into `dc:meta`; strip `tabId`/
  `frameId` at export.
- **Answer:** Confirmed.

## Q14 — Export writes data: URLs from the service worker
- **Context:** `chrome.downloads.download` needs a URL. MV3 service workers
  have no `URL.createObjectURL`, and the permission list in docs/06 does not
  include `offscreen`.
- **Default chosen:** base64 `data:` URLs built in the worker. Fine for JSON,
  HAR and PNGs; a very large DOM snapshot (many MB inflated) may be refused by
  Chrome. Failures are counted and reported, never fatal.
- **Alternative:** add the `offscreen` permission and write blobs from an
  offscreen document; or write DOM files gzipped (`.html.gz`) to keep them small.
- **Answer:** Changed — DOM exports stay gzipped as `.html.gz`. Done: written straight from storage as `application/gzip`; gunzip step removed; docs/03, README, SUMMARY.md and manifest warnings updated.

## Q15 — "Ask where to save" prompts once per file
- **Context:** docs/03 notes Chrome prompts per file unless the setting is off.
  With 60+ files that is unusable.
- **Default chosen:** `saveAs: false` on every download and a README step
  telling the user to switch off "Ask where to save each file before
  downloading" for the session.
- **Alternative:** detect the prompt storm (first download takes >5s) and abort
  with a panel message.
- **Answer:** Extended — saveAs false, uniquify, warn but never abort. Done: a download taking >5s sets `exportProgress.warning`; the panel shows it during and after export; README step added.

## Q16 — Field-map key vs signature key
- **Context:** docs/02 signature uses `id || name || formControlName || label`;
  docs/03 says the field map is keyed by "the most stable identifier". Those
  differ when an id is auto-generated.
- **Default chosen:** field map key order is formControlName → authored id →
  name → label; dependencies/transitions keep the signature key and are joined
  to map keys through a lookup table at export time.
- **Alternative:** use the signature key everywhere for simplicity.
- **Answer:** Confirmed — altKeys recorded. Done: `altKeys: string[]` on every FieldMapEntry (id, name, formControlName, label seen across states, minus the key).

## Q17 — Non-native dropdowns never produce a `change:` trigger
- **Context:** the `change` listener only fires for native `select`, radio and
  checkbox controls. If MCA V3 renders Angular Material `mat-select` or a
  custom listbox, choosing an option arrives as `click:<option text>` plus
  `dom-change`, so dependent-dropdown detection (which keys off `change:`)
  misses it.
- **Default chosen:** spec-literal triggers. The transition still records
  `optionsChanged` on native selects that reload, and the summary says when no
  dependencies were found.
- **Alternative:** treat `click:` on an element inside `[role="listbox"]` /
  `[role="option"]` as `change:<closest field key>`.
- **Answer:** Changed — custom listbox clicks become change triggers. Done: observe.js maps a click on `[role=option]`, `.mat-option`, `.mat-mdc-option`, `.ng-option`, `.dropdown-item`, `.select2-results__option` to `change:<owner field key>`, resolving the owner via aria-owns/aria-controls, then the field wrapper, then the listbox id.

## Q18 — Pause is also enforced in the worker, and drops in-flight entries
- **Context:** docs/04 says the content script checks the flag before building
  a StateRecord. Messages already in flight when Pause is clicked would still
  land.
- **Default chosen:** the worker re-checks `recording` before storing any
  state or net entry, so nothing arrives after Pause. Net entries are also
  dropped at the content script while paused.
- **Alternative:** accept in-flight entries so a paused session is exactly
  "everything up to the click".
- **Answer:**
