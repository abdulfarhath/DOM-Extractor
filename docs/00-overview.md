# 00 — Overview

## What Flowprint is

A Chrome MV3 extension, loaded unpacked, that records how a website is built and
how it behaves while a human uses it normally. It produces an export package that
an AI coding agent can read cold and use to write browser automation against that
site — form filling, scraping, multi-step flows — without ever having seen it.

It is a **capture tool, not an automation tool.** It never touches the page.

## The problem it solves

Writing browser automation means answering questions a screenshot cannot: what is
the stable selector for this field, which dropdown reloads which other one, what
actually changes when you click Next, what shape is the row in this table, where
does pagination live. Asking an AI agent to explore a site live is slow and
expensive. Reading it from screenshots produces parsers that break, because the
markup never matched what the eye saw.

Flowprint records the answers passively, at zero token cost, while you just use
the site.

## Two shapes of work it supports

**Filling** — a multi-step form or wizard. Output centres on the flow map: every
control, its selector, its validation, and the transitions between states.

**Extracting** — lists, tables, repeated cards, paginated results, downloads.
Output centres on list patterns: the repeat container, the per-item sub-selectors,
and the pagination controls.

Most real automation needs both, so both are always captured.

## Who uses it

Anyone building automation against a site they legitimately use — their own
account, their employer's systems, a client portal they're authorised on. Sessions
are short: install, record the flow once, export, uninstall.

## Design consequences

- **Consent-gated.** Records nothing anywhere until the user adds an origin.
- **Site-agnostic.** No domain, language, or country is assumed anywhere in code.
- **Disposable.** No accounts, no sync, no cloud, no persistence past a session.
- **Honest about redaction.** Values are stripped; free text in network bodies is
  pattern-scrubbed but never claimed to be clean.

## Non-goals

- Performing, replaying, or scheduling automation.
- Credential storage or session sharing.
- Defeating bot protection, captchas, or rate limits.
- Publication to the Chrome Web Store.
