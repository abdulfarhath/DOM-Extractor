# MCA DOM Capturer

A throwaway Chrome extension that watches the MCA V3 portal while you do a
normal SPICe+ walkthrough and records the *structure* of every page — form
fields, labels, selectors, dropdown options, network calls, and what changed
when you clicked things. It never types, clicks, or submits anything, and
nothing it records leaves your machine.

The export it produces is what the VCFO Assist field map gets built from.

## What you need

- Google Chrome (version 116 or newer)
- An MCA V3 login you are allowed to use
- About two hours

You do **not** need Node or npm to run the extension. `npm run check` is only
for the build; the folder loads as-is.

## 1. Load it

1. Put this folder somewhere permanent — **not** inside Downloads, and do not
   rename or move it afterwards. Chrome reads it from this path every time.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (toggle, top right).
4. Click **Load unpacked** and pick this folder (the one containing
   `manifest.json`).
5. The extension appears as **MCA DOM Capturer**. If it shows an error, stop
   and report it — do not continue.
6. Click the puzzle-piece icon in the toolbar and pin **MCA DOM Capturer** so
   its icon is always visible.

## 2. Turn off per-file save prompts

The export writes 50–100 files. Chrome asks where to save *each one* unless
you turn that off:

1. Go to `chrome://settings/downloads`.
2. Switch **off** "Ask where to save each file before downloading".

You can switch it back on after the export.

## 3. Record

1. Click the MCA DOM Capturer icon. A side panel opens showing three counters
   at zero and a green pulsing dot — that means it is recording.
2. Open `https://www.mca.gov.in` in the same window and log in as usual.
   Your password, OTP and captcha are never recorded; they show up in the
   capture only as "a password field exists here".
3. Do a complete SPICe+ walkthrough. Fill fields with plausible data — the
   values are replaced by their length (`<10 chars>`) the instant they are
   captured, so what you type does not matter, but *that* you typed does.
4. Make sure you:
   - open **every section tab** of Part A and Part B,
   - trigger a **validation error** on purpose on each form (leave a required
     field blank and click Next),
   - change the dropdowns that reload other dropdowns (State → District,
     activity → NIC code),
   - **resume an existing application by SRN** if you have one.
5. **Stop before payment.** The tool never clicks anything itself, but do not
   hand it a live transaction to watch either.
6. Watch the side panel. The "Page states" counter should climb as you move
   through the flow. If you land on a page and nothing new appears, click
   **Capture now**.

Pause / Resume stops recording entirely (including network calls). The
Screenshots checkbox turns page screenshots on and off; they help but are not
required.

## 4. Export

1. In the side panel click **Export capture**.
2. The button turns into "Writing 14 of 63 files". Wait for it to finish; it
   takes about a minute.
3. If the progress line says Chrome is asking where to save each file, go
   back to step 2 — the export keeps going, but you will be clicking Save
   for every file until you switch the setting off.
4. Look in your Downloads folder for `mca-capture-<date>T<time>/`. It contains:

```
manifest.json          what was captured, counts, redaction notes
SUMMARY.md             human-readable walkthrough — read this first
field-map-draft.json   one entry per unique field; vcfoField is null for you to fill
network.har            every fetch/XHR, openable in Chrome DevTools
states/                one JSON per page state
dom/                   one sanitised HTML per page state, gzipped (.html.gz)
screens/               one PNG per page state (if screenshots were on)
```

## 5. Review before sharing

Field values, passwords and captcha are never in the export. Network response
bodies **are**, because dropdown lists and lookups live in them. They were
scrubbed for PAN, DIN, Aadhaar, email, phone and passport shapes, but **names
and addresses cannot be scrubbed automatically**.

Open `network.har` in a text editor, search for the directors' names and the
registered office address, and replace anything real with placeholders. Then
send the whole folder over.

The `dom/` files are gzipped to keep them small. To look at one, gunzip it
(`gunzip 0007-spice-part-a.html.gz` on macOS/Linux, or 7-Zip on Windows) and
open the `.html` in a browser.

## 6. Delete it

1. In the side panel click **Clear session** → **Yes, clear**.
2. Go to `chrome://extensions` and click **Remove** on MCA DOM Capturer.
3. Turn "Ask where to save each file" back on if you want it.

Do not leave this installed on a machine that logs into MCA. It is a one-time
capture tool, not something to keep.

## For developers

- `npm install && npm run check` — type gate only (`tsc --noEmit` over JSDoc).
  There are no tests and no build step.
- Layout and data flow are in `docs/01-architecture.md`; the capture contract
  is `docs/02-capture-spec.md` and `docs/03-output-schema.md`.
- `TASKS.md` is the build log; `QUESTIONS.md` holds every judgement call with
  the default that was taken.
