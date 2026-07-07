"use client";

import { playPick } from "@/lib/kidSounds";

interface Props {
  onSelect: (style: string) => void;
  onClose: () => void;
  loading: boolean;
}

// Six visual choices a pre-reader can tell apart by picture and color alone.
// Names must match style ids the ML API accepts (see /v1 stylize pipeline).
const KID_STYLES: { name: string; label: string; emoji: string; bg: string }[] = [
  { name: "child_colors", label: "My colors", emoji: "🎨", bg: "#FFE29A" },
  { name: "crayon", label: "Crayon", emoji: "🖍️", bg: "#FFD1D1" },
  { name: "cartoon", label: "Cartoon", emoji: "😸", bg: "#C9E8FF" },
  { name: "watercolor", label: "Watery", emoji: "💧", bg: "#D6F5E3" },
  { name: "pixel_art", label: "Pixels", emoji: "👾", bg: "#E5DBFF" },
  { name: "van_gogh", label: "Starry", emoji: "🌻", bg: "#FFF3C4" },
];

export function StylePicker({ onSelect, onClose, loading }: Props) {
  return (
    /* Backdrop */
    <div
      className="absolute inset-0 z-40 flex flex-col justify-end bg-kid-ink/30"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Bottom sheet */}
      <div className="space-y-4 rounded-t-3xl border-t-[3px] border-kid-ink bg-white px-4 pb-6 pt-4 font-kid text-kid-ink">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">
            <span role="img" aria-hidden="true">🖌️</span> Pick a look
          </h2>
          <button
            onClick={onClose}
            className="kid-btn-icon h-12 w-12 text-xl"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-kid-ink/60">
            <span className="inline-block animate-kid-bounce text-xl motion-reduce:animate-none" role="img" aria-hidden="true">🎨</span>
            Painting…
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          {KID_STYLES.map((s) => (
            <button
              key={s.name}
              disabled={loading}
              onClick={() => { playPick(); onSelect(s.name); }}
              className="flex min-h-[88px] flex-col items-center justify-center gap-1 rounded-3xl border-[3px] border-kid-ink text-base font-semibold transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
              style={{ backgroundColor: s.bg }}
            >
              <span className="text-4xl leading-none" role="img" aria-hidden="true">{s.emoji}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
