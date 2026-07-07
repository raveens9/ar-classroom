"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { createClient } from "@/lib/supabase";

interface Student {
  id: string;
  display_name: string;
}

interface Classroom {
  id: string;
  name: string;
  qr_token: string;
}

type Tab = "roster" | "share";

const AVATAR_STYLES = [
  { bg: "#EEEEFB", text: "#4646C6" },
  { bg: "#E4F5F2", text: "#147466" },
  { bg: "#FDF3E3", text: "#A96D14" },
];

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export default function ClassroomPage() {
  const { classroomId } = useParams<{ classroomId: string }>();
  const router = useRouter();
  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [newStudentName, setNewStudentName] = useState("");
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<Tab>("roster");
  const [activeSession, setActiveSession] = useState<{ id: string; socket_room_id: string | null; created_at: string } | null | undefined>(undefined);
  const [endingSession, setEndingSession] = useState(false);
  const [startingSession, setStartingSession] = useState(false);
  const [joinUrl, setJoinUrl] = useState("");

  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: c } = await supabase
        .from("classrooms")
        .select("*")
        .eq("id", classroomId)
        .single();
      if (!c) { router.push("/dashboard"); return; }
      setClassroom(c);
      setJoinUrl(`${window.location.origin}/join/${c.qr_token}`);

      const { data: s } = await supabase
        .from("students")
        .select("*")
        .eq("classroom_id", classroomId)
        .order("display_name");
      setStudents(s ?? []);

      await refreshSession();
    }

    async function refreshSession() {
      const { data: sess } = await supabase
        .from("sessions")
        .select("id, socket_room_id, created_at")
        .eq("classroom_id", classroomId)
        .is("ended_at", null)
        .maybeSingle();
      setActiveSession(sess ?? null);
    }

    load();

    // Re-check the session whenever the user navigates back to this tab/page,
    // so returning from the teacher view always shows the live session controls.
    const onVisible = () => { if (document.visibilityState === "visible") refreshSession(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [classroomId]);

  async function addStudent(e: React.FormEvent) {
    e.preventDefault();
    if (!newStudentName.trim()) return;
    setAdding(true);
    const { data } = await supabase
      .from("students")
      .insert({ classroom_id: classroomId, display_name: newStudentName.trim() })
      .select()
      .single();
    if (data) setStudents((prev) => [...prev, data].sort((a, b) => a.display_name.localeCompare(b.display_name)));
    setNewStudentName("");
    setAdding(false);
  }

  async function startSession() {
    setStartingSession(true);
    const { data } = await supabase
      .from("sessions")
      .insert({ classroom_id: classroomId })
      .select("id")
      .single();
    if (data) {
      router.push(`/teacher?sessionId=${data.id}`);
    }
    setStartingSession(false);
  }

  async function endSession() {
    if (!activeSession) return;
    if (!confirm("End this session? Students will be disconnected and the session will close.")) return;
    setEndingSession(true);
    await supabase.from("sessions").update({ ended_at: new Date().toISOString() }).eq("id", activeSession.id);
    setActiveSession(null);
    setEndingSession(false);
  }

  async function removeStudent(id: string) {
    await supabase.from("students").delete().eq("id", id);
    setStudents((prev) => prev.filter((s) => s.id !== id));
  }

  if (!classroom) {
    return (
      <main className="min-h-screen bg-[#FAF8F4] flex items-center justify-center">
        <p className="text-[#9B99A6]">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FAF8F4] px-6 py-9">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <Link href="/dashboard" className="text-sm text-[#9B99A6] hover:text-[#6E6C7A] w-fit transition-colors">
            ← My classrooms
          </Link>
          <h1 className="text-[28px] font-bold text-[#2B2A33] tracking-tight">{classroom.name}</h1>
        </div>

        {/* Glanceable session status — visible regardless of tab */}
        {activeSession === undefined ? null : activeSession ? (
          <div className="flex flex-col gap-4 bg-[#E6F4EA] border-[1.5px] border-[#BEE3C8] rounded-[18px] px-5 py-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-[#2C9A4B] shrink-0" />
                <div className="flex flex-col">
                  <p className="text-[15px] font-bold text-[#1E5A2F]">
                    {activeSession.socket_room_id ? `Session live · Room ${activeSession.socket_room_id}` : "Session started"}
                  </p>
                  <p className="text-[13px] text-[#4A7D58]">
                    {activeSession.socket_room_id
                      ? `Started ${new Date(activeSession.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : "Open teacher view to create the live room"}
                  </p>
                </div>
              </div>
              <div className="flex gap-2.5">
                <button
                  className="min-h-12 px-4 rounded-[14px] bg-[#2C9A4B] text-white text-[15px] font-semibold hover:bg-[#237B3C] transition-colors"
                  onClick={() => router.push(`/teacher?sessionId=${activeSession.id}`)}
                >
                  Open teacher view →
                </button>
                <button
                  className="min-h-12 px-4 rounded-[14px] bg-[#FBE9EA] text-[#B22A35] text-[15px] font-semibold hover:bg-[#F6D5D8] disabled:opacity-60 transition-colors"
                  onClick={endSession}
                  disabled={endingSession}
                >
                  {endingSession ? "Ending…" : "End session"}
                </button>
              </div>
            </div>

            {joinUrl && (
              <div className="flex flex-col sm:flex-row items-center gap-5 bg-white rounded-[14px] px-5 py-4 border border-[#BEE3C8]">
                <div className="p-2.5 bg-white rounded-xl border border-[#E4E1D8]">
                  <QRCodeSVG value={joinUrl} size={120} />
                </div>
                <div className="flex flex-col gap-2 flex-1 text-center sm:text-left">
                  <p className="text-[15px] font-bold text-[#1E5A2F]">Students scan to join</p>
                  <p className="text-[13px] text-[#4A7D58] leading-relaxed">
                    Show this QR now that the session is live. Students who scanned earlier can refresh their page.
                  </p>
                  <div className="flex gap-2 flex-wrap justify-center sm:justify-start">
                    <a
                      href={joinUrl}
                      className="min-h-9 px-3.5 flex items-center justify-center rounded-[10px] bg-[#1C9C8B] text-white text-[13px] font-semibold hover:bg-[#147466] transition-colors"
                    >
                      Open on this device
                    </a>
                    <button
                      onClick={() => navigator.clipboard.writeText(joinUrl)}
                      className="min-h-9 px-3.5 rounded-[10px] bg-[#EEEEFB] text-[#4646C6] text-[13px] font-bold hover:bg-[#DCDCF7] transition-colors"
                    >
                      Copy link
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 flex-wrap bg-white border border-[#E4E1D8] rounded-[18px] px-5 py-4">
            <p className="text-sm text-[#6E6C7A]">
              Starting a session lets students join via the QR code and begin drawing.
            </p>
            <button
              className="min-h-12 px-5 rounded-[14px] bg-[#5B5BD6] text-white text-[15px] font-semibold hover:bg-[#4646C6] disabled:opacity-60 transition-colors shrink-0"
              onClick={startSession}
              disabled={startingSession}
            >
              {startingSession ? "Starting…" : "Start session"}
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1.5 bg-[#F3F1EA] rounded-[14px] p-1.5 w-fit">
          {([
            { key: "roster", label: "Roster" },
            { key: "share", label: "Share & join" },
          ] as { key: Tab; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-5 py-2.5 rounded-[10px] text-sm font-semibold transition-colors ${
                tab === key ? "bg-white text-[#2B2A33] shadow-[0_1px_3px_rgba(43,42,51,0.10)]" : "text-[#6E6C7A] hover:text-[#2B2A33]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "roster" && (
          <div className="flex flex-col gap-3">
            <form onSubmit={addStudent} className="flex gap-2.5">
              <input
                type="text"
                value={newStudentName}
                onChange={(e) => setNewStudentName(e.target.value)}
                placeholder="Add a student by name…"
                className="flex-1 min-h-12 bg-white border border-[#DBD8CE] rounded-[10px] px-3.5 py-3 text-[15px] text-[#2B2A33] placeholder:text-[#9B99A6] outline-none focus:border-[#5B5BD6] focus:ring-4 focus:ring-[#EEEEFB] transition-colors"
              />
              <button
                type="submit"
                disabled={adding || !newStudentName.trim()}
                className="min-h-12 px-5 rounded-[14px] bg-[#5B5BD6] text-white text-[15px] font-semibold hover:bg-[#4646C6] disabled:opacity-60 transition-colors"
              >
                {adding ? "Adding…" : "Add"}
              </button>
            </form>

            {students.length === 0 ? (
              <p className="text-[#9B99A6] text-sm">No students yet. Add some above.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-2.5">
                {students.map((s, i) => {
                  const avatar = AVATAR_STYLES[i % AVATAR_STYLES.length];
                  return (
                    <div
                      key={s.id}
                      className="flex items-center justify-between bg-white border border-[#E4E1D8] rounded-2xl px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-[38px] h-[38px] rounded-full flex items-center justify-center text-sm font-bold"
                          style={{ background: avatar.bg, color: avatar.text }}
                        >
                          {initialOf(s.display_name)}
                        </div>
                        <span className="text-[15px] font-semibold text-[#2B2A33]">{s.display_name}</span>
                      </div>
                      <button
                        onClick={() => removeStudent(s.id)}
                        className="text-[13px] font-semibold text-[#9B99A6] px-3 py-2.5 rounded-[10px] hover:bg-[#FBE9EA] hover:text-[#B22A35] transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "share" && (
          <div className="max-w-[420px] flex flex-col gap-4">
            <div className="bg-white border-[1.5px] border-[#E4E1D8] rounded-[24px] p-7 flex flex-col items-center gap-4 text-center">
              <div className="flex flex-col gap-1">
                <h2 className="text-xl font-bold text-[#2B2A33]">Join {classroom.name}</h2>
                <p className="text-sm text-[#6E6C7A]">Scan with any phone or tablet camera</p>
              </div>

              {joinUrl && (
                <>
                  <div className="p-4 bg-white rounded-[20px] border-[1.5px] border-[#E4E1D8]">
                    <QRCodeSVG value={joinUrl} size={220} />
                  </div>
                  <a
                    href={joinUrl}
                    className="w-full min-h-14 flex items-center justify-center rounded-2xl bg-[#1C9C8B] text-white text-base font-bold hover:bg-[#147466] transition-colors"
                  >
                    Open student view on this device
                  </a>
                  <div className="w-full flex items-center gap-2.5 bg-[#FAF8F4] border-[1.5px] border-[#E4E1D8] rounded-xl px-3 py-2.5">
                    <span className="flex-1 font-mono text-xs text-[#6E6C7A] overflow-hidden text-ellipsis whitespace-nowrap text-left">
                      {joinUrl}
                    </span>
                    <button
                      onClick={() => navigator.clipboard.writeText(joinUrl)}
                      className="shrink-0 min-h-10 px-3.5 rounded-[10px] bg-[#EEEEFB] text-[#4646C6] text-[13px] font-bold hover:bg-[#DCDCF7] transition-colors"
                    >
                      Copy link
                    </button>
                  </div>
                  <p className="text-[13px] text-[#9B99A6]">This code is permanent — print it and pin it up.</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
