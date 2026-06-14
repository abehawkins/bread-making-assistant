# 🍞 Bread Making Assistant

Interactive step-by-step sourdough baking app. Pick a recipe, tap Start, check off steps; timed steps start a countdown automatically. Installable to your phone, works offline.

## Files
- `index.html` — app shell. Loads `styles.css` and `app.js`.
- `app.js` — the app logic. Loads recipes from `data/` at runtime.
- `styles.css` — styles.
- `data/index.json` + `data/<recipe>.json` — the 16 recipes (one file each).
- `sw.js`, `manifest.webmanifest`, `icon.svg` — PWA: offline + add-to-home-screen.
- `vercel.json` — static hosting config.
- `api/parse.js` — future AI import (paste/photo → recipe). Inactive until you add `ANTHROPIC_API_KEY`.

## Deploy
Import this repo at vercel.com (zero config — static site). Every push auto-redeploys.

## Timers
Timers are wall-clock based: if the screen locks or you switch apps, reopening the app shows the correct remaining time and rings immediately if it already finished. The +/− buttons adjust in 10-minute steps.

> Browsers pause JavaScript while a tab is fully closed, so alarms won't fire while the app is fully closed. The app catches up the moment you reopen it. True closed-app alarms would need web push notifications — a future add-on using the same `/api` serverless setup.

## Enable AI import later
1. In Vercel → Project → Settings → Environment Variables, add `ANTHROPIC_API_KEY`.
2. The importer can POST `{text}` or `{imageBase64}` to `/api/parse` and receive a ready recipe.
