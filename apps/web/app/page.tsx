"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

function Logo() {
  return (
    <div className="flex gap-1.5">
      <div className="w-3.5 h-3.5 rounded-full bg-[#5B5BD6]" />
      <div className="w-3.5 h-3.5 rounded-[4px] bg-[#1C9C8B]" />
      <div className="w-0 h-0 border-l-[7px] border-l-transparent border-r-[7px] border-r-transparent border-b-[14px] border-b-[#E8A13C]" />
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setIsLoggedIn(!!data.user));
  }, []);

  const signOut = async () => {
    await createClient().auth.signOut();
    setIsLoggedIn(false);
    router.refresh();
  };

  return (
    <main className="min-h-screen bg-cover bg-center flex flex-col items-center px-6 py-14 sm:py-20 gap-10" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.55), rgba(255,255,255,0.55)), url('/login-bg2.jpg')" }}>
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo />
        <h1 className="text-3xl sm:text-[34px] font-bold text-[#2B2A33] tracking-tight">AR Classroom</h1>
        <p className="text-base text-[#6E6C7A] max-w-xs">
          Draw together, then bring it to life in AR.
        </p>
      </div>

      <div className={`grid gap-5 w-full ${isLoggedIn ? "max-w-md" : "sm:grid-cols-2 max-w-3xl"}`}>
        {isLoggedIn ? (
          <div className="bg-white border border-[#E4E1D8] rounded-[28px] p-8 flex flex-col gap-4">
            <div className="w-[52px] h-[52px] rounded-2xl bg-[#EEEEFB] flex items-center justify-center">
              <div className="w-[22px] h-[22px] rounded-full bg-[#5B5BD6]" />
            </div>
            <div className="flex flex-col gap-1.5">
              <h2 className="text-[22px] font-bold text-[#2B2A33]">Welcome back</h2>
              <p className="text-[15px] text-[#6E6C7A]">You&apos;re signed in as a teacher.</p>
            </div>
            <div className="mt-auto flex flex-col gap-2.5">
              <Link
                href="/dashboard"
                className="text-center min-h-12 flex items-center justify-center rounded-2xl bg-[#5B5BD6] text-white text-[15px] font-semibold px-5 py-3 hover:bg-[#4646C6] transition-colors"
              >
                Go to my dashboard →
              </Link>
              <button
                onClick={signOut}
                className="min-h-10 flex items-center justify-center rounded-2xl border border-[#DBD8CE] bg-white text-[#6E6C7A] text-[14px] font-semibold px-5 py-2 hover:bg-[#F3F1EA] transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-[#E4E1D8] rounded-[28px] p-8 flex flex-col gap-4">
            <div className="w-[52px] h-[52px] rounded-2xl bg-[#EEEEFB] flex items-center justify-center">
              <div className="w-[22px] h-[22px] rounded-full bg-[#5B5BD6]" />
            </div>
            <div className="flex flex-col gap-1.5">
              <h2 className="text-[22px] font-bold text-[#2B2A33]">I&apos;m a teacher</h2>
              <p className="text-[15px] text-[#6E6C7A] leading-relaxed">
                Set up classrooms, run drawing sessions, and turn drawings into 3D models.
              </p>
            </div>
            {isLoggedIn === null ? (
              <div className="mt-auto h-12 rounded-2xl bg-[#5B5BD6]/50" />
            ) : (
              <div className="mt-auto grid grid-cols-2 gap-2.5">
                <Link
                  href="/login"
                  className="text-center min-h-12 flex items-center justify-center rounded-2xl bg-[#5B5BD6] text-white text-[15px] font-semibold px-4 py-3 hover:bg-[#4646C6] transition-colors"
                >
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className="text-center min-h-12 flex items-center justify-center rounded-2xl border border-[#DBD8CE] bg-white text-[#2B2A33] text-[15px] font-semibold px-4 py-3 hover:bg-[#F3F1EA] transition-colors"
                >
                  Create account
                </Link>
              </div>
            )}
          </div>
        )}

        {!isLoggedIn && (
          <div className="bg-[#E4F5F2] border border-[#C6E8E2] rounded-[28px] p-8 flex flex-col gap-4">
            <div className="w-[52px] h-[52px] rounded-2xl bg-white flex items-center justify-center">
              <div className="w-[22px] h-[22px] rounded-[6px] bg-[#1C9C8B]" />
            </div>
            <div className="flex flex-col gap-1.5">
              <h2 className="text-[22px] font-bold text-[#14453E]">I&apos;m a student</h2>
              <p className="text-[15px] text-[#2E6D63] leading-relaxed">
                Scan your classroom QR code, or tap below if your teacher gave you this device.
              </p>
            </div>
            <Link
              href="/student"
              className="mt-auto text-center min-h-14 flex items-center justify-center rounded-2xl bg-[#1C9C8B] text-white text-base font-bold px-5 py-4 hover:bg-[#147466] transition-colors"
            >
              Join my classroom
            </Link>
          </div>
        )}
      </div>

      
    </main>
  );
}
