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
import { QRCodeSVG } from "qrcode.react";
import type { Room, RoomMode, Topic } from "@ar/shared";

// Labels available in the prepare-texture model registry, grouped by topic.
const TOPIC_LABELS: Record<string, string[]> = {
  animals:  ["butterfly", "cat", "dog", "fish", "dragon", "dinosaur", "robot", "bird"],
  nature:   ["cloud", "flower", "rain", "rainbow", "sun", "tree"],
};

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
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [mode, setMode] = useState<RoomMode>("OPEN");
  const [topic, setTopic] = useState<Topic>("animals");
  const [watchedStudentId, setWatchedStudentId] = useState<string | null>(null);
  const [color, setColor] = useState("#f472b6");
  const [size, setSize] = useState(5);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<CanvasHandle>(null);

  // Pipeline state — each field is set as the corresponding step completes.
  const [prep, setPrep] = useState<{
    cutoutUrl?: string;
    label?: string;       // predicted 3D model label from classifier
    confidence?: number;
    suggestedAnimation?: string;
    modelUrl?: string;
    textureUrl?: string;
  }>({});

  // Teacher override: starts as the classifier's prediction; teacher can change it.
  const [selectedLabel, setSelectedLabel] = useState<string>("");

  // Track which students have signalled AR-ready from the /ar page.
  const [arReadyStudents, setArReadyStudents] = useState<Set<string>>(new Set());

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setTeacherId(data.user.id);
    });
  }, []);

  // Fetch the classroom's permanent qr_token so the room QR leads to the roster.
  useEffect(() => {
    if (!sessionId) return;
    const supabase = createClient();
    supabase
      .from("sessions")
      .select("classrooms(qr_token)")
      .eq("id", sessionId)
      .single()
      .then(({ data }) => {
        const cls = data?.classrooms as { qr_token: string } | { qr_token: string }[] | null;
        const token = cls ? (Array.isArray(cls) ? cls[0]?.qr_token : cls.qr_token) : undefined;
        if (token) setQrToken(token);
      });
  }, [sessionId]);

  useEffect(() => {
    const socket = getSocket();
    const onRoom = (r: Room) => {
      if (!room || r.roomId === room.roomId) setRoom(r);
    };
    socket.on("room:state", onRoom);
    return () => { socket.off("room:state", onRoom); };
  }, [room]);

  // Listen for students signalling they are ready in the AR view.
  useEffect(() => {
    if (!room) return;
    const socket = getSocket();
    const onStudentReady = (p: { roomId: string; studentId: string }) => {
      if (p.roomId !== room.roomId) return;
      setArReadyStudents((prev) => new Set([...prev, p.studentId]));
    };
    socket.on("ar:student-ready", onStudentReady);
    return () => { socket.off("ar:student-ready", onStudentReady); };
  }, [room]);

  // Reset pipeline state whenever the teacher switches to a different student.
  useEffect(() => {
    setPrep({});
    setSelectedLabel("");
  }, [watchedStudentId]);

  const createRoom = async () => {
    if (!teacherId) return;
    try {
      const r = await emitAck("room:create", { teacherId, mode, topic });
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

  const endSession = async () => {
    if (!room) return;
    if (!confirm("End the session? Students will be disconnected.")) return;
    setBusy(true);
    try {
      await emitAck("room:close", { roomId: room.roomId });
      if (sessionId) {
        const supabase = createClient();
        await supabase.from("sessions").update({ ended_at: new Date().toISOString() }).eq("id", sessionId);
      }
      appendLog("Session ended");
      router.push("/dashboard");
    } catch (e) {
      appendLog(`ERR end: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const setRoomMode = async (m: RoomMode) => {
    setMode(m);
    if (!room) return;
    try {
      const r = await emitAck("room:create", { teacherId, mode: m, topic: room?.topic ?? topic });
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

  // Step 1: Remove background + classify. Sets cutoutUrl, predicted label, confidence.
  const doClassify = async () => {
    if (!watchedStudentId) return;
    const dataUrl = exportCanvas();
    if (!dataUrl) return appendLog("No canvas to export");
    setBusy(true);
    try {
      const r = await mlRemoveBackground(dataUrl, watchedStudentId);
      setPrep((p) => ({ ...p, cutoutUrl: r.cutoutUrl }));
      appendLog(`Remove BG OK → ${r.cutoutId}`);

      const c = await mlClassify(r.cutoutUrl, watchedStudentId, room?.topic ?? "animals");
      setPrep((p) => ({
        ...p,
        label: c.label,
        confidence: c.confidence,
        suggestedAnimation: c.suggestedAnimation,
        // Clear any previous prepare result so step 2 must re-run with new label.
        modelUrl: undefined,
        textureUrl: undefined,
      }));
      setSelectedLabel(c.label);
      appendLog(`Classify → ${c.label} (${Math.round(c.confidence * 100)}%)`);
    } catch (e) {
      appendLog(`ERR ML: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Step 2: Prepare model using the teacher's chosen label (override or classifier result).
  const doPrepare = async () => {
    if (!watchedStudentId || !prep.cutoutUrl || !selectedLabel) return;
    setBusy(true);
    try {
      const t = await mlPrepareTextureModel({
        cutoutUrl: prep.cutoutUrl,
        label: selectedLabel,
        studentId: watchedStudentId,
        animationName: prep.suggestedAnimation,
      });
      setPrep((p) => ({ ...p, modelUrl: t.modelUrl, textureUrl: t.textureUrl }));
      appendLog(`Prepared model ${t.modelUrl}`);
      if (selectedLabel !== prep.label) appendLog(`Label overridden: ${prep.label} → ${selectedLabel}`);
    } catch (e) {
      appendLog(`ERR prepare: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Step 3: Approve and publish to all students via socket.
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
        label: selectedLabel || prep.label,
      });
      await emitAck("ar:publish", { roomId: room.roomId, manifest: r.manifest });
      appendLog(`Published AR for ${watchedStudentId}`);

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
      setSelectedLabel("");
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

  const availableLabels = TOPIC_LABELS[room?.topic ?? "animals"] ?? TOPIC_LABELS.animals;

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
            <div className="mt-3 space-y-2">
              <div className="flex gap-2">
                <select
                  value={topic}
                  onChange={(e) => setTopic(e.target.value as Topic)}
                  className="bg-white/10 rounded px-2 py-1 text-sm flex-1"
                >
                  <option value="animals">Animals</option>
                  <option value="nature">Nature</option>
                </select>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as RoomMode)}
                  className="bg-white/10 rounded px-2 py-1 text-sm"
                >
                  <option value="OPEN">OPEN</option>
                  <option value="CLOSED">CLOSED</option>
                </select>
              </div>
              <button className="btn-primary w-full" onClick={createRoom}>
                Create room
              </button>
            </div>
          ) : (
            <div className="mt-3 text-sm space-y-2">
              <div>
                Room <span className="font-mono">{room.roomId}</span>
              </div>
              <div className="text-xs text-white/50">
                Topic: <span className="capitalize text-white/80">{room.topic === "nature" ? "Nature" : "Animals"}</span>
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
              <button className="btn-danger w-full mt-1" onClick={endSession} disabled={busy}>
                End session
              </button>
              {/* QR code — links to the classroom roster (/join/{token}) so
                  students pick their name from the roster, same as the permanent
                  classroom QR. Falls back to a direct room URL if no session. */}
              <div className="pt-3 border-t border-white/10 text-center space-y-2">
                <p className="text-xs text-white/40">Student join QR</p>
                <div className="flex justify-center rounded-xl bg-white p-3">
                  <QRCodeSVG
                    value={
                      qrToken
                        ? `${window.location.origin}/join/${qrToken}`
                        : `${window.location.origin}/student?room=${room.roomId}`
                    }
                    size={148}
                    level="M"
                  />
                </div>
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
                      <button className="btn-primary" onClick={() => admit(s.studentId)}>Admit</button>
                      <button className="btn-danger" onClick={() => remove(s.studentId)}>Remove</button>
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
                      {arReadyStudents.has(s.studentId) && (
                        <span className="ml-2 text-xs text-green-400 font-normal">AR Ready</span>
                      )}
                    </span>
                    <div className="flex gap-2">
                      <button className="btn-ghost" onClick={() => watch(s.studentId)}>Watch</button>
                      <button className="btn-danger" onClick={() => remove(s.studentId)}>Remove</button>
                    </div>
                  </li>
                ))}
                {admitted.length === 0 && (
                  <li className="text-white/50 text-sm">No one admitted.</li>
                )}
              </ul>
            </div>

            {watchedStudentId && (
              <div className="card space-y-3">
                <h2 className="font-medium">ML Pipeline</h2>

                {/* Step 1 */}
                <button
                  className="btn-primary w-full"
                  onClick={doClassify}
                  disabled={busy}
                >
                  {busy && !prep.label ? "Classifying…" : "1. Classify Drawing"}
                </button>

                {/* Step 2 — shown after classify */}
                {prep.cutoutUrl && prep.label && (
                  <div className="space-y-2 border-t border-white/10 pt-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/50">Predicted</span>
                      <span>
                        <strong className="text-white capitalize">{prep.label}</strong>
                        <span className="text-white/40 ml-1">
                          {Math.round((prep.confidence ?? 0) * 100)}%
                        </span>
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-white/50 shrink-0">Override</span>
                      <select
                        value={selectedLabel}
                        onChange={(e) => setSelectedLabel(e.target.value)}
                        className="bg-white/10 rounded px-2 py-1 text-xs flex-1 capitalize"
                      >
                        {availableLabels.map((l) => (
                          <option key={l} value={l} className="capitalize">
                            {l}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      className="btn-primary w-full"
                      onClick={doPrepare}
                      disabled={busy || !selectedLabel}
                    >
                      {busy && prep.label && !prep.modelUrl ? "Preparing…" : "2. Prepare AR Model"}
                    </button>
                  </div>
                )}

                {/* Step 3 — shown after prepare */}
                {prep.modelUrl && (
                  <div className="border-t border-white/10 pt-3 space-y-2">
                    <p className="text-xs text-white/40">
                      Model: <span className="text-white/70 capitalize">{selectedLabel || prep.label}</span>
                      {prep.suggestedAnimation && (
                        <> · anim: <span className="text-white/70">{prep.suggestedAnimation}</span></>
                      )}
                    </p>
                    <button
                      className="btn-primary w-full"
                      onClick={doApprove}
                      disabled={busy}
                    >
                      {busy && prep.modelUrl ? "Publishing…" : "3. Approve & Publish AR"}
                    </button>
                  </div>
                )}
              </div>
            )}

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
