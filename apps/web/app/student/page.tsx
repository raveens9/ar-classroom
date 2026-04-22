"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CollabCanvas, type CanvasHandle } from "@/components/Canvas";
import { emitAck, getSocket } from "@/lib/socket";
import { resolveStudentId, setStudentName } from "@/lib/studentId";
import type { ARManifest, ARRoomFeed, Room, StudentPresence } from "@ar/shared";

const PALETTE = [
  "#ef4444",
  "#f97316",
  "#fbbf24",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#1a1a1a",
  "#ffffff",
];

export default function StudentPage() {
  const search = useSearchParams();
  const urlId = search.get("id");
  const urlRoom = search.get("room");
  const [ident, setIdent] = useState<{ id: string; name: string } | null>(null);
  const [roomId, setRoomId] = useState<string>(urlRoom ?? "");
  const [room, setRoom] = useState<Room | null>(null);
  const [color, setColor] = useState("#3b82f6");
  const [size, setSize] = useState(6);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [arManifests, setArManifests] = useState<ARManifest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<CanvasHandle>(null);

  // Resolve identity on mount (client only).
  useEffect(() => {
    const r = resolveStudentId(urlId);
    setIdent({ id: r.id, name: r.name });
  }, [urlId]);

  // Subscribe to room state updates.
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

  // Subscribe to AR feed once admitted so the AR button activates when teacher publishes.
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

  const join = async () => {
    if (!ident || !roomId.trim()) return;
    setError(null);
    try {
      const r = await emitAck("room:join", {
        roomId: roomId.trim(),
        studentId: ident.id,
        displayName: ident.name,
      });
      setRoom(r);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const canDraw = !!(room && me?.state === "ADMITTED" && room.mode === "OPEN");
  const arAvailable = arManifests.length > 0;

  return (
    <main className="min-h-screen p-4 md:p-8 flex flex-col gap-4">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold">Student · {ident?.name ?? "…"}</h1>
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <input
            className="bg-white/10 rounded px-3 py-2 text-sm w-36"
            placeholder="room id"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          />
          <button className="btn-primary" onClick={join} disabled={!ident || !roomId.trim()}>
            Join
          </button>
          <input
            className="bg-white/10 rounded px-3 py-2 text-sm w-40"
            placeholder="display name"
            defaultValue={ident?.name ?? ""}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (!v || !ident) return;
              setStudentName(v);
              setIdent({ ...ident, name: v });
            }}
          />
        </div>
      </header>

      {error && <div className="card border-red-500/40 text-red-300 text-sm">{error}</div>}

      {!room && (
        <div className="card">
          <p className="text-white/70">
            Enter the room ID your teacher shared, then press <strong>Join</strong>. You'll appear in
            their waiting list; once admitted you can draw.
          </p>
        </div>
      )}

      {room && (
        <>
          {/* Status + all controls in one bar */}
          <div className="card flex items-center justify-between flex-wrap gap-3">
            <div className="text-sm">
              Room <span className="font-mono">{room.roomId}</span> · mode <strong>{room.mode}</strong> ·
              you are{" "}
              <strong
                className={
                  me?.state === "ADMITTED"
                    ? "text-green-400"
                    : me?.state === "REMOVED"
                    ? "text-red-400"
                    : "text-yellow-400"
                }
              >
                {me?.state ?? "…"}
              </strong>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {/* Color palette */}
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
                {/* Custom color picker */}
                <input
                  type="color"
                  value={color}
                  onChange={(e) => { setColor(e.target.value); setTool("pen"); }}
                  className="w-7 h-7 rounded cursor-pointer border-0 p-0 bg-transparent"
                  title="Custom colour"
                />
              </div>

              {/* Brush size */}
              <label className="flex items-center gap-2 text-sm">
                <span>Size</span>
                <input
                  type="range"
                  min={2}
                  max={28}
                  value={size}
                  onChange={(e) => setSize(Number(e.target.value))}
                />
              </label>

              {/* Tool toggle */}
              <div className="flex gap-1">
                <button
                  className={tool === "pen" ? "btn-primary" : "btn-ghost"}
                  onClick={() => setTool("pen")}
                >
                  Pen
                </button>
                <button
                  className={tool === "eraser" ? "btn-primary" : "btn-ghost"}
                  onClick={() => setTool("eraser")}
                >
                  Eraser
                </button>
              </div>

              {/* Undo / Redo */}
              <div className="flex gap-1">
                <button className="btn-ghost" onClick={() => canvasRef.current?.undo()}>
                  Undo
                </button>
                <button className="btn-ghost" onClick={() => canvasRef.current?.redo()}>
                  Redo
                </button>
              </div>

              {/* AR view button — lives in the top bar, only active after teacher publishes */}
              {arAvailable ? (
                <a
                  href={`/ar?room=${room.roomId}&id=${ident?.id ?? ""}`}
                  className="btn-primary"
                >
                  Open AR view
                </a>
              ) : (
                <span
                  className="btn-ghost opacity-50 cursor-not-allowed select-none"
                  title="Waiting for your teacher to publish AR models"
                >
                  Open AR view
                </span>
              )}
            </div>
          </div>

          <div className="flex-1 min-h-[60vh]">
            {ident && (
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
          </div>

          {!canDraw && (
            <div className="card text-sm text-white/70">
              {me?.state === "WAITING"
                ? "Waiting for your teacher to admit you…"
                : me?.state === "REMOVED"
                ? "You've been removed from the room."
                : "Room is closed for drawing."}
            </div>
          )}
        </>
      )}
    </main>
  );
}
