// Rewrite URLs that contain "localhost" to the current device hostname.
// This fixes the LAN phone case: on a phone browsing https://192.168.1.20:3000,
// any URL like https://localhost:4002 would fail — we swap the host transparently.
export function rewriteHost(url: string): string {
  if (typeof window === "undefined") return url;
  try {
    const u = new URL(url);
    const deviceHost = window.location.hostname;
    const isLocal = (h: string) =>
      h === "localhost" || h === "127.0.0.1" || h === "::1";
    if (isLocal(u.hostname) && !isLocal(deviceHost)) {
      u.hostname = deviceHost;
    }
    // URL.toString() appends a trailing "/" to the origin, which then collides with
    // path strings that start with "/" (e.g. `${base}/v1/foo` → `.../8000//v1/foo`).
    // Strip trailing slashes so callers can always prepend "/".
    return u.toString().replace(/\/+$/, "");
  } catch {
    return url;
  }
}

export function realtimeUrl(): string {
  const raw = process.env.NEXT_PUBLIC_REALTIME_URL ?? "https://localhost:4001";
  return rewriteHost(raw);
}

export function mlApiUrl(): string {
  const raw = process.env.NEXT_PUBLIC_ML_API_URL ?? "https://localhost:8000";
  return rewriteHost(raw);
}
