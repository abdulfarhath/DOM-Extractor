# QUESTIONS

Append-only. Every judgement call the spec doesn't cover. Don't block — pick the
default, record it, keep building. The human answers after the build.

Decisions already settled live in `docs/09-resolved.md`. Check there before
adding a question.

## Q<n> — <short title>
- **Context:**
- **Default chosen:**
- **Alternative:**
- **Answer:** _(left blank for the human)_

---

## Q1 — Redaction packs are classic scripts, not ES modules
- **Context:** docs/05 says "one file, one exported array". Packs run in the
  content world, which cannot import.
- **Default chosen:** `src/content/packs/<name>.js` registers
  `window.__FP.packs.<name> = { name, rules }` and is listed in the manifest
  before `redact.js`. Adding a pack = one file + one manifest line + its name in
  `PACKS.ALL`.
- **Alternative:** ES module packs consumed only by the worker, with bodies
  scrubbed in the worker instead of at capture — rejected because rule 5 says
  redaction happens at capture time.
- **Answer:**

## Q2 — Camel-case credential names slip past `\bpin\b`
- **Context:** docs/05 rule 3 regex is fixed. `userPin`, `txnPin`, `mpin` do not
  match `\bpin\b` because there is no word boundary inside a camel-case token.
- **Default chosen:** regex used exactly as written in docs/05. `password`,
  `otp`, `captcha`, `cvv` etc. still match anywhere in the token.
- **Alternative:** add a case-sensitive `/[a-z]Pin(?![\s_-]*[Cc]ode)/` and
  `mpin` — the first build had this.
- **Answer:**

## Q3 — What "demote `#id` if it looks generated" means on React/Vue
- **Context:** docs/02 selector ranking. Ids that match the generated-id
  regexes are already rejected on every framework, so the React/Vue clause
  needs a stricter, framework-specific test to mean anything.
- **Default chosen:** on React/Vue an id containing any digit or shorter than
  three characters is moved below `[name]`, with a note. It stays a candidate.
- **Alternative:** reject such ids outright on React/Vue; or ignore the
  clause because the base rejection already covers it.
- **Answer:**

## Q4 — One key for signatures, edges and the flow map
- **Context:** docs/02 now puts `key` on every ControlRecord as "the identity
  used in signatures"; docs/09 Q16 says signatures keep their own key and the
  flow map joins through a lookup table.
- **Default chosen:** a single `key` computed once per control in the Q16
  order and used everywhere. The lookup table collapses to identity, so it is
  omitted; `altKeys` on the flow map still lists every other identifier seen.
- **Alternative:** keep a separate signature key (`id || name || binding ||
  label`) and the join table, at the cost of two identities per control.
- **Answer:**

## Q5 — Shadow-root traversal order in the control list
- **Context:** `queryDeep` returns light-DOM matches first, then each host's
  shadow matches in host order, so `index` is not strict document order when
  shadow roots are present.
- **Default chosen:** accept the approximation; `index` is only a tiebreak and
  the signature is order-sensitive but consistent across captures.
- **Alternative:** a full TreeWalker that interleaves shadow content at the
  host's position, at some cost per capture.
- **Answer:**

## Q6 — Pagination "next"/"prev" detection uses attribute and class names
- **Context:** docs/02 forbids English-only assumptions. `[rel=next]`,
  `[class*="next"]`, `[aria-label*="next" i]` are code-level conventions, not
  UI language, but a site with `class="suivant"` and no rel/aria would yield
  `next: null`.
- **Default chosen:** attribute/class conventions only; the block itself is
  still recorded with `style` so a consumer can inspect it.
- **Alternative:** also accept a single-arrow glyph (`›`, `→`, `»`) as the
  next control when nothing else matches.
- **Answer:**

## Q7 — Auth-hint word list
- **Context:** docs/02 `authHints` matches "login/logout/sign affordances" by
  text or href. Hrefs are conventionally English; visible text is not.
- **Default chosen:** English patterns plus a handful of common European
  equivalents (abmelden, déconnexion, cerrar sesión, sair …). `loggedIn` is
  `null` with an explanation when nothing matches, never a guess.
- **Alternative:** hrefs only, no text matching at all.
- **Answer:**

## Q8 — `change` on text inputs is ignored
- **Context:** docs/02 lists "Value change — capture-phase change listener —
  `change:<key>`" without restricting element kinds. Native text inputs fire
  `change` on blur, which would turn every field visit into a trigger and
  fight the "typing does not create states" rule.
- **Default chosen:** `change` triggers only for select, radio, checkbox, file
  and elements carrying a `role`. Text fields still surface through the
  signature/errors when they reveal something.
- **Alternative:** honour every `change` and rely on dedupe.
- **Answer:**

## Q9 — Net entries are gated on the sending frame's origin
- **Context:** docs/05 says never capture on a non-consented origin. A
  consented page calls APIs on other origins (CDNs, api.example.com).
- **Default chosen:** the gate is the origin of the *document* that made the
  call (`pageUrl`), not the request URL. Cross-origin API calls made by a
  consented page are recorded; calls made by a non-consented iframe are not.
- **Alternative:** also require the request URL's origin to be consented,
  which would drop most API traffic on split front/back-end sites.
- **Answer:**

## Q10 — Quota estimate as the 80% signal
- **Context:** A5 says degrade at 80% of estimated usage. With
  `unlimitedStorage` the estimate's quota is the disk-based browser quota,
  so 80% is reached only on a nearly full disk.
- **Default chosen:** `navigator.storage.estimate()` checked on every state
  add; a failed write also steps the ladder. No artificial ceiling.
- **Alternative:** a fixed soft ceiling (e.g. 1 GB of `fp:` data) tracked by
  summing stored sizes.
- **Answer:**

## Q11 — Multi-origin export layout
- **Context:** docs/03 says "grouped by origin when a session spans more than
  one" without a layout.
- **Default chosen:** one origin → `flowprint-<host>-<stamp>/` with the seven
  files and three folders at the root. Several → `flowprint-<stamp>/` with a
  small root `manifest.json` listing the origins and one complete package per
  origin in `<host>/`.
- **Alternative:** a single package with origin-prefixed stems and one merged
  flow map.
- **Answer:**

## Q12 — `playwright-skeleton.ts` declares its own `Page` type
- **Context:** docs/07 says the skeleton must type-check as TypeScript. An
  `import type { Page } from '@playwright/test'` fails unless Playwright is
  installed next to it.
- **Default chosen:** a minimal structural `type Page = { fill…; click…; … }`
  with a comment showing the one-line swap to the real import.
- **Alternative:** the real import and a note in the brief that it needs
  `npm i -D @playwright/test` to check.
- **Answer:**

## Q13 — Offscreen document is created per export and closed after
- **Context:** docs/09 Q14 adds the `offscreen` permission for blob URLs.
- **Default chosen:** created lazily at export start, every blob URL revoked
  after its download completes (or times out at 60s), document closed in
  `finally`. Export waits for each download to reach `complete` before the
  next, which also drives the Q15 prompt detection.
- **Alternative:** keep the document alive for the session; fire downloads
  without waiting and revoke on a timer.
- **Answer:**

## Q14 — docs/06 P0 permission list vs docs/09 Q14
- **Context:** docs/06 lists five permissions; docs/09 Q14 requires
  `offscreen`. docs/09 is the later, resolved decision.
- **Default chosen:** `offscreen` added; the other five unchanged.
- **Alternative:** none — flagged only so the manifest diff is expected.
- **Answer:**

## Q15 — Verification gaps against docs/02, 03, 08
- **Context:** P10 re-read. Everything named is produced. Extras beyond the
  spec: `triggers[]`, `scroll`, `usesShadowDom`, `opaqueRegions`,
  `captureDegraded`, `duplicateOf`, `blockedFrames` on StateRecord;
  `entry`, `file`, `uniqueInForm`, `shadowPath` on controls; `stateIdInferred`,
  `error` on NetEntry; `altKeys`, `collidesWith`, `entry` on flow-map
  controls; `containerSelector` on pagination; `rowSelector` and
  `shadowPath` on tables; `selector` on buttons. One naming choice: docs/02
  says `triggerTimestamp`, docs/03 says `triggerAt` — `triggerAt` is used
  because docs/03 is the output contract.
- **Default chosen:** keep the extras; they are all additive.
- **Alternative:** strip to the literal schema at export.
- **Answer:**
