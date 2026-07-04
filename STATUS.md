# AR Classroom Platform — Project Status

_Last updated: 2026-06-11_

---

## Done

### Core platform (earlier sessions)
- Next.js 14 App Router web app, Node/Socket.io realtime server, FastAPI ML API
- Teacher flow: create classroom → start session → admit students → watch canvas → run ML pipeline → publish AR models
- Student flow: scan QR → pick name → draw on collaborative canvas → view AR models
- Supabase auth (teacher accounts), classrooms, sessions, students, drawings tables
- Per-student canvases with eraser, undo/redo
- AR gating: students only get the AR button once the teacher has approved at least one model

### AR viewer (multiple iterations)
- **MarkerARViewer** — AR.js + Hiro marker; camera feed visible behind 3D models; models corrected upright (`rotation={[Math.PI, 0, 0]}`); used on devices without WebXR support
- **WebXRViewer** — Raw Three.js renderer (R3F intentionally bypassed to avoid frame-loop conflict with XR session); WebXR hit-test surface detection; flat reticle ring snaps to real surfaces; single tap places all models permanently at that anchor; no reposition after placement
- **Camera fallback** — `getUserMedia` feed + Three.js canvas overlay; DeviceOrientation world anchoring (quaternion counter-rotation so models appear fixed in the real world after tapping "Anchor models here"); "Re-anchor" button; OrbitControls disabled after anchoring
- **ARViewer** orchestrates all three modes: "Classroom AR" button picks WebXR if supported, falls back to marker; "Camera view" button enters the fallback mode

### Author name labels
- `authorName` field added to `ARManifest` schema (Zod, shared package)
- Teacher's approve flow looks up the watched student's `displayName` from the room state and passes it through the ML API to the manifest
- `<Html>` label from `@react-three/drei` floats above each model at y=0.85m in both fallback and scene modes

### Session lifecycle
- **End session** (teacher page): "End session" button (always visible when a room is open, regardless of whether `sessionId` is in the URL); emits `room:close` socket event → realtime server broadcasts `room:closed` to all connected clients and deletes the room from memory → sets `ended_at` in Supabase so the join page immediately shows "session not started"
- **End session** (dashboard): "End session" button in the Session tab; sets `ended_at` in Supabase (no socket teardown from here — use teacher view for live teardown)
- `room:close` event wired through shared schema → realtime handler → web client

### Bug fixes (re-applied after merge)
- `noStore()` on the join page so newly added roster names always appear fresh (Next.js data cache bypass)
- "Room not found" on student page now silently clears the stale cached `socketRoomId` and enters polling mode instead of showing an error string
- Teacher page auto-creates the socket room on mount (idempotent — reuses existing room or creates a fresh one and updates `sessions.socket_room_id`)

### Infrastructure
- Merge conflicts between `feature-shared-anchor` and `development` branches resolved; all changes pushed to `development`
- Shared package (`@ar/shared`) rebuilt after schema changes; typechecks pass across all three workspaces

---

## In Progress / Known Gaps

| Area | Status |
|---|---|
| ML classification | Stub only — returns a random label and animation. `MODEL_REGISTRY` in `apps/ml-api/app/routes/prepare_texture.py` maps labels to static `.glb` files |
| WebXR author labels | `<Html>` labels from drei don't render inside the XR frame (DOM overlay doesn't participate in the WebXR render). Labels work in camera-fallback and marker modes only |
| Realtime server persistence | All room state is in-memory (`Map`). Server restart loses all rooms. Mitigated by the teacher page auto-creating the room on load, but canvas strokes and AR manifests are lost |
| iOS WebXR | WebXR `immersive-ar` is not supported on iOS Safari; those devices always fall back to the AR.js marker mode |
| DeviceOrientation on desktop | No gyroscope → anchoring does nothing on desktop. The "Anchor models here" button still appears but has no effect |

---

## Next Steps

### High priority
1. **Test on physical devices** — Android (WebXR hit-test) and iOS (AR.js marker + camera fallback + DeviceOrientation anchoring). The LAN HTTPS setup (`npm run lan:ip`) is required for camera and WebXR on phones.
2. **Fix WebXR author labels** — Replace `<Html>` with `THREE.Sprite` or a canvas texture rendered as a `THREE.SpriteMaterial` so labels appear inside the WebXR frame.
3. **Real ML model** — Replace the stub classifier in `apps/ml-api/app/routes/classify.py` with an actual image classification model (e.g. CLIP or a fine-tuned MobileNet). Extend `MODEL_REGISTRY` with more label→GLB mappings.

### Medium priority
4. **Redis-backed realtime state** — Replace the in-memory `Map` in `apps/realtime/src/state.ts` with Redis so room state (canvas strokes, AR manifests) survives server restarts without needing the teacher to re-run the ML pipeline.
5. **Session history / replay** — Drawings are already saved to Supabase storage + `drawings` table on approval. A session history view in the dashboard would let teachers review past sessions.
6. **Student reconnect UX** — If a student's phone locks and they lose the socket connection, the current flow requires re-joining. The localStorage session cache helps but could be more robust.

### Low priority / future
7. **Multiple teacher support** — Currently one teacher per classroom. The realtime model uses `teacherId` as the room owner; multi-teacher would need role changes.
8. **Production deployment** — Services need to be containerised; the realtime server needs a public WebSocket URL; Supabase RLS policies should be reviewed.
9. **Accessibility** — The canvas drawing interface has no keyboard or switch-access support.

---

## Branch State

| Branch | State |
|---|---|
| `development` | Active. All features above are merged here. |
| `feature-shared-anchor` | Merged into `development` via PR #2. May be stale. |
| `main` | Behind `development`. PR from `development` → `main` not yet created. |
