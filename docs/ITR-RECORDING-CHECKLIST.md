# Recording the Income Tax e-filing portal

A walk-through for recording the Income Tax Department's e-filing portal with
Flowprint so a coding agent can write scrapers for e-Returns, e-Forms,
e-Challans, outstanding demands and e-Proceedings.

Menu names below are how the portal labelled them when this was written. If a
name has changed, follow what is on screen. Flowprint records whatever is
there.

## Before you start

1. Load Flowprint (README §1). Open the side panel.
2. Open the portal home page and click **Record this site**. The tab reloads.
3. Leave **Screenshots** on.
4. Decide about **Advanced → Keep full API responses**:
   - **Off** (the default) keeps only the shape of each API response: field names,
     types, list lengths. This is enough for an agent to write a scraper.
   - **On** keeps the actual responses, scrubbed for PAN, Aadhaar, phone and
     email, but names, addresses and notice text stay in. Turn it on only if
     the agent needs real sample values, and then only for a test PAN.
5. Log in yourself. OTP, password and captcha are never recorded.

Wait about 3 seconds after each click before the next one. Flowprint stores
at most one page state every 2 seconds.

## What to click

For every section, do the same four things:

- **Reach it through the menu**, not a bookmark. The menu path is what the
  agent will replay.
- **Click every tab and filter** on the page, one after another.
- **Go to page 2** of every table that has more than one page, and back.
- **Open one row** and **download one file** from it, if the page has
  downloads.

### e-Returns
- e-File → Income Tax Returns → View Filed Returns
- Open one return. Download the ITR-V / acknowledgement, and the filed form if
  offered.
- If an assessment-year filter is present, change it once.

### e-Forms
- e-File → Income Tax Forms → View Filed Forms
- Click each form tab or filter shown.
- Open one filed form and download its acknowledgement or PDF.

### e-Challans
- e-File → e-Pay Tax
- Click each tab: Saved Drafts, Generated Challans, Payment History (or
  whatever tabs the page shows).
- In Payment History, open one challan and download its receipt.
- Stop before **Pay Now** or anything that starts a payment.

### Response to Outstanding Demand
- Pending Actions → Response to Outstanding Demand
- Open one demand and view its details.
- Stop before **Submit** on any response.

### e-Proceedings
- Pending Actions → e-Proceedings
- Click **every** view the page offers: the self / other-PAN (authorised
  representative) switch, and the status tabs (for example "For your action",
  "For your information", "Closed"). Each combination you click becomes its
  own view in the export.
- Open one proceeding, view one notice, and download it.
- Stop before **Submit response** or any upload.

### Also worth a pass
- Dashboard, and Pending Actions → Worklist.
- Services and e-File menus, opened but not clicked, so their items are
  listed.

## While you record

The side panel's **Coverage** block lists what you have not done yet:
- menu items you have seen but not opened
- tabs and filters on the current page you have not clicked
- tables you have not paged
- tables where you have not opened a row

Work down its **Next steps** list until it only names things you do not want
automated.

If a page did not register (the Page states counter did not move), click
**Capture now**.

## Export and hand over

1. Click **Export capture**. The zip lands in Downloads.
2. Unzip it. Open `AUTOMATION-BRIEF.md`, go to the last section, **What I
   want automated**, and write what you want, for example:

   > Scrape every row of View Filed Forms for every tab, all pages, and
   > download each form's acknowledgement into a folder per assessment year.
   > I will log in myself; start once the dashboard is showing.

3. Give the folder to Claude Code with:

   > Read RECIPES.md, then AUTOMATION-BRIEF.md, routes.json and
   > api-catalog.json. Build what §"What I want automated" asks for, as a
   > Playwright script that attaches to my logged-in browser.

4. Before sharing the folder with anyone else, see README §4.

## What stays with you

Login, OTP, captcha, payment, e-verification and every final submission.
The export's constraints section says the same to the agent, and route
steps never include a button Flowprint flagged as dangerous.
