# Paycheck Weathervane

> **A visual aid, not financial advice.** It shows where your money is going and when. It does not tell anyone what to do with their money.

A simple, offline, in-browser app (Chrome and other modern browsers) for people who were never taught how to manage money. It does three things:

1. **Records** pay, bills, subscriptions, debts, and goals, and lays them out paycheck by paycheck. You enter pay and due dates the way they happen. The app works out which paycheck covers each bill, including months with more than one (or three) paychecks.
2. **Teaches** as you go: plain-English hints on every field, facts computed from your own numbers, a "what changed" strip when you edit anything, and a short Learn library. Every lesson is labeled a fact, a named method, or a commonly quoted yardstick. Nothing says what to do.
3. **Answers questions through Claude.** The Ask Claude page builds a report (your numbers, already calculated, plus your question) to copy and paste into Claude. The report instructs Claude to start with "Assuming your numbers are correct, it seems to indicate..." and to describe, not advise.

## Privacy

- Everything stays in the browser (`localStorage`). A Content-Security-Policy blocks all network requests from the page.
- The report is built and copied only when you choose. The app makes a **best effort** at removing identifying information (generic labels instead of names, removal of long numbers, emails, links, and your own "always replace" list). **Always review the report before pasting it.** The Copy button stays disabled until you confirm you did.
- Each pay, bill, debt, and goal can have its own "name to use in reports". Data and settings has an "always replace" list for words like a bank name.

## Run it

Open `index.html` in a browser, or host this folder (for example with GitHub Pages). There is no build step and no dependencies.

## Files

| File | What it holds |
|---|---|
| `js/core.js` | dates, money (integer cents), schedule engine, groups |
| `js/model.js` | data model, paycheck/month engine, debt and goal math, what-ifs, example data |
| `js/charts.js` | donut, bars, progress (hand-drawn SVG) |
| `js/content.js` | teaching text, field explainers, glossary |
| `js/report.js` | question templates, the report for Claude, the scrub |
| `js/app.js` | views, forms, events |

Back up your data from **Data and settings**: it lives only in one browser on one device.
