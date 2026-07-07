"use client";

import { useEffect, useState } from "react";
import { isSoundOn, playTap, setSoundOn } from "@/lib/kidSounds";

export function SoundToggle({ className = "" }: { className?: string }) {
  // Start "on" and sync from localStorage after mount to avoid a hydration
  // mismatch.
  const [on, setOn] = useState(true);
  useEffect(() => setOn(isSoundOn()), []);

  return (
    <button
      aria-label={on ? "Turn sound off" : "Turn sound on"}
      className={`kid-btn-icon bg-white text-2xl ${className}`}
      onClick={() => {
        const next = !on;
        setOn(next);
        setSoundOn(next);
        if (next) playTap();
      }}
    >
      {on ? "🔊" : "🔇"}
    </button>
  );
}
