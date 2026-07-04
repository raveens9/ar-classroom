"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  onReady?: () => void;
}

/**
 * Camera fallback for when WebXR is unavailable (iOS Safari, desktops, etc).
 * Uses getUserMedia (rear-facing camera) as a full-screen background video.
 *
 * iOS-specific fix: `autoPlay` is intentionally absent. Setting srcObject and
 * immediately calling play() races with the browser's internal autoplay state
 * machine and silently fails on first load. Instead we wait for `loadedmetadata`
 * before calling play(), which guarantees the video element has valid dimensions
 * and is ready to display frames.
 */
export function CameraFallback({ onReady }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    // getUserMedia() can hang forever with no rejection on pages the browser
    // flags with a certificate error (the permission prompt is silently
    // suppressed). Surface that case instead of leaving "Starting camera…" up forever.
    watchdogRef.current = window.setTimeout(() => {
      if (cancelled) return;
      setErr(
        `Camera hasn't started after 8s (isSecureContext=${window.isSecureContext}). ` +
          `If the address bar shows "Not secure", the camera permission prompt may be ` +
          `blocked — run "npm run cert:generate" and reload.`
      );
    }, 8000);

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const v = videoRef.current;
        if (!v) return;

        v.srcObject = stream;

        // Wait for metadata (frame dimensions) before playing — required on iOS
        // to avoid a silent AbortError on the first camera start.
        await new Promise<void>((resolve) => {
          if (v.readyState >= HTMLMediaElement.HAVE_METADATA) {
            resolve();
          } else {
            v.onloadedmetadata = () => resolve();
          }
        });

        if (cancelled) return;
        await v.play();
      } catch (e) {
        if (!cancelled) {
          setErr(
            `Camera error: ${(e as Error).message}. Make sure you're on HTTPS and have granted camera permission.`
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      if (watchdogRef.current !== null) window.clearTimeout(watchdogRef.current);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <>
      <video
        ref={videoRef}
        className="!absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
        onPlaying={() => {
          if (watchdogRef.current !== null) {
            window.clearTimeout(watchdogRef.current);
            watchdogRef.current = null;
          }
          setIsReady(true);
          onReady?.();
        }}
      />

      {/* Loading overlay — shown until the first frame arrives */}
      {!isReady && !err && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <p className="text-white/70 text-sm">Starting camera…</p>
        </div>
      )}

      {err && (
        <div className="absolute bottom-3 inset-x-3 card text-sm text-red-300 bg-black/60">
          {err}
        </div>
      )}
    </>
  );
}
