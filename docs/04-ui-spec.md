# 04 — UI specification

A side panel, not a popup — the user needs it visible while browsing.

## Visual language

Inline all tokens in `panel.css`. No remote fonts, no CDN.

```css
:root {
  --primary: #2563EB; --primary-hover: #1D4ED8;
  --bg: #F8FAFC; --surface: #FFFFFF; --border: #E2E8F0;
  --text: #0F172A; --text-muted: #64748B;
  --success: #0D9488; --waiting: #F97362; --danger: #E11D48;
  --radius: 0.875rem;
  --font: -apple-system, "Segoe UI", system-ui, sans-serif;
}
```

Dark mode via `prefers-color-scheme` in the same cool blue/slate family. Body 14px,
metadata 12px monospace. White on the blue primary, never navy on blue.

## Layout, top to bottom

1. **Header** — "Flowprint", version, recording dot: filled `--success` and
   pulsing while recording, `--text-muted` when paused or not consented.
2. **Origin bar** — the active tab's origin. If not consented: a prominent
   "Record this site" button plus one line explaining that nothing is captured
   until clicked, and that the tab reloads. If consented: the origin with a small
   "Stop" affordance, and a count of other consented origins this session.
3. **Counters** — Page states, Network calls, List patterns, Screenshots.
   Tabular figures.
4. **Controls** — Pause/Resume, Capture now, Screenshots toggle, and a collapsed
   "Advanced" block holding the danger-word list and redaction pack toggles.
5. **State list** — reverse chronological. Each row: sequence in mono, page title
   truncated to one line, control count and trigger in muted 12px, a chip for
   errors (`--danger`), new controls (`--success`), or list patterns found
   (`--primary`). Clicking expands inline to show headings, step labels, the first
   ten control labels, and any list pattern found. No modal.
6. **Export block**, pinned to the bottom — "Export capture" primary; during
   export a progress line "Writing 14 of 63 files"; "Clear session" as a quiet
   text button with a confirm step.
7. **Footer** — 12px muted: values are never recorded; review network bodies before
   sharing; remove the extension when done.

## Empty state

Before the first capture, once consented: a short line saying recording is active
and to use the site normally, plus three prompts — walk every step of the flow,
trigger a validation error on purpose, and page through any list you want scraped.

## Behaviour

- The panel polls the worker for stats every 1500ms while open. No push updates.
- Never block the UI on a storage read. Counters first, list second.
- The list renders at most the latest 60 rows; the export contains everything.
- Pause is enforced in both places: content scripts check before building a state,
  and the worker re-checks before storing, so nothing in flight lands after the
  click.
