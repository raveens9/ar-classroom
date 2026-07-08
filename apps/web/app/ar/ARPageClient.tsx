"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { emitAck, getSocket } from "@/lib/socket";
import { resolveStudentId } from "@/lib/studentId";
import { mlStylize } from "@/lib/mlApi";
import { StylePicker } from "@/components/StylePicker";
import { KidButton } from "@/components/kid/KidButton";
import { KidStatusScreen } from "@/components/kid/KidStatusScreen";
import { SoundToggle } from "@/components/kid/SoundToggle";
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

  const [manifests, setManifests] = useState<ARManifest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);         // socket subscription ready
  const [studentReady, setStudentReady] = useState(false); // student clicked "I'm Ready"

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
      setReady(false);
      setStudentReady(false);
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
    const myManifest = manifests.find((m) => m.authorId === studentId);
    if (styling || !myManifest) return;
    setStyling(true);
    setStylePickerOpen(false);
    setStyleError(null);
    try {
      const styledUrl = await mlStylize({
        modelUrl: myManifest.modelUrl,
        drawingUrl: myManifest.textureUrl,
        styleChoice,
      });
      await emitAck("ar:restyle", {
        roomId,
        manifestId: myManifest.manifestId,
        styledModelUrl: styledUrl,
      });
    } catch (e) {
      setStyleError((e as Error).message);
    } finally {
      setStyling(false);
    }
  }

  async function handleReady() {
    setStudentReady(true);
    // Best-effort — don't block if the emit fails
    emitAck("ar:student-ready", { roomId, studentId }).catch(() => {});
  }

  // ── Render states ──────────────────────────────────────────────────────────

  // Manual room entry — an adult recovery path, so it keeps its text but wears
  // the kid theme.
  if (!roomId) {
    return (
      <main className="kid-page flex items-center justify-center p-6">
        <form
          className="kid-card w-full max-w-sm space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const r = String(fd.get("room") || "").trim();
            if (r) setRoomId(r);
          }}
        >
          <h1 className="text-2xl font-bold">AR View</h1>
          <p className="text-kid-ink/60">Enter your room to load AR models.</p>
          <input
            name="room"
            className="w-full rounded-2xl border-[3px] border-kid-ink/30 bg-white px-4 py-3 text-lg outline-none focus:border-kid-ink"
            placeholder="room id"
          />
          <KidButton className="w-full bg-kid-sun" type="submit">Continue</KidButton>
        </form>
      </main>
    );
  }

  if (error) {
    return (
      <KidStatusScreen visual="🙈" title="Uh oh!" caption={error} bounce={false}>
        <KidButton className="bg-kid-sun" onClick={() => window.location.reload()}>
          🔄 Try again
        </KidButton>
      </KidStatusScreen>
    );
  }

  if (!ready) {
    return <KidStatusScreen visual="🪄" caption="Connecting…" />;
  }

  if (manifests.length === 0) {
    return (
      <KidStatusScreen
        visual="🎁"
        title="Not ready yet!"
        caption="Your teacher is still making the magic. It will appear here on its own — keep waiting!"
      />
    );
  }

  // Pre-AR staging screen — one giant "go" button; styling is an optional
  // side-quest behind the paintbrush.
  if (!studentReady) {
    return (
      <main className="kid-page relative flex flex-col items-center justify-center gap-6 p-6 text-center">
        <div className="absolute right-4 top-4">
          <SoundToggle />
        </div>

        <div className="animate-kid-bounce text-8xl motion-reduce:animate-none" role="img" aria-hidden="true">🪄</div>
        <h1 className="text-3xl font-bold">Your drawing is ready!</h1>

        <KidButton
          className="min-h-[80px] bg-kid-sun px-10 text-2xl"
          disabled={styling}
          onClick={handleReady}
        >
          {styling ? "Painting…" : "✨ See the magic!"}
        </KidButton>

        <KidButton
          icon
          aria-label="Paint your model a different look"
          disabled={styling}
          onClick={() => setStylePickerOpen(true)}
        >
          🖌️
        </KidButton>

        {styling && (
          <p className="flex items-center gap-2 text-kid-ink/60">
            <span className="inline-block animate-kid-bounce text-2xl motion-reduce:animate-none" role="img" aria-hidden="true">🎨</span>
            Painting your model…
          </p>
        )}
        {styleError && <p className="max-w-xs text-sm text-kid-coral">{styleError}</p>}

        {/* Style picker slides up over the staging screen */}
        {stylePickerOpen && (
          <StylePicker
            loading={styling}
            onSelect={applyStyle}
            onClose={() => setStylePickerOpen(false)}
          />
        )}
      </main>
    );
  }

  // Student is ready — show the full AR viewer.
  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <ARViewer manifests={manifests} />
    </div>
  );
}
