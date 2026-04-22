"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, Grid } from "@react-three/drei";
import type { ARManifest } from "@ar/shared";
import { ARModel } from "./ARModel";

interface Props {
  manifests: ARManifest[];
  // Layout: "single" renders one at origin; "arc" spreads them out.
  layout?: "single" | "arc";
  showGrid?: boolean;
}

/**
 * Non-AR inline 3D preview. Orbit with mouse / touch. Use this for desktop dev to
 * inspect models, animations, and materials before flipping to AR.
 */
export function ModelPreview({ manifests, layout = "arc", showGrid = true }: Props) {
  return (
    <Canvas
      camera={{ position: [0, 0.8, 2.2], fov: 50 }}
      gl={{ antialias: true }}
      shadows
    >
      <color attach="background" args={["#0b0b12"]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 5, 2]} intensity={1.2} castShadow />
      <Suspense fallback={null}>
        <Environment preset="city" />
        {manifests.map((m, i) => {
          let x = 0;
          let z = 0;
          if (layout === "arc" && manifests.length > 1) {
            const n = manifests.length;
            const t = (i / (n - 1)) * 2 - 1;
            const angle = t * 0.8;
            const r = 1.0;
            x = Math.sin(angle) * r;
            z = -Math.cos(angle) * r + 1;
          }
          return <ARModel key={m.manifestId} manifest={m} position={[x, 0, z]} />;
        })}
      </Suspense>
      {showGrid && (
        <Grid
          infiniteGrid
          cellColor="#1f1f2b"
          sectionColor="#3a3a55"
          fadeDistance={20}
          cellSize={0.25}
          sectionSize={1}
          position={[0, 0, 0]}
        />
      )}
      <OrbitControls
        enablePan
        enableRotate
        enableZoom
        minDistance={0.3}
        maxDistance={8}
        target={[0, 0.4, 0]}
      />
    </Canvas>
  );
}
