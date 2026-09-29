# 11 — Redaction fixes

Three defects found in the first real capture
(`flowprint-www.mca.gov.in-2026-09-16T2039`). This doc supersedes the relevant
parts of `docs/05-privacy.md` and the earlier Q2 answer in `docs/09-resolved.md`.

Apply all three, run `npm run check`, append to `TASKS.md`.

---

## F1 — Credential regex matches `pin` inside unrelated words

### What happened

The MCA login page has a field labelled
`User ID, CIN, LLPIN, FCRN or Email ID`. It was classified as a credential and
stripped of its id, selectors and constraints.

Cause: the credential pattern matches `pin` inside `LLPIN`. The Q2 fix added
`(?:^|[^a-z])pin` for camel case, but that class matches the uppercase `L` in
`LLPIN`, so the case-insensitive branch still fires.

This is not cosmetic. `LLPIN`, `CIN` and `FCRN` appear on identifier fields across
every Indian statutory portal, so the most important field on a login page is the
one most likely to be destroyed.

### Fix

Single pattern, lookbehind rejecting any preceding letter:

```js
export const CREDENTIAL_PATTERN =
  /captcha|otp|passw|passcode|mpin|secret|token|cvv|(?<![a-z])pin(?![\s_-]*code)/i;
```

Drop the separate case-sensitive `[a-z]Pin` rule — the lookbehind covers it.

Lookbehind is supported in every Chrome version that supports MV3, so there is no
compatibility concern.

### Cases that must behave correctly

| Input | Credential? |
|---|---|
| `LLPIN`, `User ID, CIN, LLPIN, FCRN or Email ID` | no |
| `pinCode`, `Pin code`, `Pincode`, `pin-code`, `PIN Code` | no |
| `spinner`, `shipping`, `pinned` | no |
| `PIN`, `Pin`, `userPin`, `user_pin`, `login PIN` | yes |
| `mpin`, `MPIN` | yes |
| `otp`, `Enter the OTP`, `captcha`, `cvv`, `Password` | yes |

Add these as a comment block above the constant. They are the specification; a
future edit that breaks one is a regression.

---

## F2 — `redactedEntirely` discards structure, not just content

### What happened

A credential control is currently emitted as roughly
`{ type, label, redactedEntirely: true }`. Everything else is dropped: `id`,
`name`, `selectors`, `visible`, `required`, `maxLength`, position in the control
order.

That is more redaction than the privacy rule asks for, and it costs real
information. A consumer building automation needs to know a password field exists,
where it sits in the form, and how to find it — so it can leave the human to fill
it, and so it can wait for the page state that follows. Dropping the selector
means the field effectively vanishes from the site description.

Nothing about a field's identity is sensitive. Only its content is.

### Fix

Emit the full ControlRecord shape for credential controls, minus content:

**Keep:** `index`, `tag`, `type`, `role`, `key`, `id`, `name`, `formControlName`,
`dataAttrs`, `label`, `labelSource`, `placeholder`, `ariaLabel`, `required`,
`maxLength`, `minLength`, `pattern`, `disabled`, `readOnly`, `visible`,
`boundingBox`, `classes`, `selectors`, `entry`, `group`.

**Drop entirely:** `value` — absent, not `<n chars>`, not `<redacted>`. No length,
since a password length is itself sensitive.

**Add:** `redactedEntirely: true`.

For `select` controls classified as credentials — rare but possible — drop
`options` and `optionCount` too, since option text could carry the secret.

### DOM snapshot

Unchanged from the Q6 decision: credential controls keep `value="<redacted>"` with
no length, hidden inputs keep `value="<hidden>"`. Attributes other than `value` are
preserved, consistent with the above.

---

## F3 — `visible` is null on redacted controls

A consequence of F2, not a separate defect. Once credential controls carry the
full record, `visible` is computed like any other control. Verify it is `true` for
the login fields after the fix, and that `boundingBox` is populated.

---

## Downstream effects

- `flow-map.json` gains entries for credential controls. They must be included —
  a consumer needs to see them — but each carries `redactedEntirely: true` so
  nothing tries to bind a data source to them.
- `selectors.json` gains their selectors.
- `AUTOMATION-BRIEF.md` must state, in the constraints block, that fields marked
  `redactedEntirely` are for the human to fill and must never be automated.
- `SUMMARY.md` attention list: note the count of redacted controls, so a reader
  knows how many fields on the flow are human-only.

## Doc updates

- `docs/05-privacy.md` rule 3: replace the regex, and replace "record
  `{ type, label, redactedEntirely: true }`" with the keep/drop lists above.
- `docs/09-resolved.md` Q2 and Q3: append a note that F1 supersedes them.
- `docs/03-output-schema.md`: ControlRecord gains `redactedEntirely`.

## Acceptance additions

Append to `docs/07-acceptance.md`:

- [ ] Recapture the MCA login page. The field labelled
      `User ID, CIN, LLPIN, FCRN or Email ID` appears with a populated `id`,
      `selectors` and `maxLength`, and **is not** marked `redactedEntirely`
- [ ] The Password and OTP fields appear with `id`, `selectors` and `visible: true`,
      and **are** marked `redactedEntirely`, with no `value` key at all
- [ ] A field labelled `Pin code` is captured normally
- [ ] `flow-map.json` and `selectors.json` both contain the credential fields
- [ ] `SUMMARY.md` reports the redacted-control count


---

# F6–F8 — findings from a live income tax portal capture (2026-09-29)

A recording of a logged-in e-filing session was checked against what the
consuming project needed. It leaked, lost data, and missed a page.

## F6 — structural redaction

- A real PAN survived inside a document file name (`..._AST_<PAN>_Notice
  us 133(6)_....pdf.gz`): `\b` does not fire between `_` and a letter. Every
  identifier pattern now uses explicit lookarounds.
- Client names survived in bodies (`nameOfAssesse`, `userName`), DOM cards
  ("Name of Assessee" → value), a profile button (`span.userNameVal`), a
  tooltip, and a greeting ("Welcome Back, …"). Packs gained `keys`, `labels`
  and `hints` (see docs/05 rule 4); redacted values are learned per document
  and scrubbed where they recur. `notTokens` keeps structural keys
  (`formName`, `serviceName`, `bankName`) as data. Hints apply only to small
  elements (≤200 characters of text, ≤12 descendants), and icon ligatures
  (`expand_more`) and aria-hidden text are never learned.
- Every date in the bodies was destroyed: the portal sends epoch milliseconds,
  which the phone pattern rewrote as `<PHONE>` and the card pattern as `<CARD>`.
  Timestamps are now kept.
- Checked offline against 225 raw portal bodies and 12 DOM pages from an
  earlier capture: no PAN and no known name left, 913 timestamps kept.

## F7 — debounce ceiling

The state for a notice PDF click was triggered at 11:42:51 and stored at
11:43:25. Continuous mutations kept resetting the 900 ms debounce; the one
burst covered the notice view, the dashboard, the outstanding-demand page
and its two tabs, and ended on the dashboard, so none of those pages has a
state. A burst now fires at most 3 s after it began or after the route last
changed.

## F8 — write-shaped endpoints

Viewing a notice fired `PUT .../updateEntity`, which set the notice's read
flag. Nothing marked it. `api-catalog.json` gains `writeHint`; the brief
lists these calls and the summary counts them.
