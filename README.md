# Flowprint

A Chrome extension that records how a website is built and how it behaves
while you use it normally — every form control with a stable selector, every
dropdown's options, what changes when you click Next, where the tables and
"next page" buttons are. It exports a folder that an AI coding agent can read
cold and write browser automation from, without ever having seen the site.

It never types, clicks or submits anything. It records nothing on any site
until you click **Record this site** for that site. Nothing it records leaves
your machine.

## What you need

- Google Chrome 116 or newer
- A site you are allowed to automate: your own account, your employer's
  system, a portal you are authorised on

You do **not** need Node or npm to run it. `npm run check` is only for the
build; the folder loads as-is.

## 1. Load it

1. Put this folder somewhere permanent — not Downloads — and do not move or
   rename it afterwards. Chrome reads it from this path every time.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (toggle, top right).
4. Click **Load unpacked** and pick this folder (the one with `manifest.json`).
5. It appears as **Flowprint**. A red error on the card means stop and report
   it.
6. Click the puzzle-piece icon in the toolbar and pin **Flowprint**.

## 2. Turn off per-file save prompts

An export writes 50–150 files. Chrome asks where to save *each one* unless you
switch that off:

1. Go to `chrome://settings/downloads`.
2. Switch **off** "Ask where to save each file before downloading".

Turn it back on afterwards if you like. If you forget, the export still runs;
the panel will tell you what is happening.

## 3. Record

1. Click the Flowprint icon. A side panel opens. Counters read zero and the dot
   is grey: nothing is being recorded.
2. Open the site you want to automate. The panel shows its address and a
   **Record this site** button. Click it. The tab reloads and the dot turns
   green. Only this site is recorded; other tabs and other sites are not.
3. Use the site normally. Log in yourself — your password, OTP and captcha are
   never recorded beyond "a password field exists here". Type real-looking
   data: what you type is replaced by its length (`<10 chars>`) the moment it
   is captured, so the content does not matter, but the fact that you typed
   does.
4. Make sure you:
   - walk **every step** of the flow you want automated,
   - trigger a **validation error** on purpose (leave a required field blank
     and click Next),
   - change any dropdown that reloads another one,
   - **page through** any list or table you want scraped, and open one item,
   - stop before anything irreversible: payment, final submission, signing.
5. Watch the panel. **Page states** climbs as you move. If a page did not
   register, click **Capture now**.
6. If the page embeds another site (a payment frame, an identity provider) the
   panel offers to record that too. Click **Record** next to it or leave it —
   either way the export says what it did not see.

**Pause** stops everything, including network capture, until you resume. The
**Screenshots** box turns page screenshots on and off. **Advanced** lets you
edit the list of words that mark a button as dangerous (submit, pay, confirm…)
and switch the India redaction pack on or off. It switches on by itself for
`.in` sites.

## 4. Export

1. Click **Export capture**.
2. The button becomes "Writing 14 of 63 files". Wait for it; about a minute.
3. Look in Downloads for `flowprint-<site>-<date>T<time>/`:

```
manifest.json           what was captured, counts, redaction, blind spots
AUTOMATION-BRIEF.md     the handoff document — read this, then fill in §10
SUMMARY.md              human overview with the attention list
flow-map.json           every unique control, selector, option list, the flow graph
selectors.json          flat { key: selector } map for code to import
playwright-skeleton.ts  commented-out shape, one function per page; not runnable
network.har             every fetch/XHR, bodies scrubbed; opens in DevTools
states/                 one JSON per page state
dom/                    one sanitised HTML per page state, values stripped
screens/                one PNG per page state (orientation only)
```

If you recorded more than one site in a session, the folder is
`flowprint-<date>T<time>/` with one sub-folder per site.

## 5. Review before sharing

Control values, passwords and captcha are never in the export. Network
response bodies **are**, because dropdown lists and lookups live in them. They
were scrubbed for emails, phone numbers, card numbers, tokens and — with the
India pack — PAN, Aadhaar, DIN, GSTIN, IFSC and passport shapes. **Names,
addresses and free text cannot be scrubbed automatically.**

Open `network.har` in a text editor, search for names and addresses you know
were on screen, and replace anything real. Then hand the folder over.

## 6. Hand it to a coding agent

1. Open `AUTOMATION-BRIEF.md` and fill in **§10 What I want automated**: which
   pages, which controls get values from where, what "done" looks like, what
   must stay manual.
2. Give the folder to the agent with:

   > Read AUTOMATION-BRIEF.md, then flow-map.json. Build <what you wrote>.

The brief carries the selectors, the flow, the reference data and the known
weak points, so the agent needs no exploratory page loads. Its §9 states the
constraints the automation must respect; they are part of the handoff.

## 7. Remove it

1. In the panel click **Clear session** → **Yes, clear**. This also forgets
   which sites you allowed.
2. `chrome://extensions` → **Remove** on Flowprint.
3. Turn "Ask where to save each file" back on if you want it.

Do not leave it installed. It is a one-session capture tool.

## For developers

- `npm install && npm run check` — type gate only (`tsc --noEmit` over JSDoc).
  No tests, no build step, no runtime dependencies.
- `docs/01-architecture.md` for layout and data flow; `docs/02`, `03` and
  `08` are the contract; `docs/09` and `10` hold settled decisions and
  post-first-build additions.
- `TASKS.md` is the build log; `QUESTIONS.md` holds every judgement call with
  the default taken.
- Content scripts are classic scripts sharing `window.__FP`; the worker and
  panel are ES modules. Redaction packs live in `src/content/packs/` — one
  file, registered on `window.__FP.packs`, listed in `manifest.json` before
  `redact.js`.
