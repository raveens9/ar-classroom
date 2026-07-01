"use client";

interface Props {
  onSelect: (style: string) => void;
  onClose: () => void;
  loading: boolean;
}

const INSTANT_STYLES: { name: string; label: string }[] = [
  { name: "child_colors",  label: "My Colors"    },
  { name: "cartoon",       label: "Cartoon"       },
  { name: "anime",         label: "Anime"         },
  { name: "cel_shading",   label: "Cel Shading"   },
  { name: "pixel_art",     label: "Pixel Art"     },
  { name: "low_poly",      label: "Low Poly"      },
  { name: "sepia",         label: "Sepia"         },
  { name: "vaporwave",     label: "Vaporwave"     },
  { name: "cyberpunk_neon",label: "Cyberpunk"     },
];

const NEURAL_STYLES: { name: string; label: string }[] = [
  { name: "watercolor",         label: "Watercolor"   },
  { name: "crayon",             label: "Crayon"       },
  { name: "oil_painting",       label: "Oil Paint"    },
  { name: "van_gogh",           label: "Van Gogh"     },
  { name: "mosaic",             label: "Mosaic"       },
  { name: "impressionism",      label: "Impressionism"},
  { name: "expressionism",      label: "Expressionism"},
  { name: "pastel",             label: "Pastel"       },
  { name: "charcoal",           label: "Charcoal"     },
  { name: "ink_wash",           label: "Ink Wash"     },
  { name: "pointillism",        label: "Pointillism"  },
  { name: "ukiyo_e",            label: "Ukiyo-e"      },
  { name: "abstract_kandinsky", label: "Kandinsky"    },
  { name: "graffiti",           label: "Graffiti"     },
  { name: "marble",             label: "Marble"       },
];

function StyleTile({
  name,
  label,
  disabled,
  onSelect,
}: {
  name: string;
  label: string;
  disabled: boolean;
  onSelect: (s: string) => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={() => onSelect(name)}
      className="flex flex-col items-center justify-center gap-1 rounded-xl bg-white/10 px-3 py-3 text-center text-xs font-medium text-white transition hover:bg-white/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
      style={{ minWidth: "4.5rem" }}
    >
      <span className="text-base leading-none">🎨</span>
      <span className="leading-tight">{label}</span>
    </button>
  );
}

export function StylePicker({ onSelect, onClose, loading }: Props) {
  return (
    /* Backdrop */
    <div
      className="absolute inset-0 z-40 flex flex-col justify-end"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Panel */}
      <div className="rounded-t-2xl bg-black/80 backdrop-blur-md px-4 pt-4 pb-6 space-y-4">
        {/* Handle + header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Pick a Style</h2>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white text-lg leading-none px-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-xs text-white/70">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Applying style…
          </div>
        )}

        {/* Instant styles */}
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/50">
            Instant
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {INSTANT_STYLES.map((s) => (
              <StyleTile
                key={s.name}
                name={s.name}
                label={s.label}
                disabled={loading}
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>

        {/* Neural styles */}
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/50">
            Neural · Slower
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {NEURAL_STYLES.map((s) => (
              <StyleTile
                key={s.name}
                name={s.name}
                label={s.label}
                disabled={loading}
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
