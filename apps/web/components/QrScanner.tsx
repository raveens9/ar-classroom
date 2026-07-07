"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  onResult: (text: string) => void;
  onClose: () => void;
}

export function QrScanner({ onResult, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let done = false;

    async function start() {
      // jsqr is loaded dynamically to avoid pulling it into the initial bundle
      // and to prevent any SSR issues.
      let jsQR: (typeof import("jsqr"))["default"];
      try {
        jsQR = (await import("jsqr")).default;
      } catch {
        setCamError("QR library failed to load.");
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 } },
        });
      } catch {
        setCamError("Camera access denied. Please allow camera access and try again.");
        return;
      }

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});
      setScanning(true);

      intervalId = setInterval(() => {
        if (done) return;
        const canvas = canvasRef.current;
        if (!canvas || !video || video.readyState < video.HAVE_ENOUGH_DATA) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert",
        });

        if (code?.data) {
          done = true;
          clearInterval(intervalId!);
          stream?.getTracks().forEach((t) => t.stop());
          onResult(code.data);
        }
      }, 150);
    }

    start();

    return () => {
      done = true;
      if (intervalId) clearInterval(intervalId);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black">
      {camError ? (
        <div className="flex flex-col items-center gap-6 p-6 text-center">
          <span className="text-6xl">🚫</span>
          <p className="text-white/80 text-lg max-w-xs">{camError}</p>
          <button
            onClick={onClose}
            className="rounded-2xl bg-white/15 px-8 py-4 text-lg font-bold text-white active:scale-95"
          >
            Go back
          </button>
        </div>
      ) : (
        <div className="relative h-full w-full">
          {/* Camera feed */}
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-cover"
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Dark vignette + scanning frame */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" />
            {/* Cut-out window */}
            <div
              className="relative z-10 rounded-2xl bg-transparent"
              style={{ width: 240, height: 240, boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }}
            >
              {/* Corner accents */}
              {[
                "top-0 left-0 border-t-4 border-l-4 rounded-tl-xl",
                "top-0 right-0 border-t-4 border-r-4 rounded-tr-xl",
                "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-xl",
                "bottom-0 right-0 border-b-4 border-r-4 rounded-br-xl",
              ].map((cls) => (
                <div key={cls} className={`absolute w-8 h-8 border-white ${cls}`} />
              ))}

              {/* Scanning line */}
              {scanning && (
                <div className="absolute inset-x-0 top-1/2 h-0.5 bg-white/70 animate-pulse" />
              )}
            </div>
          </div>

          {/* Hint text */}
          <div className="absolute bottom-24 inset-x-0 flex justify-center">
            <p className="rounded-full bg-black/60 px-5 py-2 text-sm text-white/80 backdrop-blur-sm">
              Point at the room QR code
            </p>
          </div>

          {/* Cancel button */}
          <div className="absolute bottom-8 inset-x-0 flex justify-center">
            <button
              onClick={onClose}
              className="rounded-2xl bg-white/15 px-10 py-4 text-lg font-bold text-white backdrop-blur-sm active:scale-95"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
