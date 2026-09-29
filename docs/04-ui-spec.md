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
   export a progress line "Packing 14 of 63 files", then "Downloading
   flowprint-….zip…", then "Saved Downloads/flowprint-….zip"; "Clear session"
   as a quiet text button with a confirm step.
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

## Additions for docs/12 B9 — coverage, actions, downloads

Where this section and the text above disagree, this section wins.

### Counters

Six counters: Page states, Network calls, List patterns, Screenshots,
**Actions**, **Downloads**. Three across in two rows; six across in one row
from 560px. Three is the most a 320px panel holds without breaking a label in
two. A worker that does not send `actions` or `downloads` shows 0.

### Coverage block

Sits between the controls and the state list, inside the same scroll area as
the list. Two scroll areas stacked in a side panel leave neither enough room
to read, so the block and the list scroll together, and the block collapses
when the user wants the list.

- Shown only while the active tab's origin is consented. On any other tab it
  is hidden and nothing is asked of the worker.
- Header: an `h2` holding a real `<button>` with `aria-expanded` and
  `aria-controls`. A caret that turns and the word Hide or Show say which
  state it is in; colour says nothing on its own. Open by default. The state
  is remembered until the panel is closed and is not stored.
- Refreshed every `TIMING.COVERAGE_POLL_MS`, at once when the active tab's
  origin or route changes, and at once when the panel becomes visible again.
  Nothing is asked while `document.hidden`.
- The panel sends `fp:get-coverage` with `{ origin, route }` and renders the
  reply. `route` is built as in docs/12 B1: pathname, plus the fragment up to
  its `?` when the fragment starts with `#/` or `#!/`. It computes nothing
  else itself.

Contents, top to bottom:

1. **Summary**, one muted line: "7 of 22 menu items visited · 6 pages
   recorded · 1 of 3 lists paged · 2 downloads recorded". A total of zero
   seen reads "no menu items seen yet" or "no lists seen yet" rather than
   "0 of 0".
2. **On this page**: up to three labelled lists, then one line about
   downloads.
   - *Options not selected yet* — one item per view group, "Group: option,
     option". At most 8 options per group, then ", and N more". A group
     without a name is called "Options".
   - *Lists not paged yet* — only lists that have a pager. A list without one
     cannot be paged, and asking for it would send the user looking for a
     control that is not there.
   - *Lists where no item was opened*.
   - A list is named by its kind and its selector ("Table — #orders"). The
     selector is the only name a list has.
   - When the page has no entry: "This page has not been recorded yet. Click
     Capture now, above, to record it."
   - When nothing is left: "Nothing left to select, page or open on this
     page."
3. **Not visited yet**: unvisited menu items, each as its path joined with
   " › ". At most 12, then "and N more".
4. **Next steps**: the first five hints, as an ordered list, because the
   worker sends them most valuable first.

Sections with nothing in them are left out. When the menu list, the hints and
the page's findings are all empty, the block shows the summary and "Everything
seen on this site so far has been covered." and no lists.

When the worker does not answer, answers `{ ok: false }`, or has no pages for
this origin yet, the block shows one muted line: "Nothing to show yet. Use the
site normally — this fills in as pages are recorded." This is not an error and
is not styled as one. If the block already shows findings for this page and a
single reply goes missing, the findings stay.

Rendering: the reply is turned into plain sections, the sections are
serialised, and the DOM is replaced only when that string differs from the one
on screen. Collapse state lives outside the replaced content. Everything is
set with `textContent`; all of it comes from the recorded page.

### Keep full API responses

In the Advanced block, under "API responses": a checkbox, off by default,
reflecting `stats.keepBodies === 'full'`. Its warning is shown below it at all
times, not only when it is checked, and is tied to it with
`aria-describedby`:

> Full responses can contain names, addresses and other free text that cannot
> be scrubbed automatically. Leave this off unless the automation needs the
> actual values, and review the export before sharing it.

The warning is a bordered box with a `--waiting` edge and body-colour text.
If the worker does not confirm the change, the box goes back to what it was
and a flash line says so: showing it ticked while only shapes are kept would
be a false promise, and the reverse a false comfort.

### Degraded line

Gains "full API responses dropped" when `degraded.bodiesDropped` is true,
between "DOM snapshots off" and "network log trimmed", the order of the
ladder.

### State list rows

- The row shows `route` wherever it showed `pathname`, falling back to
  `pathname` for rows stored before 1.1.0.
- A non-empty view key is shown on a second line under the title, muted,
  12px monospace, its parts separated by " · ". One line with an ellipsis
  while the row is closed; wrapped in full once the row is expanded. Two
  states of one page differ only by this, so it has to be visible without
  expanding.

### Layout and focus

- The scroll area never goes below 140px. On a short panel with Advanced
  open, the panel itself scrolls rather than squeezing the list to nothing.
- `[hidden]` always wins over a block's own `display`.
- Every focusable element shows a 2px `--primary` outline on keyboard focus.
