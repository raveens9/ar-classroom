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

export default function DashboardPage() {
  const router = useRouter();
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
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
      setClassrooms(data ?? []);
      setLoading(false);
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
    if (data) setClassrooms((prev) => [data, ...prev]);
    setNewName("");
    setCreating(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-[#0b0b12] p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">My Classrooms</h1>
          {displayName && <p className="text-sm text-white/50 mt-0.5">{displayName}</p>}
        </div>
        <button onClick={signOut} className="btn-ghost text-sm">Sign out</button>
      </div>

      <form onSubmit={createClassroom} className="flex gap-2 mb-8">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New classroom name"
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
        />
        <button type="submit" disabled={creating || !newName.trim()} className="btn-primary">
          {creating ? "Creating…" : "Create"}
        </button>
      </form>

      {loading ? (
        <p className="text-white/40 text-sm">Loading…</p>
      ) : classrooms.length === 0 ? (
        <p className="text-white/40 text-sm">No classrooms yet. Create one above.</p>
      ) : (
        <ul className="space-y-3">
          {classrooms.map((c) => (
            <li key={c.id} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-4 py-3">
              <span className="text-white font-medium">{c.name}</span>
              <Link href={`/dashboard/${c.id}`} className="btn-ghost text-sm">
                Manage →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
