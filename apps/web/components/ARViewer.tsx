"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { ARManifest } from "@ar/shared";
import { ARModel } from "./ARModel";
import { CameraFallback } from "./CameraFallback";

interface Props {
  manifests: ARManifest[];
}

type XrSupport = "checking" | "supported" | "unsupported";

export function ARViewer({ manifests }: Props) {
  const [xrSupport, setXrSupport] = useState<XrSupport>("checking");
  const [session, setSession] = useState<XRSession | null>(null);
  const [mode, setMode] = useState<"xr" | "fallback" | "none">("none");
  const [cameraReady, setCameraReady] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // Feature-detect WebXR AR support.
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
    return () => {
      cancelled = true;
    };
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
      console.error("[ar] XR request failed", e);
      setMode("fallback");
    }
  };

  const startFallback = () => {
    setCameraReady(false);
    setMode("fallback");
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
            {xrSupport === "supported" && (
              <button className="btn-primary w-full" onClick={startXR}>
                Start immersive AR
              </button>
            )}
            <button className="btn-ghost w-full" onClick={startFallback}>
              {xrSupport === "supported" ? "Use camera fallback" : "Start camera view"}
            </button>
            {xrSupport === "unsupported" && (
              <p className="text-xs text-white/50">
                WebXR AR is not available on this device. The camera fallback uses getUserMedia.
              </p>
            )}
          </div>
        </div>
      )}

      {mode === "xr" && session && (
        <Canvas
          gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false }}
          onCreated={({ gl }) => {
            gl.xr.enabled = true;
            gl.xr.setReferenceSpaceType("local-floor");
            gl.xr.setSession(session as unknown as XRSession).catch(console.error);
            gl.setClearColor(new THREE.Color(0x000000), 0);
          }}
        >
          <ambientLight intensity={0.9} />
          <directionalLight position={[3, 5, 2]} intensity={1.2} />
          <Scene manifests={manifests} />
        </Canvas>
      )}

      {mode === "fallback" && (
        <>
          {/* Live camera feed as background */}
          <CameraFallback onReady={() => setCameraReady(true)} />

          {/* 3D scene overlaid on the camera — transparent background so the video shows through */}
          <Canvas
            className="!absolute inset-0"
            camera={{ position: [0, 1, 2.5], fov: 60 }}
            gl={{ alpha: true, antialias: true }}
            style={{ background: "transparent" }}
          >
            <ambientLight intensity={0.9} />
            <directionalLight position={[3, 5, 2]} intensity={1.2} />
            <Environment preset="city" />
            {/*
              OrbitControls makes the model feel world-anchored: drag to rotate the
              camera around the model's position, pinch to zoom in/out.
              - enablePan=false: prevents sliding the model off-screen
              - maxPolarAngle=PI/2: prevents orbiting underground
              - target: centre of the model arc (single model is always at z=-1.4)
            */}
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

          {/* Loading overlay until the first camera frame arrives */}
          {!cameraReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 pointer-events-none">
              <p className="text-white/70 text-sm">Starting camera…</p>
            </div>
          )}

          <div className="absolute top-3 right-3">
            <button className="btn-ghost" onClick={() => setMode("none")}>
              Close
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Scene({ manifests }: { manifests: ARManifest[] }) {
  // Lay models out in a gentle arc so multiple students' models coexist.
  return (
    <>
      {manifests.map((m, i) => {
        const n = manifests.length;
        const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1; // -1..1
        const angle = t * 0.8;
        const r = 1.4;
        const x = Math.sin(angle) * r;
        const z = -Math.cos(angle) * r;
        return <ARModel key={m.manifestId} manifest={m} position={[x, 0, z]} />;
      })}
    </>
  );
}
