# 05 — Privacy, consent and redaction

Flowprint runs on any site a user chooses, including ones holding other people's
personal data. These rules are correctness requirements.

## Rule 1 — consent before capture

Content scripts are declared for `<all_urls>` but exit immediately unless the
current origin is in `fp:origins`. Origins are added only by an explicit click in
the side panel, per origin, per session. Removing one stops capture at once.

There is no "record everything" mode. Do not add one.

## Rule 2 — values are never stored

Every `input.value`, `textarea` content and `contenteditable` text becomes
`<n chars>`. Length is kept because it helps infer format; content is not.

Applies identically in ControlRecord `value`, the DOM snapshot, list-pattern
samples, and anything rendered in the panel. No setting turns this off.

## Rule 3 — credentials never reach storage at all

Emit no value, and no length, for any control where `type` is `password`, or
where `id`, `name`, binding attribute, `autocomplete`, or label matches
`/captcha|otp|passw|passcode|mpin|secret|token|cvv|(?<![a-z])pin(?![a-z]|[\s_-]*code)/i`
or the case-sensitive `/[a-z]Pin(?![A-Za-z]|[\s_-]*[Cc]ode)/` (docs/11 F1).
The lookbehind keeps `LLPIN`, `CIN`-style identifier fields, `spinner`,
`pinned` and every postal `PIN code` spelling out; the camel-case pattern
brings `userPin` / `txnPin` back in. The case table in
`src/content/lib/redact.js` is the specification.

Record the **full ControlRecord** for such a control — `index`, `tag`, `type`,
`role`, `key`, `id`, `name`, `formControlName`, `dataAttrs`, `label`,
`labelSource`, `placeholder`, `ariaLabel`, `required`, `maxLength`,
`minLength`, `pattern`, `disabled`, `readOnly`, `visible`, `boundingBox`,
`classes`, `selectors`, `entry`, `group` — with `redactedEntirely: true` and
**no `value` key at all**: not `<n chars>`, not `<redacted>`; a password's
length is itself sensitive. A credential `select` also drops `options` and
`optionCount`. Nothing about a field's identity is sensitive; only its content
is, and a consumer needs the selector to leave the field to the human and to
wait for the state that follows (docs/11 F2).

Hidden inputs appear in the DOM snapshot as `value="<hidden>"` — CSRF and session
tokens are never stored.

## Rule 4 — bodies are pattern-scrubbed with pluggable packs

`generic` is always on:

| Pattern | Replacement |
|---|---|
| email address | `<EMAIL>` |
| E.164 / 10-plus-digit phone | `<PHONE>` |
| 13–19 digit run passing Luhn | `<CARD>` |
| `eyJ[A-Za-z0-9_-]{10,}\.` (JWT) | `<JWT>` |
| `Bearer\s+\S+`, `sk-[A-Za-z0-9]{16,}`, `AIza[0-9A-Za-z_-]{20,}` | `<TOKEN>` |
| IBAN shape | `<IBAN>` |

`india` auto-enables when a consented origin's host ends in `.in`, and adds PAN,
Aadhaar, DIN/DPIN, GSTIN, IFSC and Indian passport shapes. Other packs may be
added the same way later — one file, one exported array of `{name, pattern,
replacement}`.

DOM snapshots get the same pass: every text node, and every `title`, `alt`,
`aria-label` and `placeholder` value, is pattern-scrubbed in the clone
(inlined shadow roots included) before it is serialised.

Pattern boundaries are explicit lookarounds, not `\b`: `_` is a word character,
so `\b` misses an identifier inside a file name such as `..._ABCDE1234F_Notice.pdf`.

Names and addresses cannot be regexed, but the structure around them can
(docs/11 F6). Packs may add `keys` (JSON keys whose value is a name, an address,
a date of birth or a file name), `labels` (page text whose next value is one) and
`hints` (class or id tokens on the element that renders one). Anything they
redact is learned for the rest of the document and scrubbed wherever it recurs.
JSON bodies are walked structurally; truncated ones get the same rules pair by
pair. Timestamps (epoch milliseconds in 2000–2100, or seconds under a date-like
key) are kept: they are structure an automation needs, and the phone and card
patterns used to eat them.

This still misses names under unrecognised keys and in free text. The manifest,
the summary and the brief all state plainly that bodies need a human read before
the export leaves the machine. Never claim the output is anonymised.

## Rule 5 — nothing leaves the machine

No outbound requests from any part of the extension. The only data movement is
`chrome.downloads` writing to the user's own disk. If a phase seems to need a
network call, it doesn't — raise it in `QUESTIONS.md`.

## Rule 6 — disposable by default

"Clear session" wipes every `fp:` key including per-state snapshots and
screenshots. The README tells the user to remove the extension after export. No
auto-backup, no sync, no restore-on-reinstall.

## Never

- Log captured content to `console` beyond counts and ids
- Write captured content into any file in the repo
- Persist anything outside `chrome.storage.local`
- Capture on a non-consented origin, including subdomains not explicitly added
