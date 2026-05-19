# AR Classroom Platform

A teacher-student collaborative drawing platform with realtime rooms and AR model
viewing on mobile devices.

- **`apps/web`** — Next.js (App Router) + React + TS + Tailwind
- **`apps/realtime`** — Node + Express + Socket.io + TS
- **`apps/ml-api`** — FastAPI + Python
- **`packages/shared`** — Zod-typed socket event contracts consumed by web + realtime

All services run over **HTTPS** in dev because:

- `navigator.xr.requestSession("immersive-ar")` requires a secure context
- `navigator.mediaDevices.getUserMedia(...)` on mobile browsers requires a secure context
- Self-signed / `mkcert` certs on a LAN IP unlock both on a real phone

---

## Quick start

```bash
# 1. Install JS deps (all workspaces)
npm install

# 2. Install Python deps for the ML API
cd apps/ml-api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd ../..

# 3. Generate local TLS certs
#    Prefers mkcert if installed (OS-trusted); falls back to openssl self-signed.
#    brew install mkcert   (macOS)
#    choco install mkcert  (Windows)
npm run cert:generate

# 4. Build shared types once (they're referenced by every app)
npm run build:shared

# 5. Start everything
npm run dev:full        # web + realtime + ml-api
# or
npm run dev             # web + realtime only
```

Then open **https://localhost:3000**. Your browser will warn about the cert the first
time — accept it (use `mkcert -install` to skip this).

---

## Ports

| Service   | URL                         |
|-----------|-----------------------------|
| web       | https://localhost:3000      |
| realtime  | https://localhost:4001      |
| ml-api    | https://localhost:8000      |

---

## User flow

1. Teacher opens `/teacher` → creates a room (`OPEN` or `CLOSED`)
2. Student opens `/student?room=ROOM_ID` → joins → appears in teacher's waiting list
3. Teacher **Admits** → student can draw (only in `OPEN` rooms)
4. Teacher **Watches** a specific student → can co-edit their canvas
5. Teacher runs **Remove BG + Classify + Prepare** → then **Approve & Publish AR**
6. Students in the room open `/ar?room=ROOM_ID` → see all approved models in AR

> Students in the same room see **every student's** published model in the AR scene.

---

## Phone testing over LAN HTTPS

Phones (especially iOS) will not grant camera / WebXR access unless the page is served
over HTTPS. The cert script already includes your LAN IP as a SAN.

```bash
npm run lan:ip
# example output:
#   https://192.168.1.24:3000   (open this on your phone)
```

On the phone:

- Make sure phone and laptop are on the **same Wi-Fi**
- Open the `https://192.168.1.x:3000` URL
- If using `mkcert`, install the mkcert root CA on the phone (`mkcert -CAROOT` shows the
  root; AirDrop / email it, then Settings → General → About → Certificate Trust Settings
  on iOS). Without this, Safari will still let you bypass the warning but camera may
  refuse to start.
- If using the OpenSSL fallback, the first load must accept the warning manually.

The web app automatically rewrites any `localhost` host found in
`NEXT_PUBLIC_REALTIME_URL` / `NEXT_PUBLIC_ML_API_URL` to the device's current hostname,
so `https://192.168.1.24:3000` will transparently talk to `https://192.168.1.24:4001`
and `https://192.168.1.24:8000`.

---

## Environment

Copy the example:

```bash
cp .env.example .env
```

Per-app `.env.example` files also exist. Public (browser-visible) vars must start with
`NEXT_PUBLIC_`.

| Var                          | Service    | Default                                |
|------------------------------|------------|----------------------------------------|
| `NEXT_PUBLIC_REALTIME_URL`   | web        | `https://localhost:4001`               |
| `NEXT_PUBLIC_ML_API_URL`     | web        | `https://localhost:8000`               |
| `REALTIME_PORT`              | realtime   | `4001`                                 |
| `FRONTEND_ORIGIN`            | realtime   | `https://localhost:3000`               |
| `ALLOW_ALL_ORIGINS`          | realtime   | `true` (dev)                           |
| `TLS_ENABLED`                | node svcs  | `true`                                 |
| `TLS_KEY_PATH`               | node svcs  | `../../certs/dev-key.pem`              |
| `TLS_CERT_PATH`              | node svcs  | `../../certs/dev-cert.pem`             |
| `ML_API_PUBLIC_BASE_URL`     | ml-api     | `https://localhost:8000`               |
| `MODEL_ASSET_BASE_URL`       | ml-api     | `https://localhost:8000/static`        |

---

## Scripts

| Script                      | What                                           |
|-----------------------------|------------------------------------------------|
| `npm run cert:generate`     | Generate dev TLS certs (mkcert or openssl)     |
| `npm run lan:ip`            | Print the HTTPS URL to open on your phone      |
| `npm run build:shared`      | Build the shared zod/types package             |
| `npm run dev`               | web + realtime (HTTPS)                         |
| `npm run dev:full`          | web + realtime + ml-api (HTTPS)                |
| `npm run dev:web`           | web only                                       |
| `npm run dev:realtime`      | realtime only                                  |
| `npm run dev:ml`            | ml-api only (uvicorn)                          |
| `npm run build`             | Build all workspaces                           |
| `npm run typecheck`         | Strict TS typecheck across workspaces          |

---

## Drop in 3D models

Place `.glb` files at `apps/ml-api/app/static/models/`. The route
`prepare-texture-model` maps labels → files via `MODEL_REGISTRY` in
`apps/ml-api/app/routes/prepare_texture.py`. You can override per label; the AR viewer
honours each model's original materials/textures/animations, and picks the requested
animation name with fallback to `run → walk → jump → fly → swim → idle → first`.

---

## Architecture notes

- The realtime server keeps two maps per room: `committed` strokes and `inProgress`
  strokes. Join / watch returns both as a `canvas:sync` snapshot, and all subsequent
  `canvas:stroke` events are applied as deltas. No bitmap sync.
- Authorization is enforced server-side for every mutating event (see
  `apps/realtime/src/util/auth.ts`). Teacher identity is claimed on `room:create`;
  student identity on `room:join`. The server then checks `authorId` of every stroke
  matches the sender.
- The ML API's `remove-background` endpoint is a crude alpha threshold — swap for
  `rembg` / `u2net` for real cutouts. The classifier is intentionally random.

---

## Troubleshooting

- **Safari won't start the camera** → make sure you're on `https://` and the cert is
  trusted. Private browsing blocks `getUserMedia`.
- **Socket fails with `net::ERR_CERT_AUTHORITY_INVALID`** → browser hasn't trusted the
  realtime cert. Visit `https://<host>:4001/healthz` once and accept it.
- **Typecheck fails on fresh clone** → run `npm run build:shared` first (the root
  `typecheck` script does this automatically).
