import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from "@ar/shared";
import { registerRoomHandlers } from "./handlers/room.js";
import { registerCanvasHandlers } from "./handlers/canvas.js";
import { registerARHandlers } from "./handlers/ar.js";
import { unbindSocket } from "./state.js";

const PORT = Number(process.env.PORT ?? process.env.REALTIME_PORT ?? 4002);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "https://localhost:3000";
const ALLOW_ALL_ORIGINS = (process.env.ALLOW_ALL_ORIGINS ?? "true").toLowerCase() === "true";
const TLS_ENABLED = (process.env.TLS_ENABLED ?? "true").toLowerCase() === "true";

const app = express();
app.use(
  cors({
    origin: ALLOW_ALL_ORIGINS ? true : [FRONTEND_ORIGIN],
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "realtime", tls: TLS_ENABLED });
});

function buildServer() {
  if (!TLS_ENABLED) {
    return createHttpServer(app);
  }
  const keyPath = resolve(process.cwd(), process.env.TLS_KEY_PATH ?? "../../certs/dev-key.pem");
  const certPath = resolve(process.cwd(), process.env.TLS_CERT_PATH ?? "../../certs/dev-cert.pem");
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    console.warn(
      `[realtime] TLS enabled but cert/key missing.\n  key: ${keyPath}\n  cert: ${certPath}\n  Run: npm run cert:generate`
    );
    console.warn("[realtime] Falling back to HTTP.");
    return createHttpServer(app);
  }
  return createHttpsServer(
    {
      key: readFileSync(keyPath),
      cert: readFileSync(certPath),
    },
    app
  );
}

const server = buildServer();

const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
  server,
  {
    cors: {
      origin: ALLOW_ALL_ORIGINS ? true : [FRONTEND_ORIGIN],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 2 * 1024 * 1024,
  }
);

io.on("connection", (socket) => {
  console.log(`[io] connect ${socket.id}`);
  registerRoomHandlers(io, socket);
  registerCanvasHandlers(io, socket);
  registerARHandlers(io, socket);

  socket.on("disconnect", (reason) => {
    const id = unbindSocket(socket.id);
    console.log(`[io] disconnect ${socket.id} (${reason})`);
    // Students persist in the room across disconnects (e.g. navigating to /ar in a
    // new tab). They are only removed when the teacher calls room:remove or
    // room:close ends the session.
    void id;
  });
});

server.listen(PORT, "0.0.0.0", () => {
  const proto = TLS_ENABLED ? "https" : "http";
  console.log(`[realtime] listening on ${proto}://0.0.0.0:${PORT}`);
});
