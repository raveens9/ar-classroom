#!/usr/bin/env node
import os from "node:os";
const ifaces = os.networkInterfaces();
const ips = [];
for (const list of Object.values(ifaces)) {
  for (const i of list || []) {
    if (!i.internal && (i.family === "IPv4" || i.family === 4)) ips.push(i.address);
  }
}
if (ips.length === 0) {
  console.log("No LAN interface found. Connect to Wi-Fi and rerun.");
} else {
  console.log("LAN IP(s):");
  for (const ip of ips) console.log(`  https://${ip}:3000   (open this on your phone)`);
}
