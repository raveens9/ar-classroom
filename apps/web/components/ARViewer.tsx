"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import type { ARManifest } from "@ar/shared";
import { ARModel } from "./ARModel";
import { CameraFallback } from "./CameraFallback";
import { WebXRViewer } from "./WebXRViewer";

interface Props {
  manifests: ARManifest[];
}

type XrSupport = "checking" | "supported" | "unsupported";
type Mode = "xr" | "fallback" | "none";

// Module-level scratch to avoid per-frame GC pressure
const _euler = new THREE.Euler();
const _screenQ = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
const _qInitInv = new THREE.Quaternion();
const _qDelta = new THREE.Quaternion();

export function ARViewer({ manifests }: Props) {
  const [xrSupport, setXrSupport] = useState<XrSupport>("checking");
  const [session, setSession] = useState<XRSession | null>(null);
  const [mode, setMode] = useState<Mode>("none");
  const [cameraReady, setCameraReady] = useState(false);
  const [anchored, setAnchored] = useState(false);
  const [xrError, setXrError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // Updated every deviceorientation event; read inside Canvas via useFrame
  const currentOrientationQ = useRef(new THREE.Quaternion());
  // Set once when the user taps "Anchor here"; null means floating (pre-anchor)
  const initialOrientationQ = useRef<THREE.Quaternion | null>(null);

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

  // Track device orientation while in fallback mode
  useEffect(() => {
    if (mode !== "fallback") return;

    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.alpha === null || e.beta === null || e.gamma === null) return;
      _euler.set(
        THREE.MathUtils.degToRad(e.beta ?? 0),
        THREE.MathUtils.degToRad(e.alpha ?? 0),
        THREE.MathUtils.degToRad(-(e.gamma ?? 0)),
        "YXZ"
      );
      currentOrientationQ.current.setFromEuler(_euler);
      currentOrientationQ.current.multiply(_screenQ);
    };

    window.addEventListener("deviceorientation", onOrientation);
    return () => window.removeEventListener("deviceorientation", onOrientation);
  }, [mode]);

  const startXR = async () => {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) return;
    setXrError(null);
    try {
      const s = await xr.requestSession("immersive-ar", {
        requiredFeatures: ["local-floor"],
        optionalFeatures: ["hit-test", "dom-overlay"],
        domOverlay: canvasRef.current ? { root: canvasRef.current } : undefined,
      } as XRSessionInit);
      setSession(s);
      setMode("xr");
      s.addEventListener("end", () => { setSession(null); setMode("none"); });
    } catch (e) {
      const err = e as Error;
      console.error("[ar] XR session failed", e);
      setXrError(`${err.name || "Error"}: ${err.message || String(e)}`);
      // Fall back to the camera view with manual anchor placement.
      setCameraReady(false);
      setAnchored(false);
      initialOrientationQ.current = null;
      setMode("fallback");
    }
  };

  const startClassroomAR = () => {
    if (xrSupport === "supported") {
      startXR();
    } else {
      startFallback();
    }
  };

  const startFallback = async () => {
    setXrError(null);
    // iOS 13+ requires DeviceOrientation permission from a user-gesture context
    const doa = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof doa.requestPermission === "function") {
      try { await doa.requestPermission(); } catch {}
    }
    setCameraReady(false);
    setAnchored(false);
    initialOrientationQ.current = null;
    setMode("fallback");
  };

  const anchor = () => {
    initialOrientationQ.current = currentOrientationQ.current.clone();
    setAnchored(true);
  };

  const reanchor = () => {
    initialOrientationQ.current = currentOrientationQ.current.clone();
  };

  return (
    <div ref={canvasRef} className="fixed inset-0 bg-black">
      {mode === "none" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-kid-paper p-6 text-center font-kid text-kid-ink">
          <div className="animate-kid-bounce text-8xl motion-reduce:animate-none" role="img" aria-hidden="true">🔮</div>
          {/* One button; the code already knows whether WebXR is supported and
              falls back to the camera view by itself. */}
          <button
            className="kid-btn min-h-[80px] bg-kid-grass px-10 text-2xl"
            onClick={startClassroomAR}
          >
            ▶ Start
          </button>
          <p className="max-w-xs text-sm text-kid-ink/50">
            {xrSupport === "supported"
              ? "Point at the floor, then tap to place your models."
              : "A camera view will open — look around, then tap to anchor your models."}
          </p>
        </div>
      )}

      {mode === "xr" && session && (
        <WebXRViewer
          session={session}
          manifests={manifests}
          onEnd={() => { setSession(null); setMode("none"); }}
        />
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
            {/* OrbitControls only active before anchoring */}
            {!anchored && (
              <OrbitControls
                makeDefault
                enablePan={false}
                minDistance={0.5}
                maxDistance={5}
                maxPolarAngle={Math.PI / 2}
                target={[0, 0.3, -1.4]}
              />
            )}
            <AnchoredScene
              manifests={manifests}
              anchored={anchored}
              currentOrientationQ={currentOrientationQ}
              initialOrientationQ={initialOrientationQ}
            />
          </Canvas>

          {!cameraReady && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 pointer-events-none px-6 text-center font-kid">
              <div className="animate-kid-bounce text-6xl motion-reduce:animate-none" role="img" aria-hidden="true">📷</div>
              <p className="text-lg font-semibold text-white">Starting camera…</p>
              {xrError && (
                <p className="text-sm text-red-300">
                  WebXR unavailable ({xrError}) — showing camera view instead.
                </p>
              )}
            </div>
          )}

          {/* Anchor controls */}
          <div className="absolute bottom-6 inset-x-0 flex justify-center gap-3">
            {!anchored ? (
              <button className="kid-btn bg-kid-sun" onClick={anchor}>
                📍 Put it here!
              </button>
            ) : (
              <button className="kid-btn-icon bg-white" onClick={reanchor} aria-label="Move models here">
                📍
              </button>
            )}
          </div>

          <div className="absolute top-3 right-3">
            <button className="kid-btn-icon bg-white text-2xl" onClick={() => setMode("none")} aria-label="Close camera view">
              ✕
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Wraps the scene group and applies DeviceOrientation counter-rotation when anchored
function AnchoredScene({
  manifests,
  anchored,
  currentOrientationQ,
  initialOrientationQ,
}: {
  manifests: ARManifest[];
  anchored: boolean;
  currentOrientationQ: React.MutableRefObject<THREE.Quaternion>;
  initialOrientationQ: React.MutableRefObject<THREE.Quaternion | null>;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const g = groupRef.current;
    if (!g || !anchored || !initialOrientationQ.current) return;
    // qDelta = how much the device has rotated since anchoring
    _qInitInv.copy(initialOrientationQ.current).invert();
    _qDelta.multiplyQuaternions(currentOrientationQ.current, _qInitInv);
    // Counter-rotate the scene so models appear world-fixed
    g.quaternion.copy(_qDelta).invert();
  });

  return (
    <group ref={groupRef}>
      <Scene manifests={manifests} />
    </group>
  );
}

// Lays out models in a gentle arc and renders name labels above each
function Scene({ manifests }: { manifests: ARManifest[] }) {
  return (
    <>
      {manifests.map((m, i) => {
        const n = manifests.length;
        const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
        const angle = t * 0.8;
        const r = 1.4;
        const x = Math.sin(angle) * r;
        const z = -Math.cos(angle) * r;
        const label = m.authorName ?? m.label;
        return (
          <group key={m.manifestId}>
            <ARModel manifest={m} position={[x, 0, z]} />
            {label && (
              <Html position={[x, 0.85, z]} center distanceFactor={3}>
                <div
                  style={{
                    color: "white",
                    fontSize: "13px",
                    fontWeight: 600,
                    textShadow: "0 1px 4px rgba(0,0,0,0.9)",
                    whiteSpace: "nowrap",
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  {label}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </>
  );
}
