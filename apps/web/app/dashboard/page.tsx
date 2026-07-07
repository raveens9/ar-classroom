"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase";

interface Classroom {
  id: string;
  name: string;
  qr_token: string;
  created_at: string;
}

interface ClassroomStats {
  studentCount: number;
  hasActiveSession: boolean;
  lastUsedAt: string | null;
}

const AVATAR_STYLES = [
  { bg: "#E4F5F2", text: "#147466" },
  { bg: "#EEEEFB", text: "#4646C6" },
  { bg: "#FDF3E3", text: "#A96D14" },
];

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function relativeDay(iso: string): string {
  const then = new Date(iso);
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  const startOfNow = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
  const days = Math.round((startOfNow - startOfThen) / 86_400_000);
  if (days <= 0) return "used today";
  if (days === 1) return "used yesterday";
  if (days < 7) return `used ${days} days ago`;
  return `used ${then.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [stats, setStats] = useState<Record<string, ClassroomStats>>({});
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState<string>("");

  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();
      setDisplayName(profile?.display_name ?? "");

      const { data } = await supabase
        .from("classrooms")
        .select("*")
        .order("created_at", { ascending: false });
      const rows = data ?? [];
      setClassrooms(rows);
      setLoading(false);

      const ids = rows.map((c) => c.id);
      if (ids.length === 0) return;

      const [{ data: students }, { data: sessions }] = await Promise.all([
        supabase.from("students").select("classroom_id").in("classroom_id", ids),
        supabase.from("sessions").select("classroom_id, ended_at, created_at").in("classroom_id", ids),
      ]);

      const next: Record<string, ClassroomStats> = {};
      for (const id of ids) next[id] = { studentCount: 0, hasActiveSession: false, lastUsedAt: null };
      for (const s of students ?? []) {
        if (next[s.classroom_id]) next[s.classroom_id].studentCount += 1;
      }
      for (const s of sessions ?? []) {
        const entry = next[s.classroom_id];
        if (!entry) continue;
        if (!s.ended_at) entry.hasActiveSession = true;
        if (!entry.lastUsedAt || s.created_at > entry.lastUsedAt) entry.lastUsedAt = s.created_at;
      }
      setStats(next);
    }
    load();
  }, []);

  async function createClassroom(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase
      .from("classrooms")
      .insert({ name: newName.trim(), teacher_id: user!.id })
      .select()
      .single();
    if (data) {
      setClassrooms((prev) => [data, ...prev]);
      setStats((prev) => ({ ...prev, [data.id]: { studentCount: 0, hasActiveSession: false, lastUsedAt: null } }));
    }
    setNewName("");
    setCreating(false);
    setShowCreateForm(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const sorted = [...classrooms].sort((a, b) => {
    const sa = stats[a.id];
    const sb = stats[b.id];
    if (!!sb?.hasActiveSession !== !!sa?.hasActiveSession) return sb?.hasActiveSession ? 1 : -1;
    const la = sa?.lastUsedAt ?? a.created_at;
    const lb = sb?.lastUsedAt ?? b.created_at;
    return lb.localeCompare(la);
  });

  return (
    <main className="min-h-screen bg-[#FAF8F4] px-6 py-10">
      <div className="max-w-3xl mx-auto flex flex-col gap-7">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-1">
            {displayName && <p className="text-sm text-[#6E6C7A]">Good to see you, {displayName}</p>}
            <h1 className="text-[30px] font-bold text-[#2B2A33] tracking-tight">My classrooms</h1>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={signOut}
              className="min-h-12 px-4 rounded-[14px] text-[#6E6C7A] text-sm font-semibold hover:bg-[#F3F1EA] hover:text-[#2B2A33] transition-colors"
            >
              Sign out
            </button>
            {classrooms.length > 0 && (
              <button
                onClick={() => setShowCreateForm((v) => !v)}
                className="min-h-12 px-5 rounded-[14px] bg-[#5B5BD6] text-white text-[15px] font-semibold hover:bg-[#4646C6] transition-colors flex items-center gap-2"
              >
                <span className="text-lg leading-none">+</span> New classroom
              </button>
            )}
          </div>
        </div>

        {showCreateForm && (
          <form onSubmit={createClassroom} className="flex gap-2.5">
            <input
              type="text"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Classroom name, e.g. Class 3B"
              className="flex-1 min-h-12 bg-white border border-[#DBD8CE] rounded-[10px] px-3.5 py-3 text-[15px] text-[#2B2A33] placeholder:text-[#9B99A6] outline-none focus:border-[#5B5BD6] focus:ring-4 focus:ring-[#EEEEFB] transition-colors"
            />
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="min-h-12 px-5 rounded-[14px] bg-[#5B5BD6] text-white text-[15px] font-semibold hover:bg-[#4646C6] disabled:opacity-60 transition-colors"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </form>
        )}

        {loading ? (
          <p className="text-[#9B99A6] text-sm">Loading…</p>
        ) : classrooms.length === 0 ? (
          <div className="max-w-md flex flex-col gap-4">
            <p className="text-xs font-bold tracking-wider uppercase text-[#9B99A6]">
              First-time setup
            </p>
            <form
              onSubmit={createClassroom}
              className="bg-white border border-[#E4E1D8] rounded-[24px] p-8 flex flex-col items-center gap-4 text-center"
            >
              <div className="flex gap-1.5">
                <div className="w-4 h-4 rounded-full bg-[#5B5BD6]" />
                <div className="w-4 h-4 rounded-[4px] bg-[#1C9C8B]" />
                <div className="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[16px] border-b-[#E8A13C]" />
              </div>
              <div className="flex flex-col gap-1.5">
                <h2 className="text-xl font-bold text-[#2B2A33]">Set up your first classroom</h2>
                <p className="text-sm text-[#6E6C7A] leading-relaxed">
                  A classroom holds your student roster and a permanent QR code students use to join.
                  It takes about a minute.
                </p>
              </div>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Classroom name, e.g. Class 3B"
                className="w-full min-h-12 bg-white border border-[#DBD8CE] rounded-[10px] px-3.5 py-3 text-[15px] text-[#2B2A33] placeholder:text-[#9B99A6] outline-none focus:border-[#5B5BD6] focus:ring-4 focus:ring-[#EEEEFB] transition-colors"
              />
              <button
                type="submit"
                disabled={creating || !newName.trim()}
                className="w-full min-h-12 rounded-[14px] bg-[#5B5BD6] text-white text-[15px] font-semibold hover:bg-[#4646C6] disabled:opacity-60 transition-colors"
              >
                {creating ? "Creating…" : "Create classroom"}
              </button>
            </form>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {sorted.map((c, i) => {
              const s = stats[c.id];
              const avatar = AVATAR_STYLES[i % AVATAR_STYLES.length];
              return (
                <div
                  key={c.id}
                  className={`bg-white rounded-[20px] p-6 flex flex-col gap-4 border ${
                    s?.hasActiveSession ? "border-[1.5px] border-[#C6E8E2] shadow-[0_2px_8px_rgba(28,156,139,0.08)]" : "border-[#E4E1D8]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div
                      className="w-11 h-11 rounded-2xl flex items-center justify-center text-[17px] font-bold"
                      style={{ background: avatar.bg, color: avatar.text }}
                    >
                      {initialsOf(c.name)}
                    </div>
                    {s?.hasActiveSession && (
                      <span className="flex items-center gap-1.5 bg-[#E6F4EA] text-[#1E7A3A] text-[13px] font-bold px-3 py-1.5 rounded-full">
                        <span className="w-2 h-2 rounded-full bg-[#2C9A4B]" />
                        Session live
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <h2 className="text-[19px] font-bold text-[#2B2A33]">{c.name}</h2>
                    <p className="text-sm text-[#6E6C7A]">
                      {s ? `${s.studentCount} student${s.studentCount === 1 ? "" : "s"}` : "…"}
                      {s?.lastUsedAt && <> · {relativeDay(s.lastUsedAt)}</>}
                    </p>
                  </div>
                  <Link
                    href={`/dashboard/${c.id}`}
                    className={`min-h-12 flex items-center justify-center rounded-[14px] text-[15px] font-semibold transition-colors ${
                      s?.hasActiveSession
                        ? "bg-[#1C9C8B] text-white hover:bg-[#147466]"
                        : "border border-[#DBD8CE] bg-white text-[#2B2A33] hover:bg-[#F3F1EA]"
                    }`}
                  >
                    {s?.hasActiveSession ? "Rejoin session →" : "Open classroom"}
                  </Link>
                </div>
              );
            })}

            <button
              onClick={() => setShowCreateForm(true)}
              className="border-2 border-dashed border-[#DBD8CE] rounded-[20px] p-6 flex flex-col items-center justify-center gap-2 min-h-[180px] hover:border-[#5B5BD6] hover:bg-white transition-colors"
            >
              <div className="w-11 h-11 rounded-full bg-[#EEEEFB] flex items-center justify-center text-2xl text-[#5B5BD6] font-semibold">
                +
              </div>
              <p className="text-[15px] font-semibold text-[#6E6C7A]">New classroom</p>
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
