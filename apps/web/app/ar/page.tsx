"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { emitAck, getSocket } from "@/lib/socket";
import { resolveStudentId } from "@/lib/studentId";
import { mlStylize } from "@/lib/mlApi";
import { StylePicker } from "@/components/StylePicker";
import type { ARManifest, ARRoomFeed } from "@ar/shared";

const ARViewer = dynamic(() => import("@/components/ARViewer").then((m) => m.ARViewer), {
  ssr: false,
});

export default function ARPage() {
  const search = useSearchParams();
  const roomParam = search.get("room") ?? "";
  const idParam = search.get("id");
  const [roomId, setRoomId] = useState<string>(roomParam);
  const [studentId, setStudentId] = useState<string>("");

  // Server is the single source of truth — ar:new keeps this up to date for everyone.
  const [manifests, setManifests] = useState<ARManifest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const [stylePickerOpen, setStylePickerOpen] = useState(false);
  const [styling, setStyling] = useState(false);
  const [styleError, setStyleError] = useState<string | null>(null);

  useEffect(() => {
    const r = resolveStudentId(idParam);
    setStudentId(r.id);
  }, [idParam]);

  useEffect(() => {
    if (!roomId || !studentId) return;
    const socket = getSocket();

    const onFeed = (feed: ARRoomFeed) => {
      if (feed.roomId !== roomId) return;
      setManifests(feed.manifests);
    };
    const onNew = (m: ARManifest & { roomId: string }) => {
      if (m.roomId !== roomId) return;
      setManifests((prev) => [...prev.filter((x) => x.authorId !== m.authorId), m]);
    };

    const onReconnect = () => {
      // Server restarted — rooms are gone. Reset so the subscribe re-runs.
      setReady(false);
      setManifests([]);
    };

    socket.on("ar:feed", onFeed);
    socket.on("ar:new", onNew);
    socket.io.on("reconnect", onReconnect);

    emitAck("ar:subscribe", { roomId, studentId })
      .then((feed) => {
        setManifests(feed.manifests);
        setReady(true);
      })
      .catch((e) => setError((e as Error).message));

    return () => {
      socket.off("ar:feed", onFeed);
      socket.off("ar:new", onNew);
      socket.io.off("reconnect", onReconnect);
    };
  }, [roomId, studentId]);

  async function applyStyle(styleChoice: string) {
    if (styling || manifests.length === 0) return;
    setStyling(true);
    setStylePickerOpen(false);
    setStyleError(null);
    try {
      // Apply the chosen style to every model in the room sequentially.
      // The server broadcasts ar:new for each, so all students see every update.
      for (const manifest of manifests) {
        const styledUrl = await mlStylize({
          modelUrl: manifest.modelUrl,
          drawingUrl: manifest.textureUrl,
          styleChoice,
        });
        await emitAck("ar:restyle", {
          roomId,
          manifestId: manifest.manifestId,
          styledModelUrl: styledUrl,
        });
      }
    } catch (e) {
      setStyleError((e as Error).message);
    } finally {
      setStyling(false);
    }
  }

  // ── Render states ──────────────────────────────────────────────────────────

  if (!roomId) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <form
          className="card max-w-sm w-full space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const r = String(fd.get("room") || "").trim();
            if (r) setRoomId(r);
          }}
        >
          <h1 className="text-lg font-semibold">AR View</h1>
          <p className="text-sm text-white/70">Enter your room to load AR models.</p>
          <input name="room" className="w-full bg-white/10 rounded px-3 py-2" placeholder="room id" />
          <button className="btn-primary w-full" type="submit">
            Continue
          </button>
        </form>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="card text-red-300 max-w-sm text-sm">{error}</div>
      </main>
    );
  }

  if (!ready) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 text-white/60 text-sm">
        Connecting…
      </main>
    );
  }

  if (manifests.length === 0) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="card max-w-sm w-full text-center space-y-2">
          <p className="text-lg font-semibold">No AR models yet</p>
          <p className="text-sm text-white/60">
            Your teacher hasn&apos;t published any AR models yet. Check back soon!
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <ARViewer manifests={manifests} />

      {/* Style button — visible to any student once models are in the room */}
      <button
          onClick={() => setStylePickerOpen(true)}
          disabled={styling}
          className="absolute bottom-6 right-4 z-30 flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm font-medium text-white shadow-lg backdrop-blur-sm transition hover:bg-black/80 active:scale-95 disabled:opacity-50"
        >
          {styling ? (
            <>
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Styling…
            </>
          ) : (
            <>🎨 Style</>
          )}
        </button>

      {/* Error toast */}
      {styleError && (
        <div className="absolute bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-lg bg-red-900/80 px-4 py-2 text-xs text-red-200 backdrop-blur-sm">
          {styleError}
          <button onClick={() => setStyleError(null)} className="ml-3 opacity-60 hover:opacity-100">
            ✕
          </button>
        </div>
      )}

      {/* Style picker overlay */}
      {stylePickerOpen && (
        <StylePicker
          loading={styling}
          onSelect={applyStyle}
          onClose={() => setStylePickerOpen(false)}
        />
      )}
    </div>
  );
}
