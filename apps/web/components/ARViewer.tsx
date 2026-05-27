"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import type { ARManifest } from "@ar/shared";
import { ARModel } from "./ARModel";
import { CameraFallback } from "./CameraFallback";
import { MarkerARViewer } from "./MarkerARViewer";
import { WebXRViewer } from "./WebXRViewer";

interface Props {
  manifests: ARManifest[];
}

type XrSupport = "checking" | "supported" | "unsupported";
type Mode = "xr" | "marker" | "fallback" | "none";

export function ARViewer({ manifests }: Props) {
  const [xrSupport, setXrSupport] = useState<XrSupport>("checking");
  const [session, setSession] = useState<XRSession | null>(null);
  const [mode, setMode] = useState<Mode>("none");
  const [cameraReady, setCameraReady] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr || typeof xr.isSessionSupported !== "function") {
      setXrSupport("unsupported");
      return;
    }
    xr.isSessionSupported("immersive-ar").then(
      (ok) => !cancelled && setXrSupport(ok ? "supported" : "unsupported"),
      () => !cancelled && setXrSupport("unsupported")
    );
    return () => { cancelled = true; };
  }, []);

  const startXR = async () => {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) return;
    try {
      const s = await xr.requestSession("immersive-ar", {
        requiredFeatures: ["local-floor"],
        optionalFeatures: ["hit-test", "dom-overlay"],
        domOverlay: canvasRef.current ? { root: canvasRef.current } : undefined,
      } as XRSessionInit);
      setSession(s);
      setMode("xr");
      s.addEventListener("end", () => {
        setSession(null);
        setMode("none");
      });
    } catch (e) {
      console.error("[ar] XR session failed", e);
      // Fall back to AR.js marker mode if WebXR request fails.
      setMode("marker");
    }
  };

  const startClassroomAR = () => {
    if (xrSupport === "supported") {
      startXR();
    } else {
      setMode("marker");
    }
  };

  return (
    <div ref={canvasRef} className="fixed inset-0 bg-black">
      {mode === "none" && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="card max-w-sm w-full text-center space-y-3">
            <h2 className="text-xl font-semibold">AR View</h2>
            <p className="text-sm text-white/70">
              {manifests.length} model{manifests.length === 1 ? "" : "s"} in this room.
            </p>
            <button className="btn-primary w-full" onClick={startClassroomAR}>
              Classroom AR
            </button>
            <p className="text-xs text-white/40">
              {xrSupport === "supported"
                ? "Tap to place models on any surface — no marker needed."
                : "Point at the Hiro marker to place models."}
            </p>
            <button
              className="btn-ghost w-full"
              onClick={() => { setCameraReady(false); setMode("fallback"); }}
            >
              Camera view (no AR)
            </button>
          </div>
        </div>
      )}

      {mode === "xr" && session && (
        <WebXRViewer
          session={session}
          manifests={manifests}
          onEnd={() => { setSession(null); setMode("none"); }}
        />
      )}

      {mode === "marker" && (
        <MarkerARViewer manifests={manifests} onClose={() => setMode("none")} />
      )}

      {mode === "fallback" && (
        <>
          <CameraFallback onReady={() => setCameraReady(true)} />
          <Canvas
            className="!absolute inset-0"
            camera={{ position: [0, 1, 2.5], fov: 60 }}
            gl={{ alpha: true, antialias: true }}
            style={{ background: "transparent" }}
          >
            <ambientLight intensity={0.9} />
            <directionalLight position={[3, 5, 2]} intensity={1.2} />
            <Environment preset="city" />
            <OrbitControls
              makeDefault
              enablePan={false}
              minDistance={0.5}
              maxDistance={5}
              maxPolarAngle={Math.PI / 2}
              target={[0, 0.3, -1.4]}
            />
            <Scene manifests={manifests} />
          </Canvas>
          {!cameraReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 pointer-events-none">
              <p className="text-white/70 text-sm">Starting camera…</p>
            </div>
          )}
          <div className="absolute top-3 right-3">
            <button className="btn-ghost" onClick={() => setMode("none")}>Close</button>
          </div>
        </>
      )}
    </div>
  );
}

function Scene({ manifests }: { manifests: ARManifest[] }) {
  return (
    <>
      {manifests.map((m, i) => {
        const n = manifests.length;
        const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
        const angle = t * 0.8;
        const r = 1.4;
        return (
          <ARModel
            key={m.manifestId}
            manifest={m}
            position={[Math.sin(angle) * r, 0, -Math.cos(angle) * r]}
          />
        );
      })}
    </>
  );
}
