# Flowprint end-to-end harness

This loads the real extension into Chromium. It then plays a person using a small
made-up filing portal, exports the recording, unzips it, and checks the export
against `docs/03-output-schema.md` and the "Acceptance additions" in
`docs/12-nav-coverage-routes.md`.

It lives outside `src/` and adds nothing to the extension. It needs no new
dependencies: it borrows `playwright-core` from another project on this machine
and uses the repo's own `typescript` for two checks.

## Run it

From the repo root:

```
node tools/e2e/run.mjs
```

A run takes about four minutes. It prints one line per check, then a summary. It
exits with `0` when nothing failed, `1` when any check failed, and `2` when the
harness itself could not run (for example, the extension did not load).

Useful options:

| Option | What it does |
|---|---|
| `--keep` | Keep the browser profile and the copy of the extension after the run (the export and results are always kept). |
| `--headed` | Show the browser window. Needs a display. If there is no `DISPLAY` and `xvfb-run` is installed, the harness re-runs itself under `xvfb-run`. |
| `--checks-only <run folder>` | Re-run only the checks over a folder from an earlier run. Use this after editing `checks.mjs`; it starts a fresh fixture for the replay. |
| `--pace <ms>` | Wait after each click (default 2500). The recorder waits 900 ms before capturing and stores at most one state every 2 s, so keep this at 2500 or more. |
| `--in-place` | Load the repo folder itself instead of a copy. By default the extension is copied at the start, so a file someone saves during the run cannot change what the browser loaded. |
| `--retry-load <n>` | If the extension does not load, wait 60 s and try again, up to n times. Useful while someone else is mid-edit in `src/`. |
| `--stub-missing` | If the manifest lists a content script that does not exist yet, put an empty file in the copy so the rest can still load. |
| `--no-proxy` | Do not send the browser through the egress proxy. The network check then relies on Playwright's request log alone. |

Environment variables:

- `PLAYWRIGHT_CORE`: path to `playwright-core/index.mjs`. The default is
  `/home/farhath/Documents/vcfo-suite/node_modules/playwright-core/index.mjs`
  (v1.62.1). The harness uses its bundled Chromium with `channel: 'chromium'`.
- `E2E_SCRATCH`: where run folders go. The default is
  `/tmp/claude-1000/-home-farhath/2322fc6a-7563-40b7-9707-8928bff02097/scratchpad/e2e/`.

## What a run leaves behind

Each run gets its own folder, `run-<date>-<time>/`:

- `results.json`: every check with its status, what it expected and what it
  found, plus all console output from the extension's worker, the panel and
  the fixture pages.
- `session.json`: what the "person" did: every click with its time and route,
  what was typed, storage samples, and the network log.
- `coverage-reply.json`: the worker's answer to the panel's coverage request.
- `export/`: the unzipped export.
- `downloads/`: the export zip and the two files the fixture downloads.
- `profile-*/`, `ext/`: only with `--keep`.

Every download stays in the run folder. The harness writes the download
folder into the new profile's settings before Chromium starts. Without that,
Chromium puts the export zip in `~/Downloads`. The check "every download
stayed inside the run folder" watches for that happening.

## What happens during a run

1. **Fixture.** `fixture/server.mjs` serves a single-page app at
   `http://localhost:<port>/portal/`. It is shaped like a government e-filing
   portal, with invented names. Try it by hand with
   `node tools/e2e/fixture/server.mjs 8765` (any user id and password work).
   `FIXTURE` in that file is the ground truth the checks compare against: the
   routes, the menus, which items are never clicked, the strings that must be
   redacted, and the file names that must never appear.
2. **Launch.** Chromium starts with a fresh profile and the extension loaded,
   in the new headless mode. The harness finds the service worker, opens the
   side panel's page in an ordinary tab, and sends the same messages the panel
   sends. It reads the message names from `src/shared/constants.js` at run
   time. The panel tab is told the fixture's tab is the "active" one, because
   automation cannot attach the real side panel.
3. **No consent.** The person browses two pages. Nothing may be recorded yet.
4. **Consent.** The person turns on the India redaction pack (the fixture is on
   localhost, so it would not switch on by itself) and adds the site. The
   worker reloads the tab.
5. **The session.** Real mouse clicks and key presses, never scripted clicks:
   - sign in
   - three kinds of menus
   - paging through a list
   - a link that opens a new tab
   - a Blob download and an attachment download
   - a tab and a filter chip above one table
   - two detail pages
   - a form with a validation error, a dependent select, a date and a file
   - a button inside a shadow root

   Keep-full-responses is switched on for a couple of calls and off again.
   Five menu items, one tab and one chip are never clicked. Submit is never
   pressed.
6. **Coverage and export.** The person returns to Proceedings and the harness
   asks for coverage the way the panel does. It then exports, waits for the
   export to finish, and unzips it. Last, it ticks the panel's own
   "Keep full API responses" box once, to test how the panel handles the
   worker's reply.
7. **Checks.** `checks.mjs` runs. The most important check is **REPLAY**. It
   opens a second, extension-free browser, signs in, and follows every
   reachable recipe in `routes.json`. For each step it finds the element by
   role and name, then by the primary selector, then by the fallbacks. After
   every step it checks the route and the heading.

## Reading the results

- **PASS**: the export shows what the check expects.
- **FAIL**: prints what was expected and what was found. A missing file or
  field is a FAIL with a message; a check never crashes the run.
- **SKIP**: the check could not be decided, and says why.

Some checks cover things the extension must not do:

- **Acting on the page.** The fixture's first inline script installs a
  detector. It records untrusted clicks, scripted `click()` / `submit()`
  calls, writes to form values, and values that change without trusted input.
  The only exceptions are the fixture's own deliberate acts, and the one step
  automation cannot do with real input: choosing a file. The detector must end
  the run empty.
- **Network egress.** The browser runs through a small proxy that records
  every host it tries to reach. Chromium contacts Google by itself, whatever
  the flags: sign-in, GCM, the component updater, time sync. So a second,
  extension-free Chromium with the same flags runs alongside the session.
  Hosts that it also contacts are reported as Chromium's own and do not fail
  the check. So do the well-known Chromium service domains (`google.com`,
  `googleapis.com`, `gvt1.com`, `gvt2.com`, `gstatic.com`), which fire on
  timers. Requests made by pages, content scripts and the extension's worker
  are held to the fixture's host only.
- **Redaction.** It searches every text file in the export, including the DOM
  snapshots, for:
  - the fixture's email, phone and tax-id patterns
  - the password and other text that was typed
  - the chosen file's name
  - both downloaded files' names

## Files

```
run.mjs            launches everything and plays the session
checks.mjs         the checks
fixture/server.mjs the fixture's server, its data, and FIXTURE (ground truth)
fixture/site/      the single-page app: index.html (with the detector), app.js, app.css
lib/proxy.mjs      the egress proxy
lib/preflight.mjs  explains why the extension would fail to load, before Chromium tries
lib/unzip.mjs      unzip, with a built-in fallback when the unzip command is missing
```
