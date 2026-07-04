# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Instructions for Claude Code

Act as a rigorous, honest mentor. Do not default to agreement. Identify weaknesses, blind spots, and flawed assumptions. Challenge ideas when needed. Be direct and clear, not harsh. Prioritize helping me over being agreeable. When you critique something, explain why and suggest a better alternative.

## Commands

```bash
# Install all JS deps (root runs workspaces: web + realtime + shared)
npm install

# Python deps for ML API
cd apps/ml-api && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt

# Generate dev TLS certs (required — all services run HTTPS)
npm run cert:generate      # uses mkcert if installed, falls back to openssl

# Build shared types first (required before web/realtime can typecheck or run)
npm run build:shared

# Dev: web + realtime
npm run dev

# Dev: all three services
npm run dev:full

# Typecheck all workspaces (builds shared first automatically)
npm run typecheck

# Lint (web only)
npm run lint -w @ar/web

# Print LAN HTTPS URL for phone testing
npm run lan:ip
```

There are no automated tests in this codebase.

## Architecture

This is an npm workspace monorepo with three services and one shared package:

| Package        | Path              | Stack                                               |
| -------------- | ----------------- | --------------------------------------------------- |
| `@ar/web`      | `apps/web`        | Next.js 14 (App Router) + Tailwind + Three.js / R3F |
| `@ar/realtime` | `apps/realtime`   | Node + Express + Socket.io + TypeScript (ESM)       |
| `@ar/ml-api`   | `apps/ml-api`     | FastAPI + Python                                    |
| `@ar/shared`   | `packages/shared` | Zod schemas + TypeScript socket event contracts     |

### Shared package is the contract boundary

`packages/shared/src/` exports Zod schemas and inferred TypeScript types for all socket events (`ClientToServerEvents`, `ServerToClientEvents`), room state, canvas strokes, and AR manifests. Both `@ar/web` and `@ar/realtime` import from `@ar/shared`. **Run `npm run build:shared` after any change to `packages/shared/`** — the other workspaces consume its compiled output.

### Realtime server: in-memory, delta-based

`apps/realtime/src/state.ts` holds all runtime state in two plain `Map` objects per room: `committed` strokes (phase `"end"`) and `inProgress` strokes (phase `"start"/"update"`). No database — restart loses all rooms. On join or watch, the server emits a `canvas:sync` snapshot of both maps; all subsequent `canvas:stroke` events are deltas.

Authorization for every mutating socket event is checked in `apps/realtime/src/util/auth.ts`. Teacher identity is claimed at `room:create`; student identity at `room:join`. The server stores `role`, `teacherId`/`studentId`, and `roomId` on `socket.data` and validates them on every subsequent event.

### Web app routes

- `/teacher` — room creation, student admission queue, canvas co-editing, trigger ML pipeline
- `/student` — join room, draw on canvas (only when admitted + room `OPEN`)
- `/ar` — WebXR immersive-AR view of all approved 3D models for a room
- `/ar-demo` — standalone AR demo without a room

The web app uses a singleton Socket.io client (`apps/web/lib/socket.ts`) with a typed `emitAck` helper that wraps ack callbacks into promises, rejecting on `ack.ok === false`.

`apps/web/lib/hostRewrite.ts` transparently rewrites `localhost` URLs to the device's current hostname, so the web app works on phones over LAN without env var changes.

### ML pipeline (teacher-driven, sequential)

1. `POST /v1/remove-background` — alpha-threshold cutout of the canvas export
2. `POST /v1/classify` — returns a label + suggested animation (currently random; stub for real model)
3. `POST /v1/prepare-texture-model` — bakes the cutout texture onto a `.glb` from `apps/ml-api/app/static/models/`; label→file mapping is `MODEL_REGISTRY` in `apps/ml-api/app/routes/prepare_texture.py`
4. `POST /v1/approve-generate-ar` — produces the final `ARManifest` the teacher publishes via `ar:publish` socket event

Static assets (cutouts, baked models, textures) are served from `/static` and URL-referenced through `MODEL_ASSET_BASE_URL`.

### HTTPS everywhere

WebXR (`navigator.xr.requestSession("immersive-ar")`) and `getUserMedia` require a secure context. All three services serve TLS in dev. Certs live in `certs/` (gitignored). The cert script writes a SAN covering `localhost` + the current LAN IP so phones can connect without cert errors (with mkcert installed and its root CA trusted on the device).
