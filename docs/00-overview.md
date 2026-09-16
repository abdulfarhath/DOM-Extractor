# 00 — Overview

## What this is

A Chrome MV3 extension, loaded unpacked, that a chartered-accountancy team member
installs temporarily. It watches the MCA V3 portal while they do a normal SPICe+
incorporation walkthrough and records everything a developer would need to later
automate form pre-fill: page structure, every form control, stable selectors,
dropdown option lists, network traffic, and the transitions between page states.

It is a **capture tool, not an automation tool.** It never touches the page.

## Why it exists

The downstream project, VCFO Assist, is a Chrome extension that pre-fills SPICe+
Part A and Part B from data already held in VCFO Suite. To build it, we need a
field map: every MCA form field paired with a stable selector and the VCFO field
it comes from. That map cannot be written from screenshots or from memory — it
has to come from the live, logged-in DOM.

Reading that DOM through an AI agent live is slow and expensive. Recording it
passively costs nothing and produces something exact.

## Who uses it

One person, once, for maybe two hours. They:

1. Load the extension unpacked.
2. Log into MCA V3 themselves.
3. Walk a full SPICe+ journey, stopping before payment.
4. Click Export.
5. Delete the extension.

Everything about the design follows from that: no onboarding, no settings, no
persistence beyond one session's worth of capture, no polish that doesn't serve
the export.

## What good output looks like

One folder on disk containing a page-by-page structural record, a HAR-shaped
network log, a draft field map, and a human-readable summary that a developer
(or Claude Code) can read cold and understand the SPICe+ flow without ever having
seen the portal.

## Non-goals

- Filling, submitting, or automating anything.
- Working on portals other than MCA. Income Tax, GST and TRACES are out of scope.
- Surviving a portal redesign. This is disposable.
- Being published to the Chrome Web Store.
