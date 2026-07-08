"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { CollabCanvas, type CanvasHandle } from "@/components/Canvas";
import { emitAck, getSocket } from "@/lib/socket";
import { createClient } from "@/lib/supabase";
import {
  mlApproveGenerateAR,
  mlClassify,
  mlPrepareTextureModel,
  mlRemoveBackground,
} from "@/lib/mlApi";
import type { Room, RoomMode, Topic } from "@ar/shared";

// Labels available in the prepare-texture model registry, grouped by topic.
const TOPIC_LABELS: Record<string, string[]> = {
  animals:  ["butterfly", "cat", "dog", "fish", "dragon", "dinosaur", "robot", "bird"],
  nature:   ["cloud", "flower", "rain", "rainbow", "sun", "tree"],
};

const COLOR_PRESETS = ["#F472B6", "#5B5BD6", "#1C9C8B", "#E8A13C", "#D64550", "#2B2A33"];

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
  const [topic, setTopic] = useState<Topic>("animals");
  const [watchedStudentId, setWatchedStudentId] = useState<string | null>(null);
  const [color, setColor] = useState("#f472b6");
  const [size, setSize] = useState(5);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [, setLog] = useState<string[]>([]);
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
  const [joinUrl, setJoinUrl] = useState("");
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setTeacherId(data.user.id);
    });

    if (!sessionId) return;
    (async () => {
      const supabase = createClient();
      const { data: sess } = await supabase
        .from("sessions")
        .select("classroom_id")
        .eq("id", sessionId)
        .single();
      if (!sess) return;
      const { data: cls } = await supabase
        .from("classrooms")
        .select("qr_token")
        .eq("id", sess.classroom_id)
        .single();
      if (cls) setJoinUrl(`${window.location.origin}/join/${cls.qr_token}`);
    })();
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
  const watchedStudent = room?.students.find((s) => s.studentId === watchedStudentId);

  const step2Unlocked = Boolean(prep.cutoutUrl && prep.label);
  const step3Unlocked = Boolean(prep.modelUrl);

  return (
    <main className="min-h-screen bg-[#FAF8F4] p-4 md:p-5 grid gap-4 lg:grid-cols-[300px_1fr]">
      <aside className="flex flex-col gap-3 overflow-hidden">
        <div className="bg-white border-[1.5px] border-[#E4E1D8] rounded-[18px] p-4 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <Link href="/dashboard" className="text-[13px] text-[#9B99A6] hover:text-[#6E6C7A] transition-colors">
              ← Dashboard
            </Link>
            <div className="flex items-center gap-2">
              {room && (
                <span className="flex items-center gap-1.5 bg-[#E6F4EA] text-[#1E7A3A] text-xs font-bold px-2.5 py-1 rounded-full">
                  <span className="w-[7px] h-[7px] rounded-full bg-[#2C9A4B]" />
                  Live
                </span>
              )}
            </div>
          </div>

          {!room ? (
            <div className="flex flex-col gap-2 pt-1">
              <div className="flex gap-2">
                <select
                  value={topic}
                  onChange={(e) => setTopic(e.target.value as Topic)}
                  className="flex-1 min-h-10 bg-white border border-[#DBD8CE] rounded-[10px] px-2 text-sm text-[#2B2A33]"
                >
                  <option value="animals">Animals</option>
                  <option value="nature">Nature</option>
                  <option value="shapes">Shapes</option>
                  <option value="vegetables">Vegetables</option>
                  <option value="vehicles">Vehicles</option>
                  <option value="numbers">Numbers</option>
                  <option value="letters">Letters</option>
                </select>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as RoomMode)}
                  className="min-h-10 bg-white border border-[#DBD8CE] rounded-[10px] px-2 text-sm text-[#2B2A33]"
                >
                  <option value="OPEN">OPEN</option>
                  <option value="CLOSED">CLOSED</option>
                </select>
              </div>
              <button
                className="min-h-11 rounded-xl bg-[#5B5BD6] text-white text-sm font-semibold hover:bg-[#4646C6] transition-colors"
                onClick={createRoom}
              >
                Create room
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <p className="text-[15px] font-bold text-[#2B2A33]">
                  <span>{room.topic.charAt(0).toUpperCase() + room.topic.slice(1)} drawings</span>
                </p>
                <p className="text-[13px] text-[#6E6C7A] capitalize">{room.topic}</p>
              </div>
              <div className="flex gap-1.5 bg-[#F3F1EA] rounded-xl p-1">
                <button
                  className={`flex-1 text-center py-2 rounded-[9px] text-[13px] font-semibold transition-colors ${
                    room.mode === "OPEN" ? "bg-white text-[#2B2A33] shadow-[0_1px_3px_rgba(43,42,51,0.10)]" : "text-[#6E6C7A]"
                  }`}
                  onClick={() => setRoomMode("OPEN")}
                >
                  Open
                </button>
                <button
                  className={`flex-1 text-center py-2 rounded-[9px] text-[13px] font-semibold transition-colors ${
                    room.mode === "CLOSED" ? "bg-white text-[#2B2A33] shadow-[0_1px_3px_rgba(43,42,51,0.10)]" : "text-[#6E6C7A]"
                  }`}
                  onClick={() => setRoomMode("CLOSED")}
                >
                  Closed
                </button>
              </div>
              <button
                className="min-h-11 rounded-xl bg-[#FBE9EA] text-[#B22A35] text-sm font-semibold hover:bg-[#F6D5D8] disabled:opacity-60 transition-colors"
                onClick={endSession}
                disabled={busy}
              >
                End session
              </button>
            </div>
          )}
        </div>

        {room && (
          <>
            <div className="bg-white border-[1.5px] border-[#E4E1D8] rounded-[18px] p-4 flex flex-col gap-2.5">
              <p className="text-xs font-bold tracking-wider uppercase text-[#9B99A6]">Waiting · {waiting.length}</p>
              {waiting.length === 0 ? (
                <p className="text-[#9B99A6] text-sm">No one waiting.</p>
              ) : (
                waiting.map((s) => (
                  <div key={s.studentId} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-[34px] h-[34px] shrink-0 rounded-full bg-[#FDF3E3] flex items-center justify-center text-[13px] font-bold text-[#A96D14]">
                        {s.displayName.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm font-semibold text-[#2B2A33] truncate">{s.displayName}</span>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        className="min-h-10 px-3.5 rounded-[10px] bg-[#5B5BD6] text-white text-[13px] font-semibold hover:bg-[#4646C6] transition-colors"
                        onClick={() => admit(s.studentId)}
                      >
                        Admit
                      </button>
                      <button
                        className="min-h-10 px-2 rounded-[10px] text-[#9B99A6] text-[13px] font-semibold hover:text-[#B22A35] transition-colors"
                        onClick={() => remove(s.studentId)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="bg-white border-[1.5px] border-[#E4E1D8] rounded-[18px] p-4 flex flex-col gap-2">
              <p className="text-xs font-bold tracking-wider uppercase text-[#9B99A6]">Drawing · {admitted.length}</p>
              {admitted.length === 0 ? (
                <p className="text-[#9B99A6] text-sm">No one admitted.</p>
              ) : (
                admitted.map((s) => {
                  const isWatched = watchedStudentId === s.studentId;
                  const arReady = arReadyStudents.has(s.studentId);
                  return (
                    <div
                      key={s.studentId}
                      className={`flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 ${
                        isWatched ? "bg-[#EEEEFB] border-[1.5px] border-[#B9B6E8]" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-[34px] h-[34px] shrink-0 rounded-full bg-white flex items-center justify-center text-[13px] font-bold text-[#4646C6]">
                          {s.displayName.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-bold text-[#2B2A33] truncate">{s.displayName}</span>
                          {isWatched ? (
                            <span className="text-[11px] font-semibold text-[#4646C6]">Watching now</span>
                          ) : arReady ? (
                            <span className="text-[11px] font-semibold text-[#1E7A3A]">AR ready ✓</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        {!isWatched && (
                          <button
                            className="min-h-10 px-3.5 rounded-[10px] border border-[#DBD8CE] bg-white text-[#2B2A33] text-[13px] font-semibold hover:bg-[#F3F1EA] transition-colors"
                            onClick={() => watch(s.studentId)}
                          >
                            Watch
                          </button>
                        )}
                        <button
                          className="min-h-10 px-2 rounded-[10px] text-[#9B99A6] text-[13px] font-semibold hover:text-[#B22A35] transition-colors"
                          onClick={() => remove(s.studentId)}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {watchedStudentId && (
              <div className="bg-white border-[1.5px] border-[#E4E1D8] rounded-[18px] p-4 flex flex-col gap-3">
                <p className="text-xs font-bold tracking-wider uppercase text-[#9B99A6]">
                  Make it 3D · {watchedStudent?.displayName ?? ""}
                </p>

                {/* Step 1 */}
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-[26px] h-[26px] shrink-0 rounded-full flex items-center justify-center text-[13px] font-bold ${
                      prep.label ? "bg-[#2C9A4B] text-white" : "bg-[#5B5BD6] text-white"
                    }`}
                  >
                    {prep.label ? "✓" : "1"}
                  </div>
                  {prep.label ? (
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-semibold text-[#2B2A33]">Recognize drawing</span>
                      <span className="text-xs text-[#6E6C7A]">
                        Looks like a <strong className="text-[#2B2A33] capitalize">{prep.label}</strong> · {Math.round((prep.confidence ?? 0) * 100)}%
                      </span>
                    </div>
                  ) : (
                    <button
                      className="flex-1 min-h-10 rounded-xl bg-[#5B5BD6] text-white text-[13px] font-semibold hover:bg-[#4646C6] disabled:opacity-60 transition-colors"
                      onClick={doClassify}
                      disabled={busy}
                    >
                      {busy ? "Recognizing…" : "Recognize drawing"}
                    </button>
                  )}
                </div>

                {prep.label && (
                  <div className="flex items-center gap-2 pl-9">
                    <select
                      value={selectedLabel}
                      onChange={(e) => setSelectedLabel(e.target.value)}
                      className="flex-1 min-h-10 bg-white border border-[#DBD8CE] rounded-[10px] px-2.5 text-[13px] text-[#2B2A33] capitalize"
                    >
                      {availableLabels.map((l) => (
                        <option key={l} value={l} className="capitalize">
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Step 2 */}
                <div className={`flex items-center gap-2.5 ${step2Unlocked ? "" : "opacity-45"}`}>
                  <div className="w-[26px] h-[26px] shrink-0 rounded-full bg-[#5B5BD6] text-white flex items-center justify-center text-[13px] font-bold">
                    {step3Unlocked ? "✓" : "2"}
                  </div>
                  <button
                    className="flex-1 min-h-11 rounded-xl bg-[#5B5BD6] text-white text-sm font-semibold hover:bg-[#4646C6] disabled:opacity-60 transition-colors"
                    onClick={doPrepare}
                    disabled={busy || !step2Unlocked || !selectedLabel}
                  >
                    {busy && prep.label && !prep.modelUrl ? "Building…" : "Build the 3D model"}
                  </button>
                </div>

                {/* Step 3 */}
                <div className={`flex items-center gap-2.5 ${step3Unlocked ? "" : "opacity-45"}`}>
                  <div className="w-[26px] h-[26px] shrink-0 rounded-full bg-[#F3F1EA] text-[#9B99A6] flex items-center justify-center text-[13px] font-bold">
                    3
                  </div>
                  {step3Unlocked ? (
                    <button
                      className="flex-1 min-h-11 rounded-xl bg-[#5B5BD6] text-white text-sm font-semibold hover:bg-[#4646C6] disabled:opacity-60 transition-colors"
                      onClick={doApprove}
                      disabled={busy}
                    >
                      {busy ? "Publishing…" : "Send to AR"}
                    </button>
                  ) : (
                    <span className="text-sm font-semibold text-[#6E6C7A]">Send to AR</span>
                  )}
                </div>
              </div>
            )}

            {/* <div className="bg-white border-[1.5px] border-[#E4E1D8] rounded-[18px] p-4 flex flex-col gap-2 overflow-hidden">
              <p className="text-xs font-bold tracking-wider uppercase text-[#9B99A6]">Log</p>
              <ul className="text-xs text-[#6E6C7A] space-y-1 max-h-40 overflow-auto font-mono">
                {log.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div> */}
          </>
        )}
      </aside>

      <section className="bg-white border-[1.5px] border-[#E4E1D8] rounded-[18px] min-h-[70vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 border-b-[1.5px] border-[#E4E1D8]">
          <div className="flex items-center gap-3">
            <h2 className="text-[15px] font-bold text-[#2B2A33]">
              {watchedStudent ? `${watchedStudent.displayName}'s canvas` : "Select a student to watch"}
            </h2>
            {joinUrl && room && (
              <button
                onClick={() => setShowQr((v) => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[13px] font-semibold transition-colors ${
                  showQr ? "bg-[#EEEEFB] text-[#4646C6]" : "border border-[#DBD8CE] text-[#6E6C7A] hover:bg-[#F3F1EA]"
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                  <rect x="14" y="14" width="3" height="3"/><rect x="18" y="14" width="3" height="3"/><rect x="14" y="18" width="3" height="3"/><rect x="18" y="18" width="3" height="3"/>
                </svg>
                Join QR
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-1.5">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className="w-8 h-8 rounded-full transition-shadow"
                  style={{
                    background: c,
                    boxShadow: color === c ? "0 0 0 2px #FFFFFF, 0 0 0 4px #2B2A33" : "none",
                  }}
                />
              ))}
            </div>
            <label className="flex items-center gap-2 text-[13px] font-semibold text-[#6E6C7A]">
              <span>Size</span>
              <input
                type="range"
                min={1}
                max={32}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="accent-[#5B5BD6]"
              />
            </label>
            <div className="flex gap-1 bg-[#F3F1EA] rounded-xl p-1">
              <button
                className={`px-4 py-2 rounded-[9px] text-[13px] font-semibold transition-colors ${
                  tool === "pen" ? "bg-white text-[#2B2A33] shadow-[0_1px_3px_rgba(43,42,51,0.10)]" : "text-[#6E6C7A]"
                }`}
                onClick={() => setTool("pen")}
              >
                Pen
              </button>
              <button
                className={`px-4 py-2 rounded-[9px] text-[13px] font-semibold transition-colors ${
                  tool === "eraser" ? "bg-white text-[#2B2A33] shadow-[0_1px_3px_rgba(43,42,51,0.10)]" : "text-[#6E6C7A]"
                }`}
                onClick={() => setTool("eraser")}
              >
                Eraser
              </button>
            </div>
            <div className="flex gap-1.5">
              <button
                className="min-h-10 px-3.5 rounded-[10px] border border-[#DBD8CE] bg-white text-[#2B2A33] text-[13px] font-semibold hover:bg-[#F3F1EA] transition-colors"
                onClick={() => canvasRef.current?.undo()}
              >
                ↩ Undo
              </button>
              <button
                className="min-h-10 px-3.5 rounded-[10px] border border-[#DBD8CE] bg-white text-[#2B2A33] text-[13px] font-semibold hover:bg-[#F3F1EA] transition-colors"
                onClick={() => canvasRef.current?.redo()}
              >
                ↪ Redo
              </button>
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-[60vh] p-4 relative">
          {showQr && joinUrl && (
            <div className="absolute top-4 right-4 z-10 bg-white border-[1.5px] border-[#E4E1D8] rounded-[20px] p-5 flex flex-col items-center gap-3 shadow-[0_4px_20px_rgba(43,42,51,0.10)]">
              <p className="text-[13px] font-bold text-[#2B2A33]">Students scan to join</p>
              <div className="p-2 bg-white rounded-xl border border-[#E4E1D8]">
                <QRCodeSVG value={joinUrl} size={160} />
              </div>
              <button
                onClick={() => navigator.clipboard.writeText(joinUrl)}
                className="w-full min-h-9 rounded-[10px] bg-[#EEEEFB] text-[#4646C6] text-[13px] font-bold hover:bg-[#DCDCF7] transition-colors"
              >
                Copy link
              </button>
            </div>
          )}
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
              className="w-full h-full bg-white rounded-2xl border-[1.5px] border-dashed border-[#DBD8CE]"
            />
          ) : (
            <div className="h-full flex items-center justify-center text-[#9B99A6] text-sm rounded-2xl border-[1.5px] border-dashed border-[#DBD8CE]">
              Pick a student from the Drawing list.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
