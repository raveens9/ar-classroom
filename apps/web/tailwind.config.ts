import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#6366f1",
          dark: "#4338ca",
        },
        // Kid-facing theme ("crayon box on paper") — used only by kid-* utilities
        // and kid pages. Adult pages keep the dark brand theme above.
        kid: {
          paper: "#FFF6E7",
          ink: "#33325C",
          sun: "#FFC53D",
          coral: "#FF6B6B",
          grass: "#3FBF63",
          sky: "#4EA8F2",
          berry: "#8B5CF6",
          pink: "#F472B6",
        },
      },
      fontFamily: {
        kid: ["var(--font-kid)", "ui-rounded", "system-ui", "sans-serif"],
      },
      keyframes: {
        "kid-bounce": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-14px)" },
        },
        "kid-wiggle": {
          "0%, 100%": { transform: "rotate(-4deg) scale(1.1)" },
          "50%": { transform: "rotate(4deg) scale(1.1)" },
        },
        "kid-pop-in": {
          "0%": { transform: "scale(0)", opacity: "0" },
          "70%": { transform: "scale(1.15)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        "kid-pulse-ring": {
          "0%": { transform: "scale(1)", opacity: "0.7" },
          "100%": { transform: "scale(1.7)", opacity: "0" },
        },
        "confetti-fall": {
          "0%": { transform: "translateY(-10vh) rotate(0deg)", opacity: "1" },
          "100%": { transform: "translateY(110vh) rotate(720deg)", opacity: "0" },
        },
      },
      animation: {
        "kid-bounce": "kid-bounce 1.6s ease-in-out infinite",
        "kid-wiggle": "kid-wiggle 0.5s ease-in-out",
        "kid-pop-in": "kid-pop-in 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both",
        "kid-pulse-ring": "kid-pulse-ring 1.4s ease-out infinite",
        "confetti-fall": "confetti-fall 2.4s ease-in forwards",
      },
    },
  },
  plugins: [],
};
export default config;
