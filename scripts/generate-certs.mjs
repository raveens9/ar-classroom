#!/usr/bin/env node
// Generate local TLS dev certificates for HTTPS (required for WebXR + getUserMedia on mobile LAN).
// Uses `mkcert` when available (preferred — trusted by OS). Falls back to `openssl` self-signed.
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const certDir = join(rootDir, "certs");
const keyPath = join(certDir, "dev-key.pem");
const certPath = join(certDir, "dev-cert.pem");

if (!existsSync(certDir)) mkdirSync(certDir, { recursive: true });

function has(cmd) {
  const finder = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(finder, [cmd], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim().length > 0;
}

function getLanIPs() {
  const ips = new Set(["127.0.0.1", "::1"]);
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const i of list) {
      if (!i.internal && (i.family === "IPv4" || i.family === 4)) ips.add(i.address);
    }
  }
  return [...ips];
}

const hostnames = ["localhost", os.hostname(), `${os.hostname()}.local`, ...getLanIPs()];
const unique = [...new Set(hostnames.filter(Boolean))];

console.log("Generating dev certificates for:", unique.join(", "));

if (has("mkcert")) {
  console.log("→ Using mkcert (trusted by OS)");
  try {
    execSync(`mkcert -install`, { stdio: "inherit" });
  } catch {
    console.warn("mkcert -install failed (continuing)");
  }
  execSync(`mkcert -key-file "${keyPath}" -cert-file "${certPath}" ${unique.map(h => `"${h}"`).join(" ")}`, {
    stdio: "inherit",
  });
  console.log(`✅ Certificates written to ${certDir}`);
  process.exit(0);
}

if (has("openssl")) {
  console.log("→ mkcert not found. Falling back to OpenSSL self-signed (browsers will show warning).");
  const configPath = join(certDir, "openssl.cnf");
  const altNames = unique
    .map((h, i) => (/^[0-9a-f:.]+$/i.test(h) && !h.includes(":") ? `IP.${i + 1} = ${h}` : `DNS.${i + 1} = ${h}`))
    .join("\n");
  const cnf = `[req]
default_bits       = 2048
prompt             = no
default_md         = sha256
x509_extensions    = v3_req
distinguished_name = dn
[dn]
C  = US
ST = Dev
L  = Local
O  = AR Platform
CN = localhost
[v3_req]
subjectAltName = @alt_names
[alt_names]
${altNames}
`;
  writeFileSync(configPath, cnf);
  execSync(
    `openssl req -x509 -nodes -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -config "${configPath}"`,
    { stdio: "inherit" }
  );
  console.log(`✅ Self-signed certs at ${certDir}`);
  console.log("⚠️  On iOS/Android you must manually trust the cert, or install mkcert for a smoother flow.");
  process.exit(0);
}

console.error("❌ Neither mkcert nor openssl found. Install one of them and rerun.");
process.exit(1);
