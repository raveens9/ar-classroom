"use client";

import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, Ack } from "@ar/shared";
import { realtimeUrl } from "./hostRewrite";

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let singleton: TypedSocket | null = null;

export function getSocket(): TypedSocket {
  if (singleton && singleton.connected) return singleton;
  if (!singleton) {
    singleton = io(realtimeUrl(), {
      transports: ["websocket", "polling"],
      autoConnect: true,
      // Self-signed cert during dev — rejectUnauthorized is a Node-only option; browsers trust what they trust.
      withCredentials: true,
    });
    singleton.on("system:error", (e) => console.error("[socket] system error", e));
    singleton.on("connect_error", (e) => console.warn("[socket] connect_error", e.message));
  }
  return singleton;
}

// Typed emit-with-ack helper. Rejects on ack.ok === false so callers can `try/catch`.
export function emitAck<K extends keyof ClientToServerEvents>(
  event: K,
  payload: Parameters<ClientToServerEvents[K]>[0]
): Promise<
  Parameters<Parameters<ClientToServerEvents[K]>[1]>[0] extends Ack<infer T> ? T : never
> {
  return new Promise((resolve, reject) => {
    const s = getSocket();
    // Socket.io ack: we pass the callback as the last arg.
    // Types are erased at runtime — the shared package keeps them honest at the boundary.
    (s.emit as unknown as (...args: unknown[]) => void)(event, payload, (ack: Ack<unknown>) => {
      if (ack && ack.ok) resolve(ack.data as never);
      else {
        const err = ack && !ack.ok ? ack : { code: "INTERNAL", message: "no ack" };
        reject(new Error(`[${String(event)}] ${err.code}: ${err.message}`));
      }
    });
  });
}
