"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase";

export default function SignupPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [institute, setInstitute] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();

    const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
    if (signUpError || !data.user) {
      setError(signUpError?.message ?? "Sign up failed");
      setLoading(false);
      return;
    }

    const { error: profileError } = await supabase.from("profiles").insert({
      id: data.user.id,
      display_name: displayName,
      institute: institute || null,
    });

    if (profileError) {
      setError(profileError.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#FAF8F4] p-4">
      <div className="w-full max-w-[460px] bg-white border border-[#E4E1D8] rounded-[24px] p-8 flex flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#5B5BD6]" />
            <div className="w-3 h-3 rounded-[3px] bg-[#1C9C8B]" />
            <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[12px] border-b-[#E8A13C]" />
          </div>
          <h1 className="text-2xl font-bold text-[#2B2A33]">Create your teacher account</h1>
          <p className="text-sm text-[#6E6C7A]">Free for classrooms. Students never need accounts.</p>
        </div>

        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold text-[#2B2A33]">Your name</label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full min-h-12 bg-white border border-[#DBD8CE] rounded-[10px] px-3.5 py-3 text-[15px] text-[#2B2A33] placeholder:text-[#9B99A6] outline-none focus:border-[#5B5BD6] focus:ring-4 focus:ring-[#EEEEFB] transition-colors"
              placeholder="Ms. Silva"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold text-[#2B2A33]">
              School <span className="text-[#9B99A6] font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={institute}
              onChange={(e) => setInstitute(e.target.value)}
              className="w-full min-h-12 bg-white border border-[#DBD8CE] rounded-[10px] px-3.5 py-3 text-[15px] text-[#2B2A33] placeholder:text-[#9B99A6] outline-none focus:border-[#5B5BD6] focus:ring-4 focus:ring-[#EEEEFB] transition-colors"
              placeholder="Sunrise International School"
            />
          </div>

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
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full min-h-12 bg-white border border-[#DBD8CE] rounded-[10px] px-3.5 py-3 text-[15px] text-[#2B2A33] placeholder:text-[#9B99A6] outline-none focus:border-[#5B5BD6] focus:ring-4 focus:ring-[#EEEEFB] transition-colors"
              placeholder="••••••••"
            />
            <p className="text-xs text-[#9B99A6]">At least 6 characters</p>
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
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="text-sm text-[#6E6C7A]">
          Already have an account?{" "}
          <Link href="/login" className="text-[#5B5BD6] font-semibold hover:text-[#4646C6]">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
