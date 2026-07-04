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

function makeNameLabel(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(4, 8, 248, 48, 12);
  } else {
    ctx.rect(4, 8, 248, 48);
  }
  ctx.fill();
  ctx.fillStyle = "white";
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 32, 240);
  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.35, 0.088, 1);
  return sprite;
}

function arcOffset(i: number, total: number): THREE.Vector3 {
  const t = total === 1 ? 0 : (i / (total - 1)) * 2 - 1;
  const angle = t * 0.8;
  const r = 0.8;
  return new THREE.Vector3(Math.sin(angle) * r, 0, -Math.cos(angle) * r);
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
  // placedRef is a ref so the XR animation loop closure always sees the latest value.
  const placedRef = useRef(false);
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

    let hitTestSource: XRHitTestSource | null = null;
    let referenceSpace: XRReferenceSpace | null = null;
    let preloaded: LoadedModel[] | null = null;
    let placedAnchor: THREE.Object3D | null = null;
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
        const offset = arcOffset(i, manifests.length);
        model.position.copy(offset);
        if (animations.length > 0) {
          const mixer = new THREE.AnimationMixer(model);
          mixer.clipAction(animations[0]).play();
          mixers.push(mixer);
        }
        placedAnchor!.add(model);

        const name = manifests[i]?.authorName ?? manifests[i]?.label;
        if (name) {
          const label = makeNameLabel(name);
          label.position.set(offset.x, offset.y + 0.35, offset.z);
          placedAnchor!.add(label);
        }
      });

      placedRef.current = true;
      reticle.visible = false;
      setHint("Models placed");
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
      setHint(hitTestSource ? "Point at a surface, then tap to place" : "Tap to place models");
    });

    const onSelect = () => {
      // Once placed, the anchor is permanent — ignore subsequent taps.
      if (!preloaded || placedRef.current) return;

      if (reticle.visible) {
        doPlace(new THREE.Matrix4().fromArray(reticle.matrix.elements));
      } else if (!hitTestSource) {
        // No surface detected — place 1.5 m in front of the XR camera.
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
      if (!placedRef.current && hitTestSource && referenceSpace) {
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

      <div className="absolute top-3 right-3" style={{ zIndex: 20 }}>
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
