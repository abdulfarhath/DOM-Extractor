# 09 — Resolved decisions

Answers to questions raised during the first build. These are settled — follow
them, don't re-ask. Numbering follows the original `QUESTIONS.md`.

**Q1 — Screenshots on iframes.** Confirmed: skip. A tab-level capture of an iframe
state is the parent page and would mislead.

**Q2 — Auto-generated id rejection.** Adopt the default, widened: reject
`/^(mat-|cdk-|ng-|ember|react-|:r|radix-)/i`, `/[-_:.]\d+$/`, and UUID/hash shapes.
Keep `address1`. Additionally, when the same pathname is captured more than once,
compare ids at export time and demote any that differ between captures — that is
the only real evidence of variance available.
_Note: the second-round Q2 (credential regex) is superseded by docs/11 F1._

**Q3 — `pin` matching postal codes.** Changed: use
`\bpin\b(?!\s*code)` and add `cvv`, `passcode`, `security code` to the credential
pattern. Over-redacting an address field loses useful structure for no safety gain.
_Superseded by docs/11 F1: the pattern is now
`(?<![a-z])pin(?![a-z]|[\s_-]*code)` plus a case-sensitive camel-case rule; see
`src/content/lib/redact.js` for the case table._

**Q4 — Bounding boxes.** Confirmed viewport coordinates, and additionally store
`scrollX`/`scrollY` on the state so document coordinates can be derived. Cheap,
and removes the ambiguity.

**Q5 — Selector uniqueness scope.** Changed: check uniqueness against the whole
document **and** against the closest `<form>` or `[role="form"]`, storing both. A
selector unique within its form but not the document is `likely`, not `fragile` —
that distinction matters on portals with repeated panels.

**Q6 — Hidden inputs and credentials in the snapshot.** Confirmed:
`value="<hidden>"` for hidden inputs, `value="<redacted>"` with no length for
credential controls, `<n chars>` for everything else.

**Q7 — Where the `history` patch lives.** Confirmed: MAIN world. An isolated-world
patch never sees the page router's calls, which is why the prototype missed SPA
navigation. Fold it into `main-world/hooks.js` rather than a second file.

**Q8 — Net entries posted after the body.** Confirmed: one message per call, after
the body, with `startedAt` and `durationMs` measured from the call so ordering is
recoverable. Never delay the page.

**Q9 — Errors in dedupe.** Changed and now in spec: signature stays as defined,
but dedupe also compares the joined visible `errors` list. A validation message
that adds no fields must still produce a state.

**Q10 — Manual capture bypasses dedupe.** Confirmed: `manual` always stores. The
button exists precisely for moments the triggers missed something.

**Q11 — Trigger attribution in a burst.** Confirmed: first non-`dom-change`
trigger wins, with its own timestamp; `dom-change` only when nothing else fired.

**Q12 — Transitions per tab and frame.** Confirmed: key bookkeeping by
`tabId:frameId`; edges never cross documents; iframe net entries fall back to the
top frame's last state.

**Q13 — Extra bookkeeping keys.** Confirmed, renamed to the `fp:` prefix:
`fp:transitions`, `fp:deps`, `fp:tabs`, `fp:meta`, `fp:origins`. Keep `tabId` and
`frameId` in the export — they help correlate frames.

**Q14 — Export writes data URLs.** Changed: add the `offscreen` permission and
write blobs from an offscreen document. Base64 data URLs will fail on large DOM
snapshots, and a partial export is worse than one extra permission. Keep the
failure counter regardless.

**Q15 — Save prompts.** Confirmed: `saveAs: false` plus a README step telling the
user to turn off "Ask where to save each file before downloading". Additionally,
if the first download takes over five seconds, show a panel hint pointing at that
setting rather than continuing silently.

**Q16 — Flow-map key vs signature key.** Confirmed: map key order is automation
attribute → framework binding → authored id → name → label; signatures keep their
own key; join through a lookup table at export.

**Q17 — Non-native dropdowns.** Changed and now in spec: treat a click inside
`[role="listbox"]` or `[role="option"]` as `change:<closest control key>`. Custom
selects are the common case on modern portals, so missing their cascades would
gut the feature.

**Q18 — Pause enforcement.** Confirmed: enforced in both content script and
worker; in-flight entries dropped. Pause should mean paused.
