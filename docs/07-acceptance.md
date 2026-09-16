# 07 — Acceptance checklist

For the human, after the build. Claude Code does not run this. Stop at the first
failure and report it back.

## Loads
- [ ] `npm install && npm run check` passes clean
- [ ] Load unpacked accepts the folder; no manifest or service-worker errors
- [ ] Toolbar icon opens the side panel
- [ ] On a random site, the panel shows "Record this site" and counters stay zero

## Consent
- [ ] Browsing any site without consenting produces **no** states
- [ ] Clicking "Record this site" reloads the tab and capture begins
- [ ] "Stop" halts capture immediately; counters freeze
- [ ] A second origin can be added in the same session and appears in the export

## Records — filling
- [ ] Loading a form page produces a state within a couple of seconds
- [ ] Typing does **not** create states; revealing a conditional field does
- [ ] Clicking between tabs adds states; clicking the same tab twice does not
- [ ] A deliberately triggered validation error produces a state with `errors`
- [ ] No password, OTP or captcha field has a stored value or length
- [ ] No control anywhere shows a real value — all are `<n chars>`

## Records — extracting
- [ ] On a page with a table, `lists.tables` has correct headers and row count
- [ ] On a page with repeated cards, `lists.repeats` has an item selector and
      per-slot sub-selectors
- [ ] Paging through a list records pagination selectors and a count change
- [ ] Sample text in list patterns is redacted, not real

## Exports
- [ ] Export writes one `flowprint-<host>-<stamp>.zip` that unpacks to the
      timestamped folder with all seven top-level files and the three subfolders
- [ ] Stems line up across `states/`, `dom/` and `screens/`
- [ ] `network.har` imports into DevTools' Network tab without error
- [ ] `flow-map.json` has one entry per unique control with `sourceField: null`
- [ ] `playwright-skeleton.ts` type-checks as TypeScript and has every fill line
      commented out
- [ ] `SUMMARY.md` reads sensibly cold; the attention list flags fragile selectors
- [ ] `AUTOMATION-BRIEF.md` makes sense to someone who has never seen the site
- [ ] A DOM file opens in a browser, is recognisably the page, values stripped

## Cleans up
- [ ] Clear session zeroes everything including consented origins
- [ ] Export after clearing produces an empty-but-valid manifest, not an error

## Then
Review network bodies for real names and addresses before sharing the folder.

## Addendum checks (docs/10)
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

## Redaction checks (docs/11)
- [ ] Recapture a login page with an identifier field labelled like
      `User ID, CIN, LLPIN, FCRN or Email ID`. It appears with a populated `id`,
      `selectors` and `maxLength`, and **is not** marked `redactedEntirely`
- [ ] The Password and OTP fields appear with `id`, `selectors` and `visible: true`,
      and **are** marked `redactedEntirely`, with no `value` key at all
- [ ] A field labelled `Pin code` is captured normally
- [ ] `flow-map.json` and `selectors.json` both contain the credential fields
- [ ] `SUMMARY.md` reports the redacted-control count
