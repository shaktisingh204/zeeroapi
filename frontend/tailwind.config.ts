import type { Config } from "tailwindcss";

// All colors are CSS-variable driven (rgb triplets) so themes can be swapped
// per surface: `:root` is the dark theme, `.theme-light` (developer portal)
// overrides them with a light console palette. See globals.css.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: v("bg"),
        surface: v("surface"),
        "surface-2": v("surface-2"),
        "surface-3": v("surface-3"),
        border: v("border"),
        "border-soft": v("border-soft"),
        muted: v("muted"),
        "muted-2": v("muted-2"),
        // Primary text ("white" in dark theme, near-navy in light theme).
        ink: v("ink"),
        brand: {
          DEFAULT: v("brand"),
          dark: v("brand-dark"),
          soft: "var(--brand-soft)",
          // Text/icon color placed on top of solid brand fills.
          contrast: v("brand-contrast"),
        },
        live: v("live"),
        back: v("back"),
        lay: v("lay"),
        info: v("info"),
        warn: v("warn"),
        violet2: v("violet2"),
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
        // Theme-tinted shadows (navy in dark, soft gray-blue in light).
        card: "var(--shadow-card)",
        pop: "var(--shadow-pop)",
        glow: "var(--shadow-glow)",
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
