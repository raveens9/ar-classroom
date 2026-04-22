// Custom HTTPS dev server for Next.js. This is required because:
//   - WebXR immersive-ar needs a secure context on mobile
//   - getUserMedia on mobile browsers needs a secure context
//   - `next dev --experimental-https` exists but using a single flow keeps prod+dev consistent
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "node:url";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const hostname = "0.0.0.0";
const tlsEnabled = (process.env.TLS_ENABLED ?? "true").toLowerCase() === "true";

const keyPath = resolve(process.cwd(), process.env.TLS_KEY_PATH ?? "../../certs/dev-key.pem");
const certPath = resolve(process.cwd(), process.env.TLS_CERT_PATH ?? "../../certs/dev-cert.pem");

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const requestHandler = (req, res) => {
  const parsedUrl = parse(req.url ?? "/", true);
  handle(req, res, parsedUrl);
};

let server;
if (tlsEnabled && existsSync(keyPath) && existsSync(certPath)) {
  server = createHttpsServer(
    { key: readFileSync(keyPath), cert: readFileSync(certPath) },
    requestHandler
  );
  console.log(`[web] HTTPS on https://${hostname}:${port}`);
} else {
  if (tlsEnabled) {
    console.warn(`[web] TLS enabled but certs missing.\n  key: ${keyPath}\n  cert: ${certPath}\n  Run: npm run cert:generate`);
    console.warn("[web] Falling back to HTTP.");
  }
  server = createHttpServer(requestHandler);
  console.log(`[web] HTTP on http://${hostname}:${port}`);
}

server.listen(port, hostname, () => {
  console.log(`[web] ready — open https://localhost:${port}`);
  console.log(`[web] for phone testing: npm run lan:ip (in repo root)`);
});
