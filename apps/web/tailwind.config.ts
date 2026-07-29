import type { Config } from "tailwindcss";

// SiteLens "command console" theme — dark, high-contrast, amber hi-vis accent.
const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        // Canvas + surfaces (deep slate / near-black).
        ink: {
          950: "#070a10",
          900: "#0b0f17",
          850: "#0f1420",
          800: "#141a28",
          700: "#1c2333",
          600: "#2a3346",
        },
        // Amber hi-vis accent (construction identity).
        accent: {
          50: "#fff8eb",
          100: "#feefc7",
          200: "#fedf8a",
          300: "#fcc94d",
          400: "#fab323",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
          800: "#923c0b",
          900: "#78320c",
        },
      },
      borderRadius: { xl: "0.9rem", "2xl": "1.15rem" },
      boxShadow: {
        glow: "0 0 0 1px rgba(245,158,11,0.28), 0 8px 30px -8px rgba(245,158,11,0.35)",
        panel: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 20px 40px -24px rgba(0,0,0,0.8)",
        lift: "0 12px 40px -16px rgba(0,0,0,0.7)",
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(to right, rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.035) 1px, transparent 1px)",
        "accent-sheen": "linear-gradient(135deg, #fab323 0%, #f59e0b 45%, #d97706 100%)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        pulseGlow: {
          "0%,100%": { opacity: "0.5" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.4s cubic-bezier(0.21,1,0.3,1) both",
        shimmer: "shimmer 2.2s linear infinite",
        "pulse-glow": "pulseGlow 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
