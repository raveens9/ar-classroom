// Tiny synthesized sound effects for kid-facing pages. Web Audio only — no
// asset files. All play* functions are safe to call anywhere: they no-op on
// the server, when sound is toggled off, or when Web Audio is unavailable.

const KEY = "ar-kid-sound";

let ctx: AudioContext | null = null;

export function isSoundOn(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {}
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  // Browsers suspend the context until a user gesture; every play* call
  // happens inside a tap handler, so resuming here is allowed.
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

function tone(
  freq: number,
  startIn: number,
  duration: number,
  type: OscillatorType = "triangle",
  peak = 0.12,
  glideTo?: number
) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + startIn;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + duration);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

/** Short rising blip — generic button tap. */
export function playTap() {
  if (!isSoundOn()) return;
  tone(520, 0, 0.09, "triangle", 0.12, 760);
}

/** Brighter pop — picking a color or tool. */
export function playPick() {
  if (!isSoundOn()) return;
  tone(700, 0, 0.08, "triangle", 0.12, 1050);
}

/** Rising major arpeggio — celebration (AR model arrived, models placed). */
export function playYay() {
  if (!isSoundOn()) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.09, 0.22, "triangle", 0.14));
}
