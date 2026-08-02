# NEXUS Ecosystem — 4 Shared-Data Mobile Workbench Apps

One Node.js server + one shared database powering **4 separate mobile-first web apps**:

| App | URL path | Purpose |
|---|---|---|
| 🏠 Launcher | `/` | Home screen linking to all 4 apps |
| 💼 Business Tracker | `/business/` | Nadylan sourcing orders + Guangzhou Mate tours |
| 🩺 Health Tracker | `/health/` | Diet / workout / metrics logs for Nadine & Yuvena |
| 🐾 Pet Care Tracker | `/pet/` | Diet / health logs for your 3 pets |
| 💰 Budget Manager | `/budget/` | Monthly caps, savings goals, wishlist |

**Every device that opens the URL talks to the same server and the same database.**
Real-time sync is handled by Socket.IO: when anyone adds an order, logs a meal, or adds
an expense on their phone, every other connected phone updates within ~1 second —
no manual refresh needed. This is what makes it "shared data across every mobile."

Cross-app automation already wired in:
- Completing a Nadylan order or Guangzhou Mate tour → auto-posts profit/margin as income in Budget
- Logging a "grocery" entry in Health or Pet apps → auto-posts the cost as an expense in Budget
- All money fields respect a single, editable RMB↔IDR exchange rate

---

## 1. Run it locally (to try it before deploying)

Requires Node.js 18+.

```bash
cd nexus-apps
npm install
npm start
```

Server starts on **http://localhost:3000**. Open that in your browser — you'll see
the launcher with 4 app tiles. To test "shared data" locally, open the same URL in
two browser tabs (or your phone on the same WiFi, using your computer's LAN IP,
e.g. `http://192.168.1.23:3000`) and watch changes sync live between them.

The database is a single file, `nexus.db`, created automatically on first run in the
project root. Back it up any time by copying that file.

---

## 2. Deploy it so every phone can reach it from anywhere

Because this is a normal Node.js + SQLite app, you can deploy it to any of these —
pick whichever is easiest for you. All are free to start.

### Option A — Railway (easiest, recommended)
1. Create a free account at railway.app
2. New Project → "Deploy from GitHub repo" (push this folder to a new GitHub repo first),
   or use the Railway CLI: `railway login && railway init && railway up` from inside
   the `nexus-apps` folder.
3. Railway auto-detects Node, runs `npm install` then `npm start`.
4. Once deployed, Railway gives you a public URL like `https://nexus-ecosystem.up.railway.app`.
5. Open that URL on any phone (Nadine's and Yuvena's) — bookmark it or "Add to Home Screen"
   for an app-like icon (this project includes PWA manifests for each app).

### Option B — Render
1. Create a free account at render.com
2. New → Web Service → connect your GitHub repo (or "Public Git repository" with the repo URL)
3. Build command: `npm install`   Start command: `npm start`
4. Render gives you a public HTTPS URL automatically.

### Option C — Fly.io
1. Install the `flyctl` CLI, run `fly launch` inside `nexus-apps` (accept defaults, Node is auto-detected)
2. `fly deploy`
3. Fly gives you a public URL.

### Option D — Your own VPS / home server
1. Copy the `nexus-apps` folder to the server (e.g. via `scp` or `git clone`)
2. `npm install && npm start` (or use `pm2 start server/index.js --name nexus` to keep it running)
3. Put it behind a reverse proxy (Nginx/Caddy) with HTTPS for a clean public URL, or just
   use the server's IP + port 3000 if it's only for home WiFi use.

> **Note on the database:** `nexus.db` is a local SQLite file. On Railway/Render's free
> tiers, disks can reset on redeploy — for production use, mount a persistent volume
> (both platforms support this in their dashboard under "Volumes") so `nexus.db` survives
> restarts and redeploys. On Fly.io, use `fly volumes create` and mount it to the app's
> working directory.

---

## 3. Add the apps to your phone's home screen

Once deployed, open the public URL on each phone in Safari (iOS) or Chrome (Android):
- **iOS Safari:** tap Share → "Add to Home Screen"
- **Android Chrome:** tap ⋮ menu → "Add to Home screen" / "Install app"

You can do this separately for the launcher (`/`) and for each individual app
(`/business/`, `/health/`, `/pet/`, `/budget/`) since each has its own PWA manifest —
so you can end up with 4 separate app icons on your home screen if you prefer, all
pointing at the same shared backend.

---

## 4. Project structure

```
nexus-apps/
├── package.json
├── server/
│   ├── index.js          # Express + Socket.IO entry point
│   ├── db.js              # SQLite schema + baseline config defaults
│   └── routes/
│       ├── business.js    # orders, tours, clients, products, fee-tier logic
│       ├── health.js       # health logs, grocery→budget sync
│       ├── pet.js           # pet logs, grocery→budget sync
│       ├── budget.js        # transactions, caps, goals, wishlist
│       └── config.js        # FX rate & baseline constants
└── public/
    ├── index.html          # app launcher
    ├── style.css            # shared mobile-first styling
    ├── shared.js             # shared API/socket helper used by all 4 apps
    ├── business/ … health/ … pet/ … budget/
    │   ├── index.html
    │   ├── app.js
    │   └── manifest.json
```

## 5. Editing baseline numbers (rent cap, FX rate, revenue goal, etc.)

These live in the `config` table, seeded on first run with the values from your
business plan (125,000 RMB reserve, 5,000 RMB/month cap, 5B IDR goal, etc.).
To change one, call:

```bash
curl -X PUT https://<your-deployed-url>/api/config/fx_rate_idr_per_rmb \
  -H "Content-Type: application/json" -d '{"value": 2200}'
```

(A settings screen for this can be added later — for now it's a one-line API call.)

## 6. What's implemented vs. what's a next step

This is a working MVP covering the core daily-use flows from the spec: order/tour entry
with auto profit calculation, health/pet logging, budget caps and goal tracking, and
live cross-device sync. Not yet built (candidates for a v2 pass): CRM search/filter UI,
photo uploads, AI content/itinerary generators, versioned recipe database, XLSX/PDF
export, and push notifications for over-budget alerts — the data model already has
room for these, so they can be added without restructuring what's here.
