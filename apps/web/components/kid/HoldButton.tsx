"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  onComplete: () => void;
  children: ReactNode;
  className?: string;
  holdMs?: number;
  title?: string;
  "aria-label"?: string;
}

/** Press-and-hold guard for destructive actions a kid could hit by accident
 *  (e.g. leaving the room). A fill rises while held; releasing early cancels. */
export function HoldButton({ onComplete, children, className = "", holdMs = 1200, ...rest }: Props) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);

  const cancel = () => {
    setHolding(false);
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const start = () => {
    setHolding(true);
    timer.current = window.setTimeout(() => {
      cancel();
      onComplete();
    }, holdMs);
  };

  useEffect(() => cancel, []);

  return (
    <button
      className={`kid-btn-icon relative overflow-hidden bg-white ${className}`}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      {...rest}
    >
      <span
        className="absolute inset-0 origin-bottom bg-kid-coral/70"
        style={{
          transform: `scaleY(${holding ? 1 : 0})`,
          transition: holding ? `transform ${holdMs}ms linear` : "transform 150ms ease",
        }}
        aria-hidden="true"
      />
      <span className="relative">{children}</span>
    </button>
  );
}
