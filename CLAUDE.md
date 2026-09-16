# CLAUDE.md — build rules for this repo

You are building **MCA DOM Capturer**, a throwaway Chrome MV3 extension that
passively records the structure of MCA V3 pages while a human browses. Its output
feeds a later project (VCFO Assist) that pre-fills SPICe+ forms.

Read `docs/` in order before writing code. `docs/02-capture-spec.md` and
`docs/03-output-schema.md` are the contract — everything else supports them.

## How to work

- Build **all phases in `docs/06-phases.md` in one run**, without stopping to ask.
- Do **not** write tests. Do **not** try to run the extension. The human tests it
  manually after the whole thing is built.
- **Do** run `npm run check` at the end of every phase. It must pass before you
  start the next phase. This is a type gate, not a test — it costs nothing and it
  is the only thing standing between an unattended build and a folder of code
  that has never been parsed.
- After each phase, append a dated entry to `TASKS.md`: what you built, which
  files, what you deliberately left out.
- Whenever you make a judgement call the spec doesn't cover, append it to
  `QUESTIONS.md` with your chosen default and the alternative. Do not block on it.
  The human answers all of them at the end and you revise.
- Never delete `TASKS.md` or `QUESTIONS.md` history. Append only.

## Existing code in this folder

There is a prototype (`manifest.json`, `content.js`, `net-hook.js`,
`background.js`, `popup.html`, `popup.js`, `README.md`) from an earlier pass. It
works but is minimal. Treat it as **reference, not foundation**:

- Keep its field-extraction and label-resolution logic as a starting point.
- Keep its MAIN-world / isolated-world split — that pattern is correct.
- Restructure everything else per `docs/01-architecture.md`.
- Delete the old flat files once their logic has moved into `src/`.
- Rename the extension to **MCA DOM Capturer**.

## Hard rules — never violate

1. **The extension never acts on the page.** No clicking, no navigation, no form
   filling, no submitting, no captcha handling. It observes only. There must be
   no code path that calls `.click()`, `.submit()`, or sets a form value.
2. **No network egress.** The extension makes zero outbound requests. No
   analytics, no telemetry, no CDN fetches, no remote fonts. Everything is
   bundled locally.
3. **No dependencies.** Plain JavaScript with JSDoc types. The only devDependency
   is `typescript`, used for `tsc --noEmit`. No bundler, no build step — the
   folder loads directly as unpacked.
4. **Values are redacted at capture time**, never at export time. Redaction rules
   are in `docs/05-privacy.md` and are not negotiable.
5. **No secrets, credentials, or captured data are ever written into source
   files.** Captured data lives only in `chrome.storage.local`.

## Style

- ES modules where the MV3 context allows (service worker: `"type": "module"`).
  Content scripts are classic scripts — no imports. Use an IIFE and inline the
  helpers they need, or duplicate small helpers rather than reaching for a
  bundler.
- JSDoc on every exported function and every shared type.
- No class hierarchies. Plain functions and plain objects.
- Comments explain *why*, not *what*.
