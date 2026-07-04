"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type React from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type {
  ArToolkitSource,
  ArToolkitContext,
} from "@ar-js-org/ar.js/three.js/build/ar-threex.mjs";
import type { ARManifest } from "@ar/shared";
import { ARModel } from "./ARModel";

interface Props {
  manifests: ARManifest[];
  onClose: () => void;
}

interface ARState {
  source: ArToolkitSource;
  context: ArToolkitContext;
  markerObject: THREE.Group;
}

interface ARJSSceneProps {
  manifests: ARManifest[];
  containerRef: React.RefObject<HTMLDivElement>;
  onStatusChange: (status: "scanning" | "locked" | "lost") => void;
  resetLockRef: React.MutableRefObject<(() => void) | null>;
}

// Compute arc layout positions at table-top scale around a printed marker.
function arcPosition(i: number, total: number): [number, number, number] {
  const t = total === 1 ? 0 : (i / (total - 1)) * 2 - 1;
  const angle = t * 0.6;
  const r = 0.12;
  return [Math.sin(angle) * r, 0, -Math.cos(angle) * r];
}

// ── Module-level scratch objects ──────────────────────────────────────────────
// Allocated once to avoid per-frame GC pressure on mobile.
const _euler       = new THREE.Euler();
const _q1          = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
const _zee         = new THREE.Vector3(0, 0, 1);
const _q0scratch   = new THREE.Quaternion();
const _qDelta      = new THREE.Quaternion();
const _qInitInv    = new THREE.Quaternion();
const _adjustedMat = new THREE.Matrix4();
const _rotMat      = new THREE.Matrix4();

// Canonical DeviceOrientation → Three.js quaternion conversion.
// Matches the algorithm in three-stdlib DeviceOrientationControls.
function deviceOrientationToQuaternion(
  alpha: number,
  beta: number,
  gamma: number,
  screenAngleDeg: number
): THREE.Quaternion {
  _euler.set(
    THREE.MathUtils.degToRad(beta),
    THREE.MathUtils.degToRad(alpha),
    -THREE.MathUtils.degToRad(gamma),
    "YXZ"
  );
  const q = new THREE.Quaternion().setFromEuler(_euler);
  q.multiply(_q1);
  q.multiply(_q0scratch.setFromAxisAngle(_zee, -THREE.MathUtils.degToRad(screenAngleDeg)));
  return q;
}

// ── Inner R3F component ───────────────────────────────────────────────────────
function ARJSScene({ manifests, containerRef, onStatusChange, resetLockRef }: ARJSSceneProps) {
  const { camera, gl } = useThree();
  const groupRef    = useRef<THREE.Group>(null);
  const stateRef    = useRef<ARState | null>(null);
  const contextRef  = useRef<ArToolkitContext | null>(null);

  // Persistence refs
  const lockRef                 = useRef(false);
  const lastMarkerMatrixRef     = useRef(new THREE.Matrix4());
  const initialOrientationQRef  = useRef(new THREE.Quaternion());
  const currentOrientationQRef  = useRef(new THREE.Quaternion());
  const screenOrientationRef    = useRef(0);
  const orientationAvailableRef = useRef(false);
  const currentStatusRef        = useRef<"scanning" | "locked" | "lost">("scanning");

  // Only call onStatusChange when status actually transitions to avoid 60fps setState calls.
  function emitStatus(s: "scanning" | "locked" | "lost") {
    if (currentStatusRef.current !== s) {
      currentStatusRef.current = s;
      onStatusChange(s);
    }
  }

  // ── AR.js setup ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let domEl: HTMLElement | null = null;
    let onResizeFn: (() => void) | null = null;

    import("@ar-js-org/ar.js/three.js/build/ar-threex.mjs").then(
      ({ ArToolkitSource, ArToolkitContext, ArMarkerControls }) => {
        if (cancelled) return;

        const markerObject = new THREE.Group();
        const arSource = new ArToolkitSource({ sourceType: "webcam" });

        const arContext = new ArToolkitContext({
          cameraParametersUrl: "/arjs/camera_para.dat",
          detectionMode: "mono",
        });
        contextRef.current = arContext;

        const onResize = () => {
          arSource.onResizeElement();
          arSource.copyElementSizeTo(gl.domElement);
          if (arContext.arController !== null) {
            arSource.copyElementSizeTo(arContext.arController.canvas);
          }
        };
        onResizeFn = onResize;

        arSource.init(() => {
          if (cancelled) return;
          const el = arSource.domElement as HTMLElement;
          domEl = el;
          // Place video inside the AR container as z=0 layer; the transparent
          // Three.js canvas (z=1) composites over the real camera feed.
          Object.assign(el.style, {
            position: "absolute",
            top: "0",
            left: "0",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            zIndex: "0",
          });
          const container = containerRef.current;
          if (container) {
            container.prepend(el);
          } else {
            document.body.insertBefore(el, document.body.firstChild);
          }
          onResize();
          window.addEventListener("resize", onResize);
        });

        arContext.init(() => {
          if (cancelled) return;
          camera.projectionMatrix.copy(arContext.getProjectionMatrix());
          camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        });

        new ArMarkerControls(arContext, markerObject, {
          type: "pattern",
          patternUrl: "/arjs/pattern-hiro.patt",
        });

        stateRef.current = { source: arSource, context: arContext, markerObject };
      }
    );

    return () => {
      cancelled = true;
      stateRef.current = null;
      contextRef.current = null;
      if (onResizeFn) window.removeEventListener("resize", onResizeFn);
      if (domEl?.parentNode) domEl.parentNode.removeChild(domEl);
    };
  }, [camera, gl]);

  // ── DeviceOrientation listener ───────────────────────────────────────────────
  useEffect(() => {
    const onOrientationChange = () => {
      screenOrientationRef.current =
        screen.orientation?.angle ??
        (window as Window & { orientation?: number }).orientation ??
        0;
    };
    onOrientationChange();

    const onDeviceOrientation = (e: DeviceOrientationEvent) => {
      if (e.alpha === null && e.beta === null && e.gamma === null) return;
      orientationAvailableRef.current = true;
      currentOrientationQRef.current.copy(
        deviceOrientationToQuaternion(
          e.alpha ?? 0,
          e.beta  ?? 0,
          e.gamma ?? 0,
          screenOrientationRef.current
        )
      );
    };

    window.addEventListener("orientationchange", onOrientationChange);
    window.addEventListener("deviceorientation", onDeviceOrientation);
    return () => {
      window.removeEventListener("orientationchange", onOrientationChange);
      window.removeEventListener("deviceorientation", onDeviceOrientation);
    };
  }, []);

  // ── Expose reset callback to parent ─────────────────────────────────────────
  useEffect(() => {
    resetLockRef.current = () => {
      lockRef.current = false;
      initialOrientationQRef.current.copy(currentOrientationQRef.current);
    };
    return () => { resetLockRef.current = null; };
  }, []);

  // ── Render loop ──────────────────────────────────────────────────────────────
  useFrame(() => {
    const ar = stateRef.current;
    if (!ar?.source.ready) return;

    ar.context.update(ar.source.domElement as HTMLVideoElement);

    if (contextRef.current) {
      camera.projectionMatrix.copy(contextRef.current.getProjectionMatrix());
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    }

    const group = groupRef.current;
    if (!group) return;

    if (ar.markerObject.visible) {
      // Always keep lastMarkerMatrix fresh so re-anchoring uses the latest pose.
      lastMarkerMatrixRef.current.copy(ar.markerObject.matrix);

      if (!lockRef.current) {
        // First detection — establish lock and snapshot orientation.
        lockRef.current = true;
        initialOrientationQRef.current.copy(currentOrientationQRef.current);
      } else {
        // Re-sync while marker is visible to prevent drift accumulation.
        initialOrientationQRef.current.copy(currentOrientationQRef.current);
      }

      group.visible = true;
      group.matrix.copy(ar.markerObject.matrix);
      group.matrixWorldNeedsUpdate = true;
      emitStatus("locked");

    } else {
      if (!lockRef.current) {
        group.visible = false;
        return;
      }

      // Marker gone — keep models in world space.
      group.visible = true;

      if (!orientationAvailableRef.current) {
        // Graceful fallback: no sensor data — freeze at last screen position.
        group.matrix.copy(lastMarkerMatrixRef.current);
        group.matrixWorldNeedsUpdate = true;
        emitStatus("lost");
        return;
      }

      // qDelta = qCurrent * qInitial^-1  (rotation since lock)
      // Apply qDelta^-1 as left-multiply to counter-rotate the model into world space.
      _qInitInv.copy(initialOrientationQRef.current).invert();
      _qDelta.copy(currentOrientationQRef.current).multiply(_qInitInv).invert();
      _rotMat.makeRotationFromQuaternion(_qDelta);
      _adjustedMat.multiplyMatrices(_rotMat, lastMarkerMatrixRef.current);

      group.matrix.copy(_adjustedMat);
      group.matrixWorldNeedsUpdate = true;
      emitStatus("locked");
    }
  });

  return (
    <group ref={groupRef} matrixAutoUpdate={false}>
      {/* AR.js marker space has Y pointing at the camera; rotating PI around X corrects the orientation. */}
      <group rotation={[Math.PI, 0, 0]}>
        {manifests.map((m, i) => (
          <ARModel
            key={m.manifestId}
            manifest={m}
            position={arcPosition(i, manifests.length)}
            targetSize={0.08}
            authorName={m.authorName}
          />
        ))}
      </group>
    </group>
  );
}

// ── Outer component ───────────────────────────────────────────────────────────
export function MarkerARViewer({ manifests, onClose }: Props) {
  const containerRef        = useRef<HTMLDivElement>(null);
  const resetLockCallbackRef = useRef<(() => void) | null>(null);

  const [anchorStatus, setAnchorStatus] = useState<"scanning" | "locked" | "lost">("scanning");
  const [iosPermissionNeeded, setIosPermissionNeeded] = useState(() =>
    typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown })
      .requestPermission === "function"
  );

  const onStatusChange = useCallback(
    (s: "scanning" | "locked" | "lost") => setAnchorStatus(s),
    []
  );

  const requestIOSPermission = useCallback(async () => {
    try {
      const req = (DeviceOrientationEvent as unknown as {
        requestPermission: () => Promise<"granted" | "denied">;
      }).requestPermission;
      await req();
    } finally {
      setIosPermissionNeeded(false);
    }
  }, []);

  return (
    <div ref={containerRef} className="fixed inset-0" style={{ zIndex: 10 }}>
      {/* Transparent R3F canvas sits above the video (z=1) so the real camera feed shows through. */}
      <Canvas
        camera={{ position: [0, 0, 0], fov: 40 }}
        gl={{ alpha: true, antialias: true }}
        onCreated={({ gl }) => gl.setClearColor(new THREE.Color(0), 0)}
        style={{ background: "transparent", position: "absolute", inset: 0, zIndex: 1 }}
      >
        <ambientLight intensity={1.2} />
        <directionalLight position={[0, 5, 5]} intensity={1.5} />
        <ARJSScene
          manifests={manifests}
          containerRef={containerRef}
          onStatusChange={onStatusChange}
          resetLockRef={resetLockCallbackRef}
        />
      </Canvas>

      {/* Bottom status + iOS permission */}
      <div
        className="absolute inset-x-0 bottom-8 flex flex-col items-center gap-2 pointer-events-none"
        style={{ zIndex: 20 }}
      >
        {iosPermissionNeeded && (
          <button
            className="btn-primary pointer-events-auto"
            onClick={requestIOSPermission}
          >
            Enable motion sensors
          </button>
        )}
        <p className="text-white text-sm bg-black/60 px-4 py-2 rounded-full">
          {anchorStatus === "scanning" && "Point camera at the Hiro marker"}
          {anchorStatus === "locked"   && "Models anchored — marker not needed"}
          {anchorStatus === "lost"     && "Models pinned (limited tracking)"}
        </p>
      </div>

      {/* Top-right controls */}
      <div className="absolute top-3 right-3 flex gap-2" style={{ zIndex: 20 }}>
        {anchorStatus !== "scanning" && (
          <button
            className="btn-ghost"
            onClick={() => {
              resetLockCallbackRef.current?.();
              setAnchorStatus("scanning");
            }}
          >
            Re-anchor
          </button>
        )}
        <button className="btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
