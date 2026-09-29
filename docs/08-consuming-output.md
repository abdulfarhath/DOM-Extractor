# 08 — Consuming the output

This doc defines `AUTOMATION-BRIEF.md`, the file that turns a capture into
working automation. It is generated at export and is the thing a user hands to a
coding agent together with the folder.

## What the brief must contain

Written so someone who has never seen the site can reason about it. Fifteen
numbered sections, in this order (docs/12 B8 added 4–7 and 12):

1. **Header** — origin, framework and version, when captured, how many states
   and pages (distinct routes), how many actions, endpoints and downloads,
   whether the session was logged in, and the coverage totals.
2. **How to read this package** — one short paragraph per file: `RECIPES.md`,
   `site-map.json`, `routes.json`, `api-catalog.json`, `actions.json`,
   `downloads.json`, `coverage.json`, `flow-map.json`, `selectors.json`,
   `states/`, `dom/`, `screens/`, `network.har`, `api/bodies/` and
   `playwright-skeleton.ts`, and which to reach for first: `RECIPES.md` for
   scraping and navigation, `flow-map.json` for forms. State plainly that
   `states/` and `flow-map.json` are ground truth and `screens/` is
   orientation only, and that `<UPPERCASE>` placeholders are redacted values
   to match as wildcards.
3. **The flow** — the transition graph rendered as prose: from each page, what was
   clicked (the recorded actions, by label and menu path), where it led, what
   appeared and disappeared. This is the section an agent actually reasons over.
4. **Site map** — the menu tree with the items never opened marked, and one row
   per page: route, states, views, view groups (tried/total), lists, endpoints,
   downloads.
5. **How to reach each page** — per page and view, the recorded steps from the
   entry state with the best locator for each, or why the page is not
   reachable by recorded clicks.
6. **API catalog** — one row per endpoint: template, calls, status, type, the
   arrays that hold rows, paging parameters, the routes it was called from.
7. **Downloads** — one row per download: kind, extension, MIME type, size,
   file name shape (never the name), URL without query values, and the action
   that triggered it.
8. **Pages and their controls** — per state, a table of control key, label,
   type, required, primary selector, stability.
9. **Reference data** — dropdown option lists, and the endpoints behind any that
   load from the server.
10. **Dependencies** — which control changes which, and via which call.
11. **List patterns** — for each: container, item selector, slots, pagination, and
    whether items link to downloads.
12. **Coverage** — what the recording saw and never exercised: menu items never
    opened, view options never selected, lists never paged or with no item
    opened. Everything listed is unknown territory; the agent should ask for
    another recording rather than guess.
13. **Known weak points** — the attention list: fragile selectors, weak label
    sources, non-unique matches, duplicate ids, controls seen only once, routes
    with redacted segments.
14. **Constraints for whoever writes the automation** — a fixed block, always
    included verbatim:

   > This capture is a description of a site, not permission to act on it.
   > Automation written from it must: use the user's own authenticated session
   > rather than storing credentials; leave login, OTP, captcha, payment,
   > signing and final submission to the human; never bypass a security control;
   > verify each selector at runtime and fail loudly rather than silently filling
   > the wrong field; and respect the site's terms of use. Controls marked
   > `redactedEntirely` in flow-map.json are for the human to fill and must never
   > be automated.

   followed, outside the block, by one line for what docs/12 made possible:

   > Downloads and API reads must run inside the user's own logged-in session
   > and must respect the site's rate limits. Never replay a click flagged
   > `danger`; routes never contain one.

15. **What I want automated** — an empty section with a prompt line and two
    example requests, for the user to fill in before handing the folder over.

## RECIPES.md

`RECIPES.md` (docs/12 B8) is the companion for scraping and navigation. It
says, page by page, how to reach the page from the entry state (every step
with its locators, best first, and what to expect after it), what to verify
on arrival, which views to iterate, which lists to read with which row, cell
and pagination selectors, which endpoints return the same rows and how they
page, which downloads were seen and what triggered them, and what the
recording never touched there. It is built from `site-map.json`,
`routes.json`, `api-catalog.json`, `coverage.json` and `downloads.json`, and
defers to them where they disagree.

## Handoff pattern

The user's workflow, which the README should describe:

```
1. Record the flow with Flowprint. Check the Coverage block in the side
   panel and open what matters before stopping. Export.
2. Open AUTOMATION-BRIEF.md, fill in "What I want automated".
3. Give the folder to a coding agent with: "Read AUTOMATION-BRIEF.md, then
   RECIPES.md, routes.json and api-catalog.json (or flow-map.json for
   forms). Build <what they wrote>."
```

The agent then has selectors, routes, API shapes, reference data and failure
points without a single exploratory page load, and knows which parts of the
site it has no information about.

## What in the skeleton is live, and why

`playwright-skeleton.ts` started out with every line commented out: a capture
describes what a site looked like once; it is not validated automation, and
handing someone runnable code implies a guarantee the capture cannot make.

docs/12 relaxes that for navigation and reading, and keeps it for everything
else:

- **Live:** `goTo_<page>()` functions built from `routes.json` (each recorded
  step is a locator click followed by a wait for the expected route or
  heading), and the helpers `locate()`, `arrived()`, `readTable()`,
  `readRepeat()`, `paginate()`, `forEachView()` and `captureDownload()`.
  Replaying a recorded click on a menu item, a tab or a pager changes nothing
  on the site, and a wrong selector fails loudly in `locate()` rather than
  pressing the wrong thing.
- **Commented:** every fill, and every click on a control flagged `danger`.
  Those change data, and a deliberate act is still required to make them run.
  Routes never contain a danger click in the first place.
- The header still says that nothing in the file has been executed, that
  login is the human's job, and that every selector must be verified at run
  time.
