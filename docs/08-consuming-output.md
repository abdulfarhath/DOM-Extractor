# 08 — Consuming the output

This doc defines `AUTOMATION-BRIEF.md`, the file that turns a capture into
working automation. It is generated at export and is the thing a user hands to a
coding agent together with the folder.

## What the brief must contain

Written so someone who has never seen the site can reason about it.

1. **Header** — origin, framework and version, when captured, how many states,
   whether the session was logged in.
2. **How to read this package** — one short paragraph per file: what
   `flow-map.json`, `selectors.json`, `states/`, `dom/`, `screens/`,
   `network.har` and `playwright-skeleton.ts` each hold, and which to reach for
   first. State plainly that `states/` and `flow-map.json` are ground truth and
   `screens/` is orientation only.
3. **The flow** — the transition graph rendered as prose: from each page, what was
   clicked, where it led, what appeared and disappeared. This is the section an
   agent actually reasons over.
4. **Pages and their controls** — per page, a table of control key, label, type,
   required, primary selector, stability.
5. **Reference data** — dropdown option lists, and the endpoints behind any that
   load from the server.
6. **Dependencies** — which control changes which, and via which call.
7. **List patterns** — for each: container, item selector, slots, pagination, and
   whether items link to downloads.
8. **Known weak points** — the attention list: fragile selectors, weak label
   sources, non-unique matches, duplicate ids, controls seen only once.
9. **Constraints for whoever writes the automation** — a fixed block, always
   included verbatim:

   > This capture is a description of a site, not permission to act on it.
   > Automation written from it must: use the user's own authenticated session
   > rather than storing credentials; leave login, OTP, captcha, payment,
   > signing and final submission to the human; never bypass a security control;
   > verify each selector at runtime and fail loudly rather than silently filling
   > the wrong field; and respect the site's terms of use. Controls marked
   > `redactedEntirely` in flow-map.json are for the human to fill and must never
   > be automated.

10. **What I want automated** — an empty section with a prompt line, for the user
    to fill in before handing the folder over.

## Handoff pattern

The user's workflow, which the README should describe:

```
1. Record the flow with Flowprint. Export.
2. Open AUTOMATION-BRIEF.md, fill in "What I want automated".
3. Give the folder to a coding agent with: "Read AUTOMATION-BRIEF.md, then
   flow-map.json. Build <what they wrote>."
```

The agent then has selectors, flow, reference data and failure points without a
single exploratory page load.

## Why the skeleton is commented out

`playwright-skeleton.ts` ships with every fill and click line commented. A capture
describes what a site looked like once; it is not validated automation. Handing
someone runnable code implies a guarantee the capture cannot make. Commented lines
give the correct shape and force a deliberate act to make anything run.
