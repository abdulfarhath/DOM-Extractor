# START-HERE — what to paste into Claude Code

Drop this whole folder's contents into the existing `mca-recorder` folder, open
Claude Code in that folder, and paste the prompt below.

---

```
Read CLAUDE.md first, then every file in docs/ in numerical order.

Build the MCA DOM Capturer extension completely, all phases P0 through P9 in
docs/06-phases.md, in this one session. Do not stop to ask me anything.

Rules that matter most:
- No tests, and do not try to run the extension. I test it manually afterwards.
- Run `npm run check` at the end of every phase. It must pass before you move on.
- Append to TASKS.md after every phase.
- Append every judgement call to QUESTIONS.md with the default you chose. Keep
  going; don't block.
- The extension observes only. No code path may click, navigate, fill, or submit.
- No network egress from the extension, and no dependencies beyond typescript and
  @types/chrome as devDependencies.
- Field values are redacted at capture time, always.

The existing flat files in this folder are a working prototype. Reuse their
field-extraction and label logic and their MAIN-world/isolated-world split, then
delete them once the logic lives in src/.

When you're done, print a summary of what you built and what's in QUESTIONS.md.
```

---

## After it finishes

1. Read `QUESTIONS.md`, answer each one under **Answer:**, and tell Claude Code
   to revise accordingly.
2. Work through `docs/07-acceptance.md` yourself.
3. Record a full SPICe+ walkthrough.
4. Review network bodies for real names and addresses.
5. Send over the export folder — that's what the VCFO Assist context pack gets
   built from.
