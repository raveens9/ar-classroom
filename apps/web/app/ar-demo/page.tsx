"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { ARManifest } from "@ar/shared";
import { DEMO_MODELS, type DemoModel } from "./models";

// three.js components must be client-only.
const ModelPreview = dynamic(
  () => import("@/components/ModelPreview").then((m) => m.ModelPreview),
  { ssr: false }
);
const ARViewer = dynamic(() => import("@/components/ARViewer").then((m) => m.ARViewer), {
  ssr: false,
});

function toManifest(m: DemoModel): ARManifest {
  return {
    manifestId: `demo-${m.id}`,
    authorId: `demo-${m.id}`,
    modelUrl: m.url,
    textureUrl: undefined,
    animationName: m.animationHint,
    label: m.label,
    createdAt: Date.now(),
  };
}

export default function ARDemoPage() {
  const [selected, setSelected] = useState<Set<string>>(new Set(["cat", "dog"]));
  const [mode, setMode] = useState<"preview" | "ar">("preview");

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectOnly = (ids: string[]) => setSelected(new Set(ids));
  const animalIds = useMemo(
    () => DEMO_MODELS.filter((m) => m.group === "animals").map((m) => m.id),
    []
  );
  const letterIds = useMemo(
    () => DEMO_MODELS.filter((m) => m.group === "letters").map((m) => m.id),
    []
  );

  const manifests: ARManifest[] = useMemo(
    () => DEMO_MODELS.filter((m) => selected.has(m.id)).map(toManifest),
    [selected]
  );

  if (mode === "ar") {
    return (
      <>
        <ARViewer manifests={manifests} />
        <div className="fixed top-3 left-3 z-10">
          <button className="btn-ghost" onClick={() => setMode("preview")}>
            ← Back to picker
          </button>
        </div>
      </>
    );
  }

  return (
    <main className="min-h-screen p-4 md:p-6 grid gap-4 lg:grid-cols-[360px_1fr]">
      <aside className="space-y-4 max-h-[90vh] overflow-auto pr-2">
        <div className="card">
          <h1 className="text-lg font-semibold mb-1">AR model demo</h1>
          <p className="text-xs text-white/60">
            Bypasses the socket + ML pipeline. Models are served straight from{" "}
            <code className="text-white/80">apps/web/public</code>. Use this to verify
            animations and sizing before the classifier is wired up.
          </p>
        </div>

        <div className="card space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Animals ({animalIds.length})</h2>
            <div className="flex gap-1 text-xs">
              <button className="btn-ghost !px-2 !py-1" onClick={() => selectOnly(animalIds)}>
                Only
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {DEMO_MODELS.filter((m) => m.group === "animals").map((m) => (
              <ModelChip key={m.id} m={m} selected={selected.has(m.id)} onToggle={toggle} />
            ))}
          </div>
        </div>

        <div className="card space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Letters ({letterIds.length})</h2>
            <div className="flex gap-1 text-xs">
              <button className="btn-ghost !px-2 !py-1" onClick={() => selectOnly(letterIds)}>
                Only
              </button>
              <button className="btn-ghost !px-2 !py-1" onClick={() => selectOnly([])}>
                Clear
              </button>
            </div>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {DEMO_MODELS.filter((m) => m.group === "letters").map((m) => (
              <button
                key={m.id}
                onClick={() => toggle(m.id)}
                className={
                  "rounded-md py-2 text-sm font-semibold transition " +
                  (selected.has(m.id)
                    ? "bg-brand text-white"
                    : "bg-white/10 text-white hover:bg-white/20")
                }
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card space-y-2">
          <h2 className="font-medium">Actions</h2>
          <div className="grid gap-2">
            <button
              className="btn-primary w-full"
              onClick={() => setMode("ar")}
              disabled={manifests.length === 0}
            >
              Launch AR ({manifests.length})
            </button>
            <button
              className="btn-ghost w-full"
              onClick={() => selectOnly(DEMO_MODELS.map((m) => m.id))}
            >
              Select all
            </button>
          </div>
          <p className="text-[11px] text-white/50">
            "Launch AR" uses WebXR on supported devices and falls back to getUserMedia +
            Three.js overlay elsewhere. The inline preview on the right is plain Three.js
            with orbit controls — handy for desktop inspection.
          </p>
        </div>
      </aside>

      <section className="card min-h-[80vh] relative overflow-hidden">
        <div className="absolute top-2 left-2 z-10 text-xs text-white/60 bg-black/40 rounded px-2 py-1">
          {manifests.length === 0
            ? "Select a model on the left"
            : `${manifests.length} model${manifests.length === 1 ? "" : "s"} · drag to orbit, scroll to zoom`}
        </div>
        {manifests.length > 0 && (
          <ModelPreview
            manifests={manifests}
            layout={manifests.length > 1 ? "arc" : "single"}
          />
        )}
      </section>
    </main>
  );
}

function ModelChip({
  m,
  selected,
  onToggle,
}: {
  m: DemoModel;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onToggle(m.id)}
      className={
        "text-left rounded-md p-3 transition border " +
        (selected
          ? "bg-brand/20 border-brand text-white"
          : "bg-white/5 border-white/10 text-white hover:bg-white/10")
      }
    >
      <div className="text-sm font-medium">{m.label}</div>
      <div className="text-[11px] text-white/50 mt-1">
        {m.animated ? "🎬 animated" : "static"} · {m.url}
      </div>
    </button>
  );
}
