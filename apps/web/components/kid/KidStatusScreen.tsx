"use client";

import type { ReactNode } from "react";

interface Props {
  /** Big emoji that carries the meaning (a mascot can replace this later). */
  visual: string;
  /** Short kid-legible headline. Optional — the visual should carry meaning. */
  title?: string;
  /** Small aide-legible detail line. */
  caption?: string;
  /** Optional action, e.g. a retry KidButton. */
  children?: ReactNode;
  bounce?: boolean;
}

export function KidStatusScreen({ visual, title, caption, children, bounce = true }: Props) {
  return (
    <main className="kid-page flex flex-col items-center justify-center gap-5 p-6 text-center">
      <div
        className={`text-8xl ${bounce ? "animate-kid-bounce motion-reduce:animate-none" : ""}`}
        role="img"
      >
        {visual}
      </div>
      {title && <h1 className="text-3xl font-bold">{title}</h1>}
      {caption && <p className="max-w-xs text-base text-kid-ink/60">{caption}</p>}
      {children}
    </main>
  );
}
