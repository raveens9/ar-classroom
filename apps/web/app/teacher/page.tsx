"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CollabCanvas, type CanvasHandle } from "@/components/Canvas";
import { emitAck, getSocket } from "@/lib/socket";
import { createClient } from "@/lib/supabase";
import {
  mlApproveGenerateAR,
  mlClassify,
  mlPrepareTextureModel,
  mlRemoveBackground,
} from "@/lib/mlApi";
import type { Room, RoomMode } from "@ar/shared";

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] ?? "image/png";
  const bytes = atob(data);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export default function TeacherPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("sessionId");

  const [teacherId, setTeacherId] = useState<string>("");
  const [room, setRoom] = useState<Room | null>(null);
  const [mode, setMode] = useState<RoomMode>("OPEN");
  const [watchedStudentId, setWatchedStudentId] = useState<string | null>(null);
  const [color, setColor] = useState("#f472b6");
  const [size, setSize] = useState(5);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<CanvasHandle>(null);

  const [prep, setPrep] = useState<{
    cutoutUrl?: string;
    label?: string;
    suggestedAnimation?: string;
    modelUrl?: string;
    textureUrl?: string;
  }>({});

  // Auto-recreate the room as soon as we have both the teacher ID and a session.
  // This is idempotent — the server returns the existing room if it's still alive,
  // or creates a fresh one (and we update the DB) if the server restarted.
  const hasAutoCreated = useRef(false);
  useEffect(() => {
    if (!teacherId || !sessionId || hasAutoCreated.current) return;
    hasAutoCreated.current = true;
    let cancelled = false;

    emitAck("room:create", { teacherId, mode: "OPEN" })
      .then(async (r) => {
        if (cancelled) return;
        setRoom(r);
        appendLog(`Room ready: ${r.roomId}`);
        const supabase = createClient();
        await supabase.from("sessions").update({ socket_room_id: r.roomId }).eq("id", sessionId);
      })
      .catch((e) => {
        if (!cancelled) appendLog(`ERR auto-create: ${(e as Error).message}`);
      });

    return () => { cancelled = true; };
  }, [teacherId, sessionId]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setTeacherId(data.user.id);
    });
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const onRoom = (r: Room) => {
      if (!room || r.roomId === room.roomId) setRoom(r);
    };
    socket.on("room:state", onRoom);
    return () => {
      socket.off("room:state", onRoom);
    };
  }, [room]);

  const createRoom = async () => {
    if (!teacherId) return;
    try {
      const r = await emitAck("room:create", { teacherId, mode });
      setRoom(r);
      appendLog(`Created room ${r.roomId} (${r.mode})`);

      if (sessionId) {
        const supabase = createClient();
        await supabase.from("sessions").update({ socket_room_id: r.roomId }).eq("id", sessionId);
      }
    } catch (e) {
      appendLog(`ERR: ${(e as Error).message}`);
    }
  };

  const setRoomMode = async (m: RoomMode) => {
    setMode(m);
    if (!room) return;
    try {
      const r = await emitAck("room:create", { teacherId, mode: m });
      setRoom(r);
      appendLog(`Room mode → ${m}`);
    } catch (e) {
      appendLog(`ERR: ${(e as Error).message}`);
    }
  };

  const admit = async (studentId: string) => {
    if (!room) return;
    try {
      const r = await emitAck("room:admit", { roomId: room.roomId, studentId });
      setRoom(r);
    } catch (e) {
      appendLog(`ERR admit: ${(e as Error).message}`);
    }
  };

  const remove = async (studentId: string) => {
    if (!room) return;
    try {
      const r = await emitAck("room:remove", { roomId: room.roomId, studentId });
      setRoom(r);
      if (watchedStudentId === studentId) setWatchedStudentId(null);
    } catch (e) {
      appendLog(`ERR remove: ${(e as Error).message}`);
    }
  };

  const watch = (studentId: string) => {
    setWatchedStudentId(studentId);
    appendLog(`Watching ${studentId}`);
  };

  const appendLog = (line: string) =>
    setLog((l) => [`[${new Date().toLocaleTimeString()}] ${line}`, ...l].slice(0, 50));

  const signOut = async () => {
    await createClient().auth.signOut();
    router.push("/login");
  };

  const exportCanvas = (): string | null => {
    const fn = (window as unknown as { __canvasExport?: () => string }).__canvasExport;
    return fn ? fn() : null;
  };

  const doRemoveBg = async () => {
    if (!watchedStudentId) return;
    const dataUrl = exportCanvas();
    if (!dataUrl) return appendLog("No canvas to export");
    setBusy(true);
    try {
      const r = await mlRemoveBackground(dataUrl, watchedStudentId);
      setPrep((p) => ({ ...p, cutoutUrl: r.cutoutUrl }));
      appendLog(`Remove BG OK → ${r.cutoutId}`);
      const c = await mlClassify(r.cutoutUrl, watchedStudentId);
      const suggested = c.suggestedAnimation;
      setPrep((p) => ({ ...p, label: c.label, suggestedAnimation: suggested }));
      appendLog(`Classify → ${c.label} (${c.confidence})`);
      const t = await mlPrepareTextureModel({
        cutoutUrl: r.cutoutUrl,
        label: c.label,
        studentId: watchedStudentId,
        animationName: suggested,
      });
      setPrep((p) => ({ ...p, modelUrl: t.modelUrl, textureUrl: t.textureUrl }));
      appendLog(`Prepared model ${t.modelUrl}`);
    } catch (e) {
      appendLog(`ERR ML: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const doApprove = async () => {
    if (!room || !watchedStudentId || !prep.modelUrl) return;
    setBusy(true);
    try {
      const student = room.students.find((s) => s.studentId === watchedStudentId);
      const r = await mlApproveGenerateAR({
        roomId: room.roomId,
        studentId: watchedStudentId,
        authorId: watchedStudentId,
        authorName: student?.displayName,
        modelUrl: prep.modelUrl,
        textureUrl: prep.textureUrl,
        animationName: prep.suggestedAnimation,
        label: prep.label,
      });
      await emitAck("ar:publish", { roomId: room.roomId, manifest: r.manifest });
      appendLog(`Published AR for ${watchedStudentId}`);

      // Persist drawing to Supabase
      if (sessionId) {
        try {
          const supabase = createClient();
          const dataUrl = exportCanvas();
          if (dataUrl) {
            const blob = dataUrlToBlob(dataUrl);
            const path = `${sessionId}/${watchedStudentId}-${Date.now()}.png`;
            await supabase.storage.from("drawings").upload(path, blob, { contentType: "image/png" });
            const { data: { publicUrl } } = supabase.storage.from("drawings").getPublicUrl(path);
            await supabase.from("drawings").insert({
              session_id: sessionId,
              student_id: watchedStudentId,
              canvas_png_url: publicUrl,
              cutout_url: prep.cutoutUrl,
              ar_manifest: r.manifest,
            });
            appendLog("Drawing saved");
          }
        } catch (e) {
          appendLog(`ERR save: ${(e as Error).message}`);
        }
      }

      setPrep({});
    } catch (e) {
      appendLog(`ERR publish: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const waiting = useMemo(
    () => (room ? room.students.filter((s) => s.state === "WAITING") : []),
    [room]
  );
  const admitted = useMemo(
    () => (room ? room.students.filter((s) => s.state === "ADMITTED") : []),
    [room]
  );

  return (
    <main className="min-h-screen p-4 md:p-8 grid gap-4 lg:grid-cols-[320px_1fr]">
      <aside className="space-y-4">
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <Link href="/dashboard" className="text-xs text-white/40 hover:text-white/70 transition-colors">
              ← Dashboard
            </Link>
            <button onClick={signOut} className="text-xs text-white/40 hover:text-white/70 transition-colors">
              Sign out
            </button>
          </div>
          <h1 className="text-lg font-semibold">Teacher</h1>
          <p className="text-xs text-white/50 break-all">id: {teacherId}</p>
          {sessionId && <p className="text-xs text-white/30">session: {sessionId}</p>}
          {!room ? (
            <div className="mt-3 flex gap-2">
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as RoomMode)}
                className="bg-white/10 rounded px-2 py-1 text-sm"
              >
                <option value="OPEN">OPEN</option>
                <option value="CLOSED">CLOSED</option>
              </select>
              <button className="btn-primary" onClick={createRoom}>
                Create room
              </button>
            </div>
          ) : (
            <div className="mt-3 text-sm space-y-2">
              <div>
                Room <span className="font-mono">{room.roomId}</span>
              </div>
              <div className="flex gap-2">
                <button
                  className={room.mode === "OPEN" ? "btn-primary" : "btn-ghost"}
                  onClick={() => setRoomMode("OPEN")}
                >
                  OPEN
                </button>
                <button
                  className={room.mode === "CLOSED" ? "btn-primary" : "btn-ghost"}
                  onClick={() => setRoomMode("CLOSED")}
                >
                  CLOSED
                </button>
              </div>
            </div>
          )}
        </div>

        {room && (
          <>
            <div className="card">
              <h2 className="font-medium mb-2">Waiting ({waiting.length})</h2>
              <ul className="space-y-2">
                {waiting.map((s) => (
                  <li key={s.studentId} className="flex items-center justify-between text-sm">
                    <span>{s.displayName}</span>
                    <div className="flex gap-2">
                      <button className="btn-primary" onClick={() => admit(s.studentId)}>
                        Admit
                      </button>
                      <button className="btn-danger" onClick={() => remove(s.studentId)}>
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
                {waiting.length === 0 && <li className="text-white/50 text-sm">No one waiting.</li>}
              </ul>
            </div>

            <div className="card">
              <h2 className="font-medium mb-2">Admitted ({admitted.length})</h2>
              <ul className="space-y-2">
                {admitted.map((s) => (
                  <li key={s.studentId} className="flex items-center justify-between text-sm">
                    <span className={watchedStudentId === s.studentId ? "text-brand font-medium" : ""}>
                      {s.displayName}
                    </span>
                    <div className="flex gap-2">
                      <button className="btn-ghost" onClick={() => watch(s.studentId)}>
                        Watch
                      </button>
                      <button className="btn-danger" onClick={() => remove(s.studentId)}>
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
                {admitted.length === 0 && (
                  <li className="text-white/50 text-sm">No one admitted.</li>
                )}
              </ul>
            </div>

            {watchedStudentId && (
              <div className="card space-y-2">
                <h2 className="font-medium">ML Pipeline</h2>
                <button className="btn-primary w-full" onClick={doRemoveBg} disabled={busy}>
                  {busy ? "Working…" : "Remove BG + Classify + Prepare"}
                </button>
                <button
                  className="btn-primary w-full"
                  onClick={doApprove}
                  disabled={busy || !prep.modelUrl}
                >
                  Approve & Publish AR
                </button>
                {prep.label && (
                  <p className="text-xs text-white/60">
                    label: <strong>{prep.label}</strong>
                    {prep.suggestedAnimation ? ` · anim: ${prep.suggestedAnimation}` : ""}
                  </p>
                )}
              </div>
            )}

            <div className="card space-y-2">
              <h2 className="font-medium text-sm">Classroom AR</h2>
              <a
                href="/arjs/hiro.png"
                target="_blank"
                rel="noreferrer"
                className="btn-ghost w-full text-xs"
              >
                Print Hiro marker →
              </a>
              <p className="text-xs text-white/40">
                Students point their camera at this marker to see all models anchored together.
              </p>
            </div>

            <div className="card">
              <h2 className="font-medium mb-2">Log</h2>
              <ul className="text-xs text-white/60 space-y-1 max-h-48 overflow-auto">
                {log.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          </>
        )}
      </aside>

      <section className="card min-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <h2 className="font-medium">
            {watchedStudentId ? `Watching: ${watchedStudentId}` : "Select a student to watch"}
          </h2>
          <div className="flex items-center gap-3 text-sm flex-wrap">
            <label className="flex items-center gap-2">
              <span>Color</span>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            </label>
            <label className="flex items-center gap-2">
              <span>Size</span>
              <input
                type="range"
                min={1}
                max={32}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
              />
            </label>
            <div className="flex gap-1">
              <button className={tool === "pen" ? "btn-primary" : "btn-ghost"} onClick={() => setTool("pen")}>
                Pen
              </button>
              <button className={tool === "eraser" ? "btn-primary" : "btn-ghost"} onClick={() => setTool("eraser")}>
                Eraser
              </button>
            </div>
            <div className="flex gap-1">
              <button className="btn-ghost" onClick={() => canvasRef.current?.undo()}>Undo</button>
              <button className="btn-ghost" onClick={() => canvasRef.current?.redo()}>Redo</button>
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-[60vh]">
          {room && watchedStudentId && teacherId ? (
            <CollabCanvas
              key={watchedStudentId}
              ref={canvasRef}
              roomId={room.roomId}
              authorId={teacherId}
              syncStudentId={watchedStudentId}
              canDraw={true}
              tool={tool}
              color={color}
              size={size}
              onExport={() => {}}
              className="w-full h-full bg-black/40 rounded-md"
            />
          ) : (
            <div className="h-full flex items-center justify-center text-white/50 text-sm">
              Pick a student from the Admitted list.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
