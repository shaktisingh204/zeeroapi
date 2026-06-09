import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Tinted-dark navy surface ramp (one consistent cool-gray family).
        bg: "#0a0c12",
        surface: "#11151f",
        "surface-2": "#181d29",
        "surface-3": "#212838",
        border: "#252c3b",
        "border-soft": "#1d2330",
        muted: "#8a93a6",
        "muted-2": "#5d6677",
        // Single, slightly refined emerald accent.
        brand: {
          DEFAULT: "#34d27b",
          dark: "#23b768",
          soft: "rgba(52, 210, 123, 0.12)",
        },
        live: "#ef4444",
        back: "#5aa9ef",
        lay: "#f08aa0",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      boxShadow: {
        // Navy-tinted shadows (carry the background hue, not pure black).
        card: "0 1px 2px rgba(5, 8, 14, 0.5), 0 8px 24px -12px rgba(5, 8, 14, 0.7)",
        pop: "0 12px 40px -12px rgba(5, 8, 14, 0.85)",
        glow: "0 0 0 1px rgba(52, 210, 123, 0.35), 0 8px 28px -8px rgba(52, 210, 123, 0.35)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.16,1,0.3,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
