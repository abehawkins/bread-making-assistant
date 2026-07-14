# 🍞 Recipe Assistant — Vercel site

*(Formerly "Bread Making Assistant" — expanded into a general recipe assistant; bread keeps its own section.)*

Interactive step-by-step recipe app. Pick a recipe, tap Start, check off steps; timed steps start a countdown automatically. Installable to your phone, works offline. Home screen groups recipes into two collapsible sections — **Bread & Baking** and **Recipes** — with a live search box across name and ingredients.

## Files
- `index.html` — the app (loads `data/index.json` + per-recipe JSON at runtime).
- `data/` — per-recipe JSON files, listed by `data/index.json`.
- `sw.js`, `manifest.webmanifest`, `icon.svg` — PWA: offline + add-to-home-screen.
- `vercel.json` — static hosting config.
- `api/parse.js` — future AI import (paste/photo → recipe). Inactive until you add `ANTHROPIC_API_KEY`.

## Deploy
Pushed to GitHub → import the repo at vercel.com (zero config). Every push auto-redeploys.

## Timers
Timers are wall-clock based: if the screen locks or you switch apps, reopening the app shows the correct remaining time and rings immediately if it already finished. The +/− buttons adjust in 10-minute steps.

> Note: browsers pause JavaScript while a tab is fully closed, so alarms won't fire in the background while the app is closed. The app catches up the moment you reopen it. True closed-app alarms would need web push notifications — a future add-on using the same `/api` serverless setup.

## Enable AI import later
1. In Vercel → Project → Settings → Environment Variables, add `ANTHROPIC_API_KEY`.
2. The importer can POST `{text}` or `{imageBase64}` to `/api/parse` and receive a ready recipe.
