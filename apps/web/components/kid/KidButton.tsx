"use client";

import type { ButtonHTMLAttributes } from "react";
import { playTap } from "@/lib/kidSounds";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Round 64px icon button instead of a pill. */
  icon?: boolean;
}

export function KidButton({ icon = false, className = "", onClick, ...rest }: Props) {
  return (
    <button
      className={`${icon ? "kid-btn-icon" : "kid-btn"} ${className}`}
      onClick={(e) => {
        if (!rest.disabled) playTap();
        onClick?.(e);
      }}
      {...rest}
    />
  );
}
