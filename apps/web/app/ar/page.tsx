"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { emitAck, getSocket } from "@/lib/socket";
import { resolveStudentId } from "@/lib/studentId";
import type { ARManifest, ARRoomFeed } from "@ar/shared";

// three.js has no SSR — make the viewer client-only.
const ARViewer = dynamic(() => import("@/components/ARViewer").then((m) => m.ARViewer), {
  ssr: false,
});

export default function ARPage() {
  const search = useSearchParams();
  const roomParam = search.get("room") ?? "";
  const idParam = search.get("id");
  const [roomId, setRoomId] = useState<string>(roomParam);
  const [studentId, setStudentId] = useState<string>("");
  const [manifests, setManifests] = useState<ARManifest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

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
      setManifests((prev) => {
        const rest = prev.filter((x) => x.authorId !== m.authorId);
        return [...rest, m];
      });
    };

    socket.on("ar:feed", onFeed);
    socket.on("ar:new", onNew);

    emitAck("ar:subscribe", { roomId, studentId })
      .then((feed) => {
        setManifests(feed.manifests);
        setReady(true);
      })
      .catch((e) => setError((e as Error).message));

    return () => {
      socket.off("ar:feed", onFeed);
      socket.off("ar:new", onNew);
    };
  }, [roomId, studentId]);

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

  return <ARViewer manifests={manifests} />;
}
