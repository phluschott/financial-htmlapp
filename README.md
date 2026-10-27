# Paycheck Planner

> **1. It is only a visual aid** — it shows where your money is going and when, nothing more.
> **2. It is not financial advice.**

A paycheck-by-paycheck planner that runs in any browser. No server, no accounts, no network access.

It answers one question: **"I have a paycheck coming. What do I need to pay out of it, and what is left to play with?"**

## Use it

1. Open `index.html` in a browser (double-click it).
2. Follow the setup: your income schedule, your recurring bills / subscriptions / debt minimums / transfers, and any sinking funds.
3. The **Plan** page opens on the month with your **next paycheck highlighted**. Each paycheck is a card listing, in date order, everything that comes out before the following paycheck, with a running "left after" figure and a **Left to play with** total.

Bills land on the paycheck that precedes their due date. You can move, skip, or change any single occurrence. Add extra debt payments, transfers to savings, one-time bills, or sinking-fund moves to any paycheck. "Allocate what's left" turns the leftover into a line item.

## Saving your data

| Browser | How it saves |
|---|---|
| Chrome / Edge / Opera | **Choose app folder** once. The app autosaves `finance-data.json` into that folder and keeps timestamped copies in `backups/` (at most one every 10 minutes, newest 50 kept). You may be asked to re-grant access each visit. |
| Firefox / Safari / others | **Save file** downloads a timestamped `finance-data-<time>.json`. Next time use **Open a data file**. |

Both modes use the same file format.

## Encryption (optional)

Set a password during setup or in **Settings**. The data file is then encrypted with AES-256-GCM, with the key derived from your password using PBKDF2-SHA256 (600,000 iterations), via the browser's built-in Web Crypto. **There is no password recovery.** Only the data file is encrypted; the HTML/JS/CSS are ordinary readable files. A Content-Security-Policy blocks all network requests from the page.

## Export

**Settings → Export to spreadsheet (.xlsx)** writes the month shown on the Plan page (every paycheck and its line items), plus your recurring items, income, sinking funds and fund history. Exports are not encrypted.

## Notes

- Fixed income creates paychecks from its schedule. Mark one **Landed** when the money arrives; add variable or one-off income with **+ Extra income**.
- Changing an amount or price freezes past occurrences at their old value, so earlier months do not change. Deleting an item or income source removes it from past months too; mark it inactive to keep history.
- `finance-data*.json`, `backups/` and `*.xlsx` are git-ignored so personal data is never committed.

## Publishing a download page

The website lives in `docs/` (a static page plus the downloadable zip) so it can be served with GitHub Pages. The app itself is **not** served from there — people download the zip and open it locally.

```
python3 build.py          # builds docs/downloads/paycheck-planner-<version>.zip, SHA256SUMS and docs/index.html
python3 build.py --check  # confirms the page, SHA256SUMS and a fresh rebuild all agree
```

- The version comes from `VERSION` and must match `const VERSION` in `app.js` (the build fails otherwise).
- The zip is deterministic (sorted entries, fixed timestamps, stored uncompressed), so anyone can rebuild it from source and get the same SHA-256.
- To release a new version: bump both version numbers, run `python3 build.py`, commit `docs/`. Older zips stay in `docs/downloads/` and are listed in `SHA256SUMS`.
- The landing page template is `site/index.template.html`; the screenshot is `docs/assets/screenshot.png`.
- Enable Pages: repository **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/docs`**.
