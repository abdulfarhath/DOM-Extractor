# CLAUDE.md — build rules for this repo

You are building **Flowprint**, a Chrome MV3 extension that passively records the
structure and behaviour of any website while a human uses it, and exports a
package precise enough for an AI coding agent to write browser automation against
that site without ever having seen it.

It is site-agnostic. Nothing in the code may hardcode a domain, a language, a
country, or a specific project.

Read `docs/` in order before writing code. `docs/02-capture-spec.md`,
`docs/03-output-schema.md` and `docs/08-consuming-output.md` are the contract.

## How to work

- Build **all phases in `docs/06-phases.md` in one run**, without stopping to ask.
- Do **not** write tests. Do **not** try to run the extension. The human tests it
  manually afterwards.
- **Do** run `npm run check` at the end of every phase. It must pass before the
  next phase starts. This is a type gate, not a test, and it is the only thing
  between an unattended build and a folder that has never been parsed.
- After each phase, append a dated entry to `TASKS.md`: what you built, which
  files, what you deliberately left out.
- Any judgement call the spec doesn't cover goes in `QUESTIONS.md` with your
  chosen default and the alternative. Never block on one.
- `docs/09-resolved.md` holds decisions already made. Follow them; don't re-ask.

## Existing code in this folder

There is a working prototype (`manifest.json`, `content.js`, `net-hook.js`,
`background.js`, `popup.html`, `popup.js`). Treat it as reference:

- Keep its field-extraction and label-resolution logic as a starting point.
- Keep its MAIN-world / isolated-world split — that pattern is correct.
- Restructure everything else per `docs/01-architecture.md`.
- Delete the old flat files once their logic lives in `src/`.

## Hard rules — never violate

1. **Flowprint never acts on the page.** No clicking, navigating, filling, or
   submitting. No code path may call `.click()`, `.submit()`, or assign to a form
   control's value. It observes only.
2. **No capture without consent.** Recording is off on every origin until the
   user explicitly adds that origin. See `docs/05-privacy.md`.
3. **No network egress.** Zero outbound requests. No analytics, no CDN, no remote
   fonts. Everything bundled locally.
4. **No dependencies.** Plain JavaScript with JSDoc types. Only devDependencies
   are `typescript` and `@types/chrome`. No bundler, no build step — the folder
   loads directly as unpacked.
5. **Values are redacted at capture time**, never at export time.
6. **Nothing site-specific in code.** No domain literals, no English-only
   assumptions in label resolution, no country-specific patterns outside the
   pluggable redaction packs.

## Style

- Service worker is `"type": "module"` and uses real imports. Content scripts are
  classic scripts listed separately in the manifest, sharing a single namespaced
  global `window.__FP`.
- JSDoc on every exported function and shared type.
- Plain functions and plain objects. No class hierarchies.
- Comments explain why, not what.
