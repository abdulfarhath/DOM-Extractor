# 04 — UI specification

A side panel, not a popup. The user needs it visible while they browse so they
can see capture happening and hit "Capture now" when something didn't trip a
trigger. Register it with `chrome.sidePanel` and open on action click.

## Visual language

Match VCFO Suite so this feels like part of the same family. Inline all tokens in
`panel.css` — no remote fonts, no CDN.

```css
:root {
  --primary: #2563EB;
  --primary-hover: #1D4ED8;
  --bg: #F8FAFC;
  --surface: #FFFFFF;
  --border: #E2E8F0;
  --text: #0F172A;
  --text-muted: #64748B;
  --success: #0D9488;
  --waiting: #F97362;
  --danger: #E11D48;
  --radius: 0.875rem;
  --font: -apple-system, "Segoe UI", system-ui, sans-serif;
}
```

Dark mode via `@media (prefers-color-scheme: dark)` with the same cool
blue/slate family — never a warm or brown invert. Body text 14px, metadata 12px
in a monospace stack. White text on the blue primary, never navy on blue.

## Layout, top to bottom

1. **Header** — "MCA DOM Capturer", version, and a recording indicator: a filled
   dot in `--success` pulsing while recording, `--text-muted` when paused.
2. **Counters row** — three numbers with labels: Page states, Network calls,
   Screenshots. Tabular figures.
3. **Controls**
   - Pause / Resume recording (primary button, toggles label)
   - Capture now (secondary)
   - Screenshots on/off (checkbox)
4. **State list** — reverse chronological, the live feed. Each row:
   - Sequence number in mono
   - Page title, truncated to one line
   - Field count, and the trigger in muted 12px
   - A chip if the state has errors (`--danger`) or is new-fields-vs-previous
     (`--success`)
   - Clicking a row expands it to show headings, step labels, and the first ten
     field labels. No modal.
5. **Export block**, pinned to the bottom
   - "Export capture" primary button
   - During export, replace with a progress line: "Writing 14 of 63 files"
   - "Clear session" as a quiet text button with a confirm step
6. **Footer note** — 12px muted: values are never recorded; review network
   bodies before sharing; delete the extension when done.

## Empty state

Before the first capture: a short line explaining that recording is active and
they should just browse normally, plus the three things they should be sure to
walk — every section tab, the deliberate validation errors, and a resume-by-SRN
application. Not an illustration, just text.

## Behaviour

- The panel polls the service worker for stats every 1500ms while open. No
  push-based updates — simpler, and the panel is often closed.
- Never block the UI on a storage read. Render counters first, list second.
- The state list renders at most the latest 60 rows regardless of how many exist;
  the export contains everything.
- Pause must actually stop capture at the content-script level, not just hide it.
  The service worker holds the flag; content scripts check it before building a
  StateRecord.
