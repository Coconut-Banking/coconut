import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-instrument)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-syne)", "var(--font-instrument)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        coconut: {
          bg: "#0a0a0a",
          surface: "#111111",
          border: "rgba(255,255,255,0.06)",
          green: "#3D8E62",
          mint: "#6DD9A4",
        },
      },
    },
  },
  plugins: [],
};
export default config;
