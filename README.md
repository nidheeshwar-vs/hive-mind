# Hive Mind

Next-generation activity management platform for industrial equipment services (DataQuest 3.0, problem DQBH).

Node.js + Express + SQLite on the backend, a dependency-free vanilla JS single-page app on the frontend. No build step. One `npm install`, one `npm start`.

## 1. Run it locally (VS Code)

Requirements: Node.js 22.13 or newer (Node 22 LTS or 24 both work). Check with `node -v`.

1. Open the `hive-mind` folder in VS Code (File > Open Folder).
2. Open the terminal (Ctrl + `) and run:
   ```bash
   npm install
   cp .env.example .env      # Windows PowerShell: copy .env.example .env
   npm start
   ```
3. Open http://localhost:3000. The database and demo data are created automatically on first start.
4. For auto-restart while you edit the backend, use `npm run dev`. Frontend changes only need a browser refresh.
5. Reset the demo data any time with `npm run seed`.
6. With the server running, run `npm test` in a second terminal. It walks the whole workflow through the API (25 checks).

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Operations admin | admin@hivemind.io | Admin@123 |
| Customer, Site A | customer@sitea.com | Cust@123 |
| Customer, Site B | customer@siteb.com | Cust@123 |
| Technician | arjun@hivemind.io (also priya, karthik, meena, suresh, divya, rahul, faizal) | Tech@123 |

The login page has one-tap buttons for these. Change or remove them before a real deployment.

## 2. Project layout

```
server/
  index.js            Express app, background jobs (IoT simulator, SLA watchdog)
  db.js               SQLite schema
  seed.js             Demo data (4 sites, 12 machines, 8 technicians, 12 parts, 16 requests)
  auth.js             JWT + role middleware
  routes/
    core.js           login/register, meta, public passport, notifications, audit, IoT ingest, SSE, QR
    assets.js         machines, technicians, spare parts
    requests.js       the full request lifecycle + preflight + exceptions + uploads
    insights.js       dashboard, AI endpoints, map
  services/
    matching.js       AI 1: technician matching
    health.js         AI 2: predictive machine health + IoT simulator
    workflow.js       parts reservation, exceptions, shared logic  (AI 3: spare parts intelligence)
    sla.js            AI 4: SLA / delay prediction + watchdog
    impact.js         AI 5: impact simulation
    audit.js          tamper-evident hash chain
    events.js         real-time push (Server-Sent Events) + notifications
public/
  index.html          shell + your intro animation (recoloured to bumblebee yellow)
  css/styles.css      design system
  js/                 main.js (router), landing.js, views-a.js, views-b.js, api.js, ui.js, intro.js
```

## 3. How it covers the problem statement

| Requirement | Where |
|---|---|
| Frontend, backend, database, auth, authorization, APIs | Express REST API, SQLite, JWT, three roles (admin, technician, customer) with server-side checks |
| Business logic + workflow | Create > validate > approve > assign > start > proof of work > verify, with guarded status transitions |
| Dashboards, notifications, audit history | Control room, live notification bell (SSE), hash-chained audit log |
| Validate machine, priority, site, skills, parts before approval | Live **preflight checks** on the New request form and again on submit |
| Reserve resources on approval | Approval reserves spare parts; assignment checks technician capacity |
| Technician drops out / part unavailable / SLA exceeded | Exception flags + alerts + **one-click reassignment**; restocking auto-clears part exceptions |
| Route by availability and location | Matching score uses distance (haversine), workload, availability, skills, experience |
| Real-time visibility | SSE push refreshes every open screen; map view; board view |
| Completion verification | Technician must upload a photo/PDF + report; customer or admin signs off |
| Extensible: mobile, AI/ML, IoT, maps, blockchain, cloud | See section 5 |

### The five AI features (from your screenshot)

1. **Intelligent technician matching**: skill 35 %, workload 20 %, availability 15 %, distance 15 %, experience 15 %. Fully explainable: the request page shows every sub-score and any blockers.
2. **Predictive machine health**: temperature, vibration, runtime since service and failure history become a 0-100 risk score, plus a regression-based estimate of hours until critical. One click creates a preventive request.
3. **Spare parts intelligence**: stock is checked while writing the request, reserved on approval, and shortages raise an exception with restock ETA.
4. **SLA / delay prediction**: travel time + technician queue + parts wait + remaining work, turned into a probability of missing the deadline.
5. **Impact simulation**: downtime cost per hour, dependent production lines and SLA penalties, with a slider on each request and a portfolio view in Impact lab.

### Extra features that target the pain points in the PDF

- **Conflict radar**: overloaded technicians, one technician booked at two sites, duplicate requests on one machine, parts oversubscribed.
- **Dropout recovery**: report a dropout and the next best technician is ranked instantly.
- **Tamper-evident audit chain**: each audit row stores SHA-256(previous hash + data). "Verify chain" proves nothing was edited.
- **Machine passport + QR**: a public page per machine with status, health and history.
- **Voice notes**: microphone button on the timeline (Chrome / Edge speech recognition).
- **Installable**: web manifest included, so it can be added to a phone home screen.

## 4. Deploy

### Option A: Render (easiest)

1. Create a GitHub repo and push the project:
   ```bash
   git init && git add . && git commit -m "Hive Mind"
   git branch -M main
   git remote add origin https://github.com/<you>/hive-mind.git
   git push -u origin main
   ```
2. On https://render.com choose New > Blueprint, select the repo. It reads `render.yaml`.
3. Wait for the build. Your URL looks like `https://hive-mind-xxxx.onrender.com`.
4. In the Render dashboard set `PUBLIC_URL` to that URL so QR codes point to the live site.

The blueprint uses a paid instance with a 1 GB disk so data survives restarts. For a free demo: change the blueprint to `plan: free`, remove the `disk` block and the `DATA_DIR` variable. Data then resets on restart and re-seeds itself, which is fine for judging. Free instances sleep when idle, so open the site once before presenting.

### Option B: Railway or Fly.io

Both detect Node automatically (or use the included `Dockerfile`). Set environment variables `JWT_SECRET`, `IOT_API_KEY`, `PUBLIC_URL`; attach a volume and set `DATA_DIR` to its mount path.

### Option C: Any VPS

```bash
git clone <repo> && cd hive-mind && npm ci --omit=dev
JWT_SECRET=<long random> IOT_API_KEY=<random> PORT=3000 node server/index.js   # run under pm2 or systemd
```
Put Nginx or Caddy in front for HTTPS. For Nginx add `proxy_buffering off;` on `/api/events` so live updates stream.

### Environment variables

| Name | Purpose |
|---|---|
| `JWT_SECRET` | Signs login tokens. **Required in production** |
| `IOT_API_KEY` | Key devices send in the `x-api-key` header |
| `PUBLIC_URL` | Base URL used inside QR codes |
| `DATA_DIR` | Folder for the SQLite file and uploads |
| `SIMULATE_IOT` | `false` once real devices send telemetry |
| `PORT` | Set automatically by most hosts |

## 5. Extending it (architecture notes for the judges)

- **IoT**: `POST /api/iot/telemetry` with header `x-api-key` and body `{"machine_code":"M-104","temperature":88,"vibration":6.2}`. The health model, dashboard and alerts react immediately. Turn off the built-in simulator with `SIMULATE_IOT=false`.
- **AI / ML**: each AI feature is one pure function in `server/services/`. Replace the formula with a trained model (for example a Python microservice) without touching routes or UI.
- **Mobile**: the API is plain JSON + JWT, so a React Native or Flutter app can reuse it as is. The web app is already responsive and installable.
- **Real-time**: `services/events.js` is the single push channel. Swap SSE for WebSockets or a managed broker if you scale out.
- **Maps**: Leaflet with CARTO tiles; technician positions come from `PATCH /api/technicians/me/location` (a mobile app can stream GPS).
- **Blockchain**: the audit table is already a hash chain. Publish the head hash (shown on the Audit page) to any public chain to anchor it.
- **Cloud / scale**: SQLite is perfect for a single-instance deployment. For multiple instances, move `db.js` to PostgreSQL (the SQL is standard) and put uploads in S3.

Test example for the IoT endpoint:
```bash
curl -X POST http://localhost:3000/api/iot/telemetry -H "Content-Type: application/json" -H "x-api-key: dev-iot-key" \
  -d '{"machine_code":"M-104","temperature":91,"vibration":7.5}'
```

## 6. Suggested 4-minute demo script

1. Intro animation, then landing page. Move the cursor, click to dispatch the swarm.
2. Sign in as **customer@sitea.com**, New request on **M-104**, watch preflight checks warn about duplicates and shortages. Submit.
3. Switch to **admin**: open the request, show SLA risk, impact slider, technician match breakdown. Approve (parts reserved), Auto-assign.
4. Sign in as the technician: Start work, upload a photo, submit report.
5. Back as customer: Verify and close. Show the Audit page and Verify chain.
6. Exceptions: as a technician use Report dropout, as admin hit Reassign in one click. Restock the chiller coil on the Parts page and watch the exception clear itself.
7. Finish on Machines > M-104: predictive health, preventive request, QR passport.

## 7. Troubleshooting

- `Cannot find module 'node:sqlite'`: your Node is too old. Install Node 22.13 or newer (the database is built into Node, nothing needs compiling). An "ExperimentalWarning: SQLite" message in the console is normal.
- Map is blank: it loads Leaflet and tiles from the internet, so check your connection.
- Port in use: set `PORT=3001` in `.env`.
