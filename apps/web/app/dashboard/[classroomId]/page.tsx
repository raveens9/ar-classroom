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

type Tab = "roster" | "qr" | "session";

export default function ClassroomPage() {
  const { classroomId } = useParams<{ classroomId: string }>();
  const router = useRouter();
  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [newStudentName, setNewStudentName] = useState("");
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<Tab>("roster");
  const [activeSession, setActiveSession] = useState<{ id: string; socket_room_id: string | null } | null | undefined>(undefined);
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

      const { data: sess } = await supabase
        .from("sessions")
        .select("id, socket_room_id")
        .eq("classroom_id", classroomId)
        .is("ended_at", null)
        .maybeSingle();
      setActiveSession(sess ?? null);
    }
    load();
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

  async function removeStudent(id: string) {
    await supabase.from("students").delete().eq("id", id);
    setStudents((prev) => prev.filter((s) => s.id !== id));
  }

  if (!classroom) {
    return <main className="min-h-screen bg-[#0b0b12] flex items-center justify-center"><p className="text-white/40">Loading…</p></main>;
  }

  return (
    <main className="min-h-screen bg-[#0b0b12] p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link href="/dashboard" className="text-sm text-white/40 hover:text-white/70 transition-colors">
          ← Back
        </Link>
        <h1 className="text-2xl font-semibold text-white mt-2">{classroom.name}</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white/5 rounded-lg p-1 w-fit">
        {(["roster", "qr", "session"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm capitalize transition-colors ${
              tab === t ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"
            }`}
          >
            {t === "qr" ? "QR Code" : t === "session" ? "Session" : "Roster"}
          </button>
        ))}
      </div>

      {tab === "roster" && (
        <div className="space-y-4">
          <form onSubmit={addStudent} className="flex gap-2">
            <input
              type="text"
              value={newStudentName}
              onChange={(e) => setNewStudentName(e.target.value)}
              placeholder="Student name"
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
            />
            <button type="submit" disabled={adding || !newStudentName.trim()} className="btn-primary">
              {adding ? "Adding…" : "Add"}
            </button>
          </form>

          {students.length === 0 ? (
            <p className="text-white/40 text-sm">No students yet. Add some above.</p>
          ) : (
            <ul className="space-y-2">
              {students.map((s) => (
                <li key={s.id} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                  <span className="text-white">{s.display_name}</span>
                  <button
                    onClick={() => removeStudent(s.id)}
                    className="text-sm text-white/30 hover:text-red-400 transition-colors"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "session" && (
        <div className="space-y-4">
          {activeSession === undefined ? (
            <p className="text-white/40 text-sm">Loading…</p>
          ) : activeSession ? (
            <div className="space-y-3">
              <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm space-y-1">
                <p className="text-white/50">Active session</p>
                {activeSession.socket_room_id ? (
                  <p className="text-green-400 text-xs">Room live · {activeSession.socket_room_id}</p>
                ) : (
                  <p className="text-yellow-400 text-xs">Room not started yet — open Teacher view to create it</p>
                )}
              </div>

              {/* Share the join link directly so teacher doesn't need to scan their own QR */}
              {joinUrl && (
                <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 space-y-2">
                  <p className="text-xs text-white/50">Student join link — share this instead of QR</p>
                  <a
                    href={joinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-400 underline break-all"
                  >
                    {joinUrl}
                  </a>
                  <button
                    onClick={() => navigator.clipboard.writeText(joinUrl)}
                    className="btn-ghost text-xs w-full"
                  >
                    Copy link
                  </button>
                </div>
              )}

              <button
                className="btn-primary w-full"
                onClick={() => router.push(`/teacher?sessionId=${activeSession.id}`)}
              >
                Open Teacher View →
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-white/60">
                Starting a session lets students join via the QR code and begin drawing.
              </p>
              <button
                className="btn-primary w-full"
                onClick={startSession}
                disabled={startingSession}
              >
                {startingSession ? "Starting…" : "Start session"}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "qr" && (
        <div className="space-y-6">
          <p className="text-sm text-white/60">
            The aide scans this code to see the roster and select a student before the session starts.
            This code is permanent — it never changes.
          </p>

          {joinUrl && (
            <div className="flex flex-col items-center gap-4">
              <div className="bg-white p-4 rounded-2xl">
                <QRCodeSVG value={joinUrl} size={220} />
              </div>
              <p className="text-xs text-white/40 text-center break-all max-w-xs">{joinUrl}</p>
              <button
                onClick={() => navigator.clipboard.writeText(joinUrl)}
                className="btn-ghost text-sm"
              >
                Copy link
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
