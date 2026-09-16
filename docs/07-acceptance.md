# 07 — Acceptance checklist

For the human, after the build finishes. Not for Claude Code to run — it does not
test. Work top to bottom; stop at the first failure and report it back.

## Loads

- [ ] `npm install && npm run check` passes with no errors
- [ ] `chrome://extensions` → Load unpacked accepts the folder with no manifest
      errors and no service-worker registration error
- [ ] Clicking the toolbar icon opens the side panel
- [ ] The panel shows zero counts and the empty-state text

## Records

- [ ] Opening `mca.gov.in` produces a first state within a couple of seconds
- [ ] Logging in produces new states; no state contains your password, and the
      password field appears as `redactedEntirely`
- [ ] The captcha field is likewise never captured with content
- [ ] Clicking between section tabs adds states; clicking the same tab twice does
      not
- [ ] Typing into fields does **not** create new states
- [ ] Revealing a conditional field **does** create a new state
- [ ] Network counter climbs as the portal makes calls
- [ ] Screenshot counter climbs, and pausing screenshots stops it

## Content is right

- [ ] Open the panel, expand a state on a real form page: field labels look
      correct and match what's on screen
- [ ] No field shows a real value anywhere — all are `<n chars>`
- [ ] A select field lists its real options
- [ ] Trigger a validation error deliberately; a state captures it in `errors`

## Exports

- [ ] Export writes a timestamped folder with `manifest.json`, `SUMMARY.md`,
      `field-map-draft.json`, `network.har`, and the three subfolders
- [ ] File stems line up across `states/`, `dom/` and `screens/`
- [ ] `network.har` opens in Chrome DevTools' Network tab import without error
- [ ] `SUMMARY.md` reads sensibly cold and its attention list flags at least the
      duplicate-id problem on the application-history page
- [ ] `field-map-draft.json` has one entry per unique field with `vcfoField: null`
- [ ] A DOM file opens in a browser and is recognisably the page, with values
      stripped

## Cleans up

- [ ] Clear session zeroes every counter and the state list
- [ ] After clearing, export produces an empty-but-valid manifest rather than
      throwing

## Then

Review the network bodies for real names and addresses, replace them, and send
the folder over.
