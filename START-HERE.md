# START-HERE

Unzip this into the folder that holds the prototype, open Claude Code there, and
paste the prompt below.

---

```
Read CLAUDE.md first, then every file in docs/ in numerical order.

Build Flowprint completely — all phases P0 through P10 in docs/06-phases.md — in
this one session. Do not stop to ask me anything.

Rules that matter most:
- No tests, and do not try to run the extension. I test it manually afterwards.
- Run `npm run check` at the end of every phase; it must pass before you move on.
- Append to TASKS.md after every phase.
- Append judgement calls to QUESTIONS.md with the default you chose, and keep
  going. docs/09-resolved.md already answers a batch of these — follow it.
- Flowprint observes only. No code path may click, navigate, fill, or submit.
- Nothing site-specific in code: no domain literals, no English-only label logic,
  no country-specific patterns outside the redaction packs.
- No network egress, and no dependencies beyond typescript and @types/chrome.

The flat files in this folder are a working prototype. Reuse their field
extraction, label resolution, and MAIN-world/isolated-world split, then delete
them once the logic lives in src/.

When you're done, print a summary of what you built and what's in QUESTIONS.md.
```

---

## Using it afterwards

1. Answer anything in `QUESTIONS.md`, tell Claude Code to revise.
2. Work through `docs/07-acceptance.md`.
3. Record a session on whichever site you're automating.
4. Review `network.har` and the bodies for anything real before sharing.
5. Hand the export folder plus `AUTOMATION-BRIEF.md` to Claude and describe what
   you want automated. `docs/08-consuming-output.md` explains that handoff.
