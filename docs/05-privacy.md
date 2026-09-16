# 05 — Privacy and redaction

The person running this is logged into a live portal holding real directors' PAN,
DIN and passport data, including foreign nationals. Redaction is a correctness
requirement, not a nicety.

## Rule 1 — values are never stored

Every `input.value`, `textarea` content, and `contenteditable` text becomes
`<n chars>` where n is the original length. Length is kept because it helps infer
the expected format; the content is not.

This applies identically in:
- FieldRecord `value`
- The DOM snapshot — rewrite the `value` attribute and text node before gzipping
- Anything rendered in the side panel

There is no setting to turn this off. Do not add one.

## Rule 2 — credentials never reach storage at all

Skip entirely — do not even emit a FieldRecord — for any control where:
- `type` is `password`
- `id`, `name`, `formcontrolname` or label matches
  `/captcha|otp|passw|secret|token|mpin|(?:^|[^a-z])pin(?![\s_-]*code)/i` or
  the case-sensitive `/[a-z]Pin(?![\s_-]*[Cc]ode)/` (camel-case `userPin`).
  Postal "PIN code" fields are deliberately *not* matched (Q3).

Record their existence as a bare `{ type, label, redactedEntirely: true }` so the
structure is known and the content is not.

## Rule 3 — bodies are pattern-scrubbed

Request and response bodies get a regex pass before storage:

| Pattern | Replacement |
|---|---|
| `[A-Z]{5}[0-9]{4}[A-Z]` | `<PAN>` |
| `\b\d{8}\b` (DIN/DPIN shape) | `<DIN>` |
| `\b\d{4}\s?\d{4}\s?\d{4}\b` | `<AADHAAR>` |
| `[\w.+-]+@[\w-]+\.[\w.]+` | `<EMAIL>` |
| `\b(?:\+91[-\s]?)?[6-9]\d{9}\b` | `<PHONE>` |
| `[A-Z]{1}[0-9]{7}` (passport shape) | `<PASSPORT>` |

Names and addresses cannot be regexed. This is why the export manifest and
`SUMMARY.md` both state plainly that bodies need a human read before the file
leaves the machine. Do not claim the output is anonymised.

## Rule 4 — nothing leaves the machine

No outbound requests from any part of the extension. The only data movement is
`chrome.downloads` writing to the user's own disk. If a phase seems to need a
network call, it doesn't — raise it in `QUESTIONS.md` instead.

## Rule 5 — session data is disposable

"Clear session" wipes every `dc:` key including the per-state DOM and screenshot
keys. The README tells the user to remove the extension after export. Do not add
auto-backup, sync, or restore-on-reinstall.

## What the tool must never do

- Log captured content to `console` beyond counts and ids
- Write captured content into any file in the repo
- Persist anything outside `chrome.storage.local`
- Capture on any origin other than `mca.gov.in`
