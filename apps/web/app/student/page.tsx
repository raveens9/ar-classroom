"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CollabCanvas, type CanvasHandle } from "@/components/Canvas";
import { emitAck, getSocket } from "@/lib/socket";
import { KidButton } from "@/components/kid/KidButton";
import { KidStatusScreen } from "@/components/kid/KidStatusScreen";
import { QrScanner } from "@/components/QrScanner";
import { SoundToggle } from "@/components/kid/SoundToggle";
import { ConfettiBurst } from "@/components/kid/ConfettiBurst";
import { HoldButton } from "@/components/kid/HoldButton";
import { playPick, playTap, playYay } from "@/lib/kidSounds";
import type { ARManifest, ARRoomFeed, Room, StudentPresence } from "@ar/shared";

// White removed (invisible on the paper canvas); pink + near-black ink added.
const PALETTE = [
  "#ef4444", "#f97316", "#FFC53D", "#3FBF63",
  "#3b82f6", "#8B5CF6", "#F472B6", "#23233B",
];

// Three chunky presets instead of a slider — dot is the preview circle size.
const BRUSH_SIZES = [
  { value: 5, dot: 8 },
  { value: 12, dot: 16 },
  { value: 24, dot: 28 },
];

const SESSION_KEY = "ar-student-session";

interface StoredSession {
  studentId: string;
  studentName: string;
  classroomId: string;
  sessionId: string;
  socketRoomId: string | null;
  expiresAt: number;
}

export default function StudentPage() {
  const router = useRouter();
  const [ident, setIdent] = useState<{ id: string; name: string } | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string>("");
  const [room, setRoom] = useState<Room | null>(null);
  const [color, setColor] = useState("#3b82f6");
  const [size, setSize] = useState(12);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [arManifests, setArManifests] = useState<ARManifest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [waitingForRoom, setWaitingForRoom] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const arSeenRef = useRef(false);
  const canvasRef = useRef<CanvasHandle>(null);

  const join = async (overrideRoomId?: string, overrideIdent?: { id: string; name: string }) => {
    const rid = (overrideRoomId ?? roomId).trim();
    const id = overrideIdent ?? ident;
    if (!id || !rid) return;
    setError(null);
    try {
      const r = await emitAck("room:join", {
        roomId: rid,
        studentId: id.id,
        displayName: id.name,
      });
      setRoom(r);
      setWaitingForRoom(false);
    } catch {
      // Any join failure (room gone, server restarted, etc.) — clear the cached
      // session so the student is prompted to scan the QR code again.
      localStorage.removeItem(SESSION_KEY);
      setIdent(null);
      setRoom(null);
      setRoomId("");
      setSessionId(null);
      setWaitingForRoom(false);
    }
  };

  // Read stored session from localStorage on mount and auto-join if room is ready
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const stored: StoredSession = JSON.parse(raw);
        if (Date.now() < stored.expiresAt) {
          const newIdent = { id: stored.studentId, name: stored.studentName };
          setIdent(newIdent);
          setSessionId(stored.sessionId);
          if (stored.socketRoomId) {
            setRoomId(stored.socketRoomId);
            setWaitingForRoom(true); // show waiting screen while join is in flight
            join(stored.socketRoomId, newIdent);
          } else {
            setWaitingForRoom(true);
          }
          setSessionReady(true);
          return;
        }
        localStorage.removeItem(SESSION_KEY);
      }
    } catch {}
    setSessionReady(true);
  }, []);

  // Poll for socketRoomId when the room isn't ready yet
  useEffect(() => {
    if (!ident || !sessionId || roomId || room) return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/session-room?sessionId=${sessionId}`);
        const data: { socketRoomId: string | null } = await res.json();
        if (data.socketRoomId && !cancelled) {
          setRoomId(data.socketRoomId);
          // Update cached localStorage entry
          try {
            const raw = localStorage.getItem(SESSION_KEY);
            if (raw) {
              const stored = JSON.parse(raw);
              localStorage.setItem(SESSION_KEY, JSON.stringify({ ...stored, socketRoomId: data.socketRoomId }));
            }
          } catch {}
          join(data.socketRoomId, ident);
        }
      } catch {}
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [ident, sessionId, roomId, room]);

  useEffect(() => {
    const socket = getSocket();
    const onRoom = (r: Room) => {
      if (r.roomId === roomId) setRoom(r);
    };
    const onClosed = (p: { roomId: string }) => {
      if (p.roomId === roomId) setRoom(null);
    };
    socket.on("room:state", onRoom);
    socket.on("room:closed", onClosed);
    return () => {
      socket.off("room:state", onRoom);
      socket.off("room:closed", onClosed);
    };
  }, [roomId]);

  const me: StudentPresence | undefined = useMemo(
    () => room?.students.find((s) => s.studentId === ident?.id),
    [room, ident]
  );

  useEffect(() => {
    if (!room || !ident || me?.state !== "ADMITTED") return;
    const socket = getSocket();

    const onFeed = (feed: ARRoomFeed) => {
      if (feed.roomId !== room.roomId) return;
      setArManifests(feed.manifests);
    };
    const onNew = (m: ARManifest & { roomId: string }) => {
      if (m.roomId !== room.roomId) return;
      setArManifests((prev) => {
        const rest = prev.filter((x) => x.authorId !== m.authorId);
        return [...rest, m];
      });
    };

    socket.on("ar:feed", onFeed);
    socket.on("ar:new", onNew);

    emitAck("ar:subscribe", { roomId: room.roomId, studentId: ident.id })
      .then((feed) => setArManifests(feed.manifests))
      .catch(() => {});

    return () => {
      socket.off("ar:feed", onFeed);
      socket.off("ar:new", onNew);
    };
  }, [room?.roomId, ident?.id, me?.state]);

  const canDraw = !!(room && me?.state === "ADMITTED" && room.mode === "OPEN");
  const arAvailable = arManifests.length > 0;

  // Celebrate the moment AR models first arrive: sound + confetti + the AR
  // button popping in. Absence→arrival is far more noticeable to a toddler
  // than a greyed-out button turning colored.
  useEffect(() => {
    if (arAvailable && !arSeenRef.current) {
      arSeenRef.current = true;
      setCelebrate(true);
      playYay();
      const t = setTimeout(() => setCelebrate(false), 2600);
      return () => clearTimeout(t);
    }
    if (!arAvailable) arSeenRef.current = false;
    return undefined;
  }, [arAvailable]);

  const leaveRoom = () => {
    localStorage.removeItem(SESSION_KEY);
    setIdent(null);
    setRoom(null);
    setRoomId("");
    setSessionId(null);
    setWaitingForRoom(false);
  };

  const handleQrResult = (text: string) => {
    setScannerOpen(false);
    const trimmed = text.trim();
    if (!trimmed) return;

    try {
      const url = new URL(trimmed);
      if (url.origin === window.location.origin) {
        // Same-origin URL (e.g. /join/{token}) — navigate there so the roster
        // picker runs exactly the same flow as scanning the classroom QR.
        router.push(url.pathname + url.search);
        return;
      }
    } catch { /* not a URL — fall through */ }

    // Bare room ID fallback (only useful if already identified).
    if (!ident) return;
    setRoomId(trimmed);
    setWaitingForRoom(false);
    join(trimmed, ident);
  };

  if (!sessionReady) {
    return <KidStatusScreen visual="🖍️" caption="Connecting…" />;
  }

  if (scannerOpen) {
    return <QrScanner onResult={handleQrResult} onClose={() => setScannerOpen(false)} />;
  }

  if (!ident) {
    return (
      <KidStatusScreen visual="📷" title="Scan your classroom QR" bounce={false}>
        <KidButton onClick={() => setScannerOpen(true)}>
          Scan QR Code
        </KidButton>
      </KidStatusScreen>
    );
  }

  if (waitingForRoom && !room) {
    return (
      <KidStatusScreen
        visual="⏳"
        title={`Hi, ${ident.name}!`}
        caption="Waiting for your teacher to open the room…"
      >
        <KidButton onClick={() => setScannerOpen(true)}>
          📷 Scan Room Code
        </KidButton>
        <button
          onClick={leaveRoom}
          className="mt-2 text-sm text-kid-ink/40 transition-colors hover:text-kid-ink/70"
        >
          ← Go back
        </button>
      </KidStatusScreen>
    );
  }

  return (
    <main className="kid-page flex flex-col gap-3 p-3 sm:p-5">
      <header className="flex items-center justify-between gap-3">
        <div className="kid-card flex items-center gap-2 !p-2 px-4 text-xl font-bold">
          <span role="img" aria-hidden="true">👋</span> {ident.name}
        </div>
        <div className="flex items-center gap-2">
          <SoundToggle />
          <HoldButton onComplete={leaveRoom} title="Hold to leave the room" aria-label="Hold to leave the room">
            🚪
          </HoldButton>
        </div>
      </header>

      {error && (
        <div className="kid-card flex items-center gap-3 border-kid-coral text-base">
          <span className="text-2xl" role="img" aria-hidden="true">❗</span>
          <span>{error}</span>
        </div>
      )}

      {/* Canvas = white paper. AR button floats over it when models arrive. */}
      <div className="relative min-h-[52vh] flex-1">
        {room ? (
          <CollabCanvas
            ref={canvasRef}
            roomId={room.roomId}
            authorId={ident.id}
            canDraw={canDraw}
            tool={tool}
            color={color}
            size={size}
            className="h-full min-h-[52vh] w-full rounded-3xl border-[3px] border-kid-ink bg-white"
          />
        ) : (
          <div className="flex h-full min-h-[52vh] flex-col items-center justify-center gap-3 rounded-3xl border-[3px] border-dashed border-kid-ink/30">
            <div className="animate-kid-bounce text-6xl motion-reduce:animate-none" role="img" aria-hidden="true">🖍️</div>
            <p className="text-kid-ink/50">Connecting to room…</p>
          </div>
        )}

        {room && !canDraw && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-3xl bg-kid-paper/90 p-6 text-center">
            {me?.state === "WAITING" ? (
              <>
                <div className="animate-kid-bounce text-7xl motion-reduce:animate-none" role="img" aria-hidden="true">⏳</div>
                <p className="text-2xl font-bold">Almost time!</p>
                <p className="text-kid-ink/60">Your teacher will let you in soon.</p>
              </>
            ) : me?.state === "REMOVED" ? (
              <>
                <div className="text-7xl" role="img" aria-hidden="true">🙋</div>
                <p className="text-2xl font-bold">Hand me to a grown-up</p>
                <p className="text-kid-ink/60">You&apos;ve been removed from the room.</p>
              </>
            ) : (
              <>
                <div className="text-7xl" role="img" aria-hidden="true">😴</div>
                <p className="text-2xl font-bold">Drawing is asleep</p>
                <p className="text-kid-ink/60">Your teacher paused drawing for now.</p>
              </>
            )}
          </div>
        )}

        {room && arAvailable && (
          <a
            href={`/ar?room=${roomId}&id=${ident.id}`}
            onClick={() => playTap()}
            className="absolute right-3 top-3 z-20 block animate-kid-pop-in"
            aria-label="See your drawing in AR"
          >
            <span className="absolute inset-0 rounded-full bg-kid-sun animate-kid-pulse-ring motion-reduce:animate-none" aria-hidden="true" />
            <span className="kid-btn-icon relative h-20 w-20 bg-kid-sun text-4xl">✨</span>
          </a>
        )}
      </div>

      {/* Toolbar: chunky color dots, three brush sizes, eraser, one undo. */}
      {room && (
        <div className="kid-card flex flex-col items-center gap-3 !p-3">
          <div className="flex flex-wrap justify-center gap-2.5">
            {PALETTE.map((c) => {
              const active = color === c && tool === "pen";
              return (
                <button
                  key={c}
                  onClick={() => { setColor(c); setTool("pen"); playPick(); }}
                  aria-label={`Draw with ${c}`}
                  aria-pressed={active}
                  className={`h-[52px] w-[52px] rounded-full border-[3px] transition-transform motion-reduce:transition-none ${
                    active
                      ? "scale-110 border-kid-ink ring-4 ring-kid-sun"
                      : "border-kid-ink/20 active:scale-95"
                  }`}
                  style={{ backgroundColor: c }}
                />
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {BRUSH_SIZES.map((s) => {
              const active = size === s.value;
              return (
                <button
                  key={s.value}
                  onClick={() => { setSize(s.value); playPick(); }}
                  aria-label={`Brush size ${s.value}`}
                  aria-pressed={active}
                  className={`flex h-[52px] w-[52px] items-center justify-center rounded-full border-[3px] transition-transform motion-reduce:transition-none ${
                    active ? "border-kid-ink bg-kid-sun" : "border-kid-ink/20 bg-white active:scale-95"
                  }`}
                >
                  <span
                    className="rounded-full"
                    style={{
                      width: s.dot,
                      height: s.dot,
                      backgroundColor: tool === "eraser" ? "#B8B4D6" : color,
                    }}
                  />
                </button>
              );
            })}

            <div className="h-10 w-[3px] rounded-full bg-kid-ink/10" aria-hidden="true" />

            <KidButton
              icon
              aria-label="Eraser"
              aria-pressed={tool === "eraser"}
              className={tool === "eraser" ? "!bg-kid-sky" : ""}
              onClick={() => setTool((t) => (t === "eraser" ? "pen" : "eraser"))}
            >
              🧽
            </KidButton>
            <KidButton icon aria-label="Undo" onClick={() => canvasRef.current?.undo()}>
              ↩️
            </KidButton>
          </div>
        </div>
      )}

      {celebrate && <ConfettiBurst />}
    </main>
  );
}
