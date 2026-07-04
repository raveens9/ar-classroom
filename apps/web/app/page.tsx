"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setIsLoggedIn(!!data.user));
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="card max-w-lg w-full text-center space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">AR Classroom</h1>
          <p className="text-white/60">
            Collaborative drawing with AR model viewing.
          </p>
        </div>

        <div className="space-y-3">
          <p className="text-xs text-white/40 uppercase tracking-widest">Teacher</p>
          {isLoggedIn === null ? (
            <div className="btn-primary w-full opacity-50 pointer-events-none">Loading…</div>
          ) : isLoggedIn ? (
            <Link href="/dashboard" className="btn-primary w-full block">
              My Dashboard
            </Link>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Link href="/login" className="btn-primary">Sign in</Link>
              <Link href="/signup" className="btn-ghost">Create account</Link>
            </div>
          )}
        </div>

        <div className="border-t border-white/10 pt-4 space-y-3">
          <p className="text-xs text-white/40 uppercase tracking-widest">Student / Aide</p>
          <p className="text-sm text-white/50">
            Scan your classroom QR code or open the link your teacher shared.
          </p>
          <Link href="/student" className="btn-ghost w-full block">
            Student view
          </Link>
        </div>

        <div className="border-t border-white/10 pt-4">
          <Link href="/ar-demo" className="text-sm text-white/40 hover:text-white/70 transition-colors">
            AR demo (no classroom needed) →
          </Link>
        </div>
      </div>
    </main>
  );
}
