# Session notes — Paycheck Planner (read this first next time)

Last updated: 2026-10-27. Repo: phluschott/financial-htmlapp. Work branch: `claude/jolly-edison-x3thm6` (restart it from latest `main` each session; earlier PRs #1 and #2 are merged).

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
- **v1.0.0 released** by the user (title "Visual Paycheck Planner v1.0.0"), asset hash `0da969691b4829e5388416291ba37be704147eb938df4473353e63a3a821746e`. Verified: release asset == SHA256SUMS == page.
- Repo is public. README merged to main.
- **GitHub Pages: user was to enable it** (Settings → Pages → main /docs). Not confirmed; check `https://phluschott.github.io/financial-htmlapp/` loads.

## Open to-dos
1. **Rename app to "Visual Paycheck Planner"** in the next release (files listed in RELEASING.md); bump version — never alter the published v1.0.0 zip.
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
