"use client";

import { useMemo } from "react";

const COLORS = ["#FFC53D", "#FF6B6B", "#3FBF63", "#4EA8F2", "#8B5CF6", "#F472B6"];

/** Full-screen falling confetti. Parent mounts it for the celebration window
 *  and unmounts it after ~2.5s. Purely decorative — hidden from a11y tree and
 *  under reduced motion. */
export function ConfettiBurst({ count = 28 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.5,
        size: 8 + Math.random() * 8,
        color: COLORS[i % COLORS.length],
        round: i % 2 === 0,
      })),
    [count]
  );

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute animate-confetti-fall motion-reduce:hidden"
          style={{
            left: `${p.left}%`,
            top: "-24px",
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            borderRadius: p.round ? "9999px" : "3px",
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
