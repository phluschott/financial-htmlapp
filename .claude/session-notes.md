# Session notes — Visual Paycheck Planner (read this first next time)

Last updated: 2026-10-27. Repo: phluschott/financial-htmlapp. Work branch: `claude/jolly-edison-x3thm6` (restart it from latest `main` each session; earlier PRs #1 and #2 are merged).

## BOOKMARK — last place we worked on the app (2026-11-18)
- **v1.0.2 prepared and merged to `main`** (zip `visual-paycheck-planner-1.0.2.zip`, hash in `docs/downloads/SHA256SUMS`; release notes `releases/v1.0.2.md`). The user publishes the GitHub release manually (`gh release create` is blocked; tag `v1.0.2`, target `main`, attach the zip).
- v1.0.2 = **Next paycheck report** (button on the Plan page + per-card "Report" link; plain-text summary to copy/download; banner on the Plan page when the next paycheck lands today/tomorrow) + **Untracked** items (see below).
- Tangent in progress (separate from the app): a **Google Sheets version** so Claude can produce a report the day before each paycheck. Assessed in chat: needs Apps Script triggers (the Claude sidebar/add-on cannot schedule; "Claude Duet" was not found as a product name — the user has *Claude for Google Workspace* or the API-key *Claude for Sheets* add-on; ask which). Open questions asked: which Claude product, email vs in-sheet, whether Sheets replaces the app as the source of truth. The user then asked for the in-app "next paycheck report" instead and rolled out 1.0.2; the Sheets build has NOT been started. Keep any Sheets work in its own folder (e.g. `sheets/`) so it never changes the app files.
- User's unreleased dev zip (1.0.1-dev) is obsolete now that 1.0.2 shipped.

## What this is
A serverless, offline, single-folder browser app: **"I have a paycheck coming — what do I need to pay out of it, when, and how much is left to play with?"** Users download a zip (GitHub release v1.0.0), unzip, double-click `index.html`. Data lives in `finance-data.json` beside the pages.

**The user's two stressed messages (keep prominent everywhere):** (1) it is only a visual aid showing where money is going and when; (2) it is not financial advice.

## Product decisions the user made (don't relitigate)
- NOT an account ledger / bank dashboard. No account balances, no starting balances, no reconciliation, no spending log (all built in a prototype, then deliberately removed).
- Month view, split by paycheck; opens on the month of the **next paycheck, highlighted**. Each paycheck card covers [pay date, next pay date) so early-next-month bills land on the prior check.
- Payments listed **in date order** with running "left after"; "Left to play with" = income − committed.
- Bills autosuggest to the paycheck before their due date; user can move/skip/re-amount any occurrence. Credit-card style "varies" items: confirm amount each time. Extra debt payments, transfers to untracked destinations (free-text "goes to"), one-time bills.
- Sinking funds: no schedule; put in / pull back any time; balance = sum of moves; moves attach to a paycheck.
- Paid + Cleared checkboxes. Landed vs expected income kept visibly separate. Variable/extra income entered when it lands.
- Optional password (AES-256-GCM, PBKDF2 600k). Hybrid saving: File System Access API (Chrome/Edge) autosave + `backups/`, else download/open file. Export to .xlsx (hand-rolled zip, no libs).
- Fixed paychecks are assumed to arrive; "Landed" checkbox confirms.

## Code map
- `index.html` (CSP blocks all network), `style.css`, `app.js` (~900 lines, single IIFE, vanilla JS, cents as integers).
- `app.js` sections: utils → `occurrences()` schedule engine → state/DB (v2 schema: incomes, items, funds, occ{}, pays[], extras[], fundMoves[]) → `computeHeads`/`buildPlan` (paycheck "heads", lines, running balance) → crypto → storage (IDB handle, folder read/write, backups, download) → modal helper → forms → views → xlsx → actions/event delegation (`data-act` click, `data-chg` change).
- `build.py`: deterministic zip (stored, fixed timestamps) → `docs/downloads/paycheck-planner-<ver>.zip`, `SHA256SUMS`, and `docs/index.html` from `site/index.template.html`. `python3 build.py --check` verifies page/sums/rebuild. `VERSION` file must match `const VERSION` in app.js.
- `docs/` = GitHub Pages landing page + screenshot; download links go to the file on GitHub (`/raw/main/docs/downloads/...`). `package/USAGE.txt` goes in the zip. `releases/v1.0.0.md` = release notes.
- `RELEASING.md` = maintainer steps (incl. next-release to-do). `README.md` is public-facing.

## State at end of session
- **v1.0.0 released** by the user (v1.0.1 prepared 2026-11-17; the user publishes releases manually — `gh release create` is blocked) (title "Visual Paycheck Planner v1.0.0"), asset hash `0da969691b4829e5388416291ba37be704147eb938df4473353e63a3a821746e`. Verified: release asset == SHA256SUMS == page.
- Repo is public. README merged to main.
- **GitHub Pages: user was to enable it** (Settings → Pages → main /docs). Not confirmed; check `https://phluschott.github.io/financial-htmlapp/` loads.

## Shipped in v1.0.1 (merged to main; release published by the user)
- **"Charged to" for non-debt items (2026-11-17).** A subscription/bill/transfer/other can be charged to a debt item (e.g. Amazon Prime -> Amazon CC). It then has NO cash line of its own; its amount is added to that debt's next payment (charges dated after the debt's previous due date up to this due date), so it is never counted twice (the plan card's debt line shows "includes $168 payment + $16 Amazon Prime"). Data: `item.chargeTo` (debt item id) and `item.chargeSince` (set on change = day after the debt's last due date <= today, so finished cycles aren't rewritten). Setup table has a "Charged to" column; editing a debt line lets you edit each charged amount (needed for "varies" items). Code: `buildPlan` (debts/chargedOn), `itemForm`, `lineForm`, `chargedCell`, `rowHtml`, xlsx "Includes" column. Skipping a debt line also skips its charges (known limit). Items charged to a deleted/inactive/changed-category debt silently go back to direct cash lines. One-time "extras" cannot be charged to a debt yet.
- **Subscriptions box.** Fourth stat box on the Plan summary: total of all `Subscription` items falling due in the *calendar month* shown (`subscriptionsFor`), independent of paycheck windows, including ones charged to a card; skipped occurrences excluded; tooltip lists them. The category chips below are by paycheck window, so the two can differ.
- App renamed to "Visual Paycheck Planner" in 1.0.1 (zip is `visual-paycheck-planner-<ver>.zip`; the 1.0.0 zip keeps its old name and must never be altered). 1.0.1 hash `76c6a3bdc36447b97d142caf942a114b7d6292f039abd0c56515b57b258c3f38`. v1.0.0 data files open unchanged.

## Shipped in v1.0.2
- **"Untracked" items (2026-11-17).** A non-debt item can be set to *Untracked — paid from another account* (value `_untracked` in `item.chargeTo`, optional free-text `item.untrackedNote`, e.g. "Chase Visa"). It shows on the plan as a faded italic line with an "untracked" tag, no checkboxes and no running balance, and is NOT deducted from left / Going out / category chips / "N payments" (card header says "· N untracked"). It still counts in the calendar-month **Subscriptions box** (subtext "· N untracked"). Same `chargeSince` history protection as card charges (set to today when changed). Edit modal for such a line = amount + skip only. Export: Paid column says "Untracked", amount blank, Includes column notes it. Code: `isUntracked` in `buildPlan`, `itemForm`, `lineForm`, `rowHtml`, `chargedCell`, `subscriptionsFor`. The user named the option "Untracked" (we discussed "Paid elsewhere" first).
- v1.0.2 also adds the paycheck report: `reportText(h)` / `openReport(date)` / actions `report`, `report-next`, `report-copy`, `report-save`; `modal()` now takes an optional `cancel` label. Banner logic is in `viewPlan` (`soon`/`remind`). Report text sections: INCOME, PAYMENTS IN DATE ORDER, PAID FROM ANOTHER ACCOUNT (untracked), SKIPPED, LEFT TO PLAY WITH, HEADS-UP (runs short), NEEDS CONFIRMING, SUBSCRIPTIONS IN <MONTH>, disclaimer.

## Open to-dos
1. (Done in 1.0.1) rename to "Visual Paycheck Planner".
2. No LICENSE file; landing page says "Free". Ask the user which license.
3. Folder autosave (File System Access API) is **untested in a real Chrome/Edge** — headless Chromium can't do it. Ask user to try it; watch the permission re-grant flow and `reconnect`.
4. Known limits: items back-fill occurrences before their "next due date" (recurring schedule semantics); deleting an item/income removes it from past months (inactive keeps history; price changes freeze past amounts); same-day lines sort by name.
5. Ideas not requested: interest/yearly-cost view, multi-month export, print view.

## How the user likes to work
- Wants to **discuss before building**; says when to build. Keep it simple — the audience struggles with finances ("lowest common denominator"). Push back when scope drifts toward a ledger.
- Don't open PRs unless asked; they say "merge" explicitly. Commit messages need the Co-Authored-By/Claude-Session trailers from the session reminder.

## Environment gotchas
- Cloud container is ephemeral; push work. `gh release create` is blocked (HTTP 403) — user publishes releases manually. `github.com`/`raw.githubusercontent.com` are reachable via curl; some api.github.com paths are blocked by the proxy.
- Testing recipe: Playwright is preinstalled (`NODE_PATH=$(npm root -g) node script.js`); open `file:///home/user/financial-htmlapp/index.html`, load data with `page.setInputFiles('#filein', file)`; sample data = v2 JSON (see schema above). The old test scripts were in the scratchpad and are gone.
- Past bug class to remember: the encrypted-load path and the plain-load path validate differently — test both.
