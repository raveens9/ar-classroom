"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CollabCanvas, type CanvasHandle } from "@/components/Canvas";
import { emitAck, getSocket } from "@/lib/socket";
import type { ARManifest, ARRoomFeed, Room, StudentPresence } from "@ar/shared";

const PALETTE = [
  "#ef4444", "#f97316", "#fbbf24", "#22c55e",
  "#3b82f6", "#a855f7", "#1a1a1a", "#ffffff",
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
  const [ident, setIdent] = useState<{ id: string; name: string } | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string>("");
  const [room, setRoom] = useState<Room | null>(null);
  const [color, setColor] = useState("#3b82f6");
  const [size, setSize] = useState(6);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [arManifests, setArManifests] = useState<ARManifest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [waitingForRoom, setWaitingForRoom] = useState(false);
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
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "Room not found") {
        // The cached roomId is stale (server restarted). Clear it and fall into
        // the polling loop — it will pick up the new roomId once the teacher's
        // page has auto-recreated the room and updated the database.
        setRoomId("");
        setWaitingForRoom(true);
        try {
          const raw = localStorage.getItem(SESSION_KEY);
          if (raw) {
            const stored = JSON.parse(raw);
            localStorage.setItem(SESSION_KEY, JSON.stringify({ ...stored, socketRoomId: null }));
          }
        } catch {}
      } else {
        setError(msg);
      }
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

  const leaveRoom = () => {
    localStorage.removeItem(SESSION_KEY);
    setIdent(null);
    setRoom(null);
    setRoomId("");
    setSessionId(null);
    setWaitingForRoom(false);
  };

  if (!sessionReady) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#0b0b12]">
        <p className="text-white/40">Connecting…</p>
      </main>
    );
  }

  if (!ident) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-[#0b0b12] gap-4 p-6 text-center">
        <div className="text-6xl">📷</div>
        <h1 className="text-2xl font-semibold text-white">Scan the classroom QR code</h1>
        <p className="text-white/50 max-w-xs">
          Ask your aide to scan the QR code in your classroom to get started.
        </p>
      </main>
    );
  }

  if (waitingForRoom && !room) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-[#0b0b12] gap-4 p-6 text-center">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        <h1 className="text-xl font-semibold text-white">Hi, {ident.name}!</h1>
        <p className="text-white/50">Waiting for your teacher to open the room…</p>
        <button onClick={leaveRoom} className="text-sm text-white/30 hover:text-white/60 transition-colors mt-2">
          ← Go back
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 md:p-8 flex flex-col gap-4">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Hi, {ident.name}!</h1>
          <button
            onClick={leaveRoom}
            className="text-xs text-white/30 hover:text-white/60 transition-colors"
            title="Leave room and return to QR scan screen"
          >
            Leave
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => { setColor(c); setTool("pen"); }}
                title={c}
                className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none"
                style={{
                  backgroundColor: c,
                  borderColor: color === c && tool === "pen" ? "#fff" : "transparent",
                  transform: color === c && tool === "pen" ? "scale(1.2)" : undefined,
                }}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => { setColor(e.target.value); setTool("pen"); }}
              className="w-7 h-7 rounded cursor-pointer border-0 p-0 bg-transparent"
              title="Custom colour"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <span>Size</span>
            <input type="range" min={2} max={28} value={size} onChange={(e) => setSize(Number(e.target.value))} />
          </label>

          <div className="flex gap-1">
            <button className={tool === "pen" ? "btn-primary" : "btn-ghost"} onClick={() => setTool("pen")}>Pen</button>
            <button className={tool === "eraser" ? "btn-primary" : "btn-ghost"} onClick={() => setTool("eraser")}>Eraser</button>
          </div>

          <div className="flex gap-1">
            <button className="btn-ghost" onClick={() => canvasRef.current?.undo()}>Undo</button>
            <button className="btn-ghost" onClick={() => canvasRef.current?.redo()}>Redo</button>
          </div>

          {arAvailable ? (
            <a href={`/ar?room=${roomId}&id=${ident.id}`} className="btn-primary">Open AR view</a>
          ) : (
            <span className="btn-ghost opacity-50 cursor-not-allowed select-none" title="Waiting for teacher to publish AR models">
              Open AR view
            </span>
          )}
        </div>
      </header>

      {error && <div className="card border-red-500/40 text-red-300 text-sm">{error}</div>}

      {room && (
        <div className="text-xs text-white/30 -mt-2">
          Room {room.roomId} · {room.mode} ·{" "}
          <span className={me?.state === "ADMITTED" ? "text-green-400" : me?.state === "REMOVED" ? "text-red-400" : "text-yellow-400"}>
            {me?.state ?? "joining…"}
          </span>
        </div>
      )}

      <div className="flex-1 min-h-[60vh]">
        {ident && room && (
          <CollabCanvas
            ref={canvasRef}
            roomId={room.roomId}
            authorId={ident.id}
            canDraw={canDraw}
            tool={tool}
            color={color}
            size={size}
            className="w-full h-[70vh] bg-black/40 rounded-md"
          />
        )}
        {!room && (
          <div className="h-[70vh] flex items-center justify-center text-white/40 text-sm">
            Connecting to room…
          </div>
        )}
      </div>

      {room && !canDraw && (
        <div className="card text-sm text-white/70">
          {me?.state === "WAITING"
            ? "Waiting for your teacher to admit you…"
            : me?.state === "REMOVED"
            ? "You've been removed from the room."
            : "Room is closed for drawing."}
        </div>
      )}
    </main>
  );
}
