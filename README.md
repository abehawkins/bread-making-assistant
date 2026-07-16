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

## reMarkable 2 Integration (Wireless Sync & Notes Backup)
We have added fully integrated uploader tools and backup utilities for the reMarkable 2 e-ink tablet.

### Added Files
*   [send_to_remarkable.py](file:///c:/Users/abeha/Documents/BreadMaker/Bread%20Making%20Assistant/vercel-site/send_to_remarkable.py) — Compiles Supabase/local recipes into ReportLab PDFs and uploads them directly to the tablet.
*   [run_local_server.py](file:///c:/Users/abeha/Documents/BreadMaker/Bread%20Making%20Assistant/vercel-site/run_local_server.py) — A local bridge server that hosts the web app locally and handles wireless uploads from your phone.
*   [download_raw_notes.py](file:///c:/Users/abeha/Documents/BreadMaker/Bread%20Making%20Assistant/vercel-site/download_raw_notes.py) — Downloads raw vector drawings (`.rm` strokes) from the tablet via SFTP.
*   [convert_notes_to_pdf.py](file:///c:/Users/abeha/Documents/BreadMaker/Bread%20Making%20Assistant/vercel-site/convert_notes_to_pdf.py) — Parses downloaded vector files and compiles them into clean, multi-page local PDFs.

---

### Networking & Implementation Hurdles

#### 1. On-Device PDF Rendering Timeouts
*   **Hurdle:** Downloading notes as PDFs via the tablet's built-in web API frequently fails with `408 Request Timeout` because the tablet's CPU takes too long to render heavy hand-drawn vector files to PDF.
*   **Solution:** We bypass on-device rendering entirely. [download_raw_notes.py](file:///c:/Users/abeha/Documents/BreadMaker/Bread%20Making%20Assistant/vercel-site/download_raw_notes.py) downloads raw binary `.rm` files via SFTP (over SSH) in seconds, and [convert_notes_to_pdf.py](file:///c:/Users/abeha/Documents/BreadMaker/Bread%20Making%20Assistant/vercel-site/convert_notes_to_pdf.py) compiles them into PDFs locally on your computer/laptop using `rmc` and `svglib`.

#### 2. Web Interface Restricted to USB
*   **Hurdle:** The tablet's local web server on port 80 only listens on the USB interface (`10.11.99.1`) and is unreachable over WiFi.
*   **Solution:** We bridge the connection over WiFi (`192.168.1.55`) using a secure local SSH tunnel, forwarding local port `8080` to the tablet's internal port `80` over port `22`.

#### 3. USB Interface Down When Unplugged
*   **Hurdle:** When the USB cable is unplugged, the tablet's network interface goes down. The tablet's operating system blocks all traffic to `10.11.99.1` even internally, breaking the SSH tunnel.
*   **Solution:** Upon establishing the SSH connection, the script automatically executes `/sbin/ip addr add 10.11.99.1/32 dev lo` on the tablet. This assigns the USB IP to the loopback interface, restoring internal routing and making the web server reachable wirelessly.

#### 4. Browser Mixed Content Blocks
*   **Hurdle:** Public HTTPS websites (like Vercel cloud deployments) are strictly blocked by modern mobile browsers from calling unencrypted local network APIs (like HTTP to `192.168.1.XX`).
*   **Solution:** We host the app locally on a home bridge server (your Linux laptop) at `http://192.168.1.XX:8000`. By loading the app from your phone over HTTP, the browser can communicate with the local upload endpoint without security blockages.

#### 5. Local Port Collisions
*   **Hurdle:** If port 8000 is occupied by another process on your laptop, the server throws `Address already in use`.
*   **Solution:** The server script catches this error and automatically increments the port (trying `8001`, `8002`, etc.) until it binds successfully, printing the updated URL.

