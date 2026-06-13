"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ARManifest } from "@ar/shared";

interface Props {
  session: XRSession;
  manifests: ARManifest[];
  onEnd: () => void;
}

interface LoadedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

function arcOffset(i: number, total: number): THREE.Vector3 {
  const t = total === 1 ? 0 : (i / (total - 1)) * 2 - 1;
  const angle = t * 0.8;
  const r = 0.8;
  return new THREE.Vector3(Math.sin(angle) * r, 0, -Math.cos(angle) * r);
}

// Anchor frame from two taps on the shared sheet: origin at A, -Z (where the
// model arc appears) pointing along A→B projected onto the horizontal plane.
// Every device tapping the same two physical dots reconstructs the same frame.
// Returns null when the points are too close for a reliable yaw.
function anchorMatrixFromTaps(a: THREE.Vector3, b: THREE.Vector3): THREE.Matrix4 | null {
  const forward = new THREE.Vector3().subVectors(b, a);
  forward.y = 0;
  if (forward.length() < 0.05) return null;
  forward.normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const zAxis = forward.negate();
  const xAxis = new THREE.Vector3().crossVectors(up, zAxis);
  return new THREE.Matrix4().makeBasis(xAxis, up, zAxis).setPosition(a);
}

async function loadGLB(url: string): Promise<LoadedModel> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const maxDim = Math.max(...(box.getSize(new THREE.Vector3()).toArray() as number[]));
  if (maxDim > 0) gltf.scene.scale.setScalar(0.4 / maxDim);
  return { scene: gltf.scene, animations: gltf.animations };
}

export function WebXRViewer({ session, manifests, onEnd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Two-tap shared placement: tap dot A (origin), then dot B (yaw). Refs so the
  // XR animation loop / select handler closures always see the latest stage.
  const stageRef = useRef<"A" | "B" | "placed">("A");
  const resetPlacementRef = useRef<(() => void) | null>(null);
  const [placed, setPlaced] = useState(false);
  const [hint, setHint] = useState("Loading models…");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Raw Three.js renderer — R3F is intentionally not used here because its
    // internal requestAnimationFrame loop conflicts with the XR session's frame loop.
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    Object.assign(renderer.domElement.style, {
      position: "absolute", top: "0", left: "0", width: "100%", height: "100%",
    });
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(3, 5, 2);
    scene.add(dir);

    // Flat ring reticle that snaps to detected surfaces.
    const reticleGeo = new THREE.RingGeometry(0.06, 0.08, 32);
    reticleGeo.rotateX(-Math.PI / 2);
    const reticle = new THREE.Mesh(
      reticleGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    // Marks where dot A was tapped while the user lines up dot B.
    const aDotGeo = new THREE.CircleGeometry(0.025, 24);
    aDotGeo.rotateX(-Math.PI / 2);
    const aDot = new THREE.Mesh(aDotGeo, new THREE.MeshBasicMaterial({ color: 0x4ade80 }));
    aDot.visible = false;
    scene.add(aDot);

    let hitTestSource: XRHitTestSource | null = null;
    let referenceSpace: XRReferenceSpace | null = null;
    let preloaded: LoadedModel[] | null = null;
    let placedAnchor: THREE.Object3D | null = null;
    let pointA: THREE.Vector3 | null = null;
    const mixers: THREE.AnimationMixer[] = [];
    const clock = new THREE.Clock();

    const doPlace = (worldMatrix: THREE.Matrix4) => {
      if (!preloaded) return;

      // Remove previous placement when repositioning.
      if (placedAnchor) {
        scene.remove(placedAnchor);
        mixers.length = 0;
      }

      placedAnchor = new THREE.Object3D();
      placedAnchor.matrixAutoUpdate = false;
      placedAnchor.matrix.copy(worldMatrix);
      scene.add(placedAnchor);

      preloaded.forEach(({ scene: model, animations }, i) => {
        model.position.copy(arcOffset(i, manifests.length));
        if (animations.length > 0) {
          const mixer = new THREE.AnimationMixer(model);
          mixer.clipAction(animations[0]).play();
          mixers.push(mixer);
        }
        placedAnchor!.add(model);
      });

      stageRef.current = "placed";
      pointA = null;
      aDot.visible = false;
      reticle.visible = false;
      setPlaced(true);
      setHint("Models placed");
    };

    resetPlacementRef.current = () => {
      stageRef.current = "A";
      pointA = null;
      aDot.visible = false;
      setPlaced(false);
      setHint("Point at dot A on the anchor sheet, then tap");
    };

    // XR setup: reference space type must be set before setSession.
    renderer.xr.setReferenceSpaceType("local-floor");
    renderer.xr.setSession(session).then(async () => {
      referenceSpace = await session.requestReferenceSpace("local-floor");

      // Request hit-test source — optional, so gracefully skip if unavailable.
      if ("requestHitTestSource" in session) {
        try {
          const viewerSpace = await session.requestReferenceSpace("viewer");
          hitTestSource = (await session.requestHitTestSource!({ space: viewerSpace })) ?? null;
        } catch {
          // Device doesn't support hit-test; fall back to tap-in-front-of-camera.
        }
      }

      // Pre-load all models while the user scans for a surface.
      preloaded = await Promise.all(manifests.map(m => loadGLB(m.modelUrl)));
      setHint(
        hitTestSource
          ? "Point at dot A on the anchor sheet, then tap"
          : "Tap to place models"
      );
    });

    const onSelect = () => {
      if (!preloaded || stageRef.current === "placed") return;

      if (reticle.visible) {
        const tapPos = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);

        if (stageRef.current === "A") {
          pointA = tapPos;
          aDot.position.copy(tapPos);
          aDot.visible = true;
          stageRef.current = "B";
          setHint("Now point at dot B, then tap");
        } else if (pointA) {
          const anchorMatrix = anchorMatrixFromTaps(pointA, tapPos);
          if (!anchorMatrix) {
            setHint("Too close to dot A — point at dot B, then tap");
            return;
          }
          doPlace(anchorMatrix);
        }
      } else if (!hitTestSource) {
        // No surface detection on this device — shared alignment isn't possible,
        // so a single tap places 1.5 m in front of the XR camera.
        const xrCam = renderer.xr.getCamera();
        const pos = new THREE.Vector3(0, -0.3, -1.5).applyMatrix4(xrCam.matrixWorld);
        doPlace(new THREE.Matrix4().setPosition(pos));
      }
    };

    session.addEventListener("select", onSelect);
    session.addEventListener("end", onEnd);

    renderer.setAnimationLoop((_, frame) => {
      if (!frame) return;

      const dt = clock.getDelta();
      mixers.forEach(m => m.update(dt));

      // Update reticle position from hit-test results while not yet placed.
      if (stageRef.current !== "placed" && hitTestSource && referenceSpace) {
        const hits = frame.getHitTestResults(hitTestSource);
        if (hits.length > 0) {
          const pose = hits[0].getPose(referenceSpace);
          if (pose) {
            reticle.visible = true;
            reticle.matrix.fromArray(pose.transform.matrix);
          } else {
            reticle.visible = false;
          }
        } else {
          reticle.visible = false;
        }
      }

      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      resetPlacementRef.current = null;
      hitTestSource?.cancel();
      session.removeEventListener("select", onSelect);
      session.removeEventListener("end", onEnd);
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, []); // session / manifests / onEnd are stable for the lifetime of this component

  return (
    <div className="fixed inset-0" style={{ zIndex: 10 }}>
      <div ref={containerRef} className="absolute inset-0" />

      <div
        className="absolute inset-x-0 bottom-8 flex justify-center pointer-events-none"
        style={{ zIndex: 20 }}
      >
        <p className="text-white text-sm bg-black/60 px-4 py-2 rounded-full">{hint}</p>
      </div>

      <div className="absolute top-3 right-3 flex gap-2" style={{ zIndex: 20 }}>
        {placed && (
          <button
            className="btn-ghost"
            onClick={() => resetPlacementRef.current?.()}
          >
            Re-anchor
          </button>
        )}
        <button
          className="btn-ghost"
          onClick={() => session.end().catch(() => onEnd())}
        >
          Close
        </button>
      </div>
    </div>
  );
}
