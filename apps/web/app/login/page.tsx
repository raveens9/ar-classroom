"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#FAF8F4] p-4">
      <div className="w-full max-w-[420px] bg-white border border-[#E4E1D8] rounded-[24px] p-8 flex flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#5B5BD6]" />
            <div className="w-3 h-3 rounded-[3px] bg-[#1C9C8B]" />
            <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[12px] border-b-[#E8A13C]" />
          </div>
          <h1 className="text-2xl font-bold text-[#2B2A33]">Welcome back</h1>
          <p className="text-sm text-[#6E6C7A]">Sign in to your classrooms</p>
        </div>

        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold text-[#2B2A33]">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full min-h-12 bg-white border border-[#DBD8CE] rounded-[10px] px-3.5 py-3 text-[15px] text-[#2B2A33] placeholder:text-[#9B99A6] outline-none focus:border-[#5B5BD6] focus:ring-4 focus:ring-[#EEEEFB] transition-colors"
              placeholder="you@school.edu"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold text-[#2B2A33]">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full min-h-12 bg-white border border-[#DBD8CE] rounded-[10px] px-3.5 py-3 text-[15px] text-[#2B2A33] placeholder:text-[#9B99A6] outline-none focus:border-[#5B5BD6] focus:ring-4 focus:ring-[#EEEEFB] transition-colors"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-[13px] text-[#B22A35] flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D64550] shrink-0" />
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 min-h-12 rounded-[14px] bg-[#5B5BD6] text-white text-[15px] font-semibold px-5 py-3 hover:bg-[#4646C6] disabled:opacity-60 transition-colors"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-sm text-[#6E6C7A]">
          No account?{" "}
          <Link href="/signup" className="text-[#5B5BD6] font-semibold hover:text-[#4646C6]">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
