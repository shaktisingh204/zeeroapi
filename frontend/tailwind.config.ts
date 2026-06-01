import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0b0e14",
        surface: "#131722",
        "surface-2": "#1c2230",
        border: "#262d3d",
        muted: "#8b93a7",
        brand: {
          DEFAULT: "#22c55e",
          dark: "#16a34a",
        },
        live: "#ef4444",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
