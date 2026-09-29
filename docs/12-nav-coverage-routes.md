# 12 — Navigation, actions, API shapes, downloads, coverage, routes

Additions written after the first real captures. Where this conflicts with an
earlier doc, this wins. Version becomes **1.1.0**.

The first captures showed that a Flowprint export describes pages well and the
way between them badly. A consumer could see a table but not how to reach it,
could see that an API call happened but not the shape of what came back, and
had no way of knowing which parts of the site the recording never touched.
Everything below closes that, and all of it stays inside the hard rules in
`CLAUDE.md`: Flowprint still never acts on the page, still records nothing
without consent, still sends nothing anywhere, and still has no site-specific
code.

The typedefs named here live in `src/shared/schema.js` and are the contract.
If this prose and a typedef disagree, the typedef wins.

---

## B1 — Route identity

Single-page apps that route through the URL fragment (`/app/#/orders/list`)
have one pathname for every page. `pathname` alone therefore cannot identify a
page, and `url` (which strips the fragment) cannot either.

- `StateDraft.route` = `location.pathname`, plus `#` and the fragment's path
  part when the fragment starts with `#/` or `#!/`. Query strings, in either
  place, are never included. The result goes through `redact.scrubText`.
- `StateDraft.queryKeys` = the sorted, de-duplicated parameter **names** from
  `location.search` and from the fragment's query part. Never the values.
- `pathname` and `url` stay as they are for backward compatibility.
- Everything downstream that used `pathname` to mean "which page" uses `route`.

## B2 — View identity

A tab strip or a filter chip changes what a page shows without changing its
route or its form controls. Under the old signature such a change was deduped
away and never stored.

- `StateDraft.view = { key, active[] }`. `active` lists, per view group, the
  option currently selected. `key` is those pairs joined
  (`group=option|group=option`), plus the current pagination indicator when
  one exists (`page=2`).
- The signature becomes
  `[route, title, controlKeys.join('|'), view.key].join('::')`.
- Paging a list therefore produces a new state. `PaginationPattern` gains
  `current` (scrubbed text of the active page or the indicator, at most 40
  characters, `null` when unknown) so the key can include it.

## B3 — Navigation inventory

New content library `src/content/lib/nav.js`, exposed as `window.__FP.nav`.
It walks the document and every open shadow root, and returns a
`NavInventory`:

- **menus** — a flat list of `NavItem`, each with `path` (labels from the root
  of its menu down to itself). Sources: `nav`, `[role="navigation"]`,
  `[role="menubar"]`, `[role="menu"]`, `[role="tree"]`, `header`, `aside`,
  framework menu panels (Material, Bootstrap dropdowns, PrimeNG and similar,
  matched by ARIA role first and class shape second). Items that exist in the
  DOM but are collapsed are **included** with `visible: false`: a menu item
  the user never opened is exactly what coverage needs to know about. Overlay
  menus that only exist while open are picked up on the state captured while
  they are open; the export merges across states.
- **viewGroups** — `ViewGroup[]`: tab lists, segmented button groups, chip or
  pill filters, radio groups and selects that sit outside a form and above a
  list. Each option has text, selector, `active`, `disabled`, `visible`.
- **breadcrumbs** — scrubbed text of breadcrumb items, in order.

Caps: 300 menu items, 30 view groups, 40 options per group. All text is
scrubbed and capped at 80 characters. `href` values keep the path and the
fragment's path part only.

`lists.js` no longer needs to skip `nav` for correctness, but keeps doing so:
menus belong in the inventory, not in list patterns.

## B4 — Actions

Until now a click was stored as `click:<first 40 characters of its text>`.
That is not enough to repeat it.

- Every user click and every change event produces an `ActionDraft`, sent to
  the worker **at the moment it happens** as `MSG.ACTION`, independent of
  whether a state is captured afterwards. An action that leads to a deduped
  state is still recorded.
- An `ActionDraft` carries the clicked element's selectors (`ActionSelectors`:
  the usual primary, fallbacks, shadow path and stability, plus the ARIA role
  and accessible name), its label, `href`, `target`, `menuPath`, whether it
  sits in navigation, which view group it belongs to, whether it is a
  pagination control and which one, the selector of the list it sits inside
  when it is a row or a row's link, and the `danger` and `download` flags.
- The target is resolved with `closest()` on the same clickable selector as
  before, widened to `[role="link"]`, `[role="menuitemradio"]`,
  `[role="menuitemcheckbox"]`, `[role="treeitem"]`, `[role="row"]`, `tr`,
  `[tabindex]` and elements with a `cursor: pointer` computed style within
  three ancestors.
- Values are never part of an action. A `change` action names the control key
  and, for selects, radios and checkboxes that are **not** credential-shaped,
  the chosen option's visible text (scrubbed). Text inputs never reach here.
- The worker stores actions under `fp:actions` (cap 3000) as `ActionEntry`,
  adding id `act_0001`, `tabId`, `frameId`, `stateIdAtTime` and, once the next
  state lands in the same tab and frame, `resultStateId`.
- `StateRecord.actionIds` lists the actions between the previous state and
  this one. `Transition` gains `actionIds`, `actionId` (the one whose trigger
  matches the state's trigger, else the last), `routeChanged`, `viewChanged`
  and `viaNewTab`.
- The `trigger` string stays, unchanged, for backward compatibility.

**New tabs.** A click that opens a new tab used to end the chain (A8). The
worker now listens to `chrome.tabs.onCreated`, and when `openerTabId` is a tab
with a recorded state on a consented origin it remembers the link. The first
state in the new tab gets `openedFrom`, and an edge is written with
`viaNewTab: true`. No edge is written when the opener is unknown.

## B5 — API shapes

`network.har` keeps its 4000-character bodies. That is enough for a dropdown's
option list and not enough for a list endpoint. A parser needs the shape of
the whole response, not its first screen.

- The MAIN-world hook reads up to 2 MB of a text-like response, parses JSON
  when the content type or the first character says so, and computes a
  `JsonShape`: object keys, array lengths, value types, string lengths and a
  format guess. Array items are merged from the first 25 items, so optional
  keys are visible. Depth cap 8, 80 keys per object. It does the same for JSON
  request bodies.
- A string position becomes enum-like, and keeps its distinct `values`, only
  when it was seen at least 5 times with at most 8 distinct values, each at
  most 40 characters. Status codes and type labels survive; free text does
  not.
- The content script scrubs every key name and every enum value through the
  redaction packs before anything is stored.
- `NetDraft` gains `requestShape`, `responseShape`, `responseSize`,
  `bodyTruncated`, `disposition`, `dispositionExt` and `isDownload`.
  `NetEntry` gains `actionIdAtTime` (the last action in that tab in the 5
  seconds before the call started) and `hasFullBody`.
- A serialised shape over 12 000 characters is replaced by
  `{ t: 'truncated' }`.

**Full bodies are opt-in.** `SessionMeta.keepBodies` is `'shape'` by default.
When the user switches it to `'full'` in the panel, the hook also posts the
complete body (up to 1 000 000 characters), the content script pattern-scrubs
it, and the worker stores it under `fp:netbody:<netId>` rather than inside
`fp:net`. The export writes those to `api/bodies/`. The panel and the export
both say plainly that names, addresses and free text in full bodies cannot be
scrubbed automatically.

## B6 — Downloads

Flowprint saw download links and never saw downloads.

- The worker listens to `chrome.downloads.onCreated` and `onChanged`. A
  download is recorded only when recording is on, it was not started by
  Flowprint itself (`byExtensionId`), and either its URL or referrer is on a
  consented origin, or it is a `blob:`/`data:` URL and a consented tab
  recorded an action in the previous 15 seconds.
- `DownloadEntry` holds the URL kind, the scrubbed URL without query values
  (`null` for blob and data URLs), the query parameter names, MIME type, file
  extension, size, the tab, `stateIdAtTime`, `actionId`, and the matching
  `netId` when a captured call has the same URL.
- **The file name is never stored.** File names on portals carry names,
  account numbers and case numbers. `nameShape` stores its structure instead:
  every run of letters becomes `A{n}`, every run of digits `9{n}`,
  punctuation stays. `AB12_2024.pdf` becomes `A{2}9{2}_9{4}.pdf`.
- **The file's contents are never read or copied.**
- The MAIN-world hook wraps `URL.createObjectURL` and `window.open`, forwards
  the call unchanged, and posts a `blob` hint (MIME type and size) or an
  `open` hint (scrubbed URL, target). The worker keeps the latest hint per tab
  and attaches it to the next blob download or new tab.
- Stored under `fp:downloads`, cap 500.

## B7 — Storage and messages

New keys: `fp:actions`, `fp:downloads`, `fp:netbody:<netId>`.

New messages: `fp:action`, `fp:blob-hint`, `fp:window-open` (content to
worker); `fp:get-coverage`, `fp:set-keep-bodies` (panel to worker).

New `store.js` exports, used by the worker and by the export:

```
getActions(): Promise<ActionEntry[]>
addAction(draft, tabId, frameId, stateIdAtTime): Promise<ActionEntry>
patchActions(ids: string[], patch: Partial<ActionEntry>): Promise<void>
getDownloads(): Promise<DownloadEntry[]>
addDownload(entry: Omit<DownloadEntry,'id'|'seq'>): Promise<DownloadEntry>
patchDownload(id: string, patch: Partial<DownloadEntry>): Promise<void>
putNetBody(netId: string, text: string): Promise<boolean>
getNetBody(netId: string): Promise<string|null>
```

Clear session removes all of them (it already wipes by prefix). The
degradation ladder gains one step before "drop network entries": drop full
bodies.

## B8 — Export

New files in every per-origin package:

```
site-map.json      merged menu tree and pages, with visited flags
routes.json        how to reach every recorded page and view, step by step
api-catalog.json   one entry per endpoint: template, shapes, who calls it
actions.json       the full action log
downloads.json     the download log
coverage.json      what was visited, what was not, what is incomplete
RECIPES.md         the above, per section, written for a reader
api/bodies/        full scrubbed bodies, only when keepBodies was 'full'
```

Pure builders, one file each under `src/background/lib/`:

```
sitemap.js     buildSiteMap(states, actions, transitions, downloads, net, origin): SiteMap
routes.js      buildRoutes(states, actions, transitions, siteMap, origin): RoutesFile
apicatalog.js  buildApiCatalog(net, states, actions, origin): ApiCatalog
coverage.js    buildCoverage(siteMap, states, actions, downloads, origin): Coverage
recipes.js     buildRecipes(siteMap, routes, catalog, coverage, downloads): string
```

Rules:

- **Pages** are distinct routes. A page's **views** are the distinct
  `view.key` values seen on that route.
- **Menu nodes** merge across states by `path`. A node is `visited` when an
  action's `menuPath` equals its path, or an action's primary selector equals
  its selector, or a state exists whose route equals its `href`.
- **Routes** are found breadth-first over the transition graph from the entry
  state (the first logged-in state; the first state when none is logged in),
  using only edges that have an `actionId`, preferring fewer steps and then
  more stable selectors. Steps never include an action flagged `danger`. A
  page with no such path is listed with `reachable: false` and a note.
  `directUrl` is set only when that route was itself observed as a page load.
- **Endpoint templates** replace path segments that vary between calls, or
  that look like identifiers (all digits, UUIDs, hashes, anything a redaction
  pack matched), with `{id}`. `listPaths` names the arrays in the response
  that look like row data (objects, more than one item). `pagingParams` names
  request or query parameters that look like paging (`page`, `offset`,
  `limit`, `size`, `start`, `skip`, `cursor` and their obvious variants,
  matched on the key name only).
- **Coverage** lists unvisited menu nodes, unvisited view options per page,
  and per list whether it was paged, whether an item was opened, and whether
  a download was seen. `hints` are the same findings as plain sentences,
  most valuable first, capped at 30.

`flow-map.json` pages gain `route`, `viewKey` and `pageId`.
`manifest.json` counts gain `actions`, `downloads`, `pages`, `endpoints`, and
`redaction` gains `apiShapes` and `downloads`.

`AUTOMATION-BRIEF.md` gains four sections between "The flow" and "Pages and
their controls": **Site map**, **How to reach each page**, **API catalog**,
**Downloads**; and a **Coverage** section before "Known weak points". Section
numbers shift; "What I want automated" stays last.

### The skeleton

`docs/08` said every line of `playwright-skeleton.ts` ships commented out.
That is relaxed for navigation and reading, and kept for everything else:

- `goTo_<page>()` functions are live code: the recorded steps, each as a
  locator click followed by a wait for the expected route or heading.
- `readTable()`, `readRepeat()` and `paginate()` helpers are live code.
- Fills, and any click on a control flagged `danger`, stay commented.
- The header still says nothing here has been executed, that login is the
  human's job, and that selectors must be verified at run time.

## B9 — Side panel

- Two more counters: **Actions**, **Downloads**.
- A **Coverage** block, refreshed every 5 seconds while recording, showing for
  the active tab's origin: menu items visited out of seen, and the list of
  those not visited; for the page currently open, the view options not yet
  clicked, lists not yet paged, lists where no item was opened; and the first
  five hints.
- An Advanced checkbox, **Keep full API responses**, off by default, with the
  warning from B5 next to it.

The panel asks the worker (`fp:get-coverage` with `{ origin, route }`) and
renders what comes back. It computes nothing itself.

---

## Acceptance additions

- [ ] On a fragment-routed app, two pages with the same pathname produce two
      states with different `route`
- [ ] Switching a tab that changes only a table's rows produces a new state
- [ ] Clicking "next page" on a list produces a new state and an action with
      `pagination: true`
- [ ] Every click appears in `actions.json` with a selector that matches
      exactly one element in the corresponding `dom/` snapshot
- [ ] A collapsed menu's items appear in `site-map.json` with
      `visited: false` until clicked
- [ ] A 300 KB JSON response yields a `responseShape` naming every key of its
      row objects, while `network.har` still holds 4000 characters
- [ ] With "Keep full API responses" off, no `fp:netbody:` key is ever written
- [ ] A blob download appears in `downloads.json` with an extension, a
      `nameShape`, an `actionId`, and no file name anywhere in the export
- [ ] Flowprint's own export zip does not appear in `downloads.json`
- [ ] `routes.json` reaches every page that was reached by clicking, and no
      step is a `danger` action
- [ ] The panel's Coverage block names a menu item that exists and was not
      clicked
- [ ] Nothing in `src/` names a domain, and `npm run check` passes
