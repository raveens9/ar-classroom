"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import * as THREE from "three";
import type { ARManifest } from "@ar/shared";

interface Props {
  manifest: ARManifest;
  position?: [number, number, number];
  // If provided, overrides auto-fit. Leave undefined to let ARModel size the model so
  // its largest dimension ~= `targetSize` meters.
  scale?: number;
  targetSize?: number;
}

// Pick animation with fallback logic: exact name → includes → first available.
function pickAnimation(names: string[], requested?: string | null): string | null {
  if (names.length === 0) return null;
  if (!requested) return names[0];
  const exact = names.find((n) => n.toLowerCase() === requested.toLowerCase());
  if (exact) return exact;
  const partial = names.find((n) => n.toLowerCase().includes(requested.toLowerCase()));
  if (partial) return partial;
  // Semantic fallbacks — e.g. requested "jump" not there, prefer "run" over "idle".
  const priority = ["run", "walk", "jump", "fly", "swim", "idle"];
  for (const p of priority) {
    const hit = names.find((n) => n.toLowerCase().includes(p));
    if (hit) return hit;
  }
  return names[0];
}

export function ARModel({
  manifest,
  position = [0, 0, -1.5],
  scale,
  targetSize = 0.6,
}: Props) {
  const group = useRef<THREE.Group>(null);
  // useGLTF caches by URL so re-renders are cheap.
  const gltf = useGLTF(manifest.modelUrl);

  // Skeletal animations break when you use THREE.Object3D.clone() because track paths
  // still point at the original scene's objects/bones. SkeletonUtils.clone rebuilds
  // the bone hierarchy so clips bind correctly — this is required for per-instance
  // animated models (e.g. 3 students all showing the same dog at different positions).
  const scene = useMemo(() => SkeletonUtils.clone(gltf.scene), [gltf.scene]);

  // Animations must target the cloned scene, not the group ref — otherwise tracks
  // resolve against the wrong object tree.
  const { actions, names } = useAnimations(gltf.animations, scene);

  const chosen = useMemo(
    () => pickAnimation(names, manifest.animationName),
    [names, manifest.animationName]
  );

  useEffect(() => {
    if (!chosen) return;
    const a = actions[chosen];
    if (!a) return;
    a.reset().fadeIn(0.2).play();
    return () => {
      a.fadeOut(0.2).stop();
    };
  }, [chosen, actions]);

  // Auto-fit: compute model's bounding box, derive a scale so its largest dimension
  // equals targetSize meters, and drop it so its feet rest on y=0.
  const { autoScale, yOffset } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const largest = Math.max(size.x, size.y, size.z);
    if (!isFinite(largest) || largest === 0) {
      return { autoScale: 1, yOffset: 0 };
    }
    const s = targetSize / largest;
    // After scaling, move so the model's y-min sits on 0 and x/z are centered.
    const yOff = -box.min.y * s;
    return { autoScale: s, yOffset: yOff };
  }, [scene, targetSize]);

  const finalScale = scale ?? autoScale;

  // Gentle idle rotation so static models still feel alive.
  useFrame((_, dt) => {
    if (group.current && !chosen) group.current.rotation.y += dt * 0.6;
  });

  // IMPORTANT per spec: do NOT override original materials/textures. We render the
  // cloned scene exactly as authored.
  return (
    <group
      ref={group}
      position={[position[0], position[1] + yOffset, position[2]]}
      scale={finalScale}
      dispose={null}
    >
      <primitive object={scene} />
    </group>
  );
}
